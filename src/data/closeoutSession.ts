import { useSyncExternalStore } from 'react';
import type {
  AgentActivity,
  CloseoutAudit,
  CloseoutFinding,
  CloseoutPhase,
  CloseoutProposal,
  PhotoCandidate,
  SealStatus,
  SealVerification,
} from '../domain/closeout.ts';

export const CLOSEOUT_SESSION_KEY = 'fieldproof.closeout.v1';

const PROPOSAL_LIMIT = 20;
const ACTIVITY_LIMIT = 30;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ReviewStepState = 'pending' | 'active' | 'complete';

export type ReviewProgress = {
  runId: string;
  state: 'running' | 'awaiting-audit' | 'complete' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  photoCheck: ReviewStepState;
  workItems: ReviewStepState;
  dailyRecords: ReviewStepState;
};

export type ProjectCloseoutSession = {
  phase: CloseoutPhase;
  verification?: SealVerification;
  audit?: CloseoutAudit;
  reviewProgress?: ReviewProgress;
  proposals: CloseoutProposal[];
  activity: AgentActivity[];
};

type CloseoutSessionState = {
  version: 1;
  projects: Record<string, ProjectCloseoutSession>;
};

export type CloseoutSessionStore = {
  getProject: (projectId: string) => ProjectCloseoutSession;
  subscribe: (listener: () => void) => () => void;
  setPhase: (projectId: string, phase: CloseoutPhase) => void;
  setVerification: (projectId: string, verification: SealVerification) => void;
  setAudit: (projectId: string, audit: CloseoutAudit) => void;
  setReviewProgress: (projectId: string, progress: ReviewProgress) => void;
  addProposal: (projectId: string, proposal: CloseoutProposal) => void;
  updateProposal: (
    projectId: string,
    proposalId: string,
    update: (proposal: CloseoutProposal) => CloseoutProposal,
  ) => void;
  addActivity: (projectId: string, activity: AgentActivity) => void;
  clearProject: (projectId: string) => void;
};

const EMPTY_PROJECT_SESSION: ProjectCloseoutSession = {
  phase: 'not-checked',
  proposals: [],
  activity: [],
};

const PHASES = new Set<CloseoutPhase>([
  'not-checked',
  'checking',
  'check-again',
  'needs-attention',
  'ready-with-warnings',
  'ready',
  'check-failed',
]);
const PROPOSAL_STATUSES = new Set(['pending', 'rejected', 'applied', 'stale', 'failed']);
const ACTIVITY_OUTCOMES = new Set(['started', 'success', 'refused', 'cancelled', 'error']);
const SEAL_STATUSES = new Set<SealStatus>(['pass', 'fail', 'unreadable', 'excluded']);
const REVIEW_STATES = new Set<ReviewProgress['state']>([
  'running',
  'awaiting-audit',
  'complete',
  'failed',
  'cancelled',
]);
const REVIEW_STEP_STATES = new Set<ReviewStepState>(['pending', 'active', 'complete']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseProposal(value: unknown): CloseoutProposal | undefined {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.projectId) ||
    !isString(value.createdAt) ||
    !isString(value.status) ||
    (!PROPOSAL_STATUSES.has(value.status) && value.status !== 'dismissed') ||
    !isString(value.reason)
  ) {
    return undefined;
  }
  if (
    value.kind === 'photo-link' &&
    isString(value.punchItemId) &&
    isString(value.photoId) &&
    isString(value.expectedPunchUpdatedAt)
  ) {
    const sourceFingerprint = isString(value.sourceFingerprint) ? value.sourceFingerprint : '';
    const expectedPhotoIdentity = isString(value.expectedPhotoIdentity)
      ? value.expectedPhotoIdentity
      : '';
    const punchItemLabel = isString(value.punchItemLabel) ? value.punchItemLabel : value.punchItemId;
    const workdayDate = isString(value.workdayDate) ? value.workdayDate : '';
    const hasCurrentSource = Boolean(
      sourceFingerprint && expectedPhotoIdentity && punchItemLabel && workdayDate,
    );
    const rawStatus = value.status === 'dismissed' ? 'rejected' : value.status;
    const status = rawStatus === 'pending' && !hasCurrentSource ? 'stale' : rawStatus;
    return {
      kind: 'photo-link',
      id: value.id,
      projectId: value.projectId,
      createdAt: value.createdAt,
      status: status as CloseoutProposal['status'],
      selected: status === 'pending' && value.selected === true,
      dismissed: value.dismissed === true && ['rejected', 'stale', 'failed'].includes(status),
      reason: value.reason,
      ...(isString(value.resultMessage)
        ? { resultMessage: value.resultMessage }
        : rawStatus === 'pending' && !hasCurrentSource
          ? { resultMessage: 'The saved source details are old. Check this update again.' }
          : {}),
      punchItemId: value.punchItemId,
      punchItemLabel,
      workdayDate,
      photoId: value.photoId,
      expectedPunchUpdatedAt: value.expectedPunchUpdatedAt,
      expectedPhotoIdentity,
      sourceFingerprint,
    };
  }
  if (
    value.kind === 'daily-log' &&
    isString(value.logDate) &&
    isString(value.body) &&
    Array.isArray(value.sourcePhotoIds) &&
    value.sourcePhotoIds.every(isString) &&
    value.expectedLogAbsent === true
  ) {
    const sourceFingerprint = isString(value.sourceFingerprint) ? value.sourceFingerprint : '';
    const rawStatus = value.status === 'dismissed' ? 'rejected' : value.status;
    const status = rawStatus === 'pending' && !sourceFingerprint ? 'stale' : rawStatus;
    return {
      kind: 'daily-log',
      id: value.id,
      projectId: value.projectId,
      createdAt: value.createdAt,
      status: status as CloseoutProposal['status'],
      selected: status === 'pending' && value.selected === true,
      dismissed: value.dismissed === true && ['rejected', 'stale', 'failed'].includes(status),
      reason: value.reason,
      ...(isString(value.resultMessage)
        ? { resultMessage: value.resultMessage }
        : rawStatus === 'pending' && !sourceFingerprint
          ? { resultMessage: 'The saved source details are old. Check this update again.' }
          : {}),
      logDate: value.logDate,
      body: value.body,
      sourcePhotoIds: value.sourcePhotoIds,
      sourceWorkItemIds:
        Array.isArray(value.sourceWorkItemIds) && value.sourceWorkItemIds.every(isString)
          ? value.sourceWorkItemIds
          : [],
      sourceFingerprint,
      expectedLogAbsent: true,
    };
  }
  return undefined;
}

