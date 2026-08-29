import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CloseoutAudit, CloseoutProposal } from '../../domain/closeout.ts';
import type { Photo, PunchItem } from '../../domain/types.ts';
import type { ProjectCloseoutSession } from '../../data/closeoutSession.ts';
import { CloseoutView } from './Closeout.tsx';
import { PunchEvidenceSheet } from '../PunchEvidenceSheet.tsx';

const handlers = {
  onRunCheck: vi.fn(),
  onOpenFinding: vi.fn(),
  onOpenPacket: vi.fn(),
  onToggleProposal: vi.fn(),
  onUpdateLogBody: vi.fn(),
  onChoosePhoto: vi.fn(),
  onRejectProposal: vi.fn(),
  onDismissProposal: vi.fn(),
  onApplySelected: vi.fn(),
};

const maplePhotos: Photo[] = [
  {
    id: 'msk25p13',
    projectId: 'project-1',
    capturedAt: '2025-05-15T09:50:00.000Z',
    sha256: 'a'.repeat(64),
    width: 960,
    height: 720,
    size: 100,
    caption: 'Cabinet fronts and hardware installed',
  },
  {
    id: 'msk25p17',
    projectId: 'project-1',
    capturedAt: '2025-05-15T15:50:00.000Z',
    sha256: 'b'.repeat(64),
    width: 960,
    height: 720,
    size: 100,
    caption: 'Work area cleaned for final walk-through',
  },
  {
    id: 'msk25p18',
    projectId: 'project-1',
    capturedAt: '2025-05-15T16:20:00.000Z',
    sha256: 'c'.repeat(64),
    width: 960,
    height: 720,
    size: 100,
    caption: 'Completed kitchen at final walk-through',
  },
];

function mapleProposals(selected = false): CloseoutProposal[] {
  return [
    {
      kind: 'photo-link',
      id: 'proposal-fronts',
      projectId: 'project-1',
      createdAt: '2025-05-15T17:00:00.000Z',
      status: 'pending',
      selected,
      dismissed: false,
      reason: 'This photo was taken near the time the work was marked complete.',
      punchItemId: 'msk25w08',
      punchItemLabel: 'Install cabinet fronts and hardware',
      workdayDate: '2025-05-15',
      photoId: 'msk25p13',
      expectedPunchUpdatedAt: '2025-05-15T10:00:00.000Z',
      expectedPhotoIdentity: 'photo-identity-13',
      sourceFingerprint: 'source-13',
    },
    {
      kind: 'photo-link',
      id: 'proposal-cleanup',
      projectId: 'project-1',
      createdAt: '2025-05-15T17:01:00.000Z',
      status: 'pending',
      selected,
      dismissed: false,
      reason: 'This photo was taken near the time the work was marked complete.',
      punchItemId: 'msk25w10',
      punchItemLabel: 'Final cleanup and walk-through',
      workdayDate: '2025-05-15',
      photoId: 'msk25p17',
      expectedPunchUpdatedAt: '2025-05-15T16:00:00.000Z',
      expectedPhotoIdentity: 'photo-identity-17',
      sourceFingerprint: 'source-17',
    },
    {
      kind: 'daily-log',
      id: 'proposal-log',
      projectId: 'project-1',
      createdAt: '2025-05-15T17:02:00.000Z',
      status: 'pending',
      selected,
      dismissed: false,
      reason: 'May 15 has saved work and photos without a daily record.',
      logDate: '2025-05-15',
      body: 'Installed the cabinet fronts and hardware, adjusted the doors and drawers, cleaned the work area, and completed the final walk-through.',
      sourcePhotoIds: ['msk25p13', 'msk25p17'],
      sourceWorkItemIds: ['msk25w08', 'msk25w09', 'msk25w10'],
      sourceFingerprint: 'daily-source',
      expectedLogAbsent: true,
    },
  ];
}

function renderCloseout(session: ProjectCloseoutSession, agentAvailable = false) {
  return renderToStaticMarkup(
    createElement(CloseoutView, {
      projectName: 'Maple Street Kitchen',
      session,
      findingLabels: {
        'open-punch:punch-1': 'Install cabinet face',
        'missing-daily-log:2026-08-25': 'August 25, 2026',
      },
      proposalFacts: {
        'proposal-fronts': {
          target: 'Install cabinet fronts and hardware',
          workdayDate: '2025-05-15',
          photo: maplePhotos[0],
          photoCheck: 'Passed',
          alternatePhotos: [maplePhotos[2]],
        },
        'proposal-cleanup': {
          target: 'Final cleanup and walk-through',
          workdayDate: '2025-05-15',
          photo: maplePhotos[1],
          photoCheck: 'Passed',
          alternatePhotos: [maplePhotos[2]],
        },
        'proposal-log': {
          target: 'May 15, 2025',
          workdayDate: '2025-05-15',
          sourceWorkItems: [
            'Install cabinet fronts and hardware',
            'Adjust doors and drawers',
            'Final cleanup and walk-through',
          ],
          sourcePhotos: [
            'Cabinet fronts and hardware installed',
            'Work area cleaned for final walk-through',
          ],
        },
      },
      agentAvailable,
      busy: false,
      applying: false,
      error: '',
      ...handlers,
    }),
  );
}

