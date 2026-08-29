/**
 * Integration tests: real Dexie schema against fake-indexeddb.
 * The ones that matter most: sealCapture atomicity, verifyPhoto catching
 * tampered bytes, and the export round-trip preserving seals byte-for-byte.
 */
import 'fake-indexeddb/auto';
import { strToU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.ts';
import {
  addProject,
  deleteProject,
  exportAllZip,
  getPhotoBytes,
  getSettings,
  importFromZip,
  installDemoBundle,
  saveSettings,
  sealCapture,
  savePunchItem,
  upsertDailyLog,
  updateProject,
  verifyPhoto,
  voidPhoto,
} from './repo.ts';
import { createPunchItem, markDone, setProofException } from '../domain/punch.ts';

async function reset() {
  await Promise.all([
    db.projects.clear(),
    db.photos.clear(),
    db.photoBlobs.clear(),
    db.punchItems.clear(),
    db.dailyLogs.clear(),
    db.meta.clear(),
  ]);
}

const JPEG = strToU8('\xff\xd8\xff fake jpeg body for tests');
const DEMO_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('sealCapture', () => {
  beforeEach(reset);

  it('writes blob + metadata + hash together', async () => {
    const p = await addProject('Smith kitchen');
    const photo = await sealCapture({
      projectId: p.id,
      bytes: JPEG,
      width: 4032,
      height: 3024,
      lat: 45.5,
      lon: -122.6,
      accuracy: 8,
    });
    expect(photo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(photo.size).toBe(JPEG.byteLength);
    const stored = await getPhotoBytes(photo.id);
    expect(stored).toBeTruthy();
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(JPEG);
  });

  it('verifyPhoto passes on intact bytes and fails on tampered bytes', async () => {
    const p = await addProject('Job');
    const photo = await sealCapture({ projectId: p.id, bytes: JPEG, width: 100, height: 80 });

    const good = await verifyPhoto(photo.id);
    expect(good?.ok).toBe(true);

    // Tamper with the stored blob behind the repo's back.
    const evil = new Uint8Array(JPEG);
    evil[5] = evil[5]! ^ 0xff;
    const buf = evil.buffer as ArrayBuffer;
    await db.photoBlobs.put({ id: photo.id, bytes: new Blob([buf], { type: 'image/jpeg' }) });

    const bad = await verifyPhoto(photo.id);
    expect(bad?.ok).toBe(false);
    expect(bad?.expected).toBe(photo.sha256);
    expect(bad?.actual).not.toBe(photo.sha256);
  });

  it('voids with a reason, never deletes', async () => {
    const p = await addProject('Job');
    const photo = await sealCapture({ projectId: p.id, bytes: JPEG, width: 10, height: 10 });
    await expect(voidPhoto(photo.id, '  ')).rejects.toThrow();
    await voidPhoto(photo.id, 'Duplicate shot');
    const row = await db.photos.get(photo.id);
    expect(row?.voidedAt).toBeTruthy();
    expect(row?.voidReason).toBe('Duplicate shot');
    // bytes still there — voided is not deleted
    expect(await getPhotoBytes(photo.id)).toBeTruthy();
  });
});

describe('projects / punch / logs', () => {
  beforeEach(reset);

  it('creates a project with only its required name', async () => {
    const project = await addProject('  Smith kitchen  ');

    expect(project).toMatchObject({
      name: 'Smith kitchen',
      status: 'active',
    });
    expect(project.client).toBeUndefined();
    expect(project.address).toBeUndefined();
    expect(project.startDate).toBeUndefined();
    expect(await db.projects.get(project.id)).toEqual(project);
  });

  it('stores optional client, site, and start date without changing the Dexie version', async () => {
    const project = await addProject('Smith kitchen', 'The Smiths', {
      address: '125 Main Street',
      startDate: '2026-08-29',
    });

    expect(project).toMatchObject({
      client: 'The Smiths',
      address: '125 Main Street',
      startDate: '2026-08-29',
    });
    expect(db.verno).toBe(1);
  });

  it('rejects invalid project start dates on create and update', async () => {
    await expect(
      addProject('Bad start date', undefined, { startDate: '2026-02-30' }),
    ).rejects.toThrow();
    expect(await db.projects.count()).toBe(0);

    const project = await addProject('Valid start date', undefined, {
      startDate: '2026-08-29',
    });
    await expect(updateProject(project.id, { startDate: '08/30/2026' })).rejects.toThrow();
    expect((await db.projects.get(project.id))?.startDate).toBe('2026-08-29');
  });

  it.each(['missing', 'archived'] as const)(
    'does not save a photo for a %s project',
    async (projectState) => {
      let projectId = 'missing-project';
      if (projectState === 'archived') {
        const project = await addProject('Archived project');
        projectId = project.id;
        await updateProject(project.id, { status: 'archived' });
      }

      await expect(
        sealCapture({ projectId, bytes: JPEG, width: 20, height: 20 }),
      ).rejects.toThrow();
      expect(await db.photos.where({ projectId }).count()).toBe(0);
      expect(await db.photoBlobs.count()).toBe(0);
    },
  );

  it('deleteProject cascades photos, blobs, punch, and logs', async () => {
    const p = await addProject('Teardown');
    await sealCapture({ projectId: p.id, bytes: JPEG, width: 10, height: 10 });
    await savePunchItem(createPunchItem(p.id, 'Fix trim'));
    await upsertDailyLog(p.id, '2026-07-11', 'Demo day.');
    await deleteProject(p.id);
    expect(await db.photos.count()).toBe(0);
    expect(await db.photoBlobs.count()).toBe(0);
    expect(await db.punchItems.count()).toBe(0);
    expect(await db.dailyLogs.count()).toBe(0);
  });

  it('upsertDailyLog updates the same day instead of duplicating', async () => {
    const p = await addProject('Log job');
    await upsertDailyLog(p.id, '2026-07-11', 'Morning.');
    await upsertDailyLog(p.id, '2026-07-11', 'Morning. Afternoon.');
    const logs = await db.dailyLogs.where({ projectId: p.id }).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.body).toBe('Morning. Afternoon.');
  });
});

describe('demo bundle install', () => {
  beforeEach(reset);

  it('commits the fixed records, blobs, and metadata as one bundle', async () => {
    const project = {
      id: 'demo-project',
      name: 'Demo project',
      status: 'active' as const,
      notes: 'fieldproof:demo:v2',
      createdAt: '2025-05-13T07:30:00',
      updatedAt: '2025-05-13T08:00:00',
    };
    await installDemoBundle({
      marker: 'fieldproof:demo:v2',
      project,
      photos: [
        {
          id: 'demo-photo',
          projectId: project.id,
          capturedAt: '2025-05-13T08:00:00',
          width: 960,
          height: 720,
          caption: 'Demo photo',
          bytes: DEMO_JPEG,
        },
      ],
      punchItems: [],
      dailyLogs: [],
      replacements: [],
      meta: { key: 'demo-meta', value: { version: 2, projectId: project.id } },
    });

    expect(await db.projects.get(project.id)).toEqual(project);
    expect((await db.photos.get('demo-photo'))?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await getPhotoBytes('demo-photo')).toBeTruthy();
    expect(await db.meta.get('demo-meta')).toEqual({
      key: 'demo-meta',
      value: JSON.stringify({ version: 2, projectId: project.id }),
    });
  });

  it('rolls back the full replacement when a fixed child ID collides', async () => {
    const normal = await addProject('Normal project');
    await db.photos.add({
      id: 'demo-photo',
      projectId: normal.id,
      capturedAt: '2025-05-13T08:00:00',
      sha256: 'a'.repeat(64),
      width: 20,
      height: 20,
      size: 10,
    });

    await expect(
      installDemoBundle({
        marker: 'fieldproof:demo:v2',
        project: {
          id: 'demo-project',
          name: 'Demo project',
          status: 'active',
          notes: 'fieldproof:demo:v2',
          createdAt: '2025-05-13T07:30:00',
          updatedAt: '2025-05-13T08:00:00',
        },
        photos: [
          {
            id: 'demo-photo',
            projectId: 'demo-project',
            capturedAt: '2025-05-13T08:00:00',
            width: 960,
            height: 720,
            bytes: DEMO_JPEG,
          },
        ],
        punchItems: [],
        dailyLogs: [],
        replacements: [],
        meta: { key: 'demo-meta', value: { version: 2, projectId: 'demo-project' } },
      }),
    ).rejects.toThrow();

    expect(await db.projects.get('demo-project')).toBeUndefined();
    expect(await db.meta.get('demo-meta')).toBeUndefined();
    expect(await db.projects.get(normal.id)).toBeTruthy();
    expect(await db.photos.get('demo-photo')).toMatchObject({ projectId: normal.id });
  });
});

describe('settings', () => {
  beforeEach(reset);

  it('round-trips patches over defaults', async () => {
    expect((await getSettings()).theme).toBe('system');
    await saveSettings({ theme: 'dark', company: 'Maple Street Builders' });
    const s = await getSettings();
    expect(s.theme).toBe('dark');
    expect(s.company).toBe('Maple Street Builders');
  });
});

describe('export / import round-trip', () => {
  beforeEach(reset);

  it('restores a full backup with seals intact', async () => {
    const p = await addProject('Backup job', 'Chen');
    const photo = await sealCapture({ projectId: p.id, bytes: JPEG, width: 20, height: 20 });
    await savePunchItem(createPunchItem(p.id, 'Paint touch-up'));
    await upsertDailyLog(p.id, '2026-07-11', 'Sealed and logged.');

    const zip = await exportAllZip();
    expect(zip.name).toMatch(/^fieldproof-backup-\d{4}-\d{2}-\d{2}\.zip$/);

    await reset();
    const result = await importFromZip(zip.bytes);
    expect(result.mode).toBe('restore');
    expect(await db.projects.count()).toBe(1);
    expect(await db.punchItems.count()).toBe(1);
    expect(await db.dailyLogs.count()).toBe(1);

    // the seal must survive the round trip
    const check = await verifyPhoto(photo.id);
    expect(check?.ok).toBe(true);
  });

  it('preserves a human proof exception through export and import', async () => {
    const project = await addProject('Exception backup');
    const done = markDone(createPunchItem(project.id, 'Existing wall', '2026-07-11T10:00:00Z'));
    const item = setProofException(
      done,
      'Outside the signed work scope.',
      '2026-07-11T11:00:00Z',
    );
    await savePunchItem(item);

    const zip = await exportAllZip();
    await reset();
    await importFromZip(zip.bytes);

    const restored = await db.punchItems.get(item.id);
    expect(restored?.proofException).toEqual({
      reason: 'Outside the signed work scope.',
      recordedAt: '2026-07-11T11:00:00Z',
    });
  });

  it('merges into existing data, newer wins', async () => {
    const p = await addProject('Merge job');
    const zip = await exportAllZip();
    // local edit after the backup
    await db.projects.update(p.id, {
      name: 'Merge job (renamed)',
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await importFromZip(zip.bytes);
    expect(result.mode).toBe('merge');
    const row = await db.projects.get(p.id);
    expect(row?.name).toBe('Merge job (renamed)');
  });
});
