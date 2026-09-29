import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import { PLACES, PLACE_TYPES } from './places.js';
import * as db from './db.js';
import * as clock from './clock.js';
import { buildProfiles, liveLevel, upcoming, dayProfile, forecastAt, localParts, localDate, dayStart, LEVEL_LABELS, round1 } from './forecast.js';
import { CATEGORIES, STATUSES, priority, findSimilar, slaState, verificationState, recordVerification, weeklyDigest, weekOf } from './issues.js';
import { COURSES, BRANCHES, YEARS, validCourses, matchesFor, reputation, studyStats } from './study.js';
import { TIMETABLE, timetableEstimate, upcomingSurges, roomStatus, wasteEstimate, staggered, HERD, dayKind } from './campus.js';
import { reliabilities, NEW_USER_TRUST } from './trust.js';
import { MEALS, MESSES, mealForecast, nextMeals, optOutCount, wasteAvoided, KG_PER_PLATE, USUAL_BUFFER } from './mess.js';
import { GOOGLE_CLIENT_ID, ALLOWED_DOMAIN, verifyGoogle, signSession, verifySession } from './auth.js';
import { answer } from './ask.js';

const ADMIN_PIN = process.env.ADMIN_PIN || 'iith2026'; // only used when Google sign-in is off
const REPORT_RATE_LIMIT_MS = 60_000; // anti-flood only; trust weighting is the real anti-spam
const WRITES_PER_MIN = Number(process.env.WRITES_PER_MIN ?? 30); // per IP, all POST/PUT/PATCH
// Browsers on other sites may not call this API. Same-origin (the built app) never needs CORS.
export const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4000',
  process.env.RENDER_EXTERNAL_URL, // set automatically by Render
  ...(process.env.ALLOWED_ORIGINS ?? '').split(','),
]
  .map((o) => o?.trim())
  .filter(Boolean);

const pinMatches = (pin) =>
  typeof pin === 'string' && pin.length === ADMIN_PIN.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(ADMIN_PIN));
const MIN = 60_000;
const HOUR = 3_600_000;

const placeById = new Map(PLACES.map((p) => [p.id, p]));
const roomById = new Map(TIMETABLE.rooms.map((r) => [r.id, r]));
const placeName = (id) => placeById.get(id)?.name ?? 'Unknown';

// Forecast profiles and reporter trust are cached and rebuilt only when reports change.
// The historical forecast only uses reports from before today, so fresh (possibly spam) reports
// can't shift the prior they are judged against.
let profiles = null;
let profilesFor = '';
function getProfiles() {
  const { reports } = db.get();
  const cutoff = dayStart(clock.now());
  const key = `${reports.length}|${cutoff}`;
  if (!profiles || profilesFor !== key) {
    profiles = buildProfiles(reports.filter((r) => r.ts < cutoff));
    profilesFor = key;
  }
  return profiles;
}

/** Expected level with zero taps: historical forecast, floored by the timetable model. */
function expectedAt(place, ts) {
  const f = forecastAt(getProfiles(), place.id, ts);
  const t = place.openHours && (localParts(ts).hour < place.openHours[0] || localParts(ts).hour >= place.openHours[1]) ? null : timetableEstimate(place, ts);
  if (!f && !t) return null;
  return { level: Math.max(f?.level ?? 1, t?.level ?? 1), timetable: t, fromTimetable: Boolean(t && t.level >= (f?.level ?? 1)) };
}

let trust = null;
let trustFor = -1;
function getTrust() {
  const { reports } = db.get();
  if (!trust || trustFor !== reports.length) {
    // chisle: full recompute on every new report (~tens of ms on 10k reports); make incremental if it shows up in profiles
    trust = reliabilities(reports, (placeId, ts) => expectedAt(placeById.get(placeId), ts)?.level ?? null);
    trustFor = reports.length;
  }
  return trust;
}
const trustOf = (user) => getTrust().get(user)?.trust ?? NEW_USER_TRUST;

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function placeSummary(place, now) {
  const p = getProfiles();
  const prior = expectedAt(place, now);
  // Weight = trust squared: sharpens the gap (honest 0.8 -> 0.64, fresh account 0.125 -> 0.016), like log-odds weighting.
  const live = liveLevel(db.get().reports, p, place.id, now, { weightOf: (u) => trustOf(u) ** 2, prior });
  if (live.source === 'forecast' && prior.fromTimetable) live.source = 'timetable';
  const next = upcoming(p, place, now, 6, (ts) => expectedAt(place, ts)?.level);
  const { hour } = localParts(now);
  const open = hour >= place.openHours[0] && hour < place.openHours[1];
  return {
    ...place,
    open,
    live,
    timetable: prior?.timetable ?? null,
    occupancyEstimate: live.level ? Math.round(((live.level - 1) / 4) * place.capacity) : null,
    bestTime: next.best,
    trend: next.slots[1]?.level != null && live.level != null ? Math.sign(Math.round((next.slots[1].level - live.level) * 2)) : 0,
  };
}

