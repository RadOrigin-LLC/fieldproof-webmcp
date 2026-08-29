import { describe, expect, it } from 'vitest';
import { uuidv7 } from './ids.ts';
import {
  activityDates,
  activePhotos,
  buildDayReport,
  buildHandoffPacket,
  localDateOf,
} from './reports.ts';
import type { CloseoutFinding, CloseoutProposal, SealResult } from './closeout.ts';
import type { DailyLog, Photo, Project, PunchItem } from './types.ts';

const project: Project = {
  id: 'proj-1',
  name: 'Maple St Remodel',
  status: 'active',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
};

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: uuidv7(),
    projectId: 'proj-1',
    capturedAt: '2026-07-11T15:30:00',
    sha256: 'a'.repeat(64),
    width: 4032,
    height: 3024,
    size: 2_000_000,
    ...overrides,
  };
}

function log(dateStr: string, overrides: Partial<DailyLog> = {}): DailyLog {
  return {
    id: uuidv7(),
    projectId: 'proj-1',
    logDate: dateStr,
    body: 'Framed the closet.',
    createdAt: `${dateStr}T20:00:00`,
    updatedAt: `${dateStr}T20:00:00`,
    ...overrides,
  };
}

function punch(id: string, overrides: Partial<PunchItem> = {}): PunchItem {
  return {
    id,
    projectId: project.id,
    text: `Completed work ${id}`,
    status: 'done',
    photoIds: [],
    createdAt: '2026-07-11T08:00:00',
    doneAt: '2026-07-11T16:00:00',
    updatedAt: '2026-07-11T16:00:00',
    ...overrides,
  };
}

type PacketReviewInput = Parameters<typeof buildHandoffPacket>[0]['review'];

function packetReview(overrides: Partial<PacketReviewInput> = {}): PacketReviewInput {
  return {
    phase: 'ready',
    current: true,
    lastCompletedAt: '2026-07-11T18:00:00',
    blockerCount: 0,
    warningCount: 0,
    findings: [],
    sealResults: [],
    ...overrides,
  };
}

describe('activePhotos', () => {
  it('drops voided and sorts by capture time', () => {
    const p1 = photo({ capturedAt: '2026-07-11T09:00:00' });
    const p2 = photo({ capturedAt: '2026-07-11T08:00:00' });
    const gone = photo({ voidedAt: '2026-07-11T10:00:00Z' });
    const active = activePhotos([p1, gone, p2]);
    expect(active).toHaveLength(2);
    expect(active[0]!.capturedAt < active[1]!.capturedAt).toBe(true);
  });
});

describe('buildDayReport', () => {
  it('collects the day: photos, log, punch movement', () => {
    const dayPhoto = photo({ capturedAt: '2026-07-11T15:30:00' });
    const otherDay = photo({ capturedAt: '2026-07-10T15:30:00' });
    const punch: PunchItem[] = [
      {
        id: uuidv7(),
        projectId: 'proj-1',
        text: 'Closed today',
        status: 'done',
        photoIds: [],
        createdAt: '2026-07-09T00:00:00',
        doneAt: '2026-07-11T16:00:00',
        updatedAt: '2026-07-11T16:00:00',
      },
      {
        id: uuidv7(),
        projectId: 'proj-1',
        text: 'Opened today',
        status: 'open',
        photoIds: [],
        createdAt: '2026-07-11T09:00:00',
        updatedAt: '2026-07-11T09:00:00',
      },
    ];
    const report = buildDayReport(project, '2026-07-11', [dayPhoto, otherDay], [log('2026-07-11')], punch);
    expect(report.photos).toHaveLength(1);
    expect(report.log?.body).toContain('Framed');
    expect(report.punchDone).toHaveLength(1);
    expect(report.punchOpened).toHaveLength(1);
  });
});