function parseActivity(value: unknown): AgentActivity | undefined {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.projectId) ||
    !isString(value.action) ||
    !isString(value.outcome) ||
    !ACTIVITY_OUTCOMES.has(value.outcome) ||
    !isString(value.occurredAt) ||
    !isString(value.detail)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    projectId: value.projectId,
    action: value.action,
    outcome: value.outcome as AgentActivity['outcome'],
    occurredAt: value.occurredAt,
    detail: value.detail,
  };
}

function parseVerification(value: unknown): SealVerification | undefined {
  if (
    !isRecord(value) ||
    !isString(value.projectId) ||
    !isString(value.checkedAt) ||
    !isString(value.photoFingerprint) ||
    !Array.isArray(value.results)
  ) {
    return undefined;
  }
  const results = value.results.flatMap((item) => {
    if (!isRecord(item) || !isString(item.photoId) || !isString(item.status)) return [];
    if (!SEAL_STATUSES.has(item.status as SealStatus)) return [];
    return [{ photoId: item.photoId, status: item.status as SealStatus }];
  });
  const summary: Record<SealStatus, number> = { pass: 0, fail: 0, unreadable: 0, excluded: 0 };
  for (const item of results) summary[item.status]++;
  return {
    projectId: value.projectId,
    checkedAt: value.checkedAt,
    photoFingerprint: value.photoFingerprint,
    results,
    summary,
  };
}

function parseFinding(value: unknown): CloseoutFinding | undefined {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.code) ||
    (value.severity !== 'blocker' && value.severity !== 'warning') ||
    !isString(value.entityType) ||
    !isString(value.message) ||
    !isString(value.suggestedAction)
  ) {
    return undefined;
  }
  if (!['project', 'punch', 'photo', 'daily-log'].includes(value.entityType)) return undefined;
  return {
    id: value.id,
    code: value.code as CloseoutFinding['code'],
    severity: value.severity,
    entityType: value.entityType as CloseoutFinding['entityType'],
    entityId: isString(value.entityId) ? value.entityId : undefined,
    workdayDate: isString(value.workdayDate) ? value.workdayDate : undefined,
    message: value.message,
    suggestedAction: value.suggestedAction,
  };
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => isString(entry[1])),
  );
}

function parseReviewProgress(value: unknown): ReviewProgress | undefined {
  if (
    !isRecord(value) ||
    !isString(value.runId) ||
    !isString(value.state) ||
    !REVIEW_STATES.has(value.state as ReviewProgress['state']) ||
    !isString(value.startedAt) ||
    !isString(value.photoCheck) ||
    !REVIEW_STEP_STATES.has(value.photoCheck as ReviewStepState) ||
    !isString(value.workItems) ||
    !REVIEW_STEP_STATES.has(value.workItems as ReviewStepState) ||
    !isString(value.dailyRecords) ||
    !REVIEW_STEP_STATES.has(value.dailyRecords as ReviewStepState)
  ) {
    return undefined;
  }

  return {
    runId: value.runId,
    state: value.state === 'running' ? 'cancelled' : (value.state as ReviewProgress['state']),
    startedAt: value.startedAt,
    ...(isString(value.finishedAt) ? { finishedAt: value.finishedAt } : {}),
    photoCheck: value.photoCheck as ReviewStepState,
    workItems: value.workItems as ReviewStepState,
    dailyRecords: value.dailyRecords as ReviewStepState,
  };
}

