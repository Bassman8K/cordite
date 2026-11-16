// Procedural textures. Everything is generated at load from tileable noise, so the game ships
// without a single image file and textures can be dropped again when a chapter unloads.

import * as THREE from 'three';
import { clamp01, smoothstep, tileFbm, tileNoise } from '../core/math';

type Gen = (u: number, v: number, o: Float32Array) => void;
interface Def {
  gen: Gen;
  /** Normal-map strength (0 = no normal map). */
  bump: number;
  alpha?: boolean;
}

const frac = (v: number) => v - Math.floor(v);
const hash = (a: number, b: number) => frac(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

function set(o: Float32Array, r: number, g: number, b: number, h: number, a = 1): void {
  o[0] = r;
  o[1] = g;
  o[2] = b;
  o[3] = h;
  o[4] = a;
}

const DEFS: Record<string, Def> = {
  concrete: {
    bump: 0.6,
    gen: (u, v, o) => {
      const n = tileFbm(u * 6, v * 6, 6, 5, 1);
      const g = tileNoise(u * 160, v * 160, 160, 2);
      const stain = smoothstep(0.55, 0.75, tileFbm(u * 3, v * 3, 3, 3, 7));
      const crack = 1 - smoothstep(0.0, 0.012, Math.abs(tileFbm(u * 5, v * 5, 5, 4, 11) - 0.5));
      const pore = g > 0.93 ? 0.12 : 0;
      const c = 0.5 + (n - 0.5) * 0.3 + (g - 0.5) * 0.07 - stain * 0.1 - crack * 0.2 - pore;
      set(o, c * 1.0, c * 0.99, c * 0.96, n * 0.5 + g * 0.12 - crack * 0.3 - pore * 0.8);
    },
  },
  asphalt: {
    bump: 0.16,
    gen: (u, v, o) => {
      const g = tileNoise(u * 220, v * 220, 220, 3);
      const n = tileFbm(u * 5, v * 5, 5, 4, 4);
      const crack = 1 - smoothstep(0.0, 0.006, Math.abs(tileFbm(u * 6, v * 6, 6, 4, 15) - 0.5));
      const stone = g > 0.9 ? 0.045 : 0;
      const c = 0.15 + (n - 0.5) * 0.08 + (g - 0.5) * 0.03 + stone - crack * 0.05;
      set(o, c, c, c * 1.03, g * 0.4 + stone - crack * 0.35);
    },
  },
  brick: {
    bump: 1.6,
    gen: (u, v, o) => {
      const rows = 16;
      const cols = 6;
      const ry = v * rows;
      const row = Math.floor(ry);
      const rx = u * cols + (row % 2) * 0.5;
      const col = Math.floor(rx);
      const fx = rx - col;
      const fy = ry - row;
      const mortar = fx < 0.035 || fx > 0.965 || fy < 0.09 || fy > 0.91;
      const id = hash(col % cols, row);
      const n = tileFbm(u * 24, v * 24, 24, 3, 5);
      if (mortar) {
        const c = 0.55 + (n - 0.5) * 0.2;
        set(o, c, c * 0.97, c * 0.92, 0.1 + n * 0.1);
      } else {
        const k = 0.75 + id * 0.45 + (n - 0.5) * 0.25;
        set(o, 0.44 * k, 0.2 * k + id * 0.03, 0.15 * k, 0.75 + n * 0.25);
      }
    },
  },
  plaster: {
    bump: 0.5,
    gen: (u, v, o) => {
      const n = tileFbm(u * 4, v * 4, 4, 5, 21);
      const g = tileNoise(u * 180, v * 180, 180, 22);
      const dirt = smoothstep(0.5, 0.8, tileFbm(u * 2, v * 2, 2, 4, 23));
      const chip = smoothstep(0.76, 0.79, tileFbm(u * 9, v * 9, 9, 3, 25));
      const c = 0.8 + (n - 0.5) * 0.16 + (g - 0.5) * 0.04 - dirt * 0.16 - chip * 0.1;
      set(o, c, c * 0.985, c * 0.95, n * 0.4 + g * 0.15 - chip * 0.5);
    },
  },
  metal: {
    bump: 0.6,
    gen: (u, v, o) => {
      const streak = tileNoise(u * 3, v * 240, 240, 31);
      const n = tileFbm(u * 5, v * 5, 5, 4, 32);
      const px = frac(u * 2);
      const py = frac(v * 2);
      const seam = px < 0.012 || py < 0.012 ? 1 : 0;
      const rx = Math.abs(frac(u * 2 + 0.06) - 0.12) < 0.02 && Math.abs(frac(v * 8) - 0.5) < 0.05;
      const scratch = tileNoise(u * 300, v * 9, 300, 33) > 0.965 ? 0.08 : 0;
      const c = 0.72 + (streak - 0.5) * 0.1 + (n - 0.5) * 0.18 - seam * 0.3 + (rx ? 0.1 : 0) + scratch;
      set(o, c, c, c * 1.01, 0.5 - seam * 0.9 + (rx ? 0.7 : 0) + (streak - 0.5) * 0.1);
    },
  },
  corrugated: {
    bump: 2.2,
    gen: (u, v, o) => {
      const ridge = Math.sin(u * Math.PI * 2 * 12);
      const streak = tileFbm(u * 30, v * 2, 30, 3, 41);
      const n = tileFbm(u * 6, v * 6, 6, 4, 42);
      const rust = smoothstep(0.66, 0.9, tileFbm(u * 3, v * 5, 3, 4, 43)) * 0.7;
      const c = 0.9 + ridge * 0.05 - (streak - 0.4) * 0.3 * v + (n - 0.5) * 0.12;
      const r = c * (1 - rust * 0.25);
      set(o, r, c * (1 - rust * 0.5), c * (1 - rust * 0.65), ridge * 0.5 + 0.5);
    },
  },
  rust: {
    bump: 1.0,
    gen: (u, v, o) => {
      const n = tileFbm(u * 7, v * 7, 7, 5, 51);
      const p = tileNoise(u * 90, v * 90, 90, 52);
      const k = 0.6 + n * 0.8;
      set(o, 0.42 * k, 0.21 * k + (p > 0.8 ? 0.04 : 0), 0.1 * k, n + (p > 0.85 ? -0.4 : 0));
    },
  },
  planks: {
    bump: 1.3,
    gen: (u, v, o) => {
      const n = 6;
      const py = v * n;
      const row = Math.floor(py);
      const fy = py - row;
      const id = hash(row, 3);
      const grain = tileFbm(u * 4 + id * 5, v * 90, 90, 3, 61);
      const knot = smoothstep(0.78, 0.86, tileFbm(u * 5 + id * 3, v * 12, 12, 2, 62));
      const gap = fy < 0.04 || fy > 0.96 ? 1 : 0;
      const end = Math.abs(frac(u * 1.5 + id * 0.7) - 0.5) < 0.004 ? 1 : 0;
      const k = 0.78 + id * 0.3 + (grain - 0.5) * 0.4 - knot * 0.35;
      const d = gap || end ? 0.3 : 1;
      set(o, 0.56 * k * d, 0.42 * k * d, 0.27 * k * d, grain * 0.6 + 0.4 - gap * 1.5 - end);
    },
  },
  crate: {
    bump: 1.4,
    gen: (u, v, o) => {
      const edge = Math.min(u, v, 1 - u, 1 - v);
      const frame = edge < 0.11;
      const diag = Math.abs(u - v) < 0.06 && !frame;
      const grain = tileFbm(frame ? u * 60 * (Math.abs(u - 0.5) > Math.abs(v - 0.5) ? 0.08 : 1) : u * 3, frame ? v * 60 * (Math.abs(u - 0.5) > Math.abs(v - 0.5) ? 1 : 0.08) : v * 70, 64, 3, 71);
      const slat = !frame && !diag ? frac(u * 5) < 0.05 : false;
      const k = (frame ? 0.95 : diag ? 0.88 : 0.78) + (grain - 0.5) * 0.35;
      const d = slat ? 0.45 : 1;
      const inner = edge > 0.11 && edge < 0.125 ? 0.6 : 1;
      set(o, 0.6 * k * d * inner, 0.46 * k * d * inner, 0.29 * k * d * inner, (frame ? 1 : diag ? 0.8 : 0.4) + grain * 0.3 - (slat ? 0.6 : 0));
    },
  },
  sandbag: {
    bump: 1.2,
    gen: (u, v, o) => {
      const wx = Math.sin(u * Math.PI * 2 * 48);
      const wy = Math.sin(v * Math.PI * 2 * 48);
      const n = tileFbm(u * 6, v * 6, 6, 4, 81);
      const c = 0.92 + wx * wy * 0.07 + (n - 0.5) * 0.3;
      set(o, c, c, c, wx * wy * 0.5 + n);
    },
  },
  fabric: {
    bump: 0.7,
    gen: (u, v, o) => {
      const wx = Math.sin(u * Math.PI * 2 * 90);
      const wy = Math.sin(v * Math.PI * 2 * 90);
      const fold = tileFbm(u * 3, v * 5, 3, 4, 91);
      const c = 0.88 + wx * wy * 0.04 + (fold - 0.5) * 0.3;
      set(o, c, c, c, fold * 1.2 + wx * wy * 0.1);
    },
  },
  tile: {
    bump: 0.9,
    gen: (u, v, o) => {
      const n = 4;
      const tx = u * n;
      const ty = v * n;
      const fx = frac(tx);
      const fy = frac(ty);
      const grout = fx < 0.02 || fy < 0.02 || fx > 0.98 || fy > 0.98;
      const id = hash(Math.floor(tx), Math.floor(ty));
      const s = tileFbm(u * 12, v * 12, 12, 4, 101);
      if (grout) set(o, 0.3, 0.3, 0.3, 0);
      else {
        const c = 0.6 + id * 0.08 + (s - 0.5) * 0.12;
        set(o, c, c * 0.99, c * 0.96, 0.8 + s * 0.05);
      }
    },
  },
  panel: {
    bump: 0.8,
    gen: (u, v, o) => {
      const fx = frac(u * 2);
      const fy = frac(v * 2);
      const seam = fx < 0.015 || fy < 0.015;
      const n = tileFbm(u * 8, v * 8, 8, 4, 111);
      const scuff = smoothstep(0.6, 0.8, tileFbm(u * 3, v * 14, 3, 3, 112)) * (1 - fy) * 0.15;
      const bolt = Math.hypot(Math.abs(fx - 0.5) - 0.44, Math.abs(fy - 0.5) - 0.44) < 0.014;
      const c = 0.8 + (n - 0.5) * 0.08 - scuff - (seam ? 0.45 : 0) - (bolt ? 0.3 : 0);
      set(o, c, c * 1.005, c * 1.02, 0.6 - (seam ? 1 : 0) + (bolt ? 0.5 : 0));
    },
  },
  rock: {
    bump: 2.0,
    gen: (u, v, o) => {
      const n = tileFbm(u * 5, v * 5, 5, 6, 121);
      const strata = tileFbm(u * 2, v * 14, 14, 3, 122);
      const c = 0.42 + (n - 0.5) * 0.4 + (strata - 0.5) * 0.14;
      set(o, c, c * 0.97, c * 0.92, n * 1.2 + strata * 0.3);
    },
  },
  dirt: {
    bump: 1.1,
    gen: (u, v, o) => {
      const n = tileFbm(u * 6, v * 6, 6, 5, 131);
      const p = tileNoise(u * 140, v * 140, 140, 132);
      const peb = p > 0.9 ? 0.14 : 0;
      const k = 0.75 + (n - 0.5) * 0.6 + peb + (p - 0.5) * 0.12;
      set(o, 0.4 * k, 0.32 * k, 0.23 * k, n + peb * 2);
    },
  },
  sand: {
    bump: 0.8,
    gen: (u, v, o) => {
      const n = tileFbm(u * 5, v * 5, 5, 4, 141);
      const ripple = Math.sin((v * 34 + tileFbm(u * 4, v * 4, 4, 2, 142) * 3) * Math.PI * 2);
      const g = tileNoise(u * 200, v * 200, 200, 143);
      const k = 0.9 + (n - 0.5) * 0.25 + ripple * 0.035 + (g - 0.5) * 0.08;
      set(o, 0.82 * k, 0.72 * k, 0.53 * k, n * 0.5 + ripple * 0.25 + g * 0.2);
    },
  },
  snow: {
    bump: 0.6,
    gen: (u, v, o) => {
      const n = tileFbm(u * 4, v * 4, 4, 5, 151);
      const g = tileNoise(u * 220, v * 220, 220, 152);
      const k = 0.9 + (n - 0.5) * 0.12 + (g > 0.94 ? 0.08 : 0);
      set(o, k * 0.96, k * 0.98, k * 1.02, n + g * 0.15);
    },
  },
  grass: {
    bump: 1.0,
    gen: (u, v, o) => {
      const n = tileFbm(u * 6, v * 6, 6, 4, 161);
      const b = tileNoise(u * 180, v * 60, 180, 162);
      const dry = smoothstep(0.55, 0.8, tileFbm(u * 3, v * 3, 3, 3, 163));
      const k = 0.7 + (n - 0.5) * 0.5 + (b - 0.5) * 0.35;
      set(o, (0.26 + dry * 0.2) * k, (0.38 + dry * 0.06) * k, 0.16 * k, n * 0.6 + b * 0.6);
    },
  },
  grate: {
    bump: 1.6,
    gen: (u, v, o) => {
      const fx = frac(u * 16);
      const fy = frac(v * 16);
      const bar = fx < 0.22 || fy < 0.22;
      const n = tileFbm(u * 9, v * 9, 9, 3, 171);
      const c = bar ? 0.6 + (n - 0.5) * 0.2 : 0.08;
      set(o, c, c, c * 1.03, bar ? 1 : 0);
    },
  },
  chainlink: {
    bump: 0,
    alpha: true,
    gen: (u, v, o) => {
      const a = Math.abs(frac((u + v) * 12) - 0.5);
      const b = Math.abs(frac((u - v) * 12) - 0.5);
      const wire = a < 0.07 || b < 0.07;
      const c = 0.5 + tileNoise(u * 60, v * 60, 60, 181) * 0.15;
      set(o, c, c, c * 1.03, 0, wire ? 1 : 0);
    },
  },
  paint: {
    bump: 0.35,
    gen: (u, v, o) => {
      const n = tileFbm(u * 5, v * 5, 5, 4, 191);
      const chip = smoothstep(0.74, 0.76, tileFbm(u * 9, v * 9, 9, 4, 192));
      const scratch = tileNoise(u * 260, v * 7, 260, 193) > 0.97 ? 1 : 0;
      const c = 0.92 + (n - 0.5) * 0.14 - chip * 0.35 - scratch * 0.12;
      set(o, c, c, c, 0.6 - chip * 0.6 - scratch * 0.3);
    },
  },
  rubber: {
    bump: 1.0,
    gen: (u, v, o) => {
      const tread = frac(u * 10 + (frac(v * 6) < 0.5 ? 0 : 0.5)) < 0.3 ? 0 : 1;
      const n = tileFbm(u * 8, v * 8, 8, 3, 201);
      const c = 0.5 + tread * 0.3 + (n - 0.5) * 0.25;
      set(o, c, c, c, tread);
    },
  },
};

export interface TexSet {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture | null;
}

const cache = new Map<string, TexSet>();
let texSize = 512;
let anisotropy = 4;
let wantNormals = true;

export function configureTextures(size: number, aniso: number, normals: boolean): void {
  if (size !== texSize || normals !== wantNormals) disposeTextures();
  texSize = size;
  anisotropy = aniso;
  wantNormals = normals;
}

export function disposeTextures(): void {
  for (const t of cache.values()) {
    t.map.dispose();
    t.normalMap?.dispose();
  }
  cache.clear();
}

function finish(tex: THREE.DataTexture, srgb: boolean): THREE.DataTexture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function hasTexture(name: string): boolean {
  return name in DEFS;
}

export function getTexture(name: string): TexSet {
  const hit = cache.get(name);
  if (hit) return hit;
  const def = DEFS[name];
  if (!def) throw new Error(`Unknown texture: ${name}`);
  const size = def.alpha ? Math.min(texSize, 256) : texSize;
  const data = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const o = new Float32Array(5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      o[4] = 1;
      def.gen((x + 0.5) / size, (y + 0.5) / size, o);
      const i = (y * size + x) * 4;
      data[i] = clamp01(o[0]) * 255;
      data[i + 1] = clamp01(o[1]) * 255;
      data[i + 2] = clamp01(o[2]) * 255;
      data[i + 3] = o[4] * 255;
      height[y * size + x] = o[3];
    }
  }
  const map = finish(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), true);
  let normalMap: THREE.DataTexture | null = null;
  if (def.bump > 0 && wantNormals) {
    const nd = new Uint8Array(size * size * 4);
    const k = def.bump * (size / 256) * 1.6;
    for (let y = 0; y < size; y++) {
      const y0 = ((y - 1 + size) % size) * size;
      const y1 = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        const x0 = (x - 1 + size) % size;
        const x1 = (x + 1) % size;
        const dx = (height[y * size + x1] - height[y * size + x0]) * k;
        const dy = (height[y1 + x] - height[y0 + x]) * k;
        const l = 1 / Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        nd[i] = (-dx * l * 0.5 + 0.5) * 255;
        nd[i + 1] = (-dy * l * 0.5 + 0.5) * 255;
        nd[i + 2] = (l * 0.5 + 0.5) * 255;
        nd[i + 3] = 255;
      }
    }
    normalMap = finish(new THREE.DataTexture(nd, size, size, THREE.RGBAFormat), false);
  }
  const set_ = { map, normalMap };
  cache.set(name, set_);
  return set_;
}

