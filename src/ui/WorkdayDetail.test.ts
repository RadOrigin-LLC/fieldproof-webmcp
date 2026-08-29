import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CloseoutFinding, CloseoutProposal } from '../domain/closeout.ts';
import type { DailyLog, Photo, PunchItem } from '../domain/types.ts';
import type { WorkdayViewModel } from '../domain/workdays.ts';
import { WorkdayDetail } from './WorkdayDetail.tsx';

const dateKey = '2025-05-15';

function photo(id: string, capturedAt = `${dateKey}T09:00:00`, caption?: string): Photo {
  return {
    id,
    projectId: 'project-1',
    capturedAt,
    sha256: id.padEnd(64, 'a').slice(0, 64),
    width: 1200,
    height: 900,
    size: 345_000,
    caption,
  };
}

function item(
  id: string,
  text: string,
  status: PunchItem['status'],
  photoIds: string[] = [],
): PunchItem {
  return {
    id,
    projectId: 'project-1',
    text,
    status,
    photoIds,
    createdAt: `${dateKey}T08:00:00`,
    ...(status === 'done' ? { doneAt: `${dateKey}T16:00:00` } : {}),
    updatedAt: `${dateKey}T16:00:00`,
  };
}

const linkedPhoto = photo('photo-linked', `${dateKey}T09:00:00`, 'Finished sink wall');
const unlinkedPhoto = photo('photo-unlinked', `${dateKey}T10:00:00`, 'Cabinet hardware');
const uncaptionedPhoto = photo('photo-uncaptioned', `${dateKey}T11:00:00`);
const otherDayPhoto = photo('photo-other-day', '2025-05-14T12:00:00', 'Earlier work');
const completedItem = item('work-complete', 'Install sink cabinet', 'done', [linkedPhoto.id]);
const openItem = item('work-open', 'Touch up pantry paint', 'open');
const dailyRecord: DailyLog = {
  id: 'log-1',
  projectId: 'project-1',
  logDate: dateKey,
  body: 'Set the sink cabinet, fitted the trim, and cleaned the work area.',
  crew: 'Maya and Luis',
  weather: 'Light rain, 58°F',
  createdAt: `${dateKey}T17:00:00`,
  updatedAt: `${dateKey}T17:00:00`,
};
const blocker: CloseoutFinding = {
  id: 'missing-proof:work-complete',
  code: 'missing-punch-proof',
  severity: 'blocker',
  entityType: 'punch',
  entityId: completedItem.id,
  workdayDate: dateKey,
  message: 'One completed item needs a proof photo.',
  suggestedAction: 'Choose the photo that shows the finished work.',
};
const warning: CloseoutFinding = {
  id: 'missing-location:photo-unlinked',
  code: 'missing-location',
  severity: 'warning',
  entityType: 'photo',
  entityId: unlinkedPhoto.id,
  workdayDate: dateKey,
  message: 'This photo has no saved location.',
  suggestedAction: 'Keep it if location was unavailable.',
};
const proposal: CloseoutProposal = {
  id: 'proposal-1',
  projectId: 'project-1',
  kind: 'photo-link',
  createdAt: `${dateKey}T17:05:00`,
  status: 'pending',
  selected: true,
  reason: 'This photo was taken closest to the completion time.',
  punchItemId: completedItem.id,
  photoId: unlinkedPhoto.id,
  expectedPunchUpdatedAt: completedItem.updatedAt,
  expectedPhotoSha256: unlinkedPhoto.sha256,
};

function workday(changes: Partial<WorkdayViewModel> = {}): WorkdayViewModel {
  return {
    dateKey,
    photos: [linkedPhoto, unlinkedPhoto, uncaptionedPhoto],
    completedItems: [completedItem],
    openItems: [openItem],
    dailyRecord,
    findings: [blocker, warning],
    suggestedUpdates: [proposal],
    representativePhotoIds: [linkedPhoto.id, unlinkedPhoto.id, uncaptionedPhoto.id],
    requiredCount: 1,
    noteCount: 1,
    status: 'needs-attention',
    ...changes,
  };
}

function renderDetail(
  selected = workday(),
  photos: Photo[] = [linkedPhoto, unlinkedPhoto, uncaptionedPhoto, otherDayPhoto],
): string {
  return renderToStaticMarkup(
    createElement(WorkdayDetail, {
      projectId: 'project-1',
      projectName: 'Maple Street Kitchen',
      workday: selected,
      photos,
      focusId: blocker.id,
      onClose: vi.fn(),
      returnFocusId: `workday-${dateKey}-open`,
    }),
  );
}

describe('WorkdayDetail', () => {
  it('shows each photo from the selected date once', () => {
    const html = renderDetail();

    for (const current of [linkedPhoto, unlinkedPhoto, uncaptionedPhoto]) {
      expect(html.match(new RegExp(`data-workday-photo="${current.id}"`, 'g'))).toHaveLength(1);
    }
    expect(html).not.toContain(`data-workday-photo="${otherDayPhoto.id}"`);
    expect(html).toContain('3 photos');
  });

  it('shows the full saved workday story and focuses the requested finding', () => {
    const html = renderDetail();

    expect(html).toContain('Maple Street Kitchen');
    expect(html).toContain('Install sink cabinet');
    expect(html).toContain('Touch up pantry paint');
    expect(html).toContain('Finished sink wall');
    expect(html).toContain(dailyRecord.body);
    expect(html).toContain('Maya and Luis');
    expect(html).toContain('Light rain, 58°F');
    expect(html).toContain(blocker.message);
    expect(html).toContain(warning.message);
    expect(html).toContain('Suggested updates');
    expect(html).toContain(proposal.reason);
    expect(html).toContain(`data-finding-id="${blocker.id}"`);
    expect(html).toMatch(
      new RegExp(`data-finding-id="${blocker.id}"[^>]*data-sheet-initial-focus="true"`),
    );
    expect(html).toContain('Manage proof');
  });

  it.each([
    {
      name: 'photo-only workday',
      selected: workday({ completedItems: [], openItems: [] }),
      expected: 'No completed work recorded for this workday.',
    },
    {
      name: 'work-only workday',
      selected: workday({ photos: [] }),
      photos: [otherDayPhoto],
      expected: 'No photos recorded for this workday.',
    },
    {
      name: 'missing daily record',
      selected: workday({ dailyRecord: undefined }),
      expected: 'Add daily record',
    },
    {
      name: 'void-only workday',
      selected: workday({ photos: [{ ...linkedPhoto, voidedAt: `${dateKey}T18:00:00`, voidReason: 'Blurred' }] }),
      photos: [{ ...linkedPhoto, voidedAt: `${dateKey}T18:00:00`, voidReason: 'Blurred' }, otherDayPhoto],
      expected: 'No active photos remain. The voided photo stays in this workday.',
    },
  ])('explains a $name', ({ selected, photos, expected }) => {
    const html = renderDetail(selected, photos ?? selected.photos);
    expect(html).toContain(expected);
  });

  it('does not truncate a 100-photo workday', () => {
    const manyPhotos = Array.from({ length: 100 }, (_, index) =>
      photo(`photo-${index + 1}`, `${dateKey}T12:${String(index % 60).padStart(2, '0')}:00`),
    );
    const html = renderDetail(workday({ photos: manyPhotos }), manyPhotos);

    expect(html.match(/data-workday-photo=/g)).toHaveLength(100);
    expect(html).toContain('100 photos');
  });
});
