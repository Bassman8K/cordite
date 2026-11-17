// A member of the player's squad: the same soldier as the enemy's, on the other side. He follows the
// player, holds his fire until the shooting starts, then fights whoever he can see. He cannot be
// hurt: nothing the enemy does to him has any effect.

import * as THREE from 'three';
import { F_SIGHT } from '../../world/collision';
import type { Game } from '../game';
import { Enemy } from './soldier';

export interface SquadMember {
  callsign: string;
  type: string;
  /** Which shoulder of the player he keeps to: -1 left, 1 right. */
  side: -1 | 1;
  actor: 'vo' | 'vo2';
  voice: number;
}

/** The callsign floating over a squad member, drawn through walls so he can always be found. */
function nameTag(callsign: string): THREE.Sprite | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 80;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.font = '600 34px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#7fd6ff';
  ctx.fillText(callsign, 128, 26);
  ctx.beginPath();
  ctx.moveTo(116, 52);
  ctx.lineTo(128, 68);
  ctx.lineTo(140, 52);
  ctx.closePath();
  ctx.fill();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, opacity: 0.9 }));
  sprite.scale.set(0.115, 0.036, 1);
  sprite.position.set(0, 2.12, 0);
  sprite.renderOrder = 999;
  return sprite;
}

export class Ally extends Enemy {
  override readonly friendly = true;
  readonly callsign: string;
  private readonly side: number;
  private target: Enemy | null = null;
  private scanT = Math.random() * 0.5;
  private idleT = 0;
  private readonly tag2: THREE.Sprite | null;

  constructor(game: Game, m: SquadMember, x: number, y: number, z: number, yaw: number) {
    super(game, m.type, x, y, z, yaw, { group: 'squad' });
    this.callsign = m.callsign;
    this.side = m.side;
    this.actor = m.actor;
    this.voice = m.voice;
    this.tag2 = nameTag(m.callsign);
    if (this.tag2) this.mesh.add(this.tag2);
  }

  // ---------------------------------------------------------------- nothing hurts him

  override damage(): boolean {
    this.flinch = Math.min(1, this.flinch + 0.2);
    return false;
  }
  override burn(): void {}
  override stun(): void {}
  override suppressBy(): void {}
  override hear(): void {}
  override enterCombat(): void {}

  protected override skill(): number {
    return 1;
  }

  /** Keeps up with the player: a walk beside him, a run to catch up, a sprint when left behind. */
  protected override pace(): number {
    if (this.state === 'combat') return this.arch.speed;
    const p = this.game.player;
    const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    return d > 9 ? 6.6 : d > 4.5 ? 4.8 : p.sprinting ? 5.4 : 3;
  }

  override onKill(): void {
    if (Math.random() < 0.7) this.game.enemies.shout(this, false, ['target_destroyed']);
  }

  // ---------------------------------------------------------------- finding someone to shoot

  protected override perceive(tick: number): void {
    const g = this.game;
    const ex = this.pos.x;
    const ey = this.eyeY;
    const ez = this.pos.z;
    const sees = (e: Enemy) => g.world.los(ex, ey, ez, e.pos.x, e.pos.y + 1.25, e.pos.z, F_SIGHT) && !g.combat.smokeBlocks(ex, ey, ez, e.pos.x, e.pos.y + 1, e.pos.z);
    // Weapons stay tight until the enemy is fighting: the squad never gives the player away.
    const free = g.enemies.fighting > 0 && g.player.alive;
    let t = this.target && this.target.alive && free ? this.target : null;
    this.scanT -= tick;
    if (free && (this.scanT <= 0 || !t)) {
      this.scanT = 0.5 + Math.random() * 0.4;
      let best: Enemy | null = null;
      let bestScore = this.arch.range[2];
      for (const e of g.enemies.list) {
        if (!e.alive || Math.abs(e.pos.y - this.pos.y) > 25) continue;
        const d = Math.hypot(e.pos.x - ex, e.pos.z - ez);
        // Nearest first; men already in the fight before men who are not; and no hopping between
        // targets unless another is clearly the better one.
        const score = d * (e.state === 'combat' ? 1 : 1.6) * (e === t ? 0.7 : 1);
        if (score < bestScore && sees(e)) {
          best = e;
          bestScore = score;
        }
      }
      if (best) t = best;
    }
    this.target = t;
    const see = t !== null && sees(t);
    this.canSee = see;
    if (t) this.mark = t;
    if (t && see) {
      this.lastSeen.copy(t.pos);
      this.sinceSeen = 0;
    } else this.sinceSeen += tick;
    const fight = t !== null && this.sinceSeen < 6;
    if (fight && this.state !== 'combat') {
      this.state = 'combat';
      this.reactT = 0.2 + Math.random() * 0.35;
      this.burstCool = 0.1 + Math.random() * 0.3;
      if (Math.random() < 0.5) g.enemies.shout(this, false, ['target_engaged', 'suppressing_fire', 'go_go_go']);
    } else if (!fight && this.state === 'combat') {
      this.state = 'idle';
      this.target = null;
      this.burstLeft = 0;
    }
  }

