// Study Match: peer-to-peer course help with two-way "skill swap" matching.
// Pure functions so they are easy to unit test.

// Edit this list to match real IITH courses (codes optional).
export const COURSES = [
  { id: 'calc', name: 'Calculus' },
  { id: 'linalg', name: 'Linear Algebra' },
  { id: 'prob', name: 'Probability & Statistics' },
  { id: 'python', name: 'Programming in Python' },
  { id: 'dsa', name: 'Data Structures & Algorithms' },
  { id: 'ml', name: 'Machine Learning' },
  { id: 'circuits', name: 'Electrical Circuits' },
  { id: 'signals', name: 'Signals & Systems' },
  { id: 'mech', name: 'Engineering Mechanics' },
  { id: 'thermo', name: 'Thermodynamics' },
  { id: 'fluids', name: 'Fluid Mechanics' },
  { id: 'physics', name: 'Engineering Physics' },
  { id: 'chem', name: 'Engineering Chemistry' },
  { id: 'drawing', name: 'Engineering Drawing' },
];

export const BRANCHES = ['CSE', 'EE', 'ME', 'Civil', 'Chemical', 'Maths', 'Physics', 'AI', 'BME', 'Design', 'Other'];
export const YEARS = [1, 2, 3, 4, 5]; // 5 = PG / PhD

const courseIds = new Set(COURSES.map((c) => c.id));
export const validCourses = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((c) => courseIds.has(c)))].slice(0, 8) : [];

/** How many completed sessions a user taught that learners rated helpful. */
export function reputation(requests, userId) {
  let taught = 0;
  let helpful = 0;
  for (const r of requests) {
    if (r.status !== 'done' || teacherOf(r) !== userId) continue;
    taught++;
    if (r.helpful) helpful++;
  }
  return { taught, helpful };
}

/** In a request, who is teaching the course? */
export function teacherOf(r) {
  return r.direction === 'teach' ? r.from : r.to; // 'learn' and 'swap' -> the recipient teaches r.course
}

/**
 * Rank other students for `me`.
 *  - youLearn: courses I need that they can teach
 *  - youTeach: courses they need that I can teach
 *  - swap = both non-empty -> ranked first (nobody feels like a burden, both gain)
 */
export function matchesFor(me, profiles, requests = [], now = Date.now()) {
  if (!me) return [];
  const need = new Set(me.needHelp);
  const can = new Set(me.canHelp);
  const out = [];
  for (const p of profiles) {
    if (p.user === me.user || !p.available) continue;
    const youLearn = p.canHelp.filter((c) => need.has(c));
    const youTeach = p.needHelp.filter((c) => can.has(c));
    if (!youLearn.length && !youTeach.length) continue;
    const kind = youLearn.length && youTeach.length ? 'swap' : youLearn.length ? 'mentor' : 'mentee';
    const rep = reputation(requests, p.user);
    const activeRecently = now - (p.updatedAt ?? 0) < 7 * 86_400_000;
    const score =
      youLearn.length * 2 +
      youTeach.length * 1.5 +
      (kind === 'swap' ? 3 : 0) +
      Math.min(rep.helpful * 0.25, 1.5) +
      (activeRecently ? 0.5 : 0);
    out.push({
      user: p.user,
      name: p.name,
      year: p.year,
      branch: p.branch,
      youLearn,
      youTeach,
      kind,
      reputation: rep,
      score: Math.round(score * 10) / 10,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

/**
 * Demand vs supply per course. A high gap (many students need help, few can help)
 * is a signal for TAs / faculty to run an extra tutorial.
 */
export function courseDemand(profiles) {
  return COURSES.map((c) => {
    const need = profiles.filter((p) => p.needHelp.includes(c.id)).length;
    const helpers = profiles.filter((p) => p.canHelp.includes(c.id)).length;
    return { ...c, need, helpers, gap: Math.round((need / Math.max(helpers, 1)) * 10) / 10 };
  }).sort((a, b) => b.gap - a.gap || b.need - a.need);
}

export function studyStats(state) {
  const profiles = state.studyProfiles;
  const done = state.studyRequests.filter((r) => r.status === 'done');
  const byUser = new Map(profiles.map((p) => [p.user, p]));
  const crossYear = done.filter((r) => {
    const a = byUser.get(r.from);
    const b = byUser.get(r.to);
    return a && b && a.year !== b.year;
  }).length;
  const crossBranch = done.filter((r) => {
    const a = byUser.get(r.from);
    const b = byUser.get(r.to);
    return a && b && a.branch !== b.branch;
  }).length;
  const learners = new Set(done.map((r) => (teacherOf(r) === r.from ? r.to : r.from)));
  const rated = done.filter((r) => r.helpful != null);
  return {
    students: profiles.length,
    sessionsDone: done.length,
    swaps: done.filter((r) => r.direction === 'swap').length,
    studentsHelped: learners.size,
    helpfulPct: rated.length ? Math.round((rated.filter((r) => r.helpful).length / rated.length) * 100) : null,
    crossYearPct: done.length ? Math.round((crossYear / done.length) * 100) : null,
    crossBranchPct: done.length ? Math.round((crossBranch / done.length) * 100) : null,
    demand: courseDemand(profiles),
  };
}
