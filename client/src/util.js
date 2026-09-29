export const LEVEL_COLORS = ['#6b7280', '#22c55e', '#a3e635', '#facc15', '#fb923c', '#ef4444'];
export const LEVEL_LABELS = ['No data', 'Empty', 'Quiet', 'Moderate', 'Busy', 'Packed'];

export const levelIndex = (level) => (level == null ? 0 : Math.max(1, Math.min(5, Math.round(level))));
export const levelColor = (level) => LEVEL_COLORS[levelIndex(level)];
export const levelLabel = (level) => LEVEL_LABELS[levelIndex(level)];

export function fmtHour(h) {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? 'am' : 'pm';
  const n = hh % 12 === 0 ? 12 : hh % 12;
  return `${n}${suffix}`;
}

// The server clock can be shifted in demo mode ("time travel"); keep relative times consistent with it.
let clockOffset = 0;
export const setServerNow = (serverNow) => (clockOffset = serverNow - Date.now());
export const serverNow = () => Date.now() + clockOffset;

/** '1:05 pm' in campus time. */
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
export const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function timeAgo(ts) {
  const s = Math.max(0, Math.round((serverNow() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
