/**
 * Repository layer: the only module allowed to touch Dexie directly.
 * UI components import from here (or the hooks in useLive.ts), never db.ts.
 *
 * The heart of this file is sealCapture(): blob + metadata + SHA-256 land
 * in ONE transaction. If any part fails, nothing is written and the caller
 * hears about it — a photo is either fully sealed or it never existed.
 * The UI renders from the committed row, so what you see IS what's stored.
 */
import { db } from './db.ts';
import { uuidv7 } from '../domain/ids.ts';
import { sha256Hex, verifyBytes } from '../domain/hash.ts';
import { createDailyLog, updateLogBody } from '../domain/dailylog.ts';
import type { DailyLog, Photo, Project, PunchItem, Settings } from '../domain/types.ts';
import { DEFAULT_SETTINGS, isValidProjectStartDate } from '../domain/types.ts';

/* ---------- projects ---------- */

export type ProjectCreateOptions = {
  address?: string;
  startDate?: string;
};

function cleanStartDate(value: string | undefined): string | undefined {
  const startDate = value?.trim() || undefined;
  if (startDate && !isValidProjectStartDate(startDate)) {
    throw new Error('Start date must use YYYY-MM-DD.');
  }
  return startDate;
}

export async function addProject(
  name: string,
  client?: string,
  options: ProjectCreateOptions = {},
): Promise<Project> {
  if (!name.trim()) throw new Error('A project needs a name');
  const now = new Date().toISOString();
  const project: Project = {
    id: uuidv7(),
    name: name.trim(),
    client: client?.trim() || undefined,
    address: options.address?.trim() || undefined,
    startDate: cleanStartDate(options.startDate),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await db.projects.add(project);
  return project;
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<Project, 'id' | 'createdAt'>>,
): Promise<void> {
  const next = { ...patch };
  if (patch.startDate !== undefined) next.startDate = cleanStartDate(patch.startDate);
  await db.projects.update(id, { ...next, updatedAt: new Date().toISOString() });
}

export async function archiveProject(id: string): Promise<void> {
  await updateProject(id, { status: 'archived' });
}

/** Deletes a project and everything in it. Irreversible; caller confirms. */
export async function deleteProject(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.projects, db.photos, db.photoBlobs, db.punchItems, db.dailyLogs],
    async () => {
      const photoIds = (await db.photos.where({ projectId: id }).primaryKeys()) as string[];
      await db.photoBlobs.bulkDelete(photoIds);
      await db.photos.where({ projectId: id }).delete();
      await db.punchItems.where({ projectId: id }).delete();
      await db.dailyLogs.where({ projectId: id }).delete();
      await db.projects.delete(id);
    },
  );
}

export type DemoInstallPhoto = Omit<Photo, 'sha256' | 'size'> & { bytes: Uint8Array };

export interface DemoInstallBundle {
  marker: string;
  project: Project;
  photos: readonly DemoInstallPhoto[];
  punchItems: readonly PunchItem[];
  dailyLogs: readonly DailyLog[];
  replacements: readonly { projectId: string; marker: string }[];
  meta: { key: string; value: unknown };
}

/** Writes one validated synthetic demo bundle without using normal capture IDs or times. */
export async function installDemoBundle(input: DemoInstallBundle): Promise<void> {
  if (!input.marker || input.project.notes?.includes(input.marker) !== true) {
    throw new Error('Demo project marker is invalid');
  }
  if (!input.meta.key || JSON.stringify(input.meta.value) === undefined) {
    throw new Error('Demo metadata is invalid');
  }

  const photoIds = new Set<string>();
  const preparedPhotos: Array<{ photo: Photo; bytes: Uint8Array }> = [];
  for (const source of input.photos) {
    if (
      photoIds.has(source.id) ||
      source.projectId !== input.project.id ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(source.capturedAt) ||
      source.width < 1 ||
      source.height < 1
    ) {
      throw new Error('Demo photo facts are invalid');
    }
    const bytes = Uint8Array.from(source.bytes);
    if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('Demo photo is not a JPEG');
    }
    photoIds.add(source.id);
    const { bytes: _ignored, ...facts } = source;
    preparedPhotos.push({
      photo: {
        ...facts,
        sha256: await sha256Hex(bytes),
        size: bytes.byteLength,
      },
      bytes,
    });
  }

  const punchIds = new Set<string>();
  for (const item of input.punchItems) {
    if (
      punchIds.has(item.id) ||
      item.projectId !== input.project.id ||
      item.photoIds.some((photoId) => !photoIds.has(photoId))
    ) {
      throw new Error('Demo work item facts are invalid');
    }
    punchIds.add(item.id);
  }

  const logIds = new Set<string>();
  const logDates = new Set<string>();
  for (const log of input.dailyLogs) {
    if (
      logIds.has(log.id) ||
      logDates.has(log.logDate) ||
      log.projectId !== input.project.id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(log.logDate)
    ) {
      throw new Error('Demo daily record facts are invalid');
    }
    logIds.add(log.id);
    logDates.add(log.logDate);
  }

  const replacements = [...new Map(input.replacements.map((row) => [row.projectId, row])).values()];
  await db.transaction(
    'rw',
    [db.projects, db.photos, db.photoBlobs, db.punchItems, db.dailyLogs, db.meta],
    async () => {
      for (const replacement of replacements) {
        const project = await db.projects.get(replacement.projectId);
        if (project && project.notes?.includes(replacement.marker) !== true) {
          throw new Error('Refusing to replace a project without its demo marker');
        }
      }

      for (const replacement of replacements) {
        const id = replacement.projectId;
        const childPhotoIds = (await db.photos.where({ projectId: id }).primaryKeys()) as string[];
        await db.photoBlobs.bulkDelete(childPhotoIds);
        await db.photos.where({ projectId: id }).delete();
        await db.punchItems.where({ projectId: id }).delete();
        await db.dailyLogs.where({ projectId: id }).delete();
        await db.projects.delete(id);
      }

      await db.projects.add(input.project);
      await db.photos.bulkAdd(preparedPhotos.map(({ photo }) => photo));
      await db.photoBlobs.bulkAdd(
        preparedPhotos.map(({ photo, bytes }) => ({
          id: photo.id,
          bytes: new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }),
        })),
      );
      await db.punchItems.bulkAdd([...input.punchItems]);
      await db.dailyLogs.bulkAdd([...input.dailyLogs]);
      await db.meta.put({ key: input.meta.key, value: JSON.stringify(input.meta.value) });
    },
  );
}

