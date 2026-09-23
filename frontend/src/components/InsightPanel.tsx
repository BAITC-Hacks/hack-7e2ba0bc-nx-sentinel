import {
  ArrowUpRight,
  CircleHelp,
  FileCheck2,
  Fingerprint,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { Campaign, Pilot, Snapshot, Source } from '../services/data';
import { formatNumber, percent } from '../services/data';
import { ChannelPill, Eyebrow, TargetTags, Transition } from './common';
export type Selection = { kind: 'campaign'; item: Campaign } | { kind: 'pilot'; item: Pilot };
export function InsightPanel({
  snapshot,
  source,
  selection,
  onClose,
  onConnect,
  onEvidence,
}: {
  snapshot: Snapshot | null;
  source: Source | null;
  selection: Selection | null;
  onClose: () => void;
  onConnect: () => void;
  onEvidence: (pilot: Pilot) => void;
}) {
  const item = selection?.item;
  const pilot = selection?.kind === 'pilot' ? selection.item : undefined;
  const tariff = snapshot?.tariffs?.find((t) => t.id === item?.target_tariff);
  return (
    <>
      <div className={`insight-header ${item ? 'has-selection' : ''}`}>
        <span>
          <Sparkles size={16} />
          Decision intelligence
        </span>
        <button
          className="icon-button insight-close"
          onClick={onClose}
          aria-label="Close decision details"
        >
          <X size={16} />
        </button>
      </div>
      {item ? (
        <div className="insight-body">
          <div className="detail-title">
            <Eyebrow>{pilot ? 'Pilot evidence' : 'Campaign detail'}</Eyebrow>
            <h2>{item.name || item.id}</h2>
            {pilot?.status && (
              <span className={`decision-label ${pilot.status}`}>
                {pilot.status.replaceAll('_', ' ')}
              </span>
            )}
          </div>
          <section className="detail-section">
            <h3>Targeting</h3>
            <TargetTags campaign={item} />
            <Transition from={item.targeting?.current_tariff} to={item.target_tariff} />
            {tariff && (
              <div className="tariff-facts">
                {tariff.name && <strong>{tariff.name}</strong>}
                {tariff.price != null && <span>Price: {formatNumber(tariff.price, 2)}</span>}
                {tariff.data_gb != null && <span>{formatNumber(tariff.data_gb, 1)} GB data</span>}
                {tariff.minutes != null && <span>{formatNumber(tariff.minutes)} minutes</span>}
                {tariff.sms != null && <span>{formatNumber(tariff.sms)} SMS</span>}
              </div>
            )}
          </section>
          <section className="detail-section">
            <h3>Channel & audience</h3>
            <ChannelPill channel={item.channel} />
            <dl className="detail-values">
              <div>
                <dt>Segment audience</dt>
                <dd>{formatNumber(item.audience_size)}</dd>
              </div>
              {pilot && (
                <div>
                  <dt>Pilot sample</dt>
                  <dd>{formatNumber(pilot.sample_size)}</dd>
                </div>
              )}
            </dl>
          </section>
          <section className="detail-section">
            <h3>Economics</h3>
            <dl className="detail-values">
              <div>
                <dt>{pilot ? 'Pilot cost' : 'Estimated cost'}</dt>
                <dd>{formatNumber(pilot?.cost ?? item.estimated_cost, 2)}</dd>
              </div>
              <div>
                <dt>{pilot ? 'Observed effect' : 'Expected impact'}</dt>
                <dd>
                  {pilot ? percent(pilot.observed_effect) : formatNumber(item.expected_impact, 2)}
                </dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{percent(item.confidence)}</dd>
              </div>
              {pilot?.uncertainty != null && (
                <div>
                  <dt>Uncertainty</dt>
                  <dd>{formatNumber(pilot.uncertainty, 4)}</dd>
                </div>
              )}
            </dl>
          </section>
          <section className="detail-section reasoning-section">
            <h3>
              <Lightbulb size={14} />
              Decision rationale
            </h3>
            <p>{item.reasoning || 'The source has not provided reasoning for this decision.'}</p>
          </section>
          {item.evidence_ids?.length ? (
            <section className="detail-section">
              <h3>Supporting evidence</h3>
              <div className="evidence-links">
                {item.evidence_ids.map((id) => {
                  const evidence = snapshot?.pilots?.find((p) => p.id === id);
                  return evidence ? (
                    <button key={id} onClick={() => onEvidence(evidence)}>
                      {id}
                      <ArrowUpRight size={13} />
                    </button>
                  ) : (
                    <span key={id}>{id} · details not supplied</span>
                  );
                })}
              </div>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>Risk & uncertainty</h3>
            <p>{item.risk || 'No risk assessment supplied.'}</p>
          </section>
        </div>
      ) : (
        <div className="insight-body">
          <div className="insight-lead">
            <div className="insight-emblem">
              <Fingerprint size={28} strokeWidth={1.3} />
            </div>
            <Eyebrow>The why behind the what</Eyebrow>
            <h2>
              Good decisions
              <br />
              have evidence.
            </h2>
            <p>
              {snapshot?.summary ||
                'Select a pilot or campaign to see the signals, economics and reasoning behind it.'}
            </p>
          </div>
          <div className="insight-stack">
            {[
              { icon: FileCheck2, title: 'Evidence', text: 'What the pilots actually observed' },
              { icon: CircleHelp, title: 'Uncertainty', text: 'How much is still unknown' },
              {
                icon: Lightbulb,
                title: 'Resource impact',
                text: 'What the next decision will cost',
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <Icon size={17} />
                <div>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </div>
                <span className="muted">—</span>
              </div>
            ))}
          </div>
          {snapshot?.next_action && (
            <section className="detail-section">
              <h3>Reported next action</h3>
              <p>{snapshot.next_action}</p>
            </section>
          )}
          <div className="insight-principle">
            <div className="principle-line" />
            <span>
              Observe.
              <br />
              Understand.
              <br />
              <strong>Then act.</strong>
            </span>
          </div>
        </div>
      )}
      <div className="source-integrity">
        <div>
          <ShieldCheck size={16} />
          <strong>Source integrity</strong>
        </div>
        <p>
          {source ? (
            <>
              Viewing {source.kind === 'file' ? 'imported results' : 'connected data'} from{' '}
              <span>{source.name}</span>.
            </>
          ) : (
            'No source connected. Business metrics appear only when real data is available.'
          )}
        </p>
        <button className="text-button" onClick={onConnect}>
          {source ? 'Manage source' : 'Connect a source'}
          <ArrowUpRight size={13} />
        </button>
      </div>
    </>
  );
}
