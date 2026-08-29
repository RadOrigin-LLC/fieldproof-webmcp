import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Photo, PunchItem } from '../domain/types.ts';
import { PhotoDetail } from './PhotoDetail.tsx';

const photo: Photo = {
  id: 'photo-01a03ef7-059e-74ea-a614-c9ab9c76bd01',
  projectId: 'project-1',
  capturedAt: '2025-05-15T09:24:31',
  sha256: 'a8f3b10c09e9f850f79ac8426477e37ace008bf50a0c4e7c3d2507fa455021df',
  width: 1600,
  height: 1200,
  size: 486_400,
  lat: 45.30012,
  lon: -122.76054,
  accuracy: 7,
  caption: 'Sink cabinet fitted and ready for the countertop.',
  tags: ['cabinet', 'finish'],
};

const linkedItem: PunchItem = {
  id: 'work-1',
  projectId: 'project-1',
  text: 'Install sink cabinet',
  status: 'done',
  photoIds: [photo.id],
  createdAt: '2025-05-15T08:00:00',
  doneAt: '2025-05-15T16:00:00',
  updatedAt: '2025-05-15T16:00:00',
};

const availableItem: PunchItem = {
  id: 'work-2',
  projectId: 'project-1',
  text: 'Install cabinet fronts',
  status: 'done',
  photoIds: [],
  createdAt: '2025-05-15T08:30:00',
  doneAt: '2025-05-15T15:30:00',
  updatedAt: '2025-05-15T15:30:00',
};

function renderPhoto(
  current: Photo = photo,
  linkedItems: PunchItem[] = [linkedItem],
  projectItems: PunchItem[] = [linkedItem, availableItem],
): string {
  return renderToStaticMarkup(
    createElement(PhotoDetail, {
      photo: current,
      projectName: 'Maple Street Kitchen',
      workdayDate: '2025-05-15',
      linkedItems,
      projectItems,
      onClose: vi.fn(),
    }),
  );
}

describe('PhotoDetail', () => {
  it('keeps routine photo facts separate from technical facts', () => {
    const html = renderPhoto();
    const detailsStart = html.indexOf('<details');
    const routine = html.slice(0, detailsStart);
    const technical = html.slice(detailsStart);

    expect(routine).toContain('Maple Street Kitchen');
    expect(routine).toContain('May 15, 2025');
    expect(routine).toContain('Photo ID photo-01a03');
    expect(routine).toContain('Install sink cabinet');
    expect(routine).toContain(photo.caption);
    expect(routine).toContain('Original record protected');
    expect(routine).not.toContain(photo.capturedAt);
    expect(routine).not.toContain('45.30012');
    expect(routine).not.toContain(photo.sha256);

    expect(technical).toContain('<summary>Photo details</summary>');
    expect(technical).toContain('May 15, 2025 at 9:24');
    expect(technical).toContain('45.30012');
    expect(technical).toContain('-122.76054');
    expect(technical).toContain('7 m');
    expect(technical).toContain('1600 × 1200');
    expect(technical).toContain('475 KB');
    expect(technical).toContain(photo.sha256);
  });

  it('allows photo notes to change while capture facts stay protected', () => {
    const html = renderPhoto();

    expect(html).toContain('name="caption"');
    expect(html).toContain('name="tags"');
    expect(html).toContain('Save photo notes');
    expect(html).toContain('Check saved photo');
    for (const protectedName of ['capturedAt', 'lat', 'lon', 'accuracy', 'sha256', 'size', 'id']) {
      expect(html).not.toContain(`name="${protectedName}"`);
    }
  });

  it('lets a human add or remove work-item links and provides save feedback', () => {
    const html = renderPhoto();

    expect(html).toContain('Install sink cabinet');
    expect(html).toContain('Install cabinet fronts');
    expect(html).toContain('Remove link from Install sink cabinet');
    expect(html).toContain('Link photo to Install cabinet fronts');
    expect(html).toContain('aria-live="polite"');
  });

  it('keeps a voided photo visible without making it usable again', () => {
    const html = renderPhoto({
      ...photo,
      voidedAt: '2025-05-15T18:20:00',
      voidReason: 'The image was blurred.',
    });

    expect(html).toContain('Voided photo');
    expect(html).toContain('The image was blurred.');
    expect(html).not.toContain('Void this photo');
    expect(html).not.toContain('Unvoid');
    expect(html).not.toContain('Delete photo');
    expect(html).not.toContain('Replace file');
    expect(html).not.toContain('Link as proof');
    expect(html).toContain('Remove link from Install sink cabinet');
    expect(html).not.toContain('Link photo to Install cabinet fronts');
  });

  it('gives an uncaptioned photo a useful preview label', () => {
    const html = renderPhoto({ ...photo, caption: undefined });

    expect(html).toContain('aria-label="Photo from May 15, 2025, ID photo-01a03"');
    expect(html).not.toContain('aria-label="Photo"');
  });
});
