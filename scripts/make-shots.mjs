// Converts raw UI / gameplay captures (PNG) into the compressed screenshots the website shows.
// Usage: node scripts/make-shots.mjs <captureDir>
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/make-shots.mjs <captureDir>');
for (const f of readdirSync(src).filter((n) => n.endsWith('.png'))) {
  const name = f.replace(/\.png$/, '');
  await sharp(join(src, f)).resize(1600, 900).jpeg({ quality: 76, mozjpeg: true }).toFile(join(root, `site/img/shot-${name}.jpg`));
}
await sharp(join(src, 'title.png')).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 78, mozjpeg: true }).toFile(join(root, 'site/img/social.jpg'));
console.log('screenshots written');
