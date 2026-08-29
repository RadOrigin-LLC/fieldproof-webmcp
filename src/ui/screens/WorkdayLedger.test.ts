import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CloseoutPhase } from '../../domain/closeout.ts';
import type { Photo } from '../../domain/types.ts';
import type { WorkdayViewModel } from '../../domain/workdays.ts';
import { HANDOFF_ACTION_LABELS, HANDOFF_STATUS_LABELS } from '../handoffLabels.ts';
import { parseProjectQuery, patchProjectQuery } from '../projectQuery.ts';
import { WorkdayLedger } from './WorkdayLedger.tsx';

const photos: Photo[] = Array.from({ length: 18 }, (_, index) => {
  const day = 13 + Math.floor(index / 6);
  const id =
    index === 12
      ? 'msk25p13'
      : index === 13
        ? 'msk25p14'
        : index === 16
          ? 'msk25p17'
          : `photo-${index + 1}`;
  return {
    id,
    projectId: 'project-1',
    capturedAt: `2025-05-${day}T${String(8 + (index % 6)).padStart(2, '0')}:00:00`,
    sha256: id.padEnd(64, 'a').slice(0, 64),
    width: 960,
    height: 720,
    size: 100,
    caption:
      id === 'msk25p13'
        ? 'Cabinet fronts and hardware installed'
        : id === 'msk25p14'
          ? 'Doors aligned after adjustment'
        : id === 'msk25p17'
          ? 'Work area cleaned for final walk-through'
          : `Kitchen photo ${index + 1}`,
  };
});

const may15Work = [
  { id: 'msk25w08', text: 'Install cabinet fronts and hardware' },
  { id: 'msk25w09', text: 'Adjust doors and drawers' },
  { id: 'msk25w10', text: 'Final cleanup and walk-through' },
] as const;

function workday(
  dateKey: string,
  status: WorkdayViewModel['status'],
  changes: Partial<WorkdayViewModel> = {},
): WorkdayViewModel {
  const dayPhotos = photos.filter((photo) => photo.capturedAt.startsWith(dateKey));
  const itemCount = dateKey === '2025-05-14' ? 4 : 3;
  return {
    dateKey,
    photos: dayPhotos,
    completedItems: Array.from({ length: itemCount }, (_, index) =>
      ({
        id: dateKey === '2025-05-15' ? may15Work[index]!.id : `work-${dateKey}-${index + 1}`,
        projectId: 'project-1',
        text: dateKey === '2025-05-15' ? may15Work[index]!.text : 'Install cabinet boxes',
        status: 'done',
        photoIds:
          dateKey === '2025-05-15' && may15Work[index]!.id === 'msk25w09'
            ? ['msk25p14']
            : [],
        createdAt: `${dateKey}T08:00:00`,
        doneAt: `${dateKey}T16:00:00`,
        updatedAt: `${dateKey}T16:00:00`,
      }) as const,
    ),
    openItems: [],
    dailyRecord:
      dateKey === '2025-05-15'
        ? undefined
        : {
            id: `log-${dateKey}`,
            projectId: 'project-1',
            logDate: dateKey,
            body: 'Cabinet work completed and photographed.',
            createdAt: `${dateKey}T17:00:00`,
            updatedAt: `${dateKey}T17:00:00`,
          },
    findings: [],
    suggestedUpdates: [],
    representativePhotoIds: dayPhotos.slice(0, 3).map((photo) => photo.id),
    requiredCount: 0,
    noteCount: 0,
    status,
    ...changes,
  };
}

const workdays: WorkdayViewModel[] = [
  workday('2025-05-13', 'complete'),
  workday('2025-05-14', 'complete'),
  workday('2025-05-15', 'needs-attention', { requiredCount: 2, noteCount: 1 }),
];

function savedMay15Workday(): WorkdayViewModel {
  const beforeSave = workday('2025-05-15', 'check-again');
  return {
    ...beforeSave,
    completedItems: beforeSave.completedItems.map((item) => ({
      ...item,
      photoIds:
        item.id === 'msk25w08'
          ? ['msk25p13']
          : item.id === 'msk25w10'
            ? ['msk25p17']
            : item.photoIds,
    })),
    dailyRecord: {
      id: 'msk25l03',
      projectId: 'project-1',
      logDate: '2025-05-15',
      body: 'Installed cabinet fronts and hardware, adjusted the doors and drawers, and cleaned the work area for the final walk-through.',
      createdAt: '2025-05-15T17:00:00',
      updatedAt: '2025-05-15T17:00:00',
    },
  };
}

function renderLedger(
  phase: CloseoutPhase = 'needs-attention',
  filter: 'all' | 'needs-attention' = 'all',
  rows = workdays,
): string {
  return renderToStaticMarkup(
    createElement(WorkdayLedger, {
      project: {
        name: 'Maple Street Kitchen',
        client: 'Sample homeowner',
        address: '1250 Maple Street',
      },
      workdays: rows,
      photos,
      phase,
      checkedAt: '2025-05-15T17:00:00',
      filter,
      loading: false,
      onFilterChange: vi.fn(),
      onOpenWorkday: vi.fn(),
      onOpenReview: vi.fn(),
      onOpenPacket: vi.fn(),
      onOpenView: vi.fn(),
      onEditProject: vi.fn(),
      onTakePhoto: vi.fn(),
    }),
  );
}

