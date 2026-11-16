// Reusable level furniture built from the LevelBuilder primitives. All sizes in metres.
// Every prop is authored in a local frame (via b.at) so it can be placed at any position / rotation.

import { F_BULLET, F_MOVE, F_NAV, F_SIGHT } from './collision';
import type { RGB } from './geo';
import type { BoxOpts, LevelBuilder } from './builder';

const PI = Math.PI;
export const C: Record<string, RGB> = {
  red: [0.5, 0.15, 0.11], blue: [0.13, 0.25, 0.44], green: [0.17, 0.33, 0.2], yellow: [0.72, 0.55, 0.1], grey: [0.45, 0.47, 0.5],
  white: [0.85, 0.85, 0.82], orange: [0.75, 0.34, 0.08], olive: [0.27, 0.3, 0.18], tan: [0.6, 0.52, 0.38], black: [0.07, 0.07, 0.08],
  dark: [0.2, 0.21, 0.23], teal: [0.1, 0.35, 0.36], sand: [0.72, 0.63, 0.46], brown: [0.32, 0.22, 0.14], navy: [0.08, 0.12, 0.2],
  rustc: [0.42, 0.24, 0.14], cream: [0.78, 0.74, 0.62], lime: [0.5, 0.6, 0.2], snow: [0.9, 0.92, 0.95],
};
export const CONTAINER_TINTS: RGB[] = [C.red, C.blue, C.green, C.yellow, C.grey, C.orange, C.teal, C.white, C.rustc, C.navy];
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const NC: BoxOpts = { collide: false };

// ------------------------------------------------------------------ cargo & cover

export function container(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.red, o: { long?: boolean; level?: number; open?: boolean } = {}): void {
  const L = o.long ? 12.19 : 6.06;
  const W = 2.44;
  const H = 2.59;
  const y = (o.level ?? 0) * H;
  b.at(x, z, yaw, () => {
    const frame = mul(tint, 0.6);
    if (o.open) {
      b.box(0, y, 0, L, 0.14, W, 'planks', { tint: C.brown });
      b.box(0, y + 0.14, -W / 2 + 0.05, L, H - 0.14, 0.1, 'corrugated', { tint });
      b.box(0, y + 0.14, W / 2 - 0.05, L, H - 0.14, 0.1, 'corrugated', { tint });
      b.box(-L / 2 + 0.05, y + 0.14, 0, 0.1, H - 0.14, W - 0.2, 'corrugated', { tint });
      b.box(0, y + H - 0.1, 0, L, 0.1, W, 'corrugated', { tint });
      // Doors swung open
      b.box(L / 2 + 0.55, y + 0.1, -W / 2 - 0.02, 1.15, H - 0.2, 0.06, 'metal', { tint, yaw: 0.25, collide: false });
      b.box(L / 2 + 0.55, y + 0.1, W / 2 + 0.02, 1.15, H - 0.2, 0.06, 'metal', { tint, yaw: -0.25, collide: false });
    } else {
      b.box(0, y, 0, L, H, W, 'corrugated', { tint });
      b.box(L / 2 + 0.015, y + 0.12, 0, 0.03, H - 0.24, W - 0.2, 'metal', { tint: mul(tint, 0.85), ...NC });
      for (const dz of [-0.75, -0.3, 0.3, 0.75]) b.cyl(L / 2 + 0.05, y + 0.15, dz, 0.018, H - 0.3, 'darkmetal', { ...NC, sides: 5 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (L / 2 - 0.06), y, sz * (W / 2 - 0.06), 0.14, H, 0.14, 'metal', { tint: frame, ...NC, ao: 0.9 });
    b.box(0, y + H - 0.08, -W / 2 + 0.04, L, 0.1, 0.1, 'metal', { tint: frame, ...NC });
    b.box(0, y + H - 0.08, W / 2 - 0.04, L, 0.1, 0.1, 'metal', { tint: frame, ...NC });
  });
}

/** Rows of stacked containers: `rows` deep, `cols` long, random heights up to maxLevel. */
export function containerBlock(b: LevelBuilder, x: number, z: number, yaw: number, cols: number, rows: number, maxLevel = 2, long = false): void {
  const L = (long ? 12.19 : 6.06) + 0.25;
  b.at(x, z, yaw, () => {
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const levels = b.rng.int(1, maxLevel);
        for (let l = 0; l < levels; l++) container(b, (c - (cols - 1) / 2) * L, (r - (rows - 1) / 2) * 2.6, 0, b.rng.pick(CONTAINER_TINTS), { long, level: l });
      }
    }
  });
}

export function crate(b: LevelBuilder, x: number, z: number, s = 1, o: { yaw?: number; stack?: number; mat?: string; tint?: RGB; y?: number } = {}): void {
  const n = o.stack ?? 1;
  for (let i = 0; i < n; i++) {
    b.box(x, (o.y ?? 0) + i * s, z, s, s, s, o.mat ?? 'crate', { yaw: (o.yaw ?? 0) + (i ? b.rng.range(-0.2, 0.2) : 0), tint: o.tint, uvs: 1 / s });
  }
}

export function crateCluster(b: LevelBuilder, x: number, z: number, n = 4, spread = 1.6, mat = 'crate', tint?: RGB): void {
  for (let i = 0; i < n; i++) {
    const s = b.rng.pick([0.7, 0.9, 1.0, 1.2]);
    crate(b, x + b.rng.range(-spread, spread), z + b.rng.range(-spread, spread), s, { yaw: b.rng.range(-0.4, 0.4), stack: b.rng.chance(0.3) ? 2 : 1, mat, tint });
  }
}

export function pallet(b: LevelBuilder, x: number, z: number, yaw = 0, loaded = true): void {
  b.at(x, z, yaw, () => {
    b.box(0, 0, 0, 1.2, 0.14, 1.0, 'planks', { collide: false });
    if (loaded) b.box(0, 0.14, 0, 1.1, b.rng.range(0.6, 1.1), 0.9, 'fabric', { tint: b.rng.pick([C.tan, C.grey, C.olive, C.white]) });
  });
}

export function barrel(b: LevelBuilder, x: number, z: number, tint: RGB = C.blue, y = 0): void {
  b.cyl(x, y, z, 0.29, 0.88, 'metal', { tint, sides: 10 });
  b.cyl(x, y + 0.28, z, 0.3, 0.03, 'metal', { tint: mul(tint, 0.7), sides: 10, caps: 0, collide: false });
  b.cyl(x, y + 0.6, z, 0.3, 0.03, 'metal', { tint: mul(tint, 0.7), sides: 10, caps: 0, collide: false });
}

