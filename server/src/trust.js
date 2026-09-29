// Trust-weighted crowd reports: a small version of Dawid-Skene style truth discovery.
//
// Each reporter's reliability = smoothed share of their reports that agree (within ~1 level) with
// the consensus of OTHER reporters at the same place within +-20 min, or, when nobody else
// reported, with the expected level (history + timetable). The consensus is itself weighted by
// reliability, so we alternate "estimate truth" / "score reporters" for a few rounds (EM-like).
// Trolls fade out on their own, without bans; a fresh account starts with little weight.

const WINDOW_MS = 20 * 60_000;
const ROUNDS = 3;
// Beta-style smoothing: (agree + A) / (n + N). A fresh account scores A/N = 0.125.
const A = 0.5;
const N = 4;
export const NEW_USER_TRUST = A / N;

const agreement = (level, truth) => Math.max(0, Math.min(1, 1.5 - Math.abs(level - truth))); // |d|<=0.5 -> 1, 1 -> 0.5, >=1.5 -> 0

/**
 * reports: [{ placeId, level, ts, user }]
 * expectedAt(placeId, ts) -> level | null   (used when a report has no neighbours)
 * Returns Map(user -> { trust, reports }).
 */
export function reliabilities(reports, expectedAt = () => null) {
  const byPlace = new Map();
  for (const r of reports) {
    if (r.user == null) continue;
    if (!byPlace.has(r.placeId)) byPlace.set(r.placeId, []);
    byPlace.get(r.placeId).push(r);
  }
  for (const list of byPlace.values()) list.sort((a, b) => a.ts - b.ts);

  const expected = new Map(); // report -> expected level (computed lazily, once)
  let trust = new Map();
  const t = (u) => trust.get(u) ?? 0.5; // round 1: everyone equal
  let stats;
  for (let round = 0; round < ROUNDS; round++) {
    stats = new Map();
    for (const list of byPlace.values()) {
      let lo = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        while (list[lo].ts < r.ts - WINDOW_MS) lo++;
        let w = 0;
        let s = 0;
        for (let j = lo; j < list.length && list[j].ts <= r.ts + WINDOW_MS; j++) {
          const o = list[j];
          if (o.user === r.user) continue;
          w += t(o.user);
          s += t(o.user) * o.level;
        }
        let truth = w > 0 ? s / w : null;
        if (truth == null) {
          if (!expected.has(r)) expected.set(r, expectedAt(r.placeId, r.ts));
          truth = expected.get(r);
        }
        if (truth == null) continue;
        const st = stats.get(r.user) ?? { agree: 0, n: 0 };
        st.agree += agreement(r.level, truth);
        st.n += 1;
        stats.set(r.user, st);
      }
    }
    trust = new Map([...stats].map(([u, st]) => [u, (st.agree + A) / (st.n + N)]));
  }
  return new Map([...stats].map(([u, st]) => [u, { trust: Math.round(trust.get(u) * 1000) / 1000, reports: st.n }]));
}
