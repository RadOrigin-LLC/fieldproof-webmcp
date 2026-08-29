import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { buildExportZip, exportFileName, photosCsv, toCsv, type ExportPayload } from './export.ts';
import { mergeRows, parseImportZip } from './import.ts';
import { uuidv7 } from './ids.ts';
import { DEFAULT_SETTINGS } from './types.ts';

function payload(): ExportPayload {
  const projectId = uuidv7();
  return {
    projects: [
      {
        id: projectId,
        name: 'Maple St Remodel',
        client: 'The Harpers',
        startDate: '2026-07-01',
        status: 'active',
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      },
    ],
    photos: [
      {
        id: 'photo-1',
        projectId,
        capturedAt: '2026-07-11T15:30:00',
        sha256: 'ab'.repeat(32),
        width: 4032,
        height: 3024,
        size: 9,
        lat: 45.5,
        lon: -122.6,
        caption: 'Rough-in, hallway bath',
      },
    ],
    punchItems: [],
    dailyLogs: [],
    settings: DEFAULT_SETTINGS,
  };
}

describe('toCsv / photosCsv', () => {
  it('escapes commas and quotes', () => {
    const csv = toCsv([{ a: 'x,y', b: 'he said "hi"' }]);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"he said ""hi"""');
  });

  it('names the project and carries the seal', () => {
    const csv = photosCsv(payload());
    expect(csv).toContain('Maple St Remodel');
    expect(csv).toContain('ab'.repeat(32));
  });
});

describe('export → import round trip', () => {
  it('carries photo bytes byte-for-byte so seals still verify', () => {
    const bytes = strToU8('\xff\xd8fake-jpeg-bytes');
    const zip = buildExportZip(payload(), [{ id: 'photo-1', bytes }], new Date('2026-07-11T12:00:00Z'));
    const parsed = parseImportZip(zip);
    expect(parsed.manifest.format).toBe('fieldproof-export');
    expect(parsed.manifest.counts.photos).toBe(1);
    expect(parsed.payload.projects[0]!.startDate).toBe('2026-07-01');
    expect(parsed.payload.photos[0]!.sha256).toBe('ab'.repeat(32));
    expect([...parsed.blobs.get('photo-1')!]).toEqual([...bytes]);
  });

  it('accepts a backup created before project start dates were added', () => {
    const legacy = payload();
    delete legacy.projects[0]!.startDate;

    const zip = buildExportZip(legacy, [], new Date('2026-07-11T12:00:00Z'));
    const parsed = parseImportZip(zip);

    expect(parsed.payload.projects[0]!.name).toBe('Maple St Remodel');
    expect(parsed.payload.projects[0]!.startDate).toBeUndefined();
  });

  it('rejects a backup with an invalid project start date', () => {
    const invalid = payload();
    invalid.projects[0]!.startDate = '2026-02-30';
    const zip = buildExportZip(invalid, [], new Date('2026-07-11T12:00:00Z'));

    expect(() => parseImportZip(zip)).toThrow(/start date/i);
  });

  it('rejects junk that is not a backup', () => {
    expect(() => parseImportZip(strToU8('junk'))).toThrow();
  });
});

describe('mergeRows', () => {
  it('adds new rows, keeps newer, ignores stale', () => {
    const cur = { id: '1', updatedAt: '2026-06-01T00:00:00Z', name: 'current' };
    const stale = { id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'stale' };
    const fresh = { id: '2', updatedAt: '2026-07-01T00:00:00Z', name: 'fresh' };
    const { merged, added, updated } = mergeRows([cur], [stale, fresh]);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(merged.find((r) => r.id === '1')).toMatchObject({ name: 'current' });
  });
});

describe('exportFileName', () => {
  it('stamps the local date', () => {
    expect(exportFileName(new Date(2026, 6, 11))).toBe('fieldproof-backup-2026-07-11.zip');
  });
});
