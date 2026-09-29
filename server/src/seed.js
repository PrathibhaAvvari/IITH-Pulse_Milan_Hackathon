// Demo data generator. Everything produced here is SIMULATED so the app has
// something to show on first run. Replace with real reports as students use it.
import { PLACES } from './places.js';
import { COURSES, BRANCHES } from './study.js';
import { TZ_OFFSET_MIN, localParts, localDate } from './forecast.js';
import { TIMETABLE, roomStatus, wasteEstimate } from './campus.js';
import { MESSES, nextMeals } from './mess.js';
import * as db from './db.js';
import { fileURLToPath } from 'node:url';

// Deterministic PRNG so every team member sees the same demo data.
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const gauss = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Typical crowd level (1-5) for a place type at a weekday/hour. */
export function typicalLevel(type, dow, h) {
  const weekend = dow === 0 || dow === 6;
  let v;
  switch (type) {
    case 'mess':
      v = weekend
        ? 1 + 3.2 * gauss(h, 10, 1.2) + 3.4 * gauss(h, 13.5, 1) + 3.8 * gauss(h, 20.5, 1)
        : 1 + 3.4 * gauss(h, 8, 0.8) + 3.8 * gauss(h, 13, 0.7) + 3.9 * gauss(h, 20, 0.8);
      break;
    case 'library':
      v = 1 + (weekend ? 2.2 : 2.8) * gauss(h, 16, 2.5) + 3.2 * gauss(h, 22, 1.8);
      break;
    case 'academic':
      v = weekend ? 1.2 : 1 + 3.2 * gauss(h, 11, 2) + 2.6 * gauss(h, 15.5, 1.5);
      break;
    case 'gym':
      v = 1 + 2.4 * gauss(h, 6.8, 0.8) + 3.6 * gauss(h, 19, 1.3);
      break;
    case 'sports':
      v = 1 + 3.6 * gauss(h, 17.8, 1.2) + (weekend ? 2 * gauss(h, 8, 1.5) : 0);
      break;
    case 'cafe':
      v = 1 + 2.2 * gauss(h, 13, 1) + 2.8 * gauss(h, 17.5, 1.2) + 3.2 * gauss(h, 22.5, 1.2);
      break;
    case 'transport':
      v = weekend
        ? 1 + 2.6 * gauss(h, 11, 1.5) + 3 * gauss(h, 19, 1.5)
        : 1 + 2 * gauss(h, 8.5, 1) + 2.4 * gauss(h, 17.5, 1.2);
      break;
    case 'health':
      v = 1 + 1.6 * gauss(h, 10, 1.5) + 1.2 * gauss(h, 18, 1.5);
      break;
    default:
      v = 2;
  }
  return clamp(v, 1, 5);
}

/** Timestamp of a campus-local hour on the same local day as `ts`. */
function atLocalHour(ts, hour, minute = 0) {
  const date = localDate(ts);
  return Date.parse(`${date}T00:00:00Z`) - TZ_OFFSET_MIN * 60_000 + (hour * 60 + minute) * 60_000;
}

const ISSUE_SEED = [
  ['Water cooler not cooling', 'The water cooler near the entrance only gives warm water since Monday.', 'water', 'dh1', 14, 'open'],
  ['Lights left on in empty classrooms', 'Lights and fans stay on in LHC rooms after 8 PM when nobody is there.', 'energy', 'lhc', 21, 'open'],
  ['Wi-Fi drops every few minutes', 'Second floor reading area keeps disconnecting from the campus network.', 'wifi', 'lib', 32, 'in_progress'],
  ['Treadmill belt slipping', 'Treadmill #3 belt slips at higher speeds - could hurt someone.', 'safety', 'gym', 9, 'open'],
  ['Broken chairs in reading hall', 'Four chairs with broken backrests in the quiet zone.', 'furniture', 'lib', 6, 'open'],
  ['Washroom tap leaking', 'Tap in the ground floor washroom leaks continuously, wasting water.', 'water', 'acad', 11, 'in_progress'],
  ['AC running with windows open', 'Seminar room AC is on full while windows are open all day.', 'energy', 'acad', 8, 'open'],
  ['Garbage bins overflowing', 'Bins near the food court overflow by evening and attract dogs.', 'cleanliness', 'food', 17, 'open'],
  ['Floodlight not working', 'One floodlight at the football ground is off, evening games are hard.', 'electrical', 'sports', 12, 'resolved'],
  ['Shuttle shelter roof leaking', 'Roof of the shuttle stop leaks when it rains.', 'other', 'shuttle', 5, 'resolved'],
  ['Projector flickering', 'Projector in the big lecture hall flickers during classes.', 'electrical', 'lhc', 15, 'resolved'],
  ['Plates not cleaned properly', 'Some plates have leftover residue at the dish counter.', 'cleanliness', 'dh2', 19, 'resolved'],
];

