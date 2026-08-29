import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CloseoutFinding, CloseoutPhase } from '../../domain/closeout.ts';
import type { DayReport as DayReportModel, HandoffPacket } from '../../domain/reports.ts';
import type { DailyLog, Photo, Project, PunchItem } from '../../domain/types.ts';
import { HANDOFF_STATUS_LABELS } from '../handoffLabels.ts';
import { DayReportView, HandoffPacketView } from './Reports.tsx';

const project: Project = {
  id: 'maple-street-kitchen-demo-2025',
  name: 'Maple Street Kitchen',
  client: 'Sample homeowner',
  address: '1250 Maple Street',
  status: 'active',
  createdAt: '2025-05-13T07:00:00.000Z',
  updatedAt: '2025-05-15T17:00:00.000Z',
};

function photo(id: string, capturedAt: string, caption: string, sha = 'a'): Photo {
  return {
    id,
    projectId: project.id,
    capturedAt,
    sha256: sha.repeat(64),
    width: 960,
    height: 720,
    size: 145_000,
    lat: 45.52306,
    lon: -122.67648,
    accuracy: 6,
    caption,
  };
}

function dailyRecord(id: string, dateKey: string, body: string): DailyLog {
  return {
    id,
    projectId: project.id,
    logDate: dateKey,
    body,
    crew: 'Alex and Lee',
    weather: 'Clear',
    createdAt: `${dateKey}T17:00:00.000Z`,
    updatedAt: `${dateKey}T17:00:00.000Z`,
  };
}

function completedWork(
  id: string,
  text: string,
  dateKey: string,
  photoIds: string[] = [],
  exceptionReason?: string,
): PunchItem {
  return {
    id,
    projectId: project.id,
    text,
    status: 'done',
    photoIds,
    createdAt: `${dateKey}T08:00:00.000Z`,
    doneAt: `${dateKey}T16:00:00.000Z`,
    updatedAt: `${dateKey}T16:00:00.000Z`,
    ...(exceptionReason
      ? { proofException: { reason: exceptionReason, recordedAt: `${dateKey}T16:30:00.000Z` } }
      : {}),
  };
}

const proofPhoto = photo(
  'msk25p01',
  '2025-05-13T08:15:00.000Z',
  'Cabinet boxes set and level',
  '1',
);
const secondProofPhoto = photo(
  'msk25p13',
  '2025-05-15T09:30:00.000Z',
  'Cabinet fronts and hardware installed',
  '2',
);
const supportPhotos = [
  {
    ...photo('msk25p14', '2025-05-15T10:00:00.000Z', 'Doors aligned after adjustment', '3'),
    lat: undefined,
    lon: undefined,
    accuracy: undefined,
  },
  photo('msk25p15', '2025-05-15T11:00:00.000Z', 'Drawer fronts aligned', '4'),
  photo('msk25p16', '2025-05-15T12:00:00.000Z', 'Hardware spacing checked', '5'),
];

