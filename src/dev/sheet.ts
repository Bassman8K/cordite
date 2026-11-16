// Developer tool: renders every weapon model to a contact sheet. Open /dev.html while running
// `npm run dev`. Query: ?cls=assault to filter by class, ?mono=1 for UI-style silhouettes.

import * as THREE from 'three';
import { weaponIcon } from '../gfx/icons';
import { WEAPONS } from '../game/weapons/data';

const params = new URLSearchParams(location.search);
const cls = params.get('cls');
const mono = params.get('mono') === '1';
const ids = params.get('ids')?.split(',');
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
const grid = document.getElementById('grid') as HTMLElement;
const big = params.get('big') === '1';
if (big) grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(460px, 1fr))';
let failed = 0;
const list = WEAPONS.filter((w) => (!cls || w.cls === cls) && (!ids || ids.includes(w.id)));
for (const w of list) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  try {
    const img = new Image();
    img.src = big ? weaponIcon(renderer, w, 920, 345, mono) : weaponIcon(renderer, w, 400, 150, mono);
    cell.append(img);
  } catch (e) {
    failed++;
    cell.append(`ERROR ${(e as Error).message}`);
    console.error(w.id, e);
  }
  const label = document.createElement('div');
  label.innerHTML = `<b>${w.name}</b><br>${w.calLabel} · ${w.year}`;
  cell.append(label);
  grid.append(cell);
}
(document.getElementById('title') as HTMLElement).textContent += ` — ${list.length} models, ${failed} failed`;
(window as unknown as { __sheetDone: boolean }).__sheetDone = true;