// Simulated reporters. Most are honest (report the true level +- noise); a few are trolls who
// report at random, so the trust model has something to find.
export const DEMO_REPORTERS = Array.from({ length: 80 }, (_, i) => `demo-u${i}`);
export const DEMO_TROLLS = new Set(['demo-u3', 'demo-u17', 'demo-u42', 'demo-u66']);

export function generateDemo(now = Date.now()) {
  const rand = rng(2026);
  const DAYS = 28;
  const reports = [];

  // 1) Four weeks of crowd reports following realistic daily rhythms + noise.
  for (let d = DAYS; d >= 0; d--) {
    const dayTs = now - d * 86_400_000;
    const { dow } = localParts(dayTs);
    for (const place of PLACES) {
      const [open, close] = place.openHours;
      for (let h = open; h < close; h++) {
        const n = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const minute = Math.floor(rand() * 60);
          const base = typicalLevel(place.type, dow, h + minute / 60);
          const user = DEMO_REPORTERS[Math.floor(rand() * DEMO_REPORTERS.length)];
          const level = DEMO_TROLLS.has(user) ? 1 + Math.floor(rand() * 5) : clamp(Math.round(base + (rand() - 0.5) * 1.4), 1, 5);
          const ts = atLocalHour(dayTs, h, minute);
          if (ts > now) continue; // today: only up to the current time
          reports.push({ id: `r${reports.length}`, placeId: place.id, level, ts, user });
        }
      }
    }
  }

  // 2) Issues.
  const issues = ISSUE_SEED.map(([title, description, category, placeId, upvotes, status], i) => {
    const createdAt = now - (1 + rand() * 9) * 86_400_000;
    const resolvedAt = status === 'resolved' ? createdAt + (6 + rand() * 40) * 3_600_000 : null;
    return {
      id: `i${i + 1}`,
      title,
      description,
      category,
      placeId,
      status,
      upvotes,
      voters: [],
      reporter: 'demo',
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
      resolvedAt,
    };
  });

  // 3) Study Match: demo student profiles + past completed sessions.
  const { studyProfiles, studyRequests } = demoStudy(now, rand);

  // 4) Energy audits: a few verified "AC on in an empty room" answers over the last week.
  const energyAudits = [];
  for (let d = 1; energyAudits.length < 9 && d <= 14; d++) {
    const ts = atLocalHour(now - d * 86_400_000, 13 + Math.floor(rand() * 5), 30);
    const room = roomStatus(ts).find((r) => r.state === 'free' && rand() < 0.5);
    if (!room) continue;
    const est = wasteEstimate(room, Math.min(3, (room.freeUntil - ts) / 3_600_000));
    energyAudits.push({ id: `e${energyAudits.length + 1}`, roomId: room.id, placeId: room.placeId, ts, user: DEMO_REPORTERS[d], on: true, verified: true, kwh: est.kwh, inr: est.inr });
  }

  // 5) Meal opt-outs already made for the upcoming meals.
  const mealOptOuts = [];
  for (const [i, { meal, ts }] of nextMeals(now, 3).entries()) {
    const n = [38, 21, 12][i];
    for (let k = 0; k < n; k++) {
      mealOptOuts.push({ user: DEMO_REPORTERS[(k * 7 + i) % DEMO_REPORTERS.length], date: localDate(ts), meal, mess: MESSES[k % MESSES.length].id, ts: now - rand() * 6 * 3_600_000 });
    }
  }

  return { reports, issues, studyProfiles, studyRequests, energyAudits, mealOptOuts };
}

const DEMO_NAMES = [
  'Aarav', 'Diya', 'Kabir', 'Ananya', 'Rohan', 'Isha', 'Vivaan', 'Meera', 'Arjun', 'Sneha', 'Aditya', 'Pooja',
  'Karthik', 'Nisha', 'Siddharth', 'Riya', 'Harsha', 'Lakshmi', 'Nikhil', 'Divya', 'Rahul', 'Sanjana', 'Varun', 'Keerthi',
  'Aman', 'Priya', 'Tejas', 'Swathi', 'Manoj', 'Aishwarya', 'Yash', 'Bhavana', 'Rithvik', 'Tanvi', 'Sai', 'Neha',
];

