// Server clock. In demo mode an admin can "time travel" (e.g. to Monday 12:50) so the
// timetable-driven features can be shown at any hour. Everything time-based reads now().
let offset = 0;

export const now = () => Date.now() + offset;

/** Jump to `ts` (ms), or back to real time with null. */
export function setNow(ts) {
  offset = ts == null ? 0 : ts - Date.now();
}

export const isShifted = () => offset !== 0;
