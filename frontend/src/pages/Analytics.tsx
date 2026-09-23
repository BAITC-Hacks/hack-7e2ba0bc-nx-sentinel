import { Bell, Globe2, MessageSquare, Phone } from 'lucide-react';
import type { Pilot, Snapshot } from '../services/data';
import { formatNumber } from '../services/data';
import { BudgetPanel } from '../components/BudgetPanel';
import { ExplorationMap } from '../components/ExplorationMap';
import { EmptyState, PanelHeader } from '../components/common';
export function Analytics({
  snapshot,
  onSelect,
}: {
  snapshot: Snapshot | null;
  onSelect: (pilot: Pilot) => void;
}) {
  const channels = snapshot?.channels;
  const icons = { push: Bell, sms: MessageSquare, digital_ads: Globe2, call: Phone };
  const maxCost = Math.max(1, ...(channels || []).map((c) => c.cost || 0));
  return (
    <>
      <div className="page-intro">
        <span className="section-number">05 / ECONOMICS & EVIDENCE</span>
        <h2>Understand the trade-offs.</h2>
        <p>Read measured effects alongside channel economics and resource allocation.</p>
      </div>
      <ExplorationMap pilots={snapshot?.pilots} onSelect={onSelect} />
      <div className="analytics-grid">
        <section className="panel channel-panel">
          <PanelHeader label="Cost versus reach" title="Channel economics" />
          {channels?.length ? (
            <div className="channel-list">
              {channels.map((channel) => {
                const Icon = icons[channel.id as keyof typeof icons] || Globe2;
                return (
                  <div className="channel-economics" key={channel.id}>
                    <div className="channel-economics-title">
                      <Icon size={18} />
                      <strong>{channel.name || channel.id}</strong>
                    </div>
                    <div className="channel-numbers">
                      <span>
                        Cost / contact<strong>{formatNumber(channel.cost, 2)}</strong>
                      </span>
                      <span>
                        Effectiveness
                        <strong>
                          {channel.effectiveness != null
                            ? `${formatNumber(channel.effectiveness, 2)}×`
                            : '—'}
                        </strong>
                      </span>
                    </div>
                    <div className="resource-track">
                      <span
                        style={{
                          width: `${channel.cost == null ? 0 : (channel.cost / maxCost) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              compact
              icon="analytics"
              title="The right channel is an economic choice"
              description="Channel costs and effectiveness appear when supplied by your source. No channel is assumed to be the best."
            />
          )}
        </section>
        <BudgetPanel snapshot={snapshot} expanded />
      </div>
    </>
  );
}
