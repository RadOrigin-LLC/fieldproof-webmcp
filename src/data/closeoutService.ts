import {
  auditCloseout,
  dailyLogSourceFingerprint,
  photoIdentityFingerprint,
  photoLinkSourceFingerprint,
  photoSourceFingerprint,
  type CloseoutAudit,
  type CloseoutProposal,
  type DailyLogProposal,
  type PhotoLinkProposal,
  type SealResult,
  type SealStatus,
  type SealVerification,
} from '../domain/closeout.ts';
import { localDateOf } from '../domain/dates.ts';
import { verifyBytes } from '../domain/hash.ts';
import { uuidv7 } from '../domain/ids.ts';
import { attachPhoto } from '../domain/punch.ts';
import type { DailyLog, Photo, Project, PunchItem } from '../domain/types.ts';
import type {
  CloseoutSessionStore,
  ReviewProgress,
  ReviewStepState,
} from './closeoutSession.ts';

export type CloseoutSnapshot = {
  project: Project;
  photos: Photo[];
  punchItems: PunchItem[];
  dailyLogs: DailyLog[];
};

export type CloseoutRepository = {
  readCloseoutSnapshot: (projectId: string) => Promise<CloseoutSnapshot | null>;
  getPhotoBytes: (photoId: string) => Promise<Blob | undefined>;
  getPunchItem: (punchItemId: string) => Promise<PunchItem | undefined>;
  getPhoto: (photoId: string) => Promise<Photo | undefined>;
  savePunchItem: (item: PunchItem) => Promise<void>;
  createDailyLogIfAbsent: (
    projectId: string,
    logDate: string,
    body: string,
  ) => Promise<DailyLog | null>;
};

type CloseoutServiceDependencies = {
  repository: CloseoutRepository;
  sessions: CloseoutSessionStore;
  now?: () => string;
};

export type CloseoutServiceErrorCode =
  | 'project-not-found'
  | 'verification-required'
  | 'review-in-progress'
  | 'invalid-input'
  | 'record-not-found'
  | 'record-not-eligible';

export class CloseoutServiceError extends Error {
  readonly code: CloseoutServiceErrorCode;

  constructor(code: CloseoutServiceErrorCode, message: string) {
    super(message);
    this.name = 'CloseoutServiceError';
    this.code = code;
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Handoff check canceled.', 'AbortError');
}

function summarize(results: SealResult[]): Record<SealStatus, number> {
  const summary: Record<SealStatus, number> = { pass: 0, fail: 0, unreadable: 0, excluded: 0 };
  for (const item of results) summary[item.status]++;
  return summary;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new CloseoutServiceError(
      'invalid-input',
      `${label} must be between 1 and ${maxLength} characters.`,
    );
  }
  return trimmed;
}

function sourceIds(values: string[] | undefined, label: string): string[] {
  const ids = values ?? [];
  if (
    ids.length > 12 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 128)
  ) {
    throw new CloseoutServiceError(
      'invalid-input',
      `${label} must contain at most 12 unique record IDs.`,
    );
  }
  return [...ids];
}

export type ApplyProposalResult = {
  proposalId: string;
  status: Extract<CloseoutProposal['status'], 'applied' | 'stale' | 'failed'>;
  message: string;
};

