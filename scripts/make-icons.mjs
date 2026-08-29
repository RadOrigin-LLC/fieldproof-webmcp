/** Renders public/pwa-192.png and public/pwa-512.png from public/favicon.svg. */
import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('public/favicon.svg');
for (const size of [192, 512]) {
  const info = await sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(`public/pwa-${size}.png`);
  console.log(`pwa-${size}.png`, info.size, 'bytes');
}