describe('WorkdayLedger', () => {
  it('shows the Maple Street job facts and oldest workday first', () => {
    const html = renderLedger();

    expect(html).toContain('Maple Street Kitchen');
    expect(html).toContain('May 13 to May 15, 2025');
    expect(html).toContain('3 workdays');
    expect(html).toContain('18 photos');
    expect(html).toContain('10 completed items');
    expect(html.indexOf('Tuesday, May 13')).toBeLessThan(html.indexOf('Thursday, May 15'));
  });

  it('keeps each row compact while naming missing records and review counts', () => {
    const html = renderLedger();
    const may15 = html.slice(html.indexOf('data-workday="2025-05-15"'));

    expect((may15.match(/data-ledger-photo=/g) ?? [])).toHaveLength(3);
    expect(may15).toContain('6 photos');
    expect(may15).toContain('Final cleanup and walk-through');
    expect(may15).toContain('Daily record missing');
    expect(may15).toContain('2 items need attention');
    expect(may15).toContain('1 item worth a look');
  });

  it('shows the missing May 15 proof and daily record before suggested updates are saved', () => {
    const html = renderLedger('needs-attention', 'all', [workday('2025-05-15', 'needs-attention')]);
    const may15 = html.slice(html.indexOf('data-workday="2025-05-15"'));

    expect(may15).toContain('data-work-item="msk25w08"');
    expect(may15).toContain('data-work-item="msk25w10"');
    expect((may15.match(/Photo proof missing/g) ?? [])).toHaveLength(2);
    expect(may15).toContain('Daily record missing');
  });

  it('shows the two saved proof links and May 15 daily record without changing other days', () => {
    const html = renderLedger('check-again', 'all', [
      workday('2025-05-13', 'complete'),
      workday('2025-05-14', 'complete'),
      savedMay15Workday(),
    ]);
    const linkedFronts = html.slice(
      html.indexOf('data-work-item="msk25w08"'),
      html.indexOf('</li>', html.indexOf('data-work-item="msk25w08"')),
    );
    const linkedAdjustments = html.slice(
      html.indexOf('data-work-item="msk25w09"'),
      html.indexOf('</li>', html.indexOf('data-work-item="msk25w09"')),
    );
    const linkedCleanup = html.slice(
      html.indexOf('data-work-item="msk25w10"'),
      html.indexOf('</li>', html.indexOf('data-work-item="msk25w10"')),
    );

    expect(linkedFronts).toContain('1 proof photo');
    expect(linkedCleanup).toContain('1 proof photo');
    expect(linkedAdjustments).toContain('1 proof photo');
    expect(html).toContain(
      'Installed cabinet fronts and hardware, adjusted the doors and drawers, and cleaned the work area for the final walk-through.',
    );
    expect(html).toContain('class="workday-row status-complete" data-workday="2025-05-13"');
    expect(html).toContain('class="workday-row status-complete" data-workday="2025-05-14"');
    expect(html).toContain('class="workday-row status-check-again" data-workday="2025-05-15"');
    expect((html.match(/status-check-again/g) ?? [])).toHaveLength(1);
  });

  it('filters review days and explains an empty result', () => {
    const attentionHtml = renderLedger('needs-attention', 'needs-attention');
    expect(attentionHtml).not.toContain('Tuesday, May 13');
    expect(attentionHtml).toContain('Thursday, May 15');

    const emptyHtml = renderLedger('ready', 'needs-attention', [workday('2025-05-13', 'complete')]);
    expect(emptyHtml).toContain('No workdays match this filter.');
  });

  it('uses the exact project labels and main actions', () => {
    const phases: CloseoutPhase[] = [
      'not-checked',
      'checking',
      'needs-attention',
      'ready-with-warnings',
      'ready',
      'check-again',
      'check-failed',
    ];

    for (const phase of phases) {
      const html = renderLedger(phase);
      expect(html).toContain(HANDOFF_STATUS_LABELS[phase]);
      expect(html).toContain(HANDOFF_ACTION_LABELS[phase]);
    }
  });

  it('labels the saved review as prior when the latest attempt failed', () => {
    const html = renderLedger('check-failed');

    expect(html).toContain('Prior completed review');
    expect(html).not.toContain('>Reviewed ');
  });

  it('shows a changed day without old finding counts', () => {
    const html = renderLedger('check-again', 'all', [
      workday('2025-05-15', 'check-again', { requiredCount: 0, noteCount: 0, findings: [] }),
    ]);

    expect(html).toContain('Check again');
    expect(html).not.toContain('items need attention');
    expect(html).not.toContain('item worth a look');
  });
});

describe('project query state', () => {
  it('parses ledger layers and rejects invalid values', () => {
    expect(parseProjectQuery(new URLSearchParams())).toEqual({
      view: 'ledger',
      review: false,
    });
    expect(parseProjectQuery(new URLSearchParams('day=2025-05-15&review=1&focus=finding-1'))).toEqual({
      view: 'ledger',
      day: '2025-05-15',
      review: true,
      focus: 'finding-1',
    });
    expect(parseProjectQuery(new URLSearchParams('view=unknown&day=tomorrow&focus=lost'))).toEqual({
      view: 'ledger',
      review: false,
    });
    expect(parseProjectQuery(new URLSearchParams('tab=closeout'))).toEqual({
      view: 'ledger',
      review: true,
    });
  });

  it('opens one secondary view or a tool-requested review without losing the day', () => {
    expect(
      patchProjectQuery(new URLSearchParams('day=2025-05-15&review=1&focus=x'), {
        kind: 'open-view',
        view: 'photos',
      }).toString(),
    ).toBe('view=photos');

    expect(
      patchProjectQuery(new URLSearchParams('day=2025-05-15&view=reports'), {
        kind: 'open-review',
      }).toString(),
    ).toBe('day=2025-05-15&review=1');

    expect(
      patchProjectQuery(new URLSearchParams('tab=closeout'), {
        kind: 'close-review',
      }).toString(),
    ).toBe('');
  });
});
