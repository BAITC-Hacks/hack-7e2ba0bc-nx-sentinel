import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableRemaining,
  formatNumber,
  parseCsv,
  parseSnapshot,
  parseSubmission,
  percent,
  validateUrl,
} from './data.ts';
// Contract tests use empty or invalid inputs. No fictional customers, pilots or campaign outcomes.
test('missing metrics remain unavailable instead of becoming zero', () => {
  const data = parseSnapshot({ schema_version: 1, state: 'INITIAL' });
  assert.equal(data.audience_total, undefined);
  assert.equal(data.campaigns, undefined);
  assert.equal(data.budget, undefined);
  assert.equal(formatNumber(undefined), '—');
  assert.equal(percent(undefined), '—');
});
test('explicitly empty collections remain distinct from missing collections', () => {
  const data = parseSnapshot({
    schema_version: 1,
    state: 'DATA_READY',
    audience: [],
    campaigns: [],
    pilots: [],
    events: [],
  });
  assert.deepEqual(data.audience, []);
  assert.deepEqual(data.campaigns, []);
});
test('unsupported schemas, null roots and unknown states are rejected', () => {
  for (const data of [
    null,
    [],
    {},
    { schema_version: 2, state: 'INITIAL' },
    { schema_version: 1, state: 'invented' },
  ])
    assert.throws(() => parseSnapshot(data));
});
test('invalid numeric data cannot enter visualizations', () => {
  for (const value of [NaN, Infinity, -1, 1.5, '100'])
    assert.throws(() =>
      parseSnapshot({ schema_version: 1, state: 'INITIAL', audience_total: value }),
    );
  assert.throws(() =>
    parseSnapshot({ schema_version: 1, state: 'INITIAL', budget: { total: -1 } }),
  );
});
test('invalid timestamps and malformed collections are rejected', () => {
  assert.throws(() =>
    parseSnapshot({ schema_version: 1, state: 'INITIAL', updated_at: 'not a date' }),
  );
  assert.throws(() => parseSnapshot({ schema_version: 1, state: 'INITIAL', campaigns: {} }));
});
test('CSV header-only import never invents a completed run or campaign', () => {
  const data = parseSubmission('\uFEFFtarget_tariff,channel,filter_current_tariff\r\n');
  assert.equal(data.state, 'INITIAL');
  assert.deepEqual(data.campaigns, []);
  assert.equal(data.pilots, undefined);
});
test('CSV parser preserves quoted commas, quotes and newlines', () => {
  assert.deepEqual(parseCsv('a,b\r\n"quoted, field","line\nwith ""quotes"""\r\n'), [
    ['a', 'b'],
    ['quoted, field', 'line\nwith "quotes"'],
  ]);
});
test('malformed CSV and missing required headers are rejected', () => {
  for (const content of [
    '',
    'name,value\n',
    'target_tariff,channel,channel\n',
    '"unterminated',
    'target_tariff,channel\n,\n',
  ])
    assert.throws(() => parseSubmission(content));
});
test('remaining resources require sufficient source evidence', () => {
  assert.equal(availableRemaining(), undefined);
  assert.equal(availableRemaining({ total: 100 }), undefined);
  assert.equal(availableRemaining({ total: 100, used: 30 }), 70);
  assert.equal(availableRemaining({ total: 100, used: 30, remaining: 65 }), 65);
});
test('data sources permit HTTP(S) only and reject embedded credentials', () => {
  const base = 'http://localhost:5173';
  for (const url of [
    '',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:password@example.org',
  ])
    assert.throws(() => validateUrl(url, base));
  assert.equal(validateUrl('/api/workspace', base), 'http://localhost:5173/api/workspace');
});
test('backend capabilities preserve the reason why a real agent cannot run', () => {
  const snapshot = parseSnapshot({
    schema_version: 1,
    state: 'DATA_READY',
    capabilities: {
      run_agent: false,
      upload_dataset: true,
      llm_explanations: false,
      reason: 'Official environment unavailable.',
    },
  });
  assert.equal(snapshot.capabilities?.run_agent, false);
  assert.equal(snapshot.capabilities?.reason, 'Official environment unavailable.');
  assert.throws(() =>
    parseSnapshot({
      schema_version: 1,
      state: 'INITIAL',
      capabilities: {
        run_agent: 'false',
        upload_dataset: true,
        llm_explanations: false,
      },
    }),
  );
});
