import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, Users } from 'lucide-react';
import type { Snapshot, Subscriber } from '../services/data';
import { formatNumber } from '../services/data';
import { EmptyState, PanelHeader } from '../components/common';
const pageSize = 50;
export function Audience({
  snapshot,
  onConnect,
}: {
  snapshot: Snapshot | null;
  onConnect: () => void;
}) {
  const rows = snapshot?.audience;
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const fields = [
    { key: 'arpu_segment', name: 'ARPU' },
    { key: 'data_segment', name: 'Data use' },
    { key: 'call_segment', name: 'Calls' },
    { key: 'current_tariff', name: 'Current tariff' },
  ] as const;
  const options = useMemo(
    () =>
      Object.fromEntries(
        fields.map((field) => [
          field.key,
          [
            ...new Set((rows || []).map((r) => r[field.key]).filter((v): v is string => !!v)),
          ].sort(),
        ]),
      ),
    [rows],
  );
  const filtered = useMemo(
    () =>
      (rows || []).filter(
        (row) =>
          (!query || row.id.toLowerCase().includes(query.toLowerCase())) &&
          Object.entries(filters).every(
            ([key, value]) => !value || row[key as keyof Subscriber] === value,
          ),
      ),
    [rows, query, filters],
  );
  const pageCount = Math.ceil(filtered.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const distributions = fields.slice(0, 3).map((field) => {
    const counts = new Map<string, number>();
    for (const row of filtered) {
      const key = row[field.key];
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return { ...field, counts: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
  });
  const hasFilters = query || Object.values(filters).some(Boolean);
  return (
    <>
      <div className="page-intro">
        <span className="section-number">02 / AUDIENCE INTELLIGENCE</span>
        <h2>
          Know the audience.
          <br />
          <span className="muted-heading">Find the opportunity.</span>
        </h2>
        <p>Explore the segments and tariff relationships in your actual subscriber data.</p>
      </div>
      <section className="audience-summary">
        <Users size={20} />
        <strong>{formatNumber(snapshot?.audience_total ?? rows?.length)}</strong>
        <span>total subscribers</span>
        {rows && (
          <small>
            {formatNumber(rows.length)} records supplied · {formatNumber(filtered.length)} match
            filters
          </small>
        )}
      </section>
      <section className="panel filter-panel">
        <div className="filter-title">
          <SlidersHorizontal size={16} />
          <h2>Audience filters</h2>
          {hasFilters && (
            <button
              className="text-button"
              onClick={() => {
                setFilters({});
                setQuery('');
                setPage(0);
              }}
            >
              Reset
            </button>
          )}
        </div>
        <div className="audience-filters">
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.name}</span>
              <select
                value={filters[field.key] || ''}
                onChange={(e) => {
                  setFilters((previous) => ({ ...previous, [field.key]: e.target.value }));
                  setPage(0);
                }}
                disabled={!options[field.key]?.length}
              >
                <option value="">All {field.name.toLowerCase()}</option>
                {options[field.key]?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>
      {rows?.length ? (
        <section className="distribution-strip">
          {distributions.map((distribution) => (
            <div key={distribution.key}>
              <h3>{distribution.name} segmentation</h3>
              {distribution.counts.length ? (
                distribution.counts.map(([name, count]) => (
                  <div className="distribution-row" key={name}>
                    <div>
                      <span>{name}</span>
                      <strong>{formatNumber(count)}</strong>
                    </div>
                    <div className="distribution-track">
                      <span
                        style={{
                          width: `${filtered.length ? (count / filtered.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No segment values supplied.</p>
              )}
            </div>
          ))}
        </section>
      ) : null}
      <section className="panel">
        <PanelHeader
          title="Subscriber records"
          label="Identifiers, never invented identities"
          action={
            rows?.length ? (
              <label className="search-box compact-search">
                <Search size={14} />
                <span className="sr-only">Search subscriber ID</span>
                <input
                  placeholder="Search subscriber ID"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
            ) : undefined
          }
        />
        {visible.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Subscriber ID</th>
                    <th>Current tariff</th>
                    <th>ARPU segment</th>
                    <th>Data segment</th>
                    <th>Call segment</th>
                    <th className="align-right">ARPU</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td className="subscriber-id">{row.id}</td>
                      <td>{row.current_tariff ?? '—'}</td>
                      <td>{row.arpu_segment ?? '—'}</td>
                      <td>{row.data_segment ?? '—'}</td>
                      <td>{row.call_segment ?? '—'}</td>
                      <td className="align-right numeric">{formatNumber(row.arpu, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {currentPage * pageSize + 1}–
                {Math.min((currentPage + 1) * pageSize, filtered.length)} of{' '}
                {formatNumber(filtered.length)}
              </span>
              <div>
                <button
                  className="icon-button"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                  aria-label="Previous audience page"
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {currentPage + 1} / {pageCount}
                </span>
                <button
                  className="icon-button"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                  aria-label="Next audience page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={
              rows?.length ? 'No subscribers match these filters' : 'An audience, not assumptions'
            }
            description={
              rows?.length
                ? 'Adjust your filters or subscriber ID search.'
                : 'Connect a source with subscriber records to explore actual segments. No personal identities are generated.'
            }
            action={
              !rows?.length ? (
                <button className="button secondary" onClick={onConnect}>
                  Connect source
                </button>
              ) : undefined
            }
          />
        )}
      </section>
    </>
  );
}
