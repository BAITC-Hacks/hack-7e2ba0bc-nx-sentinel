export const STATES = [
  'INITIAL',
  'DATA_READY',
  'AGENT_RUNNING',
  'PILOT_RUNNING',
  'OPTIMIZING',
  'COMPLETED',
  'FAILED',
] as const;
export type AgentState = (typeof STATES)[number];
export type Decision =
  'selected' | 'promoted' | 'rejected' | 'uncertain' | 'testing' | 'needs_more_data';
export type Section = 'overview' | 'agent' | 'audience' | 'pilots' | 'campaigns' | 'analytics';
export interface Targeting {
  arpu_segment?: string;
  data_segment?: string;
  call_segment?: string;
  current_tariff?: string;
}
export interface Campaign {
  id: string;
  name?: string;
  target_tariff: string;
  channel: string;
  targeting?: Targeting;
  audience_size?: number;
  estimated_cost?: number;
  expected_impact?: number;
  confidence?: number;
  reasoning?: string;
  risk?: string;
  evidence_ids?: string[];
}
export interface Pilot extends Campaign {
  status?: Decision;
  observed_effect?: number;
  sample_size?: number;
  cost?: number;
  uncertainty?: number;
  timestamp?: string;
}
export interface Subscriber {
  id: string;
  current_tariff?: string;
  arpu?: number;
  arpu_segment?: string;
  data_segment?: string;
  call_segment?: string;
}
export interface Activity {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'warning' | 'rejected' | 'selected';
  description?: string;
  timestamp?: string;
  cost?: number;
  contacts?: number;
}
export interface Channel {
  id: string;
  name?: string;
  cost?: number;
  effectiveness?: number;
}
export interface Tariff {
  id: string;
  name?: string;
  price?: number;
  data_gb?: number;
  minutes?: number;
  sms?: number;
}
export interface Snapshot {
  capabilities?: {
    run_agent: boolean;
    upload_dataset: boolean;
    llm_explanations: boolean;
    reason?: string;
  };
  schema_version: 1;
  state: AgentState;
  run_id?: string;
  updated_at?: string;
  error?: string;
  summary?: string;
  next_action?: string;
  audience_total?: number;
  audience?: Subscriber[];
  campaigns?: Campaign[];
  pilots?: Pilot[];
  events?: Activity[];
  channels?: Channel[];
  tariffs?: Tariff[];
  budget?: {
    total?: number;
    exploration_spent?: number;
    campaigns_allocated?: number;
    remaining?: number;
    currency?: string;
  };
  contacts?: { total?: number; used?: number; remaining?: number };
  pilot_limit?: { total?: number; used?: number; remaining?: number };
}
export interface Connection {
  snapshotUrl: string;
  runUrl: string;
}
export interface Source {
  kind: 'file' | 'api';
  name: string;
  loadedAt: string;
  originalCsv?: string;
}
const states = new Set<string>(STATES);
const decisions = new Set([
  'selected',
  'promoted',
  'rejected',
  'uncertain',
  'testing',
  'needs_more_data',
]);
const eventStates = new Set(['pending', 'running', 'completed', 'warning', 'rejected', 'selected']);
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, required = false): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > 12000)
    throw new Error(`${path} must be ${required ? 'a non-empty' : 'a'} string.`);
  return value;
}
function number(
  value: unknown,
  path: string,
  mode: 'count' | 'positive' | 'signed' | 'ratio' = 'positive',
): number | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (mode !== 'signed' && value < 0) ||
    (mode === 'count' && !Number.isInteger(value)) ||
    (mode === 'ratio' && value > 1)
  )
    throw new Error(`${path} contains an invalid number.`);
  return value;
}
function timestamp(value: unknown, path: string) {
  const result = text(value, path);
  if (result && !Number.isFinite(Date.parse(result)))
    throw new Error(`${path} must be a valid timestamp.`);
  return result;
}
function array<T>(
  value: unknown,
  path: string,
  parse: (row: Record<string, unknown>, path: string, index: number) => T,
): T[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 100000)
    throw new Error(`${path} must be an array with no more than 100,000 rows.`);
  return value.map((row, i) => parse(record(row, `${path}[${i}]`), `${path}[${i}]`, i));
}
function targeting(value: unknown, path: string): Targeting | undefined {
  if (value == null) return undefined;
  const row = record(value, path);
  return Object.fromEntries(
    ['arpu_segment', 'data_segment', 'call_segment', 'current_tariff'].map((key) => [
      key,
      text(row[key], `${path}.${key}`),
    ]),
  );
}
function campaign(row: Record<string, unknown>, path: string, index: number): Campaign {
  let evidence: string[] | undefined;
  if (row.evidence_ids != null) {
    if (!Array.isArray(row.evidence_ids)) throw new Error(`${path}.evidence_ids must be an array.`);
    evidence = row.evidence_ids.map((v, i) => text(v, `${path}.evidence_ids[${i}]`, true)!);
  }
  return {
    id: text(row.id, `${path}.id`) || `${path.split('[')[0]}-${index + 1}`,
    name: text(row.name, `${path}.name`),
    target_tariff: text(row.target_tariff, `${path}.target_tariff`, true)!,
    channel: text(row.channel, `${path}.channel`, true)!,
    targeting: targeting(row.targeting, `${path}.targeting`),
    audience_size: number(row.audience_size, `${path}.audience_size`, 'count'),
    estimated_cost: number(row.estimated_cost, `${path}.estimated_cost`),
    expected_impact: number(row.expected_impact, `${path}.expected_impact`, 'signed'),
    confidence: number(row.confidence, `${path}.confidence`, 'ratio'),
    reasoning: text(row.reasoning, `${path}.reasoning`),
    risk: text(row.risk, `${path}.risk`),
    evidence_ids: evidence,
  };
}
export function parseSnapshot(value: unknown): Snapshot {
  const row = record(value, 'Snapshot');
  if (row.schema_version !== 1)
    throw new Error(
      'Unsupported snapshot. Expected schema_version: 1. Use the frontend data contract or import a submission CSV.',
    );
  if (typeof row.state !== 'string' || !states.has(row.state))
    throw new Error('Snapshot contains an unsupported agent state.');
  const result: Snapshot = {
    schema_version: 1,
    state: row.state as AgentState,
    run_id: text(row.run_id, 'run_id'),
    updated_at: timestamp(row.updated_at, 'updated_at'),
    error: text(row.error, 'error'),
    summary: text(row.summary, 'summary'),
    next_action: text(row.next_action, 'next_action'),
    audience_total: number(row.audience_total, 'audience_total', 'count'),
    campaigns: array(row.campaigns, 'campaigns', campaign),
    pilots: array(row.pilots, 'pilots', (p, path, i) => {
      const status = text(p.status, `${path}.status`);
      if (status && !decisions.has(status)) throw new Error(`${path}.status is unsupported.`);
      return {
        ...campaign(p, path, i),
        status: status as Decision | undefined,
        observed_effect: number(p.observed_effect, `${path}.observed_effect`, 'signed'),
        sample_size: number(p.sample_size, `${path}.sample_size`, 'count'),
        cost: number(p.cost, `${path}.cost`),
        uncertainty: number(p.uncertainty, `${path}.uncertainty`),
        timestamp: timestamp(p.timestamp, `${path}.timestamp`),
      };
    }),
    audience: array(row.audience, 'audience', (p, path) => ({
      id: text(p.id, `${path}.id`, true)!,
      current_tariff: text(p.current_tariff, `${path}.current_tariff`),
      arpu: number(p.arpu, `${path}.arpu`, 'signed'),
      arpu_segment: text(p.arpu_segment, `${path}.arpu_segment`),
      data_segment: text(p.data_segment, `${path}.data_segment`),
      call_segment: text(p.call_segment, `${path}.call_segment`),
    })),
    events: array(row.events, 'events', (p, path, i) => {
      const status = text(p.status, `${path}.status`, true)!;
      if (!eventStates.has(status)) throw new Error(`${path}.status is unsupported.`);
      return {
        id: text(p.id, `${path}.id`) || `event-${i + 1}`,
        title: text(p.title, `${path}.title`, true)!,
        status: status as Activity['status'],
        description: text(p.description, `${path}.description`),
        timestamp: timestamp(p.timestamp, `${path}.timestamp`),
        cost: number(p.cost, `${path}.cost`),
        contacts: number(p.contacts, `${path}.contacts`, 'count'),
      };
    }),
    channels: array(row.channels, 'channels', (p, path) => ({
      id: text(p.id, `${path}.id`, true)!,
      name: text(p.name, `${path}.name`),
      cost: number(p.cost, `${path}.cost`),
      effectiveness: number(p.effectiveness, `${path}.effectiveness`),
    })),
    tariffs: array(row.tariffs, 'tariffs', (p, path) => ({
      id: text(p.id, `${path}.id`, true)!,
      name: text(p.name, `${path}.name`),
      price: number(p.price, `${path}.price`),
      data_gb: number(p.data_gb, `${path}.data_gb`),
      minutes: number(p.minutes, `${path}.minutes`),
      sms: number(p.sms, `${path}.sms`, 'count'),
    })),
  };
  if (row.capabilities != null) {
    const caps = record(row.capabilities, 'capabilities');
    for (const key of ['run_agent', 'upload_dataset', 'llm_explanations']) {
      if (typeof caps[key] !== 'boolean') throw new Error(`capabilities.${key} must be boolean.`);
    }
    result.capabilities = {
      run_agent: caps.run_agent as boolean,
      upload_dataset: caps.upload_dataset as boolean,
      llm_explanations: caps.llm_explanations as boolean,
      reason: text(caps.reason, 'capabilities.reason'),
    };
  }
  for (const [key, fields] of Object.entries({
    budget: ['total', 'exploration_spent', 'campaigns_allocated', 'remaining'],
    contacts: ['total', 'used', 'remaining'],
    pilot_limit: ['total', 'used', 'remaining'],
  })) {
    if (row[key] != null) {
      const values = record(row[key], key);
      const normalized: Record<string, number | string | undefined> = {};
      for (const field of fields)
        normalized[field] = number(
          values[field],
          `${key}.${field}`,
          key === 'budget' ? 'positive' : 'count',
        );
      if (key === 'budget') normalized.currency = text(values.currency, 'budget.currency');
      Object.assign(result, { [key]: normalized });
    }
  }
  for (const key of ['campaigns', 'pilots', 'audience', 'events', 'tariffs', 'channels'] as const) {
    const ids = result[key]?.map((item) => item.id);
    if (ids && new Set(ids).size !== ids.length) throw new Error(`${key} contains duplicate IDs.`);
  }
  return result;
}
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const input = content.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
      closed = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else {
      if (closed || char === '"') throw new Error('Malformed CSV quoting.');
      field += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(field);
  if (row.length > 1 || row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function parseSubmission(content: string): Snapshot {
  const [rawHeaders, ...rows] = parseCsv(content);
  if (!rawHeaders) throw new Error('This CSV is empty.');
  const headers = rawHeaders.map((v) => v.trim());
  if (new Set(headers).size !== headers.length)
    throw new Error('CSV contains duplicate column names.');
  if (!headers.includes('target_tariff') || !headers.includes('channel'))
    throw new Error('Submission CSV must contain target_tariff and channel columns.');
  const campaigns = rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(`CSV row ${index + 2} has an unexpected number of columns.`);
    const row = Object.fromEntries(headers.map((key, i) => [key, values[i].trim()]));
    if (!row.target_tariff || !row.channel)
      throw new Error(`CSV row ${index + 2} is missing a tariff or channel.`);
    return {
      id: `campaign-${index + 1}`,
      target_tariff: row.target_tariff,
      channel: row.channel,
      targeting: {
        current_tariff: row.filter_current_tariff || undefined,
        arpu_segment: row.filter_arpu_segment || undefined,
        data_segment: row.filter_data_segment || undefined,
        call_segment: row.filter_call_segment || undefined,
      },
    };
  });
  // A file does not prove that the agent completed a run. Only its campaign rows are known.
  return { schema_version: 1, state: 'INITIAL', campaigns };
}
export function validateUrl(value: string, base: string): string {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP(S) URL without embedded credentials.');
  if (!value.trim()) throw new Error('Enter a data source URL.');
  return url.href;
}
export function getError(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
export function isRunning(state?: AgentState) {
  return state === 'AGENT_RUNNING' || state === 'PILOT_RUNNING' || state === 'OPTIMIZING';
}
export function formatNumber(value?: number, digits = 0) {
  return value == null
    ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}
export function percent(value?: number) {
  return value == null ? '—' : `${formatNumber(value * 100, 1)}%`;
}
export function formatTime(value?: string) {
  return value
    ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(value))
    : undefined;
}
export function availableRemaining(value?: { total?: number; used?: number; remaining?: number }) {
  return (
    value?.remaining ??
    (value?.total != null && value.used != null ? value.total - value.used : undefined)
  );
}
export function download(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
