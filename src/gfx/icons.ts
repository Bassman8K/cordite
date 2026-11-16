// Renders weapon models to small images for the UI (armory grid, HUD, loadout cards).
// Uses the game's own renderer with an off-screen target, so no second WebGL context is needed.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWeaponModel, disposeWeaponModel } from '../game/weapons/model';
import type { WeaponDef } from '../game/weapons/types';

let studio: THREE.Texture | null = null;

/** Neutral studio lighting used for the armory showroom and icons. */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (studio) return studio;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  studio = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return studio;
}

const cache = new Map<string, string>();
let scene: THREE.Scene | null = null;
let cam: THREE.OrthographicCamera | null = null;
const targets = new Map<string, THREE.WebGLRenderTarget>();
const box = new THREE.Box3();
const size = new THREE.Vector3();
const centre = new THREE.Vector3();
let canvas2d: HTMLCanvasElement | null = null;
const mono = new THREE.MeshLambertMaterial({ color: 0xffffff });

/**
 * Side-on render of a weapon, muzzle to the right. `mono` gives a flat white, softly shaded
 * silhouette that CSS can tint; otherwise the real materials are used.
 */
export function weaponIcon(renderer: THREE.WebGLRenderer, def: WeaponDef, w = 320, h = 120, monochrome = true): string {
  const key = `${def.id}|${w}|${h}|${monochrome ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!scene) {
    scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2);
    const key1 = new THREE.DirectionalLight(0xffffff, 2.4);
    key1.position.set(2, 3, -1);
    scene.add(hemi, key1);
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  }
  const s = scene;
  const c = cam as THREE.OrthographicCamera;
  const tk = `${w}x${h}`;
  let rt = targets.get(tk);
  if (!rt) {
    rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    targets.set(tk, rt);
  }
  const model = buildWeaponModel(def, true);
  s.add(model.group);
  s.environment = monochrome ? null : studioEnvironment(renderer);
  s.overrideMaterial = monochrome ? mono : null;
  box.setFromObject(model.group);
  box.getSize(size);
  box.getCenter(centre);
  // Thrown and melee items are small: give them breathing room; guns fill the frame.
  const pad = def.slot === 'gun' ? 1.08 : 1.5;
  const aspect = w / h;
  const half = Math.max((size.z * pad) / 2 / aspect, (size.y * pad) / 2, 0.03);
  c.left = -half * aspect;
  c.right = half * aspect;
  c.top = half;
  c.bottom = -half;
  c.position.set(centre.x + 5, centre.y, centre.z);
  c.lookAt(centre.x, centre.y, centre.z);
  c.updateProjectionMatrix();

  const prevTarget = renderer.getRenderTarget();
  const prevColor = new THREE.Color();
  renderer.getClearColor(prevColor);
  const prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(s, c);
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.toneMapping = prevTone;
  s.remove(model.group);
  disposeWeaponModel(model);

  canvas2d ??= document.createElement('canvas');
  canvas2d.width = w;
  canvas2d.height = h;
  const ctx = canvas2d.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  // GL rows are bottom-up; the render target stores premultiplied alpha.
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      const a = px[src + x + 3];
      const k = a > 0 ? 255 / a : 0;
      img.data[dst + x] = Math.min(255, px[src + x] * k);
      img.data[dst + x + 1] = Math.min(255, px[src + x + 1] * k);
      img.data[dst + x + 2] = Math.min(255, px[src + x + 2] * k);
      img.data[dst + x + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas2d.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function clearIconCache(): void {
  cache.clear();
}
