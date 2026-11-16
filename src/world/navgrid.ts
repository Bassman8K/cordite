import { F_BULLET, F_NAV, makeHit, type Ground, type World } from './collision';

export interface CoverPoint {
  x: number;
  z: number;
  y: number;
  /** Unit direction from the point towards the object providing cover. */
  nx: number;
  nz: number;
  /** Tall enough to stand behind (otherwise crouch). */
  high: boolean;
  taken: number; // id of the agent holding it, 0 if free
}

const STEP_TOL = 0.62;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** 2D walkability grid with A* pathfinding and precomputed cover points. */
export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly walk: Uint8Array;
  readonly gy: Float32Array;
  readonly cover: CoverPoint[] = [];
  /** 1 where a neighbouring cell is blocked: paths prefer to stay off walls. */
  private readonly edge: Uint8Array;
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly mark: Uint32Array;
  private stamp = 1;
  private heap: number[] = [];

  constructor(
    private readonly world: World,
    readonly minX: number,
    readonly minZ: number,
    maxX: number,
    maxZ: number,
    readonly cell = 0.75,
    readonly agentRadius = 0.4,
    readonly agentHeight = 1.7,
  ) {
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    this.gy = new Float32Array(n);
    this.edge = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.mark = new Uint32Array(n);
  }

  cx(ix: number): number {
    return this.minX + (ix + 0.5) * this.cell;
  }
  cz(iz: number): number {
    return this.minZ + (iz + 0.5) * this.cell;
  }
  index(x: number, z: number): number {
    const ix = Math.floor((x - this.minX) / this.cell);
    const iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return -1;
    return iz * this.w + ix;
  }
  walkable(x: number, z: number): boolean {
    const i = this.index(x, z);
    return i >= 0 && this.walk[i] === 1;
  }
  heightAt(x: number, z: number): number {
    const i = this.index(x, z);
    return i >= 0 ? this.gy[i] : 0;
  }

  /**
   * Classifies every cell, then keeps only the region connected to the seed points
   * (normally the player start) so isolated crate tops and rooftops are never targeted.
   */
  build(seeds: Array<[number, number]>, maxFloorRise = 1.3): void {
    const { w, h, world, cell } = this;
    const ground: Ground = { y: 0, surf: 'concrete' };
    const raw = new Uint8Array(w * h);
    for (let iz = 0; iz < h; iz++) {
      for (let ix = 0; ix < w; ix++) {
        const x = this.cx(ix);
        const z = this.cz(iz);
        const base = world.terrain ? world.terrain.heightAt(x, z) : world.baseY;
        world.groundAt(x, z, 0.12, base + maxFloorRise, ground);
        const i = iz * w + ix;
        this.gy[i] = ground.y;
        raw[i] = world.blocked(x, ground.y, z, this.agentRadius, this.agentHeight, F_NAV, 0.45) ? 0 : 1;
      }
    }
    // Flood fill from the seeds.
    const queue: number[] = [];
    for (const [sx, sz] of seeds) {
      const i = this.nearestRaw(raw, sx, sz, 4);
      if (i >= 0 && !this.walk[i]) {
        this.walk[i] = 1;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const ix = i % w;
      const iz = (i / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = ix + DIRS[d][0];
        const nz = iz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const j = nz * w + nx;
        if (this.walk[j] || !raw[j]) continue;
        if (Math.abs(this.gy[j] - this.gy[i]) > STEP_TOL) continue;
        if (d >= 4 && (!raw[iz * w + nx] || !raw[nz * w + ix])) continue;
        this.walk[j] = 1;
        queue.push(j);
      }
    }
    for (let iz = 1; iz < h - 1; iz++) {
      for (let ix = 1; ix < w - 1; ix++) {
        const i = iz * w + ix;
        if (!this.walk[i]) continue;
        if (!this.walk[i - 1] || !this.walk[i + 1] || !this.walk[i - w] || !this.walk[i + w]) this.edge[i] = 1;
      }
    }
    this.buildCover();
    void cell;
  }

  private nearestRaw(raw: Uint8Array, x: number, z: number, radius: number): number {
    const i0 = this.index(x, z);
    if (i0 >= 0 && raw[i0]) return i0;
    const r = Math.ceil(radius / this.cell);
    const ix0 = Math.floor((x - this.minX) / this.cell);
    const iz0 = Math.floor((z - this.minZ) / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = ix0 + dx;
        const iz = iz0 + dz;
        if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) continue;
        const i = iz * this.w + ix;
        if (!raw[i]) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** Index of the closest walkable cell within `radius` metres, or -1. */
  nearest(x: number, z: number, radius = 3): number {
    return this.nearestRaw(this.walk, x, z, radius);
  }

  private buildCover(): void {
    const hit = makeHit();
    const { w, h, world } = this;
    const reach = this.cell + this.agentRadius + 0.45;
    for (let iz = 1; iz < h - 1; iz++) {
      for (let ix = 1; ix < w - 1; ix++) {
        const i = iz * w + ix;
        if (!this.walk[i] || !this.edge[i] || (ix + iz) % 2) continue;
        const x = this.cx(ix);
        const z = this.cz(iz);
        const y = this.gy[i];
        for (let d = 0; d < 4; d++) {
          const dx = DIRS[d][0];
          const dz = DIRS[d][1];
          if (!world.raycast(x, y + 0.7, z, dx, 0, dz, reach, F_BULLET, hit)) continue;
          const high = world.raycast(x, y + 1.55, z, dx, 0, dz, reach, F_BULLET, hit);
          this.cover.push({ x, z, y, nx: dx, nz: dz, high, taken: 0 });
        }
      }
    }
  }

  /** Straight-line walkability test (used for path smoothing and strafing). */
  lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    let prev = this.index(x0, z0);
    if (prev < 0 || !this.walk[prev]) return false;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const i = this.index(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (i < 0 || !this.walk[i]) return false;
      if (Math.abs(this.gy[i] - this.gy[prev]) > STEP_TOL) return false;
      prev = i;
    }
    return true;
  }

  private push(i: number): void {
    const heap = this.heap;
    const f = this.f;
    let c = heap.length;
    heap.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[heap[p]] <= f[i]) break;
      heap[c] = heap[p];
      c = p;
    }
    heap[c] = i;
  }

  private pop(): number {
    const heap = this.heap;
    const f = this.f;
    const top = heap[0];
    const last = heap.pop() as number;
    const n = heap.length;
    if (n > 0) {
      let p = 0;
      for (;;) {
        let c = p * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && f[heap[c + 1]] < f[heap[c]]) c++;
        if (f[heap[c]] >= f[last]) break;
        heap[p] = heap[c];
        p = c;
      }
      heap[p] = last;
    }
    return top;
  }

  /**
   * A* from start to target. Fills `out` with a smoothed list of x,z pairs (excluding the start)
   * and returns true on success.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, out: number[], maxExpand = 12000): boolean {
    out.length = 0;
    const start = this.nearest(sx, sz, 2.5);
    const goal = this.nearest(tx, tz, 4);
    if (start < 0 || goal < 0) return false;
    if (start === goal) {
      out.push(tx, tz);
      return true;
    }
    const { w, h, g, f, parent, mark, walk, gy, edge } = this;
    // Even stamps = open, odd = closed, both unique per search.
    this.stamp += 2;
    const OPEN = this.stamp;
    const CLOSED = this.stamp + 1;
    this.heap.length = 0;
    const gx = goal % w;
    const gz = (goal / w) | 0;
    g[start] = 0;
    f[start] = 0;
    parent[start] = -1;
    mark[start] = OPEN;
    this.push(start);
    let expanded = 0;
    let found = false;
    while (this.heap.length) {
      const cur = this.pop();
      if (mark[cur] === CLOSED) continue;
      mark[cur] = CLOSED;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const ix = cur % w;
      const iz = (cur / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = ix + DIRS[d][0];
        const nz = iz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const j = nz * w + nx;
        if (!walk[j] || mark[j] === CLOSED) continue;
        if (Math.abs(gy[j] - gy[cur]) > STEP_TOL) continue;
        if (d >= 4 && (!walk[iz * w + nx] || !walk[nz * w + ix])) continue;
        const cost = g[cur] + (d >= 4 ? 1.4142 : 1) + (edge[j] ? 0.6 : 0);
        if (mark[j] === OPEN && cost >= g[j]) continue;
        g[j] = cost;
        parent[j] = cur;
        const ax = Math.abs(nx - gx);
        const az = Math.abs(nz - gz);
        f[j] = cost + (ax > az ? ax + 0.4142 * az : az + 0.4142 * ax);
        mark[j] = OPEN;
        this.push(j);
      }
    }
    if (!found) return false;
    // Reconstruct (goal -> start), then string-pull.
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = parent[c]) cells.push(c);
    cells.reverse();
    let ax = this.cx(cells[0] % w);
    let az = this.cz((cells[0] / w) | 0);
    let i = 0;
    while (i < cells.length - 1) {
      let far = i + 1;
      // Binary-ish forward scan for the farthest directly reachable cell.
      for (let k = Math.min(cells.length - 1, i + 24); k > i + 1; k--) {
        const c = cells[k];
        if (this.lineClear(ax, az, this.cx(c % w), this.cz((c / w) | 0))) {
          far = k;
          break;
        }
      }
      const c = cells[far];
      ax = this.cx(c % w);
      az = this.cz((c / w) | 0);
      out.push(ax, az);
      i = far;
    }
    // Finish exactly on the requested target if it is itself walkable.
    if (this.index(tx, tz) === goal && out.length >= 2) {
      out[out.length - 2] = tx;
      out[out.length - 1] = tz;
    }
    return true;
  }

  /** Whether any path exists (cheap connectivity answer used by level validation). */
  reachable(sx: number, sz: number, tx: number, tz: number, snap = 3): boolean {
    return this.nearest(sx, sz, snap) >= 0 && this.nearest(tx, tz, snap) >= 0;
  }
}