export function barrels(b: LevelBuilder, x: number, z: number, n = 3, tint?: RGB): void {
  for (let i = 0; i < n; i++) barrel(b, x + (i % 2) * 0.62 + b.rng.range(-0.05, 0.05), z + Math.floor(i / 2) * 0.62 + b.rng.range(-0.05, 0.05), tint ?? b.rng.pick([C.blue, C.grey, C.olive, C.rustc]));
}

export function explosiveBarrel(b: LevelBuilder, x: number, z: number, y = 0): void {
  b.prop('barrel', x, y + 0.45, z, 28, 6.5, (o) => {
    b.cyl(x, y, z, 0.29, 0.88, 'paint', { ...o, tint: [0.62, 0.08, 0.06], sides: 10, pen: 0.2 });
    b.cyl(x, y + 0.36, z, 0.297, 0.16, 'paint', { ...o, tint: [0.85, 0.7, 0.08], sides: 10, caps: 0, collide: false });
  });
}

export function sandbags(b: LevelBuilder, x1: number, z1: number, x2: number, z2: number, h = 1.0): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  const rows = Math.max(1, Math.round(h / 0.21));
  const n = Math.max(1, Math.round(len / 0.62));
  b.at((x1 + x2) / 2, (z1 + z2) / 2, yaw, () => {
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? 0.31 : 0;
      for (let i = 0; i < n + (r % 2 ? -1 : 0); i++) {
        const t = b.rng.range(0.82, 1.05);
        b.box(-len / 2 + 0.31 + i * (len / n) + off, r * 0.21, b.rng.range(-0.03, 0.03), len / n - 0.03, 0.2, 0.36, 'sandbag', { tint: [0.62 * t, 0.56 * t, 0.42 * t], collide: false, yaw: b.rng.range(-0.06, 0.06), ao: 0.7, faces: 63 - 8 });
      }
    }
    b.solid(0, 0, 0, len, rows * 0.21, 0.42, { surf: 'dirt', pen: 0.75 });
  });
}

export function jersey(b: LevelBuilder, x: number, z: number, yaw = 0, n = 1, tint: RGB = C.grey): void {
  b.at(x, z, yaw, () => {
    for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * 3.02;
      b.box(px, 0, 0, 2.95, 0.22, 0.62, 'concrete', { tint, collide: false });
      b.box(px, 0.22, 0, 2.95, 0.3, 0.38, 'concrete', { tint, collide: false, ao: 0.9 });
      b.box(px, 0.52, 0, 2.95, 0.34, 0.22, 'concrete', { tint, collide: false, ao: 1 });
    }
    b.solid(0, 0, 0, n * 3.02, 0.86, 0.5, { pen: 1 });
  });
}

export function hesco(b: LevelBuilder, x: number, z: number, yaw = 0, n = 1, rows = 1): void {
  b.at(x, z, yaw, () => {
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < n; i++) {
        const px = (i - (n - 1) / 2) * 1.12;
        b.box(px, r * 1.37, 0, 1.1, 1.37, 1.1, 'sandbag', { tint: [0.58, 0.54, 0.44], collide: false, uvs: 2.4 });
        b.box(px, r * 1.37 + 1.37, 0, 1.0, 0.06, 1.0, 'dirt', { collide: false, ao: 1 });
      }
    }
    b.solid(0, 0, 0, n * 1.12, rows * 1.37, 1.1, { surf: 'dirt', pen: 1.6 });
  });
}

export function fence(b: LevelBuilder, x1: number, z1: number, x2: number, z2: number, h = 2.4, o: { barbed?: boolean; solid?: boolean } = {}): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  b.at((x1 + x2) / 2, (z1 + z2) / 2, yaw, () => {
    b.panel(0, 0, 0, len, h, o.solid ? 'corrugated' : 'chainlink', { double: true, tint: o.solid ? C.grey : undefined });
    const posts = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= posts; i++) b.cyl(-len / 2 + (i * len) / posts, 0, 0, 0.035, h + (o.barbed ? 0.35 : 0), 'darkmetal', { collide: false, sides: 5 });
    b.box(0, h - 0.03, 0, len, 0.05, 0.05, 'darkmetal', { collide: false, ao: 1 });
    if (o.barbed) b.box(0, h + 0.28, 0, len, 0.03, 0.03, 'darkmetal', { collide: false, ao: 1 });
    b.solid(0, 0, 0, len, h, 0.12, { flags: o.solid ? undefined : F_MOVE | F_NAV, surf: 'metal', pen: 0.1 });
  });
}

export function rubble(b: LevelBuilder, x: number, z: number, r = 2, n = 8, mat = 'concrete', tint?: RGB): void {
  for (let i = 0; i < n; i++) {
    const a = b.rng.range(0, 6.283);
    const d = Math.sqrt(b.rng.next()) * r;
    const s = b.rng.range(0.25, 1.0);
    const hh = s * b.rng.range(0.4, 0.9);
    b.box(x + Math.cos(a) * d, 0, z + Math.sin(a) * d, s * b.rng.range(0.8, 1.6), hh, s, mat, { yaw: b.rng.range(0, 3.14), tint, collide: hh > 0.5, ao: 0.7 });
  }
}

// ------------------------------------------------------------------ lighting

export function lamp(b: LevelBuilder, x: number, z: number, o: { h?: number; yaw?: number; color?: number; intensity?: number; range?: number; on?: boolean; group?: string; flicker?: number } = {}): void {
  const h = o.h ?? 7;
  b.at(x, z, o.yaw ?? 0, () => {
    b.cyl(0, 0, 0, 0.09, h, 'darkmetal', { sides: 6, pen: 0.4 });
    b.box(0, h - 0.06, 0.7, 0.08, 0.08, 1.5, 'darkmetal', NC);
    b.box(0, h - 0.14, 1.35, 0.3, 0.1, 0.6, 'darkmetal', NC);
    if (o.on !== false) {
      const c = o.color ?? 0xffd7a0;
      b.flatDown(0, h - 0.145, 1.35, 0.24, 0.5, c, 6);
      b.light(0, h - 0.3, 1.35, c, o.intensity ?? 260, o.range ?? 24, { spotTo: [0, 0, 1.6], angle: 1.05, group: o.group, flicker: o.flicker, glow: 1.6 });
    }
  });
}

export function floodlight(b: LevelBuilder, x: number, z: number, yaw = 0, o: { h?: number; color?: number; intensity?: number; group?: string } = {}): void {
  const h = o.h ?? 3.2;
  b.at(x, z, yaw, () => {
    b.cyl(0, 0, 0, 0.05, h, 'darkmetal', { sides: 5, pen: 0.3 });
    b.box(0, 0, 0, 0.9, 0.06, 0.9, 'darkmetal', NC);
    b.box(0, h, 0, 1.0, 0.36, 0.16, 'darkmetal', NC);
    const c = o.color ?? 0xdfe9ff;
    b.panelGlow(0, h + 0.04, 0.085, 0.9, 0.28, c, 7);
    b.light(0, h + 0.18, 0.2, c, o.intensity ?? 240, 34, { spotTo: [0, 0.5, 16], angle: 0.75, group: o.group, glow: 2.4 });
  });
}

