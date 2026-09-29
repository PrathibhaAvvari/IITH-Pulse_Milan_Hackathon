// FixIt: facility issue helpers - priority, duplicate detection, SLA escalation,
// community-verified fixes and the weekly digest for the estate office.
import { localParts, dayStart, localDate } from './forecast.js';

// sla = hours the estate office has to fix it before it escalates.
export const CATEGORIES = {
  safety: { label: 'Safety hazard', weight: 6, sla: 24 },
  water: { label: 'Water / plumbing', weight: 4, sla: 48 },
  electrical: { label: 'Electrical', weight: 4, sla: 48 },
  energy: { label: 'Energy waste (lights/AC left on)', weight: 3, sla: 24 },
  wifi: { label: 'Wi-Fi / network', weight: 3, sla: 72 },
  cleanliness: { label: 'Cleanliness', weight: 2, sla: 24 },
  furniture: { label: 'Furniture / fixtures', weight: 1, sla: 168 },
  other: { label: 'Other', weight: 1, sla: 120 },
};

const HOUR = 3_600_000;
export const VERIFY_WINDOW_H = 48; // no dispute within 48 h of "resolved" -> counts as verified

export const STATUSES = ['open', 'in_progress', 'resolved'];

/**
 * SLA state of an unresolved issue. escalation: 0 = on time, 1 = past SLA, 2 = past 2x SLA.
 * The clock restarts when an issue is reopened.
 */
export function slaState(issue, now = Date.now()) {
  if (issue.status === 'resolved') return null;
  const hours = CATEGORIES[issue.category]?.sla ?? 120;
  const since = issue.reopenedAt ?? issue.createdAt;
  const due = since + hours * HOUR;
  const late = now - due;
  return { hours, due, overdueHours: Math.max(0, Math.round(late / HOUR)), escalation: late <= 0 ? 0 : late < hours * HOUR ? 1 : 2 };
}

/**
 * Priority = community votes + category severity + age (older unresolved issues climb) + SLA escalation.
 * Resolved issues always score 0 so they drop off the admin queue.
 */
export function priority(issue, now = Date.now()) {
  if (issue.status === 'resolved') return 0;
  const weight = CATEGORIES[issue.category]?.weight ?? 1;
  const ageDays = (now - issue.createdAt) / 86_400_000;
  const escalation = slaState(issue, now).escalation;
  return Math.round((issue.upvotes * 1.5 + weight * 2 + Math.min(ageDays, 10) + escalation * 4) * 10) / 10;
}

/**
 * "Resolved" only counts once the people who cared confirm it.
 * verified: enough upvoters confirmed (2, or all of them if fewer), or nobody disputed within 48 h.
 */
export function verificationState(issue, now = Date.now()) {
  if (issue.status !== 'resolved') return null;
  const v = issue.verify ?? { confirms: [], disputes: [] };
  const needed = Math.min(2, Math.max(1, issue.voters.length));
  const verified = v.confirms.length >= needed || now - issue.resolvedAt > VERIFY_WINDOW_H * HOUR;
  return { verified, confirms: v.confirms.length, disputes: v.disputes.length, needed };
}

/** An upvoter confirms (fixed=true) or disputes a fix. More disputes than confirms reopens the issue. */
export function recordVerification(issue, user, fixed, now = Date.now()) {
  const v = (issue.verify ??= { confirms: [], disputes: [] });
  v.confirms = v.confirms.filter((u) => u !== user);
  v.disputes = v.disputes.filter((u) => u !== user);
  (fixed ? v.confirms : v.disputes).push(user);
  if (v.disputes.length > v.confirms.length) {
    issue.status = 'open';
    issue.resolvedAt = null;
    issue.reopenedAt = now;
    issue.reopenCount = (issue.reopenCount ?? 0) + 1;
    issue.verify = null;
    issue.updatedAt = now;
    return 'reopened';
  }
  return verificationState(issue, now).verified ? 'verified' : 'recorded';
}

/** Monday 00:00 (campus time) of the week containing ts, as 'YYYY-MM-DD' key + ts. */
export function weekOf(ts) {
  const start = dayStart(ts) - ((localParts(ts).dow + 6) % 7) * 24 * HOUR;
  return { start, key: localDate(start) };
}

/** Plain-text weekly digest for the estate office. */
export function weeklyDigest({ issues, placeName, since, now = Date.now(), energy = null }) {
  const inWeek = (t) => t != null && t >= since && t <= now;
  const fresh = issues.filter((i) => inWeek(i.createdAt));
  const resolved = issues.filter((i) => inWeek(i.resolvedAt));
  const verified = resolved.filter((i) => verificationState(i, now)?.verified);
  const reopened = issues.filter((i) => inWeek(i.reopenedAt));
  const overdue = issues
    .map((i) => ({ i, s: slaState(i, now) }))
    .filter((x) => x.s?.escalation > 0)
    .sort((a, b) => b.s.escalation - a.s.escalation || b.s.overdueHours - a.s.overdueHours);
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const lines = [
    `IITH Pulse - FixIt weekly digest (${fmt(since)} to ${fmt(now)})`,
    '',
    `New issues: ${fresh.length} | Resolved: ${resolved.length} (${verified.length} confirmed by students) | Reopened after a failed fix: ${reopened.length}`,
    `Open now: ${issues.filter((i) => i.status !== 'resolved').length} | Past SLA: ${overdue.length}`,
  ];
  if (energy) lines.push(`Energy waste verified in empty rooms: ${energy.verified} (~${energy.kwh} kWh, Rs ${energy.inr})`);
  if (overdue.length) {
    lines.push('', 'ESCALATED (past SLA, most urgent first):');
    for (const { i, s } of overdue.slice(0, 15)) {
      lines.push(`- [${s.escalation === 2 ? 'LEVEL 2' : 'LEVEL 1'}] ${i.title} @ ${placeName(i.placeId)} - ${s.overdueHours} h over the ${s.hours} h SLA, ${i.upvotes} upvotes`);
    }
  }
  if (reopened.length) {
    lines.push('', 'REOPENED (students said it is not fixed):');
    for (const i of reopened) lines.push(`- ${i.title} @ ${placeName(i.placeId)} (reopened ${i.reopenCount}x)`);
  }
  return {
    text: lines.join('\n'),
    stats: { new: fresh.length, resolved: resolved.length, verified: verified.length, reopened: reopened.length, overdue: overdue.length },
  };
}

const STOP = new Set(['the', 'a', 'an', 'is', 'in', 'on', 'at', 'of', 'and', 'not', 'to', 'near', 'room', 'floor', 'it', 'for', 'with']);

export function tokens(text = '') {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Find open issues that look like the one being reported, so students upvote
 * an existing ticket instead of filing ten copies of "water cooler broken".
 */
export function findSimilar(issues, { title, description = '', placeId, category }) {
  const q = tokens(`${title} ${description}`);
  return issues
    .filter((i) => i.status !== 'resolved')
    .map((i) => {
      let score = jaccard(q, tokens(`${i.title} ${i.description}`));
      if (placeId && i.placeId === placeId) score += 0.25;
      if (category && i.category === category) score += 0.15;
      return { issue: i, score };
    })
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => ({ ...x.issue, similarity: Math.round(x.score * 100) / 100 }));
}
