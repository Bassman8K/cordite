import type { Surface, TerrainLike } from './collision';

/** Regular-grid heightfield. Sampling is bilinear so collision matches the rendered mesh exactly. */
export class Terrain implements TerrainLike {
  readonly n: number;
  readonly h: Float32Array;
  maxH = -Infinity;
  minH = Infinity;

  constructor(
    public readonly minX: number,
    public readonly minZ: number,
    public readonly size: number,
    public readonly cell: number,
    heightFn: (x: number, z: number) => number,
    private readonly surfFn: (x: number, z: number, h: number, slope: number) => Surface,
  ) {
    this.n = Math.round(size / cell);
    const n1 = this.n + 1;
    this.h = new Float32Array(n1 * n1);
    for (let iz = 0; iz < n1; iz++) {
      for (let ix = 0; ix < n1; ix++) {
        const v = heightFn(minX + ix * cell, minZ + iz * cell);
        this.h[iz * n1 + ix] = v;
        if (v > this.maxH) this.maxH = v;
        if (v < this.minH) this.minH = v;
      }
    }
  }

  heightAt(x: number, z: number): number {
    const n = this.n;
    let fx = (x - this.minX) / this.cell;
    let fz = (z - this.minZ) / this.cell;
    fx = fx < 0 ? 0 : fx > n - 1e-4 ? n - 1e-4 : fx;
    fz = fz < 0 ? 0 : fz > n - 1e-4 ? n - 1e-4 : fz;
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const n1 = n + 1;
    const i = iz * n1 + ix;
    const a = this.h[i];
    const b = this.h[i + 1];
    const c = this.h[i + n1];
    const d = this.h[i + n1 + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  slopeAt(x: number, z: number): number {
    const e = this.cell;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): void {
    const e = this.cell;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx;
    const ny = 2 * e;
    const nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l;
    out.y = ny / l;
    out.z = nz / l;
  }

  surfaceAt(x: number, z: number): Surface {
    return this.surfFn(x, z, this.heightAt(x, z), this.slopeAt(x, z));
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    // Entirely above the highest point: cannot hit.
    if (oy > this.maxH && oy + dy * maxDist > this.maxH) return -1;
    const step = this.cell * 0.6;
    let t0 = 0;
    if (oy - this.heightAt(ox, oz) < 0) return -1; // started underground; ignore
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = t > maxDist ? maxDist : t;
      const x = ox + dx * tt;
      const z = oz + dz * tt;
      const y = oy + dy * tt;
      if (y < this.heightAt(x, z)) {
        // Refine between t0 and tt.
        let a = t0;
        let b = tt;
        for (let i = 0; i < 6; i++) {
          const m = (a + b) * 0.5;
          if (oy + dy * m < this.heightAt(ox + dx * m, oz + dz * m)) b = m;
          else a = m;
        }
        return a;
      }
      t0 = tt;
      if (tt >= maxDist) break;
    }
    return -1;
  }
}
