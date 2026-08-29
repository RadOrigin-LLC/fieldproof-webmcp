import type {
  CloseoutAudit,
  CloseoutFinding,
  CloseoutPhase,
  CloseoutProposal,
} from './closeout.ts';
import { localDateOf } from './dates.ts';
import { sha256Hex } from './hash.ts';
import type { DailyLog, Photo, PunchItem } from './types.ts';

export type WorkdayStatus =
  | 'not-checked'
  | 'checking'
  | 'complete'
  | 'needs-attention'
  | 'worth-a-look'
  | 'check-again';

export type WorkdayFilter = 'all' | 'needs-attention';

export type WorkdayViewModel = {
  dateKey: string;
  photos: Photo[];
  completedItems: PunchItem[];
  openItems: PunchItem[];
  dailyRecord?: DailyLog;
  findings: CloseoutFinding[];
  suggestedUpdates: CloseoutProposal[];
  representativePhotoIds: string[];
  requiredCount: number;
  noteCount: number;
  status: WorkdayStatus;
};

export type WorkdayRecords = {
  photos: readonly Photo[];
  punchItems: readonly PunchItem[];
  dailyLogs: readonly DailyLog[];
};

type BuildWorkdaysInput = WorkdayRecords & {
  phase: CloseoutPhase;
  audit?: Pick<CloseoutAudit, 'findings' | 'workdayFingerprints'>;
  proposals?: readonly CloseoutProposal[];
  currentFingerprints: Readonly<Record<string, string>>;
};

function workItemDate(item: PunchItem): string {
  return localDateOf(item.status === 'done' && item.doneAt ? item.doneAt : item.createdAt);
}

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function byCapture(rows: readonly Photo[]): Photo[] {
  return [...rows].sort(
    (a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id),
  );
}

export function workdayDateKeys(records: WorkdayRecords): string[] {
  const dates = new Set<string>();
  for (const photo of records.photos) dates.add(localDateOf(photo.capturedAt));
  for (const item of records.punchItems) dates.add(workItemDate(item));
  for (const log of records.dailyLogs) dates.add(log.logDate);
  dates.delete('');
  return [...dates].sort((a, b) => a.localeCompare(b));
}

async function fingerprint(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
}

export async function workdaySourceFingerprints(
  records: WorkdayRecords,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const dateKey of workdayDateKeys(records)) {
    const photos = byId(records.photos.filter((photo) => localDateOf(photo.capturedAt) === dateKey));
    const punchItems = byId(records.punchItems.filter((item) => workItemDate(item) === dateKey));
    const dailyLogs = byId(records.dailyLogs.filter((log) => log.logDate === dateKey));
    result[dateKey] = await fingerprint({
      photos: photos.map((photo) => ({
        id: photo.id,
        capturedAt: photo.capturedAt,
        sha256: photo.sha256,
        size: photo.size,
        caption: photo.caption,
        tags: photo.tags ? [...photo.tags].sort() : undefined,
        hasLocation: photo.lat !== undefined && photo.lon !== undefined,
        voidedAt: photo.voidedAt,
        voidReason: photo.voidReason,
      })),
      punchItems: punchItems.map((item) => ({
        id: item.id,
        text: item.text,
        status: item.status,
        createdAt: item.createdAt,
        doneAt: item.doneAt,
        photoIds: [...item.photoIds].sort(),
        proofException: item.proofException,
        updatedAt: item.updatedAt,
      })),
      dailyLogs: dailyLogs.map((log) => ({
        id: log.id,
        logDate: log.logDate,
        body: log.body,
        crew: log.crew,
        weather: log.weather,
        updatedAt: log.updatedAt,
      })),
    });
  }
  return result;
}

function proposalDate(proposal: CloseoutProposal, workItems: readonly PunchItem[]): string {
  if (proposal.kind === 'daily-log') return proposal.logDate;
  const target = workItems.find((item) => item.id === proposal.punchItemId);
  return target ? workItemDate(target) : '';
}

function dayStatus(
  phase: CloseoutPhase,
  hasAudit: boolean,
  changed: boolean,
  requiredCount: number,
  noteCount: number,
): WorkdayStatus {
  if (phase === 'checking') return 'checking';
  if (changed) return 'check-again';
  if (requiredCount > 0) return 'needs-attention';
  if (noteCount > 0) return 'worth-a-look';
  if (hasAudit) return 'complete';
  return 'not-checked';
}

export function buildWorkdays(input: BuildWorkdaysInput): WorkdayViewModel[] {
  const activePhotoById = new Map(
    input.photos.filter((photo) => !photo.voidedAt).map((photo) => [photo.id, photo]),
  );
  const proposals = [...(input.proposals ?? [])].filter((proposal) => !proposal.dismissed).sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      Number(b.kind === 'photo-link') - Number(a.kind === 'photo-link') ||
      a.id.localeCompare(b.id),
  );

  return workdayDateKeys(input).map((dateKey) => {
    const photos = byCapture(
      input.photos.filter((photo) => localDateOf(photo.capturedAt) === dateKey),
    );
    const completedItems = [...input.punchItems]
      .filter((item) => item.status === 'done' && workItemDate(item) === dateKey)
      .sort(
        (a, b) =>
          (a.doneAt ?? '').localeCompare(b.doneAt ?? '') || a.id.localeCompare(b.id),
      );
    const openItems = [...input.punchItems]
      .filter((item) => item.status === 'open' && workItemDate(item) === dateKey)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const linkedProof = byCapture(
      completedItems.flatMap((item) =>
        item.photoIds.flatMap((photoId) => {
          const photo = activePhotoById.get(photoId);
          return photo ? [photo] : [];
        }),
      ),
    );
    const otherPhotos = photos.filter((photo) => !photo.voidedAt);
    const representativePhotoIds = [
      ...new Set([...linkedProof, ...otherPhotos].map((photo) => photo.id)),
    ].slice(0, 3);
    const savedFingerprint = input.audit?.workdayFingerprints?.[dateKey];
    const currentFingerprint = input.currentFingerprints[dateKey];
    const changed = Boolean(
      input.audit &&
        (!savedFingerprint || !currentFingerprint || savedFingerprint !== currentFingerprint),
    );
    const findings = changed
      ? []
      : (input.audit?.findings.filter((finding) => finding.workdayDate === dateKey) ?? []);
    const requiredCount = findings.filter((finding) => finding.severity === 'blocker').length;
    const noteCount = findings.length - requiredCount;

    return {
      dateKey,
      photos,
      completedItems,
      openItems,
      dailyRecord: input.dailyLogs.find((log) => log.logDate === dateKey),
      findings,
      suggestedUpdates: proposals.filter(
        (proposal) => proposalDate(proposal, input.punchItems) === dateKey,
      ),
      representativePhotoIds,
      requiredCount,
      noteCount,
      status: dayStatus(
        input.phase,
        Boolean(input.audit),
        changed,
        requiredCount,
        noteCount,
      ),
    };
  });
}

export function filterWorkdays(
  workdays: readonly WorkdayViewModel[],
  filter: WorkdayFilter,
): WorkdayViewModel[] {
  if (filter === 'all') return [...workdays];
  return workdays.filter((workday) =>
    ['needs-attention', 'worth-a-look', 'check-again'].includes(workday.status),
  );
}
