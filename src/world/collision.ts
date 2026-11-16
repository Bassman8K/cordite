// Collision world: yaw-rotated boxes in a uniform grid, plus an optional heightfield.
// Pure TypeScript with no rendering dependencies so it also runs in unit tests.

export const F_MOVE = 1; // blocks characters
export const F_BULLET = 2; // stops projectiles
export const F_SIGHT = 4; // blocks AI line of sight
export const F_NAV = 8; // considered an obstacle by the nav grid
export const F_SOLID = F_MOVE | F_BULLET | F_SIGHT | F_NAV;

export type Surface = 'concrete' | 'metal' | 'wood' | 'dirt' | 'sand' | 'snow' | 'grass' | 'water' | 'flesh' | 'glass' | 'fabric';

export interface Solid {
  id: number;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  y0: number;
  y1: number;
  cos: number;
  sin: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  flags: number;
  surf: Surface;
  /** Resistance to bullet penetration per metre (1 = concrete, 0.15 = sheet metal / thin wood). */
  pen: number;
  tag?: unknown;
  cells: number[];
  stamp: number;
}

export interface TerrainLike {
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
  /** Returns distance along the ray or -1. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): void;
}

export interface RayHit {
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  solid: Solid | null;
  /** Distance at which the ray leaves the solid (for penetration). */
  exit: number;
  surf: Surface;
}

export const makeHit = (): RayHit => ({ t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, solid: null, exit: 0, surf: 'concrete' });

export interface Ground {
  y: number;
  surf: Surface;
}

const CELL = 4;
const key = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);

export class World {
  solids: Solid[] = [];
  terrain: TerrainLike | null = null;
  /** Height used where there is neither terrain nor a solid underfoot. */
  baseY = 0;
  baseSurf: Surface = 'concrete';
  private grid = new Map<number, Solid[]>();
  private stamp = 1;
  private nextId = 1;
  private scratch: Solid[] = [];

