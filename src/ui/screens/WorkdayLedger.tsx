import { useEffect, useRef } from 'react';
import type { CloseoutPhase, CloseoutProposal } from '../../domain/closeout.ts';
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
  passedPhotoCount?: number;
  filter: WorkdayFilter;
  loading: boolean;
  onFilterChange: (filter: WorkdayFilter) => void;
  onOpenWorkday?: (dateKey: string) => void;
  onOpenReview: () => void;
  onReviewProposal?: (proposalId: string) => void;
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

function LedgerSuggestion({ proposal, photo, target, onReview }: {
  proposal: CloseoutProposal;
  photo?: Photo;
  target: string;
  onReview?: (proposalId: string) => void;
}) {
  return (
    <div className="ledger-suggestion" id={`suggestion-${proposal.id}`} data-suggestion={proposal.id} tabIndex={-1}>
      <strong className="ledger-suggestion-label">Suggested</strong>
      {photo ? <LedgerPhoto photo={photo} /> : null}
      <p>{proposal.kind === 'daily-log' ? proposal.body : photo?.caption || 'Proof photo'}</p>
      <button type="button" className="btn btn-secondary" aria-label={`Review suggestion for ${target}`}
        onClick={() => onReview?.(proposal.id)}>Review</button>
    </div>
  );
}

function WorkdayRow({
  workday,
  photoById,
  onOpen,
  onReviewProposal,
}: {
  workday: WorkdayViewModel;
  photoById: ReadonlyMap<string, Photo>;
  onOpen?: () => void;
  onReviewProposal?: (proposalId: string) => void;
}) {
  const activePhotos = workday.photos.filter((photo) => !photo.voidedAt);
  const thumbnails = workday.representativePhotoIds.flatMap((id) => {
    const photo = photoById.get(id);
    return photo ? [photo] : [];
  });
  const record = workday.dailyRecord;
  const pending = workday.suggestedUpdates.filter((proposal) => proposal.status === 'pending' && !proposal.dismissed);

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
                const suggestions = pending.filter((proposal) => proposal.kind === 'photo-link' && proposal.punchItemId === item.id);
                const savedProof = workday.suggestedUpdates.find((proposal) =>
                  proposal.kind === 'photo-link' && proposal.punchItemId === item.id &&
                  proposal.status === 'applied' && item.photoIds.includes(proposal.photoId));
                const savedPhoto = savedProof?.kind === 'photo-link' ? photoById.get(savedProof.photoId) : undefined;
                return (
                  <li key={item.id} data-work-item={item.id} className={proofCount === 0 && !item.proofException ? 'ledger-gap' : undefined}>
                    <span>{item.text}</span>
                    <span className={proofCount > 0 ? 'workday-proof-count' : 'workday-proof-missing'}>
                      {proofCount > 0
                        ? countLabel(proofCount, 'proof photo')
                        : item.proofException ? `No-photo reason: ${item.proofException.reason}` : 'Photo proof missing'}
                    </span>
                    {suggestions.map((proposal) => (
                      <LedgerSuggestion key={proposal.id} proposal={proposal}
                        photo={proposal.kind === 'photo-link' ? photoById.get(proposal.photoId) : undefined}
                        target={item.text} onReview={onReviewProposal} />
                    ))}
                    {savedPhoto && !savedPhoto.voidedAt ? <div className="ledger-saved-proof"><LedgerPhoto photo={savedPhoto} /><span>Saved proof</span></div> : null}
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
          {pending.filter((proposal) => proposal.kind === 'daily-log').map((proposal) => (
            <LedgerSuggestion key={proposal.id} proposal={proposal} target={`daily record on ${formatDate(workday.dateKey)}`} onReview={onReviewProposal} />
          ))}
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
  passedPhotoCount,
  filter,
  loading,
  onFilterChange,
  onOpenWorkday,
  onOpenReview,
  onReviewProposal,
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
  const pending = workdays.flatMap((day) => day.suggestedUpdates.filter((proposal) => proposal.status === 'pending' && !proposal.dismissed));
  const firstPendingId = pending[0]?.id;
  const previousPendingId = useRef(firstPendingId);
  useEffect(() => {
    const arrived = firstPendingId && firstPendingId !== previousPendingId.current;
    previousPendingId.current = firstPendingId;
    if (arrived) {
      onFilterChange('all');
      requestAnimationFrame(() => {
        document.getElementById(`suggestion-${firstPendingId}`)?.closest('.workday-row')?.scrollIntoView({ block: 'start' });
      });
    }
  }, [firstPendingId, onFilterChange]);
  const showReviewBar = pending.length > 0 || phase !== 'not-checked';

  return (
    <div className={`workday-ledger${showReviewBar ? ' has-review-bar' : ''}`}>
      <header className={`project-ledger-head phase-${phase}`}>
        <div className="project-ledger-title">
          <span className="section-label">Workday Ledger</span>
          <h1>{project.name}</h1>
          {project.client ? <p>{project.client}</p> : null}
          {project.address ? <p>{project.address}</p> : null}
        </div>

        <div className="project-ledger-state">
          <span className="project-status-label" aria-live="polite">{HANDOFF_STATUS_LABELS[phase]}</span>
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

      {showReviewBar ? (
        <section className={`ledger-review-bar phase-${phase}`} aria-label="Project review">
          <div className="ledger-review-bar-head">
            <div role="status">
              <strong>{pending.length > 0 ? countLabel(pending.length, 'suggestion ready to review', 'suggestions ready to review') : HANDOFF_STATUS_LABELS[phase]}</strong>
              <span>{pending.length > 0 ? 'Nothing is saved until you approve it.' : phase === 'checking' ? 'Checking the job record.' : passedPhotoCount !== undefined ? countLabel(passedPhotoCount, 'photo passed', 'photos passed') : 'Open the review for details.'}</span>
            </div>
            <button type="button" className="btn btn-primary" disabled={phase === 'checking'}
              onClick={() => firstPendingId ? onReviewProposal?.(firstPendingId) : primaryOpensPacket ? onOpenPacket() : onOpenReview()}>
              {pending.length > 0 ? 'Review suggestions' : HANDOFF_ACTION_LABELS[phase]}
            </button>
          </div>
          {pending.length > 0 ? (
            <nav className="ledger-suggestion-links" aria-label="Jump to suggestion">
              {pending.map((proposal, index) => (
                <button key={proposal.id} type="button" onClick={() => {
                  onFilterChange('all');
                  requestAnimationFrame(() => {
                    const target = document.getElementById(`suggestion-${proposal.id}`);
                    target?.scrollIntoView({ block: 'center' });
                    target?.focus({ preventScroll: true });
                  });
                }}>{index + 1}. {proposal.kind === 'photo-link' ? proposal.punchItemLabel : `Daily record · ${formatDate(proposal.logDate)}`}</button>
              ))}
            </nav>
          ) : null}
        </section>
      ) : null}

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
            onReviewProposal={onReviewProposal}
            onOpen={onOpenWorkday ? () => onOpenWorkday(workday.dateKey) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
