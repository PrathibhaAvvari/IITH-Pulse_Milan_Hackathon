// "Ask Pulse": rule-based natural-language box answered from the other modules.
// e.g. "Quiet room with free seats near LHC after 4?" -> free rooms at 16:00 near LHC + library forecast.
import { PLACES } from './places.js';
import { dayStart, localParts } from './forecast.js';

const PLACE_WORDS = [
  ['dh1', /dining hall 1|\bdh ?1\b|mess 1/],
  ['dh2', /dining hall 2|\bdh ?2\b|mess 2/],
  ['lib', /librar/],
  ['lhc', /\blhc\b|lecture hall/],
  ['acad', /academic|\bacad\b|a[- ]block/],
  ['gym', /\bgym\b/],
  ['sports', /sport|ground/],
  ['food', /food court|canteen|cafe/],
  ['health', /health|hospital|doctor/],
  ['shuttle', /shuttle|\bbus\b|main gate/],
];

/** Pull place, time and intent out of a question. */
export function parseQuestion(q, now) {
  const text = q.toLowerCase();
  const placeId = PLACE_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
  let ts = now;
  const m = text.match(/\b(?:after|at|by|around|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (/tonight/.test(text)) ts = dayStart(now) + 20 * 3_600_000;
  if (m && (m[3] || /after|at|by|around|before/.test(m[0]))) {
    let h = Number(m[1]);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (!m[3] && h < 8) h += 12; // "after 4" on campus means 4 pm
    if (h < 24) ts = dayStart(now) + (h * 60 + Number(m[2] ?? 0)) * 60_000;
  }
  if (ts < now) ts = now;
  let intent = 'place';
  if (/room|class ?room|seats|group|meet|hall free|empty hall|study space|study spot|quiet place|where.*study/.test(text)) intent = 'room';
  else if (/mess|dining|lunch|dinner|breakfast|\beat\b|headcount/.test(text) && (!placeId || placeId.startsWith('dh'))) intent = 'mess';
  else if (!placeId) intent = 'unknown';
  return { intent, placeId, ts };
}

const hhmm = (ts) => {
  const { hour, minute } = localParts(ts);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
};

/**
 * ctx: { now, levelAt(place, ts) -> {level,label}, rooms(ts) -> roomStatus[], meals() -> mealForecast[] }
 */
export function answer(q, ctx) {
  const { intent, placeId, ts } = parseQuestion(q, ctx.now);
  const when = ts - ctx.now < 5 * 60_000 ? 'right now' : `at ${hhmm(ts)}`;
  const place = PLACES.find((p) => p.id === placeId);

  if (intent === 'room') {
    const near = place?.type === 'academic' ? place.id : null;
    const free = ctx
      .rooms(ts)
      .filter((r) => r.state === 'free' && (!near || r.placeId === near) && r.freeUntil - ts >= 45 * 60_000)
      .sort((a, b) => a.seats - b.seats);
    const study = PLACES.filter((p) => p.type === 'library').map((p) => ({ p, ...ctx.levelAt(p, ts) }))[0];
    const items = free.slice(0, 4).map((r) => ({ title: `${r.id} (${r.placeName})`, detail: `${r.seats} seats, free until ${hhmm(r.freeUntil)}${r.verifiedAt ? ', confirmed free by a student' : ''}` }));
    if (study?.label) items.push({ title: study.p.name, detail: `expected ${study.label.toLowerCase()} ${when}` });
    return {
      text: free.length
        ? `${free.length} room${free.length > 1 ? 's' : ''} ${near ? `in ${place.name} ` : ''}free ${when} per the timetable. Smallest first (quietest):`
        : `No free timetabled room ${near ? `in ${place.name} ` : ''}${when}. Try the library:`,
      items,
    };
  }
  if (intent === 'mess') {
    const meals = ctx.meals();
    return {
      text: 'Expected mess headcounts (timetable + opt-outs + past crowd data):',
      items: meals.map((f) => ({ title: `${f.label} at ${f.messName}`, detail: `${f.expected} (±${f.sd}) of ${f.registered} registered, ${f.optOuts} skipping` })),
    };
  }
  if (intent === 'place' && place) {
    const { label } = ctx.levelAt(place, ts);
    return { text: label ? `${place.name} is expected to be ${label.toLowerCase()} ${when}.` : `No data for ${place.name} ${when} (probably closed).`, items: [] };
  }
  return {
    text: 'I can answer about free rooms, how crowded a place will be, and mess headcounts. Try:',
    items: [{ title: 'Quiet room with free seats near LHC after 4?' }, { title: 'How busy is the gym at 6 pm?' }, { title: 'How many people at dinner tonight?' }],
  };
}
