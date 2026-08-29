/**
 * The documented downscale: long edge ≤ 4032px, JPEG quality 0.92.
 * The stored artifact IS the evidence — the hash covers these bytes.
 * Browser-API dependent (canvas), so kept separate from pure domain math;
 * the pure part (target size) is exported for tests.
 */

export const MAX_LONG_EDGE = 4032;
export const JPEG_QUALITY = 0.92;

/** Pure: compute output dimensions for a source, preserving aspect. */
export function targetSize(w: number, h: number, maxEdge: number = MAX_LONG_EDGE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= maxEdge) return { w, h };
  const scale = maxEdge / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Decode → downscale (if needed) → re-encode JPEG. Returns the stored artifact. */
export async function processImage(file: Blob): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const { w, h } = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
    return { blob, width: w, height: h };
  } finally {
    bitmap.close();
  }
}

/** Best-effort GPS with a hard timeout — capture never waits on a satellite fix. */
export function captureLocation(
  timeoutMs = 4000,
): Promise<{ lat: number; lon: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