  addBox(
    cx: number,
    y0: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    yaw = 0,
    flags = F_SOLID,
    surf: Surface = 'concrete',
    pen = 1,
    tag?: unknown,
  ): Solid {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const hx = sx / 2;
    const hz = sz / 2;
    const ex = Math.abs(hx * cos) + Math.abs(hz * sin);
    const ez = Math.abs(hx * sin) + Math.abs(hz * cos);
    const s: Solid = {
      id: this.nextId++,
      cx,
      cz,
      hx,
      hz,
      y0,
      y1: y0 + sy,
      cos,
      sin,
      minX: cx - ex,
      maxX: cx + ex,
      minZ: cz - ez,
      maxZ: cz + ez,
      flags,
      surf,
      pen,
      tag,
      cells: [],
      stamp: 0,
    };
    this.solids.push(s);
    const x0 = Math.floor(s.minX / CELL);
    const x1 = Math.floor(s.maxX / CELL);
    const z0 = Math.floor(s.minZ / CELL);
    const z1 = Math.floor(s.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(s);
        s.cells.push(k);
      }
    }
    return s;
  }

  remove(s: Solid): void {
    for (const k of s.cells) {
      const cell = this.grid.get(k);
      if (!cell) continue;
      const i = cell.indexOf(s);
      if (i >= 0) cell.splice(i, 1);
    }
    s.cells.length = 0;
    const i = this.solids.indexOf(s);
    if (i >= 0) this.solids.splice(i, 1);
  }

  /** Collects unique solids whose AABB overlaps the given XZ rectangle. The returned array is reused. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, mask = 0xff): Solid[] {
    const out = this.scratch;
    out.length = 0;
    const stamp = ++this.stamp;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.grid.get(key(ix, iz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const s = cell[i];
          if (s.stamp === stamp || !(s.flags & mask)) continue;
          s.stamp = stamp;
          if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ) continue;
          out.push(s);
        }
      }
    }
    return out;
  }

  /** Distance from a point to a solid's footprint in the XZ plane (0 when inside). */
  static footprintDist(s: Solid, x: number, z: number): number {
    const dx = x - s.cx;
    const dz = z - s.cz;
    const lx = dx * s.cos - dz * s.sin;
    const lz = dx * s.sin + dz * s.cos;
    const ox = Math.max(0, Math.abs(lx) - s.hx);
    const oz = Math.max(0, Math.abs(lz) - s.hz);
    return Math.hypot(ox, oz);
  }

  /** Highest walkable surface at or below `maxY` under a disc of the given radius. */
  groundAt(x: number, z: number, radius: number, maxY: number, out: Ground): Ground {
    let y = this.baseY;
    let surf: Surface = this.baseSurf;
    if (this.terrain) {
      y = this.terrain.heightAt(x, z);
      surf = this.terrain.surfaceAt(x, z);
    }
    const list = this.query(x - radius, z - radius, x + radius, z + radius, F_MOVE);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y1 > maxY || s.y1 <= y) continue;
      if (World.footprintDist(s, x, z) <= radius) {
        y = s.y1;
        surf = s.surf;
      }
    }
    out.y = y;
    out.surf = surf;
    return out;
  }

  /** Lowest ceiling above `y` over a disc, or Infinity. */
  ceilingAt(x: number, z: number, radius: number, y: number): number {
    let c = Infinity;
    const list = this.query(x - radius, z - radius, x + radius, z + radius, F_MOVE);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y0 < y || s.y0 >= c) continue;
      if (World.footprintDist(s, x, z) <= radius) c = s.y0;
    }
    return c;
  }

  /**
   * Pushes a vertical cylinder out of any solid it penetrates horizontally.
   * Solids whose top is within `stepH` of the feet are ignored so the caller can step onto them.
   * Returns true if anything was touched.
   */
  resolve(pos: { x: number; y: number; z: number }, radius: number, height: number, stepH: number, mask = F_MOVE): boolean {
    let touched = false;
    const feet = pos.y;
    const head = pos.y + height;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const list = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, mask);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.y1 <= feet + stepH || s.y0 >= head) continue;
        const dx = pos.x - s.cx;
        const dz = pos.z - s.cz;
        let lx = dx * s.cos - dz * s.sin;
        let lz = dx * s.sin + dz * s.cos;
        const qx = lx < -s.hx ? -s.hx : lx > s.hx ? s.hx : lx;
        const qz = lz < -s.hz ? -s.hz : lz > s.hz ? s.hz : lz;
        const ddx = lx - qx;
        const ddz = lz - qz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= radius * radius) continue;
        if (d2 < 1e-10) {
          // Centre is inside the footprint: leave through the nearest face.
          const px = s.hx - Math.abs(lx);
          const pz = s.hz - Math.abs(lz);
          if (px < pz) lx = (lx < 0 ? -1 : 1) * (s.hx + radius);
          else lz = (lz < 0 ? -1 : 1) * (s.hz + radius);
        } else {
          const d = Math.sqrt(d2);
          const push = (radius - d) / d;
          lx += ddx * push;
          lz += ddz * push;
        }
        pos.x = s.cx + lx * s.cos + lz * s.sin;
        pos.z = s.cz - lx * s.sin + lz * s.cos;
        moved = true;
        touched = true;
      }
      if (!moved) break;
    }
    return touched;
  }

  /** True if a cylinder at this spot overlaps any solid (used for spawn validation and nav). */
  blocked(x: number, y: number, z: number, radius: number, height: number, mask = F_MOVE, stepH = 0.45): boolean {
    const list = this.query(x - radius, z - radius, x + radius, z + radius, mask);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y1 <= y + stepH || s.y0 >= y + height) continue;
      if (World.footprintDist(s, x, z) < radius) return true;
    }
    return false;
  }

  /** Nearest hit along a ray. `dx,dy,dz` must be normalised. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, mask: number, hit: RayHit): boolean {
    let best = maxDist;
    let found: Solid | null = null;
    let bestAxis = 0;
    let bestSign = 0;
    let bestExit = 0;
    const stamp = ++this.stamp;

    let ix = Math.floor(ox / CELL);
    let iz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
    const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
    let tMaxX = adx > 1e-9 ? (dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / adx : Infinity;
    let tMaxZ = adz > 1e-9 ? (dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / adz : Infinity;
    let tEnter = 0;

    for (let guard = 0; guard < 512; guard++) {
      const cell = this.grid.get(key(ix, iz));
      if (cell) {
        for (let i = 0; i < cell.length; i++) {
          const s = cell[i];
          if (s.stamp === stamp || !(s.flags & mask)) continue;
          s.stamp = stamp;
          // Ray in the solid's local frame.
          const rx = ox - s.cx;
          const rz = oz - s.cz;
          const lox = rx * s.cos - rz * s.sin;
          const loz = rx * s.sin + rz * s.cos;
          const ldx = dx * s.cos - dz * s.sin;
          const ldz = dx * s.sin + dz * s.cos;
          let tmin = -Infinity;
          let tmax = Infinity;
          let axis = 0;
          let sgn = 0;
          // X slab
          if (Math.abs(ldx) < 1e-9) {
            if (lox < -s.hx || lox > s.hx) continue;
          } else {
            const inv = 1 / ldx;
            let t1 = (-s.hx - lox) * inv;
            let t2 = (s.hx - lox) * inv;
            let sg = -1;
            if (t1 > t2) {
              const tt = t1;
              t1 = t2;
              t2 = tt;
              sg = 1;
            }
            if (t1 > tmin) {
              tmin = t1;
              axis = 0;
              sgn = sg;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }
          // Y slab
          if (Math.abs(dy) < 1e-9) {
            if (oy < s.y0 || oy > s.y1) continue;
          } else {
            const inv = 1 / dy;
            let t1 = (s.y0 - oy) * inv;
            let t2 = (s.y1 - oy) * inv;
            let sg = -1;
            if (t1 > t2) {
              const tt = t1;
              t1 = t2;
              t2 = tt;
              sg = 1;
            }
            if (t1 > tmin) {
              tmin = t1;
              axis = 1;
              sgn = sg;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }
          // Z slab
          if (Math.abs(ldz) < 1e-9) {
            if (loz < -s.hz || loz > s.hz) continue;
          } else {
            const inv = 1 / ldz;
            let t1 = (-s.hz - loz) * inv;
            let t2 = (s.hz - loz) * inv;
            let sg = -1;
            if (t1 > t2) {
              const tt = t1;
              t1 = t2;
              t2 = tt;
              sg = 1;
            }
            if (t1 > tmin) {
              tmin = t1;
              axis = 2;
              sgn = sg;
            }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }
          if (tmin < 0 || tmin >= best) continue; // behind the origin, origin inside, or farther than best
          best = tmin;
          found = s;
          bestAxis = axis;
          bestSign = sgn;
          bestExit = tmax;
        }
      }
      const tExit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (best <= tExit || tExit > maxDist) break;
      if (tMaxX < tMaxZ) {
        tEnter = tMaxX;
        tMaxX += tDeltaX;
        ix += stepX;
      } else {
        tEnter = tMaxZ;
        tMaxZ += tDeltaZ;
        iz += stepZ;
      }
      if (tEnter > maxDist) break;
    }

    let terrainHit = false;
    if (this.terrain) {
      const tt = this.terrain.raycast(ox, oy, oz, dx, dy, dz, best);
      if (tt >= 0 && tt < best) {
        best = tt;
        terrainHit = true;
      }
    } else if (dy < -1e-6) {
      // Flat base plane.
      const tt = (this.baseY - oy) / dy;
      if (tt >= 0 && tt < best) {
        best = tt;
        terrainHit = true;
      }
    }

    if (!found && !terrainHit) return false;
    hit.t = best;
    hit.x = ox + dx * best;
    hit.y = oy + dy * best;
    hit.z = oz + dz * best;
    if (terrainHit) {
      hit.solid = null;
      hit.exit = best + 100;
      if (this.terrain) {
        const n = this.nrm;
        this.terrain.normalAt(hit.x, hit.z, n);
        hit.nx = n.x;
        hit.ny = n.y;
        hit.nz = n.z;
        hit.surf = this.terrain.surfaceAt(hit.x, hit.z);
      } else {
        hit.nx = 0;
        hit.ny = 1;
        hit.nz = 0;
        hit.surf = this.baseSurf;
      }
      return true;
    }
    const s = found as Solid;
    hit.solid = s;
    hit.exit = bestExit;
    hit.surf = s.surf;
    if (bestAxis === 1) {
      hit.nx = 0;
      hit.ny = bestSign;
      hit.nz = 0;
    } else if (bestAxis === 0) {
      hit.nx = bestSign * s.cos;
      hit.ny = 0;
      hit.nz = -bestSign * s.sin;
    } else {
      hit.nx = bestSign * s.sin;
      hit.ny = 0;
      hit.nz = bestSign * s.cos;
    }
    return true;
  }

  private nrm = { x: 0, y: 1, z: 0 };
  private losHit = makeHit();
  /** True when nothing with `mask` lies between the two points. */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number, mask = F_SIGHT): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, mask, this.losHit);
  }
}
