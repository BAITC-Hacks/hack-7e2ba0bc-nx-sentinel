import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getError,
  isRunning,
  MAX_FILE_BYTES,
  parseSnapshot,
  parseSubmission,
  validateUrl,
} from '../services/data';
import type { Connection, Snapshot, Source } from '../services/data';
export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [awaitingStart, setAwaitingStart] = useState(false);
  const acceptedRun = useRef<{ runId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startLock = useRef(false);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const runningRequest = useRef(false);
  const load = useCallback(async (config: Connection, initial = false) => {
    if ((runningRequest.current || startLock.current) && !initial) return false;
    const id = ++operation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    runningRequest.current = true;
    setBusy(true);
    const timeout = window.setTimeout(() => abort.abort(), 15000);
    try {
      const url = validateUrl(config.snapshotUrl, window.location.href);
      const response = await fetch(url, {
        signal: abort.signal,
        headers: { Accept: 'application/json' },
        credentials: new URL(url).origin === location.origin ? 'same-origin' : 'omit',
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(
          `Data source returned HTTP ${response.status}. Previous data is preserved.`,
        );
      const body = await response.text();
      if (body.length > MAX_FILE_BYTES) throw new Error('Snapshot exceeds the 20 MB limit.');
      const next = parseSnapshot(JSON.parse(body));
      if (operation.current !== id) return false;
      if (
        initial ||
        (acceptedRun.current &&
          (isRunning(next.state) ||
            next.state === 'FAILED' ||
            (!!next.run_id && next.run_id !== acceptedRun.current.runId)))
      ) {
        acceptedRun.current = null;
        setAwaitingStart(false);
      }
      setSnapshot(next);
      setSource({ kind: 'api', name: new URL(url).host, loadedAt: new Date().toISOString() });
      setConnection(config);
      setError(null);
      return true;
    } catch (cause) {
      if (operation.current === id) {
        const message =
          cause instanceof DOMException && cause.name === 'AbortError'
            ? 'The source did not respond within 15 seconds. Previous data is preserved.'
            : getError(cause);
        setError(message);
      }
      return false;
    } finally {
      clearTimeout(timeout);
      if (operation.current === id) {
        runningRequest.current = false;
        setBusy(false);
      }
    }
  }, []);
  const importFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setError('This file exceeds the 20 MB limit.');
      return false;
    }
    const id = ++operation.current;
    controller.current?.abort();
    runningRequest.current = false;
    setBusy(true);
    try {
      const content = await file.text();
      const csv = file.name.toLowerCase().endsWith('.csv');
      if (!csv && !file.name.toLowerCase().endsWith('.json'))
        throw new Error('Choose a JSON snapshot or a submission CSV.');
      const next = csv ? parseSubmission(content) : parseSnapshot(JSON.parse(content));
      if (operation.current !== id) return false;
      acceptedRun.current = null;
      setAwaitingStart(false);
      setSnapshot(next);
      setSource({
        kind: 'file',
        name: file.name,
        loadedAt: new Date().toISOString(),
        originalCsv: csv ? content : undefined,
      });
      setConnection(null);
      setError(null);
      return true;
    } catch (cause) {
      if (operation.current === id) setError(getError(cause));
      return false;
    } finally {
      if (operation.current === id) setBusy(false);
    }
  }, []);
  const runAgent = useCallback(async () => {
    if (
      !connection?.runUrl ||
      busy ||
      awaitingStart ||
      startLock.current ||
      isRunning(snapshot?.state)
    )
      return;
    startLock.current = true;
    setStarting(true);
    setError(null);
    const id = operation.current;
    try {
      const url = validateUrl(connection.runUrl, location.href);
      const response = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
        credentials: new URL(url).origin === location.origin ? 'same-origin' : 'omit',
      });
      if (!response.ok)
        throw new Error(
          `Agent start returned HTTP ${response.status}. No successful start was confirmed.`,
        );
      if (id === operation.current) {
        acceptedRun.current = { runId: snapshot?.run_id };
        setAwaitingStart(true);
        startLock.current = false;
        await load(connection);
      }
    } catch (cause) {
      if (id === operation.current)
        setError(`${getError(cause)} Check the agent status before trying again.`);
    } finally {
      startLock.current = false;
      setStarting(false);
    }
  }, [connection, busy, awaitingStart, snapshot?.state, snapshot?.run_id, load]);
  useEffect(() => {
    if (!connection || source?.kind !== 'api') return;
    const timer = window.setInterval(
      () => {
        void load(connection);
      },
      isRunning(snapshot?.state) || starting || awaitingStart ? 3000 : 15000,
    );
    return () => clearInterval(timer);
  }, [connection, source?.kind, snapshot?.state, starting, awaitingStart, load]);
  useEffect(
    () => () => {
      operation.current++;
      controller.current?.abort();
    },
    [],
  );
  return {
    snapshot,
    source,
    connection,
    busy,
    starting,
    awaitingStart,
    error,
    connect: load,
    importFile,
    runAgent,
    refresh: () => (connection ? load(connection) : Promise.resolve(false)),
    dismissError: () => setError(null),
  };
}
