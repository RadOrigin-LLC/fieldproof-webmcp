import { describe, expect, it } from 'vitest';
import type { CloseoutAudit, CloseoutFinding, CloseoutProposal } from './closeout.ts';
import type { DailyLog, Photo, PunchItem } from './types.ts';
import {
  buildWorkdays,
  filterWorkdays,
  workdayDateKeys,
  workdaySourceFingerprints,
} from './workdays.ts';

const PROJECT_ID = 'project-1';

function photo(id: string, capturedAt: string, changes: Partial<Photo> = {}): Photo {
  return {
    id,
    projectId: PROJECT_ID,
    capturedAt,
    sha256: id.padEnd(64, 'a').slice(0, 64),
    width: 960,
    height: 720,
    size: 100,
    caption: `Photo ${id}`,
    ...changes,
  };
}

function punch(id: string, changes: Partial<PunchItem> = {}): PunchItem {
  return {
    id,
    projectId: PROJECT_ID,
    text: `Work ${id}`,
    status: 'done',
    photoIds: [],
    createdAt: '2025-05-13T08:00:00',
    doneAt: '2025-05-13T10:00:00',
    updatedAt: '2025-05-13T10:00:00',
    ...changes,
  };
}

function log(logDate: string): DailyLog {
  return {
    id: `log-${logDate}`,
    projectId: PROJECT_ID,
    logDate,
    body: `Daily record ${logDate}`,
    createdAt: `${logDate}T17:00:00`,
    updatedAt: `${logDate}T17:00:00`,
  };
}

function audit(
  findings: CloseoutFinding[],
  workdayFingerprints: Record<string, string>,
): CloseoutAudit {
  return {
    projectId: PROJECT_ID,
    checkedAt: '2025-05-15T17:00:00',
    sourceFingerprint: 'source',
    photoFingerprint: 'photos',
    phase: findings.some((finding) => finding.severity === 'blocker')
      ? 'needs-attention'
      : findings.length
        ? 'ready-with-warnings'
        : 'ready',
    blockerCount: findings.filter((finding) => finding.severity === 'blocker').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
    candidates: {},
    counts: { workdays: 3, photos: 1, punchItems: 1, dailyLogs: 0 },
    workdayFingerprints,
  };
}