export function ceilingLight(b: LevelBuilder, x: number, y: number, z: number, o: { color?: number; intensity?: number; range?: number; group?: string; flicker?: number; len?: number; yaw?: number; real?: boolean } = {}): void {
  const c = o.color ?? 0xeaf2ff;
  const len = o.len ?? 1.3;
  b.at(x, z, o.yaw ?? 0, () => {
    b.box(0, y - 0.07, 0, len, 0.07, 0.22, 'darkmetal', NC);
    b.flatDown(0, y - 0.075, 0, len - 0.1, 0.16, c, 3.2, o.group);
    if (o.real !== false) b.light(0, y - 0.35, 0, c, o.intensity ?? 60, o.range ?? 11, { group: o.group, flicker: o.flicker });
  });
}

export function wallLight(b: LevelBuilder, x: number, y: number, z: number, yaw: number, o: { color?: number; intensity?: number; range?: number; group?: string; flicker?: number } = {}): void {
  const c = o.color ?? 0xffc98a;
  b.at(x, z, yaw, () => {
    b.box(0, y, 0.06, 0.3, 0.16, 0.12, 'darkmetal', NC);
    b.panelGlow(0, y + 0.02, 0.125, 0.24, 0.12, c, 6, o.group);
    b.light(0, y + 0.05, 0.5, c, o.intensity ?? 45, o.range ?? 10, { group: o.group, flicker: o.flicker, glow: 0.9 });
  });
}

// ------------------------------------------------------------------ vehicles

function wheels(b: LevelBuilder, xs: number[], halfTrack: number, r: number, w = 0.32): void {
  for (const wx of xs) for (const s of [-1, 1]) {
    b.cyl(wx, r, s * halfTrack, r, w, 'rubber', { axis: 'z', sides: 10, collide: false, tint: [0.09, 0.09, 0.1] });
    b.cyl(wx, r, s * (halfTrack + w / 2 + 0.005), r * 0.5, 0.02, 'metal', { axis: 'z', sides: 8, collide: false, tint: C.dark });
  }
}

export function truck(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.olive, kind: 'cargo' | 'fuel' | 'flat' = 'cargo'): void {
  b.at(x, z, yaw, () => {
    wheels(b, [2.4, -1.0, -2.3], 1.05, 0.52);
    b.box(-0.1, 0.62, 0, 7.0, 0.28, 2.0, 'darkmetal', NC);
    b.box(2.55, 0.9, 0, 1.9, 1.75, 2.3, 'paint', { tint, collide: false });
    b.box(3.56, 0.9, 0, 0.14, 0.9, 2.2, 'darkmetal', NC);
    b.box(3.52, 1.85, 0, 0.04, 0.62, 1.9, 'glass', { tint: [0.08, 0.1, 0.12], collide: false });
    for (const s of [-1, 1]) b.box(2.6, 1.9, s * 1.16, 1.1, 0.55, 0.03, 'glass', { tint: [0.08, 0.1, 0.12], collide: false });
    if (kind === 'cargo') {
      b.box(-1.25, 0.9, 0, 4.6, 0.9, 2.4, 'paint', { tint: mul(tint, 0.85), collide: false });
      b.box(-1.25, 1.8, 0, 4.6, 1.35, 2.4, 'fabric', { tint: mul(tint, 1.15), collide: false });
    } else if (kind === 'fuel') {
      b.cyl(-1.25, 2.0, 0, 1.08, 4.6, 'metal', { axis: 'x', tint: C.white, sides: 12, collide: false });
      b.box(-1.25, 0.9, 0, 4.6, 0.25, 2.2, 'darkmetal', NC);
    } else {
      b.box(-1.25, 0.9, 0, 4.6, 0.14, 2.4, 'planks', NC);
    }
    b.solid(2.55, 0.3, 0, 2.0, 2.35, 2.3, { surf: 'metal', pen: 0.6 });
    b.solid(-1.25, 0.3, 0, 4.6, kind === 'flat' ? 0.75 : 2.85, 2.4, { surf: 'metal', pen: kind === 'cargo' ? 0.15 : 0.6 });
  });
}

export function jeep(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.tan, gun = false): void {
  b.at(x, z, yaw, () => {
    wheels(b, [1.3, -1.3], 0.82, 0.42, 0.28);
    b.box(0, 0.45, 0, 4.0, 0.62, 1.7, 'paint', { tint, collide: false });
    b.box(1.35, 1.07, 0, 1.25, 0.2, 1.6, 'paint', { tint: mul(tint, 0.9), collide: false });
    b.box(0.68, 1.07, 0, 0.05, 0.6, 1.6, 'glass', { tint: [0.08, 0.1, 0.12], collide: false });
    b.box(-0.2, 1.07, 0, 0.5, 0.55, 1.4, 'fabric', { tint: C.dark, collide: false });
    b.box(-1.5, 1.07, 0, 0.9, 0.3, 1.6, 'paint', { tint: mul(tint, 0.85), collide: false });
    if (gun) {
      b.cyl(-1.3, 1.37, 0, 0.05, 0.75, 'darkmetal', { collide: false, sides: 5 });
      b.cyl(-0.85, 2.14, 0, 0.035, 1.3, 'darkmetal', { axis: 'x', collide: false, sides: 6 });
      b.box(-1.35, 2.05, 0, 0.5, 0.2, 0.14, 'darkmetal', NC);
    }
    b.solid(0, 0.25, 0, 4.1, 1.3, 1.75, { surf: 'metal', pen: 0.5 });
  });
}

export function car(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.grey, wreck = false): void {
  b.at(x, z, yaw, () => {
    const t = wreck ? mul(C.rustc, 0.45) : tint;
    if (!wreck) wheels(b, [1.35, -1.35], 0.8, 0.33, 0.22);
    const y0 = wreck ? 0.05 : 0.3;
    b.box(0, y0, 0, 4.4, 0.62, 1.78, wreck ? 'rust' : 'paint', { tint: t, collide: false });
    b.box(-0.2, y0 + 0.62, 0, 2.3, 0.52, 1.6, wreck ? 'rust' : 'paint', { tint: t, collide: false, ao: 1 });
    if (!wreck) {
      b.box(-0.2, y0 + 0.66, 0, 2.34, 0.4, 1.64, 'glass', { tint: [0.07, 0.09, 0.11], collide: false, ao: 1 });
    }
    b.solid(0, 0, 0, 4.4, y0 + 1.1, 1.78, { surf: 'metal', pen: 0.3 });
  });
}