/** Small radial sprite textures (bullet holes, scorch marks, glows, muzzle flash). */
export function makeSprite(kind: 'hole' | 'scorch' | 'glow' | 'flash' | 'smoke' | 'blood', size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const r = Math.hypot(u, v) * 2;
      const ang = Math.atan2(v, u);
      const n = tileNoise(x * 0.35, y * 0.35, 64, 5);
      let cr = 255;
      let cg = 255;
      let cb = 255;
      let a = 0;
      if (kind === 'hole') {
        const core = 1 - smoothstep(0.1, 0.24, r);
        const ring = (1 - smoothstep(0.2, 0.75 + n * 0.2, r)) * 0.5;
        a = Math.max(core, ring);
        const c = core > 0.5 ? 8 : 60 + n * 50;
        cr = cg = cb = c;
      } else if (kind === 'scorch') {
        a = (1 - smoothstep(0.25, 0.95 + (n - 0.5) * 0.3, r)) * 0.88;
        cr = cg = cb = 10 + n * 14;
      } else if (kind === 'glow') {
        a = Math.pow(clamp01(1 - r), 2.2);
      } else if (kind === 'flash') {
        const spike = Math.pow(Math.abs(Math.cos(ang * 2.5 + n * 2)), 6) * 0.75 + 0.25;
        a = clamp01((1 - r / spike) * 1.6) * clamp01(1.3 - r);
        cg = 225;
        cb = 150;
      } else if (kind === 'smoke') {
        a = clamp01(1 - r) * (0.5 + n * 0.5);
        a = a * a * (3 - 2 * a);
      } else {
        a = (1 - smoothstep(0.3, 0.8 + (n - 0.5) * 0.5, r)) * 0.9;
        cr = 90;
        cg = 4;
        cb = 4;
      }
      const i = (y * size + x) * 4;
      data[i] = cr;
      data[i + 1] = cg;
      data[i + 2] = cb;
      data[i + 3] = clamp01(a) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
