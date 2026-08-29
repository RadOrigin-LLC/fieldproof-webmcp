/** Renders e2e/fixtures/site.jpg — a plain test photo for the capture e2e. */
import sharp from 'sharp';
import { mkdirSync } from 'fs';

mkdirSync('e2e/fixtures', { recursive: true });
const info = await sharp({
  create: { width: 800, height: 600, channels: 3, background: { r: 180, g: 140, b: 90 } },
})
  .jpeg({ quality: 85 })
  .toFile('e2e/fixtures/site.jpg');
console.log('site.jpg', info.size, 'bytes');