export function apc(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.olive): void {
  b.at(x, z, yaw, () => {
    wheels(b, [2.4, 0.8, -0.8, -2.4], 1.3, 0.56, 0.4);
    b.box(-0.2, 0.7, 0, 6.6, 1.5, 2.7, 'paint', { tint, collide: false });
    b.ramp(3.6, 0.7, 0, 2.7, 1.5, 1.2, 'paint', { tint, yaw: -PI / 2 });
    b.cyl(0.4, 2.2, 0, 0.75, 0.55, 'paint', { tint: mul(tint, 0.9), sides: 10, collide: false });
    b.cyl(1.9, 2.5, 0, 0.05, 2.4, 'darkmetal', { axis: 'x', sides: 6, collide: false });
    b.solid(0.1, 0.3, 0, 7.6, 1.95, 2.7, { surf: 'metal', pen: 3 });
    b.solid(0.4, 2.2, 0, 1.4, 0.55, 1.4, { surf: 'metal', pen: 3 });
  });
}

export function tank(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.olive, turretYaw = 0): void {
  b.at(x, z, yaw, () => {
    for (const s of [-1, 1]) {
      b.box(0, 0, s * 1.45, 7.2, 0.95, 0.65, 'rubber', { tint: [0.1, 0.1, 0.1], collide: false });
      for (let i = -3; i <= 3; i++) b.cyl(i * 1.0, 0.45, s * 1.8, 0.4, 0.06, 'darkmetal', { axis: 'z', sides: 8, collide: false });
    }
    b.box(0, 0.6, 0, 7.0, 0.9, 2.5, 'paint', { tint, collide: false });
    b.ramp(3.9, 0.6, 0, 2.5, 0.9, 1.0, 'paint', { tint, yaw: -PI / 2 });
    b.at(-0.3, 0, turretYaw, () => {
      b.box(0, 1.5, 0, 3.2, 0.75, 2.2, 'paint', { tint: mul(tint, 0.92), collide: false });
      b.cyl(3.6, 1.9, 0, 0.085, 5.0, 'darkmetal', { axis: 'x', sides: 8, collide: false });
      b.cyl(5.9, 1.9, 0, 0.12, 0.5, 'darkmetal', { axis: 'x', sides: 8, collide: false });
      b.box(-0.6, 2.25, 0.5, 0.5, 0.25, 0.5, 'paint', { tint, collide: false });
    });
    b.solid(0.2, 0, 0, 7.8, 1.5, 3.5, { surf: 'metal', pen: 6 });
    b.solid(-0.3, 1.5, 0, 3.0, 0.75, 2.4, { surf: 'metal', pen: 6 });
  });
}

export function heli(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.dark): void {
  b.at(x, z, yaw, () => {
    b.cyl(0.5, 1.75, 0, 1.15, 4.6, 'paint', { axis: 'x', tint, sides: 10, collide: false });
    b.sphere(2.8, 1.75, 0, 1.15, 'glass', { tint: [0.06, 0.08, 0.1], collide: false });
    b.cyl(-4.5, 2.0, 0, 0.42, 5.6, 'paint', { axis: 'x', tint, sides: 8, r2: 0.16, collide: false, yaw: PI });
    b.box(-7.1, 1.9, 0, 0.9, 1.7, 0.1, 'paint', { tint, collide: false });
    b.cyl(-7.2, 3.0, 0.14, 0.7, 0.03, 'darkmetal', { axis: 'z', sides: 10, collide: false });
    b.cyl(0.4, 2.9, 0, 0.16, 0.5, 'darkmetal', { sides: 6, collide: false });
    for (let i = 0; i < 4; i++) b.box(0.4, 3.38, 0, 12.5, 0.04, 0.34, 'darkmetal', { yaw: (i * PI) / 4 + 0.3, collide: false, ao: 1, faces: 12 });
    for (const s of [-1, 1]) {
      b.cyl(0.5, 0.12, s * 1.1, 0.06, 4.2, 'darkmetal', { axis: 'x', sides: 5, collide: false });
      for (const px of [-0.6, 1.6]) b.cyl(px, 0.12, s * 1.1, 0.04, 0.7, 'darkmetal', { sides: 5, collide: false });
    }
    b.solid(0.6, 0, 0, 5.2, 3.0, 2.3, { surf: 'metal', pen: 0.4 });
    b.solid(-4.6, 1.5, 0, 5.4, 1.0, 0.6, { surf: 'metal', pen: 0.3 });
  });
}

/** Parked cargo aircraft. Engines are destructible props named `${id}-eng1..4`. */
export function cargoPlane(b: LevelBuilder, id: string, x: number, z: number, yaw = 0): void {
  b.at(x, z, yaw, () => {
    const t = C.grey;
    b.cyl(0, 3.4, 0, 2.3, 26, 'paint', { axis: 'x', tint: t, sides: 14, collide: false });
    b.sphere(13, 3.4, 0, 2.3, 'paint', { tint: t, collide: false });
    b.cyl(-17.5, 4.1, 0, 2.3, 9, 'paint', { axis: 'x', tint: t, sides: 14, r2: 0.5, yaw: PI, collide: false });
    b.box(12.6, 4.0, 0, 1.6, 0.8, 3.4, 'glass', { tint: [0.05, 0.07, 0.09], collide: false });
    b.box(1.5, 5.5, 0, 4.6, 0.55, 38, 'paint', { tint: mul(t, 0.92), collide: false, faces: 63 });
    b.box(-20.5, 5.0, 0, 3.2, 6.2, 0.4, 'paint', { tint: t, collide: false });
    b.box(-21.2, 10.6, 0, 2.6, 0.3, 12, 'paint', { tint: t, collide: false });
    let n = 0;
    for (const ez of [-13, -7, 7, 13]) {
      n++;
      b.prop('target', 2.6, 4.5, ez, 160, 5, (o) => {
        b.cyl(2.6, 4.5, ez, 0.75, 3.4, 'paint', { ...o, axis: 'x', tint: mul(t, 0.8), sides: 10, pen: 0.5 });
        b.cyl(4.45, 4.5, ez, 0.2, 0.5, 'darkmetal', { ...o, axis: 'x', sides: 6, collide: false });
        for (let k = 0; k < 3; k++) b.box(4.6, 4.5 - 1.5, ez, 0.06, 3.0, 0.22, 'darkmetal', { ...o, collide: false, yaw: 0, ao: 1 });
      }, `${id}-eng${n}`);
    }
    for (const gz of [-2.6, 2.6]) wheels(b, [1, -1.2], Math.abs(gz), 0.6, 0.4);
    wheels(b, [10], 0.3, 0.5, 0.3);
    b.ramp(-12.2, 0, 0, 3.6, 1.3, 4.5, 'metal', { tint: C.dark, yaw: PI / 2 });
    b.solid(0, 1.1, 0, 30, 4.7, 4.4, { surf: 'metal', pen: 0.5 });
    b.solid(-12.2, 0, 0, 4.5, 1.2, 3.6, { surf: 'metal', pen: 0.5 });
    b.solid(-20.5, 5.0, 0, 3.2, 6.2, 0.5, { surf: 'metal', pen: 0.4 });
  });
}

