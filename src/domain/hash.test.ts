import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { sha256Hex, shortHash, verifyBytes } from './hash.ts';

describe('sha256Hex', () => {
  it('produces the known digest for "abc"', async () => {
    expect(await sha256Hex(strToU8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic and sensitive to a single bit', async () => {
    const a = await sha256Hex(strToU8('evidence'));
    const b = await sha256Hex(strToU8('evidence'));
    const c = await sha256Hex(strToU8('Evidence'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('verifyBytes', () => {
  it('confirms untouched bytes and flags tampered ones', async () => {
    const bytes = strToU8('sealed jpeg bytes');
    const sealed = await sha256Hex(bytes);
    expect((await verifyBytes(bytes, sealed)).ok).toBe(true);

    const tampered = strToU8('sealed jpeg bytez');
    const result = await verifyBytes(tampered, sealed);
    expect(result.ok).toBe(false);
    expect(result.actual).not.toBe(result.expected);
  });
});

describe('shortHash', () => {
  it('shows the first 8 chars', () => {
    expect(shortHash('ba7816bf8f01cfea')).toBe('ba7816bf');
  });
});
