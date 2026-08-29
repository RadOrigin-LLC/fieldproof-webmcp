/**
 * Reactive read layer. dexie-react-hooks' useLiveQuery re-renders components
 * whenever the underlying tables change — no manual cache invalidation.
 */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.ts';
import { getSettings } from './repo.ts';
import type { Settings } from '../domain/types.ts';
import { buildProjectSummaries, type ProjectReviewSummary } from '../domain/projects.ts';
import { getCloseoutSessionStore } from './closeoutSession.ts';

const projectSummarySessions = getCloseoutSessionStore();

export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => {
    // touch the table so edits re-fire the query
    await db.meta.get('settings');
    return getSettings();
  }, []);
}

export function useProjects() {
  return useLiveQuery(
    () => db.projects.where('status').equals('active').sortBy('updatedAt'),
    [],
  )?.reverse();
}

export function useAllProjects() {
  return useLiveQuery(() => db.projects.toArray(), []);
}

export function useProjectSummaries() {
  const [reviewVersion, setReviewVersion] = useState(0);

  useEffect(
    () => projectSummarySessions.subscribe(() => setReviewVersion((value) => value + 1)),
    [],
  );

  return useLiveQuery(async () => {
    const [projects, photos, punchItems, dailyLogs] = await Promise.all([
      db.projects.toArray(),
      db.photos.toArray(),
      db.punchItems.toArray(),
      db.dailyLogs.toArray(),
    ]);
    const reviewByProject: Record<string, ProjectReviewSummary> = {};
    for (const project of projects) {
      const session = projectSummarySessions.getProject(project.id);
      reviewByProject[project.id] = {
        phase: session.phase,
        sourceFingerprint: session.audit?.sourceFingerprint,
      };
    }
    return buildProjectSummaries({ projects, photos, punchItems, dailyLogs, reviewByProject });
  }, [reviewVersion]);
}

export function useProject(id: string | undefined) {
  // null = looked and it's gone; undefined = still loading.
  return useLiveQuery(async () => (id ? ((await db.projects.get(id)) ?? null) : null), [id]);
}

export function usePhotos(projectId: string | undefined) {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    const rows = await db.photos.where({ projectId }).toArray();
    return rows.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }, [projectId]);
}

export function usePhotoCount(projectId: string | undefined) {
  return useLiveQuery(async () => {
    if (!projectId) return 0;
    return db.photos.where({ projectId }).count();
  }, [projectId]);
}

export function usePunch(projectId: string | undefined) {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    return db.punchItems.where({ projectId }).toArray();
  }, [projectId]);
}

export function useDailyLogs(projectId: string | undefined) {
  return useLiveQuery(async () => {
    if (!projectId) return [];
    const rows = await db.dailyLogs.where({ projectId }).toArray();
    return rows.sort((a, b) => b.logDate.localeCompare(a.logDate));
  }, [projectId]);
}

/** Everything the reports need for one project, live. */
export function useProjectRecord(projectId: string | undefined) {
  return useLiveQuery(async () => {
    if (!projectId) return null;
    const [project, photos, punch, logs] = await Promise.all([
      db.projects.get(projectId),
      db.photos.where({ projectId }).toArray(),
      db.punchItems.where({ projectId }).toArray(),
      db.dailyLogs.where({ projectId }).toArray(),
    ]);
    return project ? { project, photos, punch, logs } : null;
  }, [projectId]);
}
