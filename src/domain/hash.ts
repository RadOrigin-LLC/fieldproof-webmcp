/**
 * The seal's cryptographic half. SHA-256 is computed over the STORED
 * artifact bytes (post-downscale) — what you keep is what you can verify.
 * Verification recomputes the digest from stored bytes and compares.
 */

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const buf = bytes instanceof Uint8Array ? (bytes.buffer as ArrayBuffer) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
}

/** Recompute the stored bytes' digest and compare to the sealed value. */
export async function verifyBytes(bytes: Uint8Array | ArrayBuffer, expected: string): Promise<VerifyResult> {
  const actual = await sha256Hex(bytes);
  return { ok: actual === expected, expected, actual };
}

/** Short display form: first 8 hex chars, mono, like a commit. */
export function shortHash(sha: string): string {
  return sha.slice(0, 8);
}
