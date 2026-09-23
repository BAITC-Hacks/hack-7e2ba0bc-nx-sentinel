import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronRight,
  Cpu,
  Database,
  FlaskConical,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import type { Campaign, Pilot, Section } from './services/data';
import { formatTime, isRunning } from './services/data';
import { useWorkspace } from './hooks/useWorkspace';
import { Overview } from './pages/Overview';
import { Campaigns } from './pages/Campaigns';
import { Pilots } from './pages/Pilots';
import { Audience } from './pages/Audience';
import { Analytics } from './pages/Analytics';
import { Timeline } from './components/Timeline';
import { WorkflowStrip, StatusBadge } from './components/common';
import { InsightPanel } from './components/InsightPanel';
import type { Selection } from './components/InsightPanel';
import { SourceDialog } from './components/SourceDialog';
const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, title: 'Campaign command center' },
  { id: 'agent', label: 'Agent', icon: Cpu, title: 'The decision engine' },
  { id: 'audience', label: 'Audience', icon: Users, title: 'Audience intelligence' },
  { id: 'pilots', label: 'Exploration', icon: FlaskConical, title: 'Pilot exploration' },
  { id: 'campaigns', label: 'Campaigns', icon: Layers3, title: 'Campaign portfolio' },
  { id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined, title: 'Economics & evidence' },
] as const;
function getSection(): Section {
  const key = location.hash.replace(/^#\/?/, '');
  return navigation.some((item) => item.id === key) ? (key as Section) : 'overview';
}
export default function App() {
  const workspace = useWorkspace();
  const { snapshot, source, connection, busy, starting, awaitingStart, error } = workspace;
  const [section, setSection] = useState<Section>(getSection);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [insightOpen, setInsightOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLHeadingElement>(null);
  const mobileDetails = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const update = () => {
      setSection(getSection());
      setNavOpen(false);
      setSelection(null);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    content.current?.focus({ preventScroll: true });
  }, [section]);
  useEffect(() => {
    const update = () => {
      if (window.innerWidth > 1100) {
        mobileDetails.current?.close();
        setInsightOpen(false);
      }
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    const node = mobileDetails.current;
    if (!node) return;
    if (insightOpen && window.innerWidth <= 1100) node.showModal();
    else node.close();
  }, [insightOpen]);
  const navigate = (key: Section) => {
    location.hash = `/${key}`;
  };
  const openImport = () => fileInput.current?.click();
  const openCampaign = (item: Campaign) => {
    setSelection({ kind: 'campaign', item });
    if (innerWidth <= 1100) setInsightOpen(true);
  };
  const openPilot = (item: Pilot) => {
    setSelection({ kind: 'pilot', item });
    if (innerWidth <= 1100) setInsightOpen(true);
  };
  const canRun =
    !!connection?.runUrl &&
    source?.kind === 'api' &&
    snapshot?.capabilities?.run_agent !== false &&
    (snapshot?.state !== 'INITIAL' || snapshot?.capabilities?.run_agent === true) &&
    !isRunning(snapshot?.state) &&
    !busy &&
    !starting &&
    !awaitingStart;
  const current = navigation.find((item) => item.id === section)!;
  const currentSelection: Selection | null =
    selection?.kind === 'campaign'
      ? (() => {
          const item = snapshot?.campaigns?.find((c) => c.id === selection.item.id);
          return item ? { kind: 'campaign', item } : null;
        })()
      : selection?.kind === 'pilot'
        ? (() => {
            const item = snapshot?.pilots?.find((p) => p.id === selection.item.id);
            return item ? { kind: 'pilot', item } : null;
          })()
        : null;
  const insight = (
    <InsightPanel
      snapshot={snapshot}
      source={source}
      selection={currentSelection}
      onClose={() => {
        setSelection(null);
        setInsightOpen(false);
      }}
      onConnect={() => setSourceOpen(true)}
      onEvidence={openPilot}
    />
  );
  return (
    <div className={`app-shell ${collapsed ? 'nav-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <input
        className="sr-only"
        type="file"
        ref={fileInput}
        accept=".json,.csv,application/json,text/csv"
        aria-label="Import actual agent results"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && (await workspace.importFile(file))) {
            setSelection(null);
            setSourceOpen(false);
            if (file.name.toLowerCase().endsWith('.csv')) navigate('campaigns');
          }
        }}
      />
      <aside className={`sidebar ${navOpen ? 'mobile-open' : ''}`} aria-label="Primary navigation">
        <a href="#/overview" className="brand" aria-label="NX-Sentinel overview">
          <img src="/mark.svg" alt="" />
          <div>
            <strong>
              NX-SENTINEL<span>Campaign Intelligence</span>
            </strong>
          </div>
        </a>
        <div className="workspace-label">
          WORKSPACE<span>01</span>
        </div>
        <nav>
          {navigation.map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              aria-current={section === item.id ? 'page' : undefined}
              className={`nav-item ${section === item.id ? 'active' : ''}`}
              title={item.label}
            >
              <item.icon size={19} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === 'agent' && isRunning(snapshot?.state) && <i className="nav-live" />}
              {section === item.id && <span className="nav-active-mark" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <div className="mini-network">
              <span />
              <span />
              <span />
              <span />
            </div>
            <strong>Built on evidence.</strong>
            <p>
              Designed for the next
              <br />
              best decision.
            </p>
          </div>
          <button className="system-link" onClick={() => setSourceOpen(true)}>
            <span className={`system-dot ${source ? 'connected' : ''}`} />
            <div>
              <strong>{source ? 'Source connected' : 'Local workspace'}</strong>
              <small>
                {source
                  ? source.kind === 'api'
                    ? 'API connected'
                    : 'Imported file'
                  : 'No data source'}
              </small>
            </div>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <span>
              HACKALEM AI <i> / </i> TELECOM
            </span>
            <button
              className="icon-button collapse-button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-scrim"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setNavOpen(!navOpen)}
              aria-label="Toggle navigation"
              aria-expanded={navOpen}
            >
              <Menu size={19} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <ChevronRight size={13} />
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className="case-label">
              BEELINE CASE
              <span className="case-dot" />
            </span>
            <button className="source-trigger" onClick={() => setSourceOpen(true)}>
              <Database size={14} />
              <span>{source ? 'Data source' : 'Connect source'}</span>
              <ChevronRight size={13} />
            </button>
            <button
              className="icon-button mobile-insight"
              onClick={() => setInsightOpen(true)}
              aria-label="Open decision intelligence"
            >
              <PanelRightOpen size={18} />
            </button>
          </div>
        </header>
        <div className="workspace-columns">
          <main id="main-content" className="main-content">
            <div className="page-header">
              <div>
                <div className="page-kicker">
                  <span />
                  CAMPAIGN INTELLIGENCE
                </div>
                <h1 tabIndex={-1} ref={content}>
                  {current.title}
                </h1>
                <div className="page-subtitle">
                  Your next move, informed.<span className="subtitle-separator">/</span>
                  <StatusBadge state={snapshot?.state} connected={!!source} />
                </div>
              </div>
              <div className="run-actions">
                {source?.kind === 'api' && (
                  <button
                    className="icon-button refresh-button"
                    disabled={busy || starting}
                    onClick={() => void workspace.refresh()}
                    aria-label="Refresh data"
                  >
                    <RefreshCw className={busy ? 'spin' : ''} size={16} />
                  </button>
                )}
                <span
                  className="run-tooltip"
                  tabIndex={!canRun ? 0 : undefined}
                  aria-label={
                    !canRun
                      ? isRunning(snapshot?.state)
                        ? 'The agent is already running'
                        : snapshot?.capabilities?.reason ||
                          'Run Agent requires a connected source with a start endpoint and ready state'
                      : undefined
                  }
                >
                  <button
                    className="button run-button"
                    disabled={!canRun}
                    onClick={() => void workspace.runAgent()}
                  >
                    {starting ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                    {starting ? 'Starting…' : awaitingStart ? 'Awaiting status' : 'Run Agent'}
                  </button>
                  {!canRun && (
                    <span className="tooltip">
                      {awaitingStart
                        ? 'Start request accepted. Waiting for the source to confirm a new run.'
                        : isRunning(snapshot?.state)
                          ? 'The agent is already running.'
                          : snapshot?.capabilities?.reason ||
                            'Connect a ready data source and its agent start URL.'}
                    </span>
                  )}
                </span>
              </div>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                <TriangleAlert size={19} />
                <div>
                  <strong>The latest action could not be completed</strong>
                  <p>{error}</p>
                  {source && <small>Last successfully loaded data remains available.</small>}
                </div>
                <button
                  className="icon-button"
                  onClick={workspace.dismissError}
                  aria-label="Dismiss error"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {awaitingStart && (
              <div className="pending-start" role="status">
                <LoaderCircle className="spin" size={15} />
                <span>
                  Start request accepted. Waiting for the source to confirm the new run. A second
                  start is blocked.
                </span>
              </div>
            )}
            {snapshot?.state === 'FAILED' && (
              <div className="error-banner" role="status">
                <TriangleAlert size={19} />
                <div>
                  <strong>The agent reported a failed run</strong>
                  <p>{snapshot.error || 'The source did not provide an error description.'}</p>
                </div>
              </div>
            )}
            {busy && !snapshot ? (
              <div className="loading-workspace" role="status" aria-label="Loading source data">
                <div className="loading-label">
                  <LoaderCircle size={16} className="spin" />
                  Reading your source…
                </div>
                <div className="skeleton skeleton-hero" />
                <div className="skeleton-row">
                  <div className="skeleton" />
                  <div className="skeleton" />
                  <div className="skeleton" />
                </div>
              </div>
            ) : (
              <div className="route-content" key={section}>
                {section === 'overview' && (
                  <Overview
                    snapshot={snapshot}
                    onConnect={() => setSourceOpen(true)}
                    onImport={openImport}
                    navigate={navigate}
                    onSelect={openCampaign}
                  />
                )}{' '}
                {section === 'agent' && (
                  <>
                    <div className="page-intro">
                      <span className="section-number">01 / THE AGENT AT WORK</span>
                      <h2>
                        Not a black box.
                        <br />A visible decision process.
                      </h2>
                      <p>Follow real events as the agent explores, learns and selects.</p>
                    </div>
                    <WorkflowStrip snapshot={snapshot} navigate={navigate} />
                    {snapshot?.run_id && (
                      <div className="run-meta">
                        <Activity size={16} />
                        <strong>Run {snapshot.run_id}</strong>
                        <StatusBadge state={snapshot.state} />
                      </div>
                    )}
                    <Timeline snapshot={snapshot} full />
                  </>
                )}
                {section === 'audience' && (
                  <Audience snapshot={snapshot} onConnect={() => setSourceOpen(true)} />
                )}{' '}
                {section === 'pilots' && <Pilots snapshot={snapshot} onSelect={openPilot} />}{' '}
                {section === 'campaigns' && (
                  <Campaigns
                    snapshot={snapshot}
                    source={source}
                    onImport={openImport}
                    onSelect={openCampaign}
                    selectedId={selection?.kind === 'campaign' ? selection.item.id : undefined}
                  />
                )}{' '}
                {section === 'analytics' && <Analytics snapshot={snapshot} onSelect={openPilot} />}
              </div>
            )}
            <footer className="workspace-footer">
              <span>
                <ShieldIcon />
                Evidence-led. Human-readable.
              </span>
              <span>
                {source
                  ? `Loaded ${formatTime(source.loadedAt)} · ${source.kind === 'file' ? 'File snapshot' : 'API source'}`
                  : 'Awaiting your first data source'}
              </span>
            </footer>
          </main>
          <aside className="insight-panel" aria-label="Decision intelligence">
            {insight}
          </aside>
        </div>
      </div>
      <dialog
        ref={mobileDetails}
        className="mobile-insight-dialog"
        aria-label="Decision intelligence"
        onCancel={() => setInsightOpen(false)}
        onClick={(e) => {
          if (e.target === mobileDetails.current) setInsightOpen(false);
        }}
      >
        {insight}
      </dialog>
      {sourceOpen && (
        <SourceDialog
          initial={connection}
          onClose={() => setSourceOpen(false)}
          onConnect={workspace.connect}
          onImport={openImport}
          onUpload={workspace.uploadDataset}
          busy={busy}
          error={error}
        />
      )}
    </div>
  );
}
function ShieldIcon() {
  return <Sparkles size={12} />;
}
