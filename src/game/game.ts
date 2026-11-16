// Game orchestrator: owns the simulation, loads / unloads chapters and tracks campaign progress.

import * as THREE from 'three';
import { audio } from '../core/audio';
import type { Engine } from '../core/engine';
import { Emitter, type GameEvents } from '../core/events';
import { input } from '../core/input';
import { clamp, damp } from '../core/math';
import { store, type Checkpoint } from '../core/settings';
import { FX } from '../gfx/fx';
import { disposeTextures } from '../gfx/textures';
import { LevelBuilder } from '../world/builder';
import { World } from '../world/collision';
import { NavGrid } from '../world/navgrid';
import type { ChapterDef } from './campaign/types';
import { Combat } from './combat';
import { EnemyManager } from './enemies/manager';
import { disposeSoldierAssets, type Enemy } from './enemies/soldier';
import { LevelRuntime } from './level';
import { Mission } from './mission';
import { Player } from './player';
import { PlayerWeapons } from './weapons/system';

export type GameState = 'menu' | 'loading' | 'playing' | 'paused' | 'dead' | 'failed' | 'complete';

export interface ChapterResult {
  chapter: ChapterDef;
  time: number;
  accuracy: number;
  kills: number;
  headshots: number;
  deaths: number;
  grade: string;
  best: boolean;
}

interface Later {
  t: number;
  fn: () => void;
}

