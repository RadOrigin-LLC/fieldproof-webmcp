import { sha256Hex } from './hash.ts';
import { localDateOf } from './dates.ts';
import type { DailyLog, Photo, Project, PunchItem } from './types.ts';
import { workdayDateKeys, workdaySourceFingerprints } from './workdays.ts';

export type SealStatus = 'pass' | 'fail' | 'unreadable' | 'excluded';

export type CloseoutPhase =
  | 'not-checked'
  | 'checking'
  | 'check-again'
  | 'needs-attention'
  | 'ready-with-warnings'
  | 'ready'
  | 'check-failed';

export type FindingSeverity = 'blocker' | 'warning';

export type FindingCode =
  | 'open-punch'
  | 'empty-project'
  | 'missing-punch-proof'
  | 'proof-photo-missing'
  | 'proof-photo-voided'
  | 'seal-check-required'
  | 'seal-failed'
  | 'photo-unreadable'
  | 'missing-daily-log'
  | 'missing-proof-caption'
  | 'proof-exception'
  | 'missing-location';

export type CloseoutFinding = {
  id: string;
  code: FindingCode;
  severity: FindingSeverity;
  entityType: 'project' | 'punch' | 'photo' | 'daily-log';
  entityId?: string;
  workdayDate?: string;
  message: string;
  suggestedAction: string;
};

export type SealResult = {
  photoId: string;
  status: SealStatus;
};

export type SealVerification = {
  projectId: string;
  checkedAt: string;
  photoFingerprint: string;
  results: SealResult[];
  summary: Record<SealStatus, number>;
};

export type PhotoCandidate = {
  photoId: string;
  capturedAt: string;
  caption?: string;
  sealStatus: 'pass';
};

export type DailyLogContext = {
  logDate: string;
  workItems: Array<{ id: string; text: string }>;
  photos: Array<{ id: string; caption?: string }>;
  omittedWorkItems: number;
  omittedPhotos: number;
};

export type CloseoutAudit = {
  projectId: string;
  checkedAt: string;
  sourceFingerprint: string;
  photoFingerprint: string;
  phase: Extract<CloseoutPhase, 'needs-attention' | 'ready-with-warnings' | 'ready'>;
  blockerCount: number;
  warningCount: number;
  findings: CloseoutFinding[];
  candidates: Record<string, PhotoCandidate[]>;
  dailyLogContexts: DailyLogContext[];
  counts: {
    workdays: number;
    photos: number;
    punchItems: number;
    dailyLogs: number;
  };
  workdayFingerprints: Record<string, string>;
};

export type ProposalStatus = 'pending' | 'rejected' | 'applied' | 'stale' | 'failed';

type ProposalBase = {
  id: string;
  projectId: string;
  createdAt: string;
  status: ProposalStatus;
  selected: boolean;
  dismissed: boolean;
  reason: string;
  resultMessage?: string;
};

export type PhotoLinkProposal = ProposalBase & {
  kind: 'photo-link';
  punchItemId: string;
  punchItemLabel: string;
  workdayDate: string;
  photoId: string;
  expectedPunchUpdatedAt: string;
  expectedPhotoIdentity: string;
  sourceFingerprint: string;
};

export type DailyLogProposal = ProposalBase & {
  kind: 'daily-log';
  logDate: string;
  body: string;
  sourcePhotoIds: string[];
  sourceWorkItemIds: string[];
  sourceFingerprint: string;
  expectedLogAbsent: true;
};

export type CloseoutProposal = PhotoLinkProposal | DailyLogProposal;

export type AgentActivity = {
  id: string;
  projectId: string;
  action: string;
  outcome: 'started' | 'success' | 'refused' | 'cancelled' | 'error';
  occurredAt: string;
  detail: string;
};

type CloseoutRecords = {
  project: Project;
  photos: Photo[];
  punchItems: PunchItem[];
  dailyLogs: DailyLog[];
};

type AuditCloseoutInput = CloseoutRecords & {
  verification: SealVerification | undefined;
  checkedAt: string;
};