const roomsNow = (ts) => {
  const s = db.get();
  return roomStatus(ts, { reports: s.roomReports, bookings: s.bookings });
};

function energyStats(since = 0) {
  const waste = db.get().energyAudits.filter((a) => a.on && a.verified && a.ts >= since);
  return {
    verified: waste.length,
    kwh: waste.reduce((a, w) => a + w.kwh, 0),
    inr: waste.reduce((a, w) => a + w.inr, 0),
  };
}

function digestFor(since, until) {
  return weeklyDigest({ issues: db.get().issues, placeName, since, now: until, energy: energyStats(since) });
}

/** Scheduled job: on Monday from 9 am, store last week's digest for the estate office once. */
export function weeklyJob(now = clock.now()) {
  const { start, key } = weekOf(now);
  const state = db.get();
  if (now < start + 9 * HOUR || state.digests.some((d) => d.key === key)) return null;
  const d = { key, createdAt: now, ...digestFor(start - 7 * 86_400_000, start) };
  state.digests.push(d);
  db.save();
  return d;
}

export function createApp({ emit = () => {}, demoMode = false, authRequired = Boolean(GOOGLE_CLIENT_ID) } = {}) {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: rate-limit by the real client IP, not the proxy's
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:', 'https://accounts.google.com/gsi/'],
          'frame-src': ['https://accounts.google.com/gsi/'],
          'upgrade-insecure-requests': null, // phones on campus Wi-Fi open the app over plain http in local demos
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Google sign-in popup
    })
  );
  app.use(cors({ origin: ALLOWED_ORIGINS }));
  app.use(express.json({ limit: '50kb' }));
  const limitMsg = (msg) => ({ standardHeaders: 'draft-7', legacyHeaders: false, message: { error: msg } });
  // Flood protection on every write.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: WRITES_PER_MIN,
      skip: (req) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method),
      ...limitMsg('Too many requests - slow down and try again in a minute.'),
    })
  );
  // PIN guessing: 5 wrong PINs per 15 min per IP, wherever the PIN is sent (header or /admin/verify body).
  app.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 5,
      skip: (req) => {
        const pin = req.get('x-admin-pin') ?? (req.path === '/api/admin/verify' ? req.body?.pin : undefined);
        return pin === undefined || pinMatches(pin);
      },
      ...limitMsg('Too many wrong PINs. Try again in 15 minutes.'),
    })
  );

  // Who is calling? A signed session (Google sign-in) wins. Without sign-in configured, fall back to
  // the anonymous id the browser sends (dev/demo only), and the admin PIN.
  app.use((req, _res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    const session = token ? verifySession(token) : null;
    req.session = session;
    req.uid = session?.id ?? (authRequired ? '' : str(req.body?.user ?? req.query.user, 64));
    req.isAdmin = session ? Boolean(session.admin) : !authRequired && pinMatches(req.get('x-admin-pin'));
    next();
  });
  const requireUser = (req, res, next) =>
    req.uid ? next() : bad(res, authRequired ? `Sign in with your @${ALLOWED_DOMAIN} account` : 'user is required', 401);
  const requireAdmin = (req, res, next) => (req.isAdmin ? next() : req.session ? bad(res, 'Admins only', 403) : bad(res, authRequired ? 'Sign in first' : 'Admin PIN required', 401));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/meta', (_req, res) => {
    res.json({
      places: PLACES,
      placeTypes: PLACE_TYPES,
      categories: CATEGORIES,
      statuses: STATUSES,
      courses: COURSES,
      branches: BRANCHES,
      years: YEARS,
      levelLabels: LEVEL_LABELS,
      meals: MEALS,
      messes: MESSES.map(({ id, name, registered }) => ({ id, name, registered })),
      auth: { required: authRequired, clientId: GOOGLE_CLIENT_ID, domain: ALLOWED_DOMAIN },
      demoMode,
      now: clock.now(),
      demoTime: clock.isShifted(),
    });
  });

  // ---------- Identity ----------
  app.post('/api/auth/google', async (req, res) => {
    if (!authRequired) return bad(res, 'Google sign-in is not configured on this server');
    try {
      const user = await verifyGoogle(str(req.body.credential, 4096));
      res.json({ token: signSession(user), user });
    } catch (e) {
      bad(res, e.message, 401);
    }
  });

  app.post('/api/admin/verify', (req, res) => {
    if (authRequired) return bad(res, 'Admins are set with ADMIN_EMAILS', 403);
    if (!pinMatches(req.body.pin)) return bad(res, 'Wrong PIN', 401);
    res.json({ ok: true });
  });

  // Demo only: jump the server clock (e.g. to Monday 12:50) so timetable features can be shown any time.
  app.post('/api/demo/clock', requireAdmin, (req, res) => {
    if (!demoMode) return bad(res, 'Demo mode is off', 403);
    const at = req.body.at == null ? null : Date.parse(req.body.at);
    if (at !== null && Number.isNaN(at)) return bad(res, 'at must be a date/time or null');
    clock.setNow(at);
    emit('clock', { now: clock.now() });
    res.json({ now: clock.now(), demoTime: clock.isShifted() });
  });

  // ---------- Pulse (crowd) ----------
  app.get('/api/pulse', (_req, res) => {
    const now = clock.now();
    const places = PLACES.map((p) => placeSummary(p, now));
    const cutoff = now - 60 * MIN;
    const recent = db.get().reports.filter((r) => r.ts >= cutoff && r.ts <= now);
    res.json({
      now,
      places,
      surges: upcomingSurges(now, 180).map((s) => ({ ...s, placeName: placeName(s.placeId), fromName: placeName(s.fromPlaceId) })),
      day: dayKind(now),
      reportsLastHour: recent.length,
      contributorsLastHour: new Set(recent.map((r) => r.user)).size,
    });
  });

  app.get('/api/places/:id', (req, res) => {
    const place = placeById.get(req.params.id);
    if (!place) return bad(res, 'Unknown place', 404);
    const now = clock.now();
    const p = getProfiles();
    const { dow } = localParts(now);
    const recent = db
      .get()
      .reports.filter((r) => r.placeId === place.id && r.ts <= now)
      .slice(-8)
      .reverse()
      .map(({ level, ts, user }) => ({ level, ts, trust: Math.round(trustOf(user) * 100), mine: user === req.uid }));
    res.json({
      ...placeSummary(place, now),
      upcoming: upcoming(p, place, now, 12, (ts) => expectedAt(place, ts)?.level),
      today: dayProfile(p, place.id, dow),
      recent,
    });
  });

  app.post('/api/reports', requireUser, (req, res) => {
    const placeId = str(req.body.placeId, 40);
    const level = Number(req.body.level);
    const user = req.uid;
    if (!placeById.has(placeId)) return bad(res, 'Unknown place');
    if (!Number.isInteger(level) || level < 1 || level > 5) return bad(res, 'level must be an integer 1-5');

    const state = db.get();
    const now = clock.now();
    const last = state.reports.findLast?.((r) => r.user === user && r.placeId === placeId);
    if (last && now - last.ts < REPORT_RATE_LIMIT_MS && now >= last.ts) return bad(res, 'Wait a minute before reporting here again.', 429);
    const place = placeById.get(placeId);
    const before = placeSummary(place, now).live.level;
    const report = { id: crypto.randomUUID(), placeId, level, ts: now, user };
    state.reports.push(report);
    db.save();
    emit('pulse:update', { placeId });
    res.status(201).json({ report, before, place: placeSummary(place, now), trust: trustOf(user) });
  });

  app.get('/api/trust', (req, res) => {
    const t = getTrust().get(req.uid);
    res.json({ trust: t?.trust ?? NEW_USER_TRUST, reports: t?.reports ?? 0, isNew: !t });
  });

  // Herd-aware suggestion: don't send everyone to the same "empty" place at once.
  const herdLog = [];
  const HERD_TYPES = { study: ['library', 'cafe'], food: ['mess', 'cafe'], fitness: ['gym', 'sports'] };
  app.get('/api/suggest', (req, res) => {
    const now = clock.now();
    const kind = HERD_TYPES[req.query.kind] ? req.query.kind : 'study';
    while (herdLog.length && now - herdLog[0].ts > HERD.delayMin * MIN) herdLog.shift();
    const sticky = req.uid && herdLog.find((s) => s.user === req.uid && s.kind === kind);
    const cands = PLACES.filter((p) => HERD_TYPES[kind].includes(p.type))
      .map((p) => placeSummary(p, now))
      .filter((p) => p.open && p.live.level != null)
      .sort((a, b) => a.live.level - b.live.level);
    const sentNow = (id) => herdLog.filter((s) => s.placeId === id && s.when === 'now').length;
    let pick;
    if (sticky) {
      const place = cands.find((c) => c.id === sticky.placeId) ?? cands[0];
      pick = place && { place, when: sticky.when, delayMin: Math.max(0, Math.ceil((sticky.ts + sticky.delayMin * MIN - now) / MIN)) };
    } else {
      pick = staggered(cands, sentNow);
      if (pick) herdLog.push({ user: req.uid, kind, placeId: pick.place.id, when: pick.when, delayMin: pick.delayMin, ts: now });
    }
    if (!pick) return res.json(null);
    res.json({ placeId: pick.place.id, name: pick.place.name, level: pick.place.live.level, when: pick.when, delayMin: pick.delayMin, sentRecently: sentNow(pick.place.id) });
  });

  // ---------- Campus rooms (free-room finder + energy audit) ----------
  app.get('/api/rooms', (req, res) => {
    const now = clock.now();
    const rooms = roomsNow(now);
    const recentAudits = db.get().energyAudits.filter((a) => now - a.ts < HOUR);
    // Ask a passer-by about one empty room nobody checked in the last hour.
    const target = rooms.find((r) => r.state === 'free' && !recentAudits.some((a) => a.roomId === r.id));
    const hours = target ? Math.min(3, (target.freeUntil - now) / HOUR) : 0;
    res.json({
      now,
      rooms,
      audit: target ? { roomId: target.id, placeName: target.placeName, question: `Is the AC or any light on in ${target.id}?`, estimate: wasteEstimate(target, hours) } : null,
      energy: energyStats(now - 7 * 86_400_000),
    });
  });

  app.post('/api/rooms/:id/report', requireUser, (req, res) => {
    if (!roomById.has(req.params.id)) return bad(res, 'Unknown room', 404);
    db.get().roomReports.push({ roomId: req.params.id, busy: Boolean(req.body.busy), ts: clock.now(), user: req.uid });
    db.save();
    emit('rooms:update', { roomId: req.params.id });
    res.status(201).json(roomsNow(clock.now()).find((r) => r.id === req.params.id));
  });

  app.post('/api/rooms/:id/audit', requireUser, (req, res) => {
    const now = clock.now();
    const room = roomsNow(now).find((r) => r.id === req.params.id);
    if (!room) return bad(res, 'Unknown room', 404);
    const on = Boolean(req.body.on);
    // Auto-verified: the timetable says it's empty and nobody reported it occupied.
    const verified = on && room.state === 'free';
    const est = wasteEstimate(room, verified ? Math.min(3, (room.freeUntil - now) / HOUR) : 0);
    const audit = { id: crypto.randomUUID(), roomId: room.id, placeId: room.placeId, ts: now, user: req.uid, on, verified, kwh: est.kwh, inr: est.inr };
    const state = db.get();
    state.energyAudits.push(audit);
    let issue = null;
    if (verified) {
      issue = state.issues.find((i) => i.status !== 'resolved' && i.category === 'energy' && i.roomId === room.id);
      if (issue) {
        if (!issue.voters.includes(req.uid)) {
          issue.voters.push(req.uid);
          issue.upvotes += 1;
        }
      } else {
        issue = {
          id: crypto.randomUUID(),
          title: `AC/lights on in empty ${room.id}`,
          description: `Verified by Pulse: no class in ${room.id} per the timetable and nobody reported it in use. Est. ${est.kw} kW, about Rs ${est.inr} until the next class.`,
          category: 'energy',
          placeId: room.placeId,
          roomId: room.id,
          status: 'open',
          upvotes: 1,
          voters: [req.uid],
          reporter: req.uid,
          createdAt: now,
          updatedAt: now,
          resolvedAt: null,
        };
        state.issues.push(issue);
      }
      emit('issues:update', { id: issue.id });
    }
    db.save();
    emit('rooms:update', { roomId: room.id });
    res.status(201).json({ ...audit, estimate: est, issueId: issue?.id ?? null, roomState: room.state });
  });

  // ---------- Mess (demand forecast + opt-out) ----------
  function mealsView(now, user) {
    const { mealOptOuts } = db.get();
    const p = getProfiles();
    return nextMeals(now, 3).map(({ meal, ts }) => {
      const date = localDate(ts);
      const perMess = MESSES.map((mess) => mealForecast({ mess, meal, ts, profiles: p, optOuts: optOutCount(mealOptOuts, mess.id, date, meal) }));
      const sum = (k) => perMess.reduce((a, f) => a + f[k], 0);
      return {
        meal,
        date,
        label: MEALS[meal].label,
        start: perMess[0].start,
        open: perMess[0].start > now, // opt-out closes when the meal starts
        factors: perMess[0].factors,
        perMess,
        total: { expected: sum('expected'), sd: Math.round(Math.sqrt(perMess.reduce((a, f) => a + f.sd ** 2, 0))), cookFor: sum('cookFor'), usual: sum('usual'), kgSaved: sum('kgSaved'), optOuts: sum('optOuts'), changePct: Math.round((100 * (sum('cookFor') - sum('usual'))) / sum('usual')) },
        mine: mealOptOuts.find((o) => o.user === user && o.date === date && o.meal === meal)?.mess ?? null,
      };
    });
  }

  app.get('/api/mess', (req, res) => {
    const now = clock.now();
    res.json({
      now,
      meals: mealsView(now, req.uid),
      week: wasteAvoided(db.get().mealOptOuts, getProfiles(), now),
      assumptions: { usualBuffer: USUAL_BUFFER, kgPerPlate: KG_PER_PLATE },
    });
  });

  app.post('/api/mess/optout', requireUser, (req, res) => {
    const meal = str(req.body.meal, 20);
    const date = str(req.body.date, 10);
    const mess = str(req.body.mess, 20);
    if (!MEALS[meal]) return bad(res, 'Unknown meal');
    if (!MESSES.some((m) => m.id === mess)) return bad(res, 'Unknown mess');
    const now = clock.now();
    const target = nextMeals(now, 3).find((m) => m.meal === meal && localDate(m.ts) === date);
    if (!target) return bad(res, 'You can only skip one of the next three meals');
    if (dayStart(target.ts) + MEALS[meal].start * MIN <= now) return bad(res, 'This meal has already started', 409);
    const state = db.get();
    state.mealOptOuts = state.mealOptOuts.filter((o) => !(o.user === req.uid && o.date === date && o.meal === meal));
    if (req.body.skip !== false) state.mealOptOuts.push({ user: req.uid, date, meal, mess, ts: now });
    db.save();
    emit('mess:update', { meal, date });
    res.json(mealsView(now, req.uid).find((m) => m.meal === meal && m.date === date));
  });

  // ---------- FixIt (facility issues) ----------
  const decorate = (i, user) => {
    const now = clock.now();
    return {
      ...i,
      voters: undefined,
      verify: undefined,
      reporter: undefined,
      voted: user ? i.voters.includes(user) : false,
      priority: priority(i, now),
      sla: slaState(i, now),
      verification: verificationState(i, now),
      myVerification: user && i.verify ? (i.verify.confirms.includes(user) ? 'fixed' : i.verify.disputes.includes(user) ? 'not_fixed' : null) : null,
      placeName: placeName(i.placeId),
    };
  };

  app.get('/api/issues', (req, res) => {
    const { status, sort = 'priority' } = req.query;
    let list = db.get().issues;
    if (status === 'escalated') list = list.filter((i) => slaState(i, clock.now())?.escalation > 0);
    else if (status && status !== 'all') list = list.filter((i) => i.status === status);
    list = list.map((i) => decorate(i, req.uid));
    list.sort(sort === 'new' ? (a, b) => b.createdAt - a.createdAt : (a, b) => b.priority - a.priority || b.upvotes - a.upvotes);
    res.json(list);
  });

  app.post('/api/issues/similar', (req, res) => {
    const title = str(req.body.title, 120);
    if (title.length < 4) return res.json([]);
    const similar = findSimilar(db.get().issues, {
      title,
      description: str(req.body.description),
      placeId: str(req.body.placeId, 40),
      category: str(req.body.category, 40),
    });
    res.json(similar.map((i) => decorate(i, req.uid)));
  });

  app.post('/api/issues', requireUser, (req, res) => {
    const title = str(req.body.title, 120);
    const description = str(req.body.description, 1000);
    const category = str(req.body.category, 40);
    const placeId = str(req.body.placeId, 40);
    const reporter = req.uid;
    if (title.length < 4) return bad(res, 'Title must be at least 4 characters');
    if (!CATEGORIES[category]) return bad(res, 'Unknown category');
    if (!placeById.has(placeId)) return bad(res, 'Unknown place');
    const now = clock.now();
    const issue = {
      id: crypto.randomUUID(),
      title,
      description,
      category,
      placeId,
      status: 'open',
      upvotes: 1,
      voters: [reporter],
      reporter,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    db.get().issues.push(issue);
    db.save();
    emit('issues:update', { id: issue.id });
    res.status(201).json(decorate(issue, reporter));
  });

  app.post('/api/issues/:id/upvote', requireUser, (req, res) => {
    const user = req.uid;
    const issue = db.get().issues.find((i) => i.id === req.params.id);
    if (!issue) return bad(res, 'Issue not found', 404);
    const idx = issue.voters.indexOf(user);
    if (idx === -1) {
      issue.voters.push(user);
      issue.upvotes += 1;
    } else {
      issue.voters.splice(idx, 1);
      issue.upvotes = Math.max(0, issue.upvotes - 1);
    }
    db.save();
    emit('issues:update', { id: issue.id });
    res.json(decorate(issue, user));
  });

  app.patch('/api/issues/:id', requireAdmin, (req, res) => {
    const issue = db.get().issues.find((i) => i.id === req.params.id);
    if (!issue) return bad(res, 'Issue not found', 404);
    const status = str(req.body.status, 20);
    if (!STATUSES.includes(status)) return bad(res, `status must be one of ${STATUSES.join(', ')}`);
    issue.status = status;
    issue.updatedAt = clock.now();
    issue.resolvedAt = status === 'resolved' ? issue.updatedAt : null;
    issue.verify = status === 'resolved' ? { confirms: [], disputes: [] } : null;
    db.save();
    emit('issues:update', { id: issue.id });
    res.json(decorate(issue));
  });

  // The people who reported/upvoted confirm the fix, or it reopens.
  app.post('/api/issues/:id/verify', requireUser, (req, res) => {
    const issue = db.get().issues.find((i) => i.id === req.params.id);
    if (!issue) return bad(res, 'Issue not found', 404);
    if (issue.status !== 'resolved') return bad(res, 'Issue is not marked resolved', 409);
    if (!issue.voters.includes(req.uid)) return bad(res, 'Only students who reported or upvoted this issue can confirm the fix', 403);
    const outcome = recordVerification(issue, req.uid, req.body.fixed !== false, clock.now());
    db.save();
    emit('issues:update', { id: issue.id });
    res.json({ outcome, issue: decorate(issue, req.uid) });
  });

  app.get('/api/digest', requireAdmin, (_req, res) => {
    const now = clock.now();
    res.json({ current: digestFor(now - 7 * 86_400_000, now), archive: db.get().digests.slice(-8).reverse() });
  });

  // ---------- Study Match ----------
  const STUDY_TYPES = new Set(['library', 'cafe', 'academic']);
  /** Quietest open study-friendly place right now, from live Pulse data. */
  function bestStudySpot(now = clock.now()) {
    const spots = PLACES.filter((p) => STUDY_TYPES.has(p.type))
      .map((p) => placeSummary(p, now))
      .filter((p) => p.open && p.live.level != null)
      .sort((a, b) => a.live.level - b.live.level || (a.type === 'library' ? -1 : 1));
    const s = spots[0];
    return s ? { placeId: s.id, name: s.name, level: s.live.level } : null;
  }
  /** Smallest empty classroom that stays free for the next hour (timetable + crowd reports + bookings). */
  function bestStudyRoom(now = clock.now()) {
    return roomsNow(now)
      .filter((r) => r.state === 'free' && r.freeUntil - now >= HOUR)
      .sort((a, b) => a.seats - b.seats)[0] ?? null;
  }

  const profileOf = (user) => db.get().studyProfiles.find((p) => p.user === user);
  const publicProfile = (p) => p && { user: p.user, name: p.name, year: p.year, branch: p.branch };
  const decorateRequest = (r, me) => {
    const place = placeById.get(r.placeId);
    const booking = r.bookingId && db.get().bookings.find((b) => b.id === r.bookingId);
    return {
      ...r,
      mine: r.from === me,
      other: publicProfile(profileOf(r.from === me ? r.to : r.from)),
      placeName: place?.name ?? null,
      placeLive: place ? placeSummary(place, clock.now()).live.level : null,
      bookedUntil: booking?.end ?? null,
    };
  };

  app.get('/api/study/profile', (req, res) => {
    res.json(profileOf(req.uid) ?? null);
  });

  app.put('/api/study/profile', requireUser, (req, res) => {
    const user = req.uid;
    const name = str(req.body.name, 40);
    const year = Number(req.body.year);
    const branch = str(req.body.branch, 20);
    const canHelp = validCourses(req.body.canHelp);
    const needHelp = validCourses(req.body.needHelp).filter((c) => !canHelp.includes(c));
    if (name.length < 2) return bad(res, 'Name must be at least 2 characters');
    if (!YEARS.includes(year)) return bad(res, 'Pick your year');
    if (!BRANCHES.includes(branch)) return bad(res, 'Pick your branch');
    if (!canHelp.length && !needHelp.length) return bad(res, 'Pick at least one course you can help with or need help in');
    const state = db.get();
    const isNew = !profileOf(user);
    const profile = { user, name, year, branch, canHelp, needHelp, available: req.body.available !== false, updatedAt: clock.now() };
    state.studyProfiles = state.studyProfiles.filter((p) => p.user !== user).concat(profile);
    db.save();
    emit('study:update');
    // Demo: a matching demo student sends the new user a request, to show the incoming flow.
    if (demoMode && isNew) {
      setTimeout(() => {
        const busy = new Set(
          state.studyRequests.filter((r) => ['pending', 'accepted'].includes(r.status) && (r.from === user || r.to === user)).flatMap((r) => [r.from, r.to])
        );
        if (state.studyRequests.some((r) => r.status === 'pending' && r.to === user)) return;
        const best = matchesFor(profile, state.studyProfiles.filter((p) => p.user.startsWith('demo-') && !busy.has(p.user)), state.studyRequests)[0];
        if (!best) return;
        const direction = best.kind === 'swap' ? 'swap' : best.kind === 'mentor' ? 'teach' : 'learn';
        state.studyRequests.push({
          id: crypto.randomUUID(),
          from: best.user,
          to: user,
          course: direction === 'learn' ? best.youTeach[0] : best.youLearn[0],
          swapCourse: direction === 'swap' ? best.youTeach[0] : null,
          direction,
          placeId: bestStudySpot()?.placeId ?? 'lib',
          message: 'Saw we match - want to study together?',
          status: 'pending',
          helpful: null,
          createdAt: clock.now(),
          respondedAt: null,
          completedAt: null,
        });
        db.save();
        emit('study:update');
      }, 8000).unref?.();
    }
    res.json(profile);
  });

  app.get('/api/study/matches', (req, res) => {
    const me = profileOf(req.uid);
    const room = bestStudyRoom();
    const roomInfo = room && { id: room.id, placeName: room.placeName, seats: room.seats, freeUntil: room.freeUntil };
    if (!me) return res.json({ matches: [], spot: bestStudySpot(), room: roomInfo });
    const state = db.get();
    const open = new Map(
      state.studyRequests
        .filter((r) => (r.status === 'pending' || r.status === 'accepted') && (r.from === me.user || r.to === me.user))
        .map((r) => [r.from === me.user ? r.to : r.from, r.status])
    );
    const matches = matchesFor(me, state.studyProfiles, state.studyRequests, clock.now()).map((m) => ({ ...m, requestStatus: open.get(m.user) ?? null }));
    res.json({ matches, spot: bestStudySpot(), room: roomInfo, myReputation: reputation(state.studyRequests, me.user) });
  });

  app.get('/api/study/requests', (req, res) => {
    const user = req.uid;
    const mine = db
      .get()
      .studyRequests.filter((r) => (r.from === user || r.to === user) && r.status !== 'declined')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map((r) => decorateRequest(r, user));
    res.json({
      incoming: mine.filter((r) => r.status === 'pending' && !r.mine),
      outgoing: mine.filter((r) => r.status === 'pending' && r.mine),
      active: mine.filter((r) => r.status === 'accepted'),
      done: mine.filter((r) => r.status === 'done').slice(0, 10),
    });
  });

  function respond(r, accept) {
    const now = clock.now();
    r.status = accept ? 'accepted' : 'declined';
    r.respondedAt = now;
    if (accept) {
      // Book an actually-free classroom for the next hour; fall back to the quietest open place.
      const room = bestStudyRoom(now);
      if (room) {
        const booking = { id: crypto.randomUUID(), roomId: room.id, start: now, end: Math.min(now + HOUR, room.freeUntil), requestId: r.id };
        db.get().bookings.push(booking);
        Object.assign(r, { roomId: room.id, placeId: room.placeId, bookingId: booking.id });
        emit('rooms:update', { roomId: room.id });
      } else {
        const spot = bestStudySpot(now);
        if (spot) r.placeId = spot.placeId;
      }
    }
    db.save();
    emit('study:update');
  }

  app.post('/api/study/requests', requireUser, (req, res) => {
    const from = req.uid;
    const to = str(req.body.to, 64);
    const me = profileOf(from);
    const them = profileOf(to);
    if (!me) return bad(res, 'Create your study profile first');
    if (!them || from === to) return bad(res, 'Unknown student', 404);
    const youLearn = them.canHelp.filter((c) => me.needHelp.includes(c));
    const youTeach = them.needHelp.filter((c) => me.canHelp.includes(c));
    if (!youLearn.length && !youTeach.length) return bad(res, 'No course in common');
    const state = db.get();
    if (state.studyRequests.some((r) => ['pending', 'accepted'].includes(r.status) && [r.from, r.to].includes(from) && [r.from, r.to].includes(to))) {
      return bad(res, 'You already have an open request with this student', 409);
    }
    const direction = youLearn.length && youTeach.length ? 'swap' : youLearn.length ? 'learn' : 'teach';
    const spot = bestStudySpot();
    const request = {
      id: crypto.randomUUID(),
      from,
      to,
      course: youLearn[0] ?? youTeach[0],
      swapCourse: direction === 'swap' ? youTeach[0] : null,
      direction,
      placeId: spot?.placeId ?? 'lib',
      message: str(req.body.message, 200),
      status: 'pending',
      helpful: null,
      createdAt: clock.now(),
      respondedAt: null,
      completedAt: null,
    };
    state.studyRequests.push(request);
    db.save();
    emit('study:update');
    // Demo students accept after a few seconds so the flow can be shown with one laptop.
    if (demoMode && to.startsWith('demo-')) {
      setTimeout(() => request.status === 'pending' && respond(request, true), 4000).unref?.();
    }
    res.status(201).json(decorateRequest(request, from));
  });

  app.post('/api/study/requests/:id/respond', requireUser, (req, res) => {
    const r = db.get().studyRequests.find((x) => x.id === req.params.id);
    if (!r) return bad(res, 'Request not found', 404);
    if (r.to !== req.uid) return bad(res, 'Only the recipient can respond', 403);
    if (r.status !== 'pending') return bad(res, 'Request already answered', 409);
    respond(r, Boolean(req.body.accept));
    res.json(decorateRequest(r, req.uid));
  });

  app.post('/api/study/requests/:id/complete', requireUser, (req, res) => {
    const user = req.uid;
    const r = db.get().studyRequests.find((x) => x.id === req.params.id);
    if (!r) return bad(res, 'Request not found', 404);
    if (r.from !== user && r.to !== user) return bad(res, 'Not your session', 403);
    if (r.status !== 'accepted') return bad(res, 'Session is not active', 409);
    r.status = 'done';
    r.completedAt = clock.now();
    r.helpful = req.body.helpful == null ? null : Boolean(req.body.helpful);
    const booking = r.bookingId && db.get().bookings.find((b) => b.id === r.bookingId);
    if (booking && booking.end > r.completedAt) booking.end = r.completedAt; // release the room early
    db.save();
    emit('study:update');
    res.json(decorateRequest(r, user));
  });

  // ---------- Ask Pulse ----------
  app.post('/api/ask', (req, res) => {
    const q = str(req.body.q, 200);
    if (!q) return bad(res, 'Ask something');
    const now = clock.now();
    res.json(
      answer(q, {
        now,
        levelAt: (place, ts) => {
          const e = localParts(ts).hour >= place.openHours[0] && localParts(ts).hour < place.openHours[1] ? expectedAt(place, ts) : null;
          return { level: e ? round1(e.level) : null, label: e ? LEVEL_LABELS[Math.round(e.level)] : null };
        },
        rooms: roomsNow,
        meals: () => mealsView(now, req.uid).flatMap((m) => m.perMess),
      })
    );
  });

  // ---------- Impact ----------
  app.get('/api/impact', (_req, res) => {
    const state = db.get();
    const now = clock.now();
    const resolved = state.issues.filter((i) => i.resolvedAt);
    const hours = resolved.map((i) => (i.resolvedAt - i.createdAt) / HOUR).sort((a, b) => a - b);
    const weekAgo = now - 7 * 86_400_000;
    const weekReports = state.reports.filter((r) => r.ts >= weekAgo && r.ts <= now);
    const t = [...getTrust().values()];
    res.json({
      study: studyStats(state),
      issues: {
        total: state.issues.length,
        open: state.issues.filter((i) => i.status === 'open').length,
        inProgress: state.issues.filter((i) => i.status === 'in_progress').length,
        resolved: resolved.length,
        verified: resolved.filter((i) => verificationState(i, now)?.verified).length,
        reopened: state.issues.filter((i) => i.reopenCount).length,
        overdue: state.issues.filter((i) => slaState(i, now)?.escalation > 0).length,
        medianResolutionHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)]) : null,
        energyReports: state.issues.filter((i) => i.category === 'energy').length,
      },
      crowd: {
        reportsThisWeek: weekReports.length,
        placesTracked: PLACES.length,
        reporters: t.length,
        lowTrustReporters: t.filter((x) => x.trust < 0.5 && x.reports >= 10).length,
      },
      food: { ...wasteAvoided(state.mealOptOuts, getProfiles(), now), optOutsThisWeek: state.mealOptOuts.filter((o) => o.ts >= weekAgo).length },
      energy: energyStats(weekAgo),
      timetable: { classes: TIMETABLE.classes.length, rooms: TIMETABLE.rooms.length },
    });
  });

  return app;
}
