import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSocket } from '../socket.js';
import { fmtDay, fmtTime } from '../util.js';

const MESS_KEY = 'pulse.mess';

export default function Mess({ meta, user, notify }) {
  const [d, setD] = useState(null);
  const [mess, setMess] = useState(() => {
    try {
      return localStorage.getItem(MESS_KEY) || meta.messes[0].id;
    } catch {
      return meta.messes[0].id;
    }
  });
  const load = useCallback(() => api.get(`/mess?user=${encodeURIComponent(user.id)}`).then(setD).catch(() => {}), [user.id]);
  useEffect(() => {
    load();
  }, [load]);
  useSocket('mess:update', load);

  function pickMess(id) {
    setMess(id);
    try {
      localStorage.setItem(MESS_KEY, id);
    } catch {}
  }

  async function toggle(m) {
    const skip = !m.mine;
    try {
      await api.post('/mess/optout', { user: user.id, meal: m.meal, date: m.date, mess, skip });
      notify(skip ? `Skipping ${m.label.toLowerCase()} - thanks, that's ~0.45 kg of food not cooked for nobody` : `Back in for ${m.label.toLowerCase()}`);
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  if (!d) return <div className="card">Loading mess forecast…</div>;

  return (
    <div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Not eating in the mess?</h2>
            <p className="muted small">One tap tells the kitchen. Opt-outs close when the meal starts.</p>
          </div>
          <label className="mess-pick small">
            My mess
            <select value={mess} onChange={(e) => pickMess(e.target.value)}>
              {meta.messes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="meal-buttons">
          {d.meals.map((m) => (
            <button key={`${m.date}-${m.meal}`} className={`meal-btn ${m.mine ? 'skipped' : ''}`} onClick={() => toggle(m)} disabled={!m.open}>
              <strong>{m.mine ? `Skipping ${m.label.toLowerCase()} ✓` : `Skip ${m.label.toLowerCase()}`}</strong>
              <span className="muted small">
                {fmtDay(m.start)} · {fmtTime(m.start)}
                {m.mine ? ' · tap to undo' : ''}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Mess manager view</h2>
            <p className="muted small">
              Headcount forecast = registered diners minus opt-outs, times the usual turnout for that meal, adjusted for the academic calendar
              (weekends, long weekends, exam weeks) and past crowd data. “Cook for” covers the forecast plus one standard deviation.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="mess-table">
            <thead>
              <tr>
                <th>Meal</th>
                <th>Mess</th>
                <th>Opt-outs</th>
                <th>Expected</th>
                <th>Cook for</th>
                <th>Usual</th>
                <th>vs usual</th>
              </tr>
            </thead>
            <tbody>
              {d.meals.flatMap((m) =>
                m.perMess.map((f, i) => (
                  <tr key={`${m.date}-${m.meal}-${f.messId}`} className={i === 0 ? 'first' : ''}>
                    <td>{i === 0 && <><strong>{m.label}</strong><br /><span className="muted small">{fmtDay(m.start)}</span></>}</td>
                    <td>{f.messName}</td>
                    <td>{f.optOuts}</td>
                    <td><strong>{f.expected}</strong> <span className="muted small">±{f.sd}</span></td>
                    <td className="accent-text"><strong>{f.cookFor}</strong></td>
                    <td className="muted">{f.usual}</td>
                    <td className={f.changePct < 0 ? 'good-text' : f.changePct > 0 ? 'warn-text' : 'muted'}>
                      {f.changePct === 0 ? 'same' : `${f.changePct > 0 ? '+' : ''}${f.changePct}%`}
                      {f.kgSaved > 0 && <span className="muted small"> · {f.kgSaved} kg</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {d.meals.map(
          (m) =>
            m.factors.length > 0 && (
              <p key={`${m.date}-${m.meal}`} className="muted small">
                {m.label} ({fmtDay(m.start)}): {m.factors.join(' · ')}
              </p>
            )
        )}
        <div className="best">
          <span>Last 7 days, cooking to the forecast instead of the usual amount</span>
          <strong>
            {d.week.reductionPct}% less cooked · ≈ {d.week.kg.toLocaleString()} kg
          </strong>
        </div>
        <p className="muted tiny">
          Normal days change little. The gains come from long weekends (about 40% less) and opt-outs; in exam weeks the forecast says cook more, which avoids
          shortages. Baseline “usual” = typical weekday or weekend turnout + {Math.round(d.assumptions.usualBuffer * 100)}% buffer, {d.assumptions.kgPerPlate} kg per
          plate: assumptions until a mess manager shares real numbers.
        </p>
      </section>
    </div>
  );
}
