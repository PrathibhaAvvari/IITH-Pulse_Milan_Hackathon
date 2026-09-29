import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useSocket } from '../socket.js';
import { levelColor, levelLabel, timeAgo, fmtTime } from '../util.js';

const YEAR_LABEL = { 1: '1st year', 2: '2nd year', 3: '3rd year', 4: '4th year', 5: 'PG / PhD' };
const KIND = {
  swap: { label: 'Skill swap', cls: 'k-swap', hint: 'You both help each other' },
  mentor: { label: 'Can help you', cls: 'k-mentor', hint: 'They know what you need' },
  mentee: { label: 'Needs your help', cls: 'k-mentee', hint: 'You can help them' },
};

export default function Study({ meta, user, notify }) {
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = none
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(null);
  const [reqs, setReqs] = useState(null);
  const course = (id) => meta.courses.find((c) => c.id === id)?.name ?? id;

  const load = useCallback(async () => {
    const p = await api.get(`/study/profile?user=${encodeURIComponent(user.id)}`).catch(() => null);
    setProfile(p);
    if (p) {
      const [m, r] = await Promise.all([
        api.get(`/study/matches?user=${encodeURIComponent(user.id)}`),
        api.get(`/study/requests?user=${encodeURIComponent(user.id)}`),
      ]).catch(() => [null, null]);
      setData(m);
      setReqs(r);
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  // study:update carries no user IDs: reload, then notify from what changed in MY requests.
  const seen = useRef(null);
  useEffect(() => {
    if (!reqs) return;
    const now = { incoming: new Set(reqs.incoming.map((r) => r.id)), active: new Set(reqs.active.map((r) => r.id)) };
    const prev = seen.current;
    if (prev) {
      if ([...now.incoming].some((id) => !prev.incoming.has(id))) notify('New study request - check your requests');
      else if (reqs.active.some((r) => r.mine && !prev.active.has(r.id))) notify('Your study request was accepted!');
    }
    seen.current = now;
  }, [reqs, notify]);
  useSocket('study:update', load);
  useSocket('pulse:update', () => profile && api.get(`/study/matches?user=${encodeURIComponent(user.id)}`).then(setData).catch(() => {}));

  async function act(fn, ok) {
    try {
      await fn();
      if (ok) notify(ok);
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  if (profile === undefined) return <div className="card">Loading…</div>;
  if (!profile || editing)
    return (
      <ProfileForm
        meta={meta}
        user={user}
        initial={profile}
        onCancel={profile ? () => setEditing(false) : null}
        onSaved={() => {
          setEditing(false);
          notify(profile ? 'Profile updated' : 'Profile created - here are your matches');
          load();
        }}
        notify={notify}
      />
    );

  const spot = data?.spot;
  const room = data?.room;

  return (
    <div>
      <section className="card study-head">
        <div>
          <h2>Study Match</h2>
          <p className="muted small">
            Learn from seniors, help juniors, or swap skills. {YEAR_LABEL[profile.year]} · {profile.branch} · helps with{' '}
            {profile.canHelp.map(course).join(', ') || 'nothing yet'} · needs {profile.needHelp.map(course).join(', ') || 'nothing'}
          </p>
        </div>
        <div className="study-head-actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={profile.available}
              onChange={(e) => act(() => api.put('/study/profile', { ...profile, user: user.id, available: e.target.checked }), e.target.checked ? 'You are visible to matches' : 'Hidden from matches')}
            />
            Available
          </label>
          <button className="btn small" onClick={() => setEditing(true)}>Edit profile</button>
        </div>
      </section>

      {room && (
        <div className="best spot">
          <span>Free classroom for your session (timetable + student reports)</span>
          <strong>
            {room.id} · {room.placeName} · free until {fmtTime(room.freeUntil)}
          </strong>
        </div>
      )}
      {!room && spot && (
        <div className="best spot">
          <span>Quietest study spot right now (from live Pulse data)</span>
          <strong style={{ color: levelColor(spot.level) }}>
            {spot.name} · {levelLabel(spot.level)}
          </strong>
        </div>
      )}

      <div className="study-grid">
        <section className="card">
          <div className="card-head">
            <h2>Your matches</h2>
            {data?.myReputation?.taught > 0 && <span className="muted small">You've helped in {data.myReputation.taught} session{data.myReputation.taught > 1 ? 's' : ''}</span>}
          </div>
          {!data && <p className="muted">Finding matches…</p>}
          {data?.matches.length === 0 && <p className="muted">No matches yet. Add more courses to your profile, or check back as more students join.</p>}
          <ul className="matches">
            {data?.matches.map((m) => (
              <li key={m.user} className="match">
                <div className="avatar">{m.name[0]}</div>
                <div className="match-body">
                  <div className="match-top">
                    <strong>{m.name}</strong>
                    <span className={`badge ${KIND[m.kind].cls}`} title={KIND[m.kind].hint}>{KIND[m.kind].label}</span>
                  </div>
                  <span className="muted small">
                    {YEAR_LABEL[m.year]} · {m.branch}
                    {m.reputation.taught > 0 && ` · helped in ${m.reputation.taught} session${m.reputation.taught > 1 ? 's' : ''} (${m.reputation.helpful} rated helpful)`}
                  </span>
                  <div className="courses">
                    {m.youLearn.map((c) => <span key={`l${c}`} className="tag learn">You learn: {course(c)}</span>)}
                    {m.youTeach.map((c) => <span key={`t${c}`} className="tag teach">You teach: {course(c)}</span>)}
                  </div>
                </div>
                {m.requestStatus ? (
                  <span className="muted small status-pill">{m.requestStatus === 'accepted' ? 'Session on' : 'Requested'}</span>
                ) : (
                  <button className="btn primary small" onClick={() => act(() => api.post('/study/requests', { user: user.id, to: m.user }), `Request sent to ${m.name}`)}>
                    Request
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Your sessions</h2>
          {!reqs && <p className="muted">Loading…</p>}
          {reqs && !reqs.incoming.length && !reqs.active.length && !reqs.outgoing.length && (
            <p className="muted small">No sessions yet. Send a request to a match to get started.</p>
          )}

          {reqs?.incoming.length > 0 && <h3>Requests for you</h3>}
          {reqs?.incoming.map((r) => (
            <div key={r.id} className="session incoming">
              <strong>{r.other?.name}</strong> <span className="muted small">· {timeAgo(r.createdAt)}</span>
              <p className="small">{describe(r, course)}</p>
              {r.message && <p className="small muted">“{r.message}”</p>}
              <div className="btn-row">
                <button className="btn primary small" onClick={() => act(() => api.post(`/study/requests/${r.id}/respond`, { user: user.id, accept: true }), 'Accepted - see you there!')}>Accept</button>
                <button className="btn small" onClick={() => act(() => api.post(`/study/requests/${r.id}/respond`, { user: user.id, accept: false }), 'Declined')}>Decline</button>
              </div>
            </div>
          ))}

          {reqs?.active.length > 0 && <h3>Upcoming</h3>}
          {reqs?.active.map((r) => (
            <div key={r.id} className="session active">
              <strong>{r.other?.name}</strong>
              <p className="small">{describe(r, course)}</p>
              <p className="small">
                {r.roomId ? (
                  <>
                    Meet in <strong>{r.roomId}</strong>, {r.placeName}
                    {r.bookedUntil && <span className="muted"> · booked for you until {fmtTime(r.bookedUntil)}</span>}
                  </>
                ) : (
                  <>
                    Meet at <strong>{r.placeName}</strong>{' '}
                    {r.placeLive != null && <span style={{ color: levelColor(r.placeLive) }}>({levelLabel(r.placeLive)} now)</span>}
                  </>
                )}
              </p>
              <div className="btn-row">
                <button className="btn small" onClick={() => act(() => api.post(`/study/requests/${r.id}/complete`, { user: user.id, helpful: true }), 'Marked done - thanks!')}>Done · helpful</button>
                <button className="btn small" onClick={() => act(() => api.post(`/study/requests/${r.id}/complete`, { user: user.id, helpful: false }), 'Marked done')}>Done · not really</button>
              </div>
            </div>
          ))}

          {reqs?.outgoing.length > 0 && <h3>Waiting for reply</h3>}
          {reqs?.outgoing.map((r) => (
            <div key={r.id} className="session">
              <strong>{r.other?.name}</strong> <span className="muted small">· sent {timeAgo(r.createdAt)}</span>
              <p className="small">{describe(r, course)}</p>
            </div>
          ))}

          {reqs?.done.length > 0 && <h3>Past sessions</h3>}
          {reqs?.done.map((r) => (
            <div key={r.id} className="session done">
              <span className="small">
                {r.other?.name} · {course(r.course)} {r.helpful ? '· rated helpful' : ''}
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function describe(r, course) {
  const c = course(r.course);
  if (r.direction === 'swap') return `Skill swap: ${c} ⇄ ${course(r.swapCourse)}`;
  // direction is from the sender's point of view
  if (r.direction === 'learn') return r.mine ? `You want help with ${c}` : `Wants your help with ${c}`;
  return r.mine ? `You offered help with ${c}` : `Offers to help you with ${c}`;
}

function ProfileForm({ meta, user, initial, onSaved, onCancel, notify }) {
  const [f, setF] = useState(
    initial ?? { name: user.name.startsWith('Student ') ? '' : user.name, year: 1, branch: 'CSE', canHelp: [], needHelp: [], available: true }
  );
  const [busy, setBusy] = useState(false);
  const toggle = (key, id) =>
    setF((s) => {
      const other = key === 'canHelp' ? 'needHelp' : 'canHelp';
      const has = s[key].includes(id);
      return { ...s, [key]: has ? s[key].filter((x) => x !== id) : [...s[key], id], [other]: s[other].filter((x) => x !== id) };
    });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put('/study/profile', { ...f, user: user.id, year: Number(f.year) });
      onSaved();
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card issue-form" onSubmit={save}>
      <div>
        <h2>{initial ? 'Edit your study profile' : 'Find your study match'}</h2>
        <p className="muted small">
          Tell us what you're good at and where you're stuck. We pair you with students who complement you, prefer two-way skill swaps, and book an empty
          classroom (from the timetable) to meet in.
        </p>
      </div>
      <div className="form-row three">
        <label>
          Name
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={40} placeholder="Your first name" />
        </label>
        <label>
          Year
          <select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>
            {meta.years.map((y) => <option key={y} value={y}>{YEAR_LABEL[y]}</option>)}
          </select>
        </label>
        <label>
          Branch
          <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
            {meta.branches.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
      </div>
      <CoursePicker label="I can help with" courses={meta.courses} selected={f.canHelp} onToggle={(id) => toggle('canHelp', id)} tone="teach" />
      <CoursePicker label="I need help with" courses={meta.courses} selected={f.needHelp} onToggle={(id) => toggle('needHelp', id)} tone="learn" />
      <div className="btn-row">
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save' : 'Show my matches'}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function CoursePicker({ label, courses, selected, onToggle, tone }) {
  return (
    <fieldset className="picker">
      <legend>{label} <span className="muted">({selected.length}/8)</span></legend>
      <div className="filters">
        {courses.map((c) => (
          <button type="button" key={c.id} className={`chip ${selected.includes(c.id) ? `chip-${tone}` : ''}`} onClick={() => onToggle(c.id)} aria-pressed={selected.includes(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
