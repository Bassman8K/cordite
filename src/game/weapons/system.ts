// The player's weapons: trigger logic for every action type, aiming, reloads, melee and thrown
// ordnance. Ballistics themselves live in combat.ts; the on-screen rig lives in viewmodel.ts.

import * as THREE from 'three';
import { input } from '../../core/input';
import { clamp, damp, DEG, gauss, lerp, rand } from '../../core/math';
import { store, type Loadout } from '../../core/settings';
import { F_BULLET, makeHit } from '../../world/collision';
import type { Game } from '../game';
import { burstRpm, getWeapon, hasWeapon } from './data';
import { buildWeaponModel, disposeWeaponModel, type WeaponModel } from './model';
import type { FireMode, WeaponDef } from './types';
import { ViewModel } from './viewmodel';

export interface GunState {
  def: WeaponDef;
  mag: number;
  reserve: number;
  modeI: number;
  model: WeaponModel;
}

type Busy = 'none' | 'reload' | 'switch' | 'melee' | 'throw' | 'cycle';
const MODE_LABEL: Record<FireMode, string> = { auto: 'AUTO', semi: 'SEMI', burst2: '2-RND', burst3: '3-RND', bolt: 'BOLT', pump: 'PUMP', lever: 'LEVER', da: 'D/A', sa: 'S/A', single: 'SINGLE' };

export class PlayerWeapons {
  guns: GunState[] = [];
  cur = 0;
  melee: WeaponDef = getWeapon('kabar');
  thrown: WeaponDef = getWeapon('m67');
  thrownCount = 0;
  /** 0 hip .. 1 fully aimed. */
  ads = 0;
  readonly rig: ViewModel;

  private busy: Busy = 'none';
  private busyT = 0;
  private busyDur = 1;
  private cool = 0;
  private burstLeft = 0;
  private bloom = 0;
  private spin = 0;
  private drawT = -1;
  private adsToggle = false;
  private roundT = 0;
  private roundsStartedEmpty = false;
  private magInDone = false;
  private rackDone = false;
  private meleeDone = false;
  private cookT = -1;
  private autoReload = -1;
  private breath = 5;
  private time = 0;
  private autoT = 0;
  private autoOn = false;
  private semiT = 0;
  private flameT = 0;
  private dir = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private hit = makeHit();

  constructor(private readonly game: Game) {
    this.rig = new ViewModel(game.engine);
  }

  get gun(): GunState {
    return this.guns[this.cur];
  }
  get modeLabel(): string {
    const g = this.gun;
    return g ? MODE_LABEL[g.def.modes[g.modeI]] : '';
  }
  /** -1 when not reloading, otherwise 0..1. */
  get reloadProgress(): number {
    return this.busy === 'reload' && this.busyDur > 0 ? clamp(1 - this.busyT / this.busyDur, 0, 1) : -1;
  }
  /** Current cone of fire in degrees (drives the crosshair). */
  get spread(): number {
    const g = this.gun;
    if (!g) return 1;
    const p = this.game.player;
    const d = g.def;
    const move = clamp(p.speed / 4.3, 0, 1.6);
    const hip = d.hipSpread * (1 + move * 0.9) * (p.crouched ? 0.72 : 1) * (p.grounded ? 1 : 2.4);
    const aimed = d.adsSpread * (1 + move * 1.6) * (p.grounded ? 1 : 3);
    const a = this.ads * this.ads;
    return lerp(hip, aimed, a) + this.bloom * (1 - a * 0.65);
  }
  get scoped(): boolean {
    return !!this.gun && this.gun.def.scoped && this.ads > 0.8;
  }
  /** 0..1 fade of the scope view (the HUD reticle fades in as the eye reaches the glass). */
  get scopeBlend(): number {
    if (!this.gun || !this.gun.def.scoped) return 0;
    return clamp((this.ads - 0.72) / 0.2, 0, 1);
  }
  get isBusy(): boolean {
    return this.busy !== 'none';
  }

  // ------------------------------------------------------------------ loadout & ammo

  private makeGun(id: string): GunState {
    const def = getWeapon(hasWeapon(id) ? id : 'm4a1');
    return { def, mag: def.mag, reserve: def.reserve, modeI: 0, model: buildWeaponModel(def, true) };
  }

