// Builds the public website into _site/: the landing page plus the playable web build under /play/.
// Chapter and weapon details are read from the game's own source, so the page cannot drift from the game.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const facts = JSON.parse(readFileSync(join(root, 'site/facts.json'), 'utf8'));
const repoUrl = pkg.repository.url.replace(/\.git$/, '');
const repo = repoUrl.replace(/^https:\/\/github\.com\//, '');
const siteUrl = pkg.homepage.endsWith('/') ? pkg.homepage : `${pkg.homepage}/`;

if (!existsSync(join(root, 'dist/index.html'))) throw new Error('dist/ is missing. Run "npm run build" first.');

// ---- game data, loaded through Vite so the TypeScript sources can be imported directly
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
let WEAPONS, CLASS_LABEL, CLASS_ORDER, CHAPTERS;
try {
  ({ WEAPONS } = await server.ssrLoadModule('/src/game/weapons/data.ts'));
  ({ CLASS_LABEL, CLASS_ORDER } = await server.ssrLoadModule('/src/game/weapons/types.ts'));
  ({ CHAPTERS } = await server.ssrLoadModule('/src/game/campaign/index.ts'));
} finally {
  await server.close();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dirSize = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
const gameBytes = dirSize(join(root, 'dist'));
const gameSize = `${(gameBytes / 1048576).toFixed(1)} MB`;

const chapters = CHAPTERS.map(
  (c) => `
            <article class="chapter reveal" style="--c:${esc(c.accent)}">
              <div class="chapter-art"><img src="./img/${esc(c.id)}.jpg" alt="${esc(c.title)}: ${esc(c.location)}" width="1600" height="900" loading="lazy" /></div>
              <div class="chapter-body">
                <span class="chapter-n" aria-hidden="true">${String(c.n).padStart(2, '0')}</span>
                <span class="chapter-code">${esc(c.codename)} · ${esc(c.clock)}</span>
                <h3>${esc(c.title)}</h3>
                <p class="chapter-loc">${esc(c.location)}</p>
                <p class="chapter-tag">${esc(c.tagline)}</p>
                <span class="chapter-meta">${c.stages.length} objectives · a checkpoint at each</span>
              </div>
            </article>`,
).join('');

const counts = CLASS_ORDER.map((cls) => [CLASS_LABEL[cls], WEAPONS.filter((w) => w.cls === cls).length]);
const most = Math.max(...counts.map(([, n]) => n));
const arsenal = counts.map(([label, n]) => `<div class="bar" role="listitem"><span>${esc(label)}</span><i style="--w:${Math.round((n / most) * 100)}%"></i><b>${n}</b></div>`).join('\n            ');

// Two rows of names for the ticker, spread evenly through the catalogue.
const names = WEAPONS.map((w) => w.name);
const row = (offset) => names.filter((_, i) => i % 6 === offset).map((n) => `<span>${esc(n)}</span>`).join('');

let androidReq = 'Android 7 or newer';
const gradle = join(root, 'android/variables.gradle');
if (existsSync(gradle)) {
  const m = /minSdkVersion\s*=\s*(\d+)/.exec(readFileSync(gradle, 'utf8'));
  const byApi = { 23: '6', 24: '7', 25: '7.1', 26: '8', 27: '8.1', 28: '9', 29: '10', 30: '11' };
  if (m && byApi[m[1]]) androidReq = `Android ${byApi[m[1]]} or newer`;
}

const tokens = {
  REPO: repo,
  REPO_URL: repoUrl,
  SITE_URL: siteUrl,
  DL: `${repoUrl}/releases/latest/download`,
  VERSION: pkg.version,
  YEAR: String(new Date().getFullYear()),
  WEAPONS: String(WEAPONS.length),
  COUNTRIES: String(new Set(WEAPONS.map((w) => w.country)).size),
  CHAPTER_COUNT: String(CHAPTERS.length),
  GAME_SIZE: gameSize,
  CHAPTERS: chapters,
  ARSENAL: arsenal,
  MARQUEE_A: row(0),
  MARQUEE_B: row(3),
  DRAW_CALLS: facts.drawCalls,
  MEM_HEAP: facts.memHeap,
  MEM_HEAP_NOTE: facts.memHeapNote,
  MEM_DESKTOP_NOTE: facts.memDesktopNote,
  ANDROID_REQ: androidReq,
};
let html = readFileSync(join(root, 'site/index.html'), 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => {
  if (!(key in tokens)) throw new Error(`site/index.html uses an unknown token ${all}`);
  return tokens[key];
});

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });
writeFileSync(join(out, 'index.html'), html);
writeFileSync(
  join(out, '404.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Not found · CORDITE</title><link rel="icon" href="${siteUrl}icon.png" /><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05070a;color:#e9edf0;font:18px/1.5 system-ui,sans-serif;text-align:center}a{color:#ffb22e}b{display:block;font-size:72px;letter-spacing:.1em}</style></head><body><p><b>404</b>Nothing at this grid reference.<br /><a href="${siteUrl}">Back to CORDITE</a></p></body></html>\n`,
);
for (const f of ['styles.css', 'app.js', 'icon.png']) cpSync(join(root, 'site', f), join(out, f));
cpSync(join(root, 'site/img'), join(out, 'img'), { recursive: true });
const fonts = {
  'oxanium.woff2': '@fontsource-variable/oxanium/files/oxanium-latin-wght-normal.woff2',
  'barlow-400.woff2': '@fontsource/barlow-condensed/files/barlow-condensed-latin-400-normal.woff2',
  'barlow-500.woff2': '@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2',
  'barlow-600.woff2': '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2',
  'sharetech.woff2': '@fontsource/share-tech-mono/files/share-tech-mono-latin-400-normal.woff2',
};
for (const [name, from] of Object.entries(fonts)) cpSync(join(root, 'node_modules', from), join(out, 'fonts', name));
cpSync(join(root, 'dist'), join(out, 'play'), { recursive: true });
writeFileSync(join(out, '.nojekyll'), '');

console.log(`site: ${WEAPONS.length} weapons, ${CHAPTERS.length} chapters, game ${gameSize}, total ${(dirSize(out) / 1048576).toFixed(1)} MB -> _site/`);
