import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { useSettings } from './data/useLive.ts';
import { DEFAULT_SETTINGS } from './domain/types.ts';

vi.mock('./data/useLive.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./data/useLive.ts')>(),
  useSettings: vi.fn(),
}));

describe('Projects homepage', () => {
  it.each([undefined, '2026-09-02T12:00:00.000Z'])(
    'shows the introduction, demo entry, and menu with onboardedAt=%s',
    (onboardedAt) => {
      vi.mocked(useSettings).mockReturnValue({ ...DEFAULT_SETTINGS, onboardedAt });

      const html = renderToStaticMarkup(
        createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)),
      );

      expect(html).toContain('class="projects-page"');
      expect(html).toContain('Try the demo');
      expect(html).toContain('/images/contractor-documenting-job.png');
      expect(html).toContain('aria-label="Main"');
      expect(html).toContain('href="/capture"');
      expect(html).toContain('href="/more"');
    },
  );
});