  setLoadout(l: Loadout): void {
    for (const g of this.guns) disposeWeaponModel(g.model);
    this.guns = [this.makeGun(l.primary), this.makeGun(l.secondary)];
    this.melee = getWeapon(hasWeapon(l.melee) ? l.melee : 'kabar');
    this.thrown = getWeapon(hasWeapon(l.throwable) ? l.throwable : 'm67');
    this.thrownCount = this.thrown.carry;
    this.cur = 0;
    this.busy = 'none';
    this.ads = 0;
    this.burstLeft = 0;
    this.cookT = -1;
    this.rig.setWeapon(this.gun.def, this.gun.model);
    this.rig.setMelee(this.melee);
    this.game.events.emit('weapon', undefined);
    this.game.audio.warm([this.guns[0].def.sound, this.guns[1].def.sound]);
  }

  /** Full restock (ammo crates, checkpoints). */
  resupply(): void {
    for (const g of this.guns) {
      g.mag = g.def.mag;
      g.reserve = g.def.reserve;
    }
    this.thrownCount = this.thrown.carry;
    this.game.events.emit('ammo', undefined);
  }

  /** Ammunition picked up from the field: a couple of magazines for each carried gun. */
  addAmmo(): void {
    for (const g of this.guns) {
      const add = Math.max(g.def.mag, Math.ceil(g.def.reserve * 0.3));
      g.reserve = Math.min(Math.ceil(g.def.reserve * 1.5), g.reserve + add);
    }
    this.game.events.emit('ammo', undefined);
  }

  addThrown(n = 1): boolean {
    if (this.thrownCount >= this.thrown.carry + 2) return false;
    this.thrownCount = Math.min(this.thrown.carry + 2, this.thrownCount + n);
    this.game.events.emit('ammo', undefined);
    return true;
  }

  // ------------------------------------------------------------------ actions

  private requestSwitch(i: number): void {
    if (i === this.cur || this.busy === 'switch' || this.busy === 'melee' || this.busy === 'throw') return;
    this.busy = 'switch';
    this.burstLeft = 0;
    this.drawT = -1;
    const dur = clamp(0.42 + this.gun.def.mass * 0.02, 0.42, 0.85);
    this.busyT = this.busyDur = dur;
    this.game.audio.play('draw', { vol: 0.6 });
    this.rig.startSwitch(dur, () => {
      this.cur = i;
      this.spin = 0;
      this.rig.setWeapon(this.gun.def, this.gun.model);
      this.game.events.emit('weapon', undefined);
    });
  }

  private tryReload(): void {
    const g = this.gun;
    const d = g.def;
    const infinite = store.settings.infiniteAmmo;
    if (this.busy !== 'none' || g.mag >= d.mag || (g.reserve <= 0 && !infinite) || d.feed === 'none') return;
    const a = this.game.audio;
    this.busy = 'reload';
    this.burstLeft = 0;
    this.autoReload = -1;
    if (d.perRound > 0) {
      this.roundsStartedEmpty = g.mag === 0;
      this.roundT = 0.4;
      this.busyT = this.busyDur = d.perRound * (d.mag - g.mag) + 0.8;
      return;
    }
    const empty = g.mag === 0;
    const dur = empty ? d.reloadEmpty : d.reload;
    this.busyT = this.busyDur = dur;
    this.magInDone = false;
    this.rackDone = !empty || d.feed === 'single' || d.feed === 'double' || d.feed === 'tank';
    this.rig.startReload(dur, empty && d.cycle === 0);
    a.play(d.feed === 'belt' ? 'bolt' : 'magOut', { vol: 0.7 });
    this.game.events.emit('reload', dur);
  }

  private finishReload(): void {
    const g = this.gun;
    const need = g.def.mag - g.mag;
    const take = store.settings.infiniteAmmo ? need : Math.min(need, g.reserve);
    g.mag += take;
    if (!store.settings.infiniteAmmo) g.reserve -= take;
    this.busy = 'none';
    this.game.events.emit('ammo', undefined);
  }

  private basis(): void {
    const p = this.game.player;
    p.viewDir(this.dir);
    this.right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    this.up.crossVectors(this.right, this.dir).normalize();
  }

