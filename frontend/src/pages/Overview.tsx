import { ArrowRight, Database, FlaskConical, Layers3, PlugZap, Users, Wallet } from 'lucide-react';
import type { Campaign, Section, Snapshot } from '../services/data';
import { availableRemaining, formatNumber } from '../services/data';
import {
  DecisionMark,
  EmptyState,
  Eyebrow,
  ImportButton,
  Metric,
  PanelHeader,
  Transition,
  WorkflowStrip,
} from '../components/common';
import { BudgetPanel } from '../components/BudgetPanel';
import { Timeline } from '../components/Timeline';
export function Overview({
  snapshot,
  onConnect,
  onImport,
  navigate,
  onSelect,
}: {
  snapshot: Snapshot | null;
  onConnect: () => void;
  onImport: () => void;
  navigate: (section: Section) => void;
  onSelect: (campaign: Campaign) => void;
}) {
  const audience = snapshot?.audience_total ?? snapshot?.audience?.length;
  const budget = snapshot?.budget;
  const remainingBudget =
    budget?.remaining ??
    (budget?.total != null && budget.exploration_spent != null && budget.campaigns_allocated != null
      ? budget.total - budget.exploration_spent - budget.campaigns_allocated
      : undefined);
  return (
    <>
      <section className="command-hero">
        <div className="hero-copy">
          <Eyebrow>
            <span className="yellow-dash" />
            From audience to opportunity
          </Eyebrow>
          <h2>
            Better campaigns.
            <br />
            <span>Grounded in evidence.</span>
          </h2>
          <p>
            One workspace to explore your audience, test the possibilities and turn what you learn
            into a campaign plan.
          </p>
          <div className="hero-actions">
            {snapshot ? (
              <button className="button primary" onClick={() => navigate('campaigns')}>
                Explore campaign plan
                <ArrowRight size={15} />
              </button>
            ) : (
              <button className="button primary" onClick={onConnect}>
                <PlugZap size={16} />
                Connect your data
                <ArrowRight size={15} />
              </button>
            )}
            <ImportButton onClick={onImport} />
          </div>
          <div className="hero-caption">
            <Database size={12} />
            {snapshot
              ? 'Your source. Your evidence. Your decisions.'
              : 'Your data stays the source of truth.'}
          </div>
        </div>
        <DecisionMark />
      </section>
      <div className="metrics-strip">
        <Metric
          icon={<Users size={15} />}
          label="Addressable audience"
          value={formatNumber(audience)}
          note={
            audience != null ? 'Subscribers in the supplied data' : 'Connect an audience source'
          }
        />
        <Metric
          icon={<Wallet size={15} />}
          label="Budget remaining"
          value={formatNumber(remainingBudget)}
          note={budget?.currency || 'Awaiting budget allocation'}
        />
        <Metric
          icon={<FlaskConical size={15} />}
          label="Pilots conducted"
          value={formatNumber(snapshot?.pilot_limit?.used ?? snapshot?.pilots?.length)}
          note={
            availableRemaining(snapshot?.pilot_limit) != null
              ? `${formatNumber(availableRemaining(snapshot?.pilot_limit))} pilots remaining`
              : 'Evidence before commitment'
          }
        />
        <Metric
          icon={<Layers3 size={15} />}
          label="Campaigns selected"
          value={formatNumber(snapshot?.campaigns?.length)}
          note={
            snapshot?.campaigns ? 'In the current campaign plan' : 'A portfolio built from signals'
          }
        />
      </div>
      <div className="section-heading">
        <div>
          <Eyebrow>The agent's decision loop</Eyebrow>
          <h2>From signal to selection</h2>
        </div>
        <span className="subtle-tag">Explore → learn → decide</span>
      </div>
      <WorkflowStrip snapshot={snapshot} navigate={navigate} />
      <div className="overview-lower">
        <Timeline snapshot={snapshot} onViewAll={() => navigate('agent')} />
        <BudgetPanel snapshot={snapshot} />
      </div>
      <section className="panel portfolio-preview">
        <PanelHeader
          label="The outcome"
          title="Your campaign portfolio"
          action={
            <button className="text-button" onClick={() => navigate('campaigns')}>
              Open campaigns
              <ArrowRight size={14} />
            </button>
          }
        />
        {snapshot?.campaigns?.length ? (
          <div className="preview-list">
            {snapshot.campaigns.slice(0, 3).map((campaign, i) => (
              <button key={campaign.id} onClick={() => onSelect(campaign)}>
                <span className="row-number">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{campaign.name || `Campaign ${String(i + 1).padStart(2, '0')}`}</strong>
                  <Transition
                    from={campaign.targeting?.current_tariff}
                    to={campaign.target_tariff}
                  />
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon="campaigns"
            title="The best next move is still ahead"
            description="Selected campaigns will appear here with their targeting, economics and supporting evidence."
          />
        )}
      </section>
    </>
  );
}
