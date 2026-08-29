import type { CloseoutPhase } from '../../domain/closeout.ts';
import type { Photo, Project } from '../../domain/types.ts';
import {
  filterWorkdays,
  type WorkdayFilter,
  type WorkdayViewModel,
} from '../../domain/workdays.ts';
import {
  HANDOFF_ACTION_LABELS,
  HANDOFF_STATUS_LABELS,
  WORKDAY_STATUS_LABELS,
} from '../handoffLabels.ts';
import type { SecondaryProjectView } from '../projectQuery.ts';
import { usePhotoUrl } from '../usePhotoUrl.ts';

type ProjectFacts = Pick<Project, 'name' | 'client' | 'address'>;

export type WorkdayLedgerProps = {
  project: ProjectFacts;
  workdays: readonly WorkdayViewModel[];
  photos: readonly Photo[];
  phase: CloseoutPhase;
  checkedAt?: string;
  filter: WorkdayFilter;
  loading: boolean;
  onFilterChange: (filter: WorkdayFilter) => void;
  onOpenWorkday?: (dateKey: string) => void;
  onOpenReview: () => void;
  onOpenPacket: () => void;
  onOpenView: (view: SecondaryProjectView) => void;
  onEditProject: () => void;
  onTakePhoto: () => void;
};

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDate(dateKey: string, weekday = false): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    ...(weekday ? { weekday: 'long' as const } : {}),
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatWorkdayRange(workdays: readonly WorkdayViewModel[]): string {
  if (workdays.length === 0) return 'No workdays yet';
  const first = new Date(`${workdays[0]!.dateKey}T12:00:00`);
  const last = new Date(`${workdays[workdays.length - 1]!.dateKey}T12:00:00`);
  if (first.getTime() === last.getTime()) return formatDate(workdays[0]!.dateKey);
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    const month = first.toLocaleDateString(undefined, { month: 'long' });
    return `${month} ${first.getDate()} to ${month} ${last.getDate()}, ${last.getFullYear()}`;
  }
  return `${formatDate(workdays[0]!.dateKey)} to ${formatDate(workdays[workdays.length - 1]!.dateKey)}`;
}

function LedgerPhoto({ photo }: { photo: Photo }) {
  const url = usePhotoUrl(photo.id);
  return (
    <span className="ledger-photo" data-ledger-photo={photo.id}>
      {url ? (
        <img src={url} alt={photo.caption?.trim() || `Job photo from ${formatDate(photo.capturedAt.slice(0, 10))}`} />
      ) : (
        <span className="ledger-photo-placeholder" aria-label={photo.caption?.trim() || 'Job photo'} />
      )}
    </span>
  );
}

