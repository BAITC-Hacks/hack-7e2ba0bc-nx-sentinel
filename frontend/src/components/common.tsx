import {
  ArrowRight,
  Bell,
  CircleDot,
  Database,
  FileInput,
  Globe2,
  MessageSquare,
  Phone,
  Radar,
  Sparkles,
  Workflow,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { AgentState, Campaign, Section, Snapshot } from '../services/data';
import { formatNumber, isRunning } from '../services/data';
export const STATE_LABELS: Record<AgentState, string> = {
  INITIAL: 'Awaiting data',
  DATA_READY: 'Ready to run',
  AGENT_RUNNING: 'Analyzing',
  PILOT_RUNNING: 'Running pilots',
  OPTIMIZING: 'Optimizing',
  COMPLETED: 'Completed',
  FAILED: 'Run failed',
};
export function StatusBadge({
  state,
  connected = true,
}: {
  state?: AgentState;
  connected?: boolean;
}) {
  return (
    <span
      className={`status-badge ${!connected ? 'neutral' : state === 'FAILED' ? 'negative' : state === 'COMPLETED' ? 'positive' : isRunning(state) ? 'active' : 'neutral'}`}
    >
      <span className={isRunning(state) ? 'status-dot pulse' : 'status-dot'} />
      {!connected ? 'Not connected' : STATE_LABELS[state || 'INITIAL']}
    </span>
  );
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
export function PanelHeader({
  title,
  label,
  action,
}: {
  title: string;
  label?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        {label && <Eyebrow>{label}</Eyebrow>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  compact = false,
  action,
  icon = 'data',
}: {
  title: string;
  description: string;
  compact?: boolean;
  action?: ReactNode;
  icon?: 'data' | 'pilots' | 'campaigns' | 'analytics';
}) {
  const Icon = { data: Database, pilots: Radar, campaigns: Workflow, analytics: Sparkles }[icon];
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <div className="empty-symbol">
        <Icon size={23} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ChannelPill({ channel }: { channel: string }) {
  const Icon =
    { push: Bell, sms: MessageSquare, digital_ads: Globe2, call: Phone }[channel] || CircleDot;
  return (
    <span className={`channel-pill channel-${channel.replace(/[^a-z_]/gi, '')}`}>
      <Icon size={13} />
      {{ push: 'Push', sms: 'SMS', digital_ads: 'Digital ads', call: 'Call' }[channel] || channel}
    </span>
  );
}
export function Transition({ from, to }: { from?: string; to: string }) {
  return (
    <div className="tariff-transition">
      <span>{from || 'Current tariff not specified'}</span>
      <ArrowRight size={14} aria-label="to" />
      <strong>{to}</strong>
    </div>
  );
}
export function TargetTags({ campaign }: { campaign: Campaign }) {
  const values = Object.entries(campaign.targeting || {}).filter(
    ([key, value]) => key !== 'current_tariff' && value,
  );
  return (
    <div className="target-tags">
      {values.length ? (
        values.map(([key, value]) => (
          <span key={key} title={key.replaceAll('_', ' ')}>
            {value}
          </span>
        ))
      ) : (
        <span className="muted">Segment not provided</span>
      )}
    </div>
  );
}
export function Metric({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: ReactNode;
  note: string;
  icon: ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="metric-value">{value}</div>
      <span className="metric-note">{note}</span>
    </div>
  );
}
export function WorkflowStrip({
  snapshot,
  navigate,
}: {
  snapshot: Snapshot | null;
  navigate: (section: Section) => void;
}) {
  const items = [
    { icon: Database, label: 'Understand', sub: 'Audience & signals', route: 'audience' },
    { icon: Radar, label: 'Explore', sub: 'Hypotheses & pilots', route: 'pilots' },
    { icon: Sparkles, label: 'Learn', sub: 'Evidence & uncertainty', route: 'analytics' },
    { icon: Workflow, label: 'Select', sub: 'Campaign portfolio', route: 'campaigns' },
  ] as const;
  const current =
    snapshot?.state === 'DATA_READY' || snapshot?.state === 'AGENT_RUNNING'
      ? 0
      : snapshot?.state === 'PILOT_RUNNING'
        ? 1
        : snapshot?.state === 'OPTIMIZING'
          ? 2
          : snapshot?.state === 'COMPLETED'
            ? 3
            : -1;
  return (
    <div className="workflow-strip" aria-label="Agent decision workflow">
      {items.map((item, i) => (
        <button
          key={item.label}
          onClick={() => navigate(item.route)}
          className={`workflow-step ${current === i ? 'current' : ''}`}
        >
          <div className="workflow-icon">
            <item.icon size={19} strokeWidth={1.6} />
          </div>
          <div>
            <small>0{i + 1}</small>
            <strong>{item.label}</strong>
            <span>{item.sub}</span>
          </div>
          {i < items.length - 1 && <ArrowRight className="workflow-arrow" size={15} />}
        </button>
      ))}
    </div>
  );
}
export function DecisionMark() {
  return (
    <div className="decision-mark" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orbit orbit-three" />
      <span className="orbit-node node-one" />
      <span className="orbit-node node-two" />
      <span className="orbit-node node-three" />
      <div className="mark-core">
        <Zap size={35} fill="currentColor" strokeWidth={1.1} />
      </div>
      <span className="orbit-caption">EVIDENCE → DECISION</span>
    </div>
  );
}
export function ImportButton({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button className={compact ? 'text-button' : 'button secondary'} onClick={onClick}>
      <FileInput size={15} />
      Import results
    </button>
  );
}
export function NumberLabel({ value }: { value?: number }) {
  return <span className="numeric">{formatNumber(value)}</span>;
}
