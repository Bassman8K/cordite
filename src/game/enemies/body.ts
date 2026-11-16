// Builds a soldier's body as one continuous, smoothly skinned mesh: rounded torso and limbs whose
// joints bend like joints, a proper head, helmet, plate carrier, pouches, gloves and boots. It is
// still generated in code, but it is built the way a person is shaped rather than out of boxes.

import * as THREE from 'three';
import { tileFbm } from '../../core/math';
import type { RGBA, SoldierLook } from './types';

/** Bone indices this body is skinned to (same skeleton the animation drives). */
export interface BoneMap {
  hips: number;
  spine: number;
  head: number;
  armLU: number;
  armLL: number;
  armRU: number;
  armRL: number;
  legLU: number;
  legLL: number;
  legRU: number;
  legRL: number;
}

export interface BodyData {
  pos: number[];
  nrm: number[];
  col: number[];
  uv: number[];
  skinIndex: number[];
  skinWeight: number[];
  index: number[];
}

/** Skin weight: bone A, bone B, and how much of the vertex belongs to B. */
type W = [number, number, number];
interface Ring {
  c: [number, number, number];
  rx: number;
  rz: number;
  w: W;
  col?: RGBA;
}

class Builder {
  readonly d: BodyData = { pos: [], nrm: [], col: [], uv: [], skinIndex: [], skinWeight: [], index: [] };
  /** Pairs of vertices that sit on a seam and must share one normal. */
  private seams: Array<[number, number]> = [];

  private vert(x: number, y: number, z: number, c: RGBA, w: W, u: number, v: number): number {
    const i = this.d.pos.length / 3;
    this.d.pos.push(x, y, z);
    this.d.nrm.push(0, 0, 0);
    this.d.col.push(c[0], c[1], c[2]);
    this.d.uv.push(u, v);
    this.d.skinIndex.push(w[0], w[1], 0, 0);
    this.d.skinWeight.push(1 - w[2], w[2], 0, 0);
    return i;
  }

