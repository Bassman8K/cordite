// LevelBuilder: the authoring API chapters use to describe a map. It produces collision solids,
// merged render geometry (as plain arrays) and gameplay markers, with no rendering dependencies.

import { RNG } from '../core/math';
import { F_BULLET, F_MOVE, F_NAV, F_SIGHT, F_SOLID, World, type Solid, type Surface } from './collision';
import { emitBox, emitCyl, emitQuad, emitRamp, emitSphere, makeBucket, WHITE, type GeoBucket, type RGB, type Xf } from './geo';
import { Terrain } from './terrain';

export interface LightDef {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  range: number;
  /** Spot lights aim at (tx, ty, tz). */
  spot?: { tx: number; ty: number; tz: number; angle: number };
  flicker?: number;
  /** Lights can be switched by scripts (e.g. power cut). */
  group?: string;
}
export interface GlowDef {
  x: number;
  y: number;
  z: number;
  color: number;
  size: number;
  group?: string;
}
export interface EnemySpawn {
  type: string;
  x: number;
  z: number;
  y?: number;
  yaw: number;
  group: string;
  patrol?: number[];
  /** Holds position (tower guards, snipers, MG nests). */
  hold?: boolean;
  crouch?: boolean;
  weapon?: string;
  id?: string;
}
export interface PickupDef {
  kind: 'ammo' | 'medkit' | 'armor' | 'grenade';
  x: number;
  y: number;
  z: number;
}
export interface ZoneDef {
  id: string;
  x: number;
  z: number;
  r: number;
  /** Optional rectangular half extents (overrides r). */
  hw?: number;
  hd?: number;
  y?: number;
}
export interface InteractDef {
  id: string;
  x: number;
  y: number;
  z: number;
  label: string;
  hold: number;
  radius: number;
  kind: 'use' | 'plant' | 'resupply' | 'intel' | 'terminal';
  enabled: boolean;
}
export interface PropDef {
  id: string;
  kind: 'barrel' | 'target' | 'door';
  x: number;
  y: number;
  z: number;
  hp: number;
  /** Blast radius when destroyed (0 = none). */
  blast: number;
  solids: Solid[];
  bucket: string;
}
export interface InstanceDef {
  kind: string;
  x: number;
  y: number;
  z: number;
  s: number;
  yaw: number;
  tint: RGB;
}
export interface WaterDef {
  x: number;
  z: number;
  w: number;
  d: number;
  y: number;
}
export interface EmitterDef {
  kind: 'smoke' | 'fire' | 'steam' | 'sparks';
  x: number;
  y: number;
  z: number;
  size: number;
}

export interface BoxOpts {
  yaw?: number;
  tint?: RGB;
  collide?: boolean;
  flags?: number;
  surf?: Surface;
  pen?: number;
  uvs?: number;
  ao?: number;
  faces?: number;
  bucket?: string;
  tag?: unknown;
}

const SURF: Record<string, Surface> = {
  concrete: 'concrete', asphalt: 'concrete', brick: 'concrete', plaster: 'concrete', tile: 'concrete', rock: 'concrete', panel: 'metal',
  metal: 'metal', corrugated: 'metal', rust: 'metal', grate: 'metal', darkmetal: 'metal', paint: 'metal',
  wood: 'wood', planks: 'wood', crate: 'wood',
  dirt: 'dirt', sand: 'sand', snow: 'snow', grass: 'grass', sandbag: 'dirt', fabric: 'fabric', rubber: 'fabric', glass: 'glass',
};
const PEN: Record<string, number> = {
  concrete: 1, asphalt: 1, brick: 0.8, plaster: 0.45, tile: 0.8, rock: 1.4, panel: 0.35,
  metal: 0.9, corrugated: 0.12, rust: 0.5, grate: 0.2, darkmetal: 0.9, paint: 0.6,
  wood: 0.22, planks: 0.16, crate: 0.2, sandbag: 0.7, fabric: 0.03, rubber: 0.3, glass: 0.02,
  dirt: 1, sand: 1, snow: 0.3, grass: 1,
};
const UVS: Record<string, number> = {
  concrete: 0.25, asphalt: 0.2, brick: 0.5, plaster: 0.3, tile: 0.6, rock: 0.25, panel: 0.5,
  metal: 0.5, corrugated: 0.36, rust: 0.4, grate: 1, darkmetal: 0.6, paint: 0.5,
  wood: 0.6, planks: 0.55, crate: 1, sandbag: 1.6, fabric: 0.6, rubber: 1, glass: 0.5,
  dirt: 0.18, sand: 0.14, snow: 0.14, grass: 0.2,
};

