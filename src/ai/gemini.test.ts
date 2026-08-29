import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../data/db.ts';
import { getGeminiKey, setGeminiKey } from './gemini.ts';

describe('Gemini key storage', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses only the key saved by the user', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'build-key');

    expect(await getGeminiKey()).toBeNull();

    await setGeminiKey('saved-key');
    expect(await getGeminiKey()).toBe('saved-key');
  });
});
