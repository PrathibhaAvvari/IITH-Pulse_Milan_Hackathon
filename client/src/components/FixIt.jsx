import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSocket } from '../socket.js';
import { timeAgo, serverNow } from '../util.js';

const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

export default function FixIt({ meta, user, admin, notify }) {
  const [issues, setIssues] = useState([]);
  const [status, setStatus] = useState('open');
  const [sort, setSort] = useState('priority');
  const [showForm, setShowForm] = useState(false);
  const [digest, setDigest] = useState(null);

  const load = useCallback(
    () => api.get(`/issues?status=${status}&sort=${sort}&user=${encodeURIComponent(user.id)}`).then(setIssues).catch(() => {}),
    [status, sort, user.id]
  );
  useEffect(() => {
    load();
  }, [load]);
  useSocket('issues:update', load);

  async function upvote(id) {
    try {
      await api.post(`/issues/${id}/upvote`, { user: user.id });
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function verify(id, fixed) {
    try {
      const { outcome } = await api.post(`/issues/${id}/verify`, { user: user.id, fixed });
      notify(outcome === 'reopened' ? 'Reopened - the estate office will see it again' : outcome === 'verified' ? 'Fix verified - thanks!' : 'Thanks for confirming');
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function showDigest() {
    if (digest) return setDigest(null);
    try {
      setDigest(await api.get('/digest'));
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function setIssueStatus(id, next) {
    try {
      await api.patch(`/issues/${id}`, { status: next });
      notify(`Marked as ${STATUS_LABEL[next]}`);
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  return (
    <div className="fixit">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>FixIt - campus issues</h2>
            <p className="muted small">
              Report broken or wasteful things. Upvote what matters. Past-SLA issues escalate, and a fix only counts once the students who upvoted confirm it.{' '}
              {admin ? 'Admin: change status on each card.' : ''}
            </p>
          </div>
          <div className="btn-row">
            {admin && <button className="btn" onClick={showDigest}>{digest ? 'Hide digest' : 'Weekly digest'}</button>}
            <button className="btn primary" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : '+ Report issue'}</button>
          </div>
        </div>
        {digest && (
          <div className="digest">
            <p className="muted small">
              Auto-generated every Monday 9 am for the estate office{digest.archive.length ? ` · ${digest.archive.length} past digests stored` : ''}. Preview of the last 7 days:
            </p>
            <pre>{digest.current.text}</pre>
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(digest.current.text).then(() => notify('Digest copied'))}>Copy</button>
          </div>
        )}
        {showForm && (
          <IssueForm
            meta={meta}
            user={user}
            onUpvote={(id) => {
              upvote(id);
              setShowForm(false);
              notify('Upvoted the existing issue instead of creating a duplicate');
            }}
            onCreated={() => {
              setShowForm(false);
              setStatus('open');
              notify('Issue reported - thank you!');
              load();
            }}
            notify={notify}
          />
        )}
      </section>

      <div className="toolbar">
        <div className="filters">
          {['open', 'in_progress', 'escalated', 'resolved', 'all'].map((s) => (
            <button key={s} className={`chip ${status === s ? 'chip-on' : ''}`} onClick={() => setStatus(s)}>
              {s === 'all' ? 'All' : s === 'escalated' ? 'Past SLA' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort issues">
          <option value="priority">Sort: priority</option>
          <option value="new">Sort: newest</option>
        </select>
      </div>

      {issues.length === 0 && <div className="card muted">Nothing here - all clear.</div>}
      <ul className="issues">
        {issues.map((i) => (
          <li key={i.id} className={`card issue st-${i.status}`}>
            <button className={`vote ${i.voted ? 'voted' : ''}`} onClick={() => upvote(i.id)} aria-label={i.voted ? 'Remove upvote' : 'Upvote'}>
              ▲<strong>{i.upvotes}</strong>
            </button>
            <div className="issue-body">
              <div className="issue-top">
                <span className={`badge cat-${i.category}`}>{meta.categories[i.category]?.label ?? i.category}</span>
                <span className={`badge status-${i.status}`}>{STATUS_LABEL[i.status]}</span>
                {i.verification && (
                  <span className={`badge ${i.verification.verified ? 'verified' : 'awaiting'}`}>
                    {i.verification.verified ? 'Fix verified ✓' : `Awaiting student confirmation ${i.verification.confirms}/${i.verification.needed}`}
                  </span>
                )}
                {i.sla?.escalation > 0 && <span className="badge escalated">Past SLA · level {i.sla.escalation}</span>}
                {i.sla?.escalation === 0 && <span className="muted small">fix due in {Math.max(1, Math.round((i.sla.due - serverNow()) / 3_600_000))} h</span>}
                {i.reopenCount > 0 && <span className="badge escalated">Reopened ×{i.reopenCount}</span>}
                {i.status !== 'resolved' && <span className="muted small">priority {i.priority}</span>}
              </div>
              <h3>{i.title}</h3>
              {i.description && <p>{i.description}</p>}
              <p className="muted small">
                {i.placeName} · reported {timeAgo(i.createdAt)}
                {i.resolvedAt && ` · fixed in ${Math.max(1, Math.round((i.resolvedAt - i.createdAt) / 3_600_000))} h`}
              </p>
              {i.verification && !i.verification.verified && i.voted && !i.myVerification && (
                <div className="admin-row">
                  <span className="small">You upvoted this. Is it really fixed?</span>
                  <button className="btn small" onClick={() => verify(i.id, true)}>Yes, fixed</button>
                  <button className="btn small" onClick={() => verify(i.id, false)}>Still broken</button>
                </div>
              )}
              {i.myVerification && !i.verification?.verified && <p className="muted small">You said: {i.myVerification === 'fixed' ? 'fixed' : 'still broken'}</p>}
              {admin && (
                <div className="admin-row">
                  {Object.keys(STATUS_LABEL)
                    .filter((s) => s !== i.status)
                    .map((s) => (
                      <button key={s} className="btn small" onClick={() => setIssueStatus(i.id, s)}>
                        Mark {STATUS_LABEL[s].toLowerCase()}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IssueForm({ meta, user, onCreated, onUpvote, notify }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'water', placeId: meta.places[0].id });
  const [similar, setSimilar] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Debounced duplicate check while the student types.
  useEffect(() => {
    if (form.title.trim().length < 4) return setSimilar([]);
    const t = setTimeout(() => {
      api.post('/issues/similar', { ...form, user: user.id }).then(setSimilar).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [form, user.id]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/issues', { ...form, user: user.id });
      onCreated();
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="issue-form" onSubmit={submit}>
      <label>
        What's wrong?
        <input value={form.title} onChange={set('title')} placeholder="e.g. Water cooler not cooling" maxLength={120} required minLength={4} />
      </label>
      {similar.length > 0 && (
        <div className="similar">
          <strong>Looks like this may already be reported:</strong>
          {similar.map((s) => (
            <div key={s.id} className="similar-row">
              <span>
                {s.title} <span className="muted small">· {s.placeName} · ▲{s.upvotes}</span>
              </span>
              <button type="button" className="btn small" onClick={() => onUpvote(s.id)} disabled={s.voted}>
                {s.voted ? 'Already upvoted' : 'Upvote instead'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="form-row">
        <label>
          Category
          <select value={form.category} onChange={set('category')}>
            {Object.entries(meta.categories).map(([k, c]) => (
              <option key={k} value={k}>{c.label}</option>
            ))}
          </select>
        </label>
        <label>
          Where?
          <select value={form.placeId} onChange={set('placeId')}>
            {meta.places.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Details (optional)
        <textarea value={form.description} onChange={set('description')} rows={3} maxLength={1000} placeholder="Floor, room number, since when…" />
      </label>
      <button className="btn primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit issue'}</button>
    </form>
  );
}