// First-years mostly need core courses; seniors can teach them. Upper-level courses are scarcer.
const CORE = ['calc', 'linalg', 'physics', 'chem', 'drawing', 'python', 'mech'];
const ADVANCED = ['dsa', 'ml', 'prob', 'circuits', 'signals', 'thermo', 'fluids'];

function pick(arr, n, rand, exclude = []) {
  const pool = arr.filter((x) => !exclude.includes(x));
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

export function demoStudy(now = Date.now(), rand = rng(7)) {
  const all = COURSES.map((c) => c.id);
  const studyProfiles = DEMO_NAMES.map((name, i) => {
    const year = [1, 1, 1, 2, 2, 3, 3, 4, 5][Math.floor(rand() * 9)];
    const canHelp = year === 1 ? pick(CORE, 1 + Math.floor(rand() * 2), rand) : pick(rand() < 0.7 ? CORE : all, 2 + Math.floor(rand() * 2), rand);
    const needPool = year === 1 ? [...CORE, 'dsa', 'prob'] : ADVANCED;
    const needHelp = pick(needPool, 1 + Math.floor(rand() * 2), rand, canHelp);
    return {
      user: `demo-${i}`,
      name,
      year,
      branch: BRANCHES[Math.floor(rand() * (BRANCHES.length - 1))],
      canHelp,
      needHelp,
      available: rand() < 0.85,
      updatedAt: now - Math.floor(rand() * 10) * 86_400_000,
    };
  });

  const studyRequests = [];
  for (let k = 0; k < 600 && studyRequests.length < 64; k++) {
    const a = studyProfiles[Math.floor(rand() * studyProfiles.length)];
    const b = studyProfiles[Math.floor(rand() * studyProfiles.length)];
    if (a === b) continue;
    const learn = a.needHelp.find((c) => b.canHelp.includes(c));
    const teach = b.needHelp.find((c) => a.canHelp.includes(c));
    if (!learn && !teach) continue;
    const direction = learn && teach ? 'swap' : learn ? 'learn' : 'teach';
    const createdAt = now - (1 + rand() * 27) * 86_400_000;
    studyRequests.push({
      id: `s${studyRequests.length + 1}`,
      from: a.user,
      to: b.user,
      course: learn ?? teach,
      swapCourse: direction === 'swap' ? teach : null,
      direction,
      placeId: ['lib', 'food', 'acad', 'lhc'][Math.floor(rand() * 4)],
      message: '',
      status: 'done',
      helpful: rand() < 0.88,
      createdAt,
      respondedAt: createdAt + 20 * 60_000,
      completedAt: createdAt + 2 * 3_600_000,
    });
  }
  return { studyProfiles, studyRequests };
}

/** One simulated live report, following the typical pattern for "now". Used in demo mode. */
export function simulatedReport(now = Date.now()) {
  const open = PLACES.filter((p) => {
    const { hour } = localParts(now);
    return hour >= p.openHours[0] && hour < p.openHours[1];
  });
  if (!open.length) return null;
  const place = open[Math.floor(Math.random() * open.length)];
  const { dow, hour, minute } = localParts(now);
  const base = typicalLevel(place.type, dow, hour + minute / 60);
  const level = clamp(Math.round(base + (Math.random() - 0.5) * 1.2), 1, 5);
  const user = DEMO_REPORTERS[Math.floor(Math.random() * DEMO_REPORTERS.length)];
  return { placeId: place.id, level: DEMO_TROLLS.has(user) ? 1 + Math.floor(Math.random() * 5) : level, ts: now, user };
}

// CLI: `npm run seed` rewrites the database with fresh demo data.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');
  if (!force && !db.isEmpty()) {
    console.log('Database already has data. Use --force to overwrite.');
  } else {
    const data = generateDemo();
    db.replace(data);
    console.log(`Seeded ${data.reports.length} crowd reports, ${data.issues.length} issues, ${data.studyProfiles.length} study profiles, ${TIMETABLE.classes.length} timetabled classes -> ${db.DB_PATH}`);
  }
}
