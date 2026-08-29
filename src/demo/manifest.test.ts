import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  DEMO_DAILY_LOGS,
  DEMO_MARKER,
  DEMO_PHOTOS,
  DEMO_PROJECT,
  DEMO_WORK_ITEMS,
} from './manifest.ts';

describe('Maple Street v2 manifest', () => {
  it('defines the exact repeatable three-day starting record', () => {
    expect(DEMO_PROJECT.id).toBe('maple-street-kitchen-demo-2025');
    expect(DEMO_PROJECT.notes).toContain('fieldproof:synthetic-workday-ledger-demo:v2');
    expect(DEMO_MARKER).toBe('fieldproof:synthetic-workday-ledger-demo:v2');
    expect(DEMO_PHOTOS.map((photo) => photo.id)).toEqual(
      Array.from({ length: 18 }, (_, index) => `msk25p${String(index + 1).padStart(2, '0')}`),
    );
    expect(DEMO_WORK_ITEMS.map((item) => item.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `msk25w${String(index + 1).padStart(2, '0')}`),
    );
    expect(DEMO_DAILY_LOGS.map((log) => log.logDate)).toEqual(['2025-05-13', '2025-05-14']);

    const photosByDate = Object.groupBy(DEMO_PHOTOS, (photo) => photo.capturedAt.slice(0, 10));
    expect(
      Object.fromEntries(
        Object.entries(photosByDate).map(([date, photos]) => [date, photos?.length]),
      ),
    ).toEqual({
      '2025-05-13': 6,
      '2025-05-14': 6,
      '2025-05-15': 6,
    });
    expect(DEMO_WORK_ITEMS.filter((item) => item.photoIds.length > 0)).toHaveLength(8);
    expect(
      DEMO_WORK_ITEMS.filter((item) => item.photoIds.length === 0).map((item) => item.id),
    ).toEqual(['msk25w08', 'msk25w10']);
    expect(new Set(DEMO_PHOTOS.map((photo) => photo.assetPath)).size).toBe(18);
    expect(new Set(DEMO_PHOTOS.map((photo) => photo.caption)).size).toBe(18);
  });

  it('ships 18 distinct JPEG files at the fixed size', async () => {
    const hashes = new Set<string>();

    for (const photo of DEMO_PHOTOS) {
      const file = path.join(process.cwd(), 'public', photo.assetPath.slice(1));
      const bytes = await readFile(file);
      const metadata = await sharp(bytes).metadata();
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
      expect(metadata.format).toBe('jpeg');
      expect(metadata.width).toBe(960);
      expect(metadata.height).toBe(720);
      expect(bytes.byteLength).toBeLessThan(4 * 1024 * 1024);
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
    }

    expect(hashes.size).toBe(18);
  });
});
