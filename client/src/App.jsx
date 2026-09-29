import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getUser, saveUser, saveSession, setAdminPin, isAdmin } from './api.js';
import { socket, useSocket } from './socket.js';
import { setServerNow, fmtDay, fmtTime } from './util.js';
import Pulse from './components/Pulse.jsx';
import Mess from './components/Mess.jsx';
import Rooms from './components/Rooms.jsx';
import FixIt from './components/FixIt.jsx';
import Study from './components/Study.jsx';
import Impact from './components/Impact.jsx';
import Ask from './components/Ask.jsx';

const TABS = [
  { id: 'pulse', label: 'Pulse', icon: '◉', hint: 'How crowded is campus right now, and what the timetable predicts' },
  { id: 'mess', label: 'Mess', icon: '◧', hint: 'Skip a meal, see the predicted mess headcount' },
  { id: 'rooms', label: 'Rooms', icon: '▦', hint: 'Free classrooms right now, and energy checks' },
  { id: 'fixit', label: 'FixIt', icon: '⚑', hint: 'Report and track facility issues' },
  { id: 'study', label: 'Study', labelExtra: ' Match', icon: '⇄', hint: 'Find a study partner or skill swap' },
  { id: 'impact', label: 'Impact', icon: '▲', hint: 'What Pulse changes for IITH' },
];
const TAB_IDS = TABS.map((t) => t.id);

export default function App() {
  const [tab, setTab] = useState(() => (TAB_IDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'pulse'));
  const [meta, setMeta] = useState(null);
  const [user, setUser] = useState(getUser);
  const [admin, setAdmin] = useState(isAdmin);
  const [online, setOnline] = useState(socket.connected);
  const [presence, setPresence] = useState(1);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [clockKey, setClockKey] = useState(0);

  const loadMeta = useCallback(
    () =>
      api
        .get('/meta')
        .then((m) => {
          if (!m?.auth || !m?.places) {
            // An older copy of the server is answering (usually a previous `npm run dev` still running).
            setError('an older version of the Pulse server is answering on this port. Stop all running copies (Ctrl + C, or run: pkill -f "src/index.js"; pkill -f vite) and start again with npm run dev');
            return;
          }
          setServerNow(m.now);
          setMeta(m);
        })
        .catch((e) => setError(e.message)),
    []
  );
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    location.hash = tab;
  }, [tab]);
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      if (TAB_IDS.includes(h)) setTab(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useSocket('connect', () => setOnline(true));
  useSocket('disconnect', () => setOnline(false));
  useSocket('presence', setPresence);
  // Demo time travel: every screen reloads against the new server time.
  useSocket('clock', ({ now }) => {
    setServerNow(now);
    loadMeta();
    setClockKey((k) => k + 1);
  });

  const notify = useCallback((message, kind = 'ok') => {
    setToast({ message, kind, key: Date.now() });
    setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 3600);
  }, []);

  async function toggleAdmin() {
    if (meta.auth.required) return notify(admin ? 'You are an admin (set by ADMIN_EMAILS)' : 'Admins are set by the server (ADMIN_EMAILS)');
    if (admin) {
      setAdminPin(null);
      setAdmin(false);
      notify('Admin mode off');
      return;
    }
    const pin = prompt('Enter admin PIN');
    if (!pin) return;
    try {
      await api.post('/admin/verify', { pin });
      setAdminPin(pin);
      setAdmin(true);
      notify('Admin mode on - issue status, weekly digest and demo clock unlocked');
    } catch (e) {
      notify(e.message, 'err'); // "Wrong PIN" or the attempt limit
    }
  }

  function rename() {
    if (user.email) return;
    const name = prompt('Your display name', user.name);
    if (!name?.trim()) return;
    const next = { ...user, name: name.trim().slice(0, 40) };
    saveUser(next);
    setUser(next);
  }

  function signOut() {
    saveSession(null);
    setUser(getUser());
    setAdmin(false);
  }

  if (error) return <div className="boot">Can’t reach the Pulse server: {error}. Is <code>npm run dev</code> running?</div>;
  if (!meta) return <div className="boot"><span className="lambda">λ</span> Loading IITH Pulse…</div>;
  if (meta.auth.required && !user.token)
    return (
      <SignIn
        meta={meta}
        onSignedIn={(session) => {
          saveSession(session);
          setUser(getUser());
          setAdmin(Boolean(session.user.admin));
        }}
      />
    );

  const ctx = { meta, user, admin: admin && isAdmin(), notify };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="lambda">λ</span>
          <div>
            <strong>IITH Pulse</strong>
            <small>smart campus, in real time</small>
          </div>
        </div>
        <div className="top-right">
          <span className={`live-dot ${online ? 'on' : ''}`} title={online ? 'Live updates connected' : 'Reconnecting…'} />
          <span className="muted small hide-sm">{presence} online</span>
          <button className="chip" onClick={user.email ? signOut : rename} title={user.email ? `${user.email} - click to sign out` : 'Change display name'}>
            {user.name}
          </button>
          <button className={`chip ${admin ? 'chip-admin' : ''}`} onClick={toggleAdmin}>{admin ? 'Admin ✓' : 'Admin'}</button>
        </div>
      </header>

      {meta.demoMode && admin && <DemoClock meta={meta} notify={notify} />}
      {meta.demoTime && (
        <div className="notice">
          Demo time: <strong>{fmtDay(meta.now)}, {fmtTime(meta.now)}</strong> (the server clock is shifted so timetable features can be shown at any hour).
        </div>
      )}

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} title={t.hint}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
            {t.labelExtra && <span className="hide-sm">{t.labelExtra}</span>}
          </button>
        ))}
      </nav>

      <main key={clockKey}>
        <Ask />
        {tab === 'pulse' && <Pulse {...ctx} />}
        {tab === 'mess' && <Mess {...ctx} />}
        {tab === 'rooms' && <Rooms {...ctx} />}
        {tab === 'fixit' && <FixIt {...ctx} />}
        {tab === 'study' && <Study {...ctx} />}
        {tab === 'impact' && <Impact {...ctx} />}
      </main>

      {toast && <div key={toast.key} className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}

