import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { findSheetTabTarget, Sheet } from './Sheet.tsx';

describe('Sheet', () => {
  it('gives the dialog a fallback focus target and clear names', () => {
    const html = renderToStaticMarkup(
      createElement(Sheet, {
        title: 'Workday details',
        onClose: vi.fn(),
        children: createElement('p', null, 'Saved workday'),
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain('aria-label="Close Workday details"');
  });

  it('wraps Tab within the controls in the top sheet', () => {
    const first = { id: 'first' };
    const middle = { id: 'middle' };
    const last = { id: 'last' };
    const controls = [first, middle, last];

    expect(findSheetTabTarget(controls, last, false)).toBe(first);
    expect(findSheetTabTarget(controls, first, true)).toBe(last);
    expect(findSheetTabTarget(controls, middle, false)).toBeUndefined();
    expect(findSheetTabTarget(controls, { id: 'outside' }, false)).toBe(first);
    expect(findSheetTabTarget(controls, { id: 'outside' }, true)).toBe(last);
    expect(findSheetTabTarget([], null, false)).toBeUndefined();
  });
});