function packetFor(
  phase: CloseoutPhase,
  reviewChanges: Partial<HandoffPacket['review']> = {},
): HandoffPacket {
  const current = ['needs-attention', 'ready-with-warnings', 'ready'].includes(phase);
  const findings: CloseoutFinding[] = [];
  const exceptionReason =
    phase === 'ready-with-warnings'
      ? 'The appliance installer recorded the final measurements.'
      : undefined;
  if (phase === 'needs-attention' || phase === 'check-again') {
    findings.push({
      id: 'finding-missing-proof',
      code: 'missing-punch-proof',
      severity: 'blocker',
      entityType: 'punch',
      entityId: 'msk25w10',
      workdayDate: '2025-05-15',
      message: 'Final cleanup is complete, but no usable proof photo is linked.',
      suggestedAction: 'Link a proof photo or record a human exception.',
    });
  }
  if (phase === 'ready-with-warnings' || phase === 'check-again') {
    findings.push({
      id: 'finding-missing-location',
      code: 'missing-location',
      severity: 'warning',
      entityType: 'photo',
      entityId: supportPhotos[0]!.id,
      workdayDate: '2025-05-15',
      message: 'Location was unavailable for one job photo.',
      suggestedAction: 'Review the photo before handoff.',
    });
  }
  if (exceptionReason) {
    findings.push({
      id: 'finding-proof-exception',
      code: 'proof-exception',
      severity: 'warning',
      entityType: 'punch',
      entityId: 'msk25w05',
      workdayDate: '2025-05-14',
      message: 'No photo was required for: Confirm appliance clearances',
      suggestedAction: 'Keep the contractor reason in the handoff packet.',
    });
  }
  return {
    project,
    review: {
      phase,
      current,
      lastCompletedAt: current ? '2025-05-15T18:00:00.000Z' : undefined,
      blockerCount: findings.filter((finding) => finding.severity === 'blocker').length,
      warningCount: findings.filter((finding) => finding.severity === 'warning').length,
      ...reviewChanges,
    },
    workdays: [
      {
        dateKey: '2025-05-13',
        dailyRecord: dailyRecord(
          'msk25l01',
          '2025-05-13',
          'Set the cabinet boxes and checked each run for level.',
        ),
        workItems: [
          {
            item: completedWork(
              'msk25w01',
              'Set cabinet boxes',
              '2025-05-13',
              [proofPhoto.id],
            ),
            validProofPhotos: [proofPhoto],
            unusablePhotoIds: [],
          },
        ],
        supportingPhotos: [],
        findings: [],
      },
      {
        dateKey: '2025-05-14',
        workItems: [
          {
            item: completedWork(
              'msk25w05',
              'Confirm appliance clearances',
              '2025-05-14',
              [],
              exceptionReason,
            ),
            validProofPhotos: [],
            unusablePhotoIds: [],
          },
        ],
        supportingPhotos: [],
        findings: findings.filter((finding) => finding.workdayDate === '2025-05-14'),
      },
      {
        dateKey: '2025-05-15',
        dailyRecord: dailyRecord(
          'msk25l03',
          '2025-05-15',
          'Installed the cabinet fronts and hardware, then completed the final cleanup.',
        ),
        workItems: [
          {
            item: completedWork(
              'msk25w08',
              'Install cabinet fronts and hardware',
              '2025-05-15',
              [secondProofPhoto.id],
            ),
            validProofPhotos: [secondProofPhoto],
            unusablePhotoIds: [],
          },
          ...(findings.some((finding) => finding.id === 'finding-missing-proof')
            ? [
                {
                  item: completedWork(
                    'msk25w10',
                    'Final cleanup and walk-through',
                    '2025-05-15',
                  ),
                  validProofPhotos: [],
                  unusablePhotoIds: [],
                },
              ]
            : []),
        ],
        supportingPhotos: supportPhotos,
        findings: findings.filter((finding) => finding.workdayDate === '2025-05-15'),
      },
    ],
    projectFindings: [],
    appendix: [
      { photo: proofPhoto, checkStatus: 'pass' },
      { photo: secondProofPhoto, checkStatus: 'pass' },
      ...supportPhotos.map((supportingPhoto) => ({
        photo: supportingPhoto,
        checkStatus: 'pass' as const,
      })),
    ],
  };
}

function renderPacket(packet: HandoffPacket): string {
  return renderToStaticMarkup(
    createElement(HandoffPacketView, {
      packet,
      company: 'Northwest Finish Carpentry',
      letterheadLine: 'Licensed contractor',
      generatedOn: '2025-05-16T09:00:00.000Z',
    }),
  );
}

