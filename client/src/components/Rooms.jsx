import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSocket } from '../socket.js';
import { fmtTime, timeAgo } from '../util.js';

const STATE = {
  free: { label: 'Free', cls: 'st-free' },
  class: { label: 'In class', cls: 'st-class' },
  booked: { label: 'Booked', cls: 'st-booked' },
  occupied: { label: 'Reported in use', cls: 'st-occupied' },
  closed: { label: 'Building closed', cls: 'st-closed' },
};

export default function Rooms({ user, notify }) {
  const [d, setD] = useState(null);
  const [building, setBuilding] = useState('LHC');
  const [freeOnly, setFreeOnly] = useState(true);
  const load = useCallback(() => api.get(`/rooms?user=${encodeURIComponent(user.id)}`).then(setD).catch(() => {}), [user.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useSocket('rooms:update', load);

  async function reportRoom(id, busy) {
    try {
      await api.post(`/rooms/${id}/report`, { user: user.id, busy });
      notify(busy ? `Thanks - ${id} marked in use for the next 30 min` : `Thanks - ${id} confirmed free`);
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function answerAudit(on) {
    try {
      const r = await api.post(`/rooms/${d.audit.roomId}/audit`, { user: user.id, on });
      notify(
        !on
          ? 'Thanks - all off.'
          : r.verified
            ? `Verified waste: ~${r.estimate.kw} kW, about ₹${r.inr} until the next class. Logged in FixIt.`
            : 'Thanks - the room is in use, so that’s not waste.'
      );
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  if (!d) return <div className="card">Loading rooms…</div>;
  const buildings = [...new Set(d.rooms.map((r) => r.building ?? r.placeName))];
  const free = d.rooms.filter((r) => r.state === 'free').length;
  const shown = d.rooms.filter((r) => (building === 'all' || (r.building ?? r.placeName) === building) && (!freeOnly || r.state === 'free'));

  return (
    <div>
      {d.audit && (
        <section className="card audit">
          <div>
            <span className="badge cat-energy">Energy check · 5 seconds</span>
            <h2>{d.audit.question}</h2>
            <p className="muted small">
              The timetable says {d.audit.roomId} ({d.audit.placeName}) is empty and nobody reported it in use. If the AC or lights are on, that’s about{' '}
              <strong>{d.audit.estimate.kw} kW</strong>, or <strong>₹{d.audit.estimate.inr}</strong> until the next class.
            </p>
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => answerAudit(true)}>Yes, something’s on</button>
            <button className="btn" onClick={() => answerAudit(false)}>No, all off</button>
          </div>
        </section>
      )}

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Free rooms right now</span>
          <span className="stat-value">{free} / {d.rooms.length}</span>
          <span className="stat-sub muted">timetable + student reports</span>
        </div>
        <div className="stat">
          <span className="stat-label">Energy waste verified (7 days)</span>
          <span className="stat-value">₹{d.energy.inr.toLocaleString()}</span>
          <span className="stat-sub muted">{d.energy.verified} empty rooms with AC/lights on · {d.energy.kwh} kWh</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Rooms</h2>
          <label className="toggle small">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            Free now only
          </label>
        </div>
        <div className="filters">
          {['all', ...buildings].map((b) => (
            <button key={b} className={`chip ${building === b ? 'chip-on' : ''}`} onClick={() => setBuilding(b)}>
              {b === 'all' ? 'All buildings' : b}
            </button>
          ))}
        </div>
        {shown.length === 0 && <p className="muted small">No rooms match. Try another building or untick “Free now only”.</p>}
        <ul className="rooms">
          {shown.map((r) => (
            <li key={r.id} className={`room ${STATE[r.state].cls}`}>
              <div className="room-top">
                <strong>{r.id}</strong>
                <span className="muted small">{r.seats} seats</span>
              </div>
              <span className="room-state">{STATE[r.state].label}</span>
              <span className="muted small">
                {r.state === 'free' && `until ${fmtTime(r.freeUntil)}`}
                {r.state === 'class' && `${r.current.course} until ${fmtTime(r.current.end)}`}
                {r.state === 'booked' && `Study Match until ${fmtTime(r.bookedUntil)}`}
                {r.verifiedAt && ` · confirmed ${timeAgo(r.verifiedAt)}`}
              </span>
              {(r.state === 'free' || r.state === 'occupied') && (
                <div className="btn-row">
                  <button className="btn small" onClick={() => reportRoom(r.id, r.state === 'free')}>
                    {r.state === 'free' ? 'Actually in use' : 'It’s free now'}
                  </button>
                  {r.state === 'free' && !r.verifiedAt && (
                    <button className="btn small" onClick={() => reportRoom(r.id, false)}>Confirm free</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <p className="muted tiny">Rooms, capacities and classes: IITH Academic Office classroom sheet, Jul–Nov 2026 (imported into server/timetable.json).</p>
    </div>
  );
}