describe('buildHandoffPacket', () => {
  it('groups approved daily records and completed work into oldest-first workdays', () => {
    const earlyPhoto = photo({ id: 'early-photo', capturedAt: '2026-07-10T09:00:00' });
    const latePhoto = photo({ id: 'late-photo', capturedAt: '2026-07-11T09:00:00' });
    const earlyLog = log('2026-07-10', { id: 'early-log', body: 'Removed old cabinets.' });
    const lateLog = log('2026-07-11', { id: 'late-log', body: 'Installed new cabinets.' });
    const earlyWork = punch('early-work', {
      text: 'Remove old cabinets',
      createdAt: '2026-07-10T08:00:00',
      doneAt: '2026-07-10T15:00:00',
      updatedAt: '2026-07-10T15:00:00',
    });
    const lateWork = punch('late-work', { text: 'Install new cabinets' });
    const openWork = punch('open-work', {
      text: 'Touch up paint',
      status: 'open',
      doneAt: undefined,
    });
    const sealResults: SealResult[] = [
      { photoId: earlyPhoto.id, status: 'pass' },
      { photoId: latePhoto.id, status: 'pass' },
    ];

    const packet = buildHandoffPacket({
      project,
      photos: [latePhoto, earlyPhoto],
      dailyLogs: [lateLog, earlyLog],
      punchItems: [lateWork, openWork, earlyWork],
      review: packetReview({ sealResults }),
    });

    expect(packet.workdays.map((workday) => workday.dateKey)).toEqual([
      '2026-07-10',
      '2026-07-11',
    ]);
    expect(packet.workdays[0]).toMatchObject({
      dailyRecord: earlyLog,
      workItems: [{ item: earlyWork }],
    });
    expect(packet.workdays[1]).toMatchObject({
      dailyRecord: lateLog,
      workItems: [{ item: lateWork }],
    });
    expect(packet.workdays.flatMap((workday) => workday.workItems.map(({ item }) => item.id))).not.toContain(
      openWork.id,
    );
  });

  it('shows every valid proof photo and at most three other passing same-day photos', () => {
    const proofPhotos = Array.from({ length: 4 }, (_, index) =>
      photo({
        id: `proof-${index + 1}`,
        capturedAt: `2026-07-11T08:0${index}:00`,
      }),
    );
    const supportingPhotos = Array.from({ length: 5 }, (_, index) =>
      photo({
        id: `support-${index + 1}`,
        capturedAt: `2026-07-11T09:0${index}:00`,
      }),
    );
    const otherDay = photo({ id: 'other-day', capturedAt: '2026-07-10T07:00:00' });
    const failed = photo({ id: 'failed-proof', capturedAt: '2026-07-11T10:00:00' });
    const unreadable = photo({ id: 'unreadable-proof', capturedAt: '2026-07-11T10:01:00' });
    const voided = photo({
      id: 'voided-proof',
      capturedAt: '2026-07-11T10:02:00',
      voidedAt: '2026-07-11T10:03:00',
      voidReason: 'Duplicate capture',
    });
    const missingPhotoId = 'missing-proof';
    const completed = punch('proof-work', {
      photoIds: [
        ...proofPhotos.map(({ id }) => id),
        failed.id,
        unreadable.id,
        voided.id,
        missingPhotoId,
      ],
    });
    const sealResults: SealResult[] = [
      ...proofPhotos.map(({ id }) => ({ photoId: id, status: 'pass' as const })),
      ...supportingPhotos.map(({ id }) => ({ photoId: id, status: 'pass' as const })),
      { photoId: otherDay.id, status: 'pass' },
      { photoId: failed.id, status: 'fail' },
      { photoId: unreadable.id, status: 'unreadable' },
      { photoId: voided.id, status: 'excluded' },
    ];

    const packet = buildHandoffPacket({
      project,
      photos: [
        supportingPhotos[4]!,
        failed,
        otherDay,
        ...proofPhotos,
        voided,
        ...supportingPhotos.slice(0, 4),
        unreadable,
      ],
      dailyLogs: [],
      punchItems: [completed],
      review: packetReview({ sealResults }),
    });
    const workday = packet.workdays.find(({ dateKey }) => dateKey === '2026-07-11')!;
    const [workItem] = workday.workItems;
    const shownPhotoIds = [
      ...workItem!.validProofPhotos.map(({ id }) => id),
      ...workday.supportingPhotos.map(({ id }) => id),
    ];

    expect(workItem!.validProofPhotos.map(({ id }) => id)).toEqual(
      proofPhotos.map(({ id }) => id),
    );
    expect(workItem!.unusablePhotoIds).toHaveLength(4);
    expect(workItem!.unusablePhotoIds).toEqual(
      expect.arrayContaining([failed.id, unreadable.id, voided.id, missingPhotoId]),
    );
    expect(workday.supportingPhotos.map(({ id }) => id)).toEqual([
      'support-1',
      'support-2',
      'support-3',
    ]);
    expect(shownPhotoIds).not.toContain(otherDay.id);
    for (const invalidId of [failed.id, unreadable.id, voided.id, missingPhotoId]) {
      expect(shownPhotoIds).not.toContain(invalidId);
    }
  });

  it('keeps a human proof exception and separates current day findings from project findings', () => {
    const excepted = punch('excepted-work', {
      text: 'Inspect concealed blocking',
      proofException: {
        reason: 'The wall was closed before a final photo was possible.',
        recordedAt: '2026-07-11T17:00:00',
      },
    });
    const dayFinding: CloseoutFinding = {
      id: 'proof-exception:excepted-work',
      code: 'proof-exception',
      severity: 'warning',
      entityType: 'punch',
      entityId: excepted.id,
      workdayDate: '2026-07-11',
      message: 'No photo was required for this work.',
      suggestedAction: 'Keep the contractor reason in the packet.',
    };
    const projectFinding: CloseoutFinding = {
      id: 'open-punch:project',
      code: 'open-punch',
      severity: 'blocker',
      entityType: 'project',
      message: 'The project has unfinished work.',
      suggestedAction: 'Complete or remove the open work.',
    };

    const packet = buildHandoffPacket({
      project,
      photos: [],
      dailyLogs: [log('2026-07-11')],
      punchItems: [excepted],
      review: packetReview({
        phase: 'needs-attention',
        blockerCount: 1,
        warningCount: 1,
        findings: [projectFinding, dayFinding],
      }),
    });

    expect(packet.workdays[0]!.workItems[0]!.item.proofException).toEqual({
      reason: 'The wall was closed before a final photo was possible.',
      recordedAt: '2026-07-11T17:00:00',
    });
    expect(packet.workdays[0]!.findings).toEqual([dayFinding]);
    expect(packet.projectFindings).toEqual([projectFinding]);
    expect(packet.review).toEqual({
      phase: 'needs-attention',
      current: true,
      lastCompletedAt: '2026-07-11T18:00:00',
      blockerCount: 1,
      warningCount: 1,
    });
  });

  it('puts all 18 active sample-like photos and their technical facts in the appendix', () => {
    const photos = Array.from({ length: 18 }, (_, index) => {
      const day = 10 + Math.floor(index / 6);
      const sequence = index + 1;
      return photo({
        id: `sample-${String(sequence).padStart(2, '0')}`,
        capturedAt: `2026-07-${day}T${String(8 + (index % 6)).padStart(2, '0')}:00:00`,
        sha256: sequence.toString(16).padStart(64, '0'),
        width: 960,
        height: 720,
        size: 100_000 + sequence,
        lat: 45.5 + sequence * 0.000001,
        lon: -122.6 - sequence * 0.000001,
        accuracy: 12,
      });
    });
    const sealResults: SealResult[] = photos.map(({ id }, index) => ({
      photoId: id,
      status: index === 16 ? 'fail' : index === 17 ? 'unreadable' : 'pass',
    }));

    const packet = buildHandoffPacket({
      project,
      photos: [...photos].reverse(),
      dailyLogs: [],
      punchItems: [],
      review: packetReview({ sealResults }),
    });

    expect(packet.appendix).toHaveLength(18);
    expect(packet.appendix.map(({ photo: item }) => item.id)).toEqual(
      photos.map(({ id }) => id),
    );
    expect(packet.appendix[0]).toEqual({ photo: photos[0], checkStatus: 'pass' });
    expect(packet.appendix[16]!.checkStatus).toBe('fail');
    expect(packet.appendix[17]!.checkStatus).toBe('unreadable');
    expect(packet.appendix[17]!.photo).toMatchObject({
      id: 'sample-18',
      capturedAt: '2026-07-12T13:00:00',
      sha256: '12'.padStart(64, '0'),
      width: 960,
      height: 720,
      size: 100_018,
      lat: 45.500018,
      accuracy: 12,
    });
    expect(packet.appendix[17]!.photo.lon).toBeCloseTo(-122.600018);
  });

  it('preserves prior review counts and time when the current record needs another check', () => {
    const packet = buildHandoffPacket({
      project,
      photos: [],
      dailyLogs: [],
      punchItems: [],
      review: packetReview({
        phase: 'check-again',
        current: false,
        lastCompletedAt: '2026-07-10T18:30:00',
        blockerCount: 2,
        warningCount: 3,
      }),
    });

    expect(packet.review).toEqual({
      phase: 'check-again',
      current: false,
      lastCompletedAt: '2026-07-10T18:30:00',
      blockerCount: 2,
      warningCount: 3,
    });
  });

  it('has no session proposal input, so pending, rejected, and dismissed updates cannot enter', () => {
    const sessionProposals: CloseoutProposal[] = [
      {
        id: 'pending-proposal',
        projectId: project.id,
        kind: 'daily-log',
        createdAt: '2026-07-11T18:01:00',
        status: 'pending',
        selected: true,
        dismissed: false,
        reason: 'Pending proposal must stay out.',
        logDate: '2026-07-11',
        body: 'PENDING SESSION BODY',
        sourcePhotoIds: [],
        sourceWorkItemIds: [],
        sourceFingerprint: 'pending-source',
        expectedLogAbsent: true,
      },
      {
        id: 'rejected-proposal',
        projectId: project.id,
        kind: 'daily-log',
        createdAt: '2026-07-11T18:02:00',
        status: 'rejected',
        selected: false,
        dismissed: false,
        reason: 'Rejected proposal must stay out.',
        logDate: '2026-07-11',
        body: 'REJECTED SESSION BODY',
        sourcePhotoIds: [],
        sourceWorkItemIds: [],
        sourceFingerprint: 'rejected-source',
        expectedLogAbsent: true,
      },
      {
        id: 'dismissed-proposal',
        projectId: project.id,
        kind: 'daily-log',
        createdAt: '2026-07-11T18:03:00',
        status: 'rejected',
        selected: false,
        dismissed: true,
        reason: 'Dismissed proposal must stay out.',
        logDate: '2026-07-11',
        body: 'DISMISSED SESSION BODY',
        sourcePhotoIds: [],
        sourceWorkItemIds: [],
        sourceFingerprint: 'dismissed-source',
        expectedLogAbsent: true,
      },
    ];

    const packet = buildHandoffPacket({
      project,
      photos: [],
      dailyLogs: [],
      punchItems: [],
      review: packetReview(),
      // @ts-expect-error The packet builder accepts approved records, not session proposals.
      proposals: sessionProposals,
    });
    const serialized = JSON.stringify(packet);

    expect(serialized).not.toContain('PENDING SESSION BODY');
    expect(serialized).not.toContain('REJECTED SESSION BODY');
    expect(serialized).not.toContain('DISMISSED SESSION BODY');
  });
});

describe('activityDates', () => {
  it('unions photo days and log days, newest first', () => {
    const days = activityDates(
      [photo({ capturedAt: '2026-07-10T12:00:00' }), photo({ capturedAt: '2026-07-11T12:00:00' })],
      [log('2026-07-08')],
    );
    expect(days).toEqual(['2026-07-11', '2026-07-10', '2026-07-08']);
  });
});

describe('localDateOf', () => {
  it('gives the local calendar date', () => {
    expect(localDateOf('2026-07-11T15:30:00')).toBe('2026-07-11');
  });
});
