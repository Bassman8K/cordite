// Builds the photographed surface materials the game ships in public/tex/ from ambientCG
// (https://ambientcg.com, Creative Commons Zero): for each surface a colour map, a normal map and a
// map of ambient occlusion (red) and roughness (green), 512 pixels square.
//
// Each photograph is toned so its average colour matches the generated texture it replaces. The levels
// were lit and tinted against those, so the palette of every chapter stays as designed and only the
// material itself changes.
//
//   node scripts/make-textures.mjs <folder>
// <folder> holds one sub-folder per material, as unzipped from ambientCG's "1K-JPG" download; any
// that are missing are downloaded and unzipped there (needs `unzip`).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/make-textures.mjs <folder for the ambientCG downloads>');
const out = join(root, 'public/tex');
const SIZE = 512;

/** surface in the game -> ambientCG material */
const MATERIALS = {
  concrete: 'Concrete046',
  asphalt: 'Asphalt031',
  brick: 'Bricks097',
  plaster: 'Plaster007',
  rock: 'Rock030',
  dirt: 'Ground110',
  sand: 'Ground054',
  snow: 'Snow010A',
  grass: 'Grass004',
  planks: 'Planks037A',
  rust: 'Metal021',
  corrugated: 'CorrugatedSteel005',
};

const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
let averageColor;
let PHOTO;
try {
  ({ averageColor, PHOTO } = await server.ssrLoadModule('/src/gfx/textures.ts'));
} finally {
  await server.close();
}
for (const name of Object.keys(PHOTO)) if (!MATERIALS[name]) throw new Error(`the game expects a photographed "${name}" but none is listed here`);

async function folderOf(id) {
  const dir = join(src, id);
  if (!existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith('_Color.jpg'))) {
    mkdirSync(dir, { recursive: true });
    const r = await fetch(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`, { headers: { 'User-Agent': 'texture-build' } });
    if (!r.ok) throw new Error(`could not download ${id}: HTTP ${r.status}`);
    const zip = join(src, `${id}.zip`);
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    const u = spawnSync('unzip', ['-q', '-o', zip, '-d', dir]);
    if (u.status !== 0) throw new Error(`could not unzip ${id}: ${String(u.stderr).slice(0, 200)}`);
  }
  return dir;
}
const HUE = { brick: 0.5 };
const mapOf = (dir, kind) => {
  const f = readdirSync(dir).find((n) => n.endsWith(`_${kind}.jpg`));
  return f ? join(dir, f) : null;
};
const raw = async (file, channels) => {
  const img = sharp(file).resize(SIZE, SIZE, { kernel: 'lanczos3' });
  return (channels === 1 ? img.greyscale() : img.removeAlpha().toColourspace('srgb')).raw().toBuffer();
};
const toLinear = (v) => (v / 255) ** 2.2;
const toSrgb = (v) => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let total = 0;
const report = [];
for (const [name, id] of Object.entries(MATERIALS)) {
  if (!PHOTO[name]) continue;
  const dir = await folderOf(id);
  const need = (kind) => {
    const f = mapOf(dir, kind);
    if (!f) throw new Error(`${id} has no ${kind} map`);
    return f;
  };
  // colour, toned to the generated texture's average
  const colour = await raw(need('Color'), 3);
  const mean = [0, 0, 0];
  for (let i = 0; i < colour.length; i += 3) for (let k = 0; k < 3; k++) mean[k] += toLinear(colour[i + k]);
  const target = averageColor(name);
  const photo = mean.map((m) => m / (colour.length / 3));
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // Brightness is matched exactly; colour is pulled towards the generated texture's by HUE[name]
  // (all the way unless that would stain something that should stay neutral, like mortar).
  const hue = HUE[name] ?? 1;
  const gain = photo.map((m, k) => {
    const exact = target[k] / m;
    const plain = lum(target) / lum(photo);
    return Math.min(4, Math.max(0.2, plain + (exact - plain) * hue));
  });
  for (let i = 0; i < colour.length; i += 3) for (let k = 0; k < 3; k++) colour[i + k] = toSrgb(toLinear(colour[i + k]) * gain[k]);
  await sharp(colour, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 84, mozjpeg: true }).toFile(join(out, `${name}_c.jpg`));
  // surface relief (OpenGL convention, which is what three.js expects)
  await sharp(need('NormalGL')).resize(SIZE, SIZE, { kernel: 'lanczos3' }).removeAlpha().jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(join(out, `${name}_n.jpg`));
  // occlusion in red, roughness in green
  const rough = await raw(need('Roughness'), 1);
  const aoFile = mapOf(dir, 'AmbientOcclusion');
  const ao = aoFile ? await raw(aoFile, 1) : Buffer.alloc(SIZE * SIZE, 255);
  const orm = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    orm[i * 3] = ao[i];
    orm[i * 3 + 1] = rough[i];
    orm[i * 3 + 2] = 0;
  }
  await sharp(orm, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 80, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(join(out, `${name}_o.jpg`));
  const kb = ['c', 'n', 'o'].reduce((n, s) => n + statSync(join(out, `${name}_${s}.jpg`)).size, 0) / 1024;
  total += kb;
  report.push(`${name.padEnd(11)} ${id.padEnd(19)} ${kb.toFixed(0).padStart(4)} KB  toned x${gain.map((g) => g.toFixed(2)).join(' ')}`);
}
writeFileSync(
  join(out, 'CREDITS.txt'),
  `Photographed surface materials in this folder
=============================================

From ambientCG (https://ambientcg.com), by Lennart Demes and contributors.
Creative Commons Zero (CC0 1.0), credited with thanks.

${Object.entries(MATERIALS).filter(([name]) => PHOTO[name]).map(([name, id]) => `  ${`${name}_*.jpg`.padEnd(18)} ${id}  https://ambientcg.com/a/${id}`).join('\n')}

Changes: resized to ${SIZE} pixels, colour toned to the level palette, occlusion and roughness
packed into one image, by scripts/make-textures.mjs.
`,
);
console.log(report.join('\n'));
console.log(`textures: ${report.length} materials, ${(total / 1024).toFixed(2)} MB -> public/tex/`);
