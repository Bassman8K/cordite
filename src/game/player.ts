import * as THREE from 'three';
import { input } from '../core/input';
import { clamp, damp, DEG, lerp } from '../core/math';
import { DIFFICULTY, store } from '../core/settings';
import type { Ground, Surface } from '../world/collision';
import type { Game } from './game';

const RADIUS = 0.34;
const H_STAND = 1.8;
const H_CROUCH = 1.15;
const EYE_STAND = 1.66;
const EYE_CROUCH = 1.02;
const GRAVITY = 20;
const JUMP_V = 5.7;

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 100;
  armor = 0;
  medkits = 2;
  alive = true;
  crouched = false;
  /** 0 standing .. 1 fully crouched (smoothed). */
  crouchT = 0;
  grounded = true;
  sprinting = false;
  /** Horizontal speed in m/s (for spread, bob and AI hearing). */
  speed = 0;
  /** Set by the weapon system each frame. */
  ads = 0;
  zoom = 1;
  mobility = 1;
  /** Seconds left on a medkit application. */
  healing = 0;
  surface: Surface = 'concrete';
  /** Remaining stun/blind time from flashbangs. */
  blind = 0;
  flashlightOn = false;
  noclip = false;
  /** Set by the weapon system: scope wobble added to the view. */
  swayP = 0;
  swayY = 0;
  /** While positive the player cannot sprint (firing / aiming). */
  noSprintT = 0;
  /** Look input applied this frame (the weapon rig lags behind it). */
  lookDX = 0;
  lookDY = 0;

  // View effects
  recoilP = 0;
  recoilY = 0;
  private viewP = 0;
  private viewY = 0;
  private shake = 0;
  private shakeT = 0;
  private bobT = 0;
  private bobAmp = 0;
  private stepSmooth = 0;
  private landDip = 0;
  private roll = 0;
  private stepDist = 0;
  private sinceDamage = 99;
  private healPool = 0;
  private deathT = 0;
  private ground: Ground = { y: 0, surf: 'concrete' };
  private look = { x: 0, y: 0 };
  /** View-space bob offset the viewmodel reads to stay in sync with footsteps. */
  bobX = 0;
  bobY = 0;

  constructor(private readonly game: Game) {}

  get height(): number {
    return lerp(H_STAND, H_CROUCH, this.crouchT);
  }
  get eyeHeight(): number {
    return lerp(EYE_STAND, EYE_CROUCH, this.crouchT);
  }
  get radius(): number {
    return RADIUS;
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.alive = true;
    this.crouched = false;
    this.crouchT = 0;
    this.grounded = true;
    this.recoilP = this.recoilY = this.viewP = this.viewY = 0;
    this.shake = 0;
    this.deathT = 0;
    this.healing = 0;
    this.blind = 0;
    this.stepSmooth = 0;
    this.sinceDamage = 99;
    this.updateCamera(0);
  }

  /** Unit vector the camera is looking along (including recoil). */
  viewDir(out: THREE.Vector3): THREE.Vector3 {
    const p = this.pitch + this.viewP + this.swayP;
    const y = this.yaw + this.viewY + this.swayY;
    const cp = Math.cos(p);
    return out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
  }

  kick(pitchDeg: number, yawDeg: number): void {
    this.recoilP += pitchDeg * DEG;
    this.recoilY += yawDeg * DEG;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  heal(amount: number): void {
    this.health = Math.min(100, this.health + amount);
  }

  useMedkit(): boolean {
    if (this.medkits <= 0 || this.health >= 100 || this.healing > 0 || !this.alive) return false;
    this.medkits--;
    this.healing = 1.6;
    this.healPool = 60;
    this.game.audio.play('medkit');
    return true;
  }

  damage(amount: number, fromX: number, fromZ: number, kind: 'bullet' | 'blast' | 'fall' | 'melee' | 'fire' = 'bullet'): void {
    if (!this.alive || store.settings.god || this.noclip) return;
    let dmg = amount * DIFFICULTY[store.settings.difficulty].dmgIn;
    if (kind === 'fall') dmg = amount;
    if (this.armor > 0 && kind !== 'fall') {
      const absorbed = Math.min(this.armor, dmg * 0.6);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.sinceDamage = 0;
    this.addShake(clamp(dmg / 45, 0.08, 0.7));
    this.recoilP += (Math.random() - 0.3) * 0.02 * Math.min(3, dmg / 10);
    this.recoilY += (Math.random() - 0.5) * 0.03 * Math.min(3, dmg / 10);
    // Direction of the hit relative to the view, for the HUD indicator.
    const ang = Math.atan2(fromX - this.pos.x, fromZ - this.pos.z) - (this.yaw + Math.PI);
    this.game.events.emit('damage', { amount: dmg, angle: ang, kind });
    this.game.audio.play(kind === 'blast' ? 'hurtBlast' : 'hurt');
    // Your own voice, some of the time.
    if (this.game.audio.has('pain') && Math.random() < 0.4) this.game.audio.play('pain', { vol: 0.45, delay: 0.04 });
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deathT = 0;
      this.game.onPlayerDeath();
    }
  }

  update(dt: number): void {
    const g = this.game;
    const world = g.world;
    if (!this.alive) {
      this.deathT += dt;
      this.vel.x = damp(this.vel.x, 0, 6, dt);
      this.vel.z = damp(this.vel.z, 0, 6, dt);
      this.updateCamera(dt);
      return;
    }
    // ---- look
    input.consumeLook(this.look);
    this.lookDX = this.look.x;
    this.lookDY = this.look.y;
    if (this.blind > 0) this.blind -= dt;
    this.yaw -= this.look.x;
    this.pitch = clamp(this.pitch - this.look.y, -1.5, 1.5);

    // ---- stance
    if (store.settings.toggleCrouch) {
      if (input.pressed('crouch')) this.setCrouch(!this.crouched);
    } else this.setCrouch(input.down('crouch'));
    this.crouchT = damp(this.crouchT, this.crouched ? 1 : 0, 12, dt);

    // ---- desired velocity
    const mx = input.moveX;
    const my = input.moveY;
    const moving = Math.abs(mx) + Math.abs(my) > 0.05;
    const wantSprint = input.down('sprint') || (input.device !== 'kbm' && my > 0.92);
    this.noSprintT -= dt;
    this.sprinting = wantSprint && my > 0.5 && !this.crouched && this.ads < 0.3 && this.grounded && this.healing <= 0 && this.noSprintT <= 0;
    if (this.sprinting && this.crouched) this.setCrouch(false);
    let speed = this.crouched ? 2.1 : this.sprinting ? 6.5 : 4.3;
    speed *= lerp(1, 0.55, this.ads) * this.mobility;
    if (this.noclip) speed = input.down('sprint') ? 28 : 12;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = (mx * cos - my * sin) * speed;
    const wz = (-mx * sin - my * cos) * speed;

    if (this.noclip) {
      const dir = this.viewDir(new THREE.Vector3());
      this.pos.x += (mx * cos + dir.x * my) * speed * dt;
      this.pos.z += (-mx * sin + dir.z * my) * speed * dt;
      this.pos.y += (dir.y * my + (input.down('jump') ? 1 : 0) - (input.down('crouch') ? 1 : 0)) * speed * dt;
      this.vel.set(0, 0, 0);
      this.speed = 0;
      this.updateCamera(dt);
      return;
    }

    const accel = this.grounded ? 14 : 2.2;
    this.vel.x = damp(this.vel.x, wx, accel, dt);
    this.vel.z = damp(this.vel.z, wz, accel, dt);
    if (!moving && this.grounded) {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }
    if (input.pressed('jump') && this.grounded && this.healing <= 0) {
      if (this.crouched) this.setCrouch(false);
      else {
        this.vel.y = JUMP_V;
        this.grounded = false;
        g.audio.play('jump');
      }
    }

    // ---- integrate + collide
    const prevY = this.pos.y;
    const stepH = this.grounded ? 0.42 : 0.14;
    const dx = this.vel.x * dt;
    const dz = this.vel.z * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (RADIUS * 0.7)));
    const bx = this.pos.x;
    const bz = this.pos.z;
    for (let i = 0; i < n; i++) {
      this.pos.x += dx / n;
      this.pos.z += dz / n;
      world.resolve(this.pos, RADIUS, this.height, stepH);
    }
    const terrain = world.terrain;
    if (terrain && this.grounded) {
      const run = Math.hypot(this.pos.x - bx, this.pos.z - bz);
      if (run > 1e-4 && (terrain.heightAt(this.pos.x, this.pos.z) - terrain.heightAt(bx, bz)) / run > 1.3) {
        this.pos.x = bx;
        this.pos.z = bz;
      }
    }
    // Remove velocity lost to walls so the player does not "stick" on release.
    if (dt > 0) {
      this.vel.x = (this.pos.x - bx) / dt;
      this.vel.z = (this.pos.z - bz) / dt;
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;
    world.groundAt(this.pos.x, this.pos.z, RADIUS * 0.72, Math.max(prevY, this.pos.y) + stepH, this.ground);
    const wasGrounded = this.grounded;
    if (this.pos.y <= this.ground.y) {
      if (!wasGrounded) {
        const impact = -this.vel.y;
        this.landDip = Math.min(0.28, impact * 0.022);
        if (impact > 4) g.audio.play('land');
        if (impact > 11.5) this.damage((impact - 11.5) * 9, this.pos.x, this.pos.z, 'fall');
      } else {
        this.stepSmooth += this.ground.y - this.pos.y;
      }
      this.pos.y = this.ground.y;
      this.vel.y = 0;
      this.grounded = true;
    } else if (wasGrounded && this.vel.y <= 0 && this.pos.y - this.ground.y < 0.5) {
      // Walking down steps / gentle slopes: stay glued to the ground.
      this.stepSmooth += this.ground.y - (prevY - 0);
      this.pos.y = this.ground.y;
      this.vel.y = 0;
    } else {
      this.grounded = false;
    }
    if (this.vel.y > 0) {
      const c = world.ceilingAt(this.pos.x, this.pos.z, RADIUS * 0.72, prevY + this.height - 0.1);
      if (this.pos.y + this.height > c) {
        this.pos.y = c - this.height;
        this.vel.y = 0;
      }
    }
    this.surface = this.ground.surf;
    if (this.pos.y < -40) this.damage(9999, this.pos.x, this.pos.z, 'fall');

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ---- footsteps (and the noise AI can hear)
    if (this.grounded && this.speed > 0.8) {
      this.stepDist += this.speed * dt;
      const stride = this.sprinting ? 2.5 : this.crouched ? 1.5 : 2.0;
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        g.audio.footstep(this.surface, this.crouched ? 0.25 : this.sprinting ? 1 : 0.6);
        if (!this.crouched) g.enemies.hearNoise(this.pos.x, this.pos.y, this.pos.z, this.sprinting ? 11 : 5, false);
      }
    }

    // ---- health
    this.sinceDamage += dt;
    if (this.healing > 0) {
      const step = Math.min(this.healPool, (60 / 1.6) * dt);
      this.healPool -= step;
      this.heal(step);
      this.healing -= dt;
    } else if (this.sinceDamage > 5 && this.health < 100) {
      const cap = Math.ceil(this.health / 25 - 1e-6) * 25;
      if (this.health < cap) this.health = Math.min(cap, this.health + 5 * DIFFICULTY[store.settings.difficulty].regen * dt);
    }
    if (input.pressed('medkit')) this.useMedkit();
    if (input.pressed('flashlight')) {
      this.flashlightOn = !this.flashlightOn;
      g.audio.play('click');
    }
    g.engine.flashlight.intensity = damp(g.engine.flashlight.intensity, this.flashlightOn ? 260 : 0, 20, dt);

    this.updateCamera(dt);
  }

  private setCrouch(v: boolean): void {
    if (v === this.crouched) return;
    if (!v) {
      // Need headroom to stand.
      const c = this.game.world.ceilingAt(this.pos.x, this.pos.z, RADIUS * 0.7, this.pos.y + H_CROUCH - 0.1);
      if (c < this.pos.y + H_STAND) return;
    }
    this.crouched = v;
  }

  private updateCamera(dt: number): void {
    const cam = this.game.engine.camera;
    // Recoil: the view chases the accumulated kick, which itself relaxes back to zero.
    this.viewP = damp(this.viewP, this.recoilP, 32, dt);
    this.viewY = damp(this.viewY, this.recoilY, 32, dt);
    this.recoilP = damp(this.recoilP, 0, 5.5, dt);
    this.recoilY = damp(this.recoilY, 0, 5.5, dt);
    this.stepSmooth = damp(this.stepSmooth, 0, 14, dt);
    this.stepSmooth = clamp(this.stepSmooth, -0.6, 0.6);
    this.landDip = damp(this.landDip, 0, 9, dt);

    // Head bob
    const bobOn = store.settings.bob;
    const target = this.grounded && this.speed > 0.6 ? clamp(this.speed / 6.5, 0, 1) * lerp(1, 0.3, this.ads) : 0;
    this.bobAmp = damp(this.bobAmp, target, 8, dt);
    this.bobT += dt * (this.sprinting ? 11.5 : 8.6) * (this.speed > 0.6 ? 1 : 0);
    this.bobX = Math.cos(this.bobT * 0.5) * 0.03 * this.bobAmp;
    this.bobY = Math.abs(Math.sin(this.bobT * 0.5)) * 0.045 * this.bobAmp;

    // Strafe roll
    const side = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.roll = damp(this.roll, clamp(-side * 0.0045, -0.03, 0.03), 8, dt);

    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.shakeT += dt * 46;
    const sh = this.shake * this.shake;
    const sp = (Math.sin(this.shakeT * 1.13) + Math.sin(this.shakeT * 2.71)) * 0.011 * sh;
    const sy = (Math.sin(this.shakeT * 0.93 + 2) + Math.sin(this.shakeT * 2.33)) * 0.011 * sh;
    const sr = Math.sin(this.shakeT * 1.71) * 0.014 * sh;

    let eyeY = this.eyeHeight - this.landDip - this.stepSmooth + (bobOn ? this.bobY : 0);
    let roll = this.roll + sr;
    let pitch = this.pitch + this.viewP + sp + this.swayP;
    if (!this.alive) {
      const t = clamp(this.deathT / 0.9, 0, 1);
      const e = 1 - (1 - t) * (1 - t);
      eyeY = lerp(eyeY, 0.28, e);
      roll += e * 0.9;
      pitch = lerp(pitch, 0.25, e);
    }
    this.eye.set(this.pos.x, this.pos.y + eyeY, this.pos.z);
    cam.position.copy(this.eye);
    if (bobOn) {
      cam.position.x += Math.cos(this.yaw) * this.bobX;
      cam.position.z -= Math.sin(this.yaw) * this.bobX;
    }
    cam.rotation.set(pitch, this.yaw + this.viewY + sy + this.swayY, roll);

    const base = store.settings.fov + (this.sprinting ? 4 : 0);
    const fov = (2 * Math.atan(Math.tan((base * DEG) / 2) / lerp(1, this.zoom, this.ads))) / DEG;
    this.game.engine.setFov(damp(this.game.engine.camera.fov, fov, 18, dt || 1));
    input.lookScale = lerp(1, store.settings.adsSens / Math.pow(this.zoom, 0.85), this.ads);
    this.game.engine.focus.copy(this.pos);
  }
}
