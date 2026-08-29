import { describe, expect, it } from 'vitest';
import {
  auditCloseout,
  closeoutSourceFingerprint,
  effectiveCloseoutPhase,
  photoSourceFingerprint,
  type SealStatus,
  type SealVerification,
} from './closeout.ts';
import type { DailyLog, Photo, Project, PunchItem } from './types.ts';

const CHECKED_AT = '2026-08-26T16:00:00.000Z';

const project: Project = {
  id: 'project-1',
  name: 'Maple Street Kitchen',
  status: 'active',
  createdAt: '2026-08-20T08:00:00.000Z',
  updatedAt: '2026-08-26T15:00:00.000Z',
};

function photo(id: string, capturedAt: string, changes: Partial<Photo> = {}): Photo {
  return {
    id,
    projectId: project.id,
    capturedAt,
    sha256: id.padEnd(64, 'a').slice(0, 64),
    width: 1200,
    height: 900,
    size: 1024,
    lat: 45.2,
    lon: -122.7,
    caption: `Photo ${id}`,
    ...changes,
  };
}

function punch(id: string, changes: Partial<PunchItem> = {}): PunchItem {
  return {
    id,
    projectId: project.id,
    text: `Punch ${id}`,
    status: 'done',
    photoIds: [],
    createdAt: '2026-08-24T10:00:00.000Z',
    doneAt: '2026-08-25T12:00:00.000Z',
    updatedAt: '2026-08-25T12:00:00.000Z',
    ...changes,
  };
}

function log(logDate: string): DailyLog {
  return {
    id: `log-${logDate}`,
    projectId: project.id,
    logDate,
    body: 'Completed finish work.',
    createdAt: `${logDate}T17:00:00.000Z`,
    updatedAt: `${logDate}T17:00:00.000Z`,
  };
}

async function verification(
  photos: Photo[],
  statuses: Record<string, SealStatus> = {},
): Promise<SealVerification> {
  const results = photos.map((item) => ({
    photoId: item.id,
    status: item.voidedAt ? ('excluded' as const) : (statuses[item.id] ?? ('pass' as const)),
  }));
  return {
    projectId: project.id,
    checkedAt: CHECKED_AT,
    photoFingerprint: await photoSourceFingerprint(photos),
    results,
    summary: {
      pass: results.filter((item) => item.status === 'pass').length,
      fail: results.filter((item) => item.status === 'fail').length,
      unreadable: results.filter((item) => item.status === 'unreadable').length,
      excluded: results.filter((item) => item.status === 'excluded').length,
    },
  };
}

async function audit(input: {
  photos?: Photo[];
  punchItems?: PunchItem[];
  dailyLogs?: DailyLog[];
  verification?: SealVerification;
}) {
  const photos = input.photos ?? [];
  return auditCloseout({
    project,
    photos,
    punchItems: input.punchItems ?? [],
    dailyLogs: input.dailyLogs ?? [],
    verification: input.verification ?? (await verification(photos)),
    checkedAt: CHECKED_AT,
  });
}

