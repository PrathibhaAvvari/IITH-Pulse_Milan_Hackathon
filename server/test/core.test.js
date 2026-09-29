import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(os.tmpdir(), `pulse-test-${process.pid}.json`);

const { buildProfiles, liveLevel, forecastAt, upcoming } = await import('../src/forecast.js');
const { findSimilar, priority, slaState, recordVerification, verificationState } = await import('../src/issues.js');
const { dayKind, timetableEstimate, upcomingSurges, roomStatus, staggered } = await import('../src/campus.js');
const { mealForecast, MESSES } = await import('../src/mess.js');
const { reliabilities, NEW_USER_TRUST } = await import('../src/trust.js');
const { signSession, verifySession, verifyGoogle } = await import('../src/auth.js');
const { parseQuestion } = await import('../src/ask.js');
const { PLACES } = await import('../src/places.js');
const { matchesFor, courseDemand } = await import('../src/study.js');
const { generateDemo } = await import('../src/seed.js');
const db = await import('../src/db.js');
const { createApp } = await import('../src/app.js');

const HOUR = 3_600_000;
const MON_1250 = Date.parse('2026-09-28T12:50:00+05:30'); // Monday of segment 4, real IITH Jul-Nov 2026 timetable
// Small fixed timetable for pure logic tests, so they don't break when the real timetable is re-imported.
const TT = {
  calendar: {},
  rooms: [
    { id: 'R-BIG', placeId: 'lhc', seats: 300 },
    { id: 'R-MID', placeId: 'lhc', seats: 120 },
    { id: 'R-SMALL', placeId: 'acad', seats: 40 },
    { id: 'R-REP', placeId: 'acad', seats: 60 },
    { id: 'R-BOOK', placeId: 'acad', seats: 40 },
  ],
  classes: [
    { course: 'MA1110', room: 'R-BIG', enrollment: 300, sessions: [[1, '12:00', '12:55']] },
    { course: 'CS3390', room: 'R-MID', enrollment: 100, sessions: [[1, '14:30', '15:55']] },
  ],
};
const place = (id) => PLACES.find((p) => p.id === id);

test('live level falls back to forecast when there are no recent reports', () => {
  const now = Date.now();
  const reports = [0, 1, 2].map((w) => ({ placeId: 'x', level: 4, ts: now - (w + 1) * 7 * 24 * HOUR }));
  const profiles = buildProfiles(reports);
  const live = liveLevel(reports, profiles, 'x', now);
  assert.equal(live.source, 'forecast');
  assert.equal(live.level, 4);
});

test('recent reports dominate, but the prior damps a single outlier', () => {
  const now = Date.now();
  const history = [1, 2, 3].map((w) => ({ placeId: 'x', level: 1, ts: now - w * 7 * 24 * HOUR }));
  const one = [...history, { placeId: 'x', level: 5, ts: now - 60_000 }];
  const many = [...one, ...[2, 3, 4, 5].map((m) => ({ placeId: 'x', level: 5, ts: now - m * 60_000 }))];
  const p = buildProfiles(history);
  const single = liveLevel(one, p, 'x', now).level;
  const crowd = liveLevel(many, p, 'x', now).level;
  assert.ok(single > 1 && single < 5, `single outlier damped (${single})`);
  assert.ok(crowd > single, 'more agreeing reports push the level further');
});

test('best time picks the quietest open hour', () => {
  const now = Date.parse('2026-09-28T06:30:00Z'); // 12:00 IST
  const reports = [];
  for (let w = 1; w <= 3; w++) {
    for (let h = 0; h < 8; h++) {
      reports.push({ placeId: 'x', level: h === 3 ? 1 : 4, ts: now - w * 7 * 24 * HOUR + h * HOUR });
    }
  }
  const p = buildProfiles(reports);
  const { best } = upcoming(p, { id: 'x', openHours: [0, 24] }, now, 7);
  assert.equal(best.level, 1);
  assert.ok(forecastAt(p, 'x', best.ts));
});

