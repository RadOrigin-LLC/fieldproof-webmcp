import { describe, expect, it } from 'vitest';
import { localDateOf } from './dates.ts';

describe('localDateOf', () => {
  it('keeps date-only and local wall-clock values on their written calendar day', () => {
    expect(localDateOf('2025-05-13')).toBe('2025-05-13');
    expect(localDateOf('2025-05-13T00:05:00')).toBe('2025-05-13');
    expect(localDateOf('2025-05-13T23:55:00')).toBe('2025-05-13');
  });

  it('normalizes offset-bearing timestamps to the device calendar', () => {
    expect(localDateOf('2025-05-13T23:30:00-04:00')).toBe(
      localDateOf('2025-05-14T03:30:00Z'),
    );
  });
});