  // ---------------------------------------------------------------- staying with the player

  protected override think(tick: number): void {
    const g = this.game;
    const p = g.player;
    this.perceive(tick);
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = -fz;
    const rz = fx;
    // His place: off the player's shoulder and a couple of steps back.
    let sx = p.pos.x + rx * this.side * 2.3 - fx * 1.9;
    let sz = p.pos.z + rz * this.side * 2.3 - fz * 1.9;
    if (!g.nav.walkable(sx, sz)) {
      sx = p.pos.x - fx * 1.4 + rx * this.side * 0.8;
      sz = p.pos.z - fz * 1.4 + rz * this.side * 0.8;
      if (!g.nav.walkable(sx, sz)) {
        sx = p.pos.x;
        sz = p.pos.z;
      }
    }
    const toSlot = Math.hypot(sx - this.pos.x, sz - this.pos.z);
    const toPlayer = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const fighting = this.state === 'combat';
    // Left behind (a lift, a long sprint, a path that cannot be walked): rejoin behind the player.
    this.idleT = toPlayer > 12 && this.speedNow < 0.4 ? this.idleT + tick : 0;
    if (toPlayer > 45 || Math.abs(p.pos.y - this.pos.y) > 8 || this.idleT > 3.5) {
      this.rejoin();
      return;
    }
    this.homeYaw = p.yaw;
    if (fighting && this.canSee && toPlayer < 22) {
      // A clear shot from here: stand and take it.
      this.goal = null;
      this.path.length = 0;
    } else if (fighting && !this.canSee && this.sinceSeen > 1.4 && toPlayer < 15) {
      // Lost sight of him: push a few metres towards where he was, never far from the player.
      if (!this.goal) {
        const dx = this.lastSeen.x - this.pos.x;
        const dz = this.lastSeen.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = Math.min(6, d * 0.6);
        this.goTo(this.pos.x + (dx / d) * step, this.pos.z + (dz / d) * step);
      }
    } else if (toSlot > (fighting ? 10 : 2.4)) {
      if (!this.goal || Math.hypot(this.goal.x - sx, this.goal.z - sz) > 2) this.goTo(sx, sz);
    }
    // Out of a fight he does as the player does: down when the player is down.
    this.crouched = !fighting && p.crouched && !this.goal;
  }

  /** Puts him back beside the player, behind and out of the way, wherever the ground allows. */
  rejoin(): void {
    const g = this.game;
    const p = g.player;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = -fz;
    const rz = fx;
    let x = p.pos.x;
    let z = p.pos.z;
    for (const [back, across] of [[2.4, 1.6], [3.6, 2.4], [1.6, 1], [3, 0], [1.4, -1.4], [2.6, -2.4], [0.9, 0]]) {
      const cx = p.pos.x - fx * back + rx * across * this.side;
      const cz = p.pos.z - fz * back + rz * across * this.side;
      if (g.nav.walkable(cx, cz) && Math.abs(g.nav.heightAt(cx, cz) - p.pos.y) < 2.2) {
        x = cx;
        z = cz;
        break;
      }
    }
    this.pos.set(x, g.nav.walkable(x, z) ? g.nav.heightAt(x, z) : p.pos.y, z);
    this.yaw = this.homeYaw = p.yaw;
    this.goal = null;
    this.path.length = 0;
    this.idleT = 0;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  override dispose(): void {
    if (this.tag2) {
      this.tag2.material.map?.dispose();
      this.tag2.material.dispose();
    }
    super.dispose();
  }
}
