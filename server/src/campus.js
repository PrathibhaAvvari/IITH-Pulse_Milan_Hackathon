// Timetable-driven campus model. From one timetable JSON (course, room, sessions, enrollment) it predicts
// room occupancy, crowd surges when classes let out, free rooms and energy waste - with zero taps.
// Pure functions (the timetable is a parameter with a default) so they are easy to unit test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACES } from './places.js';
import { localParts, localDate, dayStart } from './forecast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TIMETABLE_PATH = process.env.TIMETABLE_PATH || path.join(__dirname, '..', 'timetable.json');
export const TIMETABLE = JSON.parse(fs.readFileSync(TIMETABLE_PATH, 'utf8'));

const MIN = 60_000;
const DAY = 86_400_000;
const ATTENDANCE = 0.8; // share of enrolled students actually in class
export const TARIFF_INR_PER_KWH = Number(process.env.TARIFF_INR_PER_KWH ?? 9);
const placeById = new Map(PLACES.map((p) => [p.id, p]));

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** What kind of day is it? Drives classes, mess attendance and exam behaviour. */
export function dayKind(ts, tt = TIMETABLE) {
  const { holidays = [], examWeeks = [] } = tt.calendar ?? {};
  const off = (t) => holidays.includes(localDate(t)) || [0, 6].includes(localParts(t).dow);
  const date = localDate(ts);
  const { dow } = localParts(ts);
  const weekend = dow === 0 || dow === 6;
  const holiday = holidays.includes(date);
  const exam = examWeeks.some(([a, b]) => date >= a && date <= b);
  // Teaching segment (IITH splits the semester into 6). No segments listed -> always teaching.
  const segs = Object.entries(tt.calendar?.segments ?? {});
  const segment = segs.length ? Number(segs.find(([, [a, b]]) => date >= a && date <= b)?.[0]) || null : 0;
  let run = 0; // length of the run of consecutive off days containing today
  if (off(ts)) {
    run = 1;
    for (let d = 1; d <= 3 && off(ts - d * DAY); d++) run++;
    for (let d = 1; d <= 3 && off(ts + d * DAY); d++) run++;
  }
  return { date, dow, weekend, holiday, exam, segment, longWeekend: run >= 3, classes: !weekend && !holiday && !exam && segment !== null };
}