test('duplicate detection finds the matching open issue', () => {
  const issues = [
    { id: '1', title: 'Water cooler not cooling', description: 'warm water', category: 'water', placeId: 'dh1', status: 'open' },
    { id: '2', title: 'Wi-Fi drops', description: 'library network', category: 'wifi', placeId: 'lib', status: 'open' },
  ];
  const sim = findSimilar(issues, { title: 'cooler water is warm', placeId: 'dh1', category: 'water' });
  assert.equal(sim[0]?.id, '1');
});

test('priority grows with votes and ignores resolved issues', () => {
  const base = { category: 'water', createdAt: Date.now(), status: 'open', upvotes: 1 };
  assert.ok(priority({ ...base, upvotes: 10 }) > priority(base));
  assert.equal(priority({ ...base, status: 'resolved' }), 0);
});

test('study matching ranks two-way swaps first', () => {
  const me = { user: 'me', canHelp: ['calc'], needHelp: ['dsa'] };
  const profiles = [
    me,
    { user: 'mentor', canHelp: ['dsa'], needHelp: [], available: true },
    { user: 'swap', canHelp: ['dsa'], needHelp: ['calc'], available: true },
    { user: 'none', canHelp: ['thermo'], needHelp: ['ml'], available: true },
    { user: 'away', canHelp: ['dsa'], needHelp: ['calc'], available: false },
  ];
  const m = matchesFor(me, profiles);
  assert.deepEqual(m.map((x) => x.user), ['swap', 'mentor']);
  assert.equal(m[0].kind, 'swap');
});

test('course demand highlights courses with few helpers', () => {
  const d = courseDemand([
    { canHelp: ['calc'], needHelp: ['ml'] },
    { canHelp: ['calc'], needHelp: ['ml'] },
    { canHelp: [], needHelp: ['ml', 'calc'] },
  ]);
  assert.equal(d[0].id, 'ml');
  assert.equal(d[0].need, 3);
});

test('timetable: class exit at 12:55 predicts a dining hall surge with zero taps', () => {
  const surge = upcomingSurges(MON_1250, 60, TT).find((x) => x.placeId === 'dh1' && x.fromPlaceId === 'lhc');
  assert.ok(surge, 'LHC -> Dining Hall 1 surge predicted');
  assert.equal(surge.leaveAt, Date.parse('2026-09-28T12:55:00+05:30'));
  assert.ok(surge.at > surge.leaveAt && surge.people === Math.round(240 * 0.3));
  // cold start: no reports at all, the timetable alone gives a level
  const est = timetableEstimate(place('lhc'), MON_1250 - 20 * 60_000, TT);
  assert.ok(est.level > 1 && est.reasons.some((r) => r.includes('MA1110')));
  const live = liveLevel([], new Map(), 'lhc', MON_1250, { prior: est });
  assert.equal(live.level, Math.round(est.level * 10) / 10);
});

test('real IITH calendar + timetable: segments, holidays, exams, the Monday 12:55 exit', () => {
  const day = (d) => dayKind(Date.parse(`${d}T12:00:00+05:30`));
  assert.equal(day('2026-10-03').longWeekend, true, 'Gandhi Jayanti Friday');
  assert.equal(day('2026-10-21').classes, false, 'Dussehra break');
  assert.equal(day('2026-11-16').exam, true);
  assert.equal(day('2026-11-25').classes, false, 'after the last segment');
  assert.equal(dayKind(MON_1250).segment, 4);
  const surge = upcomingSurges(MON_1250, 60).find((x) => x.placeId === 'dh1' && x.fromPlaceId === 'lhc');
  assert.ok(surge?.people > 100, 'real classes let out of LHC at 12:55');
});

test('mess forecast: opt-outs and long weekends lower the headcount, cook-for covers the forecast', () => {
  const mess = MESSES[0];
  const normal = mealForecast({ mess, meal: 'dinner', ts: MON_1250 });
  const skipped = mealForecast({ mess, meal: 'dinner', ts: MON_1250, optOuts: 50 });
  const longWeekend = mealForecast({ mess, meal: 'dinner', ts: Date.parse('2026-10-03T12:00:00+05:30') });
  assert.ok(skipped.expected < normal.expected);
  assert.ok(longWeekend.expected < normal.expected * 0.7);
  assert.ok(normal.cookFor > normal.expected && normal.cookFor <= normal.usual);
  assert.ok(longWeekend.kgSaved > normal.kgSaved);
});