// ------------------------------------------------------------------ structures

export function tower(b: LevelBuilder, x: number, z: number, yaw = 0, h = 6, mat = 'planks'): number {
  b.at(x, z, yaw, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1.4, 0, sz * 1.4, 0.22, h, 0.22, 'wood', { tint: C.brown, pen: 0.3 });
    for (let k = 1; k < 3; k++) {
      const yy = (h * k) / 3;
      b.box(0, yy, -1.4, 3.0, 0.12, 0.1, 'wood', { tint: C.brown, collide: false });
      b.box(0, yy, 1.4, 3.0, 0.12, 0.1, 'wood', { tint: C.brown, collide: false });
      b.box(-1.4, yy, 0, 0.1, 0.12, 3.0, 'wood', { tint: C.brown, collide: false });
      b.box(1.4, yy, 0, 0.1, 0.12, 3.0, 'wood', { tint: C.brown, collide: false });
    }
    b.box(0, h, 0, 3.4, 0.2, 3.4, 'planks', {});
    b.box(0, h + 0.2, -1.62, 3.4, 1.0, 0.1, mat, { pen: 0.2 });
    b.box(0, h + 0.2, 1.62, 3.4, 1.0, 0.1, mat, { pen: 0.2 });
    b.box(-1.62, h + 0.2, 0, 0.1, 1.0, 3.2, mat, { pen: 0.2 });
    b.box(1.62, h + 0.2, 0, 0.1, 1.0, 3.2, mat, { pen: 0.2 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1.6, h + 1.2, sz * 1.6, 0.1, 1.3, 0.1, 'wood', { tint: C.brown, collide: false });
    b.box(0, h + 2.5, 0, 4.0, 0.1, 4.0, 'corrugated', { tint: C.rustc, collide: false });
    // Ladder
    for (const sx of [-0.25, 0.25]) b.box(sx, 0, -1.78, 0.05, h + 0.2, 0.05, 'darkmetal', NC);
    for (let i = 1; i < h / 0.35; i++) b.box(0, i * 0.35, -1.78, 0.5, 0.03, 0.03, 'darkmetal', { collide: false, ao: 1 });
  });
  return h + 0.2;
}

export function gableRoof(b: LevelBuilder, x: number, y: number, z: number, w: number, d: number, h: number, mat = 'corrugated', tint?: RGB, yaw = 0): void {
  b.at(x, z, yaw, () => {
    b.ramp(-w / 4, y, 0, d, h, w / 2, mat, { tint, yaw: PI / 2 });
    b.ramp(w / 4, y, 0, d, h, w / 2, mat, { tint, yaw: -PI / 2 });
  });
}

export function tent(b: LevelBuilder, x: number, z: number, yaw = 0, w = 5, d = 7, tint: RGB = C.olive): void {
  b.at(x, z, yaw, () => {
    b.box(0, 0, 0, w, 1.3, d, 'fabric', { tint, collide: false });
    gableRoof(b, 0, 1.3, 0, w + 0.3, d + 0.2, 1.3, 'fabric', mul(tint, 1.1));
    b.solid(0, 0, 0, w, 2.0, d, { surf: 'fabric', pen: 0.05 });
  });
}

type Side = 'n' | 's' | 'e' | 'w';
export interface HouseOpts {
  h?: number;
  yaw?: number;
  mat?: string;
  tint?: RGB;
  floor?: string;
  roof?: 'flat' | 'gable' | 'none';
  roofMat?: string;
  roofTint?: RGB;
  /** [side, offset from wall centre, width] */
  doors?: Array<[Side, number, number?]>;
  windows?: Array<[Side, number, number?]>;
  /** Non-enterable storeys stacked on top. */
  upper?: number;
  lit?: number;
  t?: number;
}

/** Enterable single-storey building with door and window openings; optional facade storeys above. */
export function house(b: LevelBuilder, x: number, z: number, w: number, d: number, o: HouseOpts = {}): void {
  const h = o.h ?? 3.2;
  const mat = o.mat ?? 'plaster';
  const t = o.t ?? 0.3;
  const hw = w / 2;
  const hd = d / 2;
  b.at(x, z, o.yaw ?? 0, () => {
    const sides: Record<Side, [number, number, number, number]> = {
      n: [-hw, -hd, hw, -hd],
      s: [hw, hd, -hw, hd],
      e: [hw, -hd, hw, hd],
      w: [-hw, hd, -hw, -hd],
    };
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const [x1, z1, x2, z2] = sides[side];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const gaps: number[][] = [];
      for (const [s, off, dw] of o.doors ?? []) if (s === side) gaps.push([len / 2 + off - (dw ?? 1.4) / 2, len / 2 + off + (dw ?? 1.4) / 2]);
      for (const [s, off, ww] of o.windows ?? []) if (s === side) gaps.push([len / 2 + off - (ww ?? 1.3) / 2, len / 2 + off + (ww ?? 1.3) / 2, 1.0, 2.25]);
      b.wall(x1, z1, x2, z2, h, mat, { t, tint: o.tint, gaps });
    }
    b.flat(0, 0, w - t, d - t, o.floor ?? 'tile', { y: 0.03 });
    if (o.roof !== 'none') {
      b.box(0, h, 0, w + 0.3, 0.25, d + 0.3, 'concrete', { tint: C.grey });
      if (o.roof === 'gable') gableRoof(b, 0, h + 0.25, 0, w + 0.9, d + 0.9, Math.min(w, d) * 0.28, o.roofMat ?? 'corrugated', o.roofTint ?? C.rustc);
    }
    if (o.upper) facade(b, 0, h + 0.25, 0, w, d, o.upper * 3.1, mat, o.tint, o.lit ?? 0.1);
    else if (o.roof !== 'gable' && o.roof !== 'none') {
      b.box(0, h + 0.25, -hd, w + 0.3, 0.5, 0.2, mat, { tint: o.tint, collide: false });
      b.box(0, h + 0.25, hd, w + 0.3, 0.5, 0.2, mat, { tint: o.tint, collide: false });
      b.box(-hw, h + 0.25, 0, 0.2, 0.5, d, mat, { tint: o.tint, collide: false });
      b.box(hw, h + 0.25, 0, 0.2, 0.5, d, mat, { tint: o.tint, collide: false });
    }
  });
}

