/**
 * Full-fidelity export per the portfolio export contract:
 * ZIP = manifest.json + data.json + CSVs + photo blobs (byte-for-byte —
 * anything else would break the hashes). Free forever, works offline.
 */
import { strToU8, zipSync } from 'fflate';
import type { DailyLog, Photo, Project, PunchItem, Settings } from './types.ts';

export const EXPORT_FORMAT = 'fieldproof-export';
export const EXPORT_VERSION = 1;

export interface ExportPayload {
  projects: Project[];
  photos: Photo[];
  punchItems: PunchItem[];
  dailyLogs: DailyLog[];
  settings: Settings;
}

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  counts: { projects: number; photos: number; punchItems: number; dailyLogs: number };
}

export interface PhotoBlob {
  id: string;
  bytes: Uint8Array;
}

export function toCsv(rows: Record<string, string | number | undefined>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const esc = (v: string | number | undefined): string => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

export function photosCsv(payload: ExportPayload): string {
  const name = new Map(payload.projects.map((p) => [p.id, p.name]));
  return toCsv(
    payload.photos.map((p) => ({
      project: name.get(p.projectId) ?? p.projectId,
      captured_at: p.capturedAt,
      sha256: p.sha256,
      lat: p.lat,
      lon: p.lon,
      caption: p.caption,
      voided: p.voidedAt ? 'yes' : '',
    })),
  );
}

export function buildExportZip(
  payload: ExportPayload,
  blobs: PhotoBlob[],
  now: Date = new Date(),
): Uint8Array {
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    counts: {
      projects: payload.projects.length,
      photos: payload.photos.length,
      punchItems: payload.punchItems.length,
      dailyLogs: payload.dailyLogs.length,
    },
  };
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'data.json': strToU8(JSON.stringify(payload, null, 2)),
    'csv/photos.csv': strToU8(photosCsv(payload)),
  };
  for (const b of blobs) {
    // Level 0: JPEG is already compressed, and recompression must not touch bytes.
    files[`photos/${b.id}.jpg`] = [b.bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

export function exportFileName(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `fieldproof-backup-${y}-${m}-${d}.zip`;
}