async function fingerprint(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

export async function photoSourceFingerprint(photos: Photo[]): Promise<string> {
  return fingerprint(
    byId(photos).map((item) => ({
      id: item.id,
      sha256: item.sha256,
      size: item.size,
      voidedAt: item.voidedAt,
    })),
  );
}

export async function closeoutSourceFingerprint({
  project,
  photos,
  punchItems,
  dailyLogs,
}: CloseoutRecords): Promise<string> {
  return fingerprint({
    project: { id: project.id, updatedAt: project.updatedAt },
    photos: byId(photos).map((item) => ({
      id: item.id,
      capturedAt: item.capturedAt,
      sha256: item.sha256,
      size: item.size,
      lat: item.lat,
      lon: item.lon,
      accuracy: item.accuracy,
      caption: item.caption,
      voidedAt: item.voidedAt,
      voidReason: item.voidReason,
    })),
    punchItems: byId(punchItems).map((item) => ({
      id: item.id,
      text: item.text,
      status: item.status,
      photoIds: [...item.photoIds].sort(),
      doneAt: item.doneAt,
      proofException: item.proofException,
      updatedAt: item.updatedAt,
    })),
    dailyLogs: byId(dailyLogs).map((item) => ({
      id: item.id,
      logDate: item.logDate,
      updatedAt: item.updatedAt,
    })),
  });
}

export async function photoIdentityFingerprint(photo: Photo): Promise<string> {
  return fingerprint({
    id: photo.id,
    projectId: photo.projectId,
    capturedAt: photo.capturedAt,
    sha256: photo.sha256,
    size: photo.size,
    voidedAt: photo.voidedAt,
  });
}

export async function photoLinkSourceFingerprint(
  punchItem: PunchItem,
  photo: Photo,
): Promise<string> {
  return fingerprint({
    punchItem: {
      id: punchItem.id,
      projectId: punchItem.projectId,
      text: punchItem.text,
      status: punchItem.status,
      photoIds: [...punchItem.photoIds].sort(),
      doneAt: punchItem.doneAt,
      proofException: punchItem.proofException,
      updatedAt: punchItem.updatedAt,
    },
    photo: {
      id: photo.id,
      projectId: photo.projectId,
      capturedAt: photo.capturedAt,
      sha256: photo.sha256,
      size: photo.size,
      caption: photo.caption,
      voidedAt: photo.voidedAt,
    },
  });
}

export async function dailyLogSourceFingerprint(input: {
  logDate: string;
  sourceWorkItems: PunchItem[];
  sourcePhotos: Photo[];
  dailyLog?: DailyLog;
}): Promise<string> {
  return fingerprint({
    logDate: input.logDate,
    workItems: byId(input.sourceWorkItems).map((item) => ({
      id: item.id,
      projectId: item.projectId,
      text: item.text,
      status: item.status,
      doneAt: item.doneAt,
    })),
    photos: byId(input.sourcePhotos).map((item) => ({
      id: item.id,
      projectId: item.projectId,
      capturedAt: item.capturedAt,
      sha256: item.sha256,
      size: item.size,
      caption: item.caption,
      voidedAt: item.voidedAt,
    })),
    dailyLog: input.dailyLog
      ? {
          id: input.dailyLog.id,
          projectId: input.dailyLog.projectId,
          logDate: input.dailyLog.logDate,
          body: input.dailyLog.body,
          crew: input.dailyLog.crew,
          weather: input.dailyLog.weather,
          updatedAt: input.dailyLog.updatedAt,
        }
      : null,
  });
}

function addFinding(
  findings: Map<string, CloseoutFinding>,
  finding: Omit<CloseoutFinding, 'id'>,
): void {
  const id = `${finding.code}:${finding.entityId ?? finding.entityType}`;
  if (!findings.has(id)) findings.set(id, { ...finding, id });
}

function candidateDistance(item: Photo, doneAt: string | undefined): number {
  if (!doneAt) return Number.POSITIVE_INFINITY;
  const captured = Date.parse(item.capturedAt);
  const done = Date.parse(doneAt);
  if (!Number.isFinite(captured) || !Number.isFinite(done)) return Number.POSITIVE_INFINITY;
  return Math.abs(captured - done);
}

function sortCandidates(photos: Photo[], doneAt: string | undefined): PhotoCandidate[] {
  const workdayDate = doneAt ? localDateOf(doneAt) : '';
  return [...photos]
    .sort((a, b) => {
      const aSameDay = localDateOf(a.capturedAt) === workdayDate;
      const bSameDay = localDateOf(b.capturedAt) === workdayDate;
      if (aSameDay !== bSameDay) return aSameDay ? -1 : 1;
      const distance = candidateDistance(a, doneAt) - candidateDistance(b, doneAt);
      return distance || a.id.localeCompare(b.id);
    })
    .map((item) => ({
      photoId: item.id,
      capturedAt: item.capturedAt,
      caption: item.caption,
      sealStatus: 'pass',
    }));
}

function buildDailyLogContext(
  logDate: string,
  punchItems: PunchItem[],
  photos: Photo[],
  sealByPhoto: Map<string, SealStatus>,
): DailyLogContext {
  const datedWorkItems = punchItems
    .filter(
      (item) => item.status === 'done' && item.doneAt && localDateOf(item.doneAt) === logDate,
    )
    .sort(
      (a, b) =>
        (a.doneAt ?? '').localeCompare(b.doneAt ?? '') || a.id.localeCompare(b.id),
    );
  const contextWorkItems = datedWorkItems.slice(0, 3);
  const datedPhotos = photos
    .filter(
      (item) =>
        !item.voidedAt &&
        sealByPhoto.get(item.id) === 'pass' &&
        localDateOf(item.capturedAt) === logDate,
    )
    .sort(
      (a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id),
    );
  const chosenPhotos: Photo[] = [];
  for (const workItem of contextWorkItems) {
    const nearest = [...datedPhotos]
      .filter((photo) => !chosenPhotos.some((chosen) => chosen.id === photo.id))
      .sort(
        (a, b) =>
          candidateDistance(a, workItem.doneAt) - candidateDistance(b, workItem.doneAt) ||
          a.id.localeCompare(b.id),
      )[0];
    if (nearest) chosenPhotos.push(nearest);
  }
  for (const photo of datedPhotos) {
    if (chosenPhotos.length >= 3) break;
    if (!chosenPhotos.some((chosen) => chosen.id === photo.id)) chosenPhotos.push(photo);
  }

  return {
    logDate,
    workItems: contextWorkItems.map((item) => ({ id: item.id, text: item.text })),
    photos: chosenPhotos.map((item) => ({ id: item.id, caption: item.caption })),
    omittedWorkItems: Math.max(0, datedWorkItems.length - contextWorkItems.length),
    omittedPhotos: Math.max(0, datedPhotos.length - chosenPhotos.length),
  };
}

export async function auditCloseout(input: AuditCloseoutInput): Promise<CloseoutAudit> {
  const photos = input.photos.filter((item) => item.projectId === input.project.id);
  const punchItems = input.punchItems.filter((item) => item.projectId === input.project.id);
  const dailyLogs = input.dailyLogs.filter((item) => item.projectId === input.project.id);
  const records = { project: input.project, photos, punchItems, dailyLogs };
  const [photoFingerprint, sourceFingerprint, workdayFingerprints] = await Promise.all([
    photoSourceFingerprint(photos),
    closeoutSourceFingerprint(records),
    workdaySourceFingerprints(records),
  ]);
  const verificationCurrent =
    input.verification?.projectId === input.project.id &&
    input.verification.photoFingerprint === photoFingerprint;
  const sealByPhoto = verificationCurrent
    ? new Map(input.verification?.results.map((item) => [item.photoId, item.status]))
    : new Map<string, SealStatus>();
  const photoById = new Map(photos.map((item) => [item.id, item]));
  const findings = new Map<string, CloseoutFinding>();
  const candidates: Record<string, PhotoCandidate[]> = {};
  const dailyLogContexts: DailyLogContext[] = [];

  if (!verificationCurrent) {
    addFinding(findings, {
      code: 'seal-check-required',
      severity: 'blocker',
      entityType: 'project',
      entityId: input.project.id,
      message: 'The project photos need a fresh file check.',
      suggestedAction: 'Check the saved photos again.',
    });
  }

  for (const item of photos) {
    if (item.voidedAt) continue;
    const status = sealByPhoto.get(item.id);
    if (verificationCurrent && status === 'fail') {
      addFinding(findings, {
        code: 'seal-failed',
        severity: 'blocker',
        entityType: 'photo',
        entityId: item.id,
        workdayDate: localDateOf(item.capturedAt),
        message: 'This photo no longer matches the file saved at capture.',
        suggestedAction: 'Review the photo and leave it out of the handoff proof.',
      });
    } else if (verificationCurrent && status !== 'pass') {
      addFinding(findings, {
        code: 'photo-unreadable',
        severity: 'blocker',
        entityType: 'photo',
        entityId: item.id,
        workdayDate: localDateOf(item.capturedAt),
        message: 'FieldProof could not open this saved photo.',
        suggestedAction: 'Open the photo, then try the check again.',
      });
    }

    if (item.lat === undefined || item.lon === undefined) {
      addFinding(findings, {
        code: 'missing-location',
        severity: 'warning',
        entityType: 'photo',
        entityId: item.id,
        workdayDate: localDateOf(item.capturedAt),
        message: 'This photo has no saved location.',
        suggestedAction: 'Keep it if location was unavailable or turned off.',
      });
    }
  }

  if (punchItems.length === 0) {
    addFinding(findings, {
      code: 'empty-project',
      severity: 'blocker',
      entityType: 'project',
      entityId: input.project.id,
      message: 'The punch list is empty.',
      suggestedAction: 'Add at least one work item before handoff.',
    });
  }

  const safePhotos = photos.filter(
    (item) => !item.voidedAt && sealByPhoto.get(item.id) === 'pass',
  );

  for (const item of punchItems) {
    if (item.status === 'open') {
      addFinding(findings, {
        code: 'open-punch',
        severity: 'blocker',
        entityType: 'punch',
        entityId: item.id,
        workdayDate: localDateOf(item.createdAt),
        message: `Still open: ${item.text}`,
        suggestedAction: 'Finish it or update its status before handoff.',
      });
      continue;
    }

    let hasValidProof = false;
    for (const photoId of item.photoIds) {
      const linked = photoById.get(photoId);
      if (!linked) {
        addFinding(findings, {
          code: 'proof-photo-missing',
          severity: 'blocker',
          entityType: 'punch',
          entityId: item.id,
          workdayDate: localDateOf(item.doneAt ?? item.createdAt),
          message: `This completed item points to a photo that is no longer here: ${item.text}`,
          suggestedAction: 'Remove the old link, then choose another photo.',
        });
        continue;
      }
      if (linked.voidedAt) {
        addFinding(findings, {
          code: 'proof-photo-voided',
          severity: 'blocker',
          entityType: 'punch',
          entityId: item.id,
          workdayDate: localDateOf(item.doneAt ?? item.createdAt),
          message: `This completed item uses a voided photo: ${item.text}`,
          suggestedAction: 'Remove the link, then choose an active photo.',
        });
        continue;
      }
      if (sealByPhoto.get(linked.id) === 'pass') hasValidProof = true;
      if (!linked.caption?.trim()) {
        addFinding(findings, {
          code: 'missing-proof-caption',
          severity: 'warning',
          entityType: 'photo',
          entityId: linked.id,
          workdayDate: localDateOf(linked.capturedAt),
          message: 'This proof photo needs a caption.',
          suggestedAction: 'Add a short note about the work shown.',
        });
      }
    }

    if (item.proofException) {
      addFinding(findings, {
        code: 'proof-exception',
        severity: 'warning',
        entityType: 'punch',
        entityId: item.id,
        workdayDate: localDateOf(item.doneAt ?? item.createdAt),
        message: `No photo was required for: ${item.text}`,
        suggestedAction: 'Keep the contractor’s reason in the handoff packet.',
      });
    }

    if (!hasValidProof && !item.proofException) {
      addFinding(findings, {
        code: 'missing-punch-proof',
        severity: 'blocker',
        entityType: 'punch',
        entityId: item.id,
        workdayDate: localDateOf(item.doneAt ?? item.createdAt),
        message: `No proof photo is linked to: ${item.text}`,
        suggestedAction: 'Choose a matching photo or record why no photo is needed.',
      });
      candidates[item.id] = sortCandidates(
        safePhotos.filter((photo) => !item.photoIds.includes(photo.id)),
        item.doneAt,
      );
    }
  }

  const logDates = new Set(dailyLogs.map((item) => item.logDate));
  const activeDates = new Set<string>();
  for (const item of photos) {
    if (!item.voidedAt) activeDates.add(localDateOf(item.capturedAt));
  }
  for (const item of punchItems) {
    if (item.status === 'done' && item.doneAt) activeDates.add(localDateOf(item.doneAt));
  }
  activeDates.delete('');
  for (const date of [...activeDates].sort((a, b) => a.localeCompare(b))) {
    if (logDates.has(date)) continue;
    addFinding(findings, {
      code: 'missing-daily-log',
      severity: 'warning',
      entityType: 'daily-log',
      entityId: date,
      workdayDate: date,
      message: `Work was recorded on ${date}, but the daily record is blank.`,
      suggestedAction: 'Add a short log for that day.',
    });
    dailyLogContexts.push(buildDailyLogContext(date, punchItems, photos, sealByPhoto));
  }

  const orderedFindings = [...findings.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'blocker' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  const blockerCount = orderedFindings.filter((item) => item.severity === 'blocker').length;
  const warningCount = orderedFindings.length - blockerCount;
  const phase =
    blockerCount > 0
      ? 'needs-attention'
      : warningCount > 0
        ? 'ready-with-warnings'
        : 'ready';

  return {
    projectId: input.project.id,
    checkedAt: input.checkedAt,
    sourceFingerprint,
    photoFingerprint,
    phase,
    blockerCount,
    warningCount,
    findings: orderedFindings,
    candidates,
    dailyLogContexts,
    counts: {
      workdays: workdayDateKeys(records).length,
      photos: photos.length,
      punchItems: punchItems.length,
      dailyLogs: dailyLogs.length,
    },
    workdayFingerprints,
  };
}

export function effectiveCloseoutPhase(
  audit: CloseoutAudit,
  currentSourceFingerprint: string,
): CloseoutPhase {
  return audit.sourceFingerprint === currentSourceFingerprint ? audit.phase : 'check-again';
}