/** Solid block of storeys with a window grid on every side. Base at local y. */
export function facade(b: LevelBuilder, x: number, y: number, z: number, w: number, d: number, h: number, mat = 'plaster', tint?: RGB, lit = 0.1, firstRow = 1.0): void {
  b.box(x, y, z, w, h, d, mat, { tint });
  const rowH = 3.1;
  const rows = Math.max(0, Math.floor((h - firstRow - 0.6) / rowH) + 1);
  const put = (px: number, py: number, pz: number, yaw: number) => {
    if (b.rng.chance(lit)) b.at(x + px, z + pz, yaw, () => b.panelGlow(0, y + py, 0.03, 1.2, 1.4, b.rng.pick([0xffd9a3, 0xfff1d0, 0xbfd8ff]), b.rng.range(1.2, 2.6)));
    else b.panel(x + px, y + py, z + pz, 1.2, 1.4, 'glass', { yaw, tint: [0.05, 0.07, 0.09] });
  };
  for (let r = 0; r < rows; r++) {
    const py = firstRow + r * rowH;
    const nx = Math.max(1, Math.floor(w / 3));
    const nz = Math.max(1, Math.floor(d / 3));
    for (let i = 0; i < nx; i++) {
      const px = (i - (nx - 1) / 2) * (w / nx);
      put(px, py, d / 2 + 0.02, 0);
      put(px, py, -d / 2 - 0.02, PI);
    }
    for (let i = 0; i < nz; i++) {
      const pz = (i - (nz - 1) / 2) * (d / nz);
      put(w / 2 + 0.02, py, pz, PI / 2);
      put(-w / 2 - 0.02, py, pz, -PI / 2);
    }
  }
  b.box(x, y + h, z, w + 0.4, 0.3, d + 0.4, 'concrete', { tint: C.grey, collide: false });
  if (w > 6 && d > 6) b.box(x + b.rng.range(-w / 4, w / 4), y + h + 0.3, z + b.rng.range(-d / 4, d / 4), 2.2, 1.4, 1.8, 'metal', { tint: C.grey, collide: false });
}

/** Non-enterable building standing on the ground. */
export function block(b: LevelBuilder, x: number, z: number, w: number, d: number, h: number, o: { mat?: string; tint?: RGB; yaw?: number; lit?: number } = {}): void {
  b.at(x, z, o.yaw ?? 0, () => facade(b, 0, 0, 0, w, d, h, o.mat ?? 'plaster', o.tint, o.lit ?? 0.1, 1.2));
}

/** Large enterable shed. `doors` are roller-door openings: [side, offset, width, height]. */
export function warehouse(b: LevelBuilder, x: number, z: number, w: number, d: number, o: { h?: number; yaw?: number; tint?: RGB; doors?: Array<[Side, number, number, number?]>; mat?: string; lights?: string | boolean } = {}): void {
  const h = o.h ?? 6.5;
  const mat = o.mat ?? 'corrugated';
  const hw = w / 2;
  const hd = d / 2;
  b.at(x, z, o.yaw ?? 0, () => {
    const sides: Record<Side, [number, number, number, number]> = { n: [-hw, -hd, hw, -hd], s: [hw, hd, -hw, hd], e: [hw, -hd, hw, hd], w: [-hw, hd, -hw, -hd] };
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const [x1, z1, x2, z2] = sides[side];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const gaps: number[][] = [];
      for (const [s, off, dw, dh] of o.doors ?? []) if (s === side) gaps.push([len / 2 + off - dw / 2, len / 2 + off + dw / 2, 0, dh ?? 4]);
      b.wall(x1, z1, x2, z2, h, mat, { t: 0.2, tint: o.tint, gaps, pen: 0.12 });
    }
    b.flat(0, 0, w - 0.2, d - 0.2, 'concrete', { y: 0.03, tint: [0.8, 0.8, 0.8] });
    gableRoof(b, 0, h, 0, w + 0.6, d + 0.6, w * 0.14, 'corrugated', o.tint ? mul(o.tint, 0.8) : C.grey);
    b.solid(0, h, 0, w, 0.4, d, { surf: 'metal', pen: 0.2 });
    const nc = Math.max(1, Math.floor(d / 8));
    for (let i = 0; i <= nc; i++) for (const s of [-1, 1]) b.box(s * (hw - 0.35), 0, -hd + 0.4 + (i * (d - 0.8)) / nc, 0.25, h, 0.25, 'darkmetal', { collide: false });
    if (o.lights !== false) {
      const nl = Math.max(1, Math.round(d / 12));
      for (let i = 0; i < nl; i++) ceilingLight(b, 0, h - 0.4, -hd + ((i + 0.5) * d) / nl, { intensity: 150, range: 18, color: 0xfff0d8, len: 1.8, group: typeof o.lights === 'string' ? o.lights : undefined });
    }
  });
}

export function mast(b: LevelBuilder, x: number, z: number, h = 24): void {
  b.box(x, 0, z, 0.45, h, 0.45, 'grate', { tint: C.grey, pen: 0.15, uvs: 2 });
  for (let i = 1; i < h / 4; i++) b.box(x, i * 4, z, 0.8, 0.08, 0.8, 'darkmetal', { collide: false });
  b.glow(x, h + 0.3, z, 0xff2a1a, 1.4);
}

export function silo(b: LevelBuilder, x: number, z: number, r = 3, h = 8, tint: RGB = C.white): void {
  b.cyl(x, 0, z, r, h, 'metal', { tint, sides: 16, uvs: 0.3 });
  b.sphere(x, h, z, r, 'metal', { tint, dome: true, squash: 0.35, collide: false });
  for (let i = 1; i < 3; i++) b.cyl(x, (h * i) / 3, z, r + 0.03, 0.12, 'metal', { tint: mul(tint, 0.7), sides: 16, caps: 0, collide: false });
}

/** Horizontal fuel tank that explodes when destroyed. */
export function fuelTank(b: LevelBuilder, id: string, x: number, z: number, yaw = 0): void {
  b.at(x, z, yaw, () => {
    for (const sx of [-1.6, 1.6]) b.box(sx, 0, 0, 0.3, 0.6, 2.2, 'concrete', {});
    b.prop('target', 0, 1.8, 0, 140, 11, (o) => {
      b.cyl(0, 1.85, 0, 1.3, 5.2, 'paint', { ...o, axis: 'x', tint: C.white, sides: 14, pen: 0.3 });
      b.box(0, 1.2, 1.31, 1.4, 0.9, 0.02, 'paint', { ...o, tint: C.orange, collide: false });
    }, id);
  });
}

export function pipeRun(b: LevelBuilder, x1: number, z1: number, x2: number, z2: number, y: number, r = 0.16, tint: RGB = C.grey): void {
  const horiz = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const len = horiz ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
  b.cyl((x1 + x2) / 2, y, (z1 + z2) / 2, r, len, 'metal', { axis: horiz ? 'x' : 'z', tint, sides: 8, collide: false });
  const n = Math.max(1, Math.round(len / 5));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (y - r > 0.3) b.box(x1 + (x2 - x1) * t, 0, z1 + (z2 - z1) * t, 0.12, y - r, 0.12, 'darkmetal', { collide: false });
  }
}

