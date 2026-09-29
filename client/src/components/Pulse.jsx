import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useSocket } from '../socket.js';
import { levelColor, levelLabel, fmtHour, fmtTime, timeAgo, LEVEL_LABELS, LEVEL_COLORS } from '../util.js';
import CampusMap from './CampusMap.jsx';
import HourBars from './HourBars.jsx';

export default function Pulse({ meta, user, notify }) {
  const [pulse, setPulse] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState('all');
  const [suggestion, setSuggestion] = useState(null);
  const [trust, setTrust] = useState(null);

  const loadPulse = useCallback(() => api.get('/pulse').then(setPulse).catch(() => {}), []);
  const loadSuggestion = useCallback(() => api.get(`/suggest?kind=study&user=${encodeURIComponent(user.id)}`).then(setSuggestion).catch(() => {}), [user.id]);
  const loadTrust = useCallback(() => api.get(`/trust?user=${encodeURIComponent(user.id)}`).then(setTrust).catch(() => {}), [user.id]);
  useEffect(() => {
    loadSuggestion();
    loadTrust();
  }, [loadSuggestion, loadTrust]);
  const loadDetail = useCallback((id) => id && api.get(`/places/${id}`).then(setDetail).catch(() => {}), []);

  useEffect(() => {
    loadPulse();
    const t = setInterval(loadPulse, 60_000); // forecasts drift with the clock
    return () => clearInterval(t);
  }, [loadPulse]);

  useEffect(() => {
    setDetail(null);
    loadDetail(selected);
  }, [selected, loadDetail]);
  // On phones the detail panel sits below the map: bring it into view.
  const sideRef = useRef(null);
  useEffect(() => {
    if (selected && detail && window.innerWidth < 860) sideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected, Boolean(detail)]);

  useSocket('pulse:update', ({ placeId }) => {
    loadPulse();
    loadSuggestion();
    if (placeId === selected) loadDetail(selected);
  });

  const places = pulse?.places ?? [];
  const types = useMemo(() => ['all', ...new Set(meta.places.map((p) => p.type))], [meta]);
  const shown = places.filter((p) => filter === 'all' || p.type === filter);

  const openNow = places.filter((p) => p.open && p.live.level != null);
  const busiest = [...openNow].sort((a, b) => b.live.level - a.live.level)[0];

  async function report(level, as = user.id) {
    try {
      const r = await api.post('/reports', { placeId: selected, level, user: as });
      const moved = `${levelLabel(r.before)} (${r.before}) → ${levelLabel(r.place.live.level)} (${r.place.live.level})`;
      notify(
        as === user.id
          ? `Thanks! ${detail.name}: ${moved}. Your reporter trust: ${Math.round(r.trust * 100)}%.`
          : `Spam from a fresh account (trust ${Math.round(r.trust * 100)}%): ${moved}`
      );
      loadDetail(selected);
      loadPulse();
      loadTrust();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  if (!pulse) return <div className="card">Loading live campus data…</div>;

  return (
    <>
      <section className="stats">
        <Stat
          label="Suggested study spot for you"
          value={suggestion?.name ?? '-'}
          sub={
            suggestion &&
            (suggestion.when === 'now'
              ? `${levelLabel(suggestion.level)} · go now`
              : `Go in ${suggestion.delayMin} min: ${suggestion.sentRecently} students were just sent there`)
          }
          color={suggestion && levelColor(suggestion.level)}
          onClick={() => suggestion && setSelected(suggestion.placeId)}
        />
        <Stat label="Busiest right now" value={busiest?.name ?? '-'} sub={busiest && levelLabel(busiest.live.level)} color={busiest && levelColor(busiest.live.level)} onClick={() => busiest && setSelected(busiest.id)} />
        <Stat label="Crowd reports, last hour" value={pulse.reportsLastHour} sub={`from ${pulse.contributorsLastHour} students`} />
      </section>

      <Surges surges={pulse.surges} day={pulse.day} onSelect={setSelected} />

      <div className="pulse-grid">
        <section className="card map-card">
          <div className="card-head">
            <h2>Live campus map</h2>
            <div className="legend">
              {LEVEL_LABELS.slice(1).map((l, i) => (
                <span key={l}><i style={{ background: LEVEL_COLORS[i + 1] }} />{l}</span>
              ))}
            </div>
          </div>
          <CampusMap places={places} selected={selected} onSelect={setSelected} />
          <p className="muted small">Schematic map, not to scale. Tap a place to see details and report how busy it is.</p>
        </section>

        <section className="card side" ref={sideRef}>
          {selected && detail ? (
            <PlaceDetail
              detail={detail}
              trust={trust}
              onBack={() => setSelected(null)}
              onReport={report}
              onSpam={meta.demoMode && !meta.auth.required ? () => report(5, `spam-${Math.random().toString(36).slice(2, 8)}`) : null}
            />
          ) : selected ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="card-head">
                <h2>All places</h2>
              </div>
              <div className="filters">
                {types.map((t) => (
                  <button key={t} className={`chip ${filter === t ? 'chip-on' : ''}`} onClick={() => setFilter(t)}>
                    {t === 'all' ? 'All' : meta.placeTypes[t] ?? t}
                  </button>
                ))}
              </div>
              <ul className="place-list">
                {shown.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setSelected(p.id)} className={p.open ? '' : 'closed'}>
                      <span className="dot" style={{ background: levelColor(p.live.level) }} />
                      <span className="pl-name">
                        {p.name}
                        <small>
                          {p.open ? (p.live.source === 'live' ? `${p.live.reports} live reports` : p.live.source === 'timetable' ? 'timetable forecast' : 'forecast') : 'closed now'}
                        </small>
                      </span>
                      <span className="pl-level" style={{ color: levelColor(p.live.level) }}>
                        {p.open ? levelLabel(p.live.level) : '-'}
                        {p.open && p.trend !== 0 && <small>{p.trend > 0 ? ' ↑' : ' ↓'}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, sub, color, onClick }) {
  return (
    <button className="stat" onClick={onClick} disabled={!onClick}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub" style={color ? { color } : undefined}>{sub}</span>}
    </button>
  );
}

const summarize = (list, n = 3) => (list.length > n ? `${list.slice(0, n).join(', ')} +${list.length - n} more` : list.join(', '));

/** Crowd surges predicted from the timetable: nobody has to tap anything. */
function Surges({ surges, day, onSelect }) {
  const groups = [];
  for (const s of surges) {
    const key = `${s.fromPlaceId}|${s.leaveAt}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, leaveAt: s.leaveAt, fromName: s.fromName, leaving: s.leaving, classes: s.classes, to: [] }));
    g.to.push(s);
  }
  return (
    <section className="card surges">
      <div className="card-head">
        <div>
          <h2>Coming up, from the timetable</h2>
          <p className="muted small">
            Predicted before anyone reports: class exits and where students head next.
            {day?.exam && ' Exam week: no classes.'}
            {day?.holiday && ' Holiday: no classes.'}
          </p>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="muted small">No class exits in the next 3 hours{day && !day.classes ? ' (no classes today)' : ''}.</p>
      ) : (
        <ul className="surge-list">
          {groups.slice(0, 4).map((g) => (
            <li key={g.key}>
              <span className="surge-time">{fmtTime(g.leaveAt)}</span>
              <span>
                <strong>{g.leaving} students</strong> leave {g.fromName} <span className="muted small">({summarize([...new Set(g.classes)])})</span>
                <span className="surge-to">
                  {g.to.map((s) => (
                    <button key={s.placeId} className="chip" onClick={() => onSelect(s.placeId)} title={`${s.pctOfCapacity}% of capacity`}>
                      {s.placeName} +{s.people} at {fmtTime(s.at)}
                    </button>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlaceDetail({ detail, trust, onBack, onReport, onSpam }) {
  const d = detail;
  const nowHour = d.upcoming.slots[0]?.hour;
  const best = d.bestTime;
  const lvl = d.live.level;
  return (
    <div className="detail">
      <button className="link" onClick={onBack}>← All places</button>
      <h2>{d.name}</h2>
      <p className="muted small">
        Capacity ~{d.capacity} · Open {fmtHour(d.openHours[0])}–{fmtHour(d.openHours[1])}
      </p>

      <div className="big-level" style={{ borderColor: levelColor(lvl) }}>
        <span className="bl-label" style={{ color: levelColor(lvl) }}>{d.open ? levelLabel(lvl) : 'Closed'}</span>
        <span className="muted small">
          {d.live.source === 'live'
            ? `Based on ${d.live.reports} reporter${d.live.reports > 1 ? 's' : ''} in the last 45 min, weighted by trust · updated ${timeAgo(d.live.lastReportAt)}`
            : d.live.source === 'timetable'
              ? 'No recent reports - predicted from the timetable'
              : 'No recent reports - showing the usual level for this hour'}
        </span>
        {d.occupancyEstimate != null && d.open && <span className="small">≈ {d.occupancyEstimate} people</span>}
        {d.timetable && <span className="muted small">Timetable: ~{d.timetable.people} from {d.timetable.reasons.slice(0, 3).join(', ')}</span>}
      </div>

      {best && (
        <div className="best">
          <span>Best time in the next 6 h</span>
          <strong>
            {best.hour === nowHour ? 'Now' : fmtHour(best.hour)} · {levelLabel(best.level)}
          </strong>
        </div>
      )}

      <h3>Typical crowd today</h3>
      <HourBars data={d.today} nowHour={nowHour} openHours={d.openHours} bestHour={best?.hour} />

      {d.open && (
        <>
          <h3>How busy is it right now?</h3>
          <div className="report-row">
            {[1, 2, 3, 4, 5].map((l) => (
              <button key={l} onClick={() => onReport(l)} style={{ '--c': LEVEL_COLORS[l] }} className="report-btn">
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>
          <p className="muted small">
            Reports are anonymous and weighted by each reporter's track record: reports that match others and the timetable earn trust, so trolls fade out.
            {trust && ` Your trust: ${Math.round(trust.trust * 100)}%${trust.isNew ? ' (new reporter)' : ` from ${trust.reports} reports`}.`}
          </p>
          {onSpam && (
            <button className="btn small" onClick={onSpam} title="Demo: send 'Packed' from a brand-new account">
              Demo: spam “Packed” from a new account
            </button>
          )}
        </>
      )}

      {d.recent.length > 0 && (
        <>
          <h3>Recent reports</h3>
          <ul className="recent">
            {d.recent.slice(0, 5).map((r, i) => (
              <li key={i}>
                <span className="dot" style={{ background: levelColor(r.level) }} /> {LEVEL_LABELS[r.level]}
                <span className="muted small"> · {timeAgo(r.ts)} · trust {r.trust}%{r.mine ? ' · you' : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