  /**
   * A tube through a series of rings. Rings lie flat (in XZ) and the tube runs along Y, or with
   * `axis: 'z'` they stand upright (in XY) and the tube runs along Z. `n` is the squareness of the
   * cross-section: 2 is an ellipse, higher is boxier.
   */
  loft(rings: Ring[], seg: number, col: RGBA, o: { n?: number; axis?: 'y' | 'z'; capA?: boolean; capB?: boolean } = {}): void {
    const start = this.d.pos.length / 3;
    const e = 2 / (o.n ?? 2);
    const row = seg + 1;
    let v = 0;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      if (r > 0) {
        const p = rings[r - 1].c;
        v += Math.hypot(ring.c[0] - p[0], ring.c[1] - p[1], ring.c[2] - p[2]);
      }
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const px = Math.sign(ca) * Math.abs(ca) ** e * ring.rx;
        const pz = Math.sign(sa) * Math.abs(sa) ** e * ring.rz;
        const c = ring.col ?? col;
        if (o.axis === 'z') this.vert(ring.c[0] + px, ring.c[1] + pz, ring.c[2], c, ring.w, (s / seg) * 2, v * 3);
        else this.vert(ring.c[0] + px, ring.c[1], ring.c[2] + pz, c, ring.w, (s / seg) * 2, v * 3);
      }
      this.seams.push([start + r * row, start + r * row + seg]);
    }
    // Which way round the triangles go depends on the direction the rings were listed in.
    const a0 = rings[0].c;
    const a1 = rings[rings.length - 1].c;
    const forward = o.axis === 'z' ? a1[2] < a0[2] : a1[1] > a0[1];
    for (let r = 0; r < rings.length - 1; r++) {
      for (let s = 0; s < seg; s++) {
        const a = start + r * row + s;
        const b = a + 1;
        const c = a + row;
        const d2 = c + 1;
        if (forward) this.d.index.push(a, c, b, b, c, d2);
        else this.d.index.push(a, b, c, b, d2, c);
      }
    }
    const cap = (r: number, flip: boolean) => {
      const ring = rings[r];
      const centre = this.vert(ring.c[0], ring.c[1], ring.c[2], ring.col ?? col, ring.w, 0.5, 0.5);
      for (let s = 0; s < seg; s++) {
        const a = start + r * row + s;
        if (flip) this.d.index.push(centre, a + 1, a);
        else this.d.index.push(centre, a, a + 1);
      }
    };
    if (o.capA) cap(0, forward);
    if (o.capB) cap(rings.length - 1, !forward);
  }

  /** An egg shape, or the part of one between two latitudes (0 = top, PI = bottom). */
  ellipsoid(c: [number, number, number], r: [number, number, number], col: RGBA, w: W, seg = 10, rows = 6, from = 0, to = Math.PI): void {
    const rings: Ring[] = [];
    for (let i = 0; i <= rows; i++) {
      const phi = from + ((to - from) * i) / rows;
      const k = Math.max(0.0005, Math.sin(phi));
      rings.push({ c: [c[0], c[1] + r[1] * Math.cos(phi), c[2]], rx: r[0] * k, rz: r[2] * k, w });
    }
    this.loft(rings, seg, col, { capA: from > 0.01, capB: to < Math.PI - 0.01 });
  }

  /** A soft-cornered box: pouches, plates, packs. */
  pod(c: [number, number, number], size: [number, number, number], col: RGBA, w: W, n = 4): void {
    const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const bevel = Math.min(sy * 0.45, 0.02);
    const ring = (y: number, k: number): Ring => ({ c: [c[0], c[1] + y, c[2]], rx: sx * k, rz: sz * k, w });
    this.loft([ring(sy, 0.78), ring(sy - bevel, 1), ring(-sy + bevel, 1), ring(-sy, 0.78)], 8, col, { n, capA: true, capB: true });
  }

  /** Smooth normals from the triangles, then a little built-in shading and cloth variation. */
  finish(): BodyData {
    const { pos, nrm, index, col } = this.d;
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i] * 3;
      const b = index[i + 1] * 3;
      const c = index[i + 2] * 3;
      const ux = pos[b] - pos[a];
      const uy = pos[b + 1] - pos[a + 1];
      const uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a];
      const vy = pos[c + 1] - pos[a + 1];
      const vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        nrm[k] += nx;
        nrm[k + 1] += ny;
        nrm[k + 2] += nz;
      }
    }
    for (const [i, j] of this.seams) {
      for (let k = 0; k < 3; k++) {
        const s = nrm[i * 3 + k] + nrm[j * 3 + k];
        nrm[i * 3 + k] = s;
        nrm[j * 3 + k] = s;
      }
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l;
      nrm[i + 1] /= l;
      nrm[i + 2] /= l;
      // Surfaces facing the ground sit in their own shadow.
      const shade = 0.8 + 0.2 * Math.min(1, nrm[i + 1] * 0.5 + 0.75);
      col[i] *= shade;
      col[i + 1] *= shade;
      col[i + 2] *= shade;
    }
    return this.d;
  }
}

const dark = (c: RGBA, k: number): RGBA => [c[0] * k, c[1] * k, c[2] * k];
const GLOVE: RGBA = [0.045, 0.045, 0.05];
const WEB: RGBA = [0.06, 0.06, 0.055];