// ------------------------------------------------------------------ interiors & intel

export function table(b: LevelBuilder, x: number, z: number, yaw = 0, w = 1.6, d = 0.8, mat = 'wood'): void {
  b.at(x, z, yaw, () => {
    b.box(0, 0.72, 0, w, 0.06, d, mat, { collide: false, ao: 1 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 0.06, 0.72, 0.06, mat, { collide: false });
    b.solid(0, 0, 0, w, 0.78, d, { surf: 'wood', pen: 0.15 });
  });
}

export function laptop(b: LevelBuilder, x: number, y: number, z: number, yaw = 0): void {
  b.at(x, z, yaw, () => {
    b.box(0, y, 0, 0.34, 0.02, 0.24, 'darkmetal', { collide: false, ao: 1 });
    b.box(0, y + 0.02, -0.12, 0.34, 0.22, 0.012, 'darkmetal', { collide: false, ao: 1 });
    b.panelGlow(0, y + 0.035, -0.112, 0.31, 0.19, 0x7fd8ff, 2.2);
  });
}

export function serverRack(b: LevelBuilder, x: number, z: number, yaw = 0, n = 1): void {
  b.at(x, z, yaw, () => {
    for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * 0.64;
      b.box(px, 0, 0, 0.6, 2.05, 1.0, 'darkmetal', { tint: [0.5, 0.5, 0.55], collide: false });
      for (let k = 0; k < 6; k++) b.panelGlow(px + b.rng.range(-0.18, 0.18), 0.3 + k * 0.28, 0.505, 0.12, 0.02, b.rng.pick([0x38ff7a, 0x38ff7a, 0xffa530, 0x4aa8ff]), 4);
    }
    b.solid(0, 0, 0, n * 0.64, 2.05, 1.0, { surf: 'metal', pen: 0.4 });
  });
}

export function consoleDesk(b: LevelBuilder, x: number, z: number, yaw = 0, w = 2.4): void {
  b.at(x, z, yaw, () => {
    b.box(0, 0, 0, w, 0.78, 0.8, 'darkmetal', { tint: [0.6, 0.62, 0.66], pen: 0.3 });
    const n = Math.max(1, Math.round(w / 0.8));
    for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * 0.8;
      b.box(px, 0.82, -0.22, 0.66, 0.44, 0.04, 'darkmetal', { collide: false, ao: 1 });
      b.panelGlow(px, 0.85, -0.198, 0.6, 0.38, b.rng.pick([0x5fd8ff, 0x62ffb0, 0xffb347]), 1.8);
    }
  });
}

export function shelf(b: LevelBuilder, x: number, z: number, yaw = 0, w = 2.4, h = 2.2): void {
  b.at(x, z, yaw, () => {
    for (const sx of [-1, 1]) b.box(sx * (w / 2 - 0.03), 0, 0, 0.06, h, 0.6, 'darkmetal', { collide: false });
    for (let k = 0; k < 4; k++) {
      const yy = 0.15 + (k * (h - 0.25)) / 3;
      b.box(0, yy, 0, w, 0.04, 0.6, 'darkmetal', { collide: false, ao: 1 });
      if (k < 3) for (let i = 0; i < 3; i++) if (b.rng.chance(0.75)) b.box(-w / 2 + 0.4 + i * (w / 3), yy + 0.04, 0, b.rng.range(0.35, 0.6), b.rng.range(0.2, 0.45), 0.45, 'crate', { collide: false, tint: b.rng.pick([C.tan, C.olive, C.grey]), uvs: 1.6 });
    }
    b.solid(0, 0, 0, w, h, 0.6, { surf: 'metal', pen: 0.25 });
  });
}

