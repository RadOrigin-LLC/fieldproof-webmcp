import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { buildProjectSummaries } from '../../domain/projects.ts';
import type { Photo, Project } from '../../domain/types.ts';
import { Onboarding } from './Onboarding.tsx';
import { ProjectFormView } from './Projects.tsx';
import {
  CaptureView,
  captureFailureMessage,
  storageNotice,
  type CaptureViewProps,
} from './Capture.tsx';
import { WorkdayLedger } from './WorkdayLedger.tsx';

function activeProject(id = 'project-1', name = 'Maple Street Kitchen'): Project {
  return {
    id,
    name,
    status: 'active',
    createdAt: '2025-05-13T07:00:00',
    updatedAt: '2025-05-13T07:00:00',
  };
}

describe('first run and project entry', () => {
  it('uses two short human paragraphs and clearly labels the synthetic sample', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(Onboarding)),
    );

    expect(html.match(/class="onboarding-sub"/g)).toHaveLength(2);
    expect(html).toContain('>Create project<');
    expect(html).toContain('Maple Street Kitchen sample');
    expect(html).toContain('people, places, records, and photos are synthetic');
    expect(html).not.toMatch(/WebMCP|hash|seal|database|legal|punch|daily log/i);
  });

  it('keeps every typed project value when a save fails', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectFormView, {
        values: {
          name: 'Cedar Lane Bath',
          client: 'Morgan',
          address: '18 Cedar Lane',
          startDate: '2026-08-29',
        },
        error: 'The project was not saved. Your details are still here. Try again.',
        busy: false,
        submitLabel: 'Open Workday Ledger',
        onChange: vi.fn(),
        onSubmit: vi.fn(),
      }),
    );

    expect(html).toContain('value="Cedar Lane Bath"');
    expect(html).toContain('value="Morgan"');
    expect(html).toContain('value="18 Cedar Lane"');
    expect(html).toContain('value="2026-08-29"');
    expect(html).toContain('Your details are still here');
    expect(html).toContain('Open Workday Ledger');
  });

  it('sorts active work first and marks an old ready result for a new check', async () => {
    const projects: Project[] = [
      {
        ...activeProject('archived', 'Archived job'),
        status: 'archived',
        updatedAt: '2026-08-29T18:00:00',
      },
      activeProject('quiet', 'Quiet job'),
      activeProject('busy', 'Busy job'),
    ];
    const photos: Photo[] = [
      {
        id: 'busy-photo-current',
        projectId: 'busy',
        capturedAt: '2026-08-29T12:00:00',
        sha256: 'a'.repeat(64),
        width: 20,
        height: 20,
        size: 20,
      },
      {
        id: 'busy-photo-voided',
        projectId: 'busy',
        capturedAt: '2026-08-28T12:00:00',
        sha256: 'b'.repeat(64),
        width: 20,
        height: 20,
        size: 20,
        voidedAt: '2026-08-29T13:00:00',
        voidReason: 'Duplicate',
      },
    ];
    const summaries = await buildProjectSummaries({
      projects,
      photos,
      punchItems: [
        {
          id: 'work-done',
          projectId: 'busy',
          text: 'Install cabinet fronts',
          status: 'done',
          photoIds: ['busy-photo-current'],
          createdAt: '2026-08-29T09:00:00',
          doneAt: '2026-08-29T11:00:00',
          updatedAt: '2026-08-29T11:00:00',
        },
        {
          id: 'work-open',
          projectId: 'busy',
          text: 'Touch up trim',
          status: 'open',
          photoIds: [],
          createdAt: '2026-08-29T10:00:00',
          updatedAt: '2026-08-29T10:00:00',
        },
      ],
      dailyLogs: [],
      reviewByProject: {
        busy: { phase: 'ready', sourceFingerprint: 'old-review' },
      },
    });

    expect(summaries.map((summary) => summary.project.id)).toEqual(['busy', 'quiet', 'archived']);
    expect(summaries[0]).toMatchObject({
      latestWorkday: '2026-08-29',
      activePhotoCount: 1,
      completedItemCount: 1,
      totalItemCount: 2,
      handoffPhase: 'check-again',
    });
  });
});

function captureProps(overrides: Partial<CaptureViewProps> = {}): CaptureViewProps {
  return {
    projects: [activeProject()],
    projectId: 'project-1',
    sealing: false,
    sealed: null,
    sealedUrl: '',
    caption: '',
    error: '',
    captionError: '',
    retryAvailable: false,
    online: true,
    storageWarning: '',
    aiReady: false,
    drafting: false,
    onProjectChange: vi.fn(),
    onTakePhoto: vi.fn(),
    onImportPhoto: vi.fn(),
    onRetry: vi.fn(),
    onCaptionChange: vi.fn(),
    onSuggestCaption: vi.fn(),
    onDone: vi.fn(),
    onNextPhoto: vi.fn(),
    onOpenSavedPhoto: vi.fn(),
    onStartProject: vi.fn(),
    ...overrides,
  };
}

describe('capture states', () => {
  it('keeps the active project visible and offers camera and import paths', () => {
    const html = renderToStaticMarkup(createElement(CaptureView, captureProps()));

    expect(html).toContain('Maple Street Kitchen');
    expect(html).toContain('Take photo');
    expect(html).toContain('Import photo');
    expect(html).toContain('Saving to');
  });

  it('shows direct offline, low-storage, and retry messages', () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const warning = storageNotice({ quota: 100_000_000, usage: 80_000_000 });
    const html = renderToStaticMarkup(
      createElement(CaptureView, captureProps({
        online: false,
        storageWarning: warning,
        error: captureFailureMessage(quotaError),
        retryAvailable: true,
      })),
    );

    expect(html).toContain('Offline');
    expect(html).toContain('low on storage');
    expect(html).toContain('photo was not saved');
    expect(html).toContain('Try again');
  });

  it('confirms only saved human-facing facts and opens the saved photo', () => {
    const saved: Photo = {
      id: 'photo-01a03ef7-059e-74ea-a614-c9ab9c76bd01',
      projectId: 'project-1',
      capturedAt: '2026-08-29T11:15:00',
      sha256: 'c'.repeat(64),
      width: 960,
      height: 720,
      size: 100,
    };
    const html = renderToStaticMarkup(
      createElement(CaptureView, captureProps({ sealed: saved })),
    );

    expect(html).toContain('Your photo, date, and photo ID were saved.');
    expect(html).toContain('No location was available');
    expect(html).toContain('Open saved photo');
    expect(html).not.toMatch(/fingerprint|SHA-256|sealed|45\.\d+|-122\.\d+/i);
  });
});

describe('empty Workday Ledger', () => {
  it('offers the three next job actions', () => {
    const html = renderToStaticMarkup(
      createElement(WorkdayLedger, {
        project: { name: 'New project' },
        workdays: [],
        photos: [],
        phase: 'not-checked',
        filter: 'all',
        loading: false,
        onFilterChange: vi.fn(),
        onOpenReview: vi.fn(),
        onOpenPacket: vi.fn(),
        onOpenView: vi.fn(),
        onEditProject: vi.fn(),
        onTakePhoto: vi.fn(),
      }),
    );

    expect(html).toContain('Take a photo');
    expect(html).toContain('Add work item');
    expect(html).toContain('Add daily record');
  });
});
