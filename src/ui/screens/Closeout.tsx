import { useEffect, useMemo, useState } from 'react';
import type { CloseoutFinding, CloseoutProposal } from '../../domain/closeout.ts';
import type { Photo, Project, PunchItem } from '../../domain/types.ts';
import { closeoutService, closeoutSessions } from '../../data/closeoutClient.ts';
import {
  useProjectCloseoutSession,
  type ProjectCloseoutSession,
  type ReviewProgress,
  type ReviewStepState,
} from '../../data/closeoutSession.ts';
import { HANDOFF_STATUS_LABELS } from '../handoffLabels.ts';
import { usePhotoUrl } from '../usePhotoUrl.ts';

type ProposalFacts = {
  target: string;
  workdayDate?: string;
  photo?: Photo;
  photoCheck?: string;
  alternatePhotos?: Photo[];
  sourceWorkItems?: string[];
  sourcePhotos?: string[];
};

type CloseoutViewProps = {
  focusProposalId?: string;
  projectName: string;
  session: ProjectCloseoutSession;
  findingLabels: Record<string, string>;
  proposalFacts: Record<string, ProposalFacts>;
  agentAvailable: boolean;
  busy: boolean;
  applying: boolean;
  error: string;
  onRunCheck: () => void;
  onOpenFinding: (finding: CloseoutFinding) => void;
  onOpenPacket: () => void;
  onToggleProposal: (proposalId: string, selected: boolean) => void;
  onUpdateLogBody: (proposalId: string, body: string) => void;
  onChoosePhoto: (proposalId: string, photoId: string) => void;
  onRejectProposal: (proposalId: string) => void;
  onDismissProposal: (proposalId: string) => void;
  onApplySelected: () => void;
};

const PROPOSAL_STATUS: Record<CloseoutProposal['status'], string> = {
  pending: 'Pending review',
  rejected: 'Rejected',
  applied: 'Saved',
  stale: 'Stale',
  failed: 'Failed',
};

const ACTIVITY_STATUS: Record<'started' | 'success' | 'refused' | 'cancelled' | 'error', string> = {
  started: 'Started',
  success: 'Done',
  refused: 'Declined',
  cancelled: 'Canceled',
  error: 'Needs attention',
};

const ACTIVITY_LABELS: Record<string, string> = {
  handoff_review: 'Handoff review',
  verify_project_seals: 'Photo check',
  audit_project_closeout: 'Handoff review',
  stage_photo_link: 'Suggested photo link',
  stage_daily_log: 'Suggested daily record',
  apply_selected_proposals: 'Saved selected updates',
};

const ACTIVITY_SOURCES: Record<string, string> = {
  handoff_review: 'Page button',
  apply_selected_proposals: 'Page button',
  verify_project_seals: 'WebMCP tool',
  audit_project_closeout: 'WebMCP tool',
  stage_photo_link: 'WebMCP tool',
  stage_daily_log: 'WebMCP tool',
  open_evidence_packet: 'WebMCP tool',
  explain_evidence_policy: 'WebMCP tool',
};

