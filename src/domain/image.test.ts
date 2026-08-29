import { describe, expect, it } from 'vitest';
import { JPEG_QUALITY, MAX_LONG_EDGE, targetSize } from './image.ts';
import { uuidv7 } from './ids.ts';

describe('targetSize', () => {
  it('leaves small images untouched', () => {
    expect(targetSize(1024, 768)).toEqual({ w: 1024, h: 768 });
    expect(targetSize(4032, 3024)).toEqual({ w: 4032, h: 3024 });
  });

  it('downscales the long edge to the documented max, preserving aspect', () => {
    const out = targetSize(8064, 6048);
    expect(out.w).toBe(4032);
    expect(out.h).toBe(3024);
  });

  it('handles portrait orientation', () => {
    const out = targetSize(3024, 8064);
    expect(out.h).toBe(4032);
    expect(out.w).toBe(1512);
  });

  it('documents the spec constants', () => {
    expect(MAX_LONG_EDGE).toBe(4032);
    expect(JPEG_QUALITY).toBe(0.92);
  });
});

describe('uuidv7', () => {
  it('is time-ordered', () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(a < b).toBe(true);
  });

  it('sets version and variant bits', () => {
    const id = uuidv7();
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });
});
