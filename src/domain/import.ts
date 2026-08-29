/**
 * Import per the portfolio export contract: Restore (into empty) or
 * Merge (dedupe by id, newer updatedAt/createdAt wins). Photo bytes come
 * back byte-for-byte, so seals verify after a round-trip.
 */
import { strFromU8, unzipSync } from 'fflate';
import { EXPORT_FORMAT, type ExportManifest, type ExportPayload } from './export.ts';
import { isValidProjectStartDate } from './types.ts';

export interface ParsedImport {
  manifest: ExportManifest;
  payload: ExportPayload;
  blobs: Map<string, Uint8Array>;
}

export function parseImportZip(zipBytes: Uint8Array): ParsedImport {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch {
    throw new Error('That file is not a readable ZIP.');
  }
  const manifestRaw = files['manifest.json'];
  const dataRaw = files['data.json'];
  if (!manifestRaw || !dataRaw) throw new Error('Not a FieldProof backup (missing manifest).');
  const manifest = JSON.parse(strFromU8(manifestRaw)) as ExportManifest;
  if (manifest.format !== EXPORT_FORMAT) throw new Error('Not a FieldProof backup.');
  const payload = JSON.parse(strFromU8(dataRaw)) as ExportPayload;
  if (!payload || !Array.isArray(payload.projects)) {
    throw new Error('Not a FieldProof backup (missing projects).');
  }
  for (const project of payload.projects) {
    if (
      project.startDate !== undefined &&
      (typeof project.startDate !== 'string' || !isValidProjectStartDate(project.startDate))
    ) {
      throw new Error('The backup has an invalid project start date.');
    }
  }
  const blobs = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    const m = /^photos\/(.+)\.jpg$/.exec(path);
    if (m) blobs.set(m[1]!, bytes);
  }
  return { manifest, payload, blobs };
}

export interface MergeSummary {
  added: Record<string, number>;
  updated: Record<string, number>;
}

interface Row {
  id: string;
  updatedAt?: string;
  createdAt?: string;
}

function stamp(r: Row): string {
  return r.updatedAt ?? r.createdAt ?? '';
}

export function mergeRows<T extends Row>(
  existing: T[],
  incoming: T[],
): { merged: T[]; added: number; updated: number } {
  const byId = new Map(existing.map((r) => [r.id, r]));
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      added++;
    } else if (stamp(inc) > stamp(cur)) {
      byId.set(inc.id, inc);
      updated++;
    }
  }
  return { merged: [...byId.values()], added, updated };
}

export function mergePayloads(
  existing: ExportPayload,
  incoming: ExportPayload,
): { payload: ExportPayload; summary: MergeSummary } {
  const projects = mergeRows(existing.projects, incoming.projects);
  // Photos are immutable — merge is purely additive by id.
  const photos = mergeRows(existing.photos, incoming.photos);
  const punchItems = mergeRows(existing.punchItems, incoming.punchItems);
  const dailyLogs = mergeRows(existing.dailyLogs, incoming.dailyLogs);
  return {
    payload: {
      projects: projects.merged,
      photos: photos.merged,
      punchItems: punchItems.merged,
      dailyLogs: dailyLogs.merged,
      settings: existing.settings,
    },
    summary: {
      added: {
        projects: projects.added,
        photos: photos.added,
        punchItems: punchItems.added,
        dailyLogs: dailyLogs.added,
      },
      updated: {
        projects: projects.updated,
        photos: photos.updated,
        punchItems: punchItems.updated,
        dailyLogs: dailyLogs.updated,
      },
    },
  };
}
