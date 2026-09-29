// Mess demand forecast + one-tap meal opt-out, aimed at food waste.
// headcount = (registered - opt-outs) x attendance rate, where the rate depends on the meal, the kind
// of day from the academic calendar (weekend, long weekend, exam week) and past crowd data.
import { PLACES } from './places.js';
import { dayStart, localDate } from './forecast.js';
import { dayKind, TIMETABLE } from './campus.js';

const MIN = 60_000;
const DAY = 86_400_000;
export const MESSES = PLACES.filter((p) => p.type === 'mess');

// start/end in minutes after midnight. rate = share of registered diners who eat (weekday / weekend).
export const MEALS = {
  breakfast: { label: 'Breakfast', start: 7 * 60 + 30, end: 9 * 60 + 30, rate: 0.55, weekendRate: 0.4 },
  lunch: { label: 'Lunch', start: 12 * 60 + 15, end: 14 * 60 + 15, rate: 0.78, weekendRate: 0.68 },
  dinner: { label: 'Dinner', start: 19 * 60 + 30, end: 21 * 60 + 30, rate: 0.82, weekendRate: 0.74 },
};
export const KG_PER_PLATE = 0.45; // cooked food per diner
// Assumed current practice (the baseline we compare against): the mess already knows weekday vs weekend
// turnout and cooks that plus a small safety buffer, but not long weekends, exam weeks or opt-outs.
// Conservative on purpose: replace with a mess manager's real numbers when available.
export const USUAL_BUFFER = Number(process.env.MESS_USUAL_BUFFER ?? 0.05);
const MODEL_ERROR = 0.04; // extra relative uncertainty on top of binomial noise

/** Past crowd data: is this weekday busier than the same kind of day on average at meal time? */
export function crowdFactor(profiles, placeId, minute, dow) {
  const p = profiles?.get(placeId);
  if (!p) return 1;
  const h = Math.floor(minute / 60) + 1; // peak is ~45 min into the meal
  const weekend = (d) => d === 0 || d === 6;
  const mean = (cells) => {
    const n = cells.reduce((a, c) => a + c.n, 0);
    return n ? cells.reduce((a, c) => a + c.sum, 0) / n : null;
  };
  const today = mean([p.byDowHour[dow][h]]);
  const sameKind = mean([0, 1, 2, 3, 4, 5, 6].filter((d) => weekend(d) === weekend(dow)).map((d) => p.byDowHour[d][h]));
  if (today == null || sameKind == null || sameKind <= 1) return 1;
  return Math.max(0.85, Math.min(1.15, (today - 1) / (sameKind - 1)));
}

export function mealForecast({ mess, meal, ts, optOuts = 0, profiles = null, tt = TIMETABLE }) {
  const m = MEALS[meal];
  const kind = dayKind(ts, tt);
  const factors = [];
  const baseRate = kind.weekend || kind.holiday ? m.weekendRate : m.rate;
  let rate = baseRate;
  if (kind.holiday) factors.push('Holiday');
  else if (kind.weekend) factors.push('Weekend');
  if (kind.longWeekend) {
    rate *= 0.6;
    factors.push('Long weekend: many students travel home (x0.6)');
  }
  if (kind.exam) {
    const f = meal === 'breakfast' ? 1.2 : 1.08;
    rate *= f;
    factors.push(`Exam week: students stay on campus (x${f})`);
  }
  const crowd = crowdFactor(profiles, mess.id, m.start, kind.dow);
  if (Math.abs(crowd - 1) >= 0.02) {
    rate *= crowd;
    factors.push(`Past crowd data for this weekday (x${crowd.toFixed(2)})`);
  }
  rate = Math.min(0.97, rate);
  const n = Math.max(0, mess.registered - optOuts);
  const expected = n * rate;
  const sd = Math.sqrt(n * rate * (1 - rate) + (MODEL_ERROR * expected) ** 2);
  const cookFor = Math.ceil(expected + sd); // ~84% chance nobody goes hungry
  const usual = Math.round(mess.registered * (baseRate + USUAL_BUFFER));
  const savedPlates = Math.max(0, usual - cookFor);
  // Signed: negative means "cook more than usual" (e.g. exam week), which prevents shortages.
  const changePct = Math.round((100 * (cookFor - usual)) / usual);
  const start = dayStart(ts) + m.start * MIN;
  return {
    messId: mess.id,
    messName: mess.name,
    meal,
    label: m.label,
    date: localDate(ts),
    start,
    end: dayStart(ts) + m.end * MIN,
    registered: mess.registered,
    optOuts,
    expected: Math.round(expected),
    sd: Math.round(sd),
    cookFor,
    usual,
    savedPlates,
    changePct,
    kgSaved: Math.round(savedPlates * KG_PER_PLATE),
    factors,
  };
}

/** The next `count` meals that haven't ended yet: [{ meal, ts }] */
export function nextMeals(now, count = 3) {
  const out = [];
  for (let d = 0; out.length < count && d < 3; d++) {
    const ts = dayStart(now) + d * DAY + 12 * 60 * MIN;
    for (const meal of Object.keys(MEALS)) {
      if (dayStart(ts) + MEALS[meal].end * MIN > now && out.length < count) out.push({ meal, ts });
    }
  }
  return out;
}

export const optOutCount = (optOuts, messId, date, meal) =>
  optOuts.filter((o) => o.mess === messId && o.date === date && o.meal === meal).length;

/** Food over-production avoided over the last `days` days if messes cooked to the forecast. */
export function wasteAvoided(optOuts, profiles, now, days = 7) {
  let kg = 0;
  let plates = 0;
  let usualPlates = 0;
  let cookPlates = 0;
  for (let d = 1; d <= days; d++) {
    const ts = dayStart(now) - d * DAY + 12 * 60 * MIN;
    for (const meal of Object.keys(MEALS)) {
      for (const mess of MESSES) {
        const f = mealForecast({ mess, meal, ts, profiles, optOuts: optOutCount(optOuts, mess.id, localDate(ts), meal) });
        kg += f.kgSaved;
        plates += f.savedPlates;
        usualPlates += f.usual;
        cookPlates += f.cookFor;
      }
    }
  }
  return { kg, plates, days, reductionPct: usualPlates ? Math.round((100 * (usualPlates - cookPlates)) / usualPlates) : 0 };
}
