import { useId, useState } from 'react';
import { Crosshair } from 'lucide-react';
import type { Pilot } from '../services/data';
import { formatNumber, percent } from '../services/data';
import { PanelHeader } from './common';
export function ExplorationMap({
  pilots,
  onSelect,
}: {
  pilots?: Pilot[];
  onSelect: (pilot: Pilot) => void;
}) {
  const id = useId().replaceAll(':', '');
  const [hover, setHover] = useState<Pilot | null>(null);
  const points = (pilots || []).filter(
    (p) => p.observed_effect != null && p.confidence != null && p.audience_size != null,
  );
  const min = Math.min(0, ...points.map((p) => p.observed_effect!));
  const max = Math.max(0, ...points.map((p) => p.observed_effect!));
  const padding = (max - min || 0.1) * 0.15;
  const low = min - padding;
  const high = max + padding;
  const width = 700,
    height = 255;
  return (
    <section className="panel exploration-map">
      <PanelHeader
        title="The evidence landscape"
        label="Exploration map"
        action={<Crosshair size={18} className="muted" />}
      />
      <div className="plot-wrap">
        <div className="y-label">CONFIDENCE</div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={
            points.length
              ? 'Pilot effect against confidence. Select a point for details.'
              : 'No exploration points available'
          }
        >
          <defs>
            <pattern id={id} width="35" height="35" patternUnits="userSpaceOnUse">
              <path d="M 35 0 L 0 0 0 35" fill="none" stroke="currentColor" strokeWidth=".5" />
            </pattern>
          </defs>
          <rect x="40" y="15" width="635" height="200" fill={`url(#${id})`} className="plot-grid" />
          <line x1="40" y1="215" x2="675" y2="215" className="plot-axis" />
          <line x1="40" y1="15" x2="40" y2="215" className="plot-axis" />
          {points.length > 0 && (
            <>
              <text x="29" y="23" textAnchor="end">
                100%
              </text>
              <text x="29" y="214" textAnchor="end">
                0%
              </text>
              <text x="40" y="235">
                {percent(low)}
              </text>
              <text x="675" y="235" textAnchor="end">
                {percent(high)}
              </text>
              {points.map((p) => (
                <circle
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.name || p.id}, effect ${percent(p.observed_effect)}, confidence ${percent(p.confidence)}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(p);
                    }
                  }}
                  onClick={() => onSelect(p)}
                  onMouseEnter={() => setHover(p)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(p)}
                  onBlur={() => setHover(null)}
                  cx={45 + ((p.observed_effect! - low) / (high - low)) * 620}
                  cy={210 - p.confidence! * 185}
                  r={Math.min(17, Math.max(5, Math.sqrt(p.audience_size!) / 8))}
                  className={`plot-point ${p.status || 'testing'}`}
                />
              ))}
            </>
          )}
        </svg>
        {!points.length && (
          <div className="plot-empty">
            <Crosshair size={24} strokeWidth={1.3} />
            <strong>Evidence comes first.</strong>
            <span>Real pilot effects and confidence will shape this map.</span>
          </div>
        )}
        {hover && (
          <div className="plot-tooltip">
            <strong>{hover.name || hover.id}</strong>
            <span>
              Effect {percent(hover.observed_effect)} · Confidence {percent(hover.confidence)}
            </span>
            <span>{formatNumber(hover.audience_size)} in segment</span>
          </div>
        )}
        <div className="x-label">
          OBSERVED EFFECT <span>→</span>
        </div>
      </div>
      <div className="plot-legend">
        <span>
          <i className="legend-dot campaigns" />
          Selected / promoted
        </span>
        <span>
          <i className="legend-dot exploration" />
          Testing / uncertain
        </span>
        <span>
          <i className="legend-dot rejected" />
          Rejected
        </span>
        <span className="legend-size">Size = segment audience</span>
      </div>
      {pilots?.length && points.length < pilots.length ? (
        <p className="plot-disclaimer">
          {pilots.length - points.length} pilots are not plotted because effect, confidence or
          audience size was not provided.
        </p>
      ) : null}
    </section>
  );
}