function parseCandidates(value: unknown): Record<string, PhotoCandidate[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([punchId, rows]) => [
      punchId,
      Array.isArray(rows)
        ? rows.flatMap((row) => {
            if (!isRecord(row) || !isString(row.photoId) || !isString(row.capturedAt)) return [];
            return [
              {
                photoId: row.photoId,
                capturedAt: row.capturedAt,
                caption: isString(row.caption) ? row.caption : undefined,
                sealStatus: 'pass' as const,
              },
            ];
          })
        : [],
    ]),
  );
}

function parseDailyLogContexts(value: unknown): CloseoutAudit['dailyLogContexts'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((context) => {
    if (
      !isRecord(context) ||
      !isString(context.logDate) ||
      !Array.isArray(context.workItems) ||
      !Array.isArray(context.photos)
    ) {
      return [];
    }
    const workItems = context.workItems.flatMap((item) =>
      isRecord(item) && isString(item.id) && isString(item.text)
        ? [{ id: item.id, text: item.text }]
        : [],
    );
    const photos = context.photos.flatMap((item) =>
      isRecord(item) && isString(item.id)
        ? [{ id: item.id, ...(isString(item.caption) ? { caption: item.caption } : {}) }]
        : [],
    );
    return [{
      logDate: context.logDate,
      workItems: workItems.slice(0, 3),
      photos: photos.slice(0, 3),
      omittedWorkItems: isFiniteNumber(context.omittedWorkItems)
        ? Math.max(0, context.omittedWorkItems) + Math.max(0, workItems.length - 3)
        : Math.max(0, workItems.length - 3),
      omittedPhotos: isFiniteNumber(context.omittedPhotos)
        ? Math.max(0, context.omittedPhotos) + Math.max(0, photos.length - 3)
        : Math.max(0, photos.length - 3),
    }];
  });
}

function parseAudit(value: unknown): CloseoutAudit | undefined {
  if (
    !isRecord(value) ||
    !isString(value.projectId) ||
    !isString(value.checkedAt) ||
    !isString(value.sourceFingerprint) ||
    !isString(value.photoFingerprint) ||
    !['needs-attention', 'ready-with-warnings', 'ready'].includes(String(value.phase)) ||
    !isFiniteNumber(value.blockerCount) ||
    !isFiniteNumber(value.warningCount) ||
    !Array.isArray(value.findings) ||
    !isRecord(value.counts)
  ) {
    return undefined;
  }
  if (
    !isFiniteNumber(value.counts.photos) ||
    !isFiniteNumber(value.counts.punchItems) ||
    !isFiniteNumber(value.counts.dailyLogs)
  ) {
    return undefined;
  }
  return {
    projectId: value.projectId,
    checkedAt: value.checkedAt,
    sourceFingerprint: value.sourceFingerprint,
    photoFingerprint: value.photoFingerprint,
    phase: value.phase as CloseoutAudit['phase'],
    blockerCount: value.blockerCount,
    warningCount: value.warningCount,
    findings: value.findings.flatMap((item) => {
      const finding = parseFinding(item);
      return finding ? [finding] : [];
    }),
    candidates: parseCandidates(value.candidates),
    dailyLogContexts: parseDailyLogContexts(value.dailyLogContexts),
    counts: {
      workdays: isFiniteNumber(value.counts.workdays) ? value.counts.workdays : 0,
      photos: value.counts.photos,
      punchItems: value.counts.punchItems,
      dailyLogs: value.counts.dailyLogs,
    },
    workdayFingerprints: parseStringRecord(value.workdayFingerprints),
  };
}

function parseProjectSession(value: unknown): ProjectCloseoutSession | undefined {
  if (!isRecord(value)) return undefined;
  const phase = isString(value.phase) && PHASES.has(value.phase as CloseoutPhase)
    ? (value.phase as CloseoutPhase)
    : 'not-checked';
  const verification = parseVerification(value.verification);
  const audit = parseAudit(value.audit);
  const reviewProgress = parseReviewProgress(value.reviewProgress);
  const interrupted = reviewProgress?.state === 'cancelled' && value.reviewProgress &&
    isRecord(value.reviewProgress) && value.reviewProgress.state === 'running';
  return {
    phase: interrupted ? 'check-failed' : phase,
    ...(verification ? { verification } : {}),
    ...(audit ? { audit } : {}),
    ...(reviewProgress ? { reviewProgress } : {}),
    proposals: Array.isArray(value.proposals)
      ? value.proposals.flatMap((item) => {
          const proposal = parseProposal(item);
          return proposal ? [proposal] : [];
        }).slice(-PROPOSAL_LIMIT)
      : [],
    activity: Array.isArray(value.activity)
      ? value.activity.flatMap((item) => {
          const row = parseActivity(item);
          return row ? [row] : [];
        }).slice(-ACTIVITY_LIMIT)
      : [],
  };
}