/* ---------- sealed capture ---------- */

export interface CaptureInput {
  projectId: string;
  /** The processed (downscaled) JPEG bytes — these are what gets sealed. */
  bytes: Uint8Array;
  width: number;
  height: number;
  lat?: number;
  lon?: number;
  accuracy?: number;
  caption?: string;
}

/**
 * The atomic seal. Hash is computed BEFORE the transaction opens; the
 * transaction writes blob + metadata together or not at all.
 */
export async function sealCapture(input: CaptureInput): Promise<Photo> {
  const sha256 = await sha256Hex(input.bytes);
  const now = new Date();
  const photo: Photo = {
    id: uuidv7(),
    projectId: input.projectId,
    capturedAt: localIso(now),
    sha256,
    width: input.width,
    height: input.height,
    size: input.bytes.byteLength,
    lat: input.lat,
    lon: input.lon,
    accuracy: input.accuracy,
    caption: input.caption?.trim() || undefined,
  };
  const buf = new Uint8Array(input.bytes).buffer as ArrayBuffer;
  const blob = new Blob([buf], { type: 'image/jpeg' });
  await db.transaction('rw', [db.projects, db.photos, db.photoBlobs], async () => {
    const project = await db.projects.get(input.projectId);
    if (!project || project.status !== 'active') {
      throw new Error('Choose an active project before saving a photo.');
    }
    await db.photoBlobs.add({ id: photo.id, bytes: blob });
    await db.photos.add(photo);
  });
  return photo;
}

