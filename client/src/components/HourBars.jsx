import { levelColor, fmtHour, levelLabel } from '../util.js';

/** Hour-by-hour crowd bars. `data` = [{ hour, level }] ; highlights `nowHour`. */
export default function HourBars({ data, nowHour, openHours = [0, 24], bestHour }) {
  const visible = data.filter((d) => d.hour >= openHours[0] && d.hour < openHours[1]);
  return (
    <div className="hourbars" role="list">
      {visible.map((d) => {
        const h = d.level ? (d.level / 5) * 100 : 4;
        return (
          <div
            key={d.hour}
            role="listitem"
            className={`hb ${d.hour === nowHour ? 'now' : ''} ${d.hour === bestHour ? 'hb-best' : ''}`}
            title={`${fmtHour(d.hour)}: ${levelLabel(d.level)}${d.level ? ` (${d.level})` : ''}`}
          >
            <div className="hb-bar" style={{ height: `${h}%`, background: levelColor(d.level) }} />
            <span className="hb-x">{d.hour % 3 === 0 || d.hour === nowHour ? fmtHour(d.hour) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}