function readState(storage: StorageLike): CloseoutSessionState {
  const empty = (): CloseoutSessionState => ({ version: 1, projects: {} });
  const raw = storage.getItem(CLOSEOUT_SESSION_KEY);
  if (!raw) return empty();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.projects)) {
      storage.removeItem(CLOSEOUT_SESSION_KEY);
      return empty();
    }
    const projects: Record<string, ProjectCloseoutSession> = {};
    for (const [projectId, value] of Object.entries(parsed.projects)) {
      const session = parseProjectSession(value);
      if (session) projects[projectId] = session;
    }
    return { version: 1, projects };
  } catch {
    storage.removeItem(CLOSEOUT_SESSION_KEY);
    return empty();
  }
}

export function createCloseoutSessionStore(storage: StorageLike): CloseoutSessionStore {
  let state = readState(storage);
  if (storage.getItem(CLOSEOUT_SESSION_KEY) !== null) {
    storage.setItem(CLOSEOUT_SESSION_KEY, JSON.stringify(state));
  }
  const listeners = new Set<() => void>();

  const saveProject = (
    projectId: string,
    update: (current: ProjectCloseoutSession) => ProjectCloseoutSession,
  ) => {
    state = {
      version: 1,
      projects: {
        ...state.projects,
        [projectId]: update(state.projects[projectId] ?? EMPTY_PROJECT_SESSION),
      },
    };
    storage.setItem(CLOSEOUT_SESSION_KEY, JSON.stringify(state));
    for (const listener of listeners) listener();
  };

  return {
    getProject: (projectId) => state.projects[projectId] ?? EMPTY_PROJECT_SESSION,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPhase: (projectId, phase) => {
      saveProject(projectId, (current) => ({ ...current, phase }));
    },
    setVerification: (projectId, verification) => {
      if (verification.projectId !== projectId) throw new Error('Verification belongs to another project');
      saveProject(projectId, (current) => ({ ...current, verification }));
    },
    setAudit: (projectId, audit) => {
      if (audit.projectId !== projectId) throw new Error('Audit belongs to another project');
      saveProject(projectId, (current) => ({ ...current, phase: audit.phase, audit }));
    },
    setReviewProgress: (projectId, reviewProgress) => {
      saveProject(projectId, (current) => ({ ...current, reviewProgress }));
    },
    addProposal: (projectId, proposal) => {
      if (proposal.projectId !== projectId) throw new Error('Proposal belongs to another project');
      saveProject(projectId, (current) => ({
        ...current,
        proposals: [...current.proposals.filter((item) => item.id !== proposal.id), proposal].slice(
          -PROPOSAL_LIMIT,
        ),
      }));
    },
    updateProposal: (projectId, proposalId, update) => {
      saveProject(projectId, (current) => ({
        ...current,
        proposals: current.proposals.map((proposal) =>
          proposal.id === proposalId ? update(proposal) : proposal,
        ),
      }));
    },
    addActivity: (projectId, activity) => {
      if (activity.projectId !== projectId) throw new Error('Activity belongs to another project');
      saveProject(projectId, (current) => ({
        ...current,
        activity: [...current.activity.filter((item) => item.id !== activity.id), activity].slice(
          -ACTIVITY_LIMIT,
        ),
      }));
    },
    clearProject: (projectId) => {
      if (!state.projects[projectId]) return;
      const projects = { ...state.projects };
      delete projects[projectId];
      state = { version: 1, projects };
      storage.setItem(CLOSEOUT_SESSION_KEY, JSON.stringify(state));
      for (const listener of listeners) listener();
    },
  };
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

let defaultStore: CloseoutSessionStore | undefined;

export function getCloseoutSessionStore(): CloseoutSessionStore {
  if (defaultStore) return defaultStore;
  let storage: StorageLike = new MemoryStorage();
  if (typeof window !== 'undefined') {
    try {
      storage = window.sessionStorage;
    } catch {
      // Keep the in-memory fallback when browser storage is unavailable.
    }
  }
  defaultStore = createCloseoutSessionStore(storage);
  return defaultStore;
}

export function useProjectCloseoutSession(
  projectId: string,
  store: CloseoutSessionStore = getCloseoutSessionStore(),
): ProjectCloseoutSession {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getProject(projectId),
    () => store.getProject(projectId),
  );
}
