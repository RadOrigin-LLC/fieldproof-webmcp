/** Report assembly for daily work reports and the chronological handoff packet. */
import type {
  CloseoutFinding,
  CloseoutPhase,
  SealResult,
  SealStatus,
} from './closeout.ts';
import { localDateOf } from './dates.ts';
import type { DailyLog, Photo, Project, PunchItem } from './types.ts';
import { workdayDateKeys } from './workdays.ts';

export { localDateOf } from './dates.ts';

export function activePhotos(photos: Photo[]): Photo[] {
  return photos.filter((p) => !p.voidedAt).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export interface DayReport {
  project: Project;
  date: string;
  photos: Photo[];
  log?: DailyLog;
  punchDone: PunchItem[];
  punchOpened: PunchItem[];
}

export function buildDayReport(
  project: Project,
  date: string,
  photos: Photo[],
  logs: DailyLog[],
  punch: PunchItem[],
): DayReport {
  return {
    project,
    date,
    photos: activePhotos(photos).filter((p) => localDateOf(p.capturedAt) === date),
    log: logs.find((l) => l.logDate === date),
    punchDone: punch.filter((i) => i.doneAt && localDateOf(i.doneAt) === date),
    punchOpened: punch.filter((i) => localDateOf(i.createdAt) === date && i.status === 'open'),
  };
}

export interface PacketWorkItem {
  item: PunchItem;
  validProofPhotos: Photo[];
  unusablePhotoIds: string[];
}

export interface PacketWorkday {
  dateKey: string;
  dailyRecord?: DailyLog;
  workItems: PacketWorkItem[];
  supportingPhotos: Photo[];
  findings: CloseoutFinding[];
}

export interface HandoffPacketReview {
  phase: CloseoutPhase;
  current: boolean;
  lastCompletedAt?: string;
  blockerCount: number;
  warningCount: number;
}

export interface HandoffPacket {
  project: Project;
  review: HandoffPacketReview;
  workdays: PacketWorkday[];
  projectFindings: CloseoutFinding[];
  appendix: Array<{ photo: Photo; checkStatus?: SealStatus }>;
}

export interface HandoffPacketReviewInput extends HandoffPacketReview {
  findings: readonly CloseoutFinding[];
  sealResults: readonly SealResult[];
}

export interface BuildHandoffPacketInput {
  project: Project;
  photos: readonly Photo[];
  dailyLogs: readonly DailyLog[];
  punchItems: readonly PunchItem[];
  review: HandoffPacketReviewInput;
}

function byCapture(photos: readonly Photo[]): Photo[] {
  return [...photos].sort(
    (a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id),
  );
}

function workItemDate(item: PunchItem): string {
  return localDateOf(item.doneAt ?? item.createdAt);
}

export function buildHandoffPacket(input: BuildHandoffPacketInput): HandoffPacket {
  const projectId = input.project.id;
  const photos = input.photos.filter((photo) => photo.projectId === projectId);
  const dailyLogs = input.dailyLogs.filter((dailyLog) => dailyLog.projectId === projectId);
  const punchItems = input.punchItems.filter((item) => item.projectId === projectId);
  const completedItems = punchItems.filter((item) => item.status === 'done');
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const checkStatusByPhotoId = new Map(
    input.review.sealResults.map((result) => [result.photoId, result.status]),
  );

  const isValidPhoto = (photo: Photo | undefined): photo is Photo =>
    Boolean(photo && !photo.voidedAt && checkStatusByPhotoId.get(photo.id) === 'pass');

  const proofPhotoIds = new Set<string>();
  for (const item of completedItems) {
    for (const photoId of item.photoIds) {
      if (isValidPhoto(photoById.get(photoId))) proofPhotoIds.add(photoId);
    }
  }

  const currentFindings = input.review.current ? [...input.review.findings] : [];
  const workdays = workdayDateKeys({ photos, punchItems, dailyLogs }).map((dateKey) => {
    const workItems = completedItems
      .filter((item) => workItemDate(item) === dateKey)
      .sort(
        (a, b) =>
          (a.doneAt ?? a.createdAt).localeCompare(b.doneAt ?? b.createdAt) ||
          a.id.localeCompare(b.id),
      )
      .map((item): PacketWorkItem => {
        const linkedPhotoIds = [...new Set(item.photoIds)];
        return {
          item,
          validProofPhotos: byCapture(
            linkedPhotoIds
              .map((photoId) => photoById.get(photoId))
              .filter((photo): photo is Photo => isValidPhoto(photo)),
          ),
          unusablePhotoIds: linkedPhotoIds.filter(
            (photoId) => !isValidPhoto(photoById.get(photoId)),
          ),
        };
      });

    return {
      dateKey,
      dailyRecord: dailyLogs.find((dailyLog) => dailyLog.logDate === dateKey),
      workItems,
      supportingPhotos: byCapture(
        photos.filter(
          (photo) =>
            localDateOf(photo.capturedAt) === dateKey &&
            isValidPhoto(photo) &&
            !proofPhotoIds.has(photo.id),
        ),
      ).slice(0, 3),
      findings: currentFindings.filter((finding) => finding.workdayDate === dateKey),
    };
  });

  return {
    project: input.project,
    review: {
      phase: input.review.phase,
      current: input.review.current,
      lastCompletedAt: input.review.lastCompletedAt,
      blockerCount: input.review.blockerCount,
      warningCount: input.review.warningCount,
    },
    workdays,
    projectFindings: currentFindings.filter((finding) => !finding.workdayDate),
    appendix: byCapture(photos).map((photo) => ({
      photo,
      checkStatus: checkStatusByPhotoId.get(photo.id),
    })),
  };
}

/** Days that have any activity, newest first — the project timeline spine. */
export function activityDates(photos: Photo[], logs: DailyLog[]): string[] {
  const days = new Set<string>();
  for (const p of photos) if (!p.voidedAt) days.add(localDateOf(p.capturedAt));
  for (const l of logs) days.add(l.logDate);
  return [...days].sort((a, b) => b.localeCompare(a));
}
