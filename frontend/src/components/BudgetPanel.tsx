import { ArrowUpRight, Coins, Fingerprint, FlaskConical } from 'lucide-react';
import { availableRemaining, formatNumber } from '../services/data';
import type { Snapshot } from '../services/data';
import { PanelHeader } from './common';
export function BudgetPanel({
  snapshot,
  expanded = false,
}: {
  snapshot: Snapshot | null;
  expanded?: boolean;
}) {
  const budget = snapshot?.budget;
  const remaining =
    budget?.remaining ??
    (budget?.total != null && budget.exploration_spent != null && budget.campaigns_allocated != null
      ? budget.total - budget.exploration_spent - budget.campaigns_allocated
      : undefined);
  const allocations = [
    { name: 'Exploration', value: budget?.exploration_spent, kind: 'exploration' },
    { name: 'Campaigns', value: budget?.campaigns_allocated, kind: 'campaigns' },
    { name: 'Remaining', value: remaining, kind: 'remaining' },
  ];
  const known = budget?.total != null && budget.total > 0;
  const valuesKnown = allocations.every((item) => item.value != null);
  const exceeds =
    (remaining != null && remaining < 0) ||
    (known && allocations.reduce((sum, item) => sum + (item.value || 0), 0) > budget!.total!);
  return (
    <section className={`panel budget-panel ${expanded ? 'expanded' : ''}`}>
      <PanelHeader
        label="Resource control"
        title="Budget intelligence"
        action={<Coins className="muted" size={19} />}
      />
      <div className="budget-total">
        <span>Total budget {budget?.currency && <small>· {budget.currency}</small>}</span>
        <strong>{formatNumber(budget?.total)}</strong>
        <span className="tiny muted">
          {budget ? 'Reported by your source' : 'Waiting for resource data'}
        </span>
      </div>
      <div
        className={`allocation-bar ${!known || !valuesKnown ? 'allocation-empty' : ''}`}
        role="img"
        aria-label={
          known && valuesKnown
            ? allocations.map((i) => `${i.name}: ${formatNumber(i.value)}`).join(', ')
            : 'Budget allocation not available'
        }
      >
        {known &&
          valuesKnown &&
          allocations.map((item) => (
            <span
              key={item.name}
              className={item.kind}
              style={{
                width: `${Math.max(0, Math.min(100, (item.value! / budget!.total!) * 100))}%`,
              }}
            />
          ))}
      </div>
      <div className="allocation-legend">
        {allocations.map((item) => (
          <div key={item.name}>
            <span>
              <i className={`legend-dot ${item.kind}`} />
              {item.name}
            </span>
            <strong className={item.value != null && item.value < 0 ? 'negative-text' : ''}>
              {formatNumber(item.value)}
            </strong>
          </div>
        ))}
      </div>
      {exceeds && (
        <p className="inline-warning">Reported allocations exceed the available budget.</p>
      )}
      <div className="resource-divider" />
      <Resource title="Contacts" icon={<Fingerprint size={16} />} resource={snapshot?.contacts} />
      <Resource title="Pilots" icon={<FlaskConical size={16} />} resource={snapshot?.pilot_limit} />
      <div className="budget-footnote">
        <ArrowUpRight size={13} />
        <span>Exploration and final campaigns share the same resources.</span>
      </div>
    </section>
  );
}
function Resource({
  title,
  icon,
  resource,
}: {
  title: string;
  icon: React.ReactNode;
  resource?: { total?: number; used?: number; remaining?: number };
}) {
  const remaining = availableRemaining(resource);
  const ratio =
    resource?.total && resource.used != null ? resource.used / resource.total : undefined;
  return (
    <div className="resource">
      <div className="resource-top">
        <span>
          {icon}
          {title}
        </span>
        <strong>
          {formatNumber(resource?.used)}
          <span> / {formatNumber(resource?.total)}</span>
        </strong>
      </div>
      <div className="resource-track">
        {ratio != null && <span style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} />}
      </div>
      <div className="resource-bottom">
        {remaining != null ? `${formatNumber(remaining)} remaining` : 'Usage not available'}
      </div>
    </div>
  );
}
