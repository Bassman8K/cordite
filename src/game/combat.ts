// Ballistics and explosives. Every round is a simulated projectile with travel time, drop, drag
// and material penetration - for the player and for enemies alike.

import * as THREE from 'three';
import { clamp, rand } from '../core/math';
import { F_BULLET, F_SIGHT, makeHit, type RayHit } from '../world/collision';
import type { PropDef } from '../world/builder';
import type { Enemy } from './enemies/soldier';
import type { Game } from './game';
import { boostSpeed } from './weapons/data';
import type { WeaponDef } from './weapons/types';

const G = 9.81;
const MAX_BULLETS = 320;

interface Bullet {
  on: boolean;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  speed: number;
  def: WeaponDef;
  player: boolean;
  /** Fired by the player's squad. */
  ally: boolean;
  owner: Enemy | null;
  scale: number;
  pen: number;
  life: number;
  dist: number;
  bright: boolean;
  whizzed: boolean;
}

type ShellKind = 'rocket' | 'grenade' | 'thrown' | 'arrow' | 'flame' | 'flare';
interface Shell {
  kind: ShellKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  def: WeaponDef;
  player: boolean;
  owner: Enemy | null;
  life: number;
  fuse: number;
  age: number;
  mesh: THREE.Mesh | null;
  rest: boolean;
  /** Guided rockets steer towards this point. */
  tx: number; ty: number; tz: number;
  guided: boolean;
  dead: boolean;
  /** Claymore facing. */
  yaw: number;
  emit: number;
}

export interface Zone {
  kind: 'fire' | 'smoke';
  x: number; y: number; z: number;
  r: number;
  life: number;
  player: boolean;
  tick: number;
}