test('trust: trolls lose weight, a fresh spam account barely moves the level', () => {
  const reports = [];
  const t0 = Date.parse('2026-09-20T10:00:00Z');
  for (let k = 0; k < 60; k++) {
    const ts = t0 + k * HOUR;
    for (const u of ['h1', 'h2', 'h3']) reports.push({ placeId: 'x', level: 2, ts: ts + reports.length * 1000, user: u });
    reports.push({ placeId: 'x', level: 5, ts: ts + 5000, user: 'troll' });
  }
  const rel = reliabilities(reports);
  assert.ok(rel.get('h1').trust > 0.8 && rel.get('troll').trust < 0.2, JSON.stringify([...rel]));
  const now = t0 + 60 * HOUR;
  const live = [{ placeId: 'lib', level: 2, ts: now - 60_000, user: 'h1' }, { placeId: 'lib', level: 2, ts: now - 120_000, user: 'h2' }];
  const weightOf = (u) => (rel.get(u)?.trust ?? NEW_USER_TRUST) ** 2; // same as app.js
  const before = liveLevel(live, new Map(), 'lib', now, { weightOf, prior: { level: 2 } }).level;
  const spam = [...live, ...Array.from({ length: 5 }, (_, i) => ({ placeId: 'lib', level: 5, ts: now - i * 1000, user: 'fresh' }))];
  const after = liveLevel(spam, new Map(), 'lib', now, { weightOf, prior: { level: 2 } }).level;
  assert.ok(after - before < 0.2, `spam moved ${before} -> ${after}`);
  // no live reports at all: spam against the forecast alone must not flip the label either
  const alone = liveLevel(spam.filter((r) => r.user === 'fresh'), new Map(), 'lib', now, { weightOf, prior: { level: 2 } }).level;
  assert.ok(alone < 2.5, `spam alone moved 2 -> ${alone}`);
});

test('free rooms: timetable, crowd reports and bookings', () => {
  const ts = MON_1250 - 20 * 60_000;
  const rooms = roomStatus(ts, { reports: [{ roomId: 'R-REP', busy: true, ts: ts - 60_000 }], bookings: [{ roomId: 'R-BOOK', start: ts - 1, end: ts + HOUR }] }, TT);
  const by = Object.fromEntries(rooms.map((r) => [r.id, r]));
  assert.equal(by['R-BIG'].state, 'class');
  assert.equal(by['R-REP'].state, 'occupied');
  assert.equal(by['R-BOOK'].state, 'booked');
  assert.equal(by['R-MID'].state, 'free');
  assert.equal(by['R-MID'].freeUntil, Date.parse('2026-09-28T14:30:00+05:30')); // CS3390 at 14:30
});

test('herd: once a place would overflow, students are staggered', () => {
  const lib = { id: 'lib', capacity: 400, occupancyEstimate: 100 };
  const sent = { lib: 0 };
  const whens = [];
  for (let i = 0; i < 300; i++) {
    const s = staggered([lib], (id) => sent[id]);
    if (s.when === 'now') sent.lib++;
    whens.push(s.when);
  }
  assert.equal(whens[0], 'now');
  assert.equal(whens.at(-1), 'later');
  assert.ok(sent.lib > 100 && sent.lib < 200);
});

test('fixes: disputes reopen, confirmations verify, SLA escalates', () => {
  const now = Date.now();
  const issue = { category: 'safety', status: 'resolved', createdAt: now - 10 * HOUR, resolvedAt: now, voters: ['a', 'b', 'c'], upvotes: 3 };
  assert.equal(recordVerification(issue, 'a', true, now), 'recorded');
  assert.equal(recordVerification(issue, 'b', true, now), 'verified');
  const other = { ...issue, verify: null, status: 'resolved', resolvedAt: now };
  assert.equal(recordVerification(other, 'a', false, now), 'reopened');
  assert.equal(other.status, 'open');
  assert.equal(verificationState(other, now), null);
  assert.equal(slaState({ ...other, reopenedAt: now - 30 * HOUR }, now).escalation, 1); // safety SLA 24 h
  assert.equal(slaState({ ...other, reopenedAt: now - 60 * HOUR }, now).escalation, 2);
});

