import { levelColor, levelLabel } from '../util.js';

// Schematic (not to scale) campus map. Positions come from server/src/places.js.
export default function CampusMap({ places, selected, onSelect }) {
  return (
    <svg className="map" viewBox="0 0 100 100" role="img" aria-label="Campus crowd map">
      <defs>
        <radialGradient id="glow">
          <stop offset="0%" stopColor="#e6ff00" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#e6ff00" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" rx="3" className="map-bg" />
      <circle cx="55" cy="45" r="45" fill="url(#glow)" />
      {/* zones */}
      <rect x="6" y="18" width="34" height="54" rx="3" className="zone" />
      <text x="8" y="22.5" className="zone-label">HOSTEL ZONE</text>
      <rect x="58" y="14" width="34" height="44" rx="3" className="zone" />
      <text x="90" y="56.5" className="zone-label" textAnchor="end">ACADEMIC ZONE</text>
      <rect x="8" y="74" width="40" height="18" rx="3" className="zone" />
      <text x="46" y="78" className="zone-label" textAnchor="end">SPORTS</text>
      {/* lake + roads (decorative) */}
      <ellipse cx="62" cy="80" rx="12" ry="6" className="lake" />
      <path d="M2 50 C 30 48, 45 52, 60 50 S 90 45, 98 40" className="road" />
      <path d="M45 98 C 46 75, 50 60, 55 45 S 70 15, 90 10" className="road" />
      <path d="M20 10 C 22 40, 25 70, 22 95" className="road thin" />

      {places.map((p) => {
        const color = levelColor(p.live.level);
        const r = 2.2 + Math.log10(p.capacity) * 0.9;
        const isSel = selected === p.id;
        return (
          <g
            key={p.id}
            className={`pin ${isSel ? 'sel' : ''} ${p.open ? '' : 'closed'}`}
            transform={`translate(${p.x} ${p.y})`}
            onClick={() => onSelect(p.id)}
            tabIndex={0}
            role="button"
            aria-label={`${p.name}: ${levelLabel(p.live.level)}`}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(p.id)}
          >
            {p.live.source === 'live' && p.open && <circle r={r} fill={color} className="ping" />}
            <circle r={r + 1.2} fill={color} opacity="0.18" />
            <circle r={r} fill={color} stroke={isSel ? '#fff' : '#0b0b0c'} strokeWidth={isSel ? 0.6 : 0.4} />
            <text y={r + 3.6} className="pin-label">{p.name.replace('Main Gate ', '')}</text>
          </g>
        );
      })}
    </svg>
  );
}
