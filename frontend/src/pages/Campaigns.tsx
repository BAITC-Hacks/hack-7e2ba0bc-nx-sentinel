import { useMemo, useState } from 'react';
import { ArrowDownUp, ArrowRight, Download, Layers3, Search } from 'lucide-react';
import type { Campaign, Snapshot, Source } from '../services/data';
import { download, formatNumber, percent } from '../services/data';
import { ChannelPill, EmptyState, TargetTags, Transition } from '../components/common';
export function Campaigns({
  snapshot,
  source,
  onImport,
  onSelect,
  selectedId,
}: {
  snapshot: Snapshot | null;
  source: Source | null;
  onImport: () => void;
  onSelect: (campaign: Campaign) => void;
  selectedId?: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('source');
  const campaigns = snapshot?.campaigns;
  const rows = useMemo(() => {
    const filtered = (campaigns || []).filter((c) =>
      `${c.name || ''} ${c.id} ${c.target_tariff} ${c.channel} ${Object.values(c.targeting || {}).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    return sort === 'source'
      ? filtered
      : filtered.toSorted(
          (a, b) =>
            (b[sort as 'expected_impact' | 'confidence'] ?? -Infinity) -
            (a[sort as 'expected_impact' | 'confidence'] ?? -Infinity),
        );
  }, [campaigns, query, sort]);
  function exportResults() {
    if (source?.originalCsv != null)
      download(source.originalCsv, 'submission.csv', 'text/csv;charset=utf-8');
    else if (snapshot)
      download(JSON.stringify(snapshot, null, 2), 'campaign-snapshot.json', 'application/json');
  }
  return (
    <>
      <div className="page-intro">
        <span className="section-number">04 / CAMPAIGN PORTFOLIO</span>
        <h2>Decisions, ready for action.</h2>
        <p>Explore who to reach, what to offer and the evidence behind each selection.</p>
      </div>
      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <span className="sr-only">Search campaigns</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tariffs, segments, channels…"
          />
        </label>
        <label className="sort-select">
          <ArrowDownUp size={14} />
          <span className="sr-only">Sort campaigns</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="source">Source order</option>
            <option value="expected_impact">Expected impact</option>
            <option value="confidence">Confidence</option>
          </select>
        </label>
        <button className="button secondary" onClick={exportResults} disabled={!campaigns?.length}>
          <Download size={15} />
          Export {source?.originalCsv != null ? 'CSV' : 'JSON'}
        </button>
      </div>
      <section className="panel campaign-table-panel">
        <div className="table-summary">
          <span>
            <Layers3 size={16} />
            {campaigns
              ? `${formatNumber(campaigns.length)} campaigns in this plan`
              : 'Campaign plan'}
          </span>
          <small>Source order is preserved unless you change sorting</small>
        </div>
        {campaigns?.length ? (
          rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Campaign / targeting</th>
                    <th>Tariff transition</th>
                    <th>Channel</th>
                    <th className="align-right">Audience</th>
                    <th className="align-right">Est. cost</th>
                    <th className="align-right">Expected impact</th>
                    <th className="align-right">Confidence</th>
                    <th>
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={selectedId === c.id ? 'selected-row' : ''}>
                      <td>
                        <button className="campaign-title" onClick={() => onSelect(c)}>
                          {c.name || c.id}
                        </button>
                        <TargetTags campaign={c} />
                      </td>
                      <td>
                        <Transition from={c.targeting?.current_tariff} to={c.target_tariff} />
                      </td>
                      <td>
                        <ChannelPill channel={c.channel} />
                      </td>
                      <td className="align-right numeric">{formatNumber(c.audience_size)}</td>
                      <td className="align-right numeric">{formatNumber(c.estimated_cost, 2)}</td>
                      <td
                        className={`align-right numeric ${c.expected_impact != null ? (c.expected_impact >= 0 ? 'positive-text' : 'negative-text') : ''}`}
                      >
                        {formatNumber(c.expected_impact, 2)}
                      </td>
                      <td className="align-right numeric">{percent(c.confidence)}</td>
                      <td>
                        <button
                          className="icon-button"
                          onClick={() => onSelect(c)}
                          aria-label={`View ${c.name || c.id}`}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No matching campaigns"
              description="Try a different tariff, segment or channel."
              action={
                <button className="button secondary" onClick={() => setQuery('')}>
                  Clear search
                </button>
              }
            />
          )
        ) : (
          <EmptyState
            icon="campaigns"
            title={
              campaigns ? 'No campaigns were selected' : 'Your next campaign starts with evidence'
            }
            description={
              campaigns
                ? 'The current source contains an empty campaign plan. No campaigns have been added by the interface.'
                : 'Import a real submission or connect your agent to review its campaign portfolio.'
            }
            action={
              <button className="button secondary" onClick={onImport}>
                Import results
                <ArrowRight size={15} />
              </button>
            }
          />
        )}
      </section>
      <div className="quiet-note">
        Missing values stay unreported. Importing a CSV does not validate campaign limits or prove
        that an agent run completed.
      </div>
    </>
  );
}
