import { Check, ChevronRight, Circle, Clock3, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import type { Snapshot } from '../services/data';
import { formatNumber, formatTime } from '../services/data';
import { EmptyState, PanelHeader } from './common';
export function Timeline({
  snapshot,
  full = false,
  onViewAll,
}: {
  snapshot: Snapshot | null;
  full?: boolean;
  onViewAll?: () => void;
}) {
  const events = snapshot?.events;
  const visible = full ? events : events?.slice(-4);
  return (
    <section className="panel timeline-panel">
      <PanelHeader
        label="A transparent decision process"
        title="Agent activity"
        action={
          onViewAll ? (
            <button className="text-button" onClick={onViewAll}>
              View activity
              <ChevronRight size={14} />
            </button>
          ) : (
            <Clock3 size={17} className="muted" />
          )
        }
      />
      {visible?.length ? (
        <ol className="timeline">
          {visible.map((event) => {
            const Icon =
              event.status === 'completed' || event.status === 'selected'
                ? Check
                : event.status === 'running'
                  ? LoaderCircle
                  : event.status === 'rejected'
                    ? X
                    : event.status === 'warning'
                      ? TriangleAlert
                      : Circle;
            return (
              <li key={event.id} className={`timeline-event ${event.status}`}>
                <div className="event-dot">
                  <Icon size={14} className={event.status === 'running' ? 'spin' : ''} />
                </div>
                <div className="event-content">
                  <div className="event-heading">
                    <h3>{event.title}</h3>
                    {event.timestamp && (
                      <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
                    )}
                  </div>
                  {event.description && <p>{event.description}</p>}
                  <div className="event-meta">
                    <span>{event.status}</span>
                    {event.contacts != null && <span>{formatNumber(event.contacts)} contacts</span>}
                    {event.cost != null && <span>Cost {formatNumber(event.cost, 2)}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          compact
          icon="analytics"
          title="Every decision leaves a trail"
          description="Analysis, pilot outcomes and selection decisions will appear here when your source provides activity events."
        />
      )}
      <div className="panel-note">
        <span className="small-dot" />
        Only source-reported events. No simulated activity.
      </div>
    </section>
  );
}