describe('workday projection', () => {
  it('unions partial record dates and places work by creation or completion time', () => {
    const photos = [
      photo('active', '2025-05-13T09:00:00'),
      photo('void-only', '2025-05-14T09:00:00', { voidedAt: '2025-05-14T10:00:00' }),
    ];
    const punchItems = [
      punch('done'),
      punch('open', {
        status: 'open',
        createdAt: '2025-05-16T08:00:00',
        doneAt: undefined,
        updatedAt: '2025-06-01T12:00:00',
      }),
    ];
    const dailyLogs = [log('2025-05-12')];

    expect(workdayDateKeys({ photos, punchItems, dailyLogs })).toEqual([
      '2025-05-12',
      '2025-05-13',
      '2025-05-14',
      '2025-05-16',
    ]);
    const workdays = buildWorkdays({
      photos,
      punchItems,
      dailyLogs,
      phase: 'not-checked',
      currentFingerprints: {},
    });
    expect(workdays.find((day) => day.dateKey === '2025-05-13')?.completedItems.map((item) => item.id)).toEqual([
      'done',
    ]);
    expect(workdays.find((day) => day.dateKey === '2025-05-16')?.openItems.map((item) => item.id)).toEqual([
      'open',
    ]);
    expect(workdays.find((day) => day.dateKey === '2025-05-14')?.representativePhotoIds).toEqual([]);
  });

  it('puts linked active proof first, removes duplicates, and keeps three thumbnails', () => {
    const photos = Array.from({ length: 100 }, (_, index) =>
      photo(`p${String(index).padStart(3, '0')}`, `2025-05-15T10:${String(index % 60).padStart(2, '0')}:00`),
    );
    const punchItems = [punch('done', { doneAt: '2025-05-15T12:00:00', photoIds: ['p050', 'p020'] })];
    const [day] = buildWorkdays({
      photos,
      punchItems,
      dailyLogs: [],
      phase: 'not-checked',
      currentFingerprints: {},
    });

    expect(day?.photos).toHaveLength(100);
    expect(day?.representativePhotoIds).toEqual(['p020', 'p050', 'p000']);
  });

  it('places findings and proposals on their workday', async () => {
    const photos = [photo('candidate', '2025-05-15T09:50:00')];
    const punchItems = [punch('target', { doneAt: '2025-05-15T10:00:00' })];
    const dailyLogs: DailyLog[] = [];
    const currentFingerprints = await workdaySourceFingerprints({ photos, punchItems, dailyLogs });
    const findings: CloseoutFinding[] = [
      {
        id: 'missing-punch-proof:target',
        code: 'missing-punch-proof',
        severity: 'blocker',
        entityType: 'punch',
        entityId: 'target',
        workdayDate: '2025-05-15',
        message: 'Proof is missing.',
        suggestedAction: 'Choose a photo.',
      },
      {
        id: 'missing-daily-log:2025-05-15',
        code: 'missing-daily-log',
        severity: 'warning',
        entityType: 'daily-log',
        entityId: '2025-05-15',
        workdayDate: '2025-05-15',
        message: 'Daily record is missing.',
        suggestedAction: 'Add it.',
      },
    ];
    const proposals: CloseoutProposal[] = [
      {
        kind: 'photo-link',
        id: 'proposal-photo',
        projectId: PROJECT_ID,
        createdAt: '2025-05-15T17:00:00',
        status: 'pending',
        selected: false,
        reason: 'Same workday.',
        punchItemId: 'target',
        photoId: 'candidate',
        expectedPunchUpdatedAt: '2025-05-13T10:00:00',
        expectedPhotoSha256: photos[0]!.sha256,
      },
      {
        kind: 'daily-log',
        id: 'proposal-log',
        projectId: PROJECT_ID,
        createdAt: '2025-05-15T17:00:00',
        status: 'pending',
        selected: false,
        reason: 'Missing record.',
        logDate: '2025-05-15',
        body: 'Draft record.',
        sourcePhotoIds: ['candidate'],
        expectedLogAbsent: true,
      },
    ];
    const [day] = buildWorkdays({
      photos,
      punchItems,
      dailyLogs,
      phase: 'needs-attention',
      audit: audit(findings, currentFingerprints),
      proposals,
      currentFingerprints,
    });

    expect(day).toMatchObject({
      dateKey: '2025-05-15',
      requiredCount: 1,
      noteCount: 1,
      status: 'needs-attention',
    });
    expect(day?.suggestedUpdates.map((proposal) => proposal.id)).toEqual([
      'proposal-photo',
      'proposal-log',
    ]);
  });

  it('marks only the changed day for a fresh check and clears its old finding counts', async () => {
    const photos = [
      photo('may-14', '2025-05-14T09:00:00'),
      photo('may-15', '2025-05-15T09:00:00'),
    ];
    const punchItems = [
      punch('may-14-work', { doneAt: '2025-05-14T10:00:00', photoIds: ['may-14'] }),
      punch('may-15-work', { doneAt: '2025-05-15T10:00:00' }),
    ];
    const dailyLogs = [log('2025-05-14')];
    const saved = await workdaySourceFingerprints({ photos, punchItems, dailyLogs });
    const findings: CloseoutFinding[] = [
      {
        id: 'missing-punch-proof:may-15-work',
        code: 'missing-punch-proof',
        severity: 'blocker',
        entityType: 'punch',
        entityId: 'may-15-work',
        workdayDate: '2025-05-15',
        message: 'Proof is missing.',
        suggestedAction: 'Choose a photo.',
      },
    ];
    const changedPhotos = photos.map((item) =>
      item.id === 'may-15' ? { ...item, caption: 'Updated caption' } : item,
    );
    const current = await workdaySourceFingerprints({
      photos: changedPhotos,
      punchItems,
      dailyLogs,
    });
    const workdays = buildWorkdays({
      photos: changedPhotos,
      punchItems,
      dailyLogs,
      phase: 'check-again',
      audit: audit(findings, saved),
      currentFingerprints: current,
    });

    expect(workdays.find((day) => day.dateKey === '2025-05-14')?.status).toBe('complete');
    expect(workdays.find((day) => day.dateKey === '2025-05-15')).toMatchObject({
      status: 'check-again',
      findings: [],
      requiredCount: 0,
      noteCount: 0,
    });
    expect(filterWorkdays(workdays, 'needs-attention').map((day) => day.dateKey)).toEqual([
      '2025-05-15',
    ]);
  });

  it('creates stable fingerprints regardless of input order', async () => {
    const photos = [photo('a', '2025-05-15T09:00:00'), photo('b', '2025-05-15T10:00:00')];
    const punchItems = [punch('a', { doneAt: '2025-05-15T11:00:00' })];
    const dailyLogs = [log('2025-05-15')];

    await expect(workdaySourceFingerprints({ photos, punchItems, dailyLogs })).resolves.toEqual(
      await workdaySourceFingerprints({
        photos: [...photos].reverse(),
        punchItems: [...punchItems].reverse(),
        dailyLogs: [...dailyLogs].reverse(),
      }),
    );
  });
});