describe('CloseoutView', () => {
  it('explains the handoff check when WebMCP is unavailable', () => {
    const html = renderCloseout({ phase: 'not-checked', proposals: [], activity: [] });

    expect(html).toContain('Maple Street Kitchen');
    expect(html).toContain('Not checked');
    expect(html).toContain('Run handoff review');
    expect(html).toContain('You can check the project and review its proof here');
    expect(html).toContain('Fix the items under Needs attention');
  });

  it('shows blockers before warnings with recognizable record labels', () => {
    const audit: CloseoutAudit = {
      projectId: 'project-1',
      checkedAt: '2026-08-26T16:00:00.000Z',
      sourceFingerprint: 'source',
      photoFingerprint: 'photos',
      phase: 'needs-attention',
      blockerCount: 1,
      warningCount: 1,
      findings: [
        {
          id: 'open-punch:punch-1',
          code: 'open-punch',
          severity: 'blocker',
          entityType: 'punch',
          entityId: 'punch-1',
          message: 'Punch item is still open: Install cabinet face',
          suggestedAction: 'Finish the item.',
        },
        {
          id: 'missing-daily-log:2026-08-25',
          code: 'missing-daily-log',
          severity: 'warning',
          entityType: 'daily-log',
          entityId: '2026-08-25',
          message: 'No daily log exists.',
          suggestedAction: 'Add a daily log.',
        },
      ],
      candidates: {},
      dailyLogContexts: [],
      counts: { workdays: 3, photos: 18, punchItems: 10, dailyLogs: 2 },
      workdayFingerprints: {},
    };
    const html = renderCloseout({
      phase: 'needs-attention',
      audit,
      proposals: [],
      activity: [],
    });

    expect(html.indexOf('Needs attention')).toBeLessThan(html.indexOf('Worth a look'));
    expect(html).toContain('Install cabinet face');
    expect(html).toContain('August 25, 2026');
    expect(html).toContain('Handoff packet · Needs attention');
    expect(html).toContain('3 workdays');
    expect(html).toContain('18 photos');
    expect(html).toContain('10 work items');
    expect(html).toContain('2 daily records');
  });

  it('keeps all three truthful review steps visible after completion', () => {
    const html = renderCloseout({
      phase: 'needs-attention',
      reviewProgress: {
        runId: 'review-1',
        state: 'complete',
        startedAt: '2026-08-26T16:00:00.000Z',
        finishedAt: '2026-08-26T16:00:05.000Z',
        photoCheck: 'complete',
        workItems: 'complete',
        dailyRecords: 'complete',
      },
      proposals: [],
      activity: [],
    });

    expect(html).toContain('Review progress');
    expect(html).toContain('Checking original photos');
    expect(html).toContain('Reviewing work items');
    expect(html).toContain('Reviewing daily records');
    expect(html.match(/Complete/g)).toHaveLength(3);
  });

  it('labels an older completed result after a failed review attempt', () => {
    const audit: CloseoutAudit = {
      projectId: 'project-1',
      checkedAt: '2026-08-26T16:00:00.000Z',
      sourceFingerprint: 'source',
      photoFingerprint: 'photos',
      phase: 'ready',
      blockerCount: 0,
      warningCount: 0,
      findings: [],
      candidates: {},
      dailyLogContexts: [],
      counts: { workdays: 3, photos: 18, punchItems: 10, dailyLogs: 3 },
      workdayFingerprints: {},
    };
    const html = renderCloseout({
      phase: 'check-failed',
      audit,
      reviewProgress: {
        runId: 'review-2',
        state: 'failed',
        startedAt: '2026-08-26T17:00:00.000Z',
        finishedAt: '2026-08-26T17:00:02.000Z',
        photoCheck: 'complete',
        workItems: 'active',
        dailyRecords: 'pending',
      },
      proposals: [],
      activity: [],
    });

    expect(html).toContain('Prior completed review');
    expect(html).toContain('Latest attempt');
    expect(html).toContain('No job record was changed');
  });

  it('makes the handoff packet the main action for a ready project', () => {
    const audit: CloseoutAudit = {
      projectId: 'project-1',
      checkedAt: '2026-08-26T16:00:00.000Z',
      sourceFingerprint: 'source',
      photoFingerprint: 'photos',
      phase: 'ready',
      blockerCount: 0,
      warningCount: 0,
      findings: [],
      candidates: {},
      dailyLogContexts: [],
      counts: { workdays: 1, photos: 2, punchItems: 2, dailyLogs: 1 },
      workdayFingerprints: {},
    };
    const html = renderCloseout({ phase: 'ready', audit, proposals: [], activity: [] }, true);

    expect(html).toContain('Ready for handoff');
    expect(html).toContain('2 work items');
    expect(html).toContain('2 photos');
    expect(html).toContain('1 daily record');
    expect(html).toContain('Open handoff packet');
    expect(html).toContain('Ask your browser assistant');
  });

  it('shows three unselected May 15 cards with previews, sources, and human controls', () => {
    const proposals = mapleProposals();
    const html = renderCloseout({
      phase: 'needs-attention',
      proposals,
      activity: [
        {
          id: 'activity-1',
          projectId: 'project-1',
          action: 'stage_photo_link',
          outcome: 'success',
          occurredAt: '2026-08-26T16:02:00.000Z',
          detail: 'Suggested a proof photo.',
        },
      ],
    });

    expect(html).toContain('Suggested updates');
    expect(html.match(/data-proposal-card=/g)).toHaveLength(3);
    expect(html.match(/data-photo-preview=/g)).toHaveLength(2);
    expect(html).toContain('Install cabinet fronts and hardware');
    expect(html).toContain('Final cleanup and walk-through');
    expect(html).toContain('Cabinet fronts and hardware installed');
    expect(html).toContain('Work area cleaned for final walk-through');
    expect(html).toContain('Photo check passed');
    expect(html).toContain('Suggested from the saved date, caption, photo ID, and work timing.');
    expect(html).toContain('You must confirm that this photo proves the work.');
    expect(html).toContain('Adjust doors and drawers');
    expect(html).toContain('Draft daily record');
    expect(html).toContain('You are responsible for the final wording.');
    expect(html).toContain('0 selected');
    expect(html).toContain('Save selected updates (0)');
    expect(html.match(/>Reject</g)).toHaveLength(3);
    expect(html.match(/>Choose another</g)).toHaveLength(2);
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('>Dismiss<');
    expect(html).toContain('Review history');
    expect(html).toContain('Suggested a proof photo.');
  });

  it('shows the selected count and one save action', () => {
    const html = renderCloseout({
      phase: 'needs-attention',
      proposals: mapleProposals(true),
      activity: [],
    });

    expect(html).toContain('3 selected');
    expect(html).toContain('Save selected updates (3)');
    expect(html.match(/Selected for saving/g)).toHaveLength(3);
  });

  it('keeps settled results visible and dismisses only rejected, stale, or failed cards', () => {
    const proposals = mapleProposals();
    const settled: CloseoutProposal[] = [
      {
        ...proposals[0]!,
        status: 'rejected',
        resultMessage: 'Rejected by you.',
      },
      {
        ...proposals[1]!,
        status: 'applied',
        resultMessage: 'The proof photo was linked.',
      },
      {
        ...proposals[0]!,
        id: 'proposal-stale',
        status: 'stale',
        resultMessage: 'The work item or photo changed. Check it again.',
      },
      {
        ...proposals[1]!,
        id: 'proposal-failed',
        status: 'failed',
        resultMessage: 'FieldProof could not save this update.',
      },
      {
        ...proposals[0]!,
        id: 'proposal-hidden',
        status: 'rejected',
        dismissed: true,
        reason: 'This dismissed card must stay hidden.',
      },
    ];

    const html = renderCloseout({ phase: 'check-again', proposals: settled, activity: [] });

    expect(html).toContain('Rejected');
    expect(html).toContain('Saved');
    expect(html).toContain('Stale');
    expect(html).toContain('Failed');
    expect(html).toContain('Rejected by you.');
    expect(html).toContain('The proof photo was linked.');
    expect(html).toContain('The work item or photo changed. Check it again.');
    expect(html).toContain('FieldProof could not save this update.');
    expect(html.match(/>Dismiss</g)).toHaveLength(3);
    expect(html).not.toContain('This dismissed card must stay hidden.');
  });
});

describe('PunchEvidenceSheet', () => {
  it('shows linked and available photos plus the human exception control', () => {
    const item: PunchItem = {
      id: 'punch-1',
      projectId: 'project-1',
      text: 'Install cabinet face',
      status: 'done',
      photoIds: ['photo-1'],
      createdAt: '2026-08-26T14:00:00.000Z',
      doneAt: '2026-08-26T15:00:00.000Z',
      updatedAt: '2026-08-26T15:00:00.000Z',
    };
    const photos: Photo[] = ['photo-1', 'photo-2'].map((id) => ({
      id,
      projectId: 'project-1',
      capturedAt: '2026-08-26T15:00:00.000Z',
      sha256: 'a'.repeat(64),
      width: 20,
      height: 20,
      size: 100,
      caption: id === 'photo-1' ? 'Linked finish photo' : 'Available finish photo',
    }));

    const html = renderToStaticMarkup(
      createElement(PunchEvidenceSheet, { item, photos, onClose: vi.fn() }),
    );

    expect(html).toContain('Linked finish photo');
    expect(html).toContain('Remove');
    expect(html).toContain('Available finish photo');
    expect(html).toContain('Link');
    expect(html).toContain('Explain why no photo is needed');
  });
});