export function buildSoldierBody(L: SoldierLook, B: BoneMap): BodyData {
  const b = new Builder();
  const hips: W = [B.hips, B.hips, 0];
  const spine: W = [B.spine, B.spine, 0];
  const head: W = [B.head, B.head, 0];
  const trousers = dark(L.uniform, 0.9);

  // ---- torso: pelvis to neck, one continuous surface
  b.loft(
    [
      { c: [0, 0.89, 0.005], rx: 0.127, rz: 0.105, w: hips, col: trousers },
      { c: [0, 0.96, 0.005], rx: 0.178, rz: 0.130, w: hips, col: trousers },
      { c: [0, 1.03, 0], rx: 0.167, rz: 0.119, w: [B.hips, B.spine, 0.35], col: trousers },
      { c: [0, 1.1, 0], rx: 0.157, rz: 0.110, w: [B.hips, B.spine, 0.8] },
      { c: [0, 1.22, -0.004], rx: 0.174, rz: 0.125, w: spine },
      { c: [0, 1.35, -0.008], rx: 0.191, rz: 0.136, w: spine },
      { c: [0, 1.45, -0.006], rx: 0.197, rz: 0.130, w: spine },
      { c: [0, 1.52, 0], rx: 0.159, rz: 0.108, w: spine },
      { c: [0, 1.56, 0.004], rx: 0.074, rz: 0.075, w: [B.spine, B.head, 0.45], col: L.face },
      { c: [0, 1.61, 0.004], rx: 0.057, rz: 0.064, w: head, col: L.face },
    ],
    14,
    L.uniform,
    { n: 2.5, capA: true },
  );
  // Belt
  b.loft(
    [
      { c: [0, 1.075, 0], rx: 0.166, rz: 0.116, w: [B.hips, B.spine, 0.6] },
      { c: [0, 1.025, 0], rx: 0.172, rz: 0.122, w: [B.hips, B.spine, 0.3] },
    ],
    14,
    WEB,
    { n: 2.5 },
  );

  // ---- plate carrier and what hangs off it
  b.loft(
    [
      { c: [0, 1.105, -0.004], rx: 0.182, rz: 0.141, w: spine },
      { c: [0, 1.14, -0.006], rx: 0.205, rz: 0.161, w: spine },
      { c: [0, 1.36, -0.008], rx: 0.214, rz: 0.167, w: spine },
      { c: [0, 1.47, -0.006], rx: 0.210, rz: 0.154, w: spine },
      { c: [0, 1.505, -0.004], rx: 0.178, rz: 0.123, w: spine },
    ],
    14,
    L.vest,
    { n: 4, capA: true, capB: true },
  );
  for (const s of [-1, 1]) b.pod([s * 0.115, 1.515, 0], [0.07, 0.03, 0.2], dark(L.vest, 0.85), spine, 3);
  for (const x of [-0.095, 0, 0.095]) b.pod([x, 1.2, -0.165], [0.078, 0.125, 0.05], dark(L.vest, 0.82), spine);
  b.pod([-0.15, 1.19, -0.115], [0.06, 0.09, 0.06], dark(L.vest, 0.75), spine);
  b.pod([0.16, 1.3, 0.11], [0.05, 0.13, 0.045], [0.05, 0.055, 0.05], spine);
  b.loft(
    [
      { c: [0.17, 1.37, 0.115], rx: 0.004, rz: 0.004, w: spine },
      { c: [0.175, 1.62, 0.125], rx: 0.003, rz: 0.003, w: spine },
    ],
    4,
    [0.03, 0.03, 0.03],
  );
  if (L.pack) {
    b.pod([0, 1.33, 0.2], [0.3, 0.38, 0.15], dark(L.vest, 1.12), spine, 3.2);
    b.pod([0, 1.2, 0.285], [0.2, 0.13, 0.05], dark(L.vest, 0.95), spine);
  }

  // ---- head
  b.ellipsoid([0, 1.692, -0.004], [0.097, 0.118, 0.109], L.face, head, 12, 7);
  b.ellipsoid([0, 1.632, -0.022], [0.073, 0.066, 0.082], L.face, head, 10, 5);
  b.ellipsoid([0, 1.668, -0.102], [0.014, 0.023, 0.018], dark(L.face, 0.94), head, 6, 4);
  for (const s of [-1, 1]) b.ellipsoid([s * 0.094, 1.685, 0.008], [0.012, 0.03, 0.02], dark(L.face, 0.9), head, 6, 4);
  if (L.visor) {
    b.ellipsoid([0, 1.7, -0.07], [0.088, 0.032, 0.05], [0.015, 0.02, 0.028], head, 12, 4);
  } else {
    // Brow shadow and eyes: enough to read as a face at a distance.
    b.ellipsoid([0, 1.712, -0.082], [0.066, 0.012, 0.022], dark(L.face, 0.62), head, 8, 3);
    for (const s of [-1, 1]) b.ellipsoid([s * 0.034, 1.697, -0.091], [0.014, 0.008, 0.008], [0.03, 0.025, 0.02], head, 6, 3);
  }
  if (L.helmet) {
    b.ellipsoid([0, 1.732, 0.006], [0.127, 0.108, 0.139], L.helmet, head, 14, 6, 0, Math.PI * 0.58);
    // Rim, side rails and a mount on the brow.
    b.loft(
      [
        { c: [0, 1.71, 0.006], rx: 0.129, rz: 0.141, w: head },
        { c: [0, 1.695, 0.006], rx: 0.126, rz: 0.138, w: head },
      ],
      14,
      dark(L.helmet, 0.8),
    );
    for (const s of [-1, 1]) b.pod([s * 0.125, 1.728, 0.01], [0.016, 0.03, 0.1], dark(L.helmet, 0.6), head, 3);
    b.pod([0, 1.78, -0.125], [0.045, 0.04, 0.025], dark(L.helmet, 0.6), head, 3);
    // Headset
    for (const s of [-1, 1]) b.ellipsoid([s * 0.106, 1.685, 0.012], [0.02, 0.036, 0.034], [0.05, 0.05, 0.05], head, 8, 4);
  } else {
    b.ellipsoid([0, 1.718, 0.004], [0.103, 0.1, 0.114], dark(L.vest, 1.25), head, 12, 5, 0, Math.PI * 0.5);
  }

  // ---- arms: shoulder to glove, bending at the elbow
  for (const [s, up, low] of [
    [-1, B.armLU, B.armLL],
    [1, B.armRU, B.armRL],
  ] as const) {
    const x = s * 0.245;
    // The shoulder is a soft swell under the sleeve, not a ball joint.
    b.ellipsoid([s * 0.222, 1.492, 0], [0.076, 0.062, 0.082], L.uniform, [B.spine, up, 0.45], 10, 5);
    b.loft(
      [
        { c: [x, 1.5, 0], rx: 0.071, rz: 0.074, w: [B.spine, up, 0.7] },
        { c: [x, 1.43, 0], rx: 0.068, rz: 0.072, w: [up, up, 0] },
        { c: [x, 1.33, 0], rx: 0.063, rz: 0.067, w: [up, up, 0] },
        { c: [x, 1.26, 0], rx: 0.057, rz: 0.062, w: [up, low, 0.2] },
        { c: [x, 1.21, 0.002], rx: 0.056, rz: 0.061, w: [up, low, 0.5] },
        { c: [x, 1.16, 0], rx: 0.056, rz: 0.060, w: [up, low, 0.8] },
        { c: [x, 1.07, 0], rx: 0.054, rz: 0.057, w: [low, low, 0] },
        { c: [x, 0.985, 0], rx: 0.046, rz: 0.050, w: [low, low, 0] },
        { c: [x, 0.94, 0], rx: 0.041, rz: 0.045, w: [low, low, 0] },
      ],
      10,
      L.uniform,
    );
    // Glove: cuff, palm and a thumb.
    b.loft(
      [
        { c: [x, 0.965, 0], rx: 0.044, rz: 0.047, w: [low, low, 0] },
        { c: [x, 0.925, 0], rx: 0.042, rz: 0.045, w: [low, low, 0] },
      ],
      10,
      GLOVE,
    );
    b.ellipsoid([x, 0.873, -0.006], [0.04, 0.062, 0.05], GLOVE, [low, low, 0], 8, 5);
    b.ellipsoid([x - s * 0.03, 0.9, -0.02], [0.014, 0.03, 0.016], GLOVE, [low, low, 0], 6, 3);
  }

  // ---- legs: hip to boot, bending at the knee
  for (const [s, up, low] of [
    [-1, B.legLU, B.legLL],
    [1, B.legRU, B.legRL],
  ] as const) {
    const x = s * 0.098;
    b.loft(
      [
        { c: [x, 0.985, 0.004], rx: 0.105, rz: 0.118, w: [B.hips, up, 0.4] },
        { c: [x, 0.9, 0.004], rx: 0.108, rz: 0.118, w: [B.hips, up, 0.88] },
        { c: [x, 0.79, 0.002], rx: 0.101, rz: 0.109, w: [up, up, 0] },
        { c: [x, 0.66, 0], rx: 0.087, rz: 0.094, w: [up, up, 0] },
        { c: [x, 0.57, -0.002], rx: 0.076, rz: 0.084, w: [up, low, 0.22] },
        { c: [x, 0.52, -0.004], rx: 0.074, rz: 0.081, w: [up, low, 0.5] },
        { c: [x, 0.47, 0], rx: 0.071, rz: 0.079, w: [up, low, 0.8] },
        { c: [x, 0.39, 0.008], rx: 0.073, rz: 0.084, w: [low, low, 0] },
        { c: [x, 0.28, 0.006], rx: 0.062, rz: 0.070, w: [low, low, 0] },
        { c: [x, 0.19, 0.002], rx: 0.054, rz: 0.059, w: [low, low, 0] },
      ],
      12,
      trousers,
      { capA: true },
    );
    // Knee pad
    b.ellipsoid([x, 0.525, -0.066], [0.05, 0.066, 0.024], dark(L.vest, 0.9), [up, low, 0.6], 8, 4);
    // Cargo pocket on the outside of the thigh
    b.pod([x + s * 0.092, 0.74, 0.004], [0.04, 0.15, 0.12], dark(trousers, 0.9), [up, up, 0], 3);
    // Boot: shaft, then the foot running forward from the heel.
    b.loft(
      [
        { c: [x, 0.23, 0.002], rx: 0.060, rz: 0.064, w: [low, low, 0] },
        { c: [x, 0.12, 0.004], rx: 0.058, rz: 0.064, w: [low, low, 0] },
        { c: [x, 0.05, 0.01], rx: 0.057, rz: 0.068, w: [low, low, 0] },
      ],
      10,
      L.boots,
    );
    b.loft(
      [
        { c: [x, 0.04, 0.075], rx: 0.042, rz: 0.034, w: [low, low, 0] },
        { c: [x, 0.046, 0.05], rx: 0.056, rz: 0.052, w: [low, low, 0] },
        { c: [x, 0.046, -0.03], rx: 0.058, rz: 0.052, w: [low, low, 0] },
        { c: [x, 0.04, -0.11], rx: 0.060, rz: 0.046, w: [low, low, 0] },
        { c: [x, 0.03, -0.175], rx: 0.052, rz: 0.034, w: [low, low, 0] },
        { c: [x, 0.024, -0.2], rx: 0.035, rz: 0.023, w: [low, low, 0] },
      ],
      10,
      L.boots,
      { axis: 'z', n: 2.6, capA: true, capB: true },
    );
  }
  // Holster on the right thigh
  b.pod([0.222, 0.86, -0.01], [0.05, 0.17, 0.085], WEB, [B.legRU, B.legRU, 0], 3);

  return b.finish();
}