/** Local wall-clock time as ISO without timezone suffix — what the crew saw. */
function localIso(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export async function getPhotoBytes(id: string): Promise<Blob | undefined> {
  const row = await db.photoBlobs.get(id);
  return row?.bytes;
}

/** Caption/tag edits touch metadata only — never the sealed bytes. */
export async function updatePhotoMeta(
  id: string,
  patch: Pick<Partial<Photo>, 'caption' | 'tags'>,
): Promise<void> {
  await db.photos.update(id, patch);
}

/** Void, don't delete: the record shows the photo existed and why it's out. */
export async function voidPhoto(id: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('Voiding needs a reason');
  await db.photos.update(id, {
    voidedAt: new Date().toISOString(),
    voidReason: reason.trim(),
  });
}

/** Recompute the digest from stored bytes and compare to the seal. */
export async function verifyPhoto(
  id: string,
): Promise<{ ok: boolean; expected: string; actual: string } | null> {
  const [photo, blobRow] = await Promise.all([db.photos.get(id), db.photoBlobs.get(id)]);
  if (!photo || !blobRow) return null;
  const bytes = new Uint8Array(await blobRow.bytes.arrayBuffer());
  return verifyBytes(bytes, photo.sha256);
}

/* ---------- punch ---------- */

export async function savePunchItem(item: PunchItem): Promise<void> {
  await db.punchItems.put(item);
}

export async function getPunchItem(id: string): Promise<PunchItem | undefined> {
  return db.punchItems.get(id);
}

export async function getPhoto(id: string): Promise<Photo | undefined> {
  return db.photos.get(id);
}

export async function deletePunchItem(id: string): Promise<void> {
  await db.punchItems.delete(id);
}

export async function readCloseoutSnapshot(projectId: string): Promise<{
  project: Project;
  photos: Photo[];
  punchItems: PunchItem[];
  dailyLogs: DailyLog[];
} | null> {
  return db.transaction(
    'r',
    [db.projects, db.photos, db.punchItems, db.dailyLogs],
    async () => {
      const [project, photos, punchItems, dailyLogs] = await Promise.all([
        db.projects.get(projectId),
        db.photos.where({ projectId }).toArray(),
        db.punchItems.where({ projectId }).toArray(),
        db.dailyLogs.where({ projectId }).toArray(),
      ]);
      return project ? { project, photos, punchItems, dailyLogs } : null;
    },
  );
}

/* ---------- daily logs ---------- */

export async function upsertDailyLog(
  projectId: string,
  logDate: string,
  body: string,
): Promise<DailyLog> {
  const existing = await db.dailyLogs.where({ projectId, logDate }).first();
  if (existing) {
    const updated = updateLogBody(existing, body);
    await db.dailyLogs.put(updated);
    return updated;
  }
  const log = createDailyLog(projectId, logDate, body);
  await db.dailyLogs.add(log);
  return log;
}

export async function createDailyLogIfAbsent(
  projectId: string,
  logDate: string,
  body: string,
): Promise<DailyLog | null> {
  return db.transaction('rw', db.dailyLogs, async () => {
    const existing = await db.dailyLogs.where({ projectId, logDate }).first();
    if (existing) return null;
    const log = createDailyLog(projectId, logDate, body);
    await db.dailyLogs.add(log);
    return log;
  });
}

/* ---------- settings / meta ---------- */

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const row = await db.meta.get(SETTINGS_KEY);
  if (!row) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Settings) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await db.meta.put({ key: SETTINGS_KEY, value: JSON.stringify(next) });
  return next;
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await db.meta.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await db.meta.put({ key, value: JSON.stringify(value) });
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key);
}

/* ---------- export / import (portfolio export contract) ---------- */

import {
  buildExportZip,
  exportFileName,
  type ExportPayload,
  type PhotoBlob,
} from '../domain/export.ts';
import { mergePayloads, parseImportZip } from '../domain/import.ts';

export async function readPayload(): Promise<ExportPayload> {
  const [projects, photos, punchItems, dailyLogs, settings] = await Promise.all([
    db.projects.toArray(),
    db.photos.toArray(),
    db.punchItems.toArray(),
    db.dailyLogs.toArray(),
    getSettings(),
  ]);
  return { projects, photos, punchItems, dailyLogs, settings };
}

async function writePayload(payload: ExportPayload): Promise<void> {
  await db.transaction(
    'rw',
    [db.projects, db.photos, db.punchItems, db.dailyLogs, db.meta],
    async () => {
      await db.projects.bulkPut(payload.projects);
      await db.photos.bulkPut(payload.photos);
      await db.punchItems.bulkPut(payload.punchItems);
      await db.dailyLogs.bulkPut(payload.dailyLogs);
      await db.meta.put({ key: SETTINGS_KEY, value: JSON.stringify(payload.settings) });
    },
  );
}

export async function exportAllZip(): Promise<{ name: string; bytes: Uint8Array }> {
  const payload = await readPayload();
  const blobs: PhotoBlob[] = [];
  for (const photo of payload.photos) {
    const row = await db.photoBlobs.get(photo.id);
    if (row) blobs.push({ id: photo.id, bytes: new Uint8Array(await row.bytes.arrayBuffer()) });
  }
  return { name: exportFileName(), bytes: buildExportZip(payload, blobs) };
}

export interface ImportResult {
  mode: 'restore' | 'merge';
  summary?: { added: Record<string, number>; updated: Record<string, number> };
}

export async function importFromZip(zipBytes: Uint8Array): Promise<ImportResult> {
  const parsed = parseImportZip(zipBytes);
  const existing = await readPayload();
  const empty =
    existing.projects.length === 0 && existing.photos.length === 0 && existing.dailyLogs.length === 0;

  if (empty) {
    await writePayload(parsed.payload);
    await syncBlobs(parsed.blobs);
    return { mode: 'restore' };
  }

  const { payload, summary } = mergePayloads(existing, parsed.payload);
  await writePayload(payload);
  await syncBlobs(parsed.blobs);
  return { mode: 'merge', summary };
}

/** Restore photo bytes for rows that lack them; never overwrite sealed bytes. */
async function syncBlobs(blobs: Map<string, Uint8Array>): Promise<void> {
  for (const [id, bytes] of blobs) {
    const have = await db.photoBlobs.get(id);
    if (!have) {
      const buf = new Uint8Array(bytes).buffer as ArrayBuffer;
      await db.photoBlobs.add({ id, bytes: new Blob([buf], { type: 'image/jpeg' }) });
    }
  }
}