export class Combat {
  readonly group = new THREE.Group();
  private bullets: Bullet[] = [];
  private shells: Shell[] = [];
  readonly zones: Zone[] = [];
  private hit: RayHit = makeHit();
  private hit2: RayHit = makeHit();
  private shotCount = 0;
  private geoGrenade = new THREE.SphereGeometry(0.045, 8, 6);
  private geoRocket = new THREE.CylinderGeometry(0.04, 0.03, 0.5, 8).rotateX(Math.PI / 2);
  private geoArrow = new THREE.CylinderGeometry(0.006, 0.006, 0.72, 5).rotateX(Math.PI / 2);
  private geoCharge = new THREE.BoxGeometry(0.16, 0.06, 0.1);
  private matShell = new THREE.MeshStandardMaterial({ color: 0x3a4232, roughness: 0.7, metalness: 0.3 });
  private matArrow = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.2 });
  private tmp = new THREE.Vector3();
  private whizCool = 0;

  constructor(private readonly game: Game) {
    for (let i = 0; i < MAX_BULLETS; i++) {
      this.bullets.push({ on: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, speed: 0, def: null as unknown as WeaponDef, player: false, ally: false, owner: null, scale: 1, pen: 0, life: 0, dist: 0, bright: false, whizzed: false });
    }
  }

  clear(): void {
    for (const b of this.bullets) b.on = false;
    for (const s of this.shells) if (s.mesh) this.group.remove(s.mesh);
    this.shells.length = 0;
    this.zones.length = 0;
  }

  dispose(): void {
    this.clear();
    this.geoGrenade.dispose();
    this.geoRocket.dispose();
    this.geoArrow.dispose();
    this.geoCharge.dispose();
    this.matShell.dispose();
    this.matArrow.dispose();
  }

  // ------------------------------------------------------------------ spawning

  /** Launches one projectile of the weapon along a (normalised) direction. */
  /**
   * `player` rounds are the player's own. `ally` rounds were fired by the player's squad: they hit the
   * enemy like the player's, but are not counted as the player's shooting and never hit the player.
   */
  fire(def: WeaponDef, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, player: boolean, owner: Enemy | null, scale = 1, ally = false): void {
    if (def.proj === 'bullet') {
      let b: Bullet | null = null;
      for (let i = 0; i < MAX_BULLETS; i++) {
        if (!this.bullets[i].on) {
          b = this.bullets[i];
          break;
        }
      }
      if (!b) return;
      b.on = true;
      b.x = ox;
      b.y = oy;
      b.z = oz;
      b.dx = dx;
      b.dy = dy;
      b.dz = dz;
      b.speed = def.mv * rand(0.985, 1.015);
      b.def = def;
      b.player = player;
      b.ally = ally;
      b.owner = owner;
      b.scale = scale;
      b.pen = def.pen;
      b.life = 3.5;
      b.dist = 0;
      b.whizzed = false;
      b.bright = ++this.shotCount % Math.max(1, def.tracer) === 0;
      return;
    }
    if (def.proj === 'taser') {
      const e = this.game.enemies.raycast(ox, oy, oz, dx, dy, dz, def.range, null, false);
      if (e && this.game.world.los(ox, oy, oz, ox + dx * e.t, oy + dy * e.t, oz + dz * e.t, F_BULLET)) {
        e.enemy.stun(5.5);
        e.enemy.damage(def.damage, 'torso', ox, oz, player);
        this.game.events.emit('hit', { kill: false, head: false, dist: e.t });
      }
      return;
    }
    const kind: ShellKind = def.proj === 'rocket' ? 'rocket' : def.proj === 'grenade' ? 'grenade' : def.proj === 'arrow' ? 'arrow' : def.proj === 'flame' ? 'flame' : 'flare';
    const v = def.mv * (kind === 'flame' ? rand(0.85, 1.1) : 1);
    const s = this.addShell(kind, def, ox, oy, oz, dx * v, dy * v, dz * v, player, owner);
    if (def.guided) {
      // Fire-and-forget: home on whatever the launcher was pointed at.
      const hit = this.hit;
      const far = this.game.world.raycast(ox, oy, oz, dx, dy, dz, 600, F_BULLET, hit) ? hit.t : 600;
      const e = this.game.enemies.raycast(ox, oy, oz, dx, dy, dz, far, null, false);
      const t = e ? e.t : far;
      s.tx = ox + dx * t;
      s.ty = oy + dy * t;
      s.tz = oz + dz * t;
      s.guided = true;
    }
  }

  /** Hand-thrown ordnance (and enemy grenades). */
  throwItem(def: WeaponDef, ox: number, oy: number, oz: number, vx: number, vy: number, vz: number, player: boolean, owner: Enemy | null, cooked = 0): void {
    const s = this.addShell('thrown', def, ox, oy, oz, vx, vy, vz, player, owner);
    s.fuse = Math.max(0.35, def.fuse - cooked);
    if (def.throwKind === 'mine') {
      s.yaw = Math.atan2(-vx, -vz);
      s.vx = s.vz = 0;
      s.vy = -1;
    }
  }

  private addShell(kind: ShellKind, def: WeaponDef, x: number, y: number, z: number, vx: number, vy: number, vz: number, player: boolean, owner: Enemy | null): Shell {
    let mesh: THREE.Mesh | null = null;
    if (kind !== 'flame') {
      const flat = kind === 'thrown' && (def.throwKind === 'remote' || def.throwKind === 'mine');
      mesh = new THREE.Mesh(kind === 'rocket' ? this.geoRocket : kind === 'arrow' ? this.geoArrow : flat ? this.geoCharge : this.geoGrenade, kind === 'arrow' ? this.matArrow : this.matShell);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
    }
    const s: Shell = {
      kind, def, x, y, z, vx, vy, vz, player, owner, mesh, life: kind === 'flame' ? 0.78 : kind === 'arrow' ? 6 : 14, fuse: kind === 'thrown' ? def.fuse : 0,
      age: 0, rest: false, tx: 0, ty: 0, tz: 0, guided: false, dead: false, yaw: 0, emit: 0,
    };
    this.shells.push(s);
    return s;
  }

  /** Sets off every remote charge the player has placed. Returns how many went off. */
  detonateRemote(): number {
    let n = 0;
    for (const s of this.shells) {
      if (s.kind === 'thrown' && s.def.throwKind === 'remote' && s.player && !s.dead) {
        this.detonate(s);
        n++;
      }
    }
    return n;
  }

  hasRemote(): boolean {
    return this.shells.some((s) => s.kind === 'thrown' && s.def.throwKind === 'remote' && s.player && !s.dead);
  }

  // ------------------------------------------------------------------ explosions & zones

  explode(x: number, y: number, z: number, radius: number, damage: number, player: boolean, o: { fire?: boolean; stun?: boolean; silent?: boolean } = {}): void {
    const g = this.game;
    const cam = g.engine.camera.position;
    const dCam = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (!o.silent) {
      if (o.stun) {
        g.audio.play('flashbang', { x, y, z, ref: 22 });
        g.fx.explosion(x, y, z, 2.5);
      } else {
        g.fx.explosion(x, y, z, radius, o.fire);
        g.audio.play('explosion', { x, y, z, ref: 34, vol: 1 });
      }
      g.player.addShake(clamp(1.5 - dCam / (radius * 3.5), 0, 1.4));
      if (dCam < radius * 1.6 && !o.stun) g.audio.deafen(clamp(1.2 - dCam / (radius * 1.6), 0, 1));
    }
    g.enemies.hearNoise(x, y, z, 90, true);
    // Enemies
    g.enemies.forEachNear(x, y, z, radius, (e, d) => {
      const clear = g.world.los(x, y + 0.4, z, e.pos.x, e.pos.y + 1.0, e.pos.z, F_BULLET);
      const k = (1 - d / radius) * (clear ? 1 : 0.2);
      if (o.stun) {
        if (clear) e.stun(5 * (1 - d / radius) + 2);
      } else if (k > 0.02) {
        const killed = e.damage(damage * k, 'torso', x, z, player, true);
        if (player) g.events.emit('hit', { kill: killed, head: false, dist: d });
      }
    });
    // Player
    const p = g.player;
    const dp = Math.hypot(x - p.pos.x, y - (p.pos.y + 0.9), z - p.pos.z);
    if (dp < radius && p.alive) {
      const clear = g.world.los(x, y + 0.4, z, p.pos.x, p.pos.y + 1.0, p.pos.z, F_BULLET);
      if (o.stun) {
        if (clear) {
          // Looking away from a flashbang greatly reduces its effect.
          const facing = p.viewDir(this.tmp).dot(new THREE.Vector3(x - p.eye.x, y - p.eye.y, z - p.eye.z).normalize());
          p.blind = Math.max(p.blind, (1 - dp / radius) * (facing > 0.2 ? 4.5 : 1.2));
          g.events.emit('blind', p.blind);
          g.audio.deafen(1);
        }
      } else {
        const k = (1 - dp / radius) * (clear ? 1 : 0.2);
        // Player-thrown explosives still hurt, but are a little forgiving.
        p.damage(damage * k * (player ? 0.55 : 0.75), x, z, 'blast');
      }
    }
    if (!o.stun) g.level?.damagePropsNear(x, y, z, radius, damage);
    if (o.fire) this.zones.push({ kind: 'fire', x, y, z, r: radius * 0.62, life: 9, player, tick: 0 });
  }

  /** True when an active smoke screen lies between two points (blocks AI sight). */
  smokeBlocks(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const zn of this.zones) {
      if (zn.kind !== 'smoke') continue;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const l2 = dx * dx + dy * dy + dz * dz;
      const t = l2 > 0 ? clamp(((zn.x - ax) * dx + (zn.y + 1 - ay) * dy + (zn.z - az) * dz) / l2, 0, 1) : 0;
      const cx = ax + dx * t - zn.x;
      const cy = ay + dy * t - (zn.y + 1);
      const cz = az + dz * t - zn.z;
      if (cx * cx + cy * cy + cz * cz < zn.r * zn.r) return true;
    }
    return false;
  }

  private detonate(s: Shell): void {
    if (s.dead) return;
    s.dead = true;
    const b = s.def.blast;
    const k = s.def.throwKind;
    if (k === 'smoke') {
      this.zones.push({ kind: 'smoke', x: s.x, y: s.y, z: s.z, r: b?.r ?? 7, life: 16, player: s.player, tick: 0 });
      this.game.audio.play('swish', { x: s.x, y: s.y, z: s.z, ref: 6, rate: 0.5 });
      return;
    }
    if (!b) return;
    this.explode(s.x, s.y + 0.1, s.z, b.r, b.dmg, s.player, { fire: b.fire, stun: b.stun });
  }

  // ------------------------------------------------------------------ simulation

  update(dt: number): void {
    const g = this.game;
    const world = g.world;
    const fx = g.fx;
    const p = g.player;
    const cam = g.engine.camera.position;
    this.whizCool -= dt;
    fx.beginTracers();
    const hit = this.hit;

    for (let i = 0; i < MAX_BULLETS; i++) {
      const b = this.bullets[i];
      if (!b.on) continue;
      let remaining = b.speed * dt;
      let guard = 0;
      while (remaining > 0 && b.on && guard++ < 4) {
        const hw = world.raycast(b.x, b.y, b.z, b.dx, b.dy, b.dz, remaining, F_BULLET, hit);
        const limit = hw ? hit.t : remaining;
        let target: Enemy | null = null;
        let tHit = limit;
        let part: 'head' | 'torso' | 'legs' = 'torso';
        const ours = b.player || b.ally;
        const e = ours ? g.enemies.raycast(b.x, b.y, b.z, b.dx, b.dy, b.dz, limit) : null;
        if (e) {
          target = e.enemy;
          tHit = e.t;
          part = e.part;
        }
        let playerHit = false;
        if (!ours && p.alive) {
          const tp = rayCylinder(b.x, b.y, b.z, b.dx, b.dy, b.dz, p.pos.x, p.pos.y, p.pos.z, 0.33, p.height, tHit);
          if (tp >= 0) {
            playerHit = true;
            tHit = tp;
            target = null;
          }
        }
        // Rounds snapping past the player's head.
        if (!ours && !b.whizzed && !playerHit) {
          const t = clamp((cam.x - b.x) * b.dx + (cam.y - b.y) * b.dy + (cam.z - b.z) * b.dz, 0, tHit);
          const d = Math.hypot(b.x + b.dx * t - cam.x, b.y + b.dy * t - cam.y, b.z + b.dz * t - cam.z);
          if (d < 2.2 && t > 0 && t < tHit) {
            b.whizzed = true;
            if (this.whizCool <= 0) {
              this.whizCool = 0.07;
              g.audio.play(b.speed > 360 ? 'crack' : 'whiz', { x: b.x + b.dx * t, y: b.y + b.dy * t, z: b.z + b.dz * t, ref: 2.5, vol: 0.9 });
              if (b.speed > 360) g.audio.play('whiz', { x: b.x + b.dx * t, y: b.y + b.dy * t, z: b.z + b.dz * t, ref: 2, vol: 0.5, delay: 0.02 });
              g.onNearMiss();
            }
          }
        }
        const dmg = b.def.damage * Math.pow(b.speed / b.def.mv, 1.22) * b.scale;
        const hx = b.x + b.dx * tHit;
        const hy = b.y + b.dy * tHit;
        const hz = b.z + b.dz * tHit;
        if (playerHit) {
          p.damage(dmg * 0.6, b.owner ? b.owner.pos.x : b.x - b.dx, b.owner ? b.owner.pos.z : b.z - b.dz, 'bullet');
          b.on = false;
        } else if (target) {
          const mul = part === 'head' ? 4 : part === 'legs' ? 0.7 : 1;
          const killed = target.damage(dmg * mul, part, b.x, b.z, b.player, false, b.def.pen);
          fx.blood(hx, hy, hz, b.dx, b.dy * 0.3, b.dz);
          g.audio.playLimited('hitFlesh', 0.04, { x: hx, y: hy, z: hz, ref: 4, vol: 0.9 });
          if (b.player) {
            g.stats.hits++;
            if (killed && part === 'head') g.stats.headshots++;
            g.events.emit('hit', { kill: killed, head: part === 'head', dist: b.dist + tHit });
          } else if (b.ally && b.owner) {
            // Shot by the squad: the man who is hit turns on whoever shot him.
            if (killed) b.owner.onKill();
            else target.hear(b.owner.pos.x, b.owner.pos.y, b.owner.pos.z, true);
          }
          if (b.def.blast) this.explode(hx, hy, hz, b.def.blast.r, b.def.blast.dmg, b.player);
          b.on = false;
        } else if (hw) {
          fx.impact(hx, hy, hz, hit.nx, hit.ny, hit.nz, hit.surf, b.def.energy > 5000 ? 1.8 : 1);
          g.audio.impact(hit.surf, hx, hy, hz);
          if (ours) g.enemies.hearNoise(hx, hy, hz, 9, false);
          const prop = hit.solid?.tag as PropDef | undefined;
          if (prop && prop.kind) g.level?.damageProp(prop, dmg);
          if (b.def.blast) {
            this.explode(hx, hy, hz, b.def.blast.r, b.def.blast.dmg, b.player);
            b.on = false;
          } else if (hit.solid && b.pen > 0) {
            // Penetration: thin or soft cover does not stop a rifle round.
            const thick = Math.max(0.01, hit.exit - hit.t);
            const resist = thick * hit.solid.pen;
            if (resist < b.pen) {
              const keep = 1 - resist / b.pen;
              b.x += b.dx * (hit.exit + 0.02);
              b.y += b.dy * (hit.exit + 0.02);
              b.z += b.dz * (hit.exit + 0.02);
              b.dist += hit.exit;
              b.speed *= 0.55 + 0.4 * keep;
              b.pen *= keep;
              remaining -= hit.exit + 0.02;
              fx.impact(b.x, b.y, b.z, b.dx, b.dy, b.dz, hit.surf, 0.8, false);
              continue;
            }
            b.on = false;
          } else b.on = false;
        } else {
          b.x += b.dx * remaining;
          b.y += b.dy * remaining;
          b.z += b.dz * remaining;
          b.dist += remaining;
          remaining = 0;
        }
      }
      if (!b.on) continue;
      // Drag and drop.
      b.speed /= 1 + b.def.drag * b.speed * dt;
      let vx = b.dx * b.speed;
      let vy = b.dy * b.speed - G * dt;
      let vz = b.dz * b.speed;
      const sp = Math.hypot(vx, vy, vz);
      b.dx = vx / sp;
      b.dy = vy / sp;
      b.dz = vz / sp;
      b.speed = sp;
      b.life -= dt;
      if (b.life <= 0 || b.y < -60 || b.speed < 40) b.on = false;
      else if (b.dist > 1.5) {
        const len = Math.min(b.dist, clamp(b.speed * 0.014, 2.5, 13));
        if (b.bright) fx.addTracer(b.x, b.y, b.z, b.dx, b.dy, b.dz, len, b.player ? 0.022 : 0.03, b.player ? 2.6 : 2.2, b.player ? 1.7 : 1.2, b.player ? 0.6 : 0.5);
        else fx.addTracer(b.x, b.y, b.z, b.dx, b.dy, b.dz, len * 0.7, 0.012, 0.7, 0.6, 0.4);
      }
      vx = vy = vz = 0;
    }
    fx.endTracers();

    this.updateShells(dt);
    this.updateZones(dt);
  }

  private updateShells(dt: number): void {
    const g = this.game;
    const world = g.world;
    const fx = g.fx;
    const hit = this.hit2;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      s.life -= dt;
      if (!s.rest && !s.dead) {
        if (s.kind === 'rocket') {
          const boost = boostSpeed(s.def);
          let sp = Math.hypot(s.vx, s.vy, s.vz);
          if (boost > sp) {
            const ns = Math.min(boost, sp + 520 * dt);
            s.vx *= ns / sp;
            s.vy *= ns / sp;
            s.vz *= ns / sp;
            sp = ns;
          }
          if (s.guided && s.age > 0.25) {
            const tx = s.tx - s.x;
            const ty = s.ty - s.y;
            const tz = s.tz - s.z;
            const tl = Math.hypot(tx, ty, tz) || 1;
            const k = Math.min(1, 3.2 * dt);
            s.vx += ((tx / tl) * sp - s.vx) * k;
            s.vy += ((ty / tl) * sp - s.vy) * k;
            s.vz += ((tz / tl) * sp - s.vz) * k;
          } else s.vy -= 1.6 * dt;
          s.emit += dt;
          if (s.emit > 0.016) {
            s.emit = 0;
            fx.trail(s.x, s.y, s.z, 0.5);
          }
        } else if (s.kind === 'flame') {
          s.vx *= 1 - 1.5 * dt;
          s.vz *= 1 - 1.5 * dt;
          s.vy = s.vy * (1 - 1.5 * dt) + 1.2 * dt;
        } else {
          s.vy -= G * dt;
          if (s.kind === 'flare') fx.fire(s.x, s.y, s.z, 0.5);
        }
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        const step = sp * dt;
        if (sp > 1e-4) {
          const dx = s.vx / sp;
          const dy = s.vy / sp;
          const dz = s.vz / sp;
          const hw = world.raycast(s.x, s.y, s.z, dx, dy, dz, step + 0.05, F_BULLET, hit);
          const limit = hw ? hit.t : step;
          const e = s.kind === 'thrown' || !s.player ? null : g.enemies.raycast(s.x, s.y, s.z, dx, dy, dz, limit, null, false);
          let pt = -1;
          if (!s.player && s.kind !== 'thrown' && g.player.alive) pt = rayCylinder(s.x, s.y, s.z, dx, dy, dz, g.player.pos.x, g.player.pos.y, g.player.pos.z, 0.33, g.player.height, limit);
          if (e || pt >= 0) {
            const t = e ? e.t : pt;
            s.x += dx * t;
            s.y += dy * t;
            s.z += dz * t;
            if (s.kind === 'arrow') {
              if (e) {
                const killed = e.enemy.damage(s.def.damage * (e.part === 'head' ? 3 : 1), e.part, s.x - dx, s.z - dz, s.player);
                fx.blood(s.x, s.y, s.z, dx, 0, dz);
                if (s.player) g.events.emit('hit', { kill: killed, head: e.part === 'head', dist: 0 });
              } else g.player.damage(s.def.damage * 0.6, s.x - dx, s.z - dz, 'bullet');
              s.dead = true;
            } else if (s.kind === 'flame') {
              if (e) e.enemy.burn(s.def.damage * 2.2, s.player);
              else g.player.damage(3, s.x, s.z, 'fire');
              s.dead = true;
            } else this.detonate(s);
          } else if (hw) {
            s.x = hit.x + hit.nx * 0.03;
            s.y = hit.y + hit.ny * 0.03;
            s.z = hit.z + hit.nz * 0.03;
            if (s.kind === 'thrown') this.bounce(s, hit);
            else if (s.kind === 'arrow') {
              s.rest = true;
              s.life = Math.min(s.life, 25);
              g.audio.play('hitWood', { x: s.x, y: s.y, z: s.z, ref: 3 });
            } else if (s.kind === 'flame') {
              s.dead = true;
              if (Math.random() < 0.25) fx.fire(s.x, s.y, s.z, 0.7);
            } else if (s.kind === 'grenade' && s.age < 0.06) {
              // Not yet armed: point-blank shots skip off instead of killing the shooter.
              this.bounce(s, hit);
            } else this.detonate(s);
          } else {
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.z += s.vz * dt;
          }
        }
        if (s.kind === 'flame') {
          // Flames also catch anyone the stream passes close to.
          g.enemies.forEachNear(s.x, s.y - 0.9, s.z, 1.5, (en) => en.burn(s.def.damage * dt * 10, s.player));
          if (!s.player && Math.hypot(s.x - g.player.pos.x, s.z - g.player.pos.z) < 1.2 && Math.abs(s.y - g.player.pos.y - 0.9) < 1.2) g.player.damage(18 * dt, s.x, s.z, 'fire');
        }
      }
      // Fuses and proximity triggers
      if (s.kind === 'thrown' && !s.dead) {
        const k = s.def.throwKind;
        if (k === 'frag' || k === 'stun' || k === 'smoke' || (k === 'fire' && s.def.fuse > 0)) {
          s.fuse -= dt;
          if (s.fuse <= 0) this.detonate(s);
        } else if (k === 'mine' && s.rest && s.age > 1.2) {
          let trip = false;
          const fxn = -Math.sin(s.yaw);
          const fzn = -Math.cos(s.yaw);
          if (s.player) {
            g.enemies.forEachNear(s.x, s.y, s.z, 4.5, (en) => {
              if ((en.pos.x - s.x) * fxn + (en.pos.z - s.z) * fzn > 0.3) trip = true;
            });
          } else if (Math.hypot(g.player.pos.x - s.x, g.player.pos.z - s.z) < 3) trip = true;
          if (trip) {
            // Directional blast: the charge goes off a couple of metres in front of the mine.
            s.x += fxn * 2.5;
            s.z += fzn * 2.5;
            this.detonate(s);
          }
        }
      }
      if (s.mesh) {
        s.mesh.position.set(s.x, s.y, s.z);
        if (!s.rest && (s.kind === 'rocket' || s.kind === 'arrow')) s.mesh.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
        else if (!s.rest && s.kind === 'thrown') s.mesh.rotation.x += dt * 9;
        else if (s.rest && s.def.throwKind === 'mine') s.mesh.rotation.set(Math.PI / 2, s.yaw, 0);
      }
      if (s.dead || s.life <= 0) {
        if (!s.dead && s.kind === 'thrown' && (s.def.throwKind === 'remote' || s.def.throwKind === 'mine')) {
          s.life = 60; // placed charges wait indefinitely
          continue;
        }
        if (s.mesh) this.group.remove(s.mesh);
        this.shells.splice(i, 1);
      }
    }
  }

  private bounce(s: Shell, hit: RayHit): void {
    const k = s.def.throwKind;
    if (k === 'impact' || (k === 'fire' && s.def.fuse === 0)) {
      this.detonate(s);
      return;
    }
    const vn = s.vx * hit.nx + s.vy * hit.ny + s.vz * hit.nz;
    const sticky = k === 'remote' || k === 'mine';
    if (sticky) {
      s.rest = true;
      s.vx = s.vy = s.vz = 0;
      this.game.audio.play('plant', { x: s.x, y: s.y, z: s.z, ref: 3, vol: 0.6 });
      return;
    }
    // Reflect with energy loss; roll to a stop on the ground.
    s.vx = (s.vx - 2 * vn * hit.nx) * 0.42;
    s.vy = (s.vy - 2 * vn * hit.ny) * 0.36;
    s.vz = (s.vz - 2 * vn * hit.nz) * 0.42;
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (sp > 1.2) this.game.audio.playLimited('grenadeBounce', 0.08, { x: s.x, y: s.y, z: s.z, ref: 4, vol: clamp(sp / 8, 0.2, 1) });
    if (sp < 0.8 && hit.ny > 0.6) {
      s.rest = true;
      s.vx = s.vy = s.vz = 0;
    }
    if (!s.player) this.game.onEnemyGrenade(s.x, s.y, s.z);
  }

  private updateZones(dt: number): void {
    const g = this.game;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      z.tick -= dt;
      if (z.kind === 'smoke') {
        if (z.tick <= 0 && z.life > 2) {
          z.tick = 0.09;
          g.fx.smokeCloud(z.x, z.y, z.z, z.r);
        }
      } else {
        if (Math.random() < dt * 30) g.fx.fire(z.x + rand(-z.r, z.r) * 0.7, z.y + 0.05, z.z + rand(-z.r, z.r) * 0.7, rand(0.7, 1.3));
        if (z.tick <= 0) {
          z.tick = 0.25;
          g.enemies.forEachNear(z.x, z.y, z.z, z.r, (e) => e.burn(11, z.player));
          const p = g.player;
          if (Math.hypot(p.pos.x - z.x, p.pos.z - z.z) < z.r && Math.abs(p.pos.y - z.y) < 2) p.damage(7, z.x, z.z, 'fire');
        }
      }
      if (z.life <= 0) this.zones.splice(i, 1);
    }
  }

  /** Enemy grenades still in flight / on the ground near a point (for the HUD warning). */
  nearestThreat(x: number, y: number, z: number, out: { x: number; z: number; d: number }): boolean {
    let best = 14;
    let found = false;
    for (const s of this.shells) {
      if (s.kind !== 'thrown' || s.player || s.dead || s.def.throwKind !== 'frag') continue;
      const d = Math.hypot(s.x - x, s.y - y, s.z - z);
      if (d < best) {
        best = d;
        out.x = s.x;
        out.z = s.z;
        out.d = d;
        found = true;
      }
    }
    return found;
  }

  get sightMask(): number {
    return F_SIGHT;
  }
}

/** Ray vs. upright cylinder (feet at y0). Returns distance or -1. */
export function rayCylinder(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, y0: number, cz: number, r: number, h: number, maxT: number): number {
  const rx = ox - cx;
  const rz = oz - cz;
  const a = dx * dx + dz * dz;
  const b = rx * dx + rz * dz;
  const c = rx * rx + rz * rz - r * r;
  let t0 = 0;
  let t1 = maxT;
  if (a < 1e-9) {
    if (c > 0) return -1;
  } else {
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    t0 = Math.max(t0, (-b - sq) / a);
    t1 = Math.min(t1, (-b + sq) / a);
  }
  // Clip against the top and bottom caps.
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y0 + h) return -1;
  } else {
    let ta = (y0 - oy) / dy;
    let tb = (y0 + h - oy) / dy;
    if (ta > tb) {
      const tt = ta;
      ta = tb;
      tb = tt;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t0 <= t1 && t0 <= maxT ? t0 : -1;
}
