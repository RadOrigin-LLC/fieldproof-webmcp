/**
 * Dexie schema. IndexedDB is the source of truth (local-first).
 * Photo bytes live in `photoBlobs`, split from metadata so browsing a
 * 300-photo project never loads gigabytes into memory.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { DailyLog, Photo, Project, PunchItem } from '../domain/types.ts';

export interface PhotoBlobRow {
  id: string; // same id as the Photo row
  bytes: Blob;
}

export interface MetaRow {
  key: string;
  value: string;
}

export const db = new Dexie('fieldproof') as Dexie & {
  projects: EntityTable<Project, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  photoBlobs: EntityTable<PhotoBlobRow, 'id'>;
  punchItems: EntityTable<PunchItem, 'id'>;
  dailyLogs: EntityTable<DailyLog, 'id'>;
  meta: EntityTable<MetaRow, 'key'>;
};

db.version(1).stores({
  projects: 'id, status, updatedAt',
  photos: 'id, projectId, capturedAt, [projectId+capturedAt]',
  photoBlobs: 'id',
  punchItems: 'id, projectId, status',
  dailyLogs: 'id, projectId, logDate, [projectId+logDate]',
  meta: 'key',
});
