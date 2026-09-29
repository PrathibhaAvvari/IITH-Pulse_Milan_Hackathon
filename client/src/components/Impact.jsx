import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSocket } from '../socket.js';

export default function Impact() {
  const [d, setD] = useState(null);
  const load = () => api.get('/impact').then(setD).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useSocket('issues:update', load);
  useSocket('study:update', load);
  useSocket('mess:update', load);
  useSocket('rooms:update', load);

  if (!d) return <div className="card">Loading impact…</div>;
  const { study, issues, crowd, food, energy } = d;
  const top = study.demand.filter((c) => c.need > 0).slice(0, 8);
  const max = Math.max(...top.map((c) => Math.max(c.need, c.helpers)), 1);

  return (
    <div>
      <div className="notice">
        Demo numbers: this dashboard starts from the simulated dataset created on first run (4 weeks of crowd reports, sample issues,
        36 demo students and a sample timetable). Food and energy figures are estimates from stated assumptions. It updates live as real students use the app.
      </div>

      <section className="kpis">
        <Kpi value={`${food.reductionPct}%`} label={`less food cooked this week with the mess forecast (≈ ${food.kg} kg)`} accent />
        <Kpi value={`₹${energy.inr.toLocaleString()}`} label={`energy waste verified in empty rooms (${energy.kwh} kWh)`} accent />
        <Kpi value={food.optOutsThisWeek} label="meal opt-outs this week" />
        <Kpi value={`${issues.verified}/${issues.resolved}`} label="fixes confirmed by students" />
        <Kpi value={issues.overdue} label="issues escalated past SLA" />
        <Kpi value={crowd.lowTrustReporters} label="unreliable reporters auto-down-weighted" />
        <Kpi value={study.sessionsDone} label="peer study sessions completed" />
        <Kpi value={study.studentsHelped} label="students helped" />
        <Kpi value={study.helpfulPct != null ? `${study.helpfulPct}%` : '-'} label="sessions rated helpful" />
        <Kpi value={study.crossYearPct != null ? `${study.crossYearPct}%` : '-'} label="sessions across years" />
        <Kpi value={issues.resolved} label="facility issues resolved" />
        <Kpi value={issues.medianResolutionHours != null ? `${issues.medianResolutionHours} h` : '-'} label="median time to fix" />
        <Kpi value={issues.energyReports} label="energy-waste reports" />
        <Kpi value={crowd.reportsThisWeek.toLocaleString()} label="crowd reports this week" />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Where students are struggling</h2>
            <p className="muted small">Students who need help vs. students who can help, per course. Big gaps are where TAs and faculty could add an extra tutorial.</p>
          </div>
          <div className="legend">
            <span><i style={{ background: '#fb923c' }} />Need help</span>
            <span><i style={{ background: '#22c55e' }} />Can help</span>
          </div>
        </div>
        <div className="demand">
          {top.map((c) => (
            <div key={c.id} className="demand-row">
              <span className="demand-name">
                {c.name}
                {c.gap >= 2 && <span className="gap-flag">gap ×{c.gap}</span>}
              </span>
              <div className="demand-bars">
                <div className="db need" style={{ width: `${(c.need / max) * 100}%` }}><span>{c.need}</span></div>
                <div className="db can" style={{ width: `${(c.helpers / max) * 100}%` }}><span>{c.helpers}</span></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Why this matters for IITH</h2>
        <ul className="why">
          <li><strong>Students</strong> skip queues: check which mess, gym or library floor is quiet before walking over.</li>
          <li><strong>Juniors</strong> get help from seniors in minutes, and <strong>skill swaps</strong> mean nobody feels like a burden. It builds connections across years and branches.</li>
          <li><strong>Faculty & TAs</strong> see which courses students struggle with, live and before the exams, not after.</li>
          <li><strong>Estate & maintenance</strong> get one de-duplicated, community-ranked issue queue instead of scattered emails and WhatsApp complaints.</li>
          <li><strong>Mess kitchens</strong> cook to a forecast (timetable calendar + opt-outs + past crowds) instead of a fixed amount: less food thrown away.</li>
          <li><strong>Sustainability without hardware</strong>: the timetable knows which rooms should be empty, and passers-by confirm if the AC or lights are on. Wi-Fi device counts can plug in later with IT permission.</li>
          <li><strong>Trust</strong>: reports are weighted by each reporter's track record, and a fix only counts once students confirm it.</li>
        </ul>
      </section>
    </div>
  );
}

function Kpi({ value, label, accent }) {
  return (
    <div className={`kpi ${accent ? 'accent' : ''}`}>
      <span className="kpi-v">{value}</span>
      <span className="kpi-l">{label}</span>
    </div>
  );
}