test('auth: session tokens are tamper-proof, only the IITH domain gets in', async () => {
  const token = signSession({ id: 'g:1', email: 'cs21@iith.ac.in' });
  assert.equal(verifySession(token).id, 'g:1');
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ id: 'g:1', admin: true, exp: Date.now() + HOUR })).toString('base64url');
  assert.equal(verifySession(`${forged}.${sig}`), null);
  assert.equal(verifySession(`${body}.x`), null);
  const google = (claims) => async () => ({ ok: true, json: async () => ({ aud: 'cid', iss: 'accounts.google.com', email_verified: 'true', sub: '42', ...claims }) });
  const ok = await verifyGoogle('t', { clientId: 'cid', domain: 'iith.ac.in', fetchImpl: google({ email: 'ai22btech1@iith.ac.in', hd: 'iith.ac.in' }) });
  assert.equal(ok.id, 'g:42');
  await assert.rejects(verifyGoogle('t', { clientId: 'cid', domain: 'iith.ac.in', fetchImpl: google({ email: 'x@gmail.com' }) }), /iith\.ac\.in/);
  await assert.rejects(verifyGoogle('t', { clientId: 'cid', domain: 'iith.ac.in', fetchImpl: google({ email: 'x@iith.ac.in', hd: 'iith.ac.in', aud: 'evil' }) }));
});

test('ask: parses place, time and intent', () => {
  const q = parseQuestion('Quiet room with free seats near LHC after 4?', MON_1250);
  assert.equal(q.intent, 'room');
  assert.equal(q.placeId, 'lhc');
  assert.equal(q.ts, Date.parse('2026-09-28T16:00:00+05:30'));
  assert.equal(parseQuestion('how many people at dinner tonight', MON_1250).intent, 'mess');
});

