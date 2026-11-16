// Geometry emitters that append straight into plain number arrays. Keeping this free of
// three.js means levels can be built (and validated) in Node without a GPU.

export interface GeoBucket {
  mat: string;
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

export const makeBucket = (mat: string): GeoBucket => ({ mat, pos: [], nrm: [], uv: [], col: [], idx: [] });

export interface Xf {
  x: number;
  y: number;
  z: number;
  cos: number;
  sin: number;
  /** True when unrotated: UVs then follow world coordinates so neighbouring pieces tile seamlessly. */
  aligned: boolean;
}

export type RGB = readonly [number, number, number];
export const WHITE: RGB = [1, 1, 1];

function vert(b: GeoBucket, xf: Xf, lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, u: number, v: number, c: RGB, shade: number): void {
  b.pos.push(xf.x + lx * xf.cos + lz * xf.sin, xf.y + ly, xf.z - lx * xf.sin + lz * xf.cos);
  b.nrm.push(nx * xf.cos + nz * xf.sin, ny, -nx * xf.sin + nz * xf.cos);
  b.uv.push(u, v);
  b.col.push(c[0] * shade, c[1] * shade, c[2] * shade);
}

function quadIdx(b: GeoBucket, base: number): void {
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Axis-aligned (in local space) box with its base at local y = 0, centred on the transform.
 * `ao` darkens the bottom edge of the side faces - a cheap contact shadow that sells weight.
 * `faces` bitmask: 1 +X, 2 -X, 4 +Y, 8 -Y, 16 +Z, 32 -Z.
 */
export function emitBox(b: GeoBucket, xf: Xf, sx: number, sy: number, sz: number, c: RGB = WHITE, uvs = 0.5, ao = 0.78, faces = 63): void {
  const hx = sx / 2;
  const hz = sz / 2;
  const ox = xf.aligned ? xf.x : 0;
  const oz = xf.aligned ? xf.z : 0;
  const oy = xf.y;
  const top = 1;
  const bot = sy > 0.35 ? ao : 1;
  let base: number;
  if (faces & 1) {
    base = b.pos.length / 3;
    vert(b, xf, hx, 0, hz, 1, 0, 0, (oz + hz) * uvs, oy * uvs, c, bot);
    vert(b, xf, hx, 0, -hz, 1, 0, 0, (oz - hz) * uvs, oy * uvs, c, bot);
    vert(b, xf, hx, sy, -hz, 1, 0, 0, (oz - hz) * uvs, (oy + sy) * uvs, c, top);
    vert(b, xf, hx, sy, hz, 1, 0, 0, (oz + hz) * uvs, (oy + sy) * uvs, c, top);
    quadIdx(b, base);
  }
  if (faces & 2) {
    base = b.pos.length / 3;
    vert(b, xf, -hx, 0, -hz, -1, 0, 0, (oz - hz) * uvs, oy * uvs, c, bot);
    vert(b, xf, -hx, 0, hz, -1, 0, 0, (oz + hz) * uvs, oy * uvs, c, bot);
    vert(b, xf, -hx, sy, hz, -1, 0, 0, (oz + hz) * uvs, (oy + sy) * uvs, c, top);
    vert(b, xf, -hx, sy, -hz, -1, 0, 0, (oz - hz) * uvs, (oy + sy) * uvs, c, top);
    quadIdx(b, base);
  }
  if (faces & 4) {
    base = b.pos.length / 3;
    vert(b, xf, -hx, sy, hz, 0, 1, 0, (ox - hx) * uvs, (oz + hz) * uvs, c, top);
    vert(b, xf, hx, sy, hz, 0, 1, 0, (ox + hx) * uvs, (oz + hz) * uvs, c, top);
    vert(b, xf, hx, sy, -hz, 0, 1, 0, (ox + hx) * uvs, (oz - hz) * uvs, c, top);
    vert(b, xf, -hx, sy, -hz, 0, 1, 0, (ox - hx) * uvs, (oz - hz) * uvs, c, top);
    quadIdx(b, base);
  }
  if (faces & 8) {
    base = b.pos.length / 3;
    vert(b, xf, -hx, 0, -hz, 0, -1, 0, (ox - hx) * uvs, (oz - hz) * uvs, c, bot);
    vert(b, xf, hx, 0, -hz, 0, -1, 0, (ox + hx) * uvs, (oz - hz) * uvs, c, bot);
    vert(b, xf, hx, 0, hz, 0, -1, 0, (ox + hx) * uvs, (oz + hz) * uvs, c, bot);
    vert(b, xf, -hx, 0, hz, 0, -1, 0, (ox - hx) * uvs, (oz + hz) * uvs, c, bot);
    quadIdx(b, base);
  }
  if (faces & 16) {
    base = b.pos.length / 3;
    vert(b, xf, -hx, 0, hz, 0, 0, 1, (ox - hx) * uvs, oy * uvs, c, bot);
    vert(b, xf, hx, 0, hz, 0, 0, 1, (ox + hx) * uvs, oy * uvs, c, bot);
    vert(b, xf, hx, sy, hz, 0, 0, 1, (ox + hx) * uvs, (oy + sy) * uvs, c, top);
    vert(b, xf, -hx, sy, hz, 0, 0, 1, (ox - hx) * uvs, (oy + sy) * uvs, c, top);
    quadIdx(b, base);
  }
  if (faces & 32) {
    base = b.pos.length / 3;
    vert(b, xf, hx, 0, -hz, 0, 0, -1, (ox + hx) * uvs, oy * uvs, c, bot);
    vert(b, xf, -hx, 0, -hz, 0, 0, -1, (ox - hx) * uvs, oy * uvs, c, bot);
    vert(b, xf, -hx, sy, -hz, 0, 0, -1, (ox - hx) * uvs, (oy + sy) * uvs, c, top);
    vert(b, xf, hx, sy, -hz, 0, 0, -1, (ox + hx) * uvs, (oy + sy) * uvs, c, top);
    quadIdx(b, base);
  }
}

/**
 * Cylinder / cone / frustum. axis 'y': base sits at the transform. axis 'x' or 'z': the transform is
 * the centre of the axis. `r2` is the far-end radius (defaults to r).
 */
export function emitCyl(b: GeoBucket, xf: Xf, r: number, len: number, axis: 'x' | 'y' | 'z' = 'y', c: RGB = WHITE, sides = 10, r2 = r, uvs = 0.5, caps = 3, ao = 0.85): void {
  const map = (c1: number, a: number, c2: number, out: number[]) => {
    if (axis === 'y') {
      out[0] = c1;
      out[1] = a;
      out[2] = c2;
    } else if (axis === 'x') {
      out[0] = a - len / 2;
      out[1] = -c1;
      out[2] = c2;
    } else {
      out[0] = c1;
      out[1] = -c2;
      out[2] = a - len / 2;
    }
  };
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  const slope = (r - r2) / len;
  const nl = Math.hypot(1, slope);
  const base = b.pos.length / 3;
  const shadeBot = axis === 'y' ? ao : 1;
  for (let i = 0; i <= sides; i++) {
    const th = (i / sides) * Math.PI * 2;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    map(cs / nl, slope / nl, sn / nl, n);
    // The normal is a direction: remove the axis-centre offset the mapper applies.
    if (axis === 'x') n[0] += len / 2;
    if (axis === 'z') n[2] += len / 2;
    map(cs * r, 0, sn * r, p);
    vert(b, xf, p[0], p[1], p[2], n[0], n[1], n[2], (i / sides) * Math.PI * 2 * r * uvs, 0, c, shadeBot);
    map(cs * r2, len, sn * r2, p);
    vert(b, xf, p[0], p[1], p[2], n[0], n[1], n[2], (i / sides) * Math.PI * 2 * r * uvs, len * uvs, c, 1);
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i * 2;
    b.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const cap = (end: 0 | 1) => {
    const rr = end ? r2 : r;
    if (rr < 1e-4) return;
    const cb = b.pos.length / 3;
    map(0, end ? 1 : -1, 0, n);
    if (axis === 'x') n[0] += len / 2;
    if (axis === 'z') n[2] += len / 2;
    map(0, end ? len : 0, 0, p);
    vert(b, xf, p[0], p[1], p[2], n[0], n[1], n[2], 0.5, 0.5, c, end ? 1 : shadeBot);
    for (let i = 0; i <= sides; i++) {
      const th = (i / sides) * Math.PI * 2;
      map(Math.cos(th) * rr, end ? len : 0, Math.sin(th) * rr, p);
      vert(b, xf, p[0], p[1], p[2], n[0], n[1], n[2], 0.5 + Math.cos(th) * 0.5, 0.5 + Math.sin(th) * 0.5, c, end ? 1 : shadeBot);
    }
    for (let i = 0; i < sides; i++) {
      if (end) b.idx.push(cb, cb + i + 2, cb + i + 1);
      else b.idx.push(cb, cb + i + 1, cb + i + 2);
    }
  };
  if (caps & 1) cap(0);
  if (caps & 2) cap(1);
}

/** Right-triangular prism: full height at local +Z, zero height at -Z. Base at local y = 0. */
export function emitRamp(b: GeoBucket, xf: Xf, sx: number, sy: number, sz: number, c: RGB = WHITE, uvs = 0.5): void {
  const hx = sx / 2;
  const hz = sz / 2;
  const sl = Math.hypot(sy, sz);
  const ny = sz / sl;
  const nz = -sy / sl;
  let base = b.pos.length / 3;
  // Sloped face
  vert(b, xf, -hx, 0, -hz, 0, ny, nz, 0, 0, c, 1);
  vert(b, xf, -hx, sy, hz, 0, ny, nz, 0, sl * uvs, c, 1);
  vert(b, xf, hx, sy, hz, 0, ny, nz, sx * uvs, sl * uvs, c, 1);
  vert(b, xf, hx, 0, -hz, 0, ny, nz, sx * uvs, 0, c, 1);
  quadIdx(b, base);
  // Back (vertical) face
  base = b.pos.length / 3;
  vert(b, xf, -hx, 0, hz, 0, 0, 1, 0, 0, c, 0.8);
  vert(b, xf, hx, 0, hz, 0, 0, 1, sx * uvs, 0, c, 0.8);
  vert(b, xf, hx, sy, hz, 0, 0, 1, sx * uvs, sy * uvs, c, 1);
  vert(b, xf, -hx, sy, hz, 0, 0, 1, 0, sy * uvs, c, 1);
  quadIdx(b, base);
  // Bottom
  base = b.pos.length / 3;
  vert(b, xf, -hx, 0, -hz, 0, -1, 0, 0, 0, c, 0.8);
  vert(b, xf, hx, 0, -hz, 0, -1, 0, sx * uvs, 0, c, 0.8);
  vert(b, xf, hx, 0, hz, 0, -1, 0, sx * uvs, sz * uvs, c, 0.8);
  vert(b, xf, -hx, 0, hz, 0, -1, 0, 0, sz * uvs, c, 0.8);
  quadIdx(b, base);
  // Sides
  base = b.pos.length / 3;
  vert(b, xf, hx, 0, -hz, 1, 0, 0, 0, 0, c, 0.8);
  vert(b, xf, hx, sy, hz, 1, 0, 0, sz * uvs, sy * uvs, c, 1);
  vert(b, xf, hx, 0, hz, 1, 0, 0, sz * uvs, 0, c, 0.8);
  b.idx.push(base, base + 1, base + 2);
  base = b.pos.length / 3;
  vert(b, xf, -hx, 0, -hz, -1, 0, 0, 0, 0, c, 0.8);
  vert(b, xf, -hx, 0, hz, -1, 0, 0, sz * uvs, 0, c, 0.8);
  vert(b, xf, -hx, sy, hz, -1, 0, 0, sz * uvs, sy * uvs, c, 1);
  b.idx.push(base, base + 1, base + 2);
}

/** Upper hemisphere (dome) or full sphere centred on the transform. */
export function emitSphere(b: GeoBucket, xf: Xf, r: number, c: RGB = WHITE, seg = 10, rings = 6, dome = false, squash = 1): void {
  const base = b.pos.length / 3;
  const phi0 = dome ? 0 : -Math.PI / 2;
  for (let j = 0; j <= rings; j++) {
    const phi = phi0 + (j / rings) * (Math.PI / 2 - phi0);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const nx = Math.cos(th) * cp;
      const nz = Math.sin(th) * cp;
      vert(b, xf, nx * r, sp * r * squash, nz * r, nx, sp, nz, (i / seg) * 4, (j / rings) * 2, c, 0.75 + 0.25 * ((sp + 1) / 2));
    }
  }
  const row = seg + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = base + j * row + i;
      b.idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
}

/** Free quad from four local corners (counter-clockwise seen from the front). */
export function emitQuad(b: GeoBucket, xf: Xf, p: number[][], n: number[], c: RGB = WHITE, u0 = 0, v0 = 0, u1 = 1, v1 = 1): void {
  const base = b.pos.length / 3;
  vert(b, xf, p[0][0], p[0][1], p[0][2], n[0], n[1], n[2], u0, v0, c, 1);
  vert(b, xf, p[1][0], p[1][1], p[1][2], n[0], n[1], n[2], u1, v0, c, 1);
  vert(b, xf, p[2][0], p[2][1], p[2][2], n[0], n[1], n[2], u1, v1, c, 1);
  vert(b, xf, p[3][0], p[3][1], p[3][2], n[0], n[1], n[2], u0, v1, c, 1);
  quadIdx(b, base);
}
