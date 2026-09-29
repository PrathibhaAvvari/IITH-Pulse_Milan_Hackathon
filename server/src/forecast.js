// Crowd model. Pure functions so they are easy to unit test.
//
// Crowd level scale: 1 = empty, 2 = quiet, 3 = moderate, 4 = busy, 5 = packed.
//
// live level  = recency- and trust-weighted average of reports from the last LIVE_WINDOW_MIN
//               minutes (only each reporter's latest report counts), blended with the
//               forecast as a prior, so one troll report can't flip "empty" to "packed".
// forecast    = average of all historical reports for that place at the same weekday + hour,
//               falling back to the same hour on any weekday.

export const TZ_OFFSET_MIN = Number(process.env.TZ_OFFSET_MIN ?? 330); // IST = UTC+5:30
export const LIVE_WINDOW_MIN = 45;
const HALF_LIFE_MIN = 15;
const PRIOR_WEIGHT = 0.6;

export const LEVEL_LABELS = ['', 'Empty', 'Quiet', 'Moderate', 'Busy', 'Packed'];

/** Local (campus) weekday 0-6 and hour 0-23 for a timestamp. */
export function localParts(ts) {
  const d = new Date(ts + TZ_OFFSET_MIN * 60_000);
  return { dow: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** Campus-local date 'YYYY-MM-DD'. */
export function localDate(ts) {
  return new Date(ts + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Timestamp of local midnight of the campus day containing `ts`. */
export function dayStart(ts) {
  const shifted = ts + TZ_OFFSET_MIN * 60_000;
  return shifted - (shifted % 86_400_000) - TZ_OFFSET_MIN * 60_000;
}

/** Build a lookup: placeId -> { byDowHour: [7][24] {sum,n}, byHour: [24] {sum,n} } */
export function buildProfiles(reports) {
  const profiles = new Map();
  for (const r of reports) {
    let p = profiles.get(r.placeId);
    if (!p) {
      p = {
        byDowHour: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }))),
        byHour: Array.from({ length: 24 }, () => ({ sum: 0, n: 0 })),
      };
      profiles.set(r.placeId, p);
    }
    const { dow, hour } = localParts(r.ts);
    p.byDowHour[dow][hour].sum += r.level;
    p.byDowHour[dow][hour].n += 1;
    p.byHour[hour].sum += r.level;
    p.byHour[hour].n += 1;
  }
  return profiles;
}

/** Forecast crowd level for a place at a given time. Returns { level, samples } or null. */
export function forecastAt(profiles, placeId, ts) {
  const p = profiles.get(placeId);
  if (!p) return null;
  const { dow, hour } = localParts(ts);
  const cell = p.byDowHour[dow][hour];
  if (cell.n >= 3) return { level: cell.sum / cell.n, samples: cell.n };
  const any = p.byHour[hour];
  if (any.n > 0) return { level: any.sum / any.n, samples: any.n };
  return null;
}

/**
 * Current crowd level: recent reports blended with a prior.
 * opts.weightOf(user) -> 0..1 reporter reliability (default 1).
 * opts.prior          -> { level } overriding the historical forecast (e.g. timetable-aware).
 */
export function liveLevel(reports, profiles, placeId, now = Date.now(), opts = {}) {
  const { weightOf = () => 1 } = opts;
  const cutoff = now - LIVE_WINDOW_MIN * 60_000;
  const latest = new Map(); // one vote per reporter: their newest report
  const anon = [];
  for (const r of reports) {
    if (r.placeId !== placeId || r.ts < cutoff || r.ts > now) continue;
    if (r.user == null) anon.push(r);
    else if (!latest.has(r.user) || latest.get(r.user).ts < r.ts) latest.set(r.user, r);
  }
  let wSum = 0;
  let lSum = 0;
  let lastReportAt = null;
  const counted = [...latest.values(), ...anon];
  for (const r of counted) {
    const ageMin = (now - r.ts) / 60_000;
    const w = Math.pow(0.5, ageMin / HALF_LIFE_MIN) * (r.user == null ? 1 : weightOf(r.user));
    wSum += w;
    lSum += w * r.level;
    if (!lastReportAt || r.ts > lastReportAt) lastReportAt = r.ts;
  }
  const count = counted.length;
  const prior = 'prior' in opts ? opts.prior : forecastAt(profiles, placeId, now);
  if (count === 0) {
    return prior
      ? { level: round1(prior.level), source: 'forecast', reports: 0, lastReportAt: null }
      : { level: null, source: 'none', reports: 0, lastReportAt: null };
  }
  const level = prior
    ? (lSum + PRIOR_WEIGHT * prior.level) / (wSum + PRIOR_WEIGHT)
    : lSum / wSum;
  return { level: round1(level), source: 'live', reports: count, lastReportAt };
}

export function isOpen(place, hour) {
  const [open, close] = place.openHours ?? [0, 24];
  return hour >= open && hour < close;
}

/**
 * Hour-by-hour forecast for the next `hours` hours, plus the least crowded open slot.
 * `levelAt(ts)` lets the caller supply a richer forecast (history + timetable).
 */
export function upcoming(profiles, place, now = Date.now(), hours = 8, levelAt = (ts) => forecastAt(profiles, place.id, ts)?.level) {
  const slots = [];
  const startOfHour = now - (now % 3_600_000);
  for (let i = 0; i <= hours; i++) {
    const ts = startOfHour + i * 3_600_000;
    const { hour } = localParts(ts);
    const level = levelAt(ts);
    slots.push({ ts, hour, open: isOpen(place, hour), level: level != null ? round1(level) : null });
  }
  const candidates = slots.filter((s) => s.open && s.level != null);
  const best = candidates.reduce((a, b) => (b.level < a.level ? b : a), candidates[0] ?? null);
  return { slots, best };
}

/** 24-hour profile for a given weekday (used by the detail chart). */
export function dayProfile(profiles, placeId, dow) {
  const p = profiles.get(placeId);
  return Array.from({ length: 24 }, (_, hour) => {
    if (!p) return { hour, level: null };
    const c = p.byDowHour[dow][hour];
    return { hour, level: c.n ? round1(c.sum / c.n) : null };
  });
}

export function round1(x) {
  return Math.round(x * 10) / 10;
}