/** sRGB hex colour -> linear RGB scaled by k (values above 1 bloom). */
export function hexLin(hex: number, k = 1): RGB {
  const f = (v: number) => Math.pow(v / 255, 2.2) * k;
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

export class LevelBuilder {
  readonly world = new World();
  readonly buckets = new Map<string, GeoBucket>();
  readonly lights: LightDef[] = [];
  readonly glows: GlowDef[] = [];
  readonly enemies: EnemySpawn[] = [];
  readonly pickups: PickupDef[] = [];
  readonly zones = new Map<string, ZoneDef>();
  readonly interacts: InteractDef[] = [];
  readonly props: PropDef[] = [];
  readonly instances: InstanceDef[] = [];
  readonly water: WaterDef[] = [];
  readonly emitters: EmitterDef[] = [];
  readonly navSeeds: Array<[number, number]> = [];
  spawn = { x: 0, y: 0, z: 0, yaw: 0 };
  bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
  terrain: Terrain | null = null;
  terrainColor: ((x: number, z: number, h: number, slope: number) => RGB) | null = null;
  terrainMat = 'dirt';
  readonly rng: RNG;
  /** Render chunk size in metres (for frustum culling of merged geometry). */
  chunk = 48;
  private stack: Xf[] = [{ x: 0, y: 0, z: 0, cos: 1, sin: 0, aligned: true }];
  private yawStack: number[] = [0];
  private propSeq = 0;

  constructor(seed = 1) {
    this.rng = new RNG(seed);
  }

  // ---------------------------------------------------------------- transforms

  private get xf(): Xf {
    return this.stack[this.stack.length - 1];
  }
  get yaw(): number {
    return this.yawStack[this.yawStack.length - 1];
  }
  /** Runs `fn` with a local origin/rotation. Everything emitted inside is placed relative to it. */
  at(x: number, z: number, yaw: number, fn: () => void, y = 0): void {
    const p = this.xf;
    const wx = p.x + x * p.cos + z * p.sin;
    const wz = p.z - x * p.sin + z * p.cos;
    const wy = p.y + y;
    const ya = this.yaw + yaw;
    this.stack.push({ x: wx, y: wy, z: wz, cos: Math.cos(ya), sin: Math.sin(ya), aligned: Math.abs(Math.sin(ya)) < 1e-6 && Math.cos(ya) > 0 });
    this.yawStack.push(ya);
    try {
      fn();
    } finally {
      this.stack.pop();
      this.yawStack.pop();
    }
  }
  /** Local -> world position. */
  w(x: number, z: number, y = 0): { x: number; y: number; z: number } {
    const p = this.xf;
    return { x: p.x + x * p.cos + z * p.sin, y: p.y + y, z: p.z - x * p.sin + z * p.cos };
  }
  private local(x: number, y: number, z: number, yaw = 0): Xf {
    const p = this.xf;
    const wx = p.x + x * p.cos + z * p.sin;
    const wz = p.z - x * p.sin + z * p.cos;
    if (yaw === 0) return { x: wx, y: p.y + y, z: wz, cos: p.cos, sin: p.sin, aligned: p.aligned };
    const ya = this.yaw + yaw;
    return { x: wx, y: p.y + y, z: wz, cos: Math.cos(ya), sin: Math.sin(ya), aligned: false };
  }

  bucket(mat: string, x: number, z: number, override?: string): GeoBucket {
    // Overridden buckets (dynamic props, switchable light groups) are keyed "<owner>|<material>".
    const k = override ? `${override}|${mat}` : `${mat}|${Math.floor(x / this.chunk)}|${Math.floor(z / this.chunk)}`;
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = makeBucket(mat)));
    return b;
  }

  // ---------------------------------------------------------------- primitives

  /** Box with its base at y. Adds a collision solid unless `collide: false`. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: string, o: BoxOpts = {}): Solid | null {
    const xf = this.local(x, y, z, o.yaw ?? 0);
    emitBox(this.bucket(mat, xf.x, xf.z, o.bucket), xf, sx, sy, sz, o.tint ?? WHITE, o.uvs ?? UVS[mat] ?? 0.5, o.ao ?? 0.78, o.faces ?? 63);
    if (o.collide === false) return null;
    return this.solid(x, y, z, sx, sy, sz, { ...o, surf: o.surf ?? SURF[mat] ?? 'concrete', pen: o.pen ?? PEN[mat] ?? 1 });
  }

  /** Collision only. */
  solid(x: number, y: number, z: number, sx: number, sy: number, sz: number, o: BoxOpts = {}): Solid {
    const p = this.w(x, z, y);
    return this.world.addBox(p.x, p.y, p.z, sx, sy, sz, this.yaw + (o.yaw ?? 0), o.flags ?? F_SOLID, o.surf ?? 'concrete', o.pen ?? 1, o.tag);
  }

  /** Cylinder. axis 'y' stands on y; 'x' / 'z' are centred on (x, y, z). */
  cyl(x: number, y: number, z: number, r: number, len: number, mat: string, o: BoxOpts & { axis?: 'x' | 'y' | 'z'; sides?: number; r2?: number; caps?: number } = {}): Solid | null {
    const xf = this.local(x, y, z, o.yaw ?? 0);
    const axis = o.axis ?? 'y';
    emitCyl(this.bucket(mat, xf.x, xf.z, o.bucket), xf, r, len, axis, o.tint ?? WHITE, o.sides ?? 10, o.r2 ?? r, o.uvs ?? UVS[mat] ?? 0.5, o.caps ?? 3, o.ao ?? 0.85);
    if (o.collide === false) return null;
    const so = { ...o, surf: o.surf ?? SURF[mat] ?? 'metal', pen: o.pen ?? PEN[mat] ?? 1 };
    const d = r * 1.8;
    if (axis === 'y') return this.solid(x, y, z, d, len, d, so);
    if (axis === 'x') return this.solid(x, y - r, z, len, r * 2, d, so);
    return this.solid(x, y - r, z, d, r * 2, len, so);
  }

  ramp(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: string, o: BoxOpts = {}): void {
    const xf = this.local(x, y, z, o.yaw ?? 0);
    emitRamp(this.bucket(mat, xf.x, xf.z, o.bucket), xf, sx, sy, sz, o.tint ?? WHITE, o.uvs ?? UVS[mat] ?? 0.5);
  }

  sphere(x: number, y: number, z: number, r: number, mat: string, o: BoxOpts & { dome?: boolean; squash?: number } = {}): void {
    const xf = this.local(x, y, z, 0);
    emitSphere(this.bucket(mat, xf.x, xf.z, o.bucket), xf, r, o.tint ?? WHITE, 12, o.dome ? 5 : 8, o.dome ?? false, o.squash ?? 1);
    if (o.collide !== false) this.solid(x, o.dome ? y : y - r, z, r * 1.6, o.dome ? r : r * 2, r * 1.6, { ...o, surf: o.surf ?? 'metal' });
  }

  /** Flat horizontal quad (road paint, floor decals, ground patches). No collision. */
  flat(x: number, z: number, sx: number, sz: number, mat: string, o: { y?: number; tint?: RGB; yaw?: number; uvs?: number } = {}): void {
    const xf = this.local(x, o.y ?? 0.02, z, o.yaw ?? 0);
    emitBox(this.bucket(mat, xf.x, xf.z), xf, sx, 0, sz, o.tint ?? WHITE, o.uvs ?? UVS[mat] ?? 0.5, 1, 4);
  }

  /** Vertical quad facing local +Z (signs, windows, screens). */
  panel(x: number, y: number, z: number, w: number, h: number, mat: string, o: { yaw?: number; tint?: RGB; double?: boolean } = {}): void {
    const xf = this.local(x, y, z, o.yaw ?? 0);
    const b = this.bucket(mat, xf.x, xf.z);
    const hw = w / 2;
    emitQuad(b, xf, [[-hw, 0, 0], [hw, 0, 0], [hw, h, 0], [-hw, h, 0]], [0, 0, 1], o.tint ?? WHITE, 0, 0, w, h);
    if (o.double) emitQuad(b, xf, [[hw, 0, 0], [-hw, 0, 0], [-hw, h, 0], [hw, h, 0]], [0, 0, -1], o.tint ?? WHITE, 0, 0, w, h);
  }

  /** Glowing vertical quad facing local +Z (screens, lit windows, LEDs). `k` is HDR intensity. */
  panelGlow(x: number, y: number, z: number, w: number, h: number, color: number, k = 3, group?: string): void {
    const xf = this.local(x, y, z, 0);
    const hw = w / 2;
    emitQuad(this.bucket('emissive', xf.x, xf.z, group ? `egrp:${group}` : undefined), xf, [[-hw, 0, 0], [hw, 0, 0], [hw, h, 0], [-hw, h, 0]], [0, 0, 1], hexLin(color, k));
  }

  /** Glowing quad facing straight down (lamp heads, ceiling strips). */
  flatDown(x: number, y: number, z: number, sx: number, sz: number, color: number, k = 4, group?: string): void {
    const xf = this.local(x, y, z, 0);
    emitBox(this.bucket('emissive', xf.x, xf.z, group ? `egrp:${group}` : undefined), xf, sx, 0, sz, hexLin(color, k), 1, 1, 8);
  }

  // ---------------------------------------------------------------- structures

  /**
   * Straight wall from (x1,z1) to (x2,z2). `gaps` are openings measured in metres from the start:
   * [from, to] is a doorway (2.2 m, lintel above); [from, to, sill, top] is a window.
   */
  wall(x1: number, z1: number, x2: number, z2: number, h: number, mat: string, o: BoxOpts & { t?: number; y?: number; gaps?: number[][] } = {}): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const yaw = Math.atan2(-dz, dx);
    const t = o.t ?? 0.3;
    const y = o.y ?? 0;
    const seg = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 0.02 || y1 - y0 < 0.02) return;
      const m = (a + b) / 2 / len;
      this.box(x1 + dx * m, y + y0, z1 + dz * m, b - a, y1 - y0, t, mat, { ...o, yaw });
    };
    const gaps = (o.gaps ?? []).slice().sort((a, b) => a[0] - b[0]);
    let cur = 0;
    for (const g of gaps) {
      seg(cur, g[0], 0, h);
      const sill = g.length > 2 ? g[2] : 0;
      const top = g.length > 3 ? g[3] : 2.2;
      seg(g[0], g[1], 0, sill);
      seg(g[0], g[1], top, h);
      cur = g[1];
    }
    seg(cur, len, 0, h);
  }

  /** Solid staircase rising along local +Z from (x, y, z). */
  stairs(x: number, y: number, z: number, yaw: number, width: number, steps: number, mat = 'concrete', rise = 0.2, run = 0.3, o: BoxOpts = {}): void {
    this.at(x, z, yaw, () => {
      for (let i = 0; i < steps; i++) this.box(0, 0, (i + 0.5) * run, width, (i + 1) * rise, run, mat, { ...o, ao: 1 });
    }, y);
  }

  /** Invisible wall that stops characters but not bullets or sight. */
  blocker(x1: number, z1: number, x2: number, z2: number, h = 6, y = -2): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    this.solid((x1 + x2) / 2, y, (z1 + z2) / 2, len, h, 0.6, { yaw: Math.atan2(-dz, dx), flags: F_MOVE | F_NAV });
  }

  /** Rectangular playable area: sets bounds and rings it with blockers. */
  playArea(minX: number, minZ: number, maxX: number, maxZ: number, walls = true): void {
    this.bounds = { minX, minZ, maxX, maxZ };
    if (!walls) return;
    this.blocker(minX, minZ, maxX, minZ, 40, -10);
    this.blocker(maxX, minZ, maxX, maxZ, 40, -10);
    this.blocker(maxX, maxZ, minX, maxZ, 40, -10);
    this.blocker(minX, maxZ, minX, minZ, 40, -10);
  }

  setTerrain(size: number, cell: number, heightFn: (x: number, z: number) => number, surfFn: (x: number, z: number, h: number, slope: number) => Surface, colorFn: (x: number, z: number, h: number, slope: number) => RGB, mat = 'dirt', cx = 0, cz = 0): Terrain {
    this.terrain = new Terrain(cx - size / 2, cz - size / 2, size, cell, heightFn, surfFn);
    this.world.terrain = this.terrain;
    this.terrainColor = colorFn;
    this.terrainMat = mat;
    return this.terrain;
  }

  /** Ground height at a local position (terrain or base plane), for placing props on slopes. */
  gy(x: number, z: number): number {
    const p = this.w(x, z);
    return this.terrain ? this.terrain.heightAt(p.x, p.z) : this.world.baseY;
  }

  // ---------------------------------------------------------------- gameplay markers

  playerStart(x: number, z: number, yawDeg = 0): void {
    const p = this.w(x, z);
    this.spawn = { x: p.x, y: this.gy(x, z), z: p.z, yaw: this.yaw + (yawDeg * Math.PI) / 180 };
    this.navSeeds.push([p.x, p.z]);
  }

  enemy(type: string, x: number, z: number, o: Partial<Omit<EnemySpawn, 'type' | 'x' | 'z' | 'patrol'>> & { yawDeg?: number; patrol?: Array<[number, number]> } = {}): void {
    const p = this.w(x, z);
    const patrol = o.patrol ? o.patrol.flatMap(([px, pz]) => { const q = this.w(px, pz); return [q.x, q.z]; }) : undefined;
    this.enemies.push({ type, x: p.x, z: p.z, y: o.y !== undefined ? this.xf.y + o.y : undefined, yaw: this.yaw + ((o.yawDeg ?? 0) * Math.PI) / 180, group: o.group ?? 'start', patrol, hold: o.hold, crouch: o.crouch, weapon: o.weapon, id: o.id });
  }

  pickup(kind: PickupDef['kind'], x: number, z: number, y?: number): void {
    const p = this.w(x, z);
    this.pickups.push({ kind, x: p.x, y: y !== undefined ? this.xf.y + y : this.gy(x, z), z: p.z });
  }

  zone(id: string, x: number, z: number, r: number, o: { hw?: number; hd?: number } = {}): void {
    const p = this.w(x, z);
    this.zones.set(id, { id, x: p.x, z: p.z, r, hw: o.hw, hd: o.hd, y: Math.max(this.xf.y, this.gy(x, z)) });
  }

  interact(id: string, x: number, y: number, z: number, label: string, o: Partial<Pick<InteractDef, 'hold' | 'radius' | 'kind' | 'enabled'>> = {}): void {
    const p = this.w(x, z, y);
    this.interacts.push({ id, x: p.x, y: p.y, z: p.z, label, hold: o.hold ?? 1.2, radius: o.radius ?? 2.2, kind: o.kind ?? 'use', enabled: o.enabled ?? true });
  }

  light(x: number, y: number, z: number, color: number, intensity: number, range: number, o: { spotTo?: [number, number, number]; angle?: number; flicker?: number; group?: string; glow?: number } = {}): void {
    const p = this.w(x, z, y);
    const def: LightDef = { x: p.x, y: p.y, z: p.z, color, intensity, range, flicker: o.flicker, group: o.group };
    if (o.spotTo) {
      const t = this.w(o.spotTo[0], o.spotTo[2], o.spotTo[1]);
      def.spot = { tx: t.x, ty: t.y, tz: t.z, angle: o.angle ?? 0.9 };
    }
    this.lights.push(def);
    if (o.glow) this.glows.push({ x: p.x, y: p.y, z: p.z, color, size: o.glow, group: o.group });
  }

  glow(x: number, y: number, z: number, color: number, size: number, group?: string): void {
    const p = this.w(x, z, y);
    this.glows.push({ x: p.x, y: p.y, z: p.z, color, size, group });
  }

  inst(kind: string, x: number, z: number, s = 1, o: { yaw?: number; tint?: RGB; y?: number } = {}): void {
    const p = this.w(x, z);
    this.instances.push({ kind, x: p.x, y: o.y ?? this.gy(x, z), z: p.z, s, yaw: o.yaw ?? this.rng.range(0, 6.283), tint: o.tint ?? WHITE });
  }

  emitter(kind: EmitterDef['kind'], x: number, y: number, z: number, size = 1): void {
    const p = this.w(x, z, y);
    this.emitters.push({ kind, x: p.x, y: p.y, z: p.z, size });
  }

  waterPlane(x: number, z: number, w: number, d: number, y: number): void {
    this.water.push({ x, z, w, d, y });
  }

  /**
   * Starts a destructible / scriptable prop. Geometry emitted inside `fn` goes to its own mesh and
   * every solid created is tagged with the prop so damage can find it.
   */
  prop(kind: PropDef['kind'], x: number, y: number, z: number, hp: number, blast: number, fn: (o: BoxOpts) => void, id?: string): PropDef {
    const p = this.w(x, z, y);
    const pid = id ?? `${kind}${++this.propSeq}`;
    const def: PropDef = { id: pid, kind, x: p.x, y: p.y, z: p.z, hp, blast, solids: [], bucket: `dyn:${pid}` };
    const before = this.world.solids.length;
    fn({ bucket: def.bucket, tag: def });
    for (let i = before; i < this.world.solids.length; i++) {
      const s = this.world.solids[i];
      if (s.tag === def) def.solids.push(s);
    }
    this.props.push(def);
    return def;
  }

  flagsNoBullet = F_MOVE | F_NAV;
  flagsCover = F_MOVE | F_NAV | F_BULLET | F_SIGHT;
  flagsSeeThrough = F_MOVE | F_NAV | F_BULLET;
}
