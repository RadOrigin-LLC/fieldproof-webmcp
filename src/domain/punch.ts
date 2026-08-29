/**
 * Punch list: the open/done loop that closes out a job. Items carry photo
 * evidence (before/after). Done items keep their history — reopening is a
 * new state change, not an erasure.
 */
import { uuidv7 } from './ids.ts';
import type { PunchItem } from './types.ts';

export function createPunchItem(projectId: string, text: string, now: string = new Date().toISOString()): PunchItem {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Punch item needs text');
  return {
    id: uuidv7(),
    projectId,
    text: trimmed,
    status: 'open',
    photoIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function markDone(item: PunchItem, now: string = new Date().toISOString()): PunchItem {
  return { ...item, status: 'done', doneAt: now, updatedAt: now };
}

export function reopen(item: PunchItem, now: string = new Date().toISOString()): PunchItem {
  return {
    ...item,
    status: 'open',
    doneAt: undefined,
    proofException: undefined,
    updatedAt: now,
  };
}

export function attachPhoto(item: PunchItem, photoId: string, now: string = new Date().toISOString()): PunchItem {
  const alreadyLinked = item.photoIds.includes(photoId);
  if (alreadyLinked && !item.proofException) return item;
  return {
    ...item,
    photoIds: alreadyLinked ? item.photoIds : [...item.photoIds, photoId],
    proofException: undefined,
    updatedAt: now,
  };
}

export function detachPhoto(item: PunchItem, photoId: string, now: string = new Date().toISOString()): PunchItem {
  if (!item.photoIds.includes(photoId)) return item;
  return {
    ...item,
    photoIds: item.photoIds.filter((id) => id !== photoId),
    updatedAt: now,
  };
}

export function setProofException(
  item: PunchItem,
  reason: string,
  now: string = new Date().toISOString(),
): PunchItem {
  if (item.status !== 'done') throw new Error('Only completed punch items can use a proof exception');
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('Proof exception needs a reason');
  return {
    ...item,
    proofException: { reason: trimmed, recordedAt: now },
    updatedAt: now,
  };
}

export function clearProofException(
  item: PunchItem,
  now: string = new Date().toISOString(),
): PunchItem {
  if (!item.proofException) return item;
  return { ...item, proofException: undefined, updatedAt: now };
}

/** Open first (oldest first within open), then done (newest done first). */
export function sortPunch(items: PunchItem[]): PunchItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'open') return a.createdAt.localeCompare(b.createdAt);
    return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
  });
}

export function punchProgress(items: PunchItem[]): { open: number; done: number; total: number } {
  const done = items.filter((i) => i.status === 'done').length;
  return { open: items.length - done, done, total: items.length };
}