describe('HandoffPacketView state banners', () => {
  const exactBanners: Array<[CloseoutPhase, string]> = [
    ['not-checked', 'Handoff review has not been run for this project.'],
    ['checking', 'Handoff review is still running. This packet may change.'],
    ['needs-attention', 'Handoff review found items that need attention before handoff.'],
    ['ready-with-warnings', 'This project is ready with notes. Review the notes before handoff.'],
    ['check-again', 'The job record changed after the prior review. Check again before handoff.'],
    ['check-failed', 'The latest review did not finish. No job record was changed by the review.'],
  ];

  for (const [phase, banner] of exactBanners) {
    it(`shows the exact ${phase} packet banner`, () => {
      const html = renderPacket(packetFor(phase));

      expect(html).toContain(HANDOFF_STATUS_LABELS[phase]);
      expect(html).toContain(banner);
    });
  }

  it('shows a current ready result and no unfinished banner', () => {
    const html = renderPacket(packetFor('ready'));

    expect(html).toContain('Ready for handoff');
    expect(html).toContain('Reviewed');
    for (const [, banner] of exactBanners) expect(html).not.toContain(banner);
  });

  it('labels check-again counts and time as a prior result', () => {
    const html = renderPacket(
      packetFor('check-again', { lastCompletedAt: '2025-05-15T18:00:00.000Z' }),
    );

    expect(html).toContain('Check again');
    expect(html).toContain('Prior result');
  });
});

describe('HandoffPacketView workday record', () => {
  it('shows approved workdays oldest first with records, proof, notes, and a human exception', () => {
    const html = renderPacket(packetFor('ready-with-warnings'));

    expect(html.indexOf('data-workday="2025-05-13"')).toBeLessThan(
      html.indexOf('data-workday="2025-05-14"'),
    );
    expect(html.indexOf('data-workday="2025-05-14"')).toBeLessThan(
      html.indexOf('data-workday="2025-05-15"'),
    );
    expect(html).toContain('Daily record');
    expect(html).toContain('Set the cabinet boxes and checked each run for level.');
    expect(html).toContain('Completed work');
    expect(html).toContain('Set cabinet boxes');
    expect(html).toContain('Linked proof');
    expect(html).toContain('Cabinet boxes set and level');
    expect(html).toContain('Photo check passed');
    expect(html).toContain('Install cabinet fronts and hardware');
    expect(html).toContain('Cabinet fronts and hardware installed');
    expect(html).toContain('Supporting photos');
    expect(html).toContain('Doors aligned after adjustment');
    expect(html).toContain('Drawer fronts aligned');
    expect(html).toContain('Hardware spacing checked');
    expect(html).toContain('Location was unavailable for one job photo.');
    expect(html).toContain('The appliance installer recorded the final measurements.');
  });

  it('keeps routine packet sections plain and puts full capture facts in the technical appendix', () => {
    const html = renderPacket(packetFor('ready'));
    const appendixStart = html.indexOf('Technical appendix');
    const routine = html.slice(0, appendixStart);
    const appendix = html.slice(appendixStart);

    expect(appendixStart).toBeGreaterThan(0);
    expect(routine).not.toMatch(/SHA-256|hash|fingerprint|database|IndexedDB|145,?000 bytes/i);
    expect(appendix).toContain(proofPhoto.capturedAt);
    expect(appendix).toContain(proofPhoto.sha256);
    expect(appendix).toMatch(/145,?000 bytes/i);
    expect(appendix).toContain('960');
    expect(appendix).toContain('720');
    expect(appendix).toContain('45.52306');
    expect(appendix).toContain('-122.67648');
  });
});

describe('DayReportView', () => {
  it('keeps the Daily Work Report available with its saved workday content', () => {
    const report: DayReportModel = {
      project,
      date: '2025-05-15',
      photos: [secondProofPhoto],
      log: dailyRecord(
        'msk25l03',
        '2025-05-15',
        'Installed the cabinet fronts and hardware, then completed the final cleanup.',
      ),
      punchDone: [
        completedWork(
          'msk25w08',
          'Install cabinet fronts and hardware',
          '2025-05-15',
          [secondProofPhoto.id],
        ),
      ],
      punchOpened: [],
    };
    const html = renderToStaticMarkup(createElement(DayReportView, { report }));

    expect(html).toContain('Daily Work Report');
    expect(html).toContain('2025-05-15');
    expect(html).toContain('Installed the cabinet fronts and hardware, then completed the final cleanup.');
    expect(html).toContain('Install cabinet fronts and hardware');
    expect(html).toContain('Cabinet fronts and hardware installed');
  });
});
