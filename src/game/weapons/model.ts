// Procedural weapon models. A weapon's silhouette is assembled from its real dimensions
// (overall length, barrel length, capacity, calibre) plus the style tokens in its `look`.
// Space: origin at the firing hand, -Z towards the muzzle, +Y up, +X right. Units are metres.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../core/math';
import { CALIBERS } from './data';
import type { WeaponDef } from './types';

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  /** Where the eye sits when aiming (the view model moves this point onto the camera). */
  sight: THREE.Vector3;
  eject: THREE.Vector3;
  gripL: THREE.Vector3;
  mag: THREE.Object3D | null;
  /** Reciprocating part: slide, bolt, pump or (for rotary guns) the barrel cluster. */
  action: THREE.Object3D | null;
  actionTravel: number;
  spins: boolean;
  length: number;
  /** Extent behind the grip, used to keep long guns from clipping the camera. */
  rear: number;
}

const M = (color: number, rough: number, metal: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

const MAT = {
  steel: M(0x2b2d31, 0.42, 0.9),
  blued: M(0x1a1c21, 0.35, 0.92),
  park: M(0x4a4c4e, 0.62, 0.7),
  chrome: M(0xb9bcc0, 0.25, 1),
  poly: M(0x17181a, 0.72, 0.08),
  wood: M(0x6b4423, 0.62, 0.02),
  woodDark: M(0x40260f, 0.58, 0.02),
  woodLight: M(0x9a6a3a, 0.6, 0.02),
  tan: M(0x8d7a5b, 0.75, 0.08),
  green: M(0x3f4a34, 0.75, 0.08),
  grey: M(0x60646a, 0.7, 0.15),
  white: M(0xd8dadc, 0.7, 0.05),
  yellow: M(0xd9b21c, 0.6, 0.05),
  red: M(0x9a1f17, 0.6, 0.05),
  brass: M(0xb08a3c, 0.35, 0.9),
  rubber: M(0x0f0f10, 0.95, 0),
  glass: M(0x0a1420, 0.05, 0.95, { envMapIntensity: 2 }),
  lens: M(0x9cc4ee, 0.04, 0.0, { envMapIntensity: 1.2, transparent: true, opacity: 0.05, depthWrite: false }),
  clear: M(0x6f6452, 0.3, 0.1, { transparent: true, opacity: 0.55 }),
  dot: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  cloth: M(0x23271f, 0.95, 0),
  skin: M(0x1c1d1f, 0.9, 0),
};
type MatKey = keyof typeof MAT;

/** Collects primitive geometry per material so each model ends up as a handful of draw calls. */
class Kit {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();
  constructor(readonly hi: boolean) {}

  private add(mat: MatKey, g: THREE.BufferGeometry): void {
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
  }

  /** Box centred at (x, y, z): w across, h tall, l along the barrel; rx tilts it about the X axis. */
  box(mat: MatKey, w: number, h: number, l: number, x: number, y: number, z: number, rx = 0, round = 0, ry = 0, rz = 0): void {
    const r = Math.min(round, w / 2 - 1e-4, h / 2 - 1e-4, l / 2 - 1e-4);
    const g: THREE.BufferGeometry = this.hi && r > 0.0015 ? new RoundedBoxGeometry(w, h, l, 2, r) : new THREE.BoxGeometry(w, h, l);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  /** Cylinder centred at (x, y, z) along the given axis; r2 = radius at the far (-Z / +Y / +X) end. */
  cyl(mat: MatKey, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z', r2 = r, sides = 0, open = false): void {
    const n = sides || (this.hi ? (open ? 24 : 14) : 7);
    const g = new THREE.CylinderGeometry(r2, r, len, n, 1, open);
    if (axis === 'z') g.rotateX(-Math.PI / 2);
    else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  /** Thin ring facing along the barrel (sight rims, reticles). */
  ring(mat: MatKey, r: number, thickness: number, x: number, y: number, z: number): void {
    const g = new THREE.TorusGeometry(r, thickness, this.hi ? 6 : 4, this.hi ? 28 : 10);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  /** Cylinder between two points along Z (start is the rear end). */
  tube(mat: MatKey, r: number, zRear: number, zFront: number, y: number, x = 0, r2 = r): void {
    this.cyl(mat, r, Math.abs(zRear - zFront), x, y, (zRear + zFront) / 2, 'z', r2);
  }

  sphere(mat: MatKey, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void {
    const g = new THREE.SphereGeometry(r, this.hi ? 12 : 6, this.hi ? 8 : 4);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, geos] of this.parts) {
      const flat = geos.map((g) => {
        const q = g.index ? g.toNonIndexed() : g;
        if (q !== g) g.dispose();
        q.deleteAttribute('uv');
        return q;
      });
      const merged = flat.length === 1 ? flat[0] : mergeGeometries(flat, false);
      if (flat.length > 1) for (const g of flat) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, MAT[mat]);
      mesh.name = mat;
      group.add(mesh);
    }
    return group;
  }

  get empty(): boolean {
    return this.parts.size === 0;
  }
}

interface Ctx {
  d: WeaponDef;
  o: Set<string>;
  main: Kit;
  mag: Kit;
  act: Kit;
  hi: boolean;
  out: WeaponModel;
  metal: MatKey;
  furn: MatKey;
  boreY: number;
}

function furniture(o: Set<string>, fallback: MatKey): MatKey {
  if (o.has('wood')) return 'wood';
  if (o.has('tan')) return 'tan';
  if (o.has('green')) return 'green';
  if (o.has('grey')) return 'grey';
  if (o.has('white')) return 'white';
  if (o.has('yellow')) return 'yellow';
  return fallback;
}

function calSize(d: WeaponDef): { r: number; depth: number; pitch: number; cls: number } {
  // Bore radius, magazine fore-aft depth and per-round stack pitch by cartridge family.
  const g = d.bulletG * d.pellets;
  if (d.pellets > 1) return { r: 0.0105, depth: 0.082, pitch: 0.019, cls: 3 };
  if (d.energy > 9000) return { r: 0.0135, depth: 0.145, pitch: 0.019, cls: 4 };
  if (d.energy > 2400) return { r: 0.0092, depth: 0.076, pitch: 0.0062, cls: 2 };
  if (d.energy > 1150 || d.cal === '9x39' || d.cal === '.300blk') return { r: 0.0078, depth: 0.062, pitch: 0.0056, cls: 1 };
  return { r: g > 12 ? 0.0085 : 0.007, depth: 0.036, pitch: 0.0052, cls: 0 };
}

// ------------------------------------------------------------------ sights & optics

/**
 * Sights you look THROUGH must be hollow with clear lenses, or aiming would blank the screen.
 * Reflex / holographic sights are a thin frame with a glowing reticle; magnified scopes are solid
 * (the HUD draws their reticle and hides the model once the eye is on the glass).
 */
function optic(c: Ctx, z: number, y: number): number {
  const { o, main: k } = c;
  const scope = (len: number, r: number, bell: number) => {
    k.tube('blued', r, z + len * 0.5, z - len * 0.5, y + 0.034);
    k.tube('blued', bell, z - len * 0.5 + 0.005, z - len * 0.5 - 0.075, y + 0.034, 0, bell * 1.02);
    k.tube('blued', r * 1.25, z + len * 0.5 + 0.05, z + len * 0.5 - 0.005, y + 0.034);
    k.cyl('lens', bell * 0.92, 0.004, 0, y + 0.034, z - len * 0.5 - 0.076, 'z');
    k.cyl('lens', r * 1.1, 0.004, 0, y + 0.034, z + len * 0.5 + 0.051, 'z');
    k.cyl('blued', 0.011, 0.03, 0, y + 0.058, z, 'y');
    k.cyl('blued', 0.011, 0.03, 0.02, y + 0.034, z, 'x');
    k.box('blued', 0.02, 0.022, 0.022, 0, y + 0.012, z + len * 0.22);
    k.box('blued', 0.02, 0.022, 0.022, 0, y + 0.012, z - len * 0.22);
    c.out.sight.set(0, y + 0.034, z + len * 0.5 + 0.11);
    return y + 0.034;
  };
  if (o.has('scope12') || o.has('scope10')) return scope(0.3, 0.0165, 0.029);
  if (o.has('scope8') || o.has('scope6')) return scope(0.26, 0.015, 0.025);
  if (o.has('scope4') || o.has('pso') || o.has('zf') || o.has('pu') || o.has('scout')) return scope(o.has('pu') || o.has('scout') ? 0.17 : 0.2, 0.0135, o.has('pso') ? 0.021 : 0.018);
  if (o.has('acog') || o.has('susat')) {
    k.box('blued', 0.038, 0.04, 0.12, 0, y + 0.032, z, 0, 0.008);
    k.tube('blued', 0.02, z - 0.055, z - 0.1, y + 0.036, 0, 0.022);
    k.cyl('lens', 0.019, 0.004, 0, y + 0.036, z - 0.101, 'z');
    k.cyl('lens', 0.014, 0.004, 0, y + 0.036, z + 0.061, 'z');
    k.box('blued', 0.03, 0.014, 0.07, 0, y + 0.008, z);
    c.out.sight.set(0, y + 0.036, z + 0.14);
    return y + 0.036;
  }
  if (o.has('aug15')) {
    // Low-power carry-handle scope: a tube raised on two posts (magnified, so the HUD takes over).
    k.tube('poly', 0.017, z + 0.08, z - 0.08, y + 0.055);
    k.box('poly', 0.018, 0.045, 0.03, 0, y + 0.025, z + 0.06);
    k.box('poly', 0.018, 0.045, 0.03, 0, y + 0.025, z - 0.06);
    k.cyl('lens', 0.015, 0.004, 0, y + 0.055, z - 0.081, 'z');
    k.cyl('lens', 0.015, 0.004, 0, y + 0.055, z + 0.081, 'z');
    c.out.sight.set(0, y + 0.055, z + 0.17);
    return y + 0.055;
  }
  if (o.has('holo')) {
    // Holographic sight: an open rectangular window with a ring-and-dot reticle.
    const cy = y + 0.046;
    k.box('blued', 0.046, 0.012, 0.07, 0, y + 0.006, z);
    k.box('blued', 0.004, 0.05, 0.03, 0.023, cy, z - 0.012);
    k.box('blued', 0.004, 0.05, 0.03, -0.023, cy, z - 0.012);
    k.box('blued', 0.05, 0.004, 0.03, 0, cy + 0.027, z - 0.012);
    k.box('lens', 0.042, 0.05, 0.001, 0, cy, z - 0.02);
    k.ring('dot', 0.0055, 0.0005, 0, cy, z - 0.019);
    k.box('dot', 0.0012, 0.0012, 0.0006, 0, cy, z - 0.019);
    c.out.sight.set(0, cy, z + 0.14);
    return cy;
  }
  if (o.has('dot')) {
    // Reflex tube: only the two rims and a thin shell, so the target stays visible through it.
    const R = 0.0235;
    const cy = y + 0.048;
    k.cyl('blued', R, 0.06, 0, cy, z, 'z', R, 0, true);
    k.ring('blued', R, 0.0017, 0, cy, z + 0.03);
    k.ring('blued', R, 0.0017, 0, cy, z - 0.03);
    k.box('blued', 0.018, cy - y - R + 0.006, 0.036, 0, y + (cy - y - R) / 2, z);
    k.cyl('lens', R * 0.96, 0.001, 0, cy, z - 0.02, 'z');
    k.cyl('dot', 0.00075, 0.0006, 0, cy, z - 0.018, 'z', 0.00075, 10);
    c.out.sight.set(0, cy, z + 0.13);
    return cy;
  }
  return -1;
}

function bipod(c: Ctx, z: number, y: number): void {
  for (const s of [-1, 1]) {
    c.main.box('steel', 0.008, 0.2, 0.008, s * 0.045, y - 0.1, z, 0, 0, 0, s * 0.33);
    c.main.box('steel', 0.016, 0.006, 0.02, s * 0.079, y - 0.196, z);
  }
  c.main.box('steel', 0.03, 0.02, 0.03, 0, y - 0.006, z);
}

function muzzleDevice(c: Ctx, z: number, r: number): number {
  const { o, main: k, boreY: y } = c;
  if (o.has('sup')) {
    k.tube('blued', Math.max(0.018, r * 2.3), z + 0.02, z - 0.17, y);
    k.tube('blued', Math.max(0.014, r * 1.7), z - 0.17, z - 0.178, y);
    return z - 0.178;
  }
  if (o.has('bigbrake')) {
    k.box('steel', r * 4.6, r * 3.2, 0.085, 0, y, z - 0.035, 0, 0.004);
    k.box('poly', r * 4.8, r * 1.2, 0.016, 0, y, z - 0.02);
    k.box('poly', r * 4.8, r * 1.2, 0.016, 0, y, z - 0.052);
    return z - 0.078;
  }
  if (o.has('brake')) {
    k.tube('steel', r * 1.75, z + 0.005, z - 0.05, y);
    k.box('poly', r * 3.6, r * 0.9, 0.012, 0, y, z - 0.025);
    return z - 0.05;
  }
  if (o.has('hider')) {
    k.tube('steel', r * 1.6, z + 0.005, z - 0.045, y, 0, r * 2.1);
    return z - 0.045;
  }
  if (o.has('flare')) {
    k.tube('brass', r * 1.6, z + 0.12, z, y, 0, r * 4.2);
    return z;
  }
  return z;
}

function irons(c: Ctx, zRear: number, zFront: number, y: number, tall = 0.03): void {
  const k = c.main;
  k.box('steel', 0.004, tall, 0.006, 0, y + tall / 2, zFront);
  k.box('steel', 0.014, 0.006, 0.014, 0, y + 0.002, zFront);
  k.box('steel', 0.006, tall * 0.8, 0.006, 0.008, y + tall * 0.4, zRear);
  k.box('steel', 0.006, tall * 0.8, 0.006, -0.008, y + tall * 0.4, zRear);
  k.box('steel', 0.024, 0.006, 0.012, 0, y + 0.002, zRear);
}

// ------------------------------------------------------------------ magazines

function magazine(c: Ctx, z: number, yTop: number): void {
  const { d, o, mag: k } = c;
  const cs = calSize(d);
  const cap = d.mag;
  const h = clamp(0.035 + cap * cs.pitch * (o.has('bigmag') ? 0.75 : 1), 0.055, o.has('longmag') ? 0.3 : 0.26);
  const mat: MatKey = o.has('clearmag') ? 'clear' : c.metal === 'blued' ? 'steel' : 'park';
  const w = cs.cls === 3 ? 0.05 : cs.cls >= 2 ? 0.026 : 0.022;
  if (d.feed === 'drum') {
    const r = cs.cls === 3 ? 0.098 : cs.cls >= 1 ? 0.086 : 0.074;
    k.cyl(mat, r, cs.depth + 0.012, 0, yTop - r - 0.012, z, 'z');
    k.cyl('steel', r * 0.22, cs.depth + 0.024, 0, yTop - r - 0.012, z, 'z');
    k.box(mat, w, 0.04, cs.depth, 0, yTop - 0.012, z);
  } else if (d.feed === 'pan') {
    k.cyl(mat, 0.128, 0.032, 0, yTop + 0.105, z + 0.02, 'y');
    k.cyl('steel', 0.03, 0.04, 0, yTop + 0.108, z + 0.02, 'y');
  } else if (d.feed === 'belt') {
    k.box(o.has('drumbelt') ? 'park' : 'green', 0.075, 0.105, 0.11, -0.03, yTop - 0.06, z, 0, 0.012);
    for (let i = 0; i < 5; i++) k.cyl('brass', 0.0055, cs.depth * 0.75, -0.012 + i * 0.011, yTop + 0.012 - i * 0.002, z - 0.005, 'z');
  } else if (d.feed === 'helical') {
    k.tube(mat, 0.03, z + 0.02, z - 0.2, yTop - 0.012);
  } else if (o.has('side')) {
    k.box(mat, h, w, cs.depth, -(0.024 + h / 2), yTop + 0.03, z);
  } else if (o.has('top')) {
    k.box(mat, w, h * 0.5, cs.depth, 0, yTop + 0.075 + h * 0.25, z, 0.12);
    k.box(mat, w, h * 0.5, cs.depth, 0, yTop + 0.07 + h * 0.72, z - 0.014, 0.3);
  } else if (o.has('gripmag')) {
    k.box(mat, 0.02, 0.06 + h * 0.5, cs.depth - 0.004, 0, -0.1 - h * 0.25, 0.05, -0.28);
  } else if (o.has('curve')) {
    // Three stacked segments, each leaning further forward, read as a banana magazine.
    const seg = h / 3;
    let y = yTop;
    let zz = z;
    let rx = 0.06;
    for (let i = 0; i < 3; i++) {
      k.box(mat, w, seg + 0.006, cs.depth, 0, y - seg / 2, zz - Math.sin(rx) * seg * 0.5, rx, 0.003);
      y -= Math.cos(rx) * seg;
      zz -= Math.sin(rx) * seg;
      rx += d.cal === '7.62x39' || d.cal === '7.92x33' ? 0.24 : 0.13;
    }
  } else {
    k.box(mat, w, h, cs.depth, 0, yTop - h / 2, z - h * 0.03, 0.05, 0.003);
    k.box('steel', w + 0.003, 0.008, cs.depth + 0.003, 0, yTop - h + 0.002, z - h * 0.05, 0.05);
  }
}

// ------------------------------------------------------------------ long guns

function stock(c: Ctx, z0: number, z1: number, kind: string, y: number): void {
  const k = c.main;
  const len = z1 - z0;
  if (len < 0.03 || kind === 'nostock') return;
  const f = c.furn;
  const mid = (z0 + z1) / 2;
  if (kind === 'wood') {
    k.box(f, 0.038, 0.062, len * 0.55, 0, y - 0.022, z0 + len * 0.27, 0.2, 0.012);
    k.box(f, 0.042, 0.115, len * 0.56, 0, y - 0.058, z0 + len * 0.72, 0.1, 0.014);
    k.box('steel', 0.04, 0.12, 0.008, 0, y - 0.07, z1 - 0.002, 0.1);
  } else if (kind === 'tele') {
    k.tube('steel', 0.0135, z0, z1 - 0.03, y);
    k.box(f, 0.04, 0.045, len * 0.62, 0, y - 0.002, z0 + len * 0.66, 0, 0.008);
    k.box(f, 0.038, 0.1, len * 0.3, 0, y - 0.045, z1 - len * 0.16, 0.25, 0.008);
    k.box('rubber', 0.04, 0.125, 0.012, 0, y - 0.03, z1 - 0.005);
  } else if (kind === 'skel') {
    k.box(f, 0.02, 0.022, len, 0, y + 0.004, mid, 0, 0.004);
    k.box(f, 0.02, 0.02, len * 0.92, 0, y - 0.075, mid + len * 0.03, 0.22, 0.004);
    k.box(f, 0.03, 0.125, 0.022, 0, y - 0.04, z1 - 0.011, 0, 0.004);
    k.box(f, 0.028, 0.03, len * 0.35, 0, y + 0.026, mid + len * 0.05, 0, 0.006);
  } else if (kind === 'wire') {
    for (const s of [-1, 1]) k.tube('steel', 0.004, z0, z1, y - 0.012, s * 0.017);
    k.box('steel', 0.042, 0.075, 0.008, 0, y - 0.03, z1 - 0.004);
  } else if (kind === 'fold') {
    k.box('steel', 0.03, 0.04, 0.03, 0, y - 0.004, z0 + 0.015);
    k.box(f, 0.03, 0.05, len - 0.03, 0, y - 0.006, mid + 0.015, 0, 0.008);
    k.box(f, 0.032, 0.115, len * 0.3, 0, y - 0.038, z1 - len * 0.15, 0.1, 0.01);
    k.box('rubber', 0.034, 0.125, 0.01, 0, y - 0.035, z1 - 0.004);
  } else if (kind === 'chassis') {
    k.box(f, 0.034, 0.05, len, 0, y - 0.03, mid, 0, 0.01);
    k.box(f, 0.03, 0.03, len * 0.45, 0, y + 0.018, mid + len * 0.08, 0, 0.01);
    k.box(f, 0.034, 0.1, len * 0.3, 0, y - 0.085, z1 - len * 0.17, 0.2, 0.01);
    k.box('rubber', 0.04, 0.135, 0.016, 0, y - 0.06, z1 - 0.006, 0, 0.004);
  } else {
    // 'fixed'
    k.box(f, 0.036, 0.06, len, 0, y - 0.012, mid, 0.04, 0.012);
    k.box(f, 0.038, 0.115, len * 0.45, 0, y - 0.045, z1 - len * 0.24, 0.16, 0.012);
    k.box('rubber', 0.04, 0.13, 0.012, 0, y - 0.05, z1 - 0.004);
  }
}

function pistolGrip(c: Ctx, wood = false): void {
  c.main.box(wood ? 'wood' : c.furn === 'wood' || c.furn === 'woodLight' ? 'woodDark' : c.furn, 0.03, 0.1, 0.044, 0, -0.058, 0.03, -0.28, 0.008);
}

function triggerGroup(c: Ctx, z = -0.02, y = -0.012): void {
  const k = c.main;
  k.box('steel', 0.006, 0.005, 0.075, 0, y - 0.033, z);
  k.box('steel', 0.006, 0.036, 0.005, 0, y - 0.016, z - 0.036);
  k.box('steel', 0.004, 0.022, 0.006, 0, y - 0.012, z + 0.006, -0.3);
}

function longGun(c: Ctx): void {
  const { d, o, main: k } = c;
  const style = d.look.style;
  const cs = calSize(d);
  const L = d.length;
  const B = d.barrel > 0 ? d.barrel : L * 0.4;
  const bull = style === 'bullpup' || o.has('bullpup');
  const gripMag = o.has('gripmag');
  const y = (c.boreY = bull ? 0.058 : 0.046);
  const chamber = bull ? 0.13 : gripMag ? 0.02 : -0.125;
  let muzzle = chamber - B;
  const butt = Math.max(chamber + (L - B), bull ? 0.26 : 0.05);
  const heavy = style === 'chassis' || style === 'amr' || style === 'lmg' || o.has('bipod');
  const br = cs.r * (heavy ? 1.45 : 1.15) + 0.0035;
  const wooden = style === 'woodrifle' || style === 'lever' || style === 'musket' || style === 'double';
  const metal = c.metal;
  const f = c.furn;
  let topY = y + 0.03;
  let railFront = chamber - 0.02;

  // ---- receiver and body
  if (style === 'p90') {
    k.box(f, 0.05, 0.125, 0.2, 0, 0.005, 0.15, 0, 0.02);
    k.box(f, 0.046, 0.09, 0.2, 0, 0.02, -0.06, 0, 0.018);
    k.box(f, 0.03, 0.06, 0.05, 0, -0.055, -0.115, 0.3, 0.01);
    k.box('clear', 0.05, 0.022, 0.27, 0, 0.083, 0.03, 0, 0.004);
    k.tube(metal, 0.011, -0.16, muzzle, y);
    topY = 0.095;
    railFront = -0.1;
    c.out.gripL.set(0, -0.05, -0.115);
  } else if (bull) {
    const g11 = o.has('g11');
    k.box(f, 0.05, g11 ? 0.115 : 0.1, butt + 0.06, 0, y - 0.03, butt / 2 - 0.03, 0, 0.014);
    k.box('rubber', 0.052, 0.12, 0.014, 0, y - 0.03, butt - 0.005);
    const fore = clamp(B - chamber - 0.2, 0.1, g11 ? 0.42 : 0.28);
    k.box(f, g11 ? 0.05 : 0.042, g11 ? 0.11 : 0.058, fore, 0, y - (g11 ? 0.03 : 0.012), -0.06 - fore / 2, 0, 0.012);
    if (o.has('fgrip')) k.box(f, 0.028, 0.095, 0.03, 0, y - 0.085, -0.17, 0.1, 0.008);
    if (d.look.style === 'pump') {
      c.act.box(f, 0.05, 0.05, 0.14, 0, y - 0.03, -0.2, 0, 0.012);
      c.out.actionTravel = 0.07;
    }
    topY = y + (g11 ? 0.03 : 0.022);
    railFront = -0.06 - fore;
    c.out.gripL.set(0, y - 0.06, o.has('fgrip') ? -0.17 : -0.06 - fore * 0.6);
    if (!g11) pistolGrip(c);
    triggerGroup(c);
  } else if (style === 'smg' && o.has('tube')) {
    // Tubular receiver (Sten, Sterling, M3, Owen).
    k.tube(metal, 0.021, 0.16, chamber - 0.03, y);
    if (o.has('shroud')) k.tube('steel', 0.019, chamber - 0.03, muzzle + 0.03, y);
    k.box(metal, 0.03, 0.05, 0.11, 0, y - 0.035, 0.0, 0, 0.006);
    c.out.gripL.set(o.has('side') ? -0.07 : 0, y - 0.03, chamber - 0.07);
    railFront = chamber - 0.05;
    topY = y + 0.021;
    pistolGrip(c, o.has('wood'));
    triggerGroup(c);
  } else if (wooden) {
    const wrist = style === 'musket' ? 0.24 : 0.2;
    const recLen = style === 'double' ? 0.11 : style === 'lever' ? 0.19 : 0.21;
    k.box(metal, 0.034, 0.046, recLen, 0, y - 0.004, chamber + recLen / 2 - 0.03, 0, 0.008);
    // One-piece stock: wrist, then the butt dropping away behind it.
    const sf: MatKey = f === 'poly' ? 'wood' : f;
    k.box(sf, 0.036, 0.05, wrist, 0, y - 0.038, 0.06, 0.3, 0.014);
    k.box(sf, 0.042, 0.11, butt - 0.1, 0, y - 0.075, (butt + 0.14) / 2, 0.12, 0.016);
    k.box('steel', 0.04, 0.115, 0.007, 0, y - 0.09, butt - 0.002, 0.12);
    const foreLen = style === 'musket' ? B * 0.9 : style === 'double' ? 0.24 : clamp(B * (o.has('bolt') || style === 'woodrifle' ? 0.74 : 0.42), 0.16, 0.9);
    k.box(sf, 0.04, 0.036, foreLen + 0.1, 0, y - 0.026, chamber - foreLen / 2 + 0.05, 0, 0.012);
    if (style === 'woodrifle' && !o.has('single') && foreLen > 0.3) {
      k.box(sf, 0.03, 0.016, foreLen * 0.7, 0, y + 0.014, chamber - foreLen * 0.52, 0, 0.006);
      for (const t of [0.45, 0.92]) k.box('steel', 0.044, 0.05, 0.012, 0, y - 0.012, chamber - foreLen * t);
    }
    if (style === 'musket') {
      k.tube('woodDark', 0.0045, chamber - 0.1, muzzle + 0.04, y - 0.036);
      k.box('steel', 0.01, 0.045, 0.1, 0.022, y, chamber + 0.03);
      k.box('steel', 0.008, 0.05, 0.012, 0.024, y + 0.035, chamber + 0.05, 0.5);
      for (const t of [0.3, 0.62, 0.92]) k.box('brass', 0.044, 0.046, 0.012, 0, y - 0.014, chamber - foreLen * t);
    }
    if (style === 'lever' || o.has('tube')) k.tube(metal, style === 'lever' && o.has('fat') ? 0.014 : 0.0095, chamber - 0.05, muzzle + (style === 'lever' ? 0.03 : B * 0.3), y - 0.022 - br);
    if (style === 'lever') {
      c.act.box('steel', 0.008, 0.008, 0.1, 0, y - 0.07, 0.03);
      c.act.box('steel', 0.008, 0.05, 0.008, 0, y - 0.05, 0.08);
      c.act.box('steel', 0.008, 0.035, 0.008, 0, y - 0.052, -0.02);
      c.out.actionTravel = -0.045;
    } else triggerGroup(c, -0.01, y - 0.05);
    if (o.has('bolt')) {
      c.act.tube('chrome', 0.008, chamber + 0.16, chamber + 0.02, y + 0.012);
      c.act.box('chrome', 0.05, 0.008, 0.008, 0.03, y + 0.004, chamber + 0.15, 0, 0, 0, -0.5);
      c.act.sphere('chrome', 0.011, 0.056, y - 0.012, chamber + 0.15);
      c.out.actionTravel = 0.085;
    }
    if (style === 'double') {
      k.box('steel', 0.004, 0.02, 0.008, 0, y + 0.03, chamber + 0.05);
    }
    c.out.gripL.set(0, y - 0.045, chamber - Math.min(foreLen * 0.55, 0.3));
    topY = y + (style === 'woodrifle' ? 0.022 : 0.02);
    railFront = chamber - 0.1;
  } else {
    // Modern receivers: ak / ar / g3 / fal / mod / smg / chassis / amr / lmg / pump / glpump / hmg.
    const big = style === 'amr' || style === 'hmg';
    const rw = big ? 0.062 : style === 'lmg' ? 0.052 : 0.044;
    const rh = big ? 0.095 : style === 'lmg' ? 0.075 : style === 'ak' ? 0.058 : 0.064;
    const rz0 = chamber - (style === 'lmg' ? 0.06 : 0.035);
    const rz1 = big ? 0.2 : style === 'lmg' ? 0.12 : gripMag ? 0.1 : 0.075;
    k.box(metal, rw, rh, rz1 - rz0, 0, y - (style === 'ak' ? 0.006 : 0.002), (rz0 + rz1) / 2, 0, 0.008);
    if (style === 'ak') k.box(metal, rw * 0.9, 0.018, (rz1 - rz0) * 0.8, 0, y + 0.03, (rz0 + rz1) / 2 + 0.01, 0, 0.007);
    if (style === 'ar') {
      k.box(metal, 0.04, 0.05, 0.075, 0, y - 0.045, -0.085, 0, 0.004);
      k.box(metal, 0.012, 0.014, 0.03, 0.026, y + 0.004, 0.035);
    }
    topY = y + rh / 2 + (style === 'ak' ? 0.012 : 0);
    // Stock
    const kind = o.has('nostock') ? 'nostock' : o.has('tele') ? 'tele' : o.has('wire') ? 'wire' : o.has('skel') ? 'skel' : o.has('fold') ? 'fold'
      : style === 'chassis' || style === 'amr' ? 'chassis' : f === 'wood' && (style === 'ak' || style === 'fal' || style === 'lmg' || style === 'smg' || style === 'pump' || style === 'glpump' || style === 'g3' || style === 'mod') ? 'wood' : style === 'hmg' ? 'nostock' : 'fixed';
    stock(c, rz1 - 0.01, butt, kind, y - 0.004);
    if (style === 'hmg') {
      for (const s of [-1, 1]) k.cyl('wood', 0.016, 0.11, s * 0.045, y - 0.01, rz1 + 0.05, 'y');
      k.box(metal, 0.12, 0.012, 0.012, 0, y + 0.04, rz1 + 0.05);
      k.box(metal, 0.12, 0.012, 0.012, 0, y - 0.06, rz1 + 0.05);
    }
    // Straight-stocked wooden pump guns have no separate pistol grip.
    if (!(kind === 'wood' && (style === 'pump' || style === 'glpump'))) pistolGrip(c, o.has('wood') && style !== 'ak');
    triggerGroup(c);
    // Handguard
    let hg = clamp(B * (style === 'chassis' ? 0.5 : style === 'lmg' ? 0.36 : 0.56), 0.07, style === 'chassis' || style === 'amr' ? 0.4 : 0.33);
    hg = Math.min(hg, Math.max(0.05, rz0 - muzzle - 0.05));
    const hz = rz0 - hg / 2;
    railFront = rz0 - hg;
    c.out.gripL.set(0, y - 0.05, rz0 - hg * 0.55);
    const hf: MatKey = f;
    if (style === 'ak') {
      k.box(hf, 0.042, 0.042, hg, 0, y - 0.014, hz, 0, 0.01);
      k.box(hf, 0.032, 0.024, hg * 0.72, 0, y + 0.03, hz + hg * 0.1, 0, 0.008);
      k.tube('steel', 0.007, rz0 - hg * 0.8, rz0 - hg - 0.07, y + 0.03);
      k.box('steel', 0.02, 0.05, 0.022, 0, y + 0.012, rz0 - hg - 0.075);
    } else if (style === 'ar' && !o.has('rail')) {
      k.tube(hf, 0.027, rz0, rz0 - hg, y, 0, 0.022);
      k.box('steel', 0.012, 0.065, 0.02, 0, y + 0.03, rz0 - hg - 0.02);
      k.box('steel', 0.026, 0.02, 0.03, 0, y, rz0 - hg - 0.02);
    } else if (style === 'g3') {
      k.box(hf, 0.04, 0.05, hg, 0, y - 0.012, hz, 0, 0.012);
      k.tube('steel', 0.011, rz0, rz0 - hg - 0.06, y + 0.032);
      k.tube('steel', 0.016, rz0 - hg - 0.05, rz0 - hg - 0.075, y + 0.03);
    } else if (style === 'fal') {
      k.box(hf, 0.042, 0.052, hg, 0, y - 0.004, hz, 0, 0.014);
      k.box('steel', 0.012, 0.045, 0.018, 0, y + 0.03, rz0 - hg - 0.03);
      k.box('steel', 0.01, 0.01, 0.1, 0.03, y + 0.02, rz0 + 0.07);
    } else if (style === 'chassis' || style === 'amr') {
      k.box(hf, 0.046, 0.042, hg, 0, y - 0.034, hz, 0, 0.012);
      if (style === 'amr') k.box(metal, 0.05, 0.05, hg * 0.9, 0, y + 0.004, hz, 0, 0.008);
    } else if (style === 'lmg') {
      k.box(hf === 'wood' ? 'wood' : 'poly', 0.05, 0.045, hg, 0, y - 0.03, hz, 0, 0.012);
      k.tube('steel', 0.008, rz0, rz0 - hg - 0.1, y - 0.03);
      if (!o.has('shroud') && !o.has('fatshroud')) k.box('steel', 0.01, 0.01, 0.12, 0.012, y + 0.05, rz0 - 0.08, 0.2);
    } else if (style === 'pump' || style === 'glpump') {
      const tr = style === 'glpump' ? 0.014 : 0.0125;
      k.tube(metal, tr, rz0, muzzle + 0.03, y - (style === 'glpump' ? -0.045 : 0.026 + br * 0.5));
      c.act.box(hf === 'poly' ? 'poly' : 'wood', 0.046, 0.046, 0.16, 0, y - 0.03, rz0 - 0.16, 0, 0.016);
      c.out.actionTravel = 0.075;
      c.out.gripL.set(0, y - 0.045, rz0 - 0.16);
      if (o.has('shield')) k.tube('steel', br + 0.008, rz0 - 0.02, muzzle + 0.1, y + 0.004);
    } else if (style === 'hmg') {
      k.tube('steel', 0.034, rz0, rz0 - 0.3, y);
    } else {
      // 'mod' / rail / smg
      k.box(hf, 0.044, 0.054, hg, 0, y - 0.008, hz, 0, 0.01);
      if (o.has('rail') || style === 'mod') k.box('steel', 0.021, 0.008, hg + (rz1 - rz0) * 0.9, 0, topY + 0.004, rz0 - hg / 2 + (rz1 - rz0) * 0.45);
    }
    if (o.has('fgrip')) {
      k.box(f === 'wood' ? 'wood' : 'poly', 0.026, 0.09, 0.03, 0, y - 0.085, rz0 - hg * 0.6, 0.08, 0.008);
      c.out.gripL.set(0, y - 0.085, rz0 - hg * 0.6);
    }
    if (o.has('shroud') && style !== 'pump') k.tube('steel', br + 0.012, rz0 - (style === 'lmg' ? 0.0 : hg), muzzle + 0.06, y);
    if (o.has('fatshroud')) k.tube('park', 0.05, rz0, muzzle + 0.05, y);
    // Charging handle / bolt handle
    if (d.modes[0] === 'bolt') {
      c.act.tube('chrome', 0.0085, chamber + 0.17, chamber + 0.03, y + 0.01);
      c.act.box('chrome', 0.052, 0.009, 0.009, 0.034, y + 0.002, chamber + 0.16, 0, 0, 0, -0.55);
      c.act.sphere(f === 'wood' ? 'chrome' : 'poly', 0.012, 0.06, y - 0.016, chamber + 0.16);
      c.out.actionTravel = 0.09;
    } else if (style !== 'pump' && style !== 'glpump') {
      c.act.box('steel', 0.014, 0.012, 0.03, 0.026, y + 0.012, chamber + 0.03);
      c.out.actionTravel = 0.05;
    }
  }

  // ---- barrel + muzzle
  if (style === 'double') {
    const ou = o.has('ou');
    for (const s of [-1, 1]) k.tube(c.metal, 0.0115, chamber, muzzle, y + (ou ? s * 0.012 : 0), ou ? 0 : s * 0.0118);
    k.box('steel', 0.004, 0.008, 0.008, 0, y + 0.02, muzzle + 0.02);
  } else if (style === 'glpump') {
    k.tube(c.metal, 0.026, chamber, muzzle, y);
  } else if (style !== 'p90') {
    k.tube(c.metal, br, chamber, muzzle, y, 0, style === 'musket' ? br * 0.85 : br * 0.92);
    if (o.has('fat')) k.tube(c.metal, 0.022, chamber, muzzle, y);
  }
  muzzle = muzzleDevice(c, muzzle, br);
  if (o.has('bayonet')) {
    k.box('chrome', 0.004, 0.022, 0.24, 0.0, y - 0.03, muzzle - 0.1);
    k.box('steel', 0.016, 0.03, 0.03, 0, y - 0.02, muzzle + 0.04);
  }
  if (o.has('bipod')) bipod(c, style === 'chassis' || style === 'amr' ? railFront + 0.04 : Math.max(muzzle + 0.12, railFront - 0.06), y - (style === 'ak' ? 0.012 : 0.03));

  // ---- magazine / feed
  if (!wooden || d.feed === 'box') {
    const mz = bull ? 0.185 : gripMag ? 0.03 : style === 'lmg' ? chamber + 0.05 : chamber + 0.045;
    if (d.feed !== 'tube' && d.feed !== 'single' && d.feed !== 'internal' && d.feed !== 'enbloc' && d.feed !== 'gate' && d.feed !== 'double' && style !== 'p90' && !o.has('g11')) {
      magazine(c, mz, y - (style === 'lmg' ? 0.035 : wooden ? 0.03 : 0.03));
    }
  }
  if ((d.feed === 'internal' || d.feed === 'enbloc') && !wooden) k.box(c.metal, 0.024, 0.02, 0.085, 0, y - 0.045, chamber + 0.045);
  if (wooden && (d.feed === 'internal' || d.feed === 'enbloc')) k.box(c.metal, 0.022, 0.018, 0.08, 0, y - 0.052, chamber + 0.04);
  if (d.feed === 'gate' && style !== 'woodrifle') {
    c.mag.cyl('steel', d.proj === 'grenade' ? 0.068 : 0.085, d.proj === 'grenade' ? 0.12 : 0.09, 0, y - (d.proj === 'grenade' ? 0.0 : 0.06), chamber + 0.03, 'z');
  }

  // ---- sights
  const hasHandle = o.has('handle');
  if (hasHandle) {
    k.box(c.metal, 0.014, 0.014, 0.15, 0, topY + 0.045, chamber + 0.08, 0, 0.004);
    k.box(c.metal, 0.014, 0.045, 0.016, 0, topY + 0.022, chamber + 0.145);
    k.box(c.metal, 0.014, 0.045, 0.016, 0, topY + 0.022, chamber + 0.015);
  }
  const opticZ = bull ? 0.02 : style === 'p90' ? 0.02 : chamber + (d.cls === 'sniper' || o.has('scope8') || o.has('scope6') ? 0.1 : 0.07);
  const oy = optic(c, opticZ, topY + (hasHandle && !o.has('aug15') ? 0.05 : 0));
  if (oy < 0) {
    const frontZ = style === 'ak' ? railFront - 0.075 : Math.max(muzzle + 0.03, railFront - (style === 'ar' ? 0.02 : 0.0));
    const rearZ = hasHandle ? chamber + 0.145 : style === 'ak' ? chamber - 0.02 : Math.min(butt - 0.25, chamber + 0.12);
    const sy = topY + (hasHandle ? 0.052 : 0);
    const tall = style === 'ak' || style === 'ar' ? 0.032 : 0.02;
    if (style === 'ak' || (style === 'ar' && !o.has('rail'))) {
      k.box('steel', 0.004, 0.022, 0.005, 0, sy + 0.02, frontZ);
      k.box('steel', 0.006, 0.02, 0.006, 0.008, sy + 0.012, rearZ);
      k.box('steel', 0.006, 0.02, 0.006, -0.008, sy + 0.012, rearZ);
    } else irons(c, rearZ, frontZ, sy - 0.002, tall);
    c.out.sight.set(0, sy + 0.024, Math.max(rearZ + 0.1, Math.min(butt - 0.17, rearZ + 0.3)));
    if (style === 'ak' || (style === 'ar' && !o.has('rail'))) c.out.sight.y = sy + 0.027;
    else c.out.sight.y = sy + tall * 0.75;
  }
  c.out.muzzle.set(0, y, muzzle);
  c.out.eject.set(0.03, y + 0.01, chamber + 0.03);
  c.out.rear = butt;
}

// ------------------------------------------------------------------ handguns

function pistol(c: Ctx): void {
  const { d, o, main: k, act } = c;
  const L = Math.max(0.13, d.length);
  const big = o.has('big');
  const y = (c.boreY = 0.036);
  const rear = 0.042;
  const front = rear - Math.min(L, 0.28);
  const sh = big ? 0.042 : 0.03;
  const sw = big ? 0.034 : 0.027;
  const wood = o.has('wood');
  const frame: MatKey = o.has('tan') ? 'tan' : o.has('yellow') ? 'yellow' : wood ? c.metal : 'poly';
  const exposed = o.has('exposed');
  // Frame + grip
  k.box(frame, sw - 0.002, 0.022, exposed ? 0.12 : rear - front - 0.01, 0, y - sh / 2 - 0.008, exposed ? rear - 0.06 : (rear + front) / 2 + 0.005, 0, 0.004);
  if (!o.has('c96')) k.box(wood ? 'wood' : frame === 'poly' ? 'poly' : 'rubber', sw + (wood ? 0.004 : 0), 0.105, 0.046, 0, -0.05, 0.026, -0.26, 0.009);
  else {
    k.box('wood', 0.03, 0.09, 0.034, 0, -0.055, 0.038, -0.5, 0.012);
    k.box(c.metal, 0.03, 0.06, 0.05, 0, y - 0.05, -0.06, 0, 0.004);
  }
  k.box('steel', 0.005, 0.004, 0.05, 0, y - sh / 2 - 0.045, -0.018);
  k.box('steel', 0.005, 0.03, 0.004, 0, y - sh / 2 - 0.032, -0.043);
  k.box('steel', 0.004, 0.02, 0.005, 0, y - sh / 2 - 0.026, -0.004, -0.3);
  // Slide / upper
  if (exposed) {
    const tubeR = o.has('fat') ? 0.017 : 0.0085;
    k.box(c.metal, sw, sh, 0.11, 0, y, rear - 0.055, 0, 0.006);
    k.tube(c.metal, tubeR, rear - 0.11, front, y);
    if (o.has('shroud')) k.tube('steel', 0.016, rear - 0.11, front + 0.03, y);
    act.box('steel', 0.02, 0.014, 0.03, 0, y + sh / 2 + 0.002, rear - 0.02);
    c.out.actionTravel = 0.025;
  } else {
    act.box(c.metal, sw, sh, rear - front, 0, y, (rear + front) / 2, 0, 0.006);
    act.box('steel', sw + 0.002, sh * 0.5, 0.03, 0, y - 0.002, rear - 0.02);
    k.tube('steel', 0.006, front + 0.02, front - 0.004, y);
    c.out.actionTravel = 0.04;
  }
  if (o.has('hammer')) k.box('steel', 0.006, 0.016, 0.01, 0, y + 0.002, rear + 0.005, 0.5);
  // Sights
  const sy = y + sh / 2;
  const host = exposed ? k : act;
  host.box('steel', 0.003, 0.006, 0.006, 0, sy + 0.003, front + 0.012);
  host.box('steel', 0.005, 0.006, 0.006, 0.007, sy + 0.003, rear - 0.01);
  host.box('steel', 0.005, 0.006, 0.006, -0.007, sy + 0.003, rear - 0.01);
  c.out.sight.set(0, sy + 0.0065, 0.42);
  if (o.has('dot')) {
    host.box('blued', 0.026, 0.004, 0.04, 0, sy + 0.002, rear - 0.04);
    host.box('blued', 0.003, 0.026, 0.004, 0.0125, sy + 0.016, rear - 0.058);
    host.box('blued', 0.003, 0.026, 0.004, -0.0125, sy + 0.016, rear - 0.058);
    host.box('blued', 0.028, 0.003, 0.004, 0, sy + 0.03, rear - 0.058);
    host.box('lens', 0.022, 0.024, 0.001, 0, sy + 0.016, rear - 0.057);
    host.box('dot', 0.0015, 0.0015, 0.001, 0, sy + 0.016, rear - 0.055);
    c.out.sight.set(0, sy + 0.016, 0.42);
  }
  // Magazine
  const ext = o.has('ext') || d.mag >= 30;
  if (!o.has('c96')) c.mag.box('steel', 0.02, 0.09 + (ext ? 0.07 : 0), 0.032, 0, -0.057 - (ext ? 0.035 : 0), 0.028 + (ext ? 0.009 : 0), -0.26, 0.003);
  else if (d.mag > 12) c.mag.box('steel', 0.022, 0.13, 0.034, 0, y - 0.14, -0.06);
  let muzzle = front;
  if (o.has('sup') && !o.has('fat')) {
    k.tube('blued', 0.016, front + 0.004, front - 0.16, y);
    muzzle = front - 0.16;
  }
  c.out.muzzle.set(0, y, muzzle);
  c.out.eject.set(0.02, y + 0.01, rear - 0.05);
  c.out.gripL.set(-0.012, -0.065, 0.02);
  c.out.rear = rear + 0.02;
}

function revolver(c: Ctx): void {
  const { d, o, main: k } = c;
  const big = o.has('big');
  const y = (c.boreY = 0.04);
  const B = clamp(d.barrel, 0.05, 0.22);
  const cr = big ? 0.024 : 0.019;
  const flare = o.has('flare');
  k.box(c.metal, 0.02, 0.058, 0.1, 0, y - 0.006, -0.012, 0, 0.004);
  k.box(c.metal, 0.016, 0.014, 0.06, 0, y + 0.03, -0.035);
  if (!flare) c.mag.cyl(c.metal, cr, 0.042, 0, y - 0.002, -0.036, 'z');
  if (!flare) for (let i = 0; i < 6; i++) c.mag.cyl('steel', cr * 0.26, 0.044, Math.cos((i / 6) * Math.PI * 2) * cr * 0.62, y - 0.002 + Math.sin((i / 6) * Math.PI * 2) * cr * 0.62, -0.036, 'z');
  const br = flare ? 0.017 : big ? 0.0125 : 0.0098;
  k.tube(c.metal, br, -0.06, -0.06 - B, y, 0, br * (flare ? 1 : 0.95));
  if (o.has('rib')) k.box(c.metal, 0.008, 0.008, B * 0.95, 0, y + br + 0.004, -0.06 - B / 2);
  k.box(c.metal, 0.012, 0.016, B * 0.5, 0, y - br - 0.006, -0.06 - B * 0.27);
  k.box(o.has('wood') ? 'wood' : 'rubber', 0.03, 0.1, 0.042, 0, -0.05, 0.036, -0.36, 0.012);
  k.box('steel', 0.006, 0.02, 0.012, 0, y + 0.03, 0.036, 0.6);
  k.box('steel', 0.005, 0.004, 0.05, 0, y - 0.058, -0.022);
  k.box('steel', 0.005, 0.026, 0.004, 0, y - 0.046, -0.046);
  k.box('steel', 0.004, 0.02, 0.005, 0, y - 0.042, -0.008, -0.3);
  k.box('steel', 0.003, 0.008, 0.006, 0, y + br + (o.has('rib') ? 0.012 : 0.004), -0.06 - B + 0.01);
  c.out.sight.set(0, y + 0.041, 0.42);
  c.out.muzzle.set(0, y, -0.06 - B);
  c.out.eject.set(0.02, y, -0.03);
  c.out.gripL.set(-0.012, -0.065, 0.02);
  c.out.rear = 0.06;
}

// ------------------------------------------------------------------ launchers & specials

function launcher(c: Ctx): void {
  const { d, o, main: k } = c;
  const style = d.look.style;
  const L = d.length;
  const f = c.furn;
  const y = (c.boreY = 0.085);
  const tubeMat: MatKey = f === 'poly' ? 'park' : f;
  let front = -L * 0.56;
  let back = L * 0.44;
  if (style === 'rpg') {
    front = -0.52;
    back = 0.43;
    k.tube('park', 0.022, back - 0.1, front, y);
    k.tube('park', 0.022, back, back - 0.12, y);
    k.tube('park', 0.046, back + 0.04, back - 0.09, y, 0, 0.022);
    k.tube('wood', 0.031, 0.22, -0.03, y);
    k.box('steel', 0.01, 0.07, 0.012, 0, y + 0.055, -0.2);
    k.box('steel', 0.01, 0.05, 0.012, 0, y + 0.045, 0.02);
    k.box('wood', 0.028, 0.09, 0.036, 0, y - 0.07, 0.03, -0.2, 0.008);
    k.box('wood', 0.028, 0.085, 0.034, 0, y - 0.07, 0.2, -0.15, 0.008);
    triggerGroup(c, -0.02, y - 0.035);
    // PG-7V warhead: stem, body, nose cone
    c.mag.tube('green', 0.02, front + 0.02, front - 0.12, y);
    c.mag.tube('green', 0.02, front - 0.12, front - 0.2, y, 0, 0.043);
    c.mag.tube('green', 0.043, front - 0.2, front - 0.36, y, 0, 0.036);
    c.mag.tube('green', 0.036, front - 0.36, front - 0.52, y, 0, 0.006);
    c.out.sight.set(-0.0, y + 0.085, 0.12);
    c.out.muzzle.set(0, y, front - 0.5);
    c.out.gripL.set(0, y - 0.07, 0.2);
  } else if (style === 'pzf') {
    const thin = o.has('thin');
    const r = thin ? 0.022 : 0.03;
    k.tube(tubeMat === 'park' ? 'grey' : tubeMat, r, back, front, y);
    const wr = thin ? 0.072 : 0.055;
    c.mag.tube(tubeMat === 'park' ? 'grey' : tubeMat, r, front + 0.01, front - 0.1, y, 0, wr);
    c.mag.tube(tubeMat === 'park' ? 'grey' : tubeMat, wr, front - 0.1, front - 0.22, y, 0, wr * 0.9);
    c.mag.tube(tubeMat === 'park' ? 'grey' : tubeMat, wr * 0.9, front - 0.22, front - 0.38, y, 0, 0.012);
    k.box('steel', 0.006, 0.07, 0.01, 0, y + 0.06, -0.12);
    if (!thin) {
      k.box('poly', 0.028, 0.09, 0.036, 0, y - 0.075, 0.03, -0.2, 0.008);
      k.box('poly', 0.028, 0.085, 0.034, 0, y - 0.075, -0.2, 0, 0.008);
      k.box('blued', 0.04, 0.05, 0.12, -0.055, y + 0.03, -0.02, 0, 0.008);
    } else k.box('steel', 0.012, 0.012, 0.1, 0, y + r + 0.006, -0.05);
    c.out.sight.set(thin ? 0 : -0.055, y + (thin ? 0.09 : 0.034), 0.12);
    c.out.muzzle.set(0, y, front - 0.36);
    c.out.gripL.set(0, y - 0.07, -0.2);
  } else if (style === 'm202') {
    k.box('green', 0.17, 0.17, L * 0.82, 0, y + 0.02, front * 0.3 + 0.08, 0, 0.012);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.tube('blued', 0.034, back * 0.7, front * 0.72 - 0.02, y + 0.02 + sy * 0.04, sx * 0.04);
    k.box('poly', 0.028, 0.09, 0.036, 0, y - 0.11, 0.03, -0.2, 0.008);
    k.box('steel', 0.03, 0.04, 0.08, -0.1, y + 0.07, -0.02);
    c.out.sight.set(-0.1, y + 0.085, 0.1);
    c.out.muzzle.set(0, y + 0.02, front * 0.72);
    c.out.gripL.set(0, y - 0.08, -0.22);
  } else if (style === 'piat') {
    k.tube('park', 0.042, 0.38, -0.2, y);
    k.box('park', 0.085, 0.045, 0.3, 0, y - 0.02, -0.35, 0, 0.012);
    k.box('rubber', 0.11, 0.07, 0.03, 0, y, 0.4, 0, 0.01);
    k.box('steel', 0.01, 0.2, 0.01, 0, y - 0.13, -0.16);
    c.mag.tube('park', 0.012, -0.2, -0.36, y + 0.012);
    c.mag.tube('green', 0.041, -0.36, -0.52, y + 0.012, 0, 0.036);
    c.mag.tube('green', 0.036, -0.52, -0.6, y + 0.012, 0, 0.008);
    k.box('poly', 0.028, 0.09, 0.036, 0, y - 0.085, 0.03, -0.2, 0.008);
    k.box('steel', 0.008, 0.06, 0.01, -0.05, y + 0.07, -0.1);
    c.out.sight.set(-0.05, y + 0.09, 0.12);
    c.out.muzzle.set(0, y + 0.012, -0.6);
    c.out.gripL.set(0, y - 0.06, -0.3);
  } else {
    // Generic shoulder tube: AT4, LAW, Carl Gustaf, SMAW, Bazooka, Panzerschreck, Javelin, Stinger...
    const r = o.has('thin') ? 0.036 : o.has('fat') ? 0.074 : 0.052;
    k.tube(tubeMat, r, back, front, y + (r - 0.05));
    k.tube('blued', r + 0.006, front + 0.05, front, y + (r - 0.05));
    k.tube('blued', r + 0.006, back, back - 0.05, y + (r - 0.05));
    if (o.has('venturi')) k.tube(tubeMat, r, back + 0.14, back, y + (r - 0.05), 0, r * 1.45);
    if (o.has('shield')) {
      k.box('park', 0.38, 0.3, 0.006, 0.02, y + 0.03, -0.28);
      k.box('glass', 0.07, 0.05, 0.008, -0.1, y + 0.1, -0.28);
    }
    const gy = y - 0.05 - 0.03;
    k.box('poly', 0.028, 0.09, 0.036, 0, gy - 0.03, 0.03, -0.2, 0.008);
    k.box('poly', 0.028, 0.085, 0.034, 0, gy - 0.03, -0.22, 0.05, 0.008);
    k.box('poly', 0.03, 0.03, 0.3, 0, gy + 0.02, -0.09, 0, 0.006);
    if (o.has('clu')) {
      k.box('green', 0.2, 0.15, 0.13, -0.11, y + 0.02, -0.1, 0, 0.02);
      k.cyl('glass', 0.035, 0.01, -0.11, y + 0.03, -0.17, 'z');
      c.out.sight.set(-0.11, y + 0.03, 0.08);
    } else if (o.has('scope4')) {
      k.box('blued', 0.04, 0.045, 0.14, -(r + 0.03), y + 0.06, -0.02, 0, 0.008);
      c.out.sight.set(-(r + 0.03), y + 0.062, 0.14);
    } else {
      k.box('steel', 0.006, 0.07, 0.008, -(r + 0.006), y + 0.07, -0.12);
      k.box('steel', 0.006, 0.07, 0.008, -(r + 0.006), y + 0.07, 0.05);
      c.out.sight.set(-(r + 0.006), y + 0.095, 0.16);
    }
    if (o.has('wood')) k.box('wood', 0.03, 0.05, 0.3, 0, gy + 0.03, 0.2, 0.1, 0.01);
    c.out.muzzle.set(0, y + (r - 0.05), front);
    c.out.gripL.set(0, gy - 0.03, -0.22);
  }
  c.out.eject.set(0, y, back);
  c.out.rear = back;
}

function grenadeLauncher(c: Ctx): void {
  const { d, o, main: k } = c;
  const style = d.look.style;
  const y = (c.boreY = 0.05);
  const B = clamp(d.barrel, 0.15, 0.36);
  const wood = o.has('wood');
  const f = wood ? 'wood' : c.furn;
  if (style === 'mgl') {
    c.mag.cyl('park', 0.066, 0.125, 0, y - 0.01, -0.09, 'z');
    for (let i = 0; i < 6; i++) c.mag.cyl('blued', 0.021, 0.128, Math.cos((i / 6) * Math.PI * 2) * 0.041, y - 0.01 + Math.sin((i / 6) * Math.PI * 2) * 0.041, -0.09, 'z');
    k.box('blued', 0.03, 0.03, 0.2, 0, y + 0.05, -0.08, 0, 0.004);
    k.tube('blued', 0.026, -0.155, -0.155 - B, y + 0.031);
    k.box('poly', 0.026, 0.09, 0.03, 0, y - 0.07, -0.26, 0.08, 0.008);
    pistolGrip(c);
    triggerGroup(c);
    stock(c, 0.04, Math.max(0.2, d.length - B - 0.19), o.has('tele') ? 'tele' : 'fold', y + 0.02);
    optic(c, -0.08, y + 0.065);
    if (!o.has('dot')) c.out.sight.set(0, y + 0.09, 0.14);
    c.out.muzzle.set(0, y + 0.031, -0.155 - B);
    c.out.gripL.set(0, y - 0.07, -0.26);
    c.out.rear = Math.max(0.2, d.length - B - 0.19);
  } else {
    k.box('blued', 0.04, 0.06, 0.1, 0, y - 0.006, -0.01, 0, 0.008);
    k.tube('blued', 0.027, -0.05, -0.05 - B, y);
    k.tube('blued', 0.03, -0.05 - B + 0.02, -0.05 - B, y);
    if (o.has('tele')) {
      pistolGrip(c);
      stock(c, 0.04, Math.max(0.16, d.length - B - 0.05), 'tele', y);
    } else {
      k.box(f, 0.036, 0.05, 0.18, 0, y - 0.04, 0.09, 0.32, 0.014);
      k.box(f, 0.042, 0.11, 0.2, 0, y - 0.085, 0.26, 0.12, 0.016);
      k.box(f, 0.044, 0.04, B * 0.6, 0, y - 0.036, -0.06 - B * 0.35, 0, 0.012);
    }
    triggerGroup(c, -0.005, y - 0.045);
    k.box('steel', 0.004, 0.05, 0.004, 0, y + 0.055, -0.1);
    k.box('steel', 0.02, 0.004, 0.004, 0, y + 0.08, -0.1);
    c.out.sight.set(0, y + 0.075, 0.2);
    c.out.muzzle.set(0, y, -0.05 - B);
    c.out.gripL.set(0, y - 0.05, -0.06 - B * 0.4);
    c.out.rear = Math.max(0.16, d.length - B - 0.05);
  }
  c.out.eject.set(0.03, y, 0);
}

function special(c: Ctx): void {
  const { d, o, main: k } = c;
  const style = d.look.style;
  if (style === 'minigun') {
    const y = (c.boreY = 0.0);
    const front = -0.62;
    for (let i = 0; i < 6; i++) c.act.tube('steel', 0.0085, -0.1, front, y + Math.sin((i / 6) * Math.PI * 2) * 0.034, Math.cos((i / 6) * Math.PI * 2) * 0.034);
    for (const z of [-0.14, -0.36, front + 0.02]) c.act.cyl('blued', 0.05, 0.022, 0, y, z, 'z');
    k.tube('park', 0.066, 0.2, -0.1, y);
    k.box('park', 0.09, 0.09, 0.16, -0.085, y - 0.03, 0.06, 0, 0.01);
    k.box('poly', 0.03, 0.03, 0.2, 0, y + 0.1, -0.2, 0, 0.008);
    for (const z of [-0.12, -0.28]) k.box('poly', 0.022, 0.07, 0.022, 0, y + 0.065, z);
    k.box('poly', 0.03, 0.1, 0.04, 0, y - 0.06, 0.22, -0.2, 0.008);
    k.box('park', 0.03, 0.03, 0.1, 0, y - 0.02, 0.22);
    c.out.spins = true;
    c.out.sight.set(0, y + 0.14, 0.2);
    c.out.muzzle.set(0, y, front);
    c.out.gripL.set(0, y + 0.1, -0.2);
    c.out.eject.set(-0.1, y - 0.08, 0.05);
    c.out.rear = 0.26;
  } else if (style === 'flamer') {
    const y = (c.boreY = 0.03);
    k.tube('park', 0.014, 0.2, -0.72, y);
    k.tube('steel', 0.022, -0.66, -0.78, y, 0, 0.028);
    k.tube('steel', 0.008, -0.6, -0.8, y + 0.03);
    k.box('poly', 0.028, 0.09, 0.036, 0, y - 0.06, 0.03, -0.2, 0.008);
    k.box('poly', 0.028, 0.085, 0.034, 0, y - 0.06, -0.4, 0.1, 0.008);
    k.tube('rubber', 0.014, 0.42, 0.2, y - 0.04);
    k.tube('green', 0.03, 0.24, 0.12, y - 0.002);
    c.out.sight.set(0, y + 0.07, 0.25);
    c.out.muzzle.set(0, y, -0.8);
    c.out.gripL.set(0, y - 0.06, -0.4);
    c.out.eject.set(0, y, 0);
    c.out.rear = 0.42;
  } else if (style === 'bow') {
    const wood = o.has('wood');
    const m: MatKey = wood ? 'woodLight' : 'poly';
    const h = clamp(d.length * 0.5, 0.4, 0.92);
    k.box(m, 0.022, h * 0.5, 0.034, 0, 0, -0.02, 0, 0.008);
    for (const s of [-1, 1]) {
      k.box(m, 0.02, h * 0.62, 0.012, 0, s * h * 0.52, 0.03, s * -0.22, 0.004);
      if (!wood) k.cyl('steel', 0.035, 0.012, 0, s * h * 0.82, 0.095, 'x');
    }
    k.box('white', 0.002, h * 1.62, 0.002, 0, 0, wood ? 0.1 : 0.115);
    // Arrow nocked on the string
    c.mag.tube('woodLight', 0.0035, 0.12, -0.62, 0.012);
    c.mag.tube('steel', 0.009, -0.62, -0.67, 0.012, 0, 0.001);
    c.mag.box('white', 0.002, 0.024, 0.05, 0, 0.012, 0.09);
    c.boreY = 0.012;
    c.out.sight.set(0.0, 0.03, 0.42);
    c.out.muzzle.set(0, 0.012, -0.66);
    c.out.gripL.set(0, 0, -0.02);
    c.out.eject.set(0, 0, 0);
    c.out.rear = 0.14;
  } else if (style === 'crossbow') {
    const y = (c.boreY = 0.046);
    k.box('poly', 0.036, 0.05, 0.62, 0, y - 0.01, -0.2, 0, 0.01);
    k.box('poly', 0.56, 0.02, 0.03, 0, y, -0.5, 0, 0.006);
    for (const s of [-1, 1]) {
      k.cyl('steel', 0.03, 0.012, s * 0.28, y, -0.5, 'y');
      k.box('white', 0.002, 0.002, 0.46, s * 0.14, y + 0.012, -0.28, 0, 0, s * -0.62);
    }
    pistolGrip(c);
    triggerGroup(c);
    stock(c, 0.1, 0.36, 'skel', y - 0.004);
    c.mag.tube('poly', 0.0035, -0.06, -0.56, y + 0.018);
    c.mag.tube('steel', 0.008, -0.56, -0.6, y + 0.018, 0, 0.001);
    optic(c, 0.0, y + 0.03);
    c.out.muzzle.set(0, y + 0.018, -0.6);
    c.out.gripL.set(0, y - 0.05, -0.25);
    c.out.eject.set(0, y, 0);
    c.out.rear = 0.36;
  }
}

// ------------------------------------------------------------------ melee & thrown

function melee(c: Ctx): void {
  const { d, o, main: k } = c;
  const style = d.look.style;
  const len = clamp(d.meleeRange * 0.3, 0.16, 0.95);
  if (style === 'knife') {
    const big = o.has('big');
    const bl = big ? 0.26 : 0.17;
    k.box('rubber', 0.024, 0.028, 0.11, 0, 0, 0.03, 0, 0.008);
    k.box('steel', 0.012, 0.05, 0.012, 0, 0, -0.03);
    const bw = o.has('thin') ? 0.014 : big ? 0.05 : 0.032;
    k.box('chrome', 0.004, bw, bl, 0, o.has('curved') ? -0.02 : 0, -0.035 - bl / 2, o.has('curved') ? -0.28 : 0);
    k.box('chrome', 0.004, bw * 0.55, 0.05, 0, o.has('curved') ? -0.06 : bw * 0.2, -0.035 - bl - 0.012, o.has('curved') ? -0.7 : 0.45);
    c.out.muzzle.set(0, 0, -0.04 - bl);
  } else if (style === 'sword') {
    const bl = o.has('short') ? 0.5 : o.has('long') ? 0.9 : 0.72;
    k.box(o.has('curved') ? 'cloth' : 'woodDark', 0.026, 0.03, o.has('long') ? 0.22 : 0.14, 0, 0, 0.05, 0, 0.008);
    k.box('brass', 0.014, o.has('guard') ? 0.1 : 0.13, 0.018, 0, 0, -0.03);
    if (o.has('guard')) k.box('brass', 0.012, 0.012, 0.14, 0, -0.05, 0.04);
    const sw = o.has('wide') ? 0.058 : 0.034;
    k.box('chrome', 0.005, sw, bl, 0, 0, -0.04 - bl / 2, o.has('curved') ? -0.05 : 0);
    k.box('chrome', 0.005, sw * 0.6, 0.07, 0, sw * 0.18, -0.04 - bl - 0.025, 0.4);
    c.out.muzzle.set(0, 0, -0.04 - bl);
  } else if (style === 'axe') {
    const hl = o.has('long') ? 0.75 : 0.42;
    k.box('wood', 0.026, 0.032, hl, 0, 0, -hl / 2 + 0.1, 0, 0.01);
    if (o.has('hammer')) k.box('steel', 0.06, 0.14, 0.06, 0, 0, -hl + 0.12, 0, 0.006);
    else {
      k.box('steel', 0.012, 0.11, 0.09, 0, -0.05, -hl + 0.13, 0, 0.002);
      k.box('steel', 0.03, 0.04, 0.05, 0, 0.02, -hl + 0.13);
    }
    c.out.muzzle.set(0, 0, -hl + 0.1);
  } else if (style === 'spade') {
    k.box('wood', 0.028, 0.028, 0.34, 0, 0, -0.07, 0, 0.012);
    k.box('steel', 0.006, 0.14, 0.18, 0, 0, -0.33, 0, 0.003);
    c.out.muzzle.set(0, 0, -0.42);
  } else {
    const thin = o.has('thin');
    k.tube(thin ? 'steel' : 'woodLight', thin ? 0.011 : 0.017, 0.1, -len, 0, 0, thin ? 0.011 : 0.032);
    if (o.has('spiked')) for (let i = 0; i < 6; i++) k.box('steel', 0.09, 0.008, 0.008, 0, 0, -len + 0.04 + i * 0.03, 0, 0, 0, (i * Math.PI) / 3);
    k.tube('rubber', thin ? 0.014 : 0.019, 0.1, -0.03, 0);
    c.out.muzzle.set(0, 0, -len);
  }
  c.out.sight.set(0, 0.05, 0.3);
  c.out.gripL.set(0, 0, 0.05);
  c.out.rear = 0.12;
}

function thrown(c: Ctx): void {
  const { d, o, main: k } = c;
  const style = d.look.style;
  const g: MatKey = o.has('green') ? 'green' : o.has('red') ? 'red' : 'green';
  if (style === 'frag') {
    const r = o.has('small') ? 0.022 : 0.031;
    k.sphere(g, r, 0, 0, 0, 1, 1.18, 1);
    if (o.has('ribbed')) for (let i = -1; i <= 1; i++) k.cyl('blued', r * 1.02, 0.004, 0, i * r * 0.5, 0, 'y');
    k.cyl('steel', 0.011, 0.024, 0, r * 1.25, 0, 'y');
    k.box('steel', 0.008, 0.05, 0.004, 0.014, r * 0.9, 0, 0, 0, 0, -0.25);
    k.cyl('steel', 0.011, 0.003, -0.016, r * 1.4, 0, 'x');
  } else if (style === 'stick') {
    k.cyl('woodLight', 0.012, 0.26, 0, -0.08, 0, 'y');
    k.cyl('grey', 0.033, 0.1, 0, 0.1, 0, 'y');
  } else if (style === 'can') {
    k.cyl(o.has('green') || o.has('red') ? g : 'grey', 0.03, 0.12, 0, 0, 0, 'y');
    k.cyl('steel', 0.012, 0.024, 0, 0.07, 0, 'y');
    k.box('steel', 0.008, 0.07, 0.004, 0.018, 0.04, 0, 0, 0, 0, -0.2);
  } else if (style === 'molotov') {
    k.cyl('clear', 0.032, 0.14, 0, 0, 0, 'y');
    k.cyl('clear', 0.012, 0.07, 0, 0.1, 0, 'y');
    k.box('white', 0.016, 0.07, 0.016, 0, 0.16, 0, 0.3);
  } else if (style === 'c4') {
    k.box('tan', 0.07, 0.035, 0.14, 0, 0, 0, 0, 0.006);
    k.box('poly', 0.03, 0.02, 0.04, 0, 0.026, 0.02);
    k.box('dot', 0.006, 0.004, 0.006, 0, 0.038, 0.02);
  } else {
    k.box('green', 0.2, 0.09, 0.03, 0, 0.05, 0, 0, 0.012);
    for (const s of [-1, 1]) k.box('steel', 0.006, 0.07, 0.006, s * 0.06, -0.02, 0, 0, 0, 0, s * 0.3);
  }
  c.out.sight.set(0, 0.05, 0.3);
  c.out.muzzle.set(0, 0, 0);
  c.out.gripL.set(0, 0, 0);
  c.out.rear = 0.05;
}

// ------------------------------------------------------------------ entry point

const LONG = new Set(['ak', 'ar', 'g3', 'fal', 'mod', 'smg', 'p90', 'bullpup', 'woodrifle', 'chassis', 'amr', 'lever', 'musket', 'double', 'pump', 'glpump', 'lmg', 'hmg']);

export function buildWeaponModel(d: WeaponDef, hi = true): WeaponModel {
  const out: WeaponModel = {
    group: new THREE.Group(),
    muzzle: new THREE.Vector3(0, 0.04, -0.4),
    sight: new THREE.Vector3(0, 0.08, 0.2),
    eject: new THREE.Vector3(0.03, 0.05, -0.1),
    gripL: new THREE.Vector3(0, 0, -0.2),
    mag: null,
    action: null,
    actionTravel: 0,
    spins: false,
    length: d.length,
    rear: 0.1,
  };
  const o = d.look.opts;
  const style = d.look.style;
  const old = d.year < 1960;
  const c: Ctx = {
    d, o, hi, out,
    main: new Kit(hi), mag: new Kit(hi), act: new Kit(hi),
    metal: style === 'musket' ? 'park' : old || o.has('wood') ? 'blued' : d.cls === 'sniper' && o.has('green') ? 'park' : 'steel',
    furn: furniture(o, style === 'woodrifle' || style === 'lever' || style === 'musket' || style === 'double' ? 'wood' : 'poly'),
    boreY: 0.045,
  };
  if (d.slot === 'melee') melee(c);
  else if (d.slot === 'thrown') thrown(c);
  else if (style === 'pistol') pistol(c);
  else if (style === 'revolver') revolver(c);
  else if (style === 'gl' || style === 'mgl') grenadeLauncher(c);
  else if (style === 'rpg' || style === 'pzf' || style === 'tube' || style === 'm202' || style === 'piat') launcher(c);
  else if (LONG.has(style)) longGun(c);
  else special(c);

  out.group.name = d.id;
  const main = c.main.build('main');
  out.group.add(main);
  if (!c.mag.empty) {
    out.mag = c.mag.build('mag');
    out.group.add(out.mag);
  }
  if (!c.act.empty) {
    out.action = c.act.build('action');
    out.group.add(out.action);
  }
  return out;
}

export function disposeWeaponModel(m: WeaponModel): void {
  m.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
}

export const WEAPON_MATERIALS = MAT;
