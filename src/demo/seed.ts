import { getCloseoutSessionStore } from '../data/closeoutSession.ts';
import {
  deleteMeta,
  getMeta,
  installDemoBundle,
  readCloseoutSnapshot,
  setMeta,
  updateProject,
} from '../data/repo.ts';
import type { Project } from '../domain/types.ts';
import {
  DEMO_DAILY_LOGS,
  DEMO_MARKER,
  DEMO_META,
  DEMO_META_KEY,
  DEMO_PHOTOS,
  DEMO_PROJECT,
  DEMO_PROJECT_ID,
  DEMO_WORK_ITEMS,
  LEGACY_DEMO_MARKER,
} from './manifest.ts';

export { DEMO_META_KEY, DEMO_PROJECT_NAME } from './manifest.ts';

type DemoMeta =
  | { version: 1; projectId: string }
  | { version: 2; projectId: typeof DEMO_PROJECT_ID };

type DemoSeedOptions = {
  loadAsset?: (path: string) => Promise<Uint8Array>;
};

export type DemoSeedResult = {
  projectId: string;
  created: boolean;
};

type DemoIdentity =
  | { kind: 'current'; project: Project }
  | { kind: 'legacy'; project: Project }
  | { kind: 'none' };

function isDemoMeta(value: unknown): value is DemoMeta {
  if (typeof value !== 'object' || value === null) return false;
  const version = (value as { version?: unknown }).version;
  const projectId = (value as { projectId?: unknown }).projectId;
  return (version === 1 || version === 2) && typeof projectId === 'string';
}

export function isDemoProject(project: Project): boolean {
  return (
    project.notes?.includes(DEMO_MARKER) === true ||
    project.notes?.includes(LEGACY_DEMO_MARKER) === true
  );
}

async function loadPublicAsset(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Demo image could not be loaded: ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function locateDemo(): Promise<DemoIdentity> {
  const rawMeta = await getMeta<unknown>(DEMO_META_KEY);
  const current = await readCloseoutSnapshot(DEMO_PROJECT_ID);
  if (current?.project.notes?.includes(DEMO_MARKER) === true) {
    if (
      !isDemoMeta(rawMeta) ||
      rawMeta.version !== 2 ||
      rawMeta.projectId !== DEMO_PROJECT_ID
    ) {
      await setMeta(DEMO_META_KEY, DEMO_META);
    }
    return { kind: 'current', project: current.project };
  }

  if (isDemoMeta(rawMeta) && rawMeta.version === 1) {
    const legacy = await readCloseoutSnapshot(rawMeta.projectId);
    if (legacy?.project.notes?.includes(LEGACY_DEMO_MARKER) === true) {
      return { kind: 'legacy', project: legacy.project };
    }
  }

  if (rawMeta !== null) await deleteMeta(DEMO_META_KEY);
  return { kind: 'none' };
}

async function installStartingDemo(
  identity: Exclude<DemoIdentity, { kind: 'current' }> | DemoIdentity,
  loadAsset: (path: string) => Promise<Uint8Array>,
): Promise<void> {
  const assets = await Promise.all(DEMO_PHOTOS.map((photo) => loadAsset(photo.assetPath)));
  const replacements =
    identity.kind === 'none'
      ? []
      : [
          {
            projectId: identity.project.id,
            marker: identity.kind === 'legacy' ? LEGACY_DEMO_MARKER : DEMO_MARKER,
          },
        ];

  await installDemoBundle({
    marker: DEMO_MARKER,
    project: { ...DEMO_PROJECT },
    photos: DEMO_PHOTOS.map(({ assetPath: _assetPath, ...photo }, index) => ({
      ...photo,
      bytes: assets[index]!,
    })),
    punchItems: DEMO_WORK_ITEMS.map((item) => ({ ...item, photoIds: [...item.photoIds] })),
    dailyLogs: DEMO_DAILY_LOGS.map((log) => ({ ...log })),
    replacements,
    meta: { key: DEMO_META_KEY, value: DEMO_META },
  });

  const sessions = getCloseoutSessionStore();
  for (const replacement of replacements) sessions.clearProject(replacement.projectId);
  sessions.clearProject(DEMO_PROJECT_ID);
}

export async function getDemoProject(): Promise<Project | null> {
  const identity = await locateDemo();
  return identity.kind === 'none' ? null : identity.project;
}

export async function loadDemoProject({
  loadAsset = loadPublicAsset,
}: DemoSeedOptions = {}): Promise<DemoSeedResult> {
  const identity = await locateDemo();
  if (identity.kind === 'current') {
    if (identity.project.status !== 'active') {
      await updateProject(identity.project.id, { status: 'active' });
    }
    return { projectId: identity.project.id, created: false };
  }

  await installStartingDemo(identity, loadAsset);
  return { projectId: DEMO_PROJECT_ID, created: true };
}

export async function resetDemoProject({
  loadAsset = loadPublicAsset,
}: DemoSeedOptions = {}): Promise<boolean> {
  const identity = await locateDemo();
  if (identity.kind === 'none') return false;
  await installStartingDemo(identity, loadAsset);
  return true;
}
