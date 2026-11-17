import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Emits a tiny service worker that precaches the built files, so the game installs as an app
 * (Add to Home Screen on iOS / Android) and keeps working offline.
 */
function offlinePlugin(): Plugin {
  return {
    name: 'cordite-offline',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const art = existsSync('public/art') ? readdirSync('public/art').filter((f) => f.endsWith('.jpg')).map((f) => `art/${f}`) : [];
      const recorded = existsSync('public/audio') ? readdirSync('public/audio').filter((f) => /\.(mp3|flac|json)$/.test(f)).map((f) => `audio/${f}`) : [];
      const surfaces = existsSync('public/tex') ? readdirSync('public/tex').filter((f) => f.endsWith('.jpg')).map((f) => `tex/${f}`) : [];
      const extra = ['./', 'manifest.webmanifest', 'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', ...art, ...recorded, ...surfaces];
      const hash = createHash('sha1').update(files.join('|') + recorded.join('|') + surfaces.join('|') + pkg.version).digest('hex').slice(0, 10);
      const source = `const CACHE = 'cordite-${hash}';
const FILES = ${JSON.stringify([...extra, ...files])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Pages: network first so updates arrive; everything else is content-hashed, so cache first.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return r; }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Locks the shipped page down: no remote scripts, no remote connections. */
function cspPlugin(): Plugin {
  return {
    name: 'cordite-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'";
      return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: ['es2020', 'safari15'],
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    sourcemap: false,
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  plugins: [offlinePlugin(), cspPlugin()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
