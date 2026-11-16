import * as THREE from 'three';
import type { EnemySpawn } from '../../world/builder';
import type { Game } from '../game';
import { Enemy, type BodyPart } from './soldier';

export interface EnemyHit {
  enemy: Enemy;
  t: number;
  part: BodyPart;
}

/** Owns every soldier in the level and answers spatial queries about them. */
export class EnemyManager {
  readonly group = new THREE.Group();
  list: Enemy[] = [];
  private corpses: Enemy[] = [];
  private pathBudget = 0;
  private shoutCool = 0;
  private part = { part: 'torso' as BodyPart };
  private result: EnemyHit = { enemy: null as unknown as Enemy, t: 0, part: 'torso' };
  private sep = { x: 0, z: 0 };
  /** Soldiers currently fighting (drives music and the HUD threat state). */
  fighting = 0;
  suspicious = 0;
  private countT = 0;

  constructor(private readonly game: Game) {
    this.group.name = 'enemies';
  }

  spawn(def: EnemySpawn): Enemy {
    const g = this.game;
    const y = def.y ?? g.nav.heightAt(def.x, def.z);
    const e = new Enemy(g, def.type, def.x, y, def.z, def.yaw, { group: def.group, patrol: def.patrol, hold: def.hold, crouch: def.crouch, weapon: def.weapon, id: def.id, fixedY: def.y !== undefined });
    this.list.push(e);
    this.group.add(e.mesh);
    return e;
  }

  clear(): void {
    for (const e of this.list) e.dispose();
    for (const e of this.corpses) e.dispose();
    this.list.length = 0;
    this.corpses.length = 0;
    this.fighting = 0;
    this.suspicious = 0;
  }

  update(dt: number): void {
    this.pathBudget = 3;
    this.shoutCool -= dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.update(dt);
      if (e.corpse) {
        this.list.splice(i, 1);
        this.corpses.push(e);
        if (this.corpses.length > 14) this.corpses.shift()?.dispose();
      }
    }
    this.countT -= dt;
    if (this.countT <= 0) {
      this.countT = 0.4;
      let f = 0;
      let s = 0;
      for (const e of this.list) {
        if (!e.alive) continue;
        if (e.state === 'combat') f++;
        else if (e.state === 'investigate' || e.state === 'search') s++;
      }
      this.fighting = f;
      this.suspicious = s;
    }
  }

  /** Living soldiers, optionally limited to one or more spawn groups. */
  alive(groups?: string[]): number {
    let n = 0;
    for (const e of this.list) if (e.alive && (!groups || groups.includes(e.group))) n++;
    return n;
  }

  byTag(tag: string): Enemy | undefined {
    return this.list.find((e) => e.tag === tag);
  }

  /** Nearest soldier hit by a ray. Rounds that pass close by suppress whoever they nearly hit. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, ignore: Enemy | null = null, suppress = true): EnemyHit | null {
    let best = maxT;
    let found: Enemy | null = null;
    let bestPart: BodyPart = 'torso';
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive || e === ignore) continue;
      const vx = e.pos.x - ox;
      const vy = e.pos.y + 0.95 - oy;
      const vz = e.pos.z - oz;
      const t = vx * dx + vy * dy + vz * dz;
      if (t < -1.2 || t > best + 1.2) continue;
      const d2 = vx * vx + vy * vy + vz * vz - t * t;
      if (d2 > 2.6) continue;
      const th = e.hitTest(ox, oy, oz, dx, dy, dz, best, this.part);
      if (th >= 0) {
        best = th;
        found = e;
        bestPart = this.part.part;
      } else if (suppress && t > 0 && t <= maxT) e.suppressBy(0.3);
    }
    if (!found) return null;
    this.result.enemy = found;
    this.result.t = best;
    this.result.part = bestPart;
    return this.result;
  }

  forEachNear(x: number, y: number, z: number, r: number, cb: (e: Enemy, dist: number) => void): void {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.y + 0.9 - y, e.pos.z - z);
      if (d < r) cb(e, d);
    }
  }

  hearNoise(x: number, y: number, z: number, radius: number, gunshot: boolean): void {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < radius && Math.abs(e.pos.y - y) < 14) e.hear(x, y, z, gunshot);
    }
  }

  /** A soldier who spots the player warns squad mates and anyone close by. */
  alertGroup(src: Enemy, x: number, y: number, z: number, radius: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive || e === src || e.state === 'combat') continue;
      const d = Math.hypot(e.pos.x - src.pos.x, e.pos.z - src.pos.z);
      if (d < radius || (e.group === src.group && d < radius * 1.8)) e.enterCombat(x, y, z, false, 0.5 + Math.random() * 0.9 + d * 0.02);
    }
  }

  /** Puts a whole spawn group on alert (scripted alarms, ambushes). */
  alertAll(groups: string[] | null, x: number, y: number, z: number): void {
    for (const e of this.list) if (e.alive && (!groups || groups.includes(e.group))) e.enterCombat(x, y, z, false, 0.4 + Math.random() * 1.2);
  }

  shout(e: Enemy, urgent = false): void {
    if (this.shoutCool > 0 && !urgent) return;
    this.shoutCool = 2.4;
    this.game.audio.play(`shout${1 + Math.floor(Math.random() * 3)}`, { x: e.pos.x, y: e.pos.y + 1.6, z: e.pos.z, ref: 9, vol: 0.9 });
  }

  takePathBudget(): boolean {
    if (this.pathBudget <= 0) return false;
    this.pathBudget--;
    return true;
  }

  separation(self: Enemy, _scratch: THREE.Vector3): { x: number; z: number } {
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i];
      if (o === self || !o.alive) continue;
      const dx = self.pos.x - o.pos.x;
      const dz = self.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.0 && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        const k = (1 - d) / d;
        sx += dx * k * 2.2;
        sz += dz * k * 2.2;
      }
    }
    this.sep.x = sx;
    this.sep.z = sz;
    return this.sep;
  }
}
