// Enemy soldier: a smoothly skinned human figure built in code (one draw call each, see body.ts),
// whose hands hold the weapon by inverse kinematics, plus the AI that drives it: perception, cover
// use, flanking, suppression, grenades.

import * as THREE from 'three';
import { angleDiff, clamp, damp, dampAngle, DEG, gauss, lerp, rand, randInt } from '../../core/math';
import { DIFFICULTY, store } from '../../core/settings';
import { F_SIGHT } from '../../world/collision';
import type { CoverPoint } from '../../world/navgrid';
import { rayCylinder } from '../combat';
import type { Game } from '../game';
import { getWeapon } from '../weapons/data';
import { buildWeaponModel, disposeWeaponModel } from '../weapons/model';
import type { WeaponDef } from '../weapons/types';
import { buildSoldierBody, disposeSoldierFabric, soldierFabric } from './body';
import { ARCHETYPES, type Archetype } from './types';

const B_HIPS = 0, B_SPINE = 1, B_HEAD = 2, B_ARM_LU = 3, B_ARM_LL = 4, B_ARM_RU = 5, B_ARM_RL = 6, B_LEG_LU = 7, B_LEG_LL = 8, B_LEG_RU = 9, B_LEG_RL = 10, B_WEAPON = 11;
const REST: Array<[number, number, number, number]> = [
  // x, y, z, parent
  [0, 0.97, 0, -1],
  [0, 1.08, 0, B_HIPS],
  [0, 1.58, 0, B_SPINE],
  [-0.245, 1.51, 0, B_SPINE],
  [-0.245, 1.21, 0, B_ARM_LU],
  [0.245, 1.51, 0, B_SPINE],
  [0.245, 1.21, 0, B_ARM_RU],
  [-0.1, 0.96, 0, B_HIPS],
  [-0.1, 0.52, 0, B_LEG_LU],
  [0.1, 0.96, 0, B_HIPS],
  [0.1, 0.52, 0, B_LEG_RU],
  [0.15, 1.36, -0.24, B_SPINE],
];

const geoCache = new Map<string, THREE.BufferGeometry>();
/** Where the support hand goes on each weapon, in the weapon's own space. */
const supportGrip = new Map<string, THREE.Vector3>();
let matPBR: THREE.MeshStandardMaterial | null = null;
let matLow: THREE.MeshLambertMaterial | null = null;