const REVIEW_STEPS: Array<{ key: 'photoCheck' | 'workItems' | 'dailyRecords'; label: string }> = [
  { key: 'photoCheck', label: 'Checking original photos' },
  { key: 'workItems', label: 'Reviewing work items' },
  { key: 'dailyRecords', label: 'Reviewing daily records' },
];

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatCapturedAt(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortPhotoId(photoId: string): string {
  return photoId.length <= 14 ? photoId : `${photoId.slice(0, 7)}…${photoId.slice(-4)}`;
}

function ProposalPhotoPreview({ photo }: { photo: Photo }) {
  const url = usePhotoUrl(photo.id);
  const alt = photo.caption?.trim() || `Suggested proof photo from ${formatDate(photo.capturedAt.slice(0, 10))}`;
  return (
    <div className="closeout-proposal-preview" data-photo-preview={photo.id}>
      {url ? (
        <img src={url} alt={alt} />
      ) : (
        <span className="closeout-proposal-preview-placeholder" aria-label={alt} />
      )}
    </div>
  );
}

function reviewStepLabel(step: ReviewStepState, progress: ReviewProgress): string {
  if (step === 'complete') return 'Complete';
  if (step === 'active' && ['failed', 'cancelled'].includes(progress.state)) return 'Stopped';
  if (step === 'active') return 'In progress';
  return 'Not started';
}

function ReviewProgressPanel({ progress }: { progress: ReviewProgress }) {
  const stopped = progress.state === 'failed' || progress.state === 'cancelled';
  return (
    <section className="closeout-group closeout-progress">
      <h3>Review progress</h3>
      <ol>
        {REVIEW_STEPS.map((step) => (
          <li className={`state-${progress[step.key]}`} key={step.key}>
            <span>{step.label}</span>
            <strong>{reviewStepLabel(progress[step.key], progress)}</strong>
          </li>
        ))}
      </ol>
      {stopped ? <p>No job record was changed by this review.</p> : null}
    </section>
  );
}

function FindingGroup({
  title,
  findings,
  labels,
  onOpen,
}: {
  title: string;
  findings: CloseoutFinding[];
  labels: Record<string, string>;
  onOpen: (finding: CloseoutFinding) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <section className="closeout-group">
      <h3>{title} ({findings.length})</h3>
      <div className="closeout-findings">
        {findings.map((finding) => (
          <button
            type="button"
            className={`closeout-finding ${finding.severity}`}
            key={finding.id}
            onClick={() => onOpen(finding)}
          >
            <span className="closeout-finding-code">{labels[finding.id] ?? 'Project record'}</span>
            <strong>{finding.message}</strong>
            {finding.workdayDate ? (
              <span>{new Date(`${finding.workdayDate}T12:00:00`).toLocaleDateString()}</span>
            ) : null}
            <span>{finding.suggestedAction}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function CloseoutView({
  focusProposalId,
  projectName,
  session,
  findingLabels,
  proposalFacts,
  agentAvailable,
  busy,
  applying,
  error,
  onRunCheck,
  onOpenFinding,
  onOpenPacket,
  onToggleProposal,
  onUpdateLogBody,
  onChoosePhoto,
  onRejectProposal,
  onDismissProposal,
  onApplySelected,
}: CloseoutViewProps) {
  const status = HANDOFF_STATUS_LABELS[session.phase];
  const audit = session.audit;
  const blockers = audit?.findings.filter((finding) => finding.severity === 'blocker') ?? [];
  const warnings = audit?.findings.filter((finding) => finding.severity === 'warning') ?? [];
  const ready = session.phase === 'ready' || session.phase === 'ready-with-warnings';
  const auditIsPrior = Boolean(
    audit && ['checking', 'check-again', 'check-failed'].includes(session.phase),
  );
  const latestAttempt = session.reviewProgress &&
    ['failed', 'cancelled'].includes(session.reviewProgress.state)
    ? session.reviewProgress.finishedAt
    : undefined;
  const visibleProposals = session.proposals.filter((proposal) => !proposal.dismissed);
  const selectedCount = visibleProposals.filter(
    (proposal) => proposal.status === 'pending' && proposal.selected,
  ).length;
  useEffect(() => {
    if (!focusProposalId) return;
    const target = document.getElementById(`review-${focusProposalId}`);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [focusProposalId]);

  return (
    <div className="closeout-screen">
      <section className={`closeout-summary phase-${session.phase}`}>
        <div>
          <span className="section-label">Project handoff</span>
          <h2>{projectName}</h2>
        </div>
        <span className="closeout-status" aria-live="polite">{status}</span>
      </section>

      <p className="closeout-rule">
        Fix the items under Needs attention before handoff. Review the notes too. FieldProof saves
        job changes only after you approve them.
      </p>

      <div className="closeout-agent-note">
        {agentAvailable
          ? 'Want help? Ask your browser assistant: “Check this project for client handoff.”'
          : 'You can check the project and review its proof here.'}
      </div>

      {session.reviewProgress ? <ReviewProgressPanel progress={session.reviewProgress} /> : null}

      {audit ? (
        <section className="closeout-group closeout-result-summary">
          <strong>{auditIsPrior ? 'Prior completed review' : 'Completed review'}</strong>
          <span className="meta-line">Reviewed {new Date(audit.checkedAt).toLocaleString()}</span>
          <div className="closeout-counts num">
            <span>{countLabel(audit.blockerCount, 'blocker item')}</span>
            <span>{countLabel(audit.warningCount, 'warning item')}</span>
            <span>{countLabel(audit.counts.workdays, 'workday')}</span>
            <span>{countLabel(audit.counts.photos, 'photo')}</span>
            <span>{countLabel(audit.counts.punchItems, 'work item')}</span>
            <span>{countLabel(audit.counts.dailyLogs, 'daily record')}</span>
          </div>
        </section>
      ) : null}

      {session.verification ? (
        <section className="closeout-group closeout-result-summary">
          <strong>Photo check</strong>
          <div className="closeout-counts num">
            <span>{countLabel(session.verification.summary.pass, 'passed photo')}</span>
            <span>{countLabel(session.verification.summary.fail, 'failed photo')}</span>
            <span>{countLabel(session.verification.summary.unreadable, 'unreadable photo')}</span>
            <span>{countLabel(session.verification.summary.excluded, 'excluded photo')}</span>
          </div>
        </section>
      ) : null}

      {latestAttempt ? (
        <p className="closeout-callout">
          <strong>Latest attempt</strong>{' '}
          {new Date(latestAttempt).toLocaleString()}. No job record was changed.
        </p>
      ) : null}

      {session.phase === 'check-again' && (
        <p className="closeout-callout">The project changed after this result. Run a new check.</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {session.phase !== 'checking' ? (
        <button
          type="button"
          className="btn btn-secondary btn-block"
          disabled={busy}
          onClick={onRunCheck}
        >
          {session.phase === 'check-failed'
            ? 'Try again'
            : audit
              ? 'Check again'
              : 'Run handoff review'}
        </button>
      ) : null}

      <FindingGroup
        title="Needs attention"
        findings={blockers}
        labels={findingLabels}
        onOpen={onOpenFinding}
      />
      <FindingGroup
        title="Worth a look"
        findings={warnings}
        labels={findingLabels}
        onOpen={onOpenFinding}
      />

      {visibleProposals.length > 0 && (
        <section className="closeout-group closeout-proposals">
          <h3>Suggested updates</h3>
          <p className="proof-help">Review each update. FieldProof saves only the ones you select.</p>
          {visibleProposals.some((proposal) => proposal.status === 'pending') && (
            <div className="closeout-save-bar">
              <span aria-live="polite">{selectedCount} selected</span>
              <button type="button" className="btn btn-primary btn-block"
                disabled={selectedCount === 0 || applying} onClick={onApplySelected}>
                {applying ? 'Saving selected updates…' : `Save selected updates (${selectedCount})`}
              </button>
            </div>
          )}
          <div className="closeout-proposal-list">
            {visibleProposals.map((proposal) => {
              const facts = proposalFacts[proposal.id];
              const pending = proposal.status === 'pending';
              const canDismiss = ['rejected', 'stale', 'failed'].includes(proposal.status);
              return (
                <article
                  id={`review-${proposal.id}`}
                  tabIndex={-1}
                  className={`closeout-proposal status-${proposal.status}${proposal.selected ? ' is-selected' : ''}`}
                  data-proposal-card={proposal.id}
                  key={proposal.id}
                >
                  <div className="closeout-proposal-head">
                    <strong>{proposal.kind === 'photo-link' ? 'Possible proof photo' : 'Draft daily record'}</strong>
                    <span>{PROPOSAL_STATUS[proposal.status]}</span>
                  </div>
                  <span className="closeout-proposal-fact">{facts?.target ?? 'Project record'}</span>
                  {facts?.workdayDate ? (
                    <span className="meta-line">Workday {formatDate(facts.workdayDate)}</span>
                  ) : null}

                  {proposal.kind === 'photo-link' && facts?.photo ? (
                    <>
                      <ProposalPhotoPreview photo={facts.photo} />
                      <div className="closeout-proposal-photo-facts">
                        <strong>{facts.photo.caption?.trim() || 'No caption saved'}</strong>
                        <span>{formatCapturedAt(facts.photo.capturedAt)}</span>
                        <span>Photo ID {shortPhotoId(facts.photo.id)}</span>
                        <span>Photo check {facts.photoCheck?.toLowerCase() ?? 'not available'}</span>
                      </div>
                      <p className="closeout-proposal-source">
                        Suggested from the saved date, caption, photo ID, and work timing.
                      </p>
                      <p>{proposal.reason}</p>
                      <p className="closeout-responsibility">
                        You must confirm that this photo proves the work.
                      </p>
                      {pending && (facts.alternatePhotos?.length ?? 0) > 0 ? (
                        <label className="field closeout-candidate-select">
                          <span>Choose another</span>
                          <select
                            value={proposal.photoId}
                            aria-label={`Choose another photo for ${facts.target}`}
                            onChange={(event) => {
                              if (event.target.value !== proposal.photoId) {
                                onChoosePhoto(proposal.id, event.target.value);
                              }
                            }}
                          >
                            <option value={proposal.photoId}>
                              Current: {facts.photo.caption?.trim() || shortPhotoId(facts.photo.id)}
                            </option>
                            {facts.alternatePhotos?.map((photo) => (
                              <option value={photo.id} key={photo.id}>
                                {photo.caption?.trim() || shortPhotoId(photo.id)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </>
                  ) : null}

                  {proposal.kind === 'daily-log' ? (
                    <>
                      <p>{proposal.reason}</p>
                      <div className="closeout-proposal-sources">
                        <div>
                          <strong>Saved work items</strong>
                          <ul>
                            {(facts?.sourceWorkItems ?? []).map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div>
                          <strong>Saved photo captions</strong>
                          <ul>
                            {(facts?.sourcePhotos ?? []).map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {proposal.kind === 'daily-log' && pending && (
                    <label className="field closeout-proposal-body">
                      <span>Draft daily record</span>
                      <textarea
                        rows={4}
                        maxLength={4_000}
                        value={proposal.body}
                        onChange={(event) => onUpdateLogBody(proposal.id, event.target.value)}
                      />
                    </label>
                  )}
                  {proposal.kind === 'daily-log' && !pending && (
                    <p className="closeout-proposal-draft">{proposal.body}</p>
                  )}
                  {proposal.kind === 'daily-log' ? (
                    <p className="closeout-responsibility">You are responsible for the final wording.</p>
                  ) : null}
                  {proposal.resultMessage && <p className="meta-line" role="status">{proposal.resultMessage}</p>}
                  {pending && (
                    <div className="closeout-proposal-actions">
                      <label className="closeout-proposal-select">
                        <input
                          type="checkbox"
                          checked={proposal.selected}
                          aria-label={`Select update for ${facts?.target ?? 'project record'}`}
                          onChange={(event) => onToggleProposal(proposal.id, event.target.checked)}
                        />
                        {proposal.selected ? 'Selected for saving' : 'Select this update'}
                      </label>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => onRejectProposal(proposal.id)}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {canDismiss ? (
                    <button
                      type="button"
                      className="btn btn-quiet closeout-dismiss"
                      onClick={() => onDismissProposal(proposal.id)}
                    >
                      Dismiss
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {session.activity.length > 0 && (
        <details className="closeout-group closeout-activity">
          <summary>Review history</summary>
          <div className="closeout-activity-list">
            {session.activity
              .slice(-12)
              .reverse()
              .map((item) => (
                <div className={`closeout-activity-row outcome-${item.outcome}`} key={item.id}>
                  <strong>{ACTIVITY_LABELS[item.action] ?? item.action.replaceAll('_', ' ')}</strong>
                  <span className="closeout-activity-source">
                    {ACTIVITY_SOURCES[item.action] ?? 'Recorded action'}
                  </span>
                  <span>{projectName}</span>
                  <span>{item.detail}</span>
                  <span className="meta-line">
                    {ACTIVITY_STATUS[item.outcome]} · {new Date(item.occurredAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
          </div>
        </details>
      )}

      {audit && ready && blockers.length === 0 && warnings.length === 0 && (
        <div className="closeout-clean">
          <strong>Ready for handoff</strong>
          <span className="meta-line">Checked {new Date(audit.checkedAt).toLocaleString()}</span>
        </div>
      )}

      <button
        type="button"
        className={`btn ${ready ? 'btn-primary' : 'btn-secondary'} btn-block closeout-packet`}
        onClick={onOpenPacket}
      >
        {ready ? 'Open handoff packet' : `Handoff packet · ${status}`}
      </button>
    </div>
  );
}

export function Closeout({
  focusProposalId,
  project,
  photos,
  punchItems,
  onOpenFinding,
  onOpenPacket,
}: {
  focusProposalId?: string;
  project: Project;
  photos: Photo[];
  punchItems: PunchItem[];
  onOpenFinding: (finding: CloseoutFinding) => void;
  onOpenPacket: () => void;
}) {
  const session = useProjectCloseoutSession(project.id, closeoutSessions);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const agentAvailable = typeof document !== 'undefined' && Boolean(document.modelContext);

  const findingLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const finding of session.audit?.findings ?? []) {
      if (finding.entityType === 'punch') {
        labels[finding.id] = punchItems.find((item) => item.id === finding.entityId)?.text ?? 'Punch item';
      } else if (finding.entityType === 'photo') {
        const photo = photos.find((item) => item.id === finding.entityId);
        labels[finding.id] = photo?.caption?.trim() || (photo ? new Date(photo.capturedAt).toLocaleString() : 'Photo');
      } else if (finding.entityType === 'daily-log') {
        labels[finding.id] = finding.entityId
          ? new Date(`${finding.entityId}T12:00:00`).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : 'Daily log';
      } else {
        labels[finding.id] = project.name;
      }
    }
    return labels;
  }, [photos, project.name, punchItems, session.audit?.findings]);

  const proposalFacts = useMemo(() => {
    const facts: Record<string, ProposalFacts> = {};
    for (const proposal of session.proposals) {
      if (proposal.kind === 'photo-link') {
        const punchItem = punchItems.find((item) => item.id === proposal.punchItemId);
        const photo = photos.find((item) => item.id === proposal.photoId);
        const check = session.verification?.results.find((item) => item.photoId === proposal.photoId)?.status;
        const candidateIds = session.audit?.candidates[proposal.punchItemId] ?? [];
        facts[proposal.id] = {
          target: punchItem?.text ?? proposal.punchItemLabel,
          workdayDate: proposal.workdayDate,
          photo,
          photoCheck:
            check === 'pass'
              ? 'Passed'
              : check === 'fail'
                ? 'Failed'
                : check === 'unreadable'
                  ? 'Unreadable'
                  : check === 'excluded'
                    ? 'Excluded'
                    : 'Not available',
          alternatePhotos: candidateIds.flatMap((candidate) => {
            if (candidate.photoId === proposal.photoId) return [];
            const alternate = photos.find((item) => item.id === candidate.photoId);
            return alternate ? [alternate] : [];
          }),
        };
      } else {
        facts[proposal.id] = {
          target: formatDate(proposal.logDate),
          workdayDate: proposal.logDate,
          sourceWorkItems: proposal.sourceWorkItemIds.flatMap((itemId) => {
            const item = punchItems.find((row) => row.id === itemId);
            return item ? [item.text] : [];
          }),
          sourcePhotos: proposal.sourcePhotoIds.flatMap((photoId) => {
            const sourcePhoto = photos.find((item) => item.id === photoId);
            return sourcePhoto ? [sourcePhoto.caption?.trim() || `Photo ${shortPhotoId(photoId)}`] : [];
          }),
        };
      }
    }
    return facts;
  }, [photos, punchItems, session.audit?.candidates, session.proposals, session.verification]);

  function changeProposal(change: () => void) {
    setError('');
    try {
      change();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'FieldProof could not update this suggestion.');
    }
  }

  async function choosePhoto(proposalId: string, photoId: string) {
    setError('');
    try {
      await closeoutService.replacePhotoCandidate(project.id, proposalId, photoId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'FieldProof could not change the photo.');
    }
  }

  async function runCheck() {
    setRunning(true);
    setError('');
    try {
      await closeoutService.runCloseoutCheck(project.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'FieldProof could not finish the check.');
    } finally {
      setRunning(false);
    }
  }

  async function applySelected() {
    setApplying(true);
    setError('');
    try {
      await closeoutService.applySelectedProposals(project.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'FieldProof could not save the updates.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <CloseoutView
      focusProposalId={focusProposalId}
      projectName={project.name}
      session={session}
      findingLabels={findingLabels}
      proposalFacts={proposalFacts}
      agentAvailable={agentAvailable}
      busy={running || session.phase === 'checking'}
      applying={applying}
      error={error}
      onRunCheck={() => void runCheck()}
      onOpenFinding={onOpenFinding}
      onOpenPacket={onOpenPacket}
      onToggleProposal={(proposalId, selected) => {
        changeProposal(() => closeoutService.setProposalSelected(project.id, proposalId, selected));
      }}
      onUpdateLogBody={(proposalId, body) => {
        changeProposal(() => closeoutService.updateDailyLogDraft(project.id, proposalId, body));
      }}
      onChoosePhoto={(proposalId, photoId) => {
        void choosePhoto(proposalId, photoId);
      }}
      onRejectProposal={(proposalId) => {
        changeProposal(() => closeoutService.rejectProposal(project.id, proposalId));
      }}
      onDismissProposal={(proposalId) => {
        changeProposal(() => closeoutService.dismissProposal(project.id, proposalId));
      }}
      onApplySelected={() => void applySelected()}
    />
  );
}