test('API: report, issue, upvote, admin, study match', async () => {
  db.replace(generateDemo());
  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}/api`;
  const post = (url, body, headers = {}) =>
    fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const pulse = await (await fetch(`${base}/pulse`)).json();
    assert.equal(pulse.places.length, 10);

    assert.equal((await post('/reports', { placeId: 'lib', level: 4, user: 't1' })).status, 201);
    assert.equal((await post('/reports', { placeId: 'lib', level: 4, user: 't1' })).status, 429, 'anti-flood rate limit');
    assert.equal((await post('/reports', { placeId: 'lib', level: 9, user: 't2' })).status, 400);
    const spam = await (await post('/reports', { placeId: 'food', level: 5, user: 'fresh-spammer' })).json();
    assert.ok(spam.place.live.level - spam.before < 0.2, `spam moved ${spam.before} -> ${spam.place.live.level}`);

    const created = await (await post('/issues', { title: 'Fan making noise', category: 'electrical', placeId: 'lib', user: 't1' })).json();
    assert.equal(created.upvotes, 1);
    const voted = await (await post(`/issues/${created.id}/upvote`, { user: 't2' })).json();
    assert.equal(voted.upvotes, 2);

    const noPin = await fetch(`${base}/issues/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"status":"resolved"}' });
    assert.equal(noPin.status, 401);
    const ok = await fetch(`${base}/issues/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-pin': 'iith2026' },
      body: '{"status":"resolved"}',
    });
    assert.equal((await ok.json()).status, 'resolved');
    assert.equal((await post(`/issues/${created.id}/verify`, { user: 'stranger', fixed: false })).status, 403, 'only upvoters verify');
    const disputed = await (await post(`/issues/${created.id}/verify`, { user: 't2', fixed: false })).json();
    assert.equal(disputed.outcome, 'reopened');

    const mess = await (await fetch(`${base}/mess`)).json();
    const m = mess.meals.find((x) => x.open);
    if (m) {
      const after = await (await post('/mess/optout', { user: 't1', meal: m.meal, date: m.date, mess: 'dh1' })).json();
      assert.equal(after.total.optOuts, m.total.optOuts + 1);
      assert.equal(after.mine, 'dh1');
    }

    const put = (url, body) => fetch(base + url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await put('/study/profile', { user: 'a', name: 'Asha', year: 1, branch: 'CSE', canHelp: ['calc'], needHelp: ['dsa'] })).status, 200);
    assert.equal((await put('/study/profile', { user: 'b', name: 'Bala', year: 3, branch: 'EE', canHelp: ['dsa'], needHelp: ['calc'] })).status, 200);
    const { matches, spot } = await (await fetch(`${base}/study/matches?user=a`)).json();
    assert.equal(matches[0].user, 'b');
    assert.equal(matches[0].kind, 'swap');
    if (spot) assert.ok(spot.placeId, 'suggests a quiet study spot'); // null at night when all study spots are closed
    const reqRes = await post('/study/requests', { user: 'a', to: 'b' });
    assert.equal(reqRes.status, 201);
    const sreq = await reqRes.json();
    assert.equal((await post('/study/requests', { user: 'a', to: 'b' })).status, 409, 'no duplicate requests');
    assert.equal((await post(`/study/requests/${sreq.id}/respond`, { user: 'a', accept: true })).status, 403, 'only recipient responds');
    assert.equal((await (await post(`/study/requests/${sreq.id}/respond`, { user: 'b', accept: true })).json()).status, 'accepted');
    assert.equal((await (await post(`/study/requests/${sreq.id}/complete`, { user: 'a', helpful: true })).json()).status, 'done');

    const impact = await (await fetch(`${base}/impact`)).json();
    assert.ok(impact.study.sessionsDone > 0);
  } finally {
    server.close();
  }
});

test('timetable importer: messy room cells, timings, cross-listed courses', async () => {
  const { parseRoom, parseTimings, convert } = await import('../scripts/import-timetable.mjs');
  assert.deepEqual(parseRoom('LHC-07-Capacity:200'), { id: 'LHC-07', seats: 200 });
  assert.deepEqual(parseRoom('CSE-LH-01 (Capacity - 70)'), { id: 'CSE-LH-01', seats: 70 });
  assert.deepEqual(parseRoom('CHE-118 Class Room 118-Capacity-84'), { id: 'CHE-118', seats: 84 });
  assert.deepEqual(parseRoom('EE-002(GF) (80)'), { id: 'EE-002', seats: 80 });
  assert.equal(parseRoom('Not Required classroom'), null);
  assert.deepEqual(parseTimings('Monday-11:01-11:55,Wednesday-14:30-15:29'), [[1, '11:00', '11:55'], [3, '14:30', '15:29']]);
  const row = (code, n) => ({ 'Course Code': code, 'Course Name': 'X', 'Registered Students Count': String(n), 'Segment Name': '1-6', 'Course Slot Code': 'C_JUL26-NOV26', 'Class Timings': 'Monday-11:01-11:55', 'Room No.': 'LHC-03-Capacity:120' });
  const { classes } = convert([row('EE1030', 80), row('EE2100', 60)]);
  assert.equal(classes.length, 1);
  assert.equal(classes[0].course, 'EE1030/EE2100');
  assert.equal(classes[0].enrollment, 120, 'capped at room capacity');
});

test('security: write rate limit, PIN guessing limit, CORS allow-list, headers, no user IDs leaked', async () => {
  db.replace(generateDemo());
  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}/api`;
  const post = (url, body, headers = {}) =>
    fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const res = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'other sites get no CORS grant');
    assert.ok(res.headers.get('content-security-policy'), 'helmet headers');
    const local = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');

    assert.equal((await post('/admin/verify', { pin: 'iith2026' })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await post('/admin/verify', { pin: `guess${i}` })).status, 401);
    assert.equal((await post('/admin/verify', { pin: 'guess6' })).status, 429, 'locked out after 5 wrong PINs');
    const header = await fetch(`${base}/issues/i1`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-admin-pin': 'nope' }, body: '{}' });
    assert.equal(header.status, 429, 'PIN guesses via the header count too');

    const issues = await (await fetch(`${base}/issues?status=all`)).json();
    assert.ok(issues.every((i) => i.reporter === undefined && i.voters === undefined), 'no reporter/voter IDs in the issue list');

    const codes = [];
    for (let i = 0; i < 32; i++) codes.push((await post('/ask', { q: 'how busy is the gym' })).status);
    assert.equal(codes.filter((c) => c === 429).length > 0, true, 'writes are rate limited');
    assert.equal(codes[0], 200);
  } finally {
    server.close();
  }
});