const sessionCache = new WeakMap(); // tt -> Map(date -> sessions)
/** All class sessions on the campus day containing `ts`, with absolute start/end. */
export function sessionsOn(ts, tt = TIMETABLE) {
  let cache = sessionCache.get(tt);
  if (!cache) sessionCache.set(tt, (cache = new Map()));
  const date = localDate(ts);
  if (cache.has(date)) return cache.get(date);
  const out = [];
  const kind = dayKind(ts, tt);
  if (kind.classes) {
    const rooms = new Map(tt.rooms.map((r) => [r.id, r]));
    const d0 = dayStart(ts);
    for (const c of tt.classes) {
      if (kind.segment && c.segment) {
        const [a, b] = c.segment.split('-').map(Number); // e.g. "3-6" runs in segments 3 to 6
        if (kind.segment < a || kind.segment > (b || a)) continue;
      }
      for (const [day, start, end] of c.sessions ?? tt.slots?.[c.slot] ?? []) {
        if (day !== kind.dow) continue;
        out.push({ ...c, placeId: rooms.get(c.room)?.placeId, start: d0 + toMin(start) * MIN, end: d0 + toMin(end) * MIN });
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  cache.set(date, out);
  return out;
}

// Where students go when a class ends, by time of day (share of the class).
// The rest head to their next class or hostel.
function destinations(endMin) {
  if (endMin >= 11 * 60 + 50 && endMin <= 14 * 60) return { dh1: 0.3, dh2: 0.25, food: 0.1, lib: 0.08 };
  if (endMin >= 17 * 60 && endMin <= 18 * 60 + 30) return { food: 0.2, sports: 0.15, gym: 0.08, lib: 0.1, shuttle: 0.05 };
  return { food: 0.08, lib: 0.06 };
}
const DWELL_MIN = { mess: 25, cafe: 20, library: 90, sports: 60, gym: 60, transport: 10 };
const walkMin = (a, b) => Math.round(3 + Math.hypot(a.x - b.x, a.y - b.y) * 0.15);

const flowCache = new WeakMap(); // tt -> Map(date -> flows)
/** People flows from every class ending on that day: who goes where, arriving when, staying how long. */
export function flows(ts, tt = TIMETABLE) {
  let cache = flowCache.get(tt);
  if (!cache) flowCache.set(tt, (cache = new Map()));
  const date = localDate(ts);
  if (cache.has(date)) return cache.get(date);
  const out = [];
  for (const s of sessionsOn(ts, tt)) {
    const from = placeById.get(s.placeId);
    if (!from) continue;
    const leaving = Math.round(s.enrollment * ATTENDANCE);
    for (const [pid, share] of Object.entries(destinations((s.end - dayStart(s.end)) / MIN))) {
      const to = placeById.get(pid);
      const arrive = s.end + walkMin(from, to) * MIN;
      out.push({ placeId: pid, people: Math.round(leaving * share), arrive, leave: arrive + DWELL_MIN[to.type] * MIN, source: s });
    }
  }
  cache.set(date, out);
  return out;
}

/**
 * Timetable-only estimate for a place at `ts`: students in class (academic buildings)
 * or students who just walked over from a class (mess, library, ...). null if nothing predicted.
 */
export function timetableEstimate(place, ts, tt = TIMETABLE) {
  let people = 0;
  const reasons = [];
  if (place.type === 'academic') {
    for (const s of sessionsOn(ts, tt)) {
      if (s.placeId !== place.id || ts < s.start || ts >= s.end) continue;
      people += Math.round(s.enrollment * ATTENDANCE);
      reasons.push(`${s.course} in ${s.room}`);
    }
  } else {
    for (const f of flows(ts, tt)) {
      if (f.placeId !== place.id || ts < f.arrive || ts >= f.leave) continue;
      people += f.people;
      reasons.push(`${f.source.course} let out of ${f.source.room}`);
    }
  }
  if (!people) return null;
  return { people, level: Math.min(5, 1 + (4 * people) / place.capacity), reasons };
}

/**
 * Crowd surges in the next `horizonMin` minutes, grouped per destination and class-exit time:
 * "580 students leave LHC at 12:55 -> +174 at Dining Hall 1 at 1:05".
 */
export function upcomingSurges(now, horizonMin = 180, tt = TIMETABLE) {
  const groups = new Map();
  for (const f of [...flows(now, tt), ...flows(now + DAY, tt)]) {
    if (f.arrive < now - 5 * MIN || f.arrive > now + horizonMin * MIN) continue;
    const key = `${f.placeId}|${f.source.placeId}|${f.source.end}`;
    let g = groups.get(key);
    if (!g) {
      g = { placeId: f.placeId, fromPlaceId: f.source.placeId, leaveAt: f.source.end, at: f.arrive, people: 0, leaving: 0, classes: [] };
      groups.set(key, g);
    }
    g.people += f.people;
    g.leaving += Math.round(f.source.enrollment * ATTENDANCE);
    g.classes.push(`${f.source.course} (${f.source.room})`);
  }
  return [...groups.values()]
    .filter((g) => g.people >= 25)
    .map((g) => ({ ...g, pctOfCapacity: Math.round((100 * g.people) / placeById.get(g.placeId).capacity) }))
    .sort((a, b) => a.at - b.at || b.people - a.people);
}

/**
 * Status of every room at `ts`: in class, booked (Study Match), reported occupied, closed or free (and until when).
 * `reports` are room reports { roomId, busy, ts }, `bookings` { roomId, start, end }.
 */
export function roomStatus(ts, { reports = [], bookings = [] } = {}, tt = TIMETABLE) {
  const today = sessionsOn(ts, tt);
  const d0 = dayStart(ts);
  const { hour } = localParts(ts);
  return tt.rooms.map((room) => {
    const place = placeById.get(room.placeId);
    const [openH, closeH] = place?.openHours ?? [8, 20];
    const mine = today.filter((s) => s.room === room.id);
    const current = mine.find((s) => s.start <= ts && ts < s.end);
    const next = mine.find((s) => s.start > ts);
    const booking = bookings.find((b) => b.roomId === room.id && b.start <= ts && ts < b.end);
    let lastReport = null;
    for (const r of reports) if (r.roomId === room.id && r.ts <= ts && ts - r.ts < 30 * MIN && (!lastReport || r.ts > lastReport.ts)) lastReport = r;
    const closed = hour < openH || hour >= closeH;
    const state = closed ? 'closed' : current ? 'class' : booking ? 'booked' : lastReport?.busy ? 'occupied' : 'free';
    const nextBooking = bookings.filter((b) => b.roomId === room.id && b.start > ts).sort((a, b) => a.start - b.start)[0];
    const freeUntil = state === 'free' ? Math.min(next?.start ?? Infinity, nextBooking?.start ?? Infinity, d0 + closeH * 60 * MIN) : null;
    return {
      ...room,
      placeName: place?.name ?? room.placeId,
      state,
      current: current ? { course: current.course, name: current.name, end: current.end } : null,
      nextClass: next ? { course: next.course, start: next.start } : null,
      freeUntil,
      verifiedAt: state === 'free' && lastReport ? lastReport.ts : null,
      bookedUntil: booking?.end ?? null,
    };
  });
}

/** Power drawn by a room's AC + lights, and the cost of leaving it on for `hours`. */
export function wasteEstimate(room, hours) {
  const kw = (room.acKw ?? room.seats * 0.06) + room.seats * 0.012;
  const kwh = kw * hours;
  return { kw: Math.round(kw * 10) / 10, hours: Math.round(hours * 10) / 10, kwh: Math.round(kwh), inr: Math.round(kwh * TARIFF_INR_PER_KWH) };
}

/**
 * Herd-aware suggestion. `candidates` are open places sorted quietest first, each with
 * { id, capacity, occupancyEstimate }. `sentNow(placeId)` = students already sent there "now" recently.
 * If everyone we sent might show up, would the place overflow? Then send this student to the
 * next place with room, or stagger them to "in 20 min".
 */
export const HERD = { comply: 0.6, fill: 0.5, delayMin: 20 };
export function staggered(candidates, sentNow) {
  for (const p of candidates) {
    const headroom = HERD.fill * p.capacity - (p.occupancyEstimate ?? 0) - HERD.comply * sentNow(p.id);
    if (headroom >= 1) return { place: p, when: 'now', delayMin: 0 };
  }
  return candidates[0] ? { place: candidates[0], when: 'later', delayMin: HERD.delayMin } : null;
}