export function createCloseoutService({
  repository,
  sessions,
  now = () => new Date().toISOString(),
}: CloseoutServiceDependencies) {
  const activeReviews = new Map<string, { runId: string; controller: AbortController }>();

  const setProgress = (
    projectId: string,
    update: Partial<Omit<ReviewProgress, 'runId' | 'startedAt'>>,
  ) => {
    const current = sessions.getProject(projectId).reviewProgress;
    if (!current) return;
    sessions.setReviewProgress(projectId, { ...current, ...update });
  };

  const beginReview = (
    projectId: string,
    steps: {
      photoCheck: ReviewStepState;
      workItems: ReviewStepState;
      dailyRecords: ReviewStepState;
    },
    signal?: AbortSignal,
    continueAwaitingAudit = false,
  ) => {
    if (activeReviews.has(projectId)) {
      throw new CloseoutServiceError(
        'review-in-progress',
        'A handoff review is already running for this project.',
      );
    }

    const prior = sessions.getProject(projectId).reviewProgress;
    const runId = continueAwaitingAudit && prior?.state === 'awaiting-audit' ? prior.runId : uuidv7();
    const startedAt = continueAwaitingAudit && prior?.state === 'awaiting-audit'
      ? prior.startedAt
      : now();
    const controller = new AbortController();
    const reviewSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    activeReviews.set(projectId, { runId, controller });
    sessions.setReviewProgress(projectId, {
      runId,
      state: 'running',
      startedAt,
      ...steps,
    });
    sessions.setPhase(projectId, 'checking');
    return { runId, signal: reviewSignal };
  };

  const endReview = (projectId: string, runId: string) => {
    if (activeReviews.get(projectId)?.runId === runId) activeReviews.delete(projectId);
  };

  const failReview = (projectId: string, error: unknown) => {
    const cancelled = error instanceof DOMException && error.name === 'AbortError';
    setProgress(projectId, {
      state: cancelled ? 'cancelled' : 'failed',
      finishedAt: now(),
    });
    sessions.setPhase(projectId, 'check-failed');
  };

  const recordManualReview = (
    projectId: string,
    outcome: 'started' | 'success' | 'cancelled' | 'error',
    detail: string,
  ) => {
    sessions.addActivity(projectId, {
      id: uuidv7(),
      projectId,
      action: 'handoff_review',
      outcome,
      occurredAt: now(),
      detail,
    });
  };

  const requireSnapshot = async (projectId: string): Promise<CloseoutSnapshot> => {
    const snapshot = await repository.readCloseoutSnapshot(projectId);
    if (!snapshot) {
      throw new CloseoutServiceError('project-not-found', 'The active project no longer exists.');
    }
    return snapshot;
  };

  const verifySnapshot = async (
    snapshot: CloseoutSnapshot,
    signal?: AbortSignal,
  ): Promise<SealVerification> => {
    const results: SealResult[] = [];
    const photos = [...snapshot.photos].sort((a, b) => a.id.localeCompare(b.id));

    for (const item of photos) {
      assertNotAborted(signal);
      if (item.voidedAt) {
        results.push({ photoId: item.id, status: 'excluded' });
        continue;
      }

      const blob = await repository.getPhotoBytes(item.id);
      assertNotAborted(signal);
      if (!blob) {
        results.push({ photoId: item.id, status: 'unreadable' });
        continue;
      }

      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        assertNotAborted(signal);
        const check = await verifyBytes(bytes, item.sha256);
        assertNotAborted(signal);
        results.push({ photoId: item.id, status: check.ok ? 'pass' : 'fail' });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        results.push({ photoId: item.id, status: 'unreadable' });
      }
    }

    return {
      projectId: snapshot.project.id,
      checkedAt: now(),
      photoFingerprint: await photoSourceFingerprint(snapshot.photos),
      results,
      summary: summarize(results),
    };
  };

  const verifyProjectSeals = async (
    projectId: string,
    signal?: AbortSignal,
  ): Promise<SealVerification> => {
    const operation = beginReview(projectId, {
      photoCheck: 'active',
      workItems: 'pending',
      dailyRecords: 'pending',
    }, signal);
    try {
      assertNotAborted(operation.signal);
      const snapshot = await requireSnapshot(projectId);
      const verification = await verifySnapshot(snapshot, operation.signal);
      sessions.setVerification(projectId, verification);
      setProgress(projectId, {
        state: 'awaiting-audit',
        photoCheck: 'complete',
        workItems: 'pending',
        dailyRecords: 'pending',
      });
      sessions.setPhase(projectId, sessions.getProject(projectId).audit ? 'check-again' : 'not-checked');
      return verification;
    } catch (error) {
      failReview(projectId, error);
      throw error;
    } finally {
      endReview(projectId, operation.runId);
    }
  };

  const auditSnapshot = async (
    snapshot: CloseoutSnapshot,
    verification: SealVerification,
  ): Promise<CloseoutAudit> => {
    return auditCloseout({
      ...snapshot,
      verification,
      checkedAt: now(),
    });
  };

  const auditProjectCloseout = async (
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CloseoutAudit> => {
    const operation = beginReview(projectId, {
      photoCheck: 'complete',
      workItems: 'active',
      dailyRecords: 'pending',
    }, signal, true);
    try {
      assertNotAborted(operation.signal);
      const snapshot = await requireSnapshot(projectId);
      const verification = sessions.getProject(projectId).verification;
      const currentPhotoFingerprint = await photoSourceFingerprint(snapshot.photos);
      assertNotAborted(operation.signal);
      if (!verification || verification.photoFingerprint !== currentPhotoFingerprint) {
        throw new CloseoutServiceError(
          'verification-required',
          'Check the current project photos before checking handoff readiness.',
        );
      }

      const audit = await auditSnapshot(snapshot, verification);
      assertNotAborted(operation.signal);
      setProgress(projectId, {
        workItems: 'complete',
        dailyRecords: 'active',
      });
      await Promise.resolve();
      assertNotAborted(operation.signal);
      setProgress(projectId, {
        state: 'complete',
        finishedAt: now(),
        photoCheck: 'complete',
        workItems: 'complete',
        dailyRecords: 'complete',
      });
      sessions.setAudit(projectId, audit);
      return audit;
    } catch (error) {
      failReview(projectId, error);
      throw error;
    } finally {
      endReview(projectId, operation.runId);
    }
  };

  const runCloseoutCheck = async (
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CloseoutAudit> => {
    const operation = beginReview(projectId, {
      photoCheck: 'active',
      workItems: 'pending',
      dailyRecords: 'pending',
    }, signal);
    recordManualReview(projectId, 'started', 'Handoff review started.');
    try {
      assertNotAborted(operation.signal);
      const snapshot = await requireSnapshot(projectId);
      const verification = await verifySnapshot(snapshot, operation.signal);
      sessions.setVerification(projectId, verification);
      setProgress(projectId, {
        photoCheck: 'complete',
        workItems: 'active',
        dailyRecords: 'pending',
      });
      const audit = await auditSnapshot(snapshot, verification);
      assertNotAborted(operation.signal);
      setProgress(projectId, {
        workItems: 'complete',
        dailyRecords: 'active',
      });
      await Promise.resolve();
      assertNotAborted(operation.signal);
      setProgress(projectId, {
        state: 'complete',
        finishedAt: now(),
        photoCheck: 'complete',
        workItems: 'complete',
        dailyRecords: 'complete',
      });
      sessions.setAudit(projectId, audit);
      recordManualReview(projectId, 'success', 'Handoff review finished.');
      return audit;
    } catch (error) {
      failReview(projectId, error);
      recordManualReview(
        projectId,
        error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'error',
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Handoff review canceled. No job record was changed.'
          : 'Handoff review did not finish. No job record was changed.',
      );
      throw error;
    } finally {
      endReview(projectId, operation.runId);
    }
  };

  const cancelProjectReview = (projectId: string) => {
    activeReviews.get(projectId)?.controller.abort();
  };

  const requireCurrentVerification = async (
    projectId: string,
    snapshot: CloseoutSnapshot,
  ): Promise<SealVerification> => {
    const verification = sessions.getProject(projectId).verification;
    const currentFingerprint = await photoSourceFingerprint(snapshot.photos);
    if (!verification || verification.photoFingerprint !== currentFingerprint) {
      throw new CloseoutServiceError(
        'verification-required',
        'Check the current project photos before FieldProof suggests updates.',
      );
    }
    return verification;
  };

  const stagePhotoLink = async (
    projectId: string,
    input: { punchItemId: string; photoId: string; reason: string },
  ): Promise<PhotoLinkProposal> => {
    const reason = requiredText(input.reason, 'Reason', 240);
    const snapshot = await requireSnapshot(projectId);
    const punchItem = snapshot.punchItems.find((item) => item.id === input.punchItemId);
    const photo = snapshot.photos.find((item) => item.id === input.photoId);
    if (!punchItem || !photo) {
      throw new CloseoutServiceError('record-not-found', 'The punch item or photo was not found.');
    }
    if (
      punchItem.projectId !== projectId ||
      photo.projectId !== projectId ||
      punchItem.status !== 'done' ||
      photo.voidedAt ||
      punchItem.photoIds.includes(photo.id)
    ) {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'This punch item and photo cannot be paired for handoff.',
      );
    }
    const verification = await requireCurrentVerification(projectId, snapshot);
    if (verification.results.find((item) => item.photoId === photo.id)?.status !== 'pass') {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'Use a photo that passes the latest file check.',
      );
    }
    const [expectedPhotoIdentity, sourceFingerprint] = await Promise.all([
      photoIdentityFingerprint(photo),
      photoLinkSourceFingerprint(punchItem, photo),
    ]);
    const proposal: PhotoLinkProposal = {
      kind: 'photo-link',
      id: uuidv7(),
      projectId,
      createdAt: now(),
      status: 'pending',
      selected: false,
      dismissed: false,
      reason,
      punchItemId: punchItem.id,
      punchItemLabel: punchItem.text,
      workdayDate: localDateOf(punchItem.doneAt ?? punchItem.createdAt),
      photoId: photo.id,
      expectedPunchUpdatedAt: punchItem.updatedAt,
      expectedPhotoIdentity,
      sourceFingerprint,
    };
    sessions.addProposal(projectId, proposal);
    return proposal;
  };

  const stageDailyLog = async (
    projectId: string,
    input: {
      logDate: string;
      body: string;
      sourcePhotoIds?: string[];
      sourceWorkItemIds?: string[];
      reason: string;
    },
  ): Promise<DailyLogProposal> => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.logDate)) {
      throw new CloseoutServiceError('invalid-input', 'Log date must use YYYY-MM-DD.');
    }
    const body = requiredText(input.body, 'Daily log body', 4_000);
    const reason = requiredText(input.reason, 'Reason', 240);
    const sourcePhotoIds = sourceIds(input.sourcePhotoIds, 'Source photo IDs');
    const sourceWorkItemIds = sourceIds(input.sourceWorkItemIds, 'Source work item IDs');
    const snapshot = await requireSnapshot(projectId);
    if (snapshot.dailyLogs.some((item) => item.logDate === input.logDate)) {
      throw new CloseoutServiceError('record-not-eligible', 'A daily log already exists for this date.');
    }
    const sourcePhotos = sourcePhotoIds.map((id) => snapshot.photos.find((item) => item.id === id));
    if (sourcePhotos.some((item) => !item)) {
      throw new CloseoutServiceError('record-not-found', 'A source photo was not found.');
    }
    const checkedSourcePhotos = sourcePhotos as Photo[];
    if (
      checkedSourcePhotos.some(
        (item) =>
          item.projectId !== projectId ||
          Boolean(item.voidedAt) ||
          localDateOf(item.capturedAt) !== input.logDate,
      )
    ) {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'Each source photo must be active and belong to this workday.',
      );
    }
    const sourceWorkItems = sourceWorkItemIds.map((id) =>
      snapshot.punchItems.find((item) => item.id === id),
    );
    if (sourceWorkItems.some((item) => !item)) {
      throw new CloseoutServiceError('record-not-found', 'A source work item was not found.');
    }
    const checkedSourceWorkItems = sourceWorkItems as PunchItem[];
    if (
      checkedSourceWorkItems.some(
        (item) =>
          item.projectId !== projectId ||
          item.status !== 'done' ||
          !item.doneAt ||
          localDateOf(item.doneAt) !== input.logDate,
      )
    ) {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'Each source work item must be complete and belong to this workday.',
      );
    }
    const activePhotos = snapshot.photos.filter((item) => !item.voidedAt);
    const hasActivity =
      activePhotos.some((item) => localDateOf(item.capturedAt) === input.logDate) ||
      snapshot.punchItems.some(
        (item) => item.status === 'done' && item.doneAt && localDateOf(item.doneAt) === input.logDate,
      );
    if (!hasActivity) {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'The project has no recorded work for this date.',
      );
    }
    const sourceFingerprint = await dailyLogSourceFingerprint({
      logDate: input.logDate,
      sourceWorkItems: checkedSourceWorkItems,
      sourcePhotos: checkedSourcePhotos,
    });
    const proposal: DailyLogProposal = {
      kind: 'daily-log',
      id: uuidv7(),
      projectId,
      createdAt: now(),
      status: 'pending',
      selected: false,
      dismissed: false,
      reason,
      logDate: input.logDate,
      body,
      sourcePhotoIds,
      sourceWorkItemIds,
      sourceFingerprint,
      expectedLogAbsent: true,
    };
    sessions.addProposal(projectId, proposal);
    return proposal;
  };

  const requireProposal = (projectId: string, proposalId: string): CloseoutProposal => {
    const proposal = sessions
      .getProject(projectId)
      .proposals.find((item) => item.id === proposalId && item.projectId === projectId);
    if (!proposal) {
      throw new CloseoutServiceError('record-not-found', 'The suggested update was not found.');
    }
    return proposal;
  };

  const storeProposal = (projectId: string, proposal: CloseoutProposal): CloseoutProposal => {
    sessions.updateProposal(projectId, proposal.id, () => proposal);
    return proposal;
  };

  const setProposalSelected = (
    projectId: string,
    proposalId: string,
    selected: boolean,
  ): CloseoutProposal => {
    const proposal = requireProposal(projectId, proposalId);
    if (proposal.status !== 'pending' || proposal.dismissed) {
      throw new CloseoutServiceError('record-not-eligible', 'This update is no longer pending.');
    }
    if (selected && proposal.kind === 'daily-log' && !proposal.body.trim()) {
      throw new CloseoutServiceError('invalid-input', 'Add daily record text before selecting it.');
    }
    return storeProposal(projectId, { ...proposal, selected });
  };

  const updateDailyLogDraft = (
    projectId: string,
    proposalId: string,
    body: string,
  ): DailyLogProposal => {
    const proposal = requireProposal(projectId, proposalId);
    if (proposal.kind !== 'daily-log' || proposal.status !== 'pending' || proposal.dismissed) {
      throw new CloseoutServiceError('record-not-eligible', 'This daily record draft cannot be edited.');
    }
    if (typeof body !== 'string' || body.length > 4_000) {
      throw new CloseoutServiceError(
        'invalid-input',
        'Daily record text must be no more than 4000 characters.',
      );
    }
    const updated: DailyLogProposal = { ...proposal, body, selected: false };
    storeProposal(projectId, updated);
    return updated;
  };

  const rejectProposal = (projectId: string, proposalId: string): CloseoutProposal => {
    const proposal = requireProposal(projectId, proposalId);
    if (proposal.status !== 'pending' || proposal.dismissed) {
      throw new CloseoutServiceError('record-not-eligible', 'This update is no longer pending.');
    }
    return storeProposal(projectId, {
      ...proposal,
      status: 'rejected',
      selected: false,
      dismissed: false,
      resultMessage: 'Rejected by you. No job record was changed.',
    });
  };

  const dismissProposal = (projectId: string, proposalId: string): CloseoutProposal => {
    const proposal = requireProposal(projectId, proposalId);
    if (!['rejected', 'stale', 'failed'].includes(proposal.status)) {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'Only settled suggestions can be dismissed.',
      );
    }
    return storeProposal(projectId, { ...proposal, selected: false, dismissed: true });
  };

  const replacePhotoCandidate = async (
    projectId: string,
    proposalId: string,
    photoId: string,
  ): Promise<PhotoLinkProposal> => {
    const proposal = requireProposal(projectId, proposalId);
    if (proposal.kind !== 'photo-link' || proposal.status !== 'pending' || proposal.dismissed) {
      throw new CloseoutServiceError('record-not-eligible', 'This photo suggestion cannot be changed.');
    }
    const nextPhotoId = requiredText(photoId, 'Photo ID', 128);
    const snapshot = await requireSnapshot(projectId);
    const punchItem = snapshot.punchItems.find((item) => item.id === proposal.punchItemId);
    if (
      !punchItem ||
      punchItem.projectId !== projectId ||
      punchItem.status !== 'done' ||
      punchItem.updatedAt !== proposal.expectedPunchUpdatedAt
    ) {
      storeProposal(projectId, {
        ...proposal,
        status: 'stale',
        selected: false,
        dismissed: false,
        resultMessage: 'The work item changed. Check this update again.',
      });
      throw new CloseoutServiceError(
        'record-not-eligible',
        'The work item changed. Check this update again.',
      );
    }
    const photo = snapshot.photos.find((item) => item.id === nextPhotoId);
    if (!photo) {
      throw new CloseoutServiceError('record-not-found', 'The replacement photo was not found.');
    }
    if (
      photo.projectId !== projectId ||
      photo.voidedAt ||
      punchItem.photoIds.includes(photo.id)
    ) {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'Choose an active photo that is not already linked to this work item.',
      );
    }
    const verification = await requireCurrentVerification(projectId, snapshot);
    if (verification.results.find((item) => item.photoId === photo.id)?.status !== 'pass') {
      throw new CloseoutServiceError(
        'record-not-eligible',
        'Choose a photo that passes the latest file check.',
      );
    }
    const latest = requireProposal(projectId, proposalId);
    if (latest.kind !== 'photo-link' || latest.status !== 'pending' || latest.dismissed) {
      throw new CloseoutServiceError('record-not-eligible', 'This photo suggestion cannot be changed.');
    }
    const [expectedPhotoIdentity, sourceFingerprint] = await Promise.all([
      photoIdentityFingerprint(photo),
      photoLinkSourceFingerprint(punchItem, photo),
    ]);
    const updated: PhotoLinkProposal = {
      ...latest,
      selected: false,
      punchItemLabel: punchItem.text,
      workdayDate: localDateOf(punchItem.doneAt ?? punchItem.createdAt),
      photoId: photo.id,
      expectedPunchUpdatedAt: punchItem.updatedAt,
      expectedPhotoIdentity,
      sourceFingerprint,
      resultMessage: undefined,
    };
    storeProposal(projectId, updated);
    return updated;
  };

  const finishProposal = (
    projectId: string,
    proposal: CloseoutProposal,
    status: ApplyProposalResult['status'],
    message: string,
  ): ApplyProposalResult => {
    sessions.updateProposal(projectId, proposal.id, (current) => ({
      ...current,
      status,
      selected: false,
      dismissed: false,
      resultMessage: message,
    }));
    return { proposalId: proposal.id, status, message };
  };

  const applyPhotoLink = async (
    projectId: string,
    proposal: PhotoLinkProposal,
  ): Promise<ApplyProposalResult> => {
    const [punchItem, photo] = await Promise.all([
      repository.getPunchItem(proposal.punchItemId),
      repository.getPhoto(proposal.photoId),
    ]);
    const currentVerification = sessions.getProject(projectId).verification;
    const verified =
      currentVerification?.results.find((item) => item.photoId === proposal.photoId)?.status === 'pass';
    const [currentPhotoIdentity, currentSourceFingerprint] = punchItem && photo
      ? await Promise.all([
          photoIdentityFingerprint(photo),
          photoLinkSourceFingerprint(punchItem, photo),
        ])
      : ['', ''];
    if (
      !punchItem ||
      !photo ||
      punchItem.projectId !== projectId ||
      photo.projectId !== projectId ||
      punchItem.status !== 'done' ||
      punchItem.updatedAt !== proposal.expectedPunchUpdatedAt ||
      photo.voidedAt ||
      currentPhotoIdentity !== proposal.expectedPhotoIdentity ||
      currentSourceFingerprint !== proposal.sourceFingerprint ||
      !verified
    ) {
      return finishProposal(projectId, proposal, 'stale', 'The punch item or photo changed. Check it again.');
    }
    await repository.savePunchItem(attachPhoto(punchItem, photo.id, now()));
    return finishProposal(projectId, proposal, 'applied', 'Photo linked to the punch item.');
  };

  const applyDailyLog = async (
    projectId: string,
    proposal: DailyLogProposal,
  ): Promise<ApplyProposalResult> => {
    const snapshot = await repository.readCloseoutSnapshot(projectId);
    if (!snapshot) {
      return finishProposal(projectId, proposal, 'stale', 'The project record is no longer available.');
    }
    const sourcePhotos = proposal.sourcePhotoIds.map((photoId) =>
      snapshot.photos.find((item) => item.id === photoId),
    );
    const sourceWorkItems = proposal.sourceWorkItemIds.map((punchItemId) =>
      snapshot.punchItems.find((item) => item.id === punchItemId),
    );
    const currentLog = snapshot.dailyLogs.find((item) => item.logDate === proposal.logDate);
    if (
      sourcePhotos.some(
        (item) =>
          !item ||
          item.projectId !== projectId ||
          Boolean(item.voidedAt) ||
          localDateOf(item.capturedAt) !== proposal.logDate,
      ) ||
      sourceWorkItems.some(
        (item) =>
          !item ||
          item.projectId !== projectId ||
          item.status !== 'done' ||
          !item.doneAt ||
          localDateOf(item.doneAt) !== proposal.logDate,
      )
    ) {
      return finishProposal(projectId, proposal, 'stale', 'A source record changed or is no longer available.');
    }
    const currentSourceFingerprint = await dailyLogSourceFingerprint({
      logDate: proposal.logDate,
      sourceWorkItems: sourceWorkItems as PunchItem[],
      sourcePhotos: sourcePhotos as Photo[],
      dailyLog: currentLog,
    });
    if (!proposal.body.trim()) {
      return finishProposal(projectId, proposal, 'failed', 'Add daily record text, then try again.');
    }
    if (currentSourceFingerprint !== proposal.sourceFingerprint) {
      return finishProposal(projectId, proposal, 'stale', 'A source record changed. Check this update again.');
    }
    const created = await repository.createDailyLogIfAbsent(projectId, proposal.logDate, proposal.body);
    if (!created) {
      return finishProposal(projectId, proposal, 'stale', 'A daily log now exists for this date.');
    }
    return finishProposal(projectId, proposal, 'applied', 'Daily log added.');
  };

  const applySelectedProposals = async (projectId: string): Promise<ApplyProposalResult[]> => {
    const pending = sessions
      .getProject(projectId)
      .proposals.filter((item) => item.status === 'pending' && item.selected);
    const results: ApplyProposalResult[] = [];
    for (const proposal of pending) {
      try {
        results.push(
          proposal.kind === 'photo-link'
            ? await applyPhotoLink(projectId, proposal)
            : await applyDailyLog(projectId, proposal),
        );
      } catch {
        results.push(finishProposal(projectId, proposal, 'failed', 'FieldProof could not save this update.'));
      }
    }
    if (results.some((item) => item.status === 'applied')) {
      sessions.setPhase(projectId, 'check-again');
    }
    return results;
  };

  return {
    verifyProjectSeals,
    auditProjectCloseout,
    runCloseoutCheck,
    cancelProjectReview,
    stagePhotoLink,
    stageDailyLog,
    setProposalSelected,
    updateDailyLogDraft,
    replacePhotoCandidate,
    rejectProposal,
    dismissProposal,
    applySelectedProposals,
  };
}

export type CloseoutService = ReturnType<typeof createCloseoutService>;
