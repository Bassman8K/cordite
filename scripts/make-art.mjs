// Converts raw chapter captures (PNG, 16:9) into the compressed art the game and the website ship.
// Usage: node scripts/make-art.mjs <captureDir>   (expects <chapter-id>.png files)
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/make-art.mjs <captureDir>');
const ids = ['dead-water', 'shattered-mile', 'thin-air', 'furnace', 'black-site', 'last-light'];
mkdirSync(join(root, 'public/art'), { recursive: true });
mkdirSync(join(root, 'site/img'), { recursive: true });
for (const id of ids) {
  const file = join(src, `${id}.png`);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  await sharp(file).resize(800, 450).jpeg({ quality: 70, mozjpeg: true }).toFile(join(root, `public/art/${id}.jpg`));
  await sharp(file).resize(1600, 900).jpeg({ quality: 74, mozjpeg: true }).toFile(join(root, `site/img/${id}.jpg`));
}
console.log('art written');