  private shoot(): void {
    const game = this.game;
    const p = game.player;
    const g = this.gun;
    const d = g.def;
    const a = this.ads * this.ads;
    if (!store.settings.infiniteAmmo) g.mag--;
    game.stats.shots++;
    const bRpm = this.burstLeft > 0 ? burstRpm(d) : 0;
    this.cool = 60 / (bRpm || d.rpm);
    this.basis();
    const spread = this.spread * DEG;
    const bullet = d.proj === 'bullet';
    // Projectiles leave from the eye so the round goes exactly where the sights point;
    // slow projectiles start at the launcher so they are seen leaving it.
    const o = this.v.copy(p.eye);
    if (!bullet) o.addScaledVector(this.dir, 0.65).addScaledVector(this.right, 0.16 * (1 - a)).addScaledVector(this.up, -0.08 * (1 - a));
    for (let i = 0; i < d.pellets; i++) {
      const cone = d.pellets > 1 ? spread * 0.4 + d.pattern * DEG : spread;
      const r = Math.tan(cone) * Math.sqrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      const s = this.v2.copy(this.dir).addScaledVector(this.right, Math.cos(th) * r).addScaledVector(this.up, Math.sin(th) * r).normalize();
      game.combat.fire(d, o.x, o.y, o.z, s.x, s.y, s.z, true, null);
    }
    // Recoil
    const bipod = d.look.opts.has('bipod') && p.crouched && this.ads > 0.7 ? 0.55 : 1;
    const k = (0.72 + 0.28 * (1 - a)) * (p.crouched ? 0.85 : 1) * bipod;
    p.kick(d.recoil * k, gauss() * d.recoilH * k);
    this.rig.kick(d, this.ads);
    this.bloom = Math.min(4, this.bloom + d.recoil * 0.25);
    if (d.energy > 4500 || d.proj === 'rocket') p.addShake(d.proj === 'rocket' ? 0.35 : Math.min(0.3, d.recoil * 0.05));
    // Sound and what the enemy hears
    if (d.proj === 'flame') {
      if (this.flameT <= 0) {
        this.flameT = 1.9;
        game.audio.play('flame', { vol: 0.55 });
      }
    } else game.audio.play(d.sound, { vol: d.suppressed ? 0.6 : 1, reverb: d.suppressed ? 0.1 : 0.4 });
    game.enemies.hearNoise(p.pos.x, p.pos.y, p.pos.z, d.suppressed ? 9 : d.proj === 'arrow' ? 3 : d.proj === 'flame' ? 30 : 62, true);
    // Flash, smoke, brass
    const mw = this.rig.muzzleWorld(this.v2);
    if (d.proj === 'bullet' || d.proj === 'rocket' || d.proj === 'grenade' || d.proj === 'flare') {
      const power = d.suppressed ? 0 : clamp(0.55 + d.energy / 4000, 0.6, 1.9);
      if (power > 0 && !this.scoped) this.rig.flashNow(power);
      if (power > 0) game.fx.playerFlash(mw.x, mw.y, mw.z, power);
      game.fx.muzzle(mw.x, mw.y, mw.z, this.dir.x, this.dir.y, this.dir.z, d.proj === 'rocket' ? 2.4 : power * 0.7 + 0.3, true);
    }
    if (d.proj === 'flame') game.fx.flame(mw.x, mw.y, mw.z, this.dir.x * d.mv + p.vel.x, this.dir.y * d.mv, this.dir.z * d.mv + p.vel.z);
    const selfLoading = d.cycle === 0 && d.feed !== 'cyl' && d.feed !== 'gate' && d.feed !== 'single' && d.feed !== 'double';
    if (bullet && selfLoading) this.ejectCasing();
    if (d.feed === 'enbloc' && g.mag === 0) game.audio.play('ping', { vol: 0.8, delay: 0.05 });
    if (d.proj === 'arrow') this.rig.hideMag(true);
    // Manual actions must be worked before the next shot.
    if (d.cycle > 0 && g.mag > 0) {
      this.busy = 'cycle';
      this.busyT = this.busyDur = d.cycle;
      this.rackDone = false;
      this.rig.startCycle(d.cycle);
    }
    if (this.burstLeft > 0) this.burstLeft--;
    if (g.mag <= 0) {
      this.burstLeft = 0;
      this.autoReload = d.cycle > 0 ? 0.5 : 0.3;
    }
    game.events.emit('ammo', undefined);
  }