describe('closeout rules', () => {
  it('blocks an empty punch record', async () => {
    const result = await audit({});

    expect(result.phase).toBe('needs-attention');
    expect(result.findings.map((item) => item.code)).toContain('empty-project');
  });

  it('blocks open punch work', async () => {
    const result = await audit({ punchItems: [punch('open-1', { status: 'open', doneAt: undefined })] });

    expect(result.phase).toBe('needs-attention');
    expect(result.findings.map((item) => item.code)).toContain('open-punch');
  });

  it('blocks missing proof and ranks safe unlinked candidates by time then id', async () => {
    const photos = [
      photo('candidate-b', '2026-08-25T12:05:00.000Z'),
      photo('candidate-a', '2026-08-25T11:55:00.000Z'),
      photo('far-away', '2026-08-24T08:00:00.000Z'),
      photo('voided', '2026-08-25T12:00:00.000Z', { voidedAt: CHECKED_AT }),
    ];
    const result = await audit({ photos, punchItems: [punch('missing')] });

    expect(result.findings.map((item) => item.code)).toContain('missing-punch-proof');
    expect(result.candidates.missing?.map((item) => item.photoId)).toEqual([
      'candidate-a',
      'candidate-b',
      'far-away',
    ]);
  });

  it('reports missing, voided, failed, and unreadable evidence', async () => {
    const photos = [
      photo('voided', '2026-08-25T12:00:00.000Z', { voidedAt: CHECKED_AT }),
      photo('failed', '2026-08-25T12:00:00.000Z'),
      photo('unreadable', '2026-08-25T12:00:00.000Z'),
    ];
    const result = await audit({
      photos,
      punchItems: [
        punch('missing-row', { photoIds: ['not-found'] }),
        punch('voided-row', { photoIds: ['voided'] }),
        punch('failed-row', { photoIds: ['failed'] }),
        punch('unreadable-row', { photoIds: ['unreadable'] }),
      ],
      verification: await verification(photos, { failed: 'fail', unreadable: 'unreadable' }),
    });

    const codes = new Set(result.findings.map((item) => item.code));
    for (const code of ['proof-photo-missing', 'proof-photo-voided', 'seal-failed', 'photo-unreadable']) {
      expect(codes).toContain(code);
    }
    expect(result.blockerCount).toBeGreaterThanOrEqual(4);
  });

  it('turns a human exception into a warning instead of missing proof', async () => {
    const result = await audit({
      punchItems: [
        punch('excepted', {
          proofException: {
            reason: 'Existing finish was outside the work scope.',
            recordedAt: CHECKED_AT,
          },
        }),
      ],
    });

    expect(result.phase).toBe('ready-with-warnings');
    expect(result.findings.map((item) => item.code)).toContain('proof-exception');
    expect(result.findings.map((item) => item.code)).not.toContain('missing-punch-proof');
  });

  it('warns about missing daily logs, proof captions, and location', async () => {
    const proof = photo('proof', '2026-08-25T12:00:00.000Z', {
      caption: '   ',
      lat: undefined,
      lon: undefined,
    });
    const result = await audit({
      photos: [proof],
      punchItems: [punch('done', { photoIds: [proof.id] })],
    });

    const codes = result.findings.map((item) => item.code);
    expect(codes).toContain('missing-daily-log');
    expect(codes).toContain('missing-proof-caption');
    expect(codes).toContain('missing-location');
    expect(result.phase).toBe('ready-with-warnings');
  });

  it('returns ready for a complete current record', async () => {
    const proof = photo('proof', '2026-08-25T12:00:00.000Z');
    const result = await audit({
      photos: [proof],
      punchItems: [punch('done', { photoIds: [proof.id] })],
      dailyLogs: [log('2026-08-25')],
    });

    expect(result.phase).toBe('ready');
    expect(result.blockerCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.counts).toEqual({ workdays: 1, photos: 1, punchItems: 1, dailyLogs: 1 });
    expect(result.workdayFingerprints).toHaveProperty('2026-08-25');
  });

  it('requires a seal check for the current photo set', async () => {
    const proof = photo('proof', '2026-08-25T12:00:00.000Z');
    const stale = await verification([]);
    const result = await audit({
      photos: [proof],
      punchItems: [punch('done', { photoIds: [proof.id] })],
      dailyLogs: [log('2026-08-25')],
      verification: stale,
    });

    expect(result.phase).toBe('needs-attention');
    expect(result.findings.map((item) => item.code)).toContain('seal-check-required');
  });
});

describe('workday context', () => {
  it('dates work findings and adds a daily-record note for a completed work-only day', async () => {
    const result = await audit({
      punchItems: [punch('work-only', { doneAt: '2026-08-25T12:00:00.000Z' })],
    });

    expect(result.counts.workdays).toBe(1);
    expect(result.findings.find((item) => item.code === 'missing-punch-proof')?.workdayDate).toBe(
      '2026-08-25',
    );
    expect(result.findings.find((item) => item.code === 'missing-daily-log')).toMatchObject({
      entityId: '2026-08-25',
      workdayDate: '2026-08-25',
    });
  });

  it('does not add a daily-record note for an open-only day', async () => {
    const result = await audit({
      punchItems: [punch('open-only', { status: 'open', doneAt: undefined })],
    });

    expect(result.findings.map((item) => item.code)).not.toContain('missing-daily-log');
  });
});

describe('fingerprints and invalidation', () => {
  it('is stable across input order', async () => {
    const photos = [photo('b', '2026-08-25T12:00:00.000Z'), photo('a', '2026-08-25T11:00:00.000Z')];
    const punchItems = [punch('b'), punch('a')];
    const dailyLogs = [log('2026-08-25'), log('2026-08-24')];

    const first = await closeoutSourceFingerprint({ project, photos, punchItems, dailyLogs });
    const second = await closeoutSourceFingerprint({
      project,
      photos: [...photos].reverse(),
      punchItems: [...punchItems].reverse(),
      dailyLogs: [...dailyLogs].reverse(),
    });

    expect(first).toBe(second);
  });

  it('returns check-again after a relevant source change', async () => {
    const proof = photo('proof', '2026-08-25T12:00:00.000Z');
    const result = await audit({
      photos: [proof],
      punchItems: [punch('done', { photoIds: [proof.id] })],
      dailyLogs: [log('2026-08-25')],
    });
    const changedFingerprint = await closeoutSourceFingerprint({
      project,
      photos: [{ ...proof, caption: 'Changed after the check' }],
      punchItems: [punch('done', { photoIds: [proof.id] })],
      dailyLogs: [log('2026-08-25')],
    });

    expect(effectiveCloseoutPhase(result, changedFingerprint)).toBe('check-again');
    expect(effectiveCloseoutPhase(result, result.sourceFingerprint)).toBe('ready');
  });
});