function WorkdayRow({
  workday,
  photoById,
  onOpen,
}: {
  workday: WorkdayViewModel;
  photoById: ReadonlyMap<string, Photo>;
  onOpen?: () => void;
}) {
  const activePhotos = workday.photos.filter((photo) => !photo.voidedAt);
  const thumbnails = workday.representativePhotoIds.flatMap((id) => {
    const photo = photoById.get(id);
    return photo ? [photo] : [];
  });
  const record = workday.dailyRecord;

  return (
    <article className={`workday-row status-${workday.status}`} data-workday={workday.dateKey}>
      <header className="workday-row-head">
        <div>
          <span className="workday-date">{formatDate(workday.dateKey, true)}</span>
          <span className="workday-status">{WORKDAY_STATUS_LABELS[workday.status]}</span>
        </div>
        <div className="workday-review-counts">
          {workday.requiredCount > 0 ? (
            <span>{countLabel(workday.requiredCount, 'item needs attention', 'items need attention')}</span>
          ) : null}
          {workday.noteCount > 0 ? (
            <span>{countLabel(workday.noteCount, 'item worth a look', 'items worth a look')}</span>
          ) : null}
        </div>
      </header>

      <div className="workday-sections">
        <section className="workday-work" aria-label="Completed work">
          <h3>Completed work</h3>
          {workday.completedItems.length > 0 ? (
            <ul>
              {workday.completedItems.map((item) => {
                const proofCount = item.photoIds.filter((photoId) => {
                  const photo = photoById.get(photoId);
                  return photo && !photo.voidedAt;
                }).length;
                return (
                  <li key={item.id} data-work-item={item.id}>
                    <span>{item.text}</span>
                    <span className={proofCount > 0 ? 'workday-proof-count' : 'workday-proof-missing'}>
                      {proofCount > 0
                        ? countLabel(proofCount, 'proof photo')
                        : 'Photo proof missing'}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No completed work saved.</p>
          )}
          {workday.openItems.length > 0 ? (
            <p className="workday-open-count">{countLabel(workday.openItems.length, 'open work item')}</p>
          ) : null}
        </section>

        <section className="workday-proof" aria-label="Photo proof">
          <div className="workday-section-head">
            <h3>Photo proof</h3>
            <span>{countLabel(workday.photos.length, 'photo')}</span>
          </div>
          {thumbnails.length > 0 ? (
            <div className="ledger-photo-strip">{thumbnails.map((photo) => <LedgerPhoto key={photo.id} photo={photo} />)}</div>
          ) : (
            <p>{workday.photos.length > 0 ? 'No active photos remain.' : 'No photos saved.'}</p>
          )}
          {workday.photos.length !== activePhotos.length ? (
            <p className="workday-muted">{countLabel(workday.photos.length - activePhotos.length, 'voided photo')} kept in the record.</p>
          ) : null}
        </section>

        <section className="workday-daily" aria-label="Daily record">
          <h3>Daily record</h3>
          {record ? (
            <p>{record.body}</p>
          ) : (
            <p className="workday-missing">Daily record missing</p>
          )}
        </section>
      </div>

      {onOpen ? (
        <button
          id={`workday-${workday.dateKey}-open`}
          type="button"
          className="btn btn-secondary workday-open"
          onClick={onOpen}
        >
          Open workday
        </button>
      ) : null}
    </article>
  );
}

export function WorkdayLedger({
  project,
  workdays,
  photos,
  phase,
  checkedAt,
  filter,
  loading,
  onFilterChange,
  onOpenWorkday,
  onOpenReview,
  onOpenPacket,
  onOpenView,
  onEditProject,
  onTakePhoto,
}: WorkdayLedgerProps) {
  const visibleWorkdays = filterWorkdays(workdays, filter);
  const attentionCount = filterWorkdays(workdays, 'needs-attention').length;
  const activePhotoCount = photos.filter((photo) => !photo.voidedAt).length;
  const completedCount = workdays.reduce((total, day) => total + day.completedItems.length, 0);
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const primaryOpensPacket = phase === 'ready';

  return (
    <div className="workday-ledger">
      <header className={`project-ledger-head phase-${phase}`}>
        <div className="project-ledger-title">
          <span className="section-label">Workday Ledger</span>
          <h1>{project.name}</h1>
          {project.client ? <p>{project.client}</p> : null}
          {project.address ? <p>{project.address}</p> : null}
        </div>

        <div className="project-ledger-state">
          <span className="project-status-label">{HANDOFF_STATUS_LABELS[phase]}</span>
          <button
            id="handoff-review-toggle"
            type="button"
            className="btn btn-primary"
            onClick={primaryOpensPacket ? onOpenPacket : onOpenReview}
          >
            {HANDOFF_ACTION_LABELS[phase]}
          </button>
        </div>

        <div className="project-ledger-facts">
          <span>{formatWorkdayRange(workdays)}</span>
          <span>{countLabel(workdays.length, 'workday')}</span>
          <span>{countLabel(activePhotoCount, 'photo')}</span>
          <span>{countLabel(completedCount, 'completed item')}</span>
          {checkedAt ? (
            <span>
              {phase === 'check-failed' ? 'Prior completed review' : 'Reviewed'}{' '}
              {new Date(checkedAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        <nav className="project-ledger-actions" aria-label="Project actions">
          <button type="button" onClick={() => onOpenView('photos')}>Photos</button>
          <button type="button" onClick={() => onOpenView('work-items')}>Work items</button>
          <button type="button" onClick={() => onOpenView('daily-records')}>Daily records</button>
          <button type="button" onClick={() => onOpenView('reports')}>Reports</button>
          {primaryOpensPacket ? null : <button type="button" onClick={onOpenPacket}>Handoff Packet</button>}
          <button type="button" onClick={onEditProject}>Project settings</button>
        </nav>
      </header>

      <div className="ledger-toolbar">
        <div className="segmented ledger-filters" aria-label="Workday filter">
          <button
            type="button"
            className={`segment${filter === 'all' ? ' active' : ''}`}
            aria-pressed={filter === 'all'}
            onClick={() => onFilterChange('all')}
          >
            All workdays <span>{workdays.length}</span>
          </button>
          <button
            type="button"
            className={`segment${filter === 'needs-attention' ? ' active' : ''}`}
            aria-pressed={filter === 'needs-attention'}
            onClick={() => onFilterChange('needs-attention')}
          >
            Needs attention <span>{attentionCount}</span>
          </button>
        </div>
      </div>

      {loading ? <p className="ledger-message">Loading job record…</p> : null}
      {!loading && workdays.length === 0 ? (
        <section className="empty-ledger">
          <h2>Start this job record</h2>
          <p>Add the first part of the day. You can fill in the rest later.</p>
          <div>
            <button type="button" className="btn btn-capture" onClick={onTakePhoto}>Take a photo</button>
            <button type="button" className="btn btn-secondary" onClick={() => onOpenView('work-items')}>Add work item</button>
            <button type="button" className="btn btn-secondary" onClick={() => onOpenView('daily-records')}>Add daily record</button>
          </div>
        </section>
      ) : null}
      {!loading && workdays.length > 0 && visibleWorkdays.length === 0 ? (
        <p className="ledger-message">No workdays match this filter.</p>
      ) : null}
      <div className="workday-list">
        {visibleWorkdays.map((workday) => (
          <WorkdayRow
            key={workday.dateKey}
            workday={workday}
            photoById={photoById}
            onOpen={onOpenWorkday ? () => onOpenWorkday(workday.dateKey) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
