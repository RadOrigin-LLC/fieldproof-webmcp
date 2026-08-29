import { describe, expect, it } from 'vitest';
import {
  attachPhoto,
  clearProofException,
  createPunchItem,
  detachPhoto,
  markDone,
  punchProgress,
  reopen,
  setProofException,
  sortPunch,
} from './punch.ts';

const NOW = '2026-07-11T18:00:00.000Z';

describe('createPunchItem', () => {
  it('trims text and starts open', () => {
    const item = createPunchItem('proj-1', '  Touch up paint hallway  ', NOW);
    expect(item.text).toBe('Touch up paint hallway');
    expect(item.status).toBe('open');
    expect(item.photoIds).toEqual([]);
  });

  it('rejects empty text', () => {
    expect(() => createPunchItem('proj-1', '   ')).toThrow();
  });
});

describe('done / reopen', () => {
  it('marks done with a timestamp and reopens cleanly', () => {
    const item = createPunchItem('proj-1', 'Fix outlet cover', NOW);
    const done = markDone(item, '2026-07-12T10:00:00Z');
    expect(done.status).toBe('done');
    expect(done.doneAt).toBe('2026-07-12T10:00:00Z');

    const back = reopen(done, '2026-07-13T08:00:00Z');
    expect(back.status).toBe('open');
    expect(back.doneAt).toBeUndefined();
    expect(back.proofException).toBeUndefined();
  });
});

describe('attachPhoto', () => {
  it('adds once, ignores duplicates', () => {
    let item = createPunchItem('proj-1', 'Grout shower niche', NOW);
    item = attachPhoto(item, 'photo-1', NOW);
    item = attachPhoto(item, 'photo-1', NOW);
    item = attachPhoto(item, 'photo-2', NOW);
    expect(item.photoIds).toEqual(['photo-1', 'photo-2']);
  });

  it('clears a proof exception even when the photo is already linked', () => {
    const done = markDone(createPunchItem('proj-1', 'Grout shower niche', NOW), NOW);
    const linked = attachPhoto(done, 'photo-1', NOW);
    const excepted = setProofException(linked, 'Client declined another photo.', NOW);

    const repaired = attachPhoto(excepted, 'photo-1', '2026-07-12T12:00:00Z');

    expect(repaired.photoIds).toEqual(['photo-1']);
    expect(repaired.proofException).toBeUndefined();
    expect(repaired.updatedAt).toBe('2026-07-12T12:00:00Z');
  });
});

describe('detachPhoto', () => {
  it('removes only the selected association', () => {
    let item = createPunchItem('proj-1', 'Finish trim', NOW);
    item = attachPhoto(item, 'photo-1', NOW);
    item = attachPhoto(item, 'photo-2', NOW);

    const detached = detachPhoto(item, 'photo-1', '2026-07-12T12:00:00Z');

    expect(detached.photoIds).toEqual(['photo-2']);
    expect(detached.updatedAt).toBe('2026-07-12T12:00:00Z');
    expect(detachPhoto(detached, 'missing', NOW)).toBe(detached);
  });
});

describe('proof exceptions', () => {
  it('requires a completed item and a written reason', () => {
    const open = createPunchItem('proj-1', 'Finish trim', NOW);

    expect(() => setProofException(open, 'Client declined a photo.', NOW)).toThrow();

    const done = markDone(open, NOW);
    expect(() => setProofException(done, '   ', NOW)).toThrow();
  });

  it('trims, records, and clears the contractor reason', () => {
    const done = markDone(createPunchItem('proj-1', 'Finish trim', NOW), NOW);
    const excepted = setProofException(
      done,
      '  Existing wall was outside the work scope.  ',
      '2026-07-12T12:00:00Z',
    );

    expect(excepted.proofException).toEqual({
      reason: 'Existing wall was outside the work scope.',
      recordedAt: '2026-07-12T12:00:00Z',
    });

    const cleared = clearProofException(excepted, '2026-07-13T12:00:00Z');
    expect(cleared.proofException).toBeUndefined();
    expect(cleared.updatedAt).toBe('2026-07-13T12:00:00Z');
  });
});

describe('sortPunch / punchProgress', () => {
  it('puts open items first (oldest first), done newest-done first', () => {
    const a = createPunchItem('p', 'A', '2026-07-01T00:00:00Z');
    const b = createPunchItem('p', 'B', '2026-07-02T00:00:00Z');
    const c = markDone(createPunchItem('p', 'C', '2026-07-03T00:00:00Z'), '2026-07-05T00:00:00Z');
    const d = markDone(createPunchItem('p', 'D', '2026-07-04T00:00:00Z'), '2026-07-06T00:00:00Z');
    const sorted = sortPunch([d, c, b, a]);
    expect(sorted.map((i) => i.text)).toEqual(['A', 'B', 'D', 'C']);
    expect(punchProgress(sorted)).toEqual({ open: 2, done: 2, total: 4 });
  });
});
