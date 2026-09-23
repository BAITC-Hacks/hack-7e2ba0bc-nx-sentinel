import { useState } from 'react';
import { ArrowUpRight, FlaskConical } from 'lucide-react';
import type { Pilot, Snapshot } from '../services/data';
import { formatNumber, percent } from '../services/data';
import { ChannelPill, EmptyState, TargetTags, Transition } from '../components/common';
import { ExplorationMap } from '../components/ExplorationMap';
export function Pilots({
  snapshot,
  onSelect,
}: {
  snapshot: Snapshot | null;
  onSelect: (pilot: Pilot) => void;
}) {
  const [filter, setFilter] = useState('all');
  const pilots = snapshot?.pilots;
  const options = [
    'all',
    ...new Set((pilots || []).map((p) => p.status).filter((s): s is NonNullable<typeof s> => !!s)),
  ];
  const visible = (pilots || []).filter((p) => filter === 'all' || p.status === filter);
  return (
    <>
      <div className="page-intro">
        <span className="section-number">03 / ADAPTIVE EXPLORATION</span>
        <h2>Test small. Learn what matters.</h2>
        <p>Follow the hypotheses, measured effects and uncertainty behind the next decision.</p>
      </div>
      <ExplorationMap pilots={pilots} onSelect={onSelect} />
      <div className="section-heading">
        <h2>
          Pilot experiments <span className="count-badge">{formatNumber(pilots?.length)}</span>
        </h2>
        <div className="segmented-control" aria-label="Filter pilot decisions">
          {options.map((option) => (
            <button
              key={option}
              className={filter === option ? 'active' : ''}
              onClick={() => setFilter(option)}
              aria-pressed={filter === option}
            >
              {option.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      </div>
      {visible.length ? (
        <div className="pilot-list">
          {visible.map((pilot) => (
            <button className="pilot-row" key={pilot.id} onClick={() => onSelect(pilot)}>
              <div className="pilot-identity">
                <span className="pilot-icon">
                  <FlaskConical size={20} />
                </span>
                <div>
                  <span className="pilot-id">{pilot.name || pilot.id}</span>
                  <TargetTags campaign={pilot} />
                </div>
              </div>
              <Transition from={pilot.targeting?.current_tariff} to={pilot.target_tariff} />
              <ChannelPill channel={pilot.channel} />
              <div className="pilot-stat">
                <small>Sample</small>
                <strong>{formatNumber(pilot.sample_size)}</strong>
              </div>
              <div className="pilot-stat">
                <small>Observed effect</small>
                <strong
                  className={
                    pilot.observed_effect != null
                      ? pilot.observed_effect >= 0
                        ? 'positive-text'
                        : 'negative-text'
                      : ''
                  }
                >
                  {percent(pilot.observed_effect)}
                </strong>
              </div>
              <span className={`decision-label ${pilot.status || ''}`}>
                {pilot.status?.replaceAll('_', ' ') || 'Unreported'}
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            icon="pilots"
            title={
              pilots?.length
                ? 'No pilots match this filter'
                : 'A little exploration. A lot to learn.'
            }
            description={
              pilots?.length
                ? 'Choose another decision status to see the remaining pilots.'
                : 'Once the agent runs real pilots, their audience, cost and observed outcomes will appear here.'
            }
          />
        </section>
      )}
    </>
  );
}