  private ejectCasing(): void {
    const game = this.game;
    const d = this.gun.def;
    const e = this.rig.ejectWorld(this.v2);
    const p = game.player;
    game.fx.casing(e.x, e.y, e.z, this.right.x * rand(1.8, 3.2) + p.vel.x, rand(1.4, 2.6), this.right.z * rand(1.8, 3.2) + p.vel.z, d.pellets > 1 || d.energy > 5000);
    game.audio.playLimited('casing', 0.16, { vol: 0.3, delay: 0.4 });
  }

  private meleeStrike(): void {
    const game = this.game;
    const p = game.player;
    const m = this.melee;
    this.basis();
    let done = false;
    for (const off of [0, -0.22, 0.22]) {
      const dx = this.dir.x + this.right.x * off;
      const dy = this.dir.y;
      const dz = this.dir.z + this.right.z * off;
      const l = Math.hypot(dx, dy, dz);
      const e = game.enemies.raycast(p.eye.x, p.eye.y, p.eye.z, dx / l, dy / l, dz / l, m.meleeRange, null, false);
      if (e && game.world.los(p.eye.x, p.eye.y, p.eye.z, p.eye.x + (dx / l) * e.t, p.eye.y + (dy / l) * e.t, p.eye.z + (dz / l) * e.t, F_BULLET)) {
        // An unaware target can be dropped silently.
        const stealth = e.enemy.state !== 'combat';
        const killed = e.enemy.damage(m.meleeDamage * (stealth ? 5 : 1) * (e.part === 'head' ? 1.5 : 1), e.part, p.pos.x, p.pos.z, true);
        game.fx.blood(e.enemy.pos.x, e.enemy.eyeY - 0.25, e.enemy.pos.z, this.dir.x, 0, this.dir.z);
        game.audio.play('hitFlesh', { vol: 1 });
        game.events.emit('hit', { kill: killed, head: false, dist: e.t });
        p.addShake(0.12);
        done = true;
        break;
      }
    }
    if (!done && game.world.raycast(p.eye.x, p.eye.y, p.eye.z, this.dir.x, this.dir.y, this.dir.z, m.meleeRange * 0.8, F_BULLET, this.hit)) {
      const h = this.hit;
      game.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.surf, 0.8, false);
      game.audio.impact(h.surf, h.x, h.y, h.z);
      game.enemies.hearNoise(h.x, h.y, h.z, 7, false);
    }
  }

  private releaseThrow(): void {
    const game = this.game;
    const p = game.player;
    const t = this.thrown;
    this.basis();
    const o = this.v.copy(p.eye).addScaledVector(this.dir, 0.45).addScaledVector(this.right, 0.2).addScaledVector(this.up, -0.08);
    const speed = t.throwKind === 'mine' ? 1 : t.throwKind === 'remote' ? 9 : 17;
    game.combat.throwItem(t, o.x, o.y, o.z, this.dir.x * speed + p.vel.x * 0.5, this.dir.y * speed + 2.6, this.dir.z * speed + p.vel.z * 0.5, true, null, Math.max(0, this.cookT));
    this.thrownCount--;
    this.cookT = -1;
    game.audio.play('swish', { vol: 0.7 });
    this.busyT = this.busyDur = 0.35;
    game.events.emit('ammo', undefined);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const game = this.game;
    const p = game.player;
    const g = this.gun;
    if (!g) return;
    const d = g.def;
    this.time += dt;
    this.cool -= dt;
    this.flameT -= dt;
    this.bloom = damp(this.bloom, 0, 5, dt);
    const usable = p.alive && game.state === 'playing';
    const fireDown = usable && input.down('fire');
    const firePressed = usable && input.pressed('fire');

    // ---- aiming
    if (store.settings.toggleAds) {
      if (usable && input.pressed('ads')) this.adsToggle = !this.adsToggle;
    } else this.adsToggle = usable && input.down('ads');
    const blocked = this.busy === 'switch' || this.busy === 'melee' || this.busy === 'throw' || p.healing > 0 || !p.alive || (this.busy === 'reload' && d.scoped);
    if (blocked && store.settings.toggleAds && this.busy !== 'reload') this.adsToggle = false;
    const wantAds = this.adsToggle && !blocked && d.slot === 'gun';
    if (wantAds || fireDown) p.noSprintT = 0.22;
    const rate = dt / Math.max(0.08, d.adsTime);
    this.ads = wantAds && !p.sprinting ? Math.min(1, this.ads + rate) : Math.max(0, this.ads - rate * 1.3);
    p.ads = this.ads;
    p.zoom = d.zoom;
    p.mobility = d.mobility;
    // Scope wobble; holding sprint holds your breath for a few seconds.
    if (d.scoped && this.ads > 0.6) {
      const steady = input.down('sprint') && this.breath > 0;
      this.breath = clamp(this.breath + (steady ? -dt : dt * 0.5), 0, 5);
      const amp = 0.0019 * (steady ? 0.12 : this.breath <= 0 ? 1.8 : 1) * (p.crouched ? 0.55 : 1) * (1 + p.speed * 0.6) * Math.min(1, d.zoom / 6);
      p.swayP = (Math.sin(this.time * 0.93) + Math.sin(this.time * 2.31) * 0.4) * amp;
      p.swayY = (Math.cos(this.time * 0.71) + Math.sin(this.time * 1.87) * 0.4) * amp * 1.2;
    } else {
      p.swayP = damp(p.swayP, 0, 8, dt);
      p.swayY = damp(p.swayY, 0, 8, dt);
      this.breath = Math.min(5, this.breath + dt);
    }

    // ---- busy states
    if (this.busy !== 'none') {
      this.busyT -= dt;
      const u = 1 - this.busyT / this.busyDur;
      if (this.busy === 'reload') {
        if (d.perRound > 0) {
          this.roundT -= dt;
          const full = g.mag >= d.mag || (g.reserve <= 0 && !store.settings.infiniteAmmo);
          if ((firePressed && g.mag > 0) || full) {
            // Finish: chamber a round if the gun was dry.
            if (this.roundsStartedEmpty && d.cycle > 0 && g.mag > 0) {
              this.busy = 'cycle';
              this.busyT = this.busyDur = d.cycle;
              this.rackDone = false;
              this.rig.startCycle(d.cycle);
            } else this.busy = 'none';
          } else if (this.roundT <= 0) {
            this.roundT = d.perRound;
            g.mag++;
            if (!store.settings.infiniteAmmo) g.reserve--;
            this.rig.roundIn();
            game.audio.play('shellIn', { vol: 0.7 });
            game.events.emit('ammo', undefined);
          }
        } else {
          if (!this.magInDone && u > 0.56) {
            this.magInDone = true;
            game.audio.play('magIn', { vol: 0.8 });
          }
          if (!this.rackDone && u > 0.82) {
            this.rackDone = true;
            game.audio.play(d.cls === 'mg' || d.sound === 'shotAmr' || d.sound === 'shotHmg' ? 'boltHeavy' : d.modes[0] === 'bolt' ? 'boltAction' : 'bolt', { vol: 0.75 });
          }
          if (this.busyT <= 0) {
            this.finishReload();
            this.rig.hideMag(false);
          }
        }
      } else if (this.busy === 'cycle') {
        if (!this.rackDone && u > 0.25) {
          this.rackDone = true;
          game.audio.play(d.modes[0] === 'pump' ? 'pump' : d.modes[0] === 'sa' ? 'click' : d.modes[0] === 'bolt' ? 'boltAction' : 'bolt', { vol: 0.8 });
          if (d.proj === 'bullet' && d.modes[0] !== 'sa') this.ejectCasing();
        }
        if (this.busyT <= 0) this.busy = 'none';
      } else if (this.busy === 'melee') {
        if (!this.meleeDone && u > 0.38) {
          this.meleeDone = true;
          this.meleeStrike();
        }
        if (this.busyT <= 0) this.busy = 'none';
      } else if (this.busy === 'throw') {
        if (this.cookT >= 0) {
          this.busyT = 1;
          this.cookT += dt;
          const cooks = this.thrown.throwKind === 'frag';
          const held = input.down('grenade') && cooks && this.cookT < this.thrown.fuse - 0.7;
          if (!held && this.cookT > 0.22) this.releaseThrow();
        } else if (this.busyT <= 0) this.busy = 'none';
      } else if (this.busyT <= 0) this.busy = 'none';
    }

    // ---- inputs that start actions
    if (usable) {
      if (input.pressed('primary')) this.requestSwitch(0);
      else if (input.pressed('secondary')) this.requestSwitch(1);
      else if (input.pressed('swap') || input.pressed('next') || input.pressed('prev')) this.requestSwitch(1 - this.cur);
      if (input.pressed('firemode') && d.modes.length > 1 && this.busy === 'none') {
        g.modeI = (g.modeI + 1) % d.modes.length;
        game.audio.play('click', { vol: 0.6 });
        game.events.emit('weapon', undefined);
      }
      if (input.pressed('reload')) this.tryReload();
      if (input.pressed('melee') && (this.busy === 'none' || this.busy === 'reload') && p.healing <= 0) {
        if (this.busy === 'reload') this.rig.cancelReload();
        this.busy = 'melee';
        this.busyT = this.busyDur = this.melee.meleeTime;
        this.meleeDone = false;
        this.rig.startMelee(this.melee.meleeTime);
        game.audio.play('swish', { vol: 0.8 });
      }
      if (input.pressed('grenade') && this.busy === 'none' && p.healing <= 0) {
        if (this.thrown.throwKind === 'remote' && game.combat.hasRemote()) {
          game.audio.play('beep', { vol: 0.8 });
          game.combat.detonateRemote();
        } else if (this.thrownCount > 0) {
          this.busy = 'throw';
          this.busyT = this.busyDur = 1;
          this.cookT = 0;
          game.audio.play('pin', { vol: 0.7 });
        } else game.audio.play('dry', { vol: 0.5 });
      }
    }
    if (this.autoReload >= 0 && this.busy === 'none') {
      this.autoReload -= dt;
      if (this.autoReload < 0) this.tryReload();
    }

    // ---- touch assist: fire when the sights are on a target
    if (store.settings.autoFire && input.device === 'touch' && usable) {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = 0.08;
        p.viewDir(this.dir);
        const reach = Math.min(d.range * 1.2, 140);
        const e = game.enemies.raycast(p.eye.x, p.eye.y, p.eye.z, this.dir.x, this.dir.y, this.dir.z, reach, null, false);
        this.autoOn = !!e && game.world.los(p.eye.x, p.eye.y, p.eye.z, e.enemy.pos.x, e.enemy.eyeY - 0.3, e.enemy.pos.z, F_BULLET);
      }
    } else this.autoOn = false;

    // ---- trigger
    const mode = d.modes[g.modeI];
    let want = false;
    if (mode === 'auto') want = fireDown || this.autoOn;
    else {
      this.semiT -= dt;
      const press = firePressed || (this.autoOn && this.semiT <= 0);
      if (press) {
        want = true;
        this.semiT = Math.max(0.16, 75 / d.rpm);
        if (mode === 'burst3') this.burstLeft = Math.max(this.burstLeft, 3);
        else if (mode === 'burst2') this.burstLeft = Math.max(this.burstLeft, 2);
      }
    }
    if (this.burstLeft > 0) want = true;
    if (d.spin > 0) {
      const spinUp = fireDown || wantAds || this.autoOn;
      this.spin = clamp(this.spin + (spinUp ? dt / d.spin : -dt / 1.2), 0, 1);
      if (this.spin < 1) want = false;
    }
    const ready = usable && this.busy === 'none' && this.cool <= 0 && p.healing <= 0 && !p.sprinting && d.slot === 'gun';
    if (want && ready) {
      if (g.mag <= 0) {
        this.burstLeft = 0;
        if (firePressed) {
          game.audio.play('dry', { vol: 0.7 });
          this.tryReload();
        }
      } else if (d.draw > 0) {
        if (this.drawT < 0) {
          this.drawT = 0;
          game.audio.play('draw', { vol: 0.5, rate: 0.8 });
        }
      } else this.shoot();
    }
    if (this.drawT >= 0) {
      this.drawT += dt;
      if (this.drawT >= d.draw) {
        this.drawT = -1;
        if (g.mag > 0 && this.busy === 'none') this.shoot();
      }
    }

    // ---- rig
    this.rig.update(dt, {
      ads: this.ads,
      sprint: p.sprinting,
      bobX: p.bobX,
      bobY: p.bobY,
      lookX: p.lookDX,
      lookY: p.lookDY,
      lowered: p.healing > 0 || this.busy === 'melee' || this.busy === 'throw' || !p.alive ? 1 : 0,
      spin: this.spin,
      crouch: p.crouchT,
    });
  }

  dispose(): void {
    for (const g of this.guns) disposeWeaponModel(g.model);
    this.guns = [];
    this.rig.dispose();
  }
}