/** Google sign-in, restricted to the IITH domain (checked again on the server). */
function SignIn({ meta, onSignedIn }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      window.google.accounts.id.initialize({
        client_id: meta.auth.clientId,
        hd: meta.auth.domain, // only offers IITH accounts in the picker
        callback: async ({ credential }) => {
          try {
            onSignedIn(await api.post('/auth/google', { credential }));
          } catch (e) {
            setErr(e.message);
          }
        },
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'filled_black', size: 'large', text: 'signin_with' });
    };
    script.onerror = () => setErr('Could not load Google sign-in. Check your connection.');
    document.head.appendChild(script);
    return () => script.remove();
  }, [meta, onSignedIn]);
  return (
    <div className="boot">
      <div className="signin">
        <span className="lambda">λ</span>
        <h2>IITH Pulse</h2>
        <p className="muted small">Sign in with your <strong>@{meta.auth.domain}</strong> account. One account per student keeps crowd reports, upvotes and meal opt-outs honest.</p>
        <div ref={ref} />
        {err && <p className="err-text small">{err}</p>}
      </div>
    </div>
  );
}

const PRESETS = [
  ['Mon 12:50 - class lets out', '2026-09-28T12:50'],
  ['Mon 16:00 - free rooms', '2026-09-28T16:00'],
  ['Fri 2 Oct 18:00 - long weekend', '2026-10-02T18:00'],
  ['Mon 16 Nov 07:00 - end-sem exams', '2026-11-16T07:00'],
];

function DemoClock({ meta, notify }) {
  async function jump(local) {
    try {
      await api.post('/demo/clock', { at: local ? `${local}:00+05:30` : null });
      notify(local ? 'Time travelled' : 'Back to real time');
    } catch (e) {
      notify(e.message, 'err');
    }
  }
  return (
    <div className="demo-clock">
      <span className="muted small">Demo clock:</span>
      {PRESETS.map(([label, at]) => (
        <button key={at} className="chip" onClick={() => jump(at)}>{label}</button>
      ))}
      {meta.demoTime && <button className="chip chip-on" onClick={() => jump(null)}>Back to now</button>}
    </div>
  );
}
