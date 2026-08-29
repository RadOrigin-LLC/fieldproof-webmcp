import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../data/db.ts';
import { getCloseoutSessionStore } from '../data/closeoutSession.ts';
import {
  addProject,
  getMeta,
  readCloseoutSnapshot,
  savePunchItem,
  setMeta,
  updateProject,
  upsertDailyLog,
  verifyPhoto,
} from '../data/repo.ts';
import { attachPhoto } from '../domain/punch.ts';
import { DEMO_PROJECT_ID, LEGACY_DEMO_MARKER } from './manifest.ts';
import { DEMO_META_KEY, loadDemoProject, resetDemoProject } from './seed.ts';

async function resetDatabase() {
  await Promise.all([
    db.projects.clear(),
    db.photos.clear(),
    db.photoBlobs.clear(),
    db.punchItems.clear(),
    db.dailyLogs.clear(),
    db.meta.clear(),
  ]);
  getCloseoutSessionStore().clearProject(DEMO_PROJECT_ID);
}

function imageLoader() {
  return vi.fn(async (assetPath: string) => {
    const number = Number(assetPath.match(/p(\d{2})\.jpg$/)?.[1] ?? 0);
    return new Uint8Array([0xff, 0xd8, number, number ^ 0xff, 0xff, 0xd9]);
  });
}

describe('Maple Street demo seed', () => {
  beforeEach(resetDatabase);

  it('installs the exact starting record with current photo checks', async () => {
    const loadAsset = imageLoader();

    const result = await loadDemoProject({ loadAsset });
    const snapshot = await readCloseoutSnapshot(result.projectId);

    expect(result).toEqual({ projectId: DEMO_PROJECT_ID, created: true });
    expect(snapshot?.project).toMatchObject({
      id: DEMO_PROJECT_ID,
      name: 'Maple Street Kitchen Demo',
      client: 'Sample homeowner',
      status: 'active',
    });
    expect(snapshot?.photos).toHaveLength(18);
    expect(snapshot?.punchItems).toHaveLength(10);
    expect(snapshot?.dailyLogs.map((log) => log.logDate).sort()).toEqual([
      '2025-05-13',
      '2025-05-14',
    ]);
    expect(snapshot?.punchItems.filter((item) => item.photoIds.length > 0)).toHaveLength(8);
    expect(
      snapshot?.punchItems
        .filter((item) => item.photoIds.length === 0)
        .map((item) => item.id)
        .sort(),
    ).toEqual(['msk25w08', 'msk25w10']);
    expect(loadAsset).toHaveBeenCalledTimes(18);
    const checks = await Promise.all(snapshot!.photos.map((photo) => verifyPhoto(photo.id)));
    expect(checks.every((check) => check?.ok === true)).toBe(true);
  });

  it('opens the existing sample without loading assets or making a duplicate', async () => {
    const loadAsset = imageLoader();
    const first = await loadDemoProject({ loadAsset });
    const second = await loadDemoProject({ loadAsset });

    expect(second).toEqual({ projectId: first.projectId, created: false });
    expect(await db.projects.count()).toBe(1);
    expect(await db.photos.count()).toBe(18);
    expect(loadAsset).toHaveBeenCalledTimes(18);
  });

  it('resets the sample starting state and keeps normal work and review state', async () => {
    const normal = await addProject('Zimmerman Deck Rebuild', 'Sample Client');
    const loadAsset = imageLoader();
    await loadDemoProject({ loadAsset });
    const before = await readCloseoutSnapshot(DEMO_PROJECT_ID);
    const target = before!.punchItems.find((item) => item.id === 'msk25w08')!;
    await savePunchItem(attachPhoto(target, 'msk25p13', '2025-05-15T16:30:00'));
    await upsertDailyLog(DEMO_PROJECT_ID, '2025-05-15', 'Temporary approved draft.');
    getCloseoutSessionStore().setPhase(normal.id, 'needs-attention');
    getCloseoutSessionStore().setPhase(DEMO_PROJECT_ID, 'ready');

    await expect(resetDemoProject({ loadAsset })).resolves.toBe(true);

    const reset = await readCloseoutSnapshot(DEMO_PROJECT_ID);
    expect(reset?.punchItems.find((item) => item.id === 'msk25w08')?.photoIds).toEqual([]);
    expect(reset?.dailyLogs.map((log) => log.logDate).sort()).toEqual(['2025-05-13', '2025-05-14']);
    expect(await db.projects.get(normal.id)).toBeTruthy();
    expect(getCloseoutSessionStore().getProject(DEMO_PROJECT_ID).phase).toBe('not-checked');
    expect(getCloseoutSessionStore().getProject(normal.id).phase).toBe('needs-attention');
  });

  it('replaces a validated version 1 sample without leaving a duplicate', async () => {
    const legacy = await addProject('Maple Street Kitchen Demo');
    await updateProject(legacy.id, { notes: LEGACY_DEMO_MARKER });
    await setMeta(DEMO_META_KEY, { version: 1, projectId: legacy.id });

    await expect(loadDemoProject({ loadAsset: imageLoader() })).resolves.toEqual({
      projectId: DEMO_PROJECT_ID,
      created: true,
    });

    expect(await db.projects.get(legacy.id)).toBeUndefined();
    expect(await db.projects.get(DEMO_PROJECT_ID)).toBeTruthy();
    expect(await db.projects.count()).toBe(1);
  });

  it('refuses invalid metadata without deleting a normal project', async () => {
    const normal = await addProject('Normal project');
    await setMeta(DEMO_META_KEY, { version: 1, projectId: normal.id });

    await expect(resetDemoProject({ loadAsset: imageLoader() })).resolves.toBe(false);

    expect(await db.projects.get(normal.id)).toBeTruthy();
    expect(await getMeta(DEMO_META_KEY)).toBeNull();
  });

  it('keeps the prior sample unchanged when a reset asset cannot load', async () => {
    await loadDemoProject({ loadAsset: imageLoader() });
    const before = await readCloseoutSnapshot(DEMO_PROJECT_ID);
    const target = before!.punchItems.find((item) => item.id === 'msk25w08')!;
    await savePunchItem(attachPhoto(target, 'msk25p13', '2025-05-15T16:30:00'));
    const fallback = imageLoader();
    const failingLoader = vi.fn(async (assetPath: string) => {
      if (assetPath.endsWith('msk25p18.jpg')) throw new Error('Asset unavailable');
      return fallback(assetPath);
    });

    await expect(resetDemoProject({ loadAsset: failingLoader })).rejects.toThrow('Asset unavailable');

    const after = await readCloseoutSnapshot(DEMO_PROJECT_ID);
    expect(after?.punchItems.find((item) => item.id === 'msk25w08')?.photoIds).toEqual([
      'msk25p13',
    ]);
    expect(await getMeta(DEMO_META_KEY)).toEqual({ version: 2, projectId: DEMO_PROJECT_ID });
  });
});