export function bunk(b: LevelBuilder, x: number, z: number, yaw = 0): void {
  b.at(x, z, yaw, () => {
    for (const yy of [0.35, 1.25]) {
      b.box(0, yy, 0, 2.0, 0.08, 0.9, 'darkmetal', { collide: false, ao: 1 });
      b.box(0, yy + 0.08, 0, 1.9, 0.12, 0.8, 'fabric', { tint: C.olive, collide: false, ao: 1 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.97, 0, sz * 0.42, 0.05, 1.8, 0.05, 'darkmetal', { collide: false });
    b.solid(0, 0, 0, 2.0, 1.5, 0.9, { surf: 'metal', pen: 0.15 });
  });
}

export function generator(b: LevelBuilder, x: number, z: number, yaw = 0, tint: RGB = C.yellow): void {
  b.at(x, z, yaw, () => {
    b.box(0, 0.15, 0, 2.2, 1.15, 1.1, 'paint', { tint });
    b.box(0, 0, 0, 2.3, 0.15, 1.2, 'darkmetal', { collide: false });
    b.cyl(0.7, 1.3, 0.2, 0.07, 0.6, 'darkmetal', { collide: false, sides: 6 });
    b.box(-0.55, 0.5, 0.56, 0.7, 0.5, 0.02, 'grate', { collide: false, uvs: 3 });
    b.panelGlow(0.6, 0.85, 0.56, 0.08, 0.05, 0x39ff6a, 5);
  });
}

/** Resupply crate: refills ammo and lets the player swap loadout. */
export function ammoCrate(b: LevelBuilder, id: string, x: number, z: number, yaw = 0): void {
  b.at(x, z, yaw, () => {
    b.box(0, 0, 0, 1.3, 0.55, 0.7, 'paint', { tint: [0.2, 0.26, 0.16], pen: 0.3 });
    b.box(0, 0.55, 0, 1.34, 0.08, 0.74, 'paint', { tint: [0.26, 0.33, 0.2], collide: false, ao: 1 });
    b.box(0, 0.2, 0.355, 0.5, 0.18, 0.01, 'paint', { tint: [0.85, 0.7, 0.1], collide: false, ao: 1 });
    b.interact(id, 0, 0.6, 0, 'Resupply · change loadout', { kind: 'resupply', hold: 0.5, radius: 2.4 });
  });
}

export function door(b: LevelBuilder, id: string, x: number, z: number, yaw = 0, w = 1.2, h = 2.2, tint: RGB = C.dark): void {
  b.at(x, z, yaw, () => {
    b.prop('door', 0, 1.1, 0, 1e9, 0, (o) => {
      b.box(0, 0, 0, w, h, 0.1, 'metal', { ...o, tint, pen: 0.9, flags: F_MOVE | F_BULLET | F_SIGHT });
      b.box(w / 2 - 0.15, 1.0, 0.06, 0.12, 0.04, 0.03, 'darkmetal', { ...o, collide: false });
    }, id);
  });
}

// ------------------------------------------------------------------ nature

export function tree(b: LevelBuilder, x: number, z: number, s = 1, kind = 'pine', tint?: RGB): void {
  b.inst(kind, x, z, s, { tint });
  b.solid(x, b.gy(x, z) - 0.5, z, 0.45 * s, 7 * s, 0.45 * s, { surf: 'wood', pen: 0.6 });
}

export function rock(b: LevelBuilder, x: number, z: number, s = 1, tint?: RGB): void {
  b.inst('rock', x, z, s, { tint });
  b.solid(x, b.gy(x, z) - 0.5, z, 1.5 * s, 0.5 + 0.95 * s, 1.5 * s, { surf: 'concrete', pen: 3 });
}

// ------------------------------------------------------------------ set pieces

/** Satellite dish that is brought down with a planted charge (interactable `id`, prop `id`). */
export function dish(b: LevelBuilder, id: string, x: number, z: number, yaw = 0, y = 0): void {
  b.at(x, z, yaw, () => {
    b.box(0, 0, 0, 2.4, 0.5, 2.4, 'concrete', {});
    b.prop('target', 0, 3, 0, 1e12, 0, (o) => {
      b.cyl(0, 0.5, 0, 0.32, 3.2, 'paint', { ...o, tint: C.grey, sides: 8, pen: 1 });
      b.sphere(0, 3.4, -0.5, 2.6, 'paint', { ...o, tint: C.white, dome: true, squash: 0.42, collide: false });
      b.cyl(0, 4.9, -0.5, 0.05, 1.7, 'darkmetal', { ...o, collide: false, sides: 5 });
      b.box(0, 6.5, -0.5, 0.3, 0.3, 0.3, 'darkmetal', { ...o, collide: false });
    }, id);
    b.box(1.4, 0.5, 1.0, 0.7, 1.1, 0.5, 'paint', { tint: C.grey });
    b.panelGlow(1.4, 1.1, 1.26, 0.2, 0.08, 0x39ff6a, 4);
    b.interact(id, 1.4, 1.2, 1.5, 'Plant charge on the dish', { kind: 'plant', hold: 1.8, radius: 2.6, enabled: false });
  }, y);
}

/** Twin-barrel anti-aircraft gun. Destructible: explosives or sustained fire. */
export function aaGun(b: LevelBuilder, id: string, x: number, z: number, yaw = 0, y = 0): void {
  b.at(x, z, yaw, () => {
    b.cyl(0, 0, 0, 1.5, 0.35, 'concrete', { sides: 12, collide: false });
    b.prop('target', 0, 1.4, 0, 420, 5, (o) => {
      b.cyl(0, 0.35, 0, 0.5, 0.9, 'paint', { ...o, tint: C.olive, sides: 10, pen: 2 });
      b.box(0, 1.25, 0, 1.5, 0.9, 1.6, 'paint', { ...o, tint: C.olive, pen: 2 });
      for (const sx of [-0.28, 0.28]) b.cyl(sx, 2.25, -1.9, 0.07, 3.4, 'darkmetal', { ...o, axis: 'z', sides: 6, collide: false, yaw: 0 });
      b.box(0, 1.5, 1.0, 1.9, 1.2, 0.1, 'paint', { ...o, tint: mul(C.olive, 0.85), collide: false });
    }, id);
    sandbags(b, -2.4, 2.2, 2.4, 2.2, 0.85);
  }, y);
}

/** Scorched shell crater (visual only). */
export function crater(b: LevelBuilder, x: number, z: number, r = 2.2): void {
  b.cyl(x, 0.012, z, r, 0.01, 'dirt', { collide: false, sides: 12, tint: [0.16, 0.14, 0.12], caps: 2, ao: 1 });
  rubble(b, x, z, r * 0.9, 5, 'concrete', [0.6, 0.58, 0.55]);
}

/** Painted helipad. */
export function helipad(b: LevelBuilder, x: number, z: number, y = 0.02): void {
  b.cyl(x, y, z, 7, 0.01, 'paint', { collide: false, sides: 24, tint: [0.2, 0.22, 0.24], caps: 2, ao: 1 });
  b.flat(x, z, 0.6, 5, 'paint', { y: y + 0.02, tint: C.yellow });
  b.flat(x - 1.6, z, 0.6, 5, 'paint', { y: y + 0.02, tint: C.yellow });
  b.flat(x - 0.8, z, 2.2, 0.6, 'paint', { y: y + 0.02, tint: C.yellow });
  for (let i = 0; i < 8; i++) b.glow(x + Math.cos((i / 8) * 6.283) * 7, y + 0.2, z + Math.sin((i / 8) * 6.283) * 7, 0x39ff6a, 0.7);
}

/**
 * Builds an interior from an ASCII floor plan. '#' is wall; every other character is open floor and
 * is passed to `legend` with its world position so the chapter can place doors, lights and enemies.
 * Horizontal runs of wall are merged into single boxes to keep the solid count low.
 */
export function gridMap(b: LevelBuilder, rows: string[], cell: number, h: number, wallMat: string, tint: RGB | undefined, legend: (ch: string, x: number, z: number) => void): { x0: number; z0: number; w: number; d: number } {
  const cols = Math.max(...rows.map((r) => r.length));
  const w = cols * cell;
  const d = rows.length * cell;
  const x0 = -w / 2;
  const z0 = -d / 2;
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r].padEnd(cols, '#');
    let run = -1;
    for (let c = 0; c <= cols; c++) {
      const wall = c < cols && line[c] === '#';
      if (wall && run < 0) run = c;
      if (!wall && run >= 0) {
        // Skip wall cells that are buried on all sides: they are never seen.
        const len = c - run;
        b.box(x0 + (run + len / 2) * cell, 0, z0 + (r + 0.5) * cell, len * cell, h, cell, wallMat, { tint });
        run = -1;
      }
      if (c < cols && !wall && line[c] !== ' ') legend(line[c], x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell);
    }
  }
  return { x0, z0, w, d };
}

/** Scatters instanced scenery (trees, rocks, bushes) where `ok` allows. */
export function scatter(b: LevelBuilder, kind: string, n: number, minX: number, minZ: number, maxX: number, maxZ: number, ok: (x: number, z: number) => boolean, size: [number, number] = [0.8, 1.3], solid = true): void {
  let placed = 0;
  for (let i = 0; i < n * 8 && placed < n; i++) {
    const x = b.rng.range(minX, maxX);
    const z = b.rng.range(minZ, maxZ);
    if (!ok(x, z)) continue;
    const s = b.rng.range(size[0], size[1]);
    if (kind === 'rock') rock(b, x, z, s * 1.2);
    else if (solid) tree(b, x, z, s, kind);
    else b.inst(kind, x, z, s);
    placed++;
  }
}
