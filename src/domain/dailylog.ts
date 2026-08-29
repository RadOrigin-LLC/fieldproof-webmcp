/**
 * Daily logs: one per project per local day. The narrative half of the
 * record — photos prove, logs explain.
 */
import { uuidv7 } from './ids.ts';
import type { DailyLog } from './types.ts';

export function createDailyLog(
  projectId: string,
  logDate: string,
  body: string,
  extra: { crew?: string; weather?: string } = {},
  now: string = new Date().toISOString(),
): DailyLog {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) throw new Error('Log needs a date');
  if (!body.trim()) throw new Error('Log needs a note');
  return {
    id: uuidv7(),
    projectId,
    logDate,
    body: body.trim(),
    crew: extra.crew?.trim() || undefined,
    weather: extra.weather?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateLogBody(
  log: DailyLog,
  body: string,
  extra: { crew?: string; weather?: string } = {},
  now: string = new Date().toISOString(),
): DailyLog {
  if (!body.trim()) throw new Error('Log needs a note');
  return {
    ...log,
    body: body.trim(),
    crew: extra.crew?.trim() || log.crew,
    weather: extra.weather?.trim() || log.weather,
    updatedAt: now,
  };
}
