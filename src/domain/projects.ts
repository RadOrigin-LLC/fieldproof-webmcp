import { closeoutSourceFingerprint, type CloseoutPhase } from './closeout.ts';
import type { DailyLog, Photo, Project, PunchItem } from './types.ts';
import { workdayDateKeys } from './workdays.ts';

export type ProjectReviewSummary = {
  phase: CloseoutPhase;
  sourceFingerprint?: string;
};

export type ProjectSummary = {
  project: Project;
  latestActivity: string;
  latestWorkday?: string;
  activePhotoCount: number;
  completedItemCount: number;
  totalItemCount: number;
  handoffPhase: CloseoutPhase;
};

export type ProjectSummaryInput = {
  projects: readonly Project[];
  photos: readonly Photo[];
  punchItems: readonly PunchItem[];
  dailyLogs: readonly DailyLog[];
  reviewByProject?: Readonly<Record<string, ProjectReviewSummary>>;
};

function latest(values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? '';
}

export async function buildProjectSummaries({
  projects,
  photos,
  punchItems,
  dailyLogs,
  reviewByProject = {},
}: ProjectSummaryInput): Promise<ProjectSummary[]> {
  const summaries = await Promise.all(
    projects.map(async (project): Promise<ProjectSummary> => {
      const projectPhotos = photos.filter((photo) => photo.projectId === project.id);
      const projectItems = punchItems.filter((item) => item.projectId === project.id);
      const projectLogs = dailyLogs.filter((log) => log.projectId === project.id);
      const workdays = workdayDateKeys({
        photos: projectPhotos,
        punchItems: projectItems,
        dailyLogs: projectLogs,
      });
      const review = reviewByProject[project.id];
      let handoffPhase = review?.phase ?? 'not-checked';

      if (
        review?.sourceFingerprint &&
        ['needs-attention', 'ready-with-warnings', 'ready'].includes(review.phase)
      ) {
        const currentFingerprint = await closeoutSourceFingerprint({
          project,
          photos: projectPhotos,
          punchItems: projectItems,
          dailyLogs: projectLogs,
        });
        if (currentFingerprint !== review.sourceFingerprint) handoffPhase = 'check-again';
      }

      return {
        project,
        latestActivity: latest([
          project.updatedAt,
          ...projectPhotos.map((photo) => photo.capturedAt),
          ...projectItems.map((item) => item.updatedAt),
          ...projectLogs.map((log) => log.updatedAt),
        ]),
        latestWorkday: workdays.at(-1),
        activePhotoCount: projectPhotos.filter((photo) => !photo.voidedAt).length,
        completedItemCount: projectItems.filter((item) => item.status === 'done').length,
        totalItemCount: projectItems.length,
        handoffPhase,
      };
    }),
  );

  return summaries.sort((a, b) => {
    if (a.project.status !== b.project.status) return a.project.status === 'active' ? -1 : 1;
    return (
      b.latestActivity.localeCompare(a.latestActivity) ||
      a.project.name.localeCompare(b.project.name) ||
      a.project.id.localeCompare(b.project.id)
    );
  });
}