function soldierGeometry(arch: Archetype, weapon: WeaponDef): THREE.BufferGeometry {
  const key = `${arch.id}|${weapon.id}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const d = buildSoldierBody(arch.look, {
    hips: B_HIPS, spine: B_SPINE, head: B_HEAD, armLU: B_ARM_LU, armLL: B_ARM_LL, armRU: B_ARM_RU, armRL: B_ARM_RL,
    legLU: B_LEG_LU, legLL: B_LEG_LL, legRU: B_LEG_RU, legRL: B_LEG_RL,
  });
  // The weapon is merged into the same mesh and rides its own bone.
  const model = buildWeaponModel(weapon, false);
  supportGrip.set(weapon.id, model.gripL.clone());
  const wp = REST[B_WEAPON];
  model.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const c = (o.material as THREE.MeshStandardMaterial).color;
    const src = o.geometry as THREE.BufferGeometry;
    const g = src.index ? src.toNonIndexed() : src.clone();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      d.index.push(d.pos.length / 3);
      d.pos.push(p.getX(i) + wp[0], p.getY(i) + wp[1], p.getZ(i) + wp[2]);
      d.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      d.col.push(c.r, c.g, c.b);
      d.uv.push(0.5, 0.5);
      d.skinIndex.push(B_WEAPON, 0, 0, 0);
      d.skinWeight.push(1, 0, 0, 0);
    }
    g.dispose();
  });
  disposeWeaponModel(model);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(d.skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(d.skinWeight, 4));
  geo.setIndex(d.index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.4);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-2.2, -0.5, -2.2), new THREE.Vector3(2.2, 2.4, 2.2));
  geoCache.set(key, geo);
  return geo;
}

export function disposeSoldierAssets(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  disposeSoldierFabric();
  if (matPBR) matPBR.map = null;
  if (matLow) matLow.map = null;
  matPBR?.dispose();
  matLow?.dispose();
  matPBR = null;
  matLow = null;
}

// ---- two-bone reach, used to put both hands on the weapon
const DOWN = new THREE.Vector3(0, -1, 0);
const UPPER = 0.3;
const FORE = 0.335;
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _hand = new THREE.Vector3();
const _wq = new THREE.Quaternion();
/** The firing hand's place on any weapon: just behind and below its origin. */
const FIRE_GRIP = new THREE.Vector3(0.004, -0.07, 0.035);

/**
 * Bends an arm so its hand lands on `target`. Everything is in the space of the spine bone, which
 * both the shoulders and the weapon hang from. `side` is -1 for the left arm, 1 for the right.
 */
function reach(upper: THREE.Bone, fore: THREE.Bone, shoulder: THREE.Vector3, target: THREE.Vector3, side: number): void {
  _dir.subVectors(target, shoulder);
  const dist = clamp(_dir.length(), Math.abs(UPPER - FORE) + 0.02, UPPER + FORE - 0.008);
  _dir.normalize();
  // The elbow hangs down and a little out, as it does when a rifle is shouldered.
  _pole.set(side * 0.22, -1, 0.38);
  _pole.addScaledVector(_dir, -_pole.dot(_dir)).normalize();
  const along = (UPPER * UPPER - FORE * FORE + dist * dist) / (2 * dist);
  const out = Math.sqrt(Math.max(0, UPPER * UPPER - along * along));
  _elbow.copy(_dir).multiplyScalar(along).addScaledVector(_pole, out);
  _q.setFromUnitVectors(DOWN, _v.copy(_elbow).normalize());
  upper.quaternion.copy(_q);
  // Forearm direction, expressed in the upper arm's own frame.
  _v.copy(_dir).multiplyScalar(dist).sub(_elbow).normalize().applyQuaternion(_qi.copy(_q).invert());
  fore.quaternion.setFromUnitVectors(DOWN, _v);
}
const SHOULDER_L = new THREE.Vector3(REST[B_ARM_LU][0] - REST[B_SPINE][0], REST[B_ARM_LU][1] - REST[B_SPINE][1], 0);
const SHOULDER_R = new THREE.Vector3(REST[B_ARM_RU][0] - REST[B_SPINE][0], REST[B_ARM_RU][1] - REST[B_SPINE][1], 0);

export type BodyPart = 'head' | 'torso' | 'legs';
type State = 'idle' | 'patrol' | 'investigate' | 'combat' | 'search';
type Action = 'hold' | 'cover' | 'advance' | 'flank' | 'peek';

let nextId = 1;
const v = new THREE.Vector3();

export class Enemy {
  readonly id = nextId++;
  /** Playback rate of this soldier's voice, so a squad does not all sound like one man. */
  readonly voice = 0.92 + ((this.id * 0.6180339887) % 1) * 0.16;
  /** Which of the two recorded voice actors speaks for this soldier. */
  readonly actor = (this.id * 0.7548776662) % 1 < 0.36 ? 'vo2' : 'vo';
  private lastPain = -9;
  readonly arch: Archetype;
  readonly weapon: WeaponDef;
  readonly mesh: THREE.SkinnedMesh;
  private bones: THREE.Bone[] = [];
  readonly pos = new THREE.Vector3();
  yaw = 0;
  hp: number;
  alive = true;
  /** True once the death animation has finished: the manager stops updating it. */
  corpse = false;
  group: string;
  tag: string | undefined;
  hold: boolean;
  crouched = false;
  state: State = 'idle';
  canSee = false;
  stunT = 0;

  private crouchT = 0;
  private fixedY: number | null = null;
  private alert = 0;
  private lastSeen = new THREE.Vector3();
  private sinceSeen = 99;
  private path: number[] = [];
  private pathI = 0;
  private goal: { x: number; z: number } | null = null;
  private needPath = false;
  private speedNow = 0;
  private phase = Math.random() * 6;
  private patrol: number[] | undefined;
  private patrolI = 0;
  private waitT = 0;
  private cover: CoverPoint | null = null;
  private action: Action = 'hold';
  private actionT = 0;
  private ammo: number;
  private reloadT = 0;
  private burstLeft = 0;
  private burstCool = 0.4;
  private shotT = 0;
  private settle = 0;
  private aimT = 0;
  private aimPitch = 0;
  private aimBlend = 0;
  private suppress = 0;
  private flinch = 0;
  private grenades: number;
  private grenadeCool = rand(5, 10);
  private meleeCool = 0;
  private reactT = 0;
  private thinkT = Math.random() * 0.3;
  private searchT = 0;
  private homeX = 0;
  private homeZ = 0;
  private homeYaw = 0;
  private lookT = Math.random() * 10;
  private deathT = 0;
  private deathKind = 0;
  private deathVX = 0;
  private deathVY = 0;
  private deathVZ = 0;
  private burnT = 0;
  private stuck = 0;
  private peekBack: { x: number; z: number } | null = null;

  constructor(private readonly game: Game, type: string, x: number, y: number, z: number, yaw: number, o: { group: string; patrol?: number[]; hold?: boolean; crouch?: boolean; weapon?: string; id?: string; fixedY?: boolean }) {
    this.arch = ARCHETYPES[type] ?? ARCHETYPES.rifleman;
    this.weapon = getWeapon(o.weapon ?? this.arch.weapon);
    this.hp = this.arch.hp;
    this.ammo = this.weapon.mag;
    this.grenades = this.arch.grenades;
    this.group = o.group;
    this.tag = o.id;
    this.hold = o.hold ?? false;
    this.crouched = o.crouch ?? false;
    this.patrol = o.patrol && o.patrol.length >= 4 ? o.patrol : undefined;
    this.pos.set(x, y, z);
    if (o.fixedY) this.fixedY = y;
    this.yaw = this.homeYaw = yaw;
    this.homeX = x;
    this.homeZ = z;
    this.state = this.patrol ? 'patrol' : 'idle';

    const pbr = game.engine.tier.pbr;
    if (pbr) matPBR ??= new THREE.MeshStandardMaterial({ vertexColors: true, map: soldierFabric(), roughness: 0.9, metalness: 0.02 });
    else matLow ??= new THREE.MeshLambertMaterial({ vertexColors: true, map: soldierFabric() });
    this.mesh = new THREE.SkinnedMesh(soldierGeometry(this.arch, this.weapon), (pbr ? matPBR : matLow) as THREE.Material);
    for (let i = 0; i < REST.length; i++) {
      const b = new THREE.Bone();
      const [bx, by, bz, parent] = REST[i];
      if (parent < 0) {
        b.position.set(bx, by, bz);
        this.mesh.add(b);
      } else {
        const pr = REST[parent];
        b.position.set(bx - pr[0], by - pr[1], bz - pr[2]);
        this.bones[parent].add(b);
      }
      b.rotation.order = 'YXZ';
      this.bones.push(b);
    }
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = game.engine.shadowsOn;
    this.mesh.receiveShadow = false;
    this.mesh.rotation.order = 'YXZ';
    this.mesh.scale.setScalar(this.arch.scale);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = yaw;
    this.animate(0, true);
  }

  // ------------------------------------------------------------------ queries

  get eyeY(): number {
    return this.pos.y + lerp(1.6, 1.05, this.crouchT) * this.arch.scale;
  }

  /** Ray test against head / torso / legs. Returns the distance (or -1) and sets `outPart`. */
  hitTest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: { part: BodyPart }): number {
    const s = this.arch.scale;
    const c = this.crouchT;
    const headY = this.pos.y + lerp(1.69, 1.14, c) * s;
    // Head: sphere
    const hx = this.pos.x - ox;
    const hy = headY - oy;
    const hz = this.pos.z - oz;
    const tca = hx * dx + hy * dy + hz * dz;
    let best = -1;
    const r = 0.155 * s;
    if (tca > 0) {
      const d2 = hx * hx + hy * hy + hz * hz - tca * tca;
      if (d2 < r * r) {
        const t = tca - Math.sqrt(r * r - d2);
        if (t >= 0 && t <= maxT) {
          best = t;
          out.part = 'head';
        }
      }
    }
    const torso0 = this.pos.y + lerp(0.93, 0.5, c) * s;
    const torsoH = lerp(0.66, 0.56, c) * s;
    const tt = rayCylinder(ox, oy, oz, dx, dy, dz, this.pos.x, torso0, this.pos.z, 0.25 * s, torsoH, best >= 0 ? best : maxT);
    if (tt >= 0) {
      best = tt;
      out.part = 'torso';
    }
    const tl = rayCylinder(ox, oy, oz, dx, dy, dz, this.pos.x, this.pos.y, this.pos.z, 0.21 * s, lerp(0.93, 0.5, c) * s, best >= 0 ? best : maxT);
    if (tl >= 0) {
      best = tl;
      out.part = 'legs';
    }
    return best;
  }

  // ------------------------------------------------------------------ taking damage

  damage(amount: number, part: BodyPart, fromX: number, fromZ: number, byPlayer: boolean, blast = false, pen = 0.08): boolean {
    if (!this.alive) return false;
    const a = this.arch;
    if (!blast && part === 'torso' && a.armor > 0) amount *= 1 - a.armor * clamp(1 - pen / 0.22, 0.25, 1);
    if (!blast && part === 'head' && a.look.helmet && pen < 0.05) amount *= 0.6;
    this.hp -= amount;
    this.flinch = Math.min(1, this.flinch + amount / 60);
    this.settle *= 0.4;
    if (this.hp <= 0) {
      this.die(fromX, fromZ, blast);
      return true;
    }
    // Hit but alive: he cries out, and a badly hurt man calls for help.
    const now = this.game.engine.time;
    if (now - this.lastPain > 0.9 && Math.random() < 0.75) {
      this.lastPain = now;
      const audio = this.game.audio;
      audio.play(audio.has('pain') ? 'pain' : 'grunt', { x: this.pos.x, y: this.pos.y + 1.5, z: this.pos.z, ref: 10, vol: 0.9, rate: this.voice });
      if (this.hp < a.hp * 0.4 && Math.random() < 0.35) this.game.enemies.shout(this, true, ['medic', 'cover_me']);
    }
    if (byPlayer) {
      const p = this.game.player.pos;
      this.enterCombat(p.x, p.y, p.z, false, 0.15);
      this.game.enemies.alertGroup(this, p.x, p.y, p.z, 30);
    }
    return false;
  }

  burn(dmg: number, byPlayer: boolean): void {
    if (!this.alive) return;
    this.burnT = 1.5;
    this.suppress = 1;
    const killed = this.damage(dmg, 'legs', this.pos.x, this.pos.z, byPlayer, true);
    if (killed && byPlayer) this.game.events.emit('hit', { kill: true, head: false, dist: 0 });
  }

  stun(seconds: number): void {
    if (!this.alive) return;
    this.stunT = Math.max(this.stunT, seconds);
    this.burstLeft = 0;
    this.settle = 0;
  }

  /** A round passed close by. */
  suppressBy(amount: number): void {
    const before = this.suppress;
    this.suppress = Math.min(1.4, this.suppress + amount);
    if (before < 0.8 && this.suppress >= 0.8 && this.alive && Math.random() < 0.3) this.game.enemies.shout(this, false, ['get_down', 'look_out', 'suppressing_fire']);
    if (this.state !== 'combat' && this.alive) {
      const p = this.game.player.pos;
      this.enterCombat(p.x, p.y, p.z, false, rand(0.3, 0.7));
    }
  }

  private die(fromX: number, fromZ: number, blast: boolean): void {
    this.alive = false;
    this.hp = 0;
    this.releaseCover();
    const g = this.game;
    // Fall away from the shot.
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const dot = (dx / d) * fx + (dz / d) * fz;
    this.deathKind = dot > 0.35 ? 1 : dot < -0.35 ? 0 : Math.random() < 0.5 ? 2 : 3;
    if (blast) {
      this.deathVX = (dx / d) * rand(3, 6);
      this.deathVZ = (dz / d) * rand(3, 6);
      this.deathVY = rand(3, 5);
    }
    g.audio.play(g.audio.has('death') && Math.random() < 0.8 ? 'death' : 'grunt', { x: this.pos.x, y: this.pos.y + 1.4, z: this.pos.z, ref: 11, vol: 0.9, rate: this.voice });
    g.audio.play('bodyfall', { x: this.pos.x, y: this.pos.y, z: this.pos.z, ref: 5, delay: 0.35 });
    g.onEnemyKilled(this);
  }

  // ------------------------------------------------------------------ awareness

  enterCombat(x: number, y: number, z: number, saw: boolean, react = 0.4): void {
    if (!this.alive) return;
    this.lastSeen.set(x, y, z);
    if (this.state !== 'combat') {
      this.state = 'combat';
      this.reactT = react * DIFFICULTY[store.settings.difficulty].react;
      this.actionT = rand(0, 0.6);
      this.sinceSeen = saw ? 0 : 1.5;
      this.burstCool = rand(0.1, 0.5);
      this.game.onCombatStart(this);
    } else if (saw) this.sinceSeen = 0;
  }

  /** Noise heard nearby. Gunfire starts a fight; softer sounds are investigated. */
  hear(x: number, y: number, z: number, gunshot: boolean): void {
    if (!this.alive || this.stunT > 0) return;
    if (this.state === 'combat') {
      if (!this.canSee && gunshot && this.sinceSeen > 1.5) this.lastSeen.set(x, y, z);
      return;
    }
    if (gunshot) this.enterCombat(x, y, z, false, rand(0.5, 1.1));
    else if (this.state !== 'investigate') {
      this.state = 'investigate';
      this.alert = Math.max(this.alert, 0.45);
      if (!this.hold) this.goTo(x, z);
      this.waitT = rand(3, 5);
    }
  }

  private perceive(tick: number): void {
    const g = this.game;
    const p = g.player;
    const ex = this.pos.x;
    const ey = this.eyeY;
    const ez = this.pos.z;
    const dx = p.pos.x - ex;
    const dz = p.pos.z - ez;
    const d = Math.hypot(dx, dz);
    let range = 62 * this.arch.sight * g.visibility;
    if (p.crouched) range *= 0.62;
    if (p.speed < 0.5) range *= 0.85;
    if (p.flashlightOn) range *= 1.5;
    if (this.state === 'combat') range = Math.max(range, 38 * this.arch.sight);
    let see = false;
    if (p.alive && !p.noclip && d < range && this.stunT <= 0) {
      const dot = d > 0.01 ? (-Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz) / d : 1;
      if (dot > (this.state === 'combat' ? -0.25 : 0.3) || d < 3.2) {
        const w = g.world;
        see = w.los(ex, ey, ez, p.pos.x, p.pos.y + p.eyeHeight * 0.93, p.pos.z, F_SIGHT) || w.los(ex, ey, ez, p.pos.x, p.pos.y + p.eyeHeight * 0.45, p.pos.z, F_SIGHT);
        if (see && g.combat.smokeBlocks(ex, ey, ez, p.pos.x, p.pos.y + 1, p.pos.z)) see = false;
      }
    }
    this.canSee = see;
    if (this.state === 'combat') {
      if (see) {
        this.lastSeen.copy(p.pos);
        this.sinceSeen = 0;
      } else this.sinceSeen += tick;
      return;
    }
    if (see) {
      // Spotting takes time: about half a second up close, three seconds at the edge of sight.
      const rate = clamp(2.5 - (2.4 * d) / range, 0.25, 5) / DIFFICULTY[store.settings.difficulty].react;
      this.alert += rate * tick;
      if (this.alert >= 1) {
        this.enterCombat(p.pos.x, p.pos.y, p.pos.z, true, rand(0.25, 0.5));
        g.enemies.alertGroup(this, p.pos.x, p.pos.y, p.pos.z, 40);
        g.enemies.shout(this);
      } else if (this.alert > 0.35 && this.state !== 'investigate') {
        this.state = 'investigate';
        this.goal = null;
        this.path.length = 0;
        this.lastSeen.copy(p.pos);
        this.waitT = rand(2.5, 4);
      }
      if (this.state === 'investigate') this.lastSeen.copy(p.pos);
    } else this.alert = Math.max(0, this.alert - tick * 0.22);
  }

  // ------------------------------------------------------------------ decisions

  private goTo(x: number, z: number): void {
    this.goal = { x, z };
    this.needPath = true;
    this.stuck = 0;
  }

  private releaseCover(): void {
    if (this.cover && this.cover.taken === this.id) this.cover.taken = 0;
    this.cover = null;
    this.peekBack = null;
  }

  private findCover(px: number, pz: number): CoverPoint | null {
    const nav = this.game.nav;
    const [rMin, rPref, rMax] = this.arch.range;
    let best: CoverPoint | null = null;
    let bestScore = Infinity;
    const list = nav.cover;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.taken && c.taken !== this.id) continue;
      const ds = Math.abs(c.x - this.pos.x) + Math.abs(c.z - this.pos.z);
      if (ds > 26) continue;
      const tx = px - c.x;
      const tz = pz - c.z;
      const dp = Math.hypot(tx, tz);
      if (dp < Math.max(4, rMin) || dp > rMax) continue;
      // The object must be between this spot and the player.
      if ((tx * c.nx + tz * c.nz) / dp < 0.6) continue;
      const score = ds * 1.0 + Math.abs(dp - rPref) * 0.55 + (c.high ? 1.5 : 0) + Math.random() * 3;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  private chooseAction(d: number): void {
    const g = this.game;
    const a = this.arch;
    const [rMin, rPref, rMax] = a.range;
    const tx = this.lastSeen.x;
    const tz = this.lastSeen.z;
    this.releaseCover();
    if (!this.canSee && this.sinceSeen > 3 && Math.random() < 0.3 + a.aggression * 0.6) {
      this.action = 'advance';
      this.goTo(tx + rand(-3, 3), tz + rand(-3, 3));
      this.actionT = rand(3, 6);
      return;
    }
    const roll = Math.random();
    const push = a.aggression * 0.6 + (d > rMax ? 0.5 : 0) - (d < rMin ? 0.4 : 0);
    if (roll < push) {
      // Close to the preferred distance, slightly off the direct line.
      const ang = Math.atan2(this.pos.x - tx, this.pos.z - tz) + rand(-0.5, 0.5);
      const r = rPref * rand(0.6, 1.0);
      this.action = 'advance';
      this.goTo(tx + Math.sin(ang) * r, tz + Math.cos(ang) * r);
      this.actionT = rand(2.5, 5);
    } else if (roll < push + 0.18) {
      const ang = Math.atan2(this.pos.x - tx, this.pos.z - tz) + (Math.random() < 0.5 ? -1 : 1) * rand(0.8, 1.5);
      const r = rPref * rand(0.7, 1.1);
      this.action = 'flank';
      if (Math.random() < 0.35) this.game.enemies.shout(this, false, ['go_go_go', 'cover_me', 'watch_my_back']);
      this.goTo(tx + Math.sin(ang) * r, tz + Math.cos(ang) * r);
      this.actionT = rand(4, 7);
    } else {
      const c = this.findCover(tx, tz);
      if (c) {
        c.taken = this.id;
        this.cover = c;
        this.action = 'cover';
        this.goTo(c.x, c.z);
        this.actionT = rand(5, 10);
      } else {
        this.action = 'hold';
        if (Math.random() < 0.15) this.game.enemies.shout(this, false, ['hold', 'suppressing_fire']);
        this.goal = null;
        this.actionT = rand(1.5, 3.5);
      }
    }
    void g;
  }

  private think(tick: number): void {
    const g = this.game;
    this.perceive(tick);
    if (this.stunT > 0) return;
    const p = g.player;
    if (this.state === 'combat') {
      const d = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
      if (!this.canSee && this.sinceSeen > 15 && !this.hold) {
        this.state = 'search';
        this.releaseCover();
        this.goTo(this.lastSeen.x + rand(-4, 4), this.lastSeen.z + rand(-4, 4));
        this.searchT = rand(8, 12);
        g.onCombatEnd();
        return;
      }
      if (this.hold && !this.canSee && this.sinceSeen > 25) {
        this.state = 'idle';
        g.onCombatEnd();
        return;
      }
      this.actionT -= tick;
      const atCover = this.cover !== null && Math.hypot(this.cover.x - this.pos.x, this.cover.z - this.pos.z) < 0.7;
      if (!this.hold) {
        if (this.actionT <= 0 && this.reloadT <= 0) this.chooseAction(d);
        // Behind tall cover with no shot: lean out to one side, then come back.
        if (atCover && this.cover?.high && !this.canSee && this.sinceSeen > 1.2 && !this.goal && this.action === 'cover') {
          const c = this.cover;
          for (const s of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
            const sx = c.x - c.nz * s * 1.5;
            const sz = c.z + c.nx * s * 1.5;
            if (g.nav.walkable(sx, sz) && g.world.los(sx, this.pos.y + 1.5, sz, p.pos.x, p.pos.y + 1.2, p.pos.z, F_SIGHT)) {
              this.peekBack = { x: c.x, z: c.z };
              this.action = 'peek';
              this.goTo(sx, sz);
              this.actionT = rand(2.5, 4.5);
              break;
            }
          }
        } else if (this.action === 'peek' && this.actionT < 1 && this.peekBack && this.burstLeft <= 0) {
          this.goTo(this.peekBack.x, this.peekBack.z);
          this.action = 'cover';
          this.actionT = rand(2, 4);
        }
      }
      // Duck when in low cover and not shooting, or when rounds are cracking past.
      const firing = this.burstLeft > 0 || (this.burstCool < 0.25 && this.canSee);
      this.crouched = (atCover && !this.cover?.high && (!firing || this.reloadT > 0)) || this.suppress > 0.75 || (this.hold && (this.reloadT > 0 || this.suppress > 0.4));
      // Grenade to flush a player who is sitting behind cover.
      this.grenadeCool -= tick;
      if (this.grenades > 0 && this.grenadeCool <= 0 && !this.canSee && this.sinceSeen > 2 && this.sinceSeen < 9 && d > 8 && d < 30) this.throwGrenade(d);
      // Rifle butt at arm's length.
      this.meleeCool -= tick;
      const dp = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (this.canSee && dp < 1.7 && this.meleeCool <= 0 && Math.abs(p.pos.y - this.pos.y) < 1.5) {
        this.meleeCool = 1.3;
        this.flinch = 0.6;
        p.damage(24, this.pos.x, this.pos.z, 'melee');
        g.audio.play('swish', { x: this.pos.x, y: this.pos.y + 1.3, z: this.pos.z, ref: 3 });
      }
      return;
    }
    if (this.state === 'search') {
      this.searchT -= tick;
      if (!this.goal && this.searchT > 0 && Math.random() < 0.08) this.goTo(this.lastSeen.x + rand(-8, 8), this.lastSeen.z + rand(-8, 8));
      if (this.searchT <= 0) {
        this.state = this.patrol ? 'patrol' : 'idle';
        this.alert = 0;
        if (!this.patrol) this.goTo(this.homeX, this.homeZ);
      }
      return;
    }
    if (this.state === 'investigate') {
      if (!this.goal) {
        this.waitT -= tick;
        if (this.waitT <= 0 && this.alert < 0.3) {
          this.state = this.patrol ? 'patrol' : 'idle';
          if (!this.patrol && !this.hold) this.goTo(this.homeX, this.homeZ);
        }
      }
      return;
    }
    if (this.state === 'patrol' && this.patrol && !this.goal) {
      this.waitT -= tick;
      if (this.waitT <= 0) {
        this.patrolI = (this.patrolI + 2) % this.patrol.length;
        this.goTo(this.patrol[this.patrolI], this.patrol[this.patrolI + 1]);
        this.waitT = rand(1.5, 4);
      }
    }
  }

  private throwGrenade(d: number): void {
    const g = this.game;
    const dx = this.lastSeen.x - this.pos.x;
    const dz = this.lastSeen.z - this.pos.z;
    const dy = this.lastSeen.y - (this.pos.y + 1.5);
    const t = clamp(d / 11, 0.9, 2.3);
    // Only throw with a clear arc overhead.
    if (g.world.ceilingAt(this.pos.x, this.pos.z, 0.3, this.pos.y + 1.7) < this.pos.y + 4.5) {
      this.grenadeCool = 4;
      return;
    }
    this.grenades--;
    this.grenadeCool = rand(10, 18);
    const ox = this.pos.x - Math.sin(this.yaw) * 0.4;
    const oz = this.pos.z - Math.cos(this.yaw) * 0.4;
    g.combat.throwItem(getWeapon('rgd5'), ox, this.pos.y + 1.55, oz, dx / t + rand(-0.6, 0.6), (dy + 0.5 * 9.81 * t * t) / t, dz / t + rand(-0.6, 0.6), false, this);
    g.enemies.shout(this, true, ['fire_in_the_hole']);
    this.flinch = 0.5;
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number): void {
    const g = this.game;
    if (!this.alive) {
      this.updateDeath(dt);
      return;
    }
    if (this.stunT > 0) this.stunT -= dt;
    this.suppress = Math.max(0, this.suppress - dt * 0.45);
    this.flinch = Math.max(0, this.flinch - dt * 3.5);
    if (this.burnT > 0) this.burnT -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      const tick = this.state === 'combat' ? 0.14 : 0.26;
      this.thinkT = tick * rand(0.85, 1.15);
      this.think(tick);
    }
    this.move(dt);
    this.fireControl(dt);
    this.crouchT = damp(this.crouchT, this.crouched ? 1 : 0, 9, dt);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    // Skip the costly pose update for soldiers far outside the fight.
    const cam = g.engine.camera.position;
    const far = Math.abs(cam.x - this.pos.x) + Math.abs(cam.z - this.pos.z) > 110;
    if (!far || g.engine.frame % 4 === 0) this.animate(dt, false);
  }

  private move(dt: number): void {
    const g = this.game;
    const nav = g.nav;
    let moving = false;
    let faceX = 0;
    let faceZ = 0;
    if (this.goal && this.stunT <= 0 && !this.hold) {
      if (this.needPath) {
        if (g.enemies.takePathBudget()) {
          this.needPath = false;
          this.pathI = 0;
          if (!nav.findPath(this.pos.x, this.pos.z, this.goal.x, this.goal.z, this.path)) {
            this.goal = null;
            this.path.length = 0;
          }
        }
      } else if (this.pathI < this.path.length) {
        const tx = this.path[this.pathI];
        const tz = this.path[this.pathI + 1];
        let dx = tx - this.pos.x;
        let dz = tz - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.4) {
          this.pathI += 2;
          if (this.pathI >= this.path.length) {
            this.goal = null;
            this.path.length = 0;
          }
        } else {
          dx /= dist;
          dz /= dist;
          const speed = this.state === 'combat' ? this.arch.speed * (this.crouched ? 0.45 : 1) * (this.burnT > 0 ? 1.2 : 1) : this.state === 'patrol' ? 1.45 : 2.8;
          // Keep a little distance from squad mates.
          const push = g.enemies.separation(this, v);
          const step = speed * dt;
          let nx = this.pos.x + dx * step + push.x * dt;
          let nz = this.pos.z + dz * step + push.z * dt;
          if (!nav.walkable(nx, nz)) {
            if (nav.walkable(nx, this.pos.z)) nz = this.pos.z;
            else if (nav.walkable(this.pos.x, nz)) nx = this.pos.x;
            else {
              nx = this.pos.x;
              nz = this.pos.z;
            }
          }
          const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
          if (moved < step * 0.25) {
            this.stuck += dt;
            if (this.stuck > 0.8) {
              this.needPath = true;
              this.stuck = 0;
            }
          } else this.stuck = 0;
          this.pos.x = nx;
          this.pos.z = nz;
          this.phase += moved * 4.2;
          this.speedNow = damp(this.speedNow, speed, 10, dt);
          moving = true;
          faceX = dx;
          faceZ = dz;
        }
      }
    }
    if (!moving) this.speedNow = damp(this.speedNow, 0, 12, dt);
    if (this.fixedY === null) this.pos.y = damp(this.pos.y, nav.heightAt(this.pos.x, this.pos.z), 14, dt);

    // Facing
    let want = this.yaw;
    let rate = 4;
    const engaged = this.state === 'combat' && (this.canSee || this.sinceSeen < 4 || !moving);
    if (this.stunT > 0) want = this.yaw + Math.sin(g.engine.time * 3 + this.id) * 0.02;
    else if (engaged || (this.state === 'investigate' && !moving)) {
      want = Math.atan2(-(this.lastSeen.x - this.pos.x), -(this.lastSeen.z - this.pos.z));
      rate = this.state === 'combat' ? 8.5 : 3;
    } else if (moving) {
      want = Math.atan2(-faceX, -faceZ);
      rate = 7;
    } else if (this.state === 'idle') {
      this.lookT += dt;
      want = this.homeYaw + Math.sin(this.lookT * 0.35 + this.id) * 0.7;
      rate = 1.2;
    } else if (this.state === 'search') {
      this.lookT += dt;
      want = this.yaw + Math.sin(this.lookT * 0.9) * 0.04;
    }
    this.yaw = dampAngle(this.yaw, want, rate, dt);
  }

  private fireControl(dt: number): void {
    const g = this.game;
    const a = this.arch;
    const w = this.weapon;
    const inFight = this.state === 'combat' && this.stunT <= 0;
    this.aimBlend = damp(this.aimBlend, inFight || this.state === 'investigate' ? 1 : 0, 7, dt);
    if (!inFight) {
      this.aimPitch = damp(this.aimPitch, 0, 5, dt);
      return;
    }
    if (this.reactT > 0) {
      this.reactT -= dt;
      return;
    }
    const p = g.player;
    const tx = this.canSee ? p.pos.x : this.lastSeen.x;
    const ty = this.canSee ? p.pos.y + p.eyeHeight * 0.74 : this.lastSeen.y + 1.1;
    const tz = this.canSee ? p.pos.z : this.lastSeen.z;
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    const my = this.pos.y + lerp(1.42, 0.92, this.crouchT) * a.scale;
    this.aimPitch = damp(this.aimPitch, clamp(Math.atan2(ty - my, Math.max(0.5, d)), -0.7, 0.7), 10, dt);
    this.settle = clamp(this.settle + (this.canSee ? dt / 1.25 : -dt * 0.7), 0, 1);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo = w.mag;
      return;
    }
    const aligned = Math.abs(angleDiff(this.yaw, Math.atan2(-dx, -dz))) < 0.22;
    if (this.burstLeft <= 0) {
      this.burstCool -= dt;
      const canFire = this.canSee && aligned && d < a.range[2] * 1.2 && this.crouchT < 0.5 + (this.hold ? 0.6 : 0);
      if (canFire && a.aimTime) {
        this.aimT += dt;
        if (a.glint && g.engine.frame % 9 === 0) g.fx.glint(this.pos.x - Math.sin(this.yaw) * 0.35, my + 0.08, this.pos.z - Math.cos(this.yaw) * 0.35);
      } else if (!canFire) this.aimT = Math.max(0, this.aimT - dt * 2);
      if (this.burstCool <= 0 && canFire && (!a.aimTime || this.aimT >= a.aimTime)) {
        this.burstLeft = randInt(a.burst[0], a.burst[1]);
        this.shotT = 0;
        this.aimT = 0;
      }
      return;
    }
    this.shotT -= dt;
    if (this.shotT > 0) return;
    if (!aligned && !this.canSee) {
      this.burstLeft = 0;
      this.burstCool = rand(a.pause[0], a.pause[1]);
      return;
    }
    // ---- one shot
    const auto = w.modes[0] === 'auto' || w.modes[0] === 'burst3' || w.modes[0] === 'burst2';
    this.shotT = auto ? Math.max(0.07, 60 / w.rpm) : w.cycle > 0 ? w.cycle + rand(0.3, 0.6) : rand(0.22, 0.4);
    const fxn = -Math.sin(this.yaw);
    const fzn = -Math.cos(this.yaw);
    const mx = this.pos.x + fxn * 0.55 + fzn * -0.14;
    const mz = this.pos.z + fzn * 0.55 - fxn * -0.14;
    // Lead a moving target, imperfectly.
    const travel = d / Math.max(60, w.mv);
    let ax = tx + (this.canSee ? p.vel.x * travel * 0.65 : 0) - mx;
    let ay = ty + (w.proj !== 'bullet' ? 0.5 * 9.81 * travel * travel * (w.proj === 'rocket' ? 0.15 : 1) : 0) - my;
    let az = tz + (this.canSee ? p.vel.z * travel * 0.65 : 0) - mz;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    const diff = DIFFICULTY[store.settings.difficulty];
    const err = ((a.accuracy / diff.enemyAcc) * (2.7 - 1.7 * this.settle) * (1 + this.suppress * 1.4) * (this.speedNow > 0.5 ? 1.6 : 1) * (this.crouched ? 0.85 : 1) * (1 + p.speed * 0.07) + w.moa / 60) * DEG;
    const n = w.pellets;
    for (let i = 0; i < n; i++) {
      const e = n > 1 ? err + w.pattern * DEG : err;
      const ox = gauss() * e;
      const oy = gauss() * e * 0.75;
      // Perturb around the aim direction (small-angle).
      const rx = -az;
      const rz = ax;
      const rl = Math.hypot(rx, rz) || 1;
      const sx = ax + (rx / rl) * ox;
      const sy = ay + oy;
      const sz = az + (rz / rl) * ox;
      const sl = Math.hypot(sx, sy, sz);
      g.combat.fire(w, mx, my, mz, sx / sl, sy / sl, sz / sl, false, this);
    }
    g.audio.play(w.sound, { x: mx, y: my, z: mz, ref: w.suppressed ? 5 : 15, vol: 0.85 });
    g.fx.muzzle(mx, my, mz, ax, ay, az, w.energy > 2400 ? 1.2 : 0.9, w.suppressed);
    this.flinch = Math.min(1, this.flinch + 0.12);
    this.burstLeft--;
    this.ammo--;
    if (this.ammo <= 0) {
      this.reloadT = Math.min(5, w.reload) * 1.15;
      this.burstLeft = 0;
      this.burstCool = 0.3;
      if (Math.random() < 0.55) g.enemies.shout(this, false, ['reloading', 'cover_me']);
    } else if (this.burstLeft <= 0) this.burstCool = rand(a.pause[0], a.pause[1]) * (this.cover ? 1.25 : 1);
  }

  // ------------------------------------------------------------------ animation

  private animate(dt: number, force: boolean): void {
    void dt;
    void force;
    const b = this.bones;
    const c = this.crouchT;
    const run = clamp(this.speedNow / 4.6, 0, 1.2);
    const amp = this.speedNow > 0.2 ? 0.28 + run * 0.5 : 0;
    const s = Math.sin(this.phase);
    const co = Math.cos(this.phase);
    const aim = this.aimBlend;
    const stun = this.stunT > 0 ? 1 : 0;
    // Legs. Standing still to fight means a braced stance: feet apart, the left leading, knees soft.
    const still = this.speedNow > 0.2 ? 0 : 1;
    const brace = aim * still * (1 - c);
    const ease = (1 - aim) * still * (1 - c);
    b[B_LEG_LU].rotation.x = s * amp + c * 1.3 + brace * 0.3 + ease * 0.05;
    b[B_LEG_RU].rotation.x = -s * amp + c * 1.05 - brace * 0.2 - ease * 0.04;
    b[B_LEG_LL].rotation.x = -(Math.max(0, -co) * amp * 1.5 + c * 2.15 + brace * 0.36 + ease * 0.06);
    b[B_LEG_RL].rotation.x = -(Math.max(0, co) * amp * 1.5 + c * 1.6 + brace * 0.14);
    b[B_LEG_LU].rotation.z = -0.045 - brace * 0.07;
    b[B_LEG_RU].rotation.z = 0.045 + brace * 0.09;
    b[B_HIPS].position.y = 0.97 - c * 0.43 + Math.abs(co) * 0.03 * amp - brace * 0.035;
    b[B_HIPS].rotation.y = s * 0.08 * amp + brace * 0.3;
    // Torso follows the aim; flinch snaps it back.
    b[B_SPINE].rotation.x = this.aimPitch * 0.75 * aim - 0.1 * run - brace * 0.12 + c * 0.22 - this.flinch * 0.22 - stun * 0.45;
    b[B_SPINE].rotation.y = 0.32 * aim - brace * 0.3 - s * 0.06 * amp;
    b[B_SPINE].rotation.z = stun * Math.sin(this.game.engine.time * 4 + this.id) * 0.1;
    b[B_HEAD].rotation.x = this.aimPitch * 0.25 - c * 0.15 + stun * 0.5;
    b[B_HEAD].rotation.y = -0.3 * aim;
    // Arms: blend between a low carry and a shouldered aim.
    const sw = s * amp * 0.5 * (1 - aim);
    b[B_ARM_RU].rotation.set(lerp(0.35, 1.05, aim) - sw + stun * 1.2, 0, lerp(-0.05, -0.28, aim));
    b[B_ARM_RL].rotation.set(lerp(1.0, 1.15, aim) + stun * 0.9, 0, 0);
    b[B_ARM_LU].rotation.set(lerp(0.5, 1.3, aim) + sw + stun * 1.1, lerp(0.2, 0.25, aim), lerp(0.45, 0.72, aim));
    b[B_ARM_LL].rotation.set(lerp(0.75, 0.42, aim) + stun * 1.0, 0, 0);
    // Weapon: carried low across the body when calm, up in the shoulder when fighting. It rises and
    // falls with each step and with breathing.
    const wb = b[B_WEAPON];
    const breath = Math.sin(this.game.engine.time * 1.7 + this.id * 1.3) * 0.006;
    const stepBob = Math.abs(co) * 0.012 * amp * (1 - aim * 0.6);
    wb.position.set(lerp(0.1, 0.07, aim), lerp(0.13, 0.36, aim) - stun * 0.2 + breath - stepBob, lerp(-0.23, -0.27, aim));
    wb.rotation.set(lerp(-0.62, 0.0, aim) - this.flinch * 0.1 - stun * 0.9, lerp(0.42, -0.32, aim), 0);
    if (stun < 0.5 && this.weapon.cls !== 'melee') {
      // Both hands hold the weapon wherever it is, instead of the arms striking a fixed pose near it.
      _wq.setFromEuler(wb.rotation);
      reach(b[B_ARM_RU], b[B_ARM_RL], SHOULDER_R, _hand.copy(FIRE_GRIP).applyQuaternion(_wq).add(wb.position), 1);
      const grip = supportGrip.get(this.weapon.id);
      if (grip) {
        // Long handguards are held where an arm can comfortably reach.
        _hand.set(grip.x - 0.01, grip.y - 0.012, Math.max(grip.z, -0.27)).applyQuaternion(_wq).add(wb.position);
        reach(b[B_ARM_LU], b[B_ARM_LL], SHOULDER_L, _hand, -1);
      }
    }
  }

  private updateDeath(dt: number): void {
    if (this.corpse) return;
    this.deathT += dt;
    const t = clamp(this.deathT / 0.62, 0, 1);
    const e = t * t;
    const m = this.mesh;
    const b = this.bones;
    if (this.deathVY !== 0 || this.deathVX !== 0) {
      this.deathVY -= 16 * dt;
      this.pos.x += this.deathVX * dt;
      this.pos.z += this.deathVZ * dt;
      this.pos.y += this.deathVY * dt;
      const floor = this.fixedY ?? this.game.nav.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y <= floor) {
        this.pos.y = floor;
        this.deathVX = this.deathVY = this.deathVZ = 0;
      }
    }
    const k = this.deathKind;
    m.rotation.x = k === 0 ? e * 1.5 : k === 1 ? -e * 1.5 : 0;
    m.rotation.z = k === 2 ? e * 1.5 : k === 3 ? -e * 1.5 : 0;
    m.position.set(this.pos.x, this.pos.y + e * 0.13, this.pos.z);
    // Limbs go slack.
    b[B_ARM_LU].rotation.z = lerp(b[B_ARM_LU].rotation.z, 1.0, dt * 6);
    b[B_ARM_RU].rotation.z = lerp(b[B_ARM_RU].rotation.z, -0.9, dt * 6);
    b[B_ARM_RU].rotation.x = lerp(b[B_ARM_RU].rotation.x, 0.2, dt * 6);
    b[B_ARM_LU].rotation.x = lerp(b[B_ARM_LU].rotation.x, 0.3, dt * 6);
    b[B_LEG_LL].rotation.x = lerp(b[B_LEG_LL].rotation.x, -0.5, dt * 6);
    b[B_LEG_LU].rotation.x = lerp(b[B_LEG_LU].rotation.x, 0.25, dt * 6);
    b[B_LEG_RU].rotation.x = lerp(b[B_LEG_RU].rotation.x, -0.05, dt * 6);
    b[B_SPINE].rotation.x = lerp(b[B_SPINE].rotation.x, k === 1 ? 0.2 : -0.15, dt * 6);
    b[B_HIPS].position.y = lerp(b[B_HIPS].position.y, 0.97, dt * 6);
    b[B_HEAD].rotation.y = lerp(b[B_HEAD].rotation.y, 0.5, dt * 5);
    if (this.deathT > 1.6 && this.deathVY === 0) this.corpse = true;
  }

  /** Scripted: make this soldier walk somewhere (used for scene-setting patrols). */
  orderMove(x: number, z: number): void {
    this.goTo(x, z);
  }

  dispose(): void {
    this.releaseCover();
    this.mesh.skeleton.dispose();
    this.mesh.removeFromParent();
  }
}
