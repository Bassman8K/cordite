// Renders every icon the project needs from assets/icon.svg:
// web app icons, the desktop installer icon and (if the native projects exist) Android launcher icons.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/icon.svg'));
// Maskable / adaptive variants: square background to the edge, artwork inside the safe zone.
const full = Buffer.from(svg.toString().replace(/rx="228"/, 'rx="0"').replace(/<rect x="14"[^>]*\/>/, ''));

async function render(src, size, out, pad = 0) {
  mkdirSync(dirname(out), { recursive: true });
  if (!pad) return sharp(src, { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  const inner = Math.round(size * (1 - pad * 2));
  const art = await sharp(src, { density: 300 }).resize(inner, inner).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: '#07090c' } }).composite([{ input: art, gravity: 'centre' }]).png({ compressionLevel: 9 }).toFile(out);
}

await render(svg, 192, join(root, 'public/icons/icon-192.png'));
await render(svg, 512, join(root, 'public/icons/icon-512.png'));
await render(full, 512, join(root, 'public/icons/maskable-512.png'), 0.1);
await render(full, 180, join(root, 'public/icons/apple-touch-icon.png'));
await render(svg, 1024, join(root, 'build/icon.png'));
await render(svg, 512, join(root, 'site/icon.png'));

// Android launcher icons (only once `npx cap add android` has created the project).
const res = join(root, 'android/app/src/main/res');
if (existsSync(res)) {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(sizes)) {
    await render(svg, s, join(res, `mipmap-${d}/ic_launcher.png`));
    await render(svg, s, join(res, `mipmap-${d}/ic_launcher_round.png`));
    await render(full, Math.round(s * 2.25), join(res, `mipmap-${d}/ic_launcher_foreground.png`), 0.22);
  }
  writeFileSync(join(res, 'values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#07090C</color>\n</resources>\n');
  console.log('android icons written');
}
// iOS app icon and launch image (only once `npx cap add ios` has created the project).
const xcassets = join(root, 'ios/App/App/Assets.xcassets');
if (existsSync(xcassets)) {
  const icon = await sharp(full, { density: 300 }).resize(1024, 1024).flatten({ background: '#07090c' }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(xcassets, 'AppIcon.appiconset/AppIcon-512@2x.png'), icon);
  const mark = await sharp(svg, { density: 300 }).resize(560, 560).png().toBuffer();
  const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: '#05070a' } }).composite([{ input: mark, gravity: 'centre' }]).png({ compressionLevel: 9, palette: true }).toBuffer();
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) writeFileSync(join(xcassets, 'Splash.imageset', name), splash);
  console.log('ios icon and launch image written');
}
console.log('icons written');
