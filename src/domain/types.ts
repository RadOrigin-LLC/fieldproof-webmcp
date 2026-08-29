/** FieldProof domain types. Pure data — no Dexie, no React, no browser APIs. */

export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  /** Client name — kept private, never contacted, never marketed to. */
  client?: string;
  address?: string;
  /** Optional local start date in YYYY-MM-DD form. */
  startDate?: string;
  notes?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A sealed capture. Immutable once written: no edits, ever. The seal is the
 * metadata recorded in the same transaction as the bytes — capture time,
 * GPS (when available), and the SHA-256 of the stored artifact. Corrections
 * happen via voiding (visible) — never by rewriting.
 */
export interface Photo {
  id: string;
  projectId: string;
  /** When the shutter fired (device clock, ISO). Part of the seal. */
  capturedAt: string;
  /** SHA-256 hex of the stored JPEG bytes. Part of the seal. */
  sha256: string;
  /** Stored artifact dimensions after the documented downscale. */
  width: number;
  height: number;
  /** Bytes of the stored artifact. */
  size: number;
  /** GPS at capture, when the device provided it. Part of the seal. */
  lat?: number;
  lon?: number;
  /** GPS accuracy radius in meters, as reported. */
  accuracy?: number;
  /** Human caption — written AFTER capture, never part of the seal. */
  caption?: string;
  tags?: string[];
  /** Voided (with reason) — bytes retained, visibly struck through. */
  voidedAt?: string;
  voidReason?: string;
}

export type PunchStatus = 'open' | 'done';

export interface ProofException {
  reason: string;
  recordedAt: string;
}

export function isValidProjectStartDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export interface PunchItem {
  id: string;
  projectId: string;
  text: string;
  status: PunchStatus;
  /** Photo IDs attached as evidence (before/after). */
  photoIds: string[];
  createdAt: string;
  doneAt?: string;
  proofException?: ProofException;
  updatedAt: string;
}

export interface DailyLog {
  id: string;
  projectId: string;
  /** Local date the log covers (YYYY-MM-DD). One log per project per day. */
  logDate: string;
  /** Who was on site, what happened, weather, deliveries — the narrative. */
  body: string;
  crew?: string;
  weather?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  /** Company name printed on report letterheads. */
  company?: string;
  /** License / contact line under the letterhead. */
  letterheadLine?: string;
  onboardedAt?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  archived: 'Archived',
};