let fabric: THREE.DataTexture | null = null;
/**
 * Cloth for the whole figure: a fine weave with soft, irregular patches. It carries no colour of its
 * own (the uniform's colour comes from the mesh), only the unevenness that makes cloth look like cloth.
 */
export function soldierFabric(): THREE.DataTexture {
  if (fabric) return fabric;
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const patches = tileFbm(x / 32, y / 32, 4, 3, 71) - 0.5;
      const patches2 = tileFbm(x / 16 + 9, y / 16 + 3, 8, 2, 12) - 0.5;
      const weave = ((x + y) & 1) * 0.035 + ((x >> 1) & 1) * 0.02;
      const v = Math.min(1, Math.max(0, 0.86 + (patches > 0.04 ? 0.11 : patches < -0.06 ? -0.15 : 0) + patches2 * 0.12 - weave));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(Math.pow(v, 1 / 2.2) * 255);
      data[i + 3] = 255;
    }
  }
  fabric = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  fabric.colorSpace = THREE.SRGBColorSpace;
  fabric.wrapS = fabric.wrapT = THREE.RepeatWrapping;
  fabric.generateMipmaps = true;
  fabric.minFilter = THREE.LinearMipmapLinearFilter;
  fabric.magFilter = THREE.LinearFilter;
  fabric.anisotropy = 4;
  fabric.needsUpdate = true;
  return fabric;
}

export function disposeSoldierFabric(): void {
  fabric?.dispose();
  fabric = null;
}
