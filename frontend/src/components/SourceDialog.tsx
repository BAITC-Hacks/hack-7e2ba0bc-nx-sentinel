import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileJson, FileUp, Link2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { Connection } from '../services/data';
import { getError, validateUrl } from '../services/data';
export function SourceDialog({
  initial,
  onClose,
  onConnect,
  onImport,
  onUpload,
  busy,
  error,
}: {
  initial: Connection | null;
  onClose: () => void;
  onConnect: (connection: Connection, initial: boolean) => Promise<boolean>;
  onImport: () => void;
  onUpload: (file: File) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initial?.snapshotUrl || '/api/workspace');
  const [runUrl, setRunUrl] = useState(initial?.runUrl || '/api/agent/runs');
  const [validation, setValidation] = useState<string | null>(null);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="source-dialog"
      aria-labelledby="source-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="dialog-heading">
        <div className="dialog-icon">
          <Link2 size={23} />
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close source settings">
          <X size={19} />
        </button>
      </div>
      <div className="eyebrow">Your data. One workspace.</div>
      <h2 id="source-title">Connect the evidence.</h2>
      <p className="dialog-description">
        Bring in your agent's actual state or open an existing result file. No demonstration data is
        added.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const config = {
              snapshotUrl: validateUrl(url, location.href),
              runUrl: runUrl.trim() ? validateUrl(runUrl, location.href) : '',
            };
            setValidation(null);
            if (await onConnect(config, true)) onClose();
          } catch (cause) {
            setValidation(getError(cause));
          }
        }}
      >
        <label className="field-label" htmlFor="snapshot-url">
          Data source URL <span>Required</span>
        </label>
        <input
          id="snapshot-url"
          autoFocus
          className="field-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-service/api/workspace"
          autoComplete="off"
          required
        />
        <p className="field-help">A JSON snapshot endpoint provided by your backend.</p>
        <label className="field-label" htmlFor="run-url">
          Agent start URL <span>Optional</span>
        </label>
        <input
          id="run-url"
          className="field-input"
          value={runUrl}
          onChange={(e) => setRunUrl(e.target.value)}
          placeholder="https://your-service/api/agent/runs"
          autoComplete="off"
        />
        <p className="field-help">Enables Run Agent. The action sends a POST request.</p>
        {(validation || error) && (
          <div className="form-error" role="alert">
            {validation || error}
          </div>
        )}
        <button className="button primary full-width" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}Connect source
          <ArrowRight size={15} />
        </button>
      </form>
      <div className="dialog-or">
        <span />
        or work with an existing file
        <span />
      </div>
      <button className="file-import-card" onClick={onImport}>
        <FileUp size={24} />
        <span>
          <strong>Import results</strong>
          <small>JSON snapshot or submission CSV · up to 20 MB</small>
        </span>
        <ArrowRight size={16} />
      </button>
      <input
        ref={uploadInput}
        type="file"
        accept=".csv,.json"
        hidden
        aria-label="Upload audience dataset"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file && (await onUpload(file))) onClose();
        }}
      />
      <button
        className="file-import-card"
        disabled={busy}
        onClick={() => uploadInput.current?.click()}
      >
        <FileUp size={24} />
        <span>
          <strong>Upload audience data</strong>
          <small>CSV or dataset JSON · local backend · up to 20 MB</small>
        </span>
        <ArrowRight size={16} />
      </button>
      <details className="contract-details">
        <summary>
          <FileJson size={14} />
          Data format & connection details
        </summary>
        <p>
          JSON snapshots use schema_version: 1 and an explicit agent state. Optional fields include
          campaigns, pilots, audience, events and resource totals. The exact contract is documented
          in frontend/README.md.
        </p>
        <p>
          CSV files require target_tariff and channel. Optional filter_* columns are used for
          targeting. Missing metrics remain unavailable. The original CSV is preserved for export.
        </p>
        <p>
          Local API endpoints are prefilled. Audience uploads are sent to this application's backend
          and must contain id, current_tariff and arpu. JSON bundles may include tariff/channel
          catalogs and historical transitions. Imported result snapshots stay in your browser. No
          API keys are stored here.
        </p>
      </details>
      <div className="dialog-footer">
        <ShieldCheck size={14} />
        Results stay in the browser. Audience uploads stay in your backend session.
      </div>
    </dialog>
  );
}