/** Nav resolution: fine enough that a 1.3 m doorway always contains a walkable cell. */
export const NAV_CELL = 0.6;
export const NAV_RADIUS = 0.3;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class Game {
  readonly audio = audio;
  readonly events = new Emitter<GameEvents>();
  readonly fx: FX;
  readonly combat: Combat;
  readonly enemies: EnemyManager;
  readonly player: Player;
  readonly weapons: PlayerWeapons;
  world = new World();
  nav = new NavGrid(this.world, -1, -1, 1, 1);
  level: LevelRuntime | null = null;
  mission: Mission | null = null;
  chapter: ChapterDef | null = null;
  state: GameState = 'menu';
  stats = { shots: 0, hits: 0, kills: 0, headshots: 0, deaths: 0 };
  /** Seconds played in the current chapter attempt. */
  time = 0;
  visibility = 1;
  result: ChapterResult | null = null;
  failReason = '';
  /** UI hooks */
  onState: (s: GameState) => void = () => {};
  onArmory: () => void = () => {};
  onProgress: (label: string, fraction: number) => void = () => {};

  private later: Later[] = [];
  private pristine = false;
  private orbit = 0;
  private musicT = 0;
  private heartT = 0;
  private hurt = 0;
  private threatT = 0;
  private threat = { x: 0, z: 0, d: 0 };
  private deadT = 0;
  private wasLocked = false;
  private loading = false;
  private v = new THREE.Vector3();

  constructor(readonly engine: Engine) {
    this.fx = new FX(engine);
    this.combat = new Combat(this);
    this.enemies = new EnemyManager(this);
    this.player = new Player(this);
    this.weapons = new PlayerWeapons(this);
    engine.scene.add(this.fx.group, this.combat.group, this.enemies.group);
    this.weapons.setLoadout(store.progress.loadout);
    this.weapons.rig.setVisible(false);
    this.events.on('damage', (d) => {
      this.hurt = Math.min(1, this.hurt + d.amount / 28);
    });
    input.onLockChange = (locked) => {
      if (locked) this.wasLocked = true;
      else if (this.wasLocked && this.state === 'playing') this.pause();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    engine.onFrame = (dt) => this.frame(dt);
  }

  // ------------------------------------------------------------------ small services

  /** Game-time timer (does not advance while paused). */
  after(seconds: number, fn: () => void): void {
    this.later.push({ t: seconds, fn });
  }

  requestArmory(): void {
    this.onArmory();
  }

  private setState(s: GameState): void {
    this.state = s;
    const playing = s === 'playing';
    input.enabled = playing;
    if (!playing) {
      input.reset();
      input.unlock();
    }
    this.weapons.rig.setVisible(playing || s === 'dead' || s === 'paused' || s === 'failed' || s === 'complete');
    this.events.emit('state', s);
    this.onState(s);
  }

  // ------------------------------------------------------------------ level lifecycle

  private unload(): void {
    this.enemies.clear();
    this.combat.clear();
    this.fx.clear();
    this.fx.setEmitters([]);
    this.later.length = 0;
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
    this.mission = null;
    this.engine.setLights([]);
    disposeSoldierAssets();
    disposeTextures();
  }

  private async build(def: ChapterDef): Promise<void> {
    const e = this.engine;
    this.onProgress('Clearing the area', 0.05);
    this.unload();
    await nextFrame();
    this.onProgress('Surveying terrain', 0.2);
    const b = new LevelBuilder(def.seed);
    def.build(b);
    this.world = b.world;
    this.fx.world = b.world;
    await nextFrame();
    this.onProgress('Plotting routes', 0.45);
    const bd = b.bounds;
    this.nav = new NavGrid(b.world, bd.minX, bd.minZ, bd.maxX, bd.maxZ, NAV_CELL, NAV_RADIUS);
    this.nav.build(b.navSeeds.length ? b.navSeeds : [[b.spawn.x, b.spawn.z]]);
    await nextFrame();
    this.onProgress('Setting the scene', 0.65);
    e.setEnv(def.env);
    this.visibility = def.visibility;
    this.level = new LevelRuntime(this, b);
    e.scene.add(this.level.group);
    e.setLights(b.lights);
    this.fx.setEmitters(b.emitters);
    this.fx.setWeather(def.env.weather, def.env.weatherAmount ?? 1);
    this.fx.setAmbient(def.env.hemiSky, def.env.hemiIntensity * 1.1 + (def.env.indoor ? 0 : def.env.sunIntensity * 0.25));
    audio.setReverb(def.env.reverb);
    audio.setAmbience(def.env.ambience.filter((a) => a !== 'battle'), def.env.ambience.includes('battle'));
    this.chapter = def;
    this.pristine = true;
    await nextFrame();
    this.onProgress('Ready', 1);
  }

  /** Loads a chapter purely as scenery for the menus. */
  async loadBackdrop(def: ChapterDef): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      if (this.chapter !== def || !this.pristine) await this.build(def);
      this.mission = null;
      this.enemies.clear();
      this.combat.clear();
      audio.startMusic('menu', (def.env.musicRoot ?? 38) + 12);
      this.setState('menu');
    } finally {
      this.loading = false;
    }
  }

  async startChapter(def: ChapterDef, fromCheckpoint = false): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.setState('loading');
      const cp = fromCheckpoint && store.progress.checkpoint?.chapter === def.id ? store.progress.checkpoint : null;
      if (this.chapter !== def || !this.pristine) await this.build(def);
      this.pristine = false;
      const lv = this.level as LevelRuntime;
      this.weapons.setLoadout(store.progress.loadout);
      const p = this.player;
      if (cp) {
        p.spawn(cp.x, cp.y, cp.z, cp.yaw);
        p.health = Math.max(cp.health, 60);
        p.armor = cp.armor;
        p.medkits = Math.max(cp.medkits, 1);
        this.time = cp.time;
        this.stats = { ...cp.stats };
      } else {
        const s = lv.builder.spawn;
        p.spawn(s.x, s.y, s.z, s.yaw);
        p.health = 100;
        p.armor = 0;
        p.medkits = 2;
        this.time = 0;
        this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, deaths: 0 };
        store.progress.checkpoint = null;
      }
      p.flashlightOn = false;
      this.result = null;
      this.failReason = '';
      this.hurt = 0;
      this.deadT = 0;
      this.mission = new Mission(this, def);
      this.mission.start(cp ? cp.stage : 0);
      audio.startMusic('game', def.env.musicRoot ?? 38);
      this.wasLocked = false;
      this.setState('playing');
      if (!cp) this.saveCheckpoint(0, true);
    } finally {
      this.loading = false;
    }
  }

  saveCheckpoint(stage: number, quiet = false): void {
    if (!this.chapter) return;
    const p = this.player;
    const cp: Checkpoint = {
      chapter: this.chapter.id, stage, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, health: p.health, armor: p.armor, medkits: p.medkits,
      grenades: this.weapons.thrownCount, time: this.time, stats: { ...this.stats },
    };
    store.progress.checkpoint = cp;
    store.saveProgress();
    if (!quiet) {
      this.events.emit('toast', { text: 'Checkpoint reached', kind: 'checkpoint' });
      audio.play('checkpoint', { vol: 0.6 });
    }
  }

  // ------------------------------------------------------------------ flow

  pause(): void {
    if (this.state === 'playing') this.setState('paused');
  }
  resume(): void {
    if (this.state !== 'paused') return;
    input.reset();
    this.setState('playing');
    input.lock();
  }
  async restartCheckpoint(): Promise<void> {
    if (this.chapter) await this.startChapter(this.chapter, true);
  }
  async restartChapter(): Promise<void> {
    if (this.chapter) await this.startChapter(this.chapter, false);
  }
  async quitToMenu(): Promise<void> {
    if (this.chapter) await this.loadBackdrop(this.chapter);
  }

  onPlayerDeath(): void {
    if (this.state !== 'playing') return;
    this.stats.deaths++;
    this.deadT = 0;
    audio.play('fail', { vol: 0.6, delay: 0.5 });
    audio.setIntensity(0);
    this.setState('dead');
  }

  onMissionFailed(reason: string): void {
    if (this.state !== 'playing') return;
    this.failReason = reason;
    this.stats.deaths++;
    audio.play('fail', { vol: 0.6 });
    this.setState('failed');
  }

  onChapterComplete(): void {
    const def = this.chapter;
    if (!def) return;
    const s = this.stats;
    const accuracy = s.shots > 0 ? clamp(s.hits / s.shots, 0, 1) : 0;
    const score = 100 - s.deaths * 12 - Math.max(0, ((this.time - def.par) / def.par) * 40) + (accuracy - 0.3) * 40 + (s.kills > 0 ? (s.headshots / s.kills) * 15 : 0);
    const grade = score >= 95 ? 'S' : score >= 80 ? 'A' : score >= 62 ? 'B' : score >= 45 ? 'C' : 'D';
    const pr = store.progress;
    const prev = pr.chapters[def.id];
    const order = 'DCBAS';
    const best = !prev || !prev.done || order.indexOf(grade) > order.indexOf(prev.bestGrade) || this.time < prev.bestTime;
    pr.chapters[def.id] = {
      done: true,
      bestTime: prev?.done ? Math.min(prev.bestTime, this.time) : this.time,
      bestGrade: prev?.done && order.indexOf(prev.bestGrade) > order.indexOf(grade) ? prev.bestGrade : grade,
      bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, accuracy),
    };
    pr.unlocked = Math.max(pr.unlocked, def.n + 1);
    pr.checkpoint = null;
    pr.totals.kills += s.kills;
    pr.totals.headshots += s.headshots;
    pr.totals.shots += s.shots;
    pr.totals.playSeconds += this.time;
    store.saveProgress();
    this.result = { chapter: def, time: this.time, accuracy, kills: s.kills, headshots: s.headshots, deaths: s.deaths, grade, best };
    audio.setIntensity(0);
    audio.play('objective', { vol: 0.9 });
    this.after(1.6, () => this.setState('complete'));
  }

  onEnemyKilled(e: Enemy): void {
    this.stats.kills++;
    // Battlefield pickups keep a fight going without a HUD shop.
    const r = Math.random();
    const kind = r < 0.36 ? 'ammo' : r < 0.44 ? 'medkit' : r < 0.49 ? 'armor' : r < 0.55 ? 'grenade' : null;
    if (kind && this.level) this.level.spawnPickup(kind, e.pos.x + (Math.random() - 0.5), this.nav.heightAt(e.pos.x, e.pos.z), e.pos.z + (Math.random() - 0.5));
  }
  onNearMiss(): void {
    this.player.addShake(0.05);
  }
  onEnemyGrenade(_x: number, _y: number, _z: number): void {
    this.threatT = 0;
  }
  onCombatStart(_e: Enemy): void {
    this.musicT = 0;
  }
  onCombatEnd(): void {
    this.musicT = 0;
  }

  // ------------------------------------------------------------------ frame

  private frame(dt: number): void {
    input.update(dt);
    audio.update(dt);
    const cam = this.engine.camera;
    if (this.state === 'playing') {
      if (input.pressed('pause')) this.pause();
      else this.simulate(dt);
    } else if (this.state === 'dead' || this.state === 'failed' || this.state === 'complete') {
      // Let the world settle for a moment in slow motion behind the result screen.
      this.deadT += dt;
      if (this.deadT < 4) this.simulate(dt * 0.45);
    } else if (this.state === 'menu') {
      this.menuCamera(dt);
      this.level?.meshes.update(this.engine.time);
      this.fx.update(dt);
    }
    cam.updateMatrixWorld();
    cam.getWorldDirection(this.v);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.v.x, this.v.y, this.v.z);
  }

  private simulate(dt: number): void {
    const p = this.player;
    if (this.state === 'playing') this.time += dt;
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) {
        this.later.splice(i, 1);
        l.fn();
      }
    }
    p.update(dt);
    this.engine.camera.updateMatrixWorld();
    this.weapons.update(dt);
    this.enemies.update(dt);
    this.combat.update(dt);
    this.level?.update(dt);
    if (this.state === 'playing') this.mission?.update(dt);
    this.fx.update(dt);

    // Score follows the fight.
    this.musicT -= dt;
    if (this.musicT <= 0) {
      this.musicT = 0.3;
      const f = this.enemies.fighting;
      audio.setIntensity(!p.alive ? 0 : f > 0 ? Math.min(1, 0.72 + f * 0.05) : this.enemies.suspicious > 0 ? 0.42 : 0.1);
    }
    if (p.alive && p.health < 32) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.85;
        audio.play('heartbeat', { vol: clamp((40 - p.health) / 30, 0.3, 1) });
      }
    }
    const gun = this.weapons.gun;
    this.engine.setClarity(gun ? this.weapons.scopeBlend * clamp((gun.def.zoom - 1) / 3, 0.35, 1) : 0);
    this.hurt = damp(this.hurt, 0, 3.2, dt);
    this.engine.setAberration(this.hurt + (p.blind > 0 ? 0.6 : 0));
    this.threatT -= dt;
    if (this.threatT <= 0) {
      this.threatT = 0.08;
      if (this.combat.nearestThreat(p.pos.x, p.pos.y + 0.9, p.pos.z, this.threat)) {
        const ang = Math.atan2(this.threat.x - p.pos.x, this.threat.z - p.pos.z) - (p.yaw + Math.PI);
        this.events.emit('grenade', { angle: ang, dist: this.threat.d });
      } else this.events.emit('grenade', null);
    }
  }

  private menuCamera(dt: number): void {
    const def = this.chapter;
    if (!def) return;
    this.orbit += dt * 0.035;
    const c = def.menuCam;
    const cam = this.engine.camera;
    const a = c.sweep ? c.sweep[0] + Math.sin(this.orbit * 1.3) * c.sweep[1] : this.orbit + 0.6;
    cam.position.set(c.x + Math.cos(a) * c.r, c.y + Math.sin(this.orbit * 1.7) * 0.6, c.z + Math.sin(a) * c.r);
    cam.lookAt(c.x, c.y - c.r * 0.12, c.z);
    this.engine.setFov(46);
    this.engine.focus.set(c.x, 0, c.z);
  }

  /** Brightness the HUD uses for the damage vignette. */
  get hurtAmount(): number {
    return this.hurt;
  }
}
