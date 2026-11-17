// Mission flow: a chapter is an ordered list of stages (objectives). Each stage boundary is a
// checkpoint. Stage scripts use the small API on this class to spawn enemies, talk on the radio,
// open doors and so on.

import * as THREE from 'three';
import { lineKey } from '../core/audio';
import { formatTime } from '../core/math';
import type { ChapterDef, Cond, Spoken, StageDef } from './campaign/types';
import type { Game } from './game';

interface Timer {
  t: number;
  fn: () => void;
}
interface Watch {
  /** Fires when the player enters this zone... */
  zone?: string;
  /** ...or when this becomes true. */
  test?: () => boolean;
  fn: () => void;
}

/**
 * How a line reaches the player: over his own radio ('comms'), from an enemy channel being listened
 * in on ('net'), from a loudspeaker ('pa'), in his own voice ('self'), or out of the mouth of the
 * soldier with a given tag ('@rusk'), heard from wherever that soldier is standing.
 */
export type Via = 'comms' | 'net' | 'pa' | 'self' | `@${string}`;
/** How each speaker is heard unless a line says otherwise. */
const HEARD: Record<string, Via> = { KESTREL: 'self', RUSK: 'net' };
interface Line {
  who: string;
  text: string;
  at: number;
  /** The recording of this line, and how long it has been kept waiting for that recording to load. */
  key: string;
  held: number;
  via: Via;
}

export class Mission {
  stageI = -1;
  stage: StageDef | null = null;
  /** True while replaying earlier stages to restore a checkpoint: no sound, no spawns. */
  silent = false;
  private stageTime = 0;
  private timers: Timer[] = [];
  private watches: Watch[] = [];
  private used = new Set<string>();
  private destroyed = new Set<string>();
  private spawned = new Set<string>();
  private lines: Line[] = [];
  private lineBusy = 0;
  private lastLine = '';
  private voiceFrom = new THREE.Vector3();
  private met = new Set<string>();
  private clock = 0;
  private countdown: { label: string; t: number; fn: () => void; hurried?: boolean } | null = null;
  private lastNote = '';
  private noteT = 0;
  private marker = new THREE.Vector3();
  done = false;
  failed = false;

  constructor(private readonly game: Game, readonly chapter: ChapterDef) {}

  /** Begins at the given stage, silently replaying the lasting effects of everything before it. */
  start(stageIndex: number): void {
    const stages = this.chapter.stages;
    const idx = Math.max(0, Math.min(stageIndex, stages.length - 1));
    this.silent = true;
    this.chapter.setup?.(this);
    for (let i = 0; i < idx; i++) {
      this.applyDone(stages[i].done);
      stages[i].exit?.(this);
    }
    this.silent = false;
    this.timers.length = 0;
    this.watches.length = 0;
    this.enter(idx);
  }

  private applyDone(c: Cond): void {
    const lv = this.game.level;
    if (c.k === 'use') {
      this.used.add(c.id);
      lv?.completeInteract(c.id);
    } else if (c.k === 'destroy') {
      for (const id of c.ids) {
        this.destroyed.add(id);
        lv?.destroyProp(id, true);
      }
    } else if (c.k === 'all' || c.k === 'any') for (const s of c.of) this.applyDone(s);
  }

  private enter(i: number): void {
    this.stageI = i;
    this.stage = this.chapter.stages[i];
    this.stageTime = 0;
    this.timers.length = 0;
    this.watches.length = 0;
    this.lastNote = '';
    this.stage.enter?.(this);
    this.game.events.emit('objective', { text: this.stage.objective, note: this.note() });
  }

  // ------------------------------------------------------------------ script API

  /** True when the player has the squad along: a few lines of the story change to suit. */
  get squad(): boolean {
    return this.game.squad.list.length > 0;
  }

  radio(who: string, text: string, delay = 0, via: Via = HEARD[who] ?? 'comms'): void {
    if (this.silent) return;
    const key = lineKey(who, text);
    // Dialogue is fetched when it is about to be needed, not held in memory for the whole game.
    this.game.audio.prepare(key);
    // Someone speaking in person may be dead by the time the words come: note where he is now.
    const speaker = via.startsWith('@') ? this.game.enemies.byTag(via.slice(1)) : undefined;
    if (speaker) this.voiceFrom.set(speaker.pos.x, speaker.pos.y + 1.6, speaker.pos.z);
    this.lines.push({ who, text, at: this.clock + delay, key, held: 0, via });
    this.lines.sort((a, b) => a.at - b.at);
  }

  spawn(...groups: string[]): void {
    if (this.silent) return;
    const g = this.game;
    for (const group of groups) {
      if (this.spawned.has(group)) continue;
      this.spawned.add(group);
      for (const def of g.level?.builder.enemies ?? []) if (def.group === group) g.enemies.spawn(def);
    }
  }

  after(seconds: number, fn: () => void): void {
    if (this.silent) return;
    this.timers.push({ t: seconds, fn });
  }

  /** Speaks a line kept in a list (see `line` in campaign/types). */
  speak(l: Spoken, delay = 0, via?: Via): void {
    this.radio(l.who, l.text, delay, via);
  }

  /** Runs `fn` the first time the player enters a zone during this stage. */
  onZone(zone: string, fn: () => void): void {
    if (this.silent) return;
    this.watches.push({ zone, fn });
  }

  /** Runs `fn` once, the first time `test` is true during this stage. */
  when(test: () => boolean, fn: () => void): void {
    if (this.silent) return;
    this.watches.push({ test, fn });
  }

  /** Runs `fn` every `seconds` for the rest of this stage. */
  every(seconds: number, fn: () => void): void {
    this.after(seconds, () => {
      fn();
      this.every(seconds, fn);
    });
  }

  /** How much of his strength the soldier with this tag has left: 1 unhurt (or not yet arrived), 0 dead. */
  health(tag: string): number {
    const e = this.game.enemies.byTag(tag);
    if (e) this.met.add(tag);
    // Once dead he is cleared away, so "not there" means dead only for someone who has been seen.
    if (!e) return this.met.has(tag) ? 0 : 1;
    return e.alive ? Math.max(0, e.hp / e.arch.hp) : 0;
  }

  /** True while the soldier with this tag is alive and in the fight. */
  fighting(tag: string): boolean {
    const e = this.game.enemies.byTag(tag);
    return !!e && e.alive && e.state === 'combat';
  }

  /** True when nobody is waiting to speak. */
  get quiet(): boolean {
    return this.lines.length === 0 && this.lineBusy <= 0;
  }

  lights(group: string, on: boolean): void {
    this.game.engine.setLightGroup(group, on);
    this.game.level?.meshes.setGroup(group, on);
  }

  openDoor(id: string): void {
    this.game.level?.openDoor(id, this.silent);
  }

  destroyProp(id: string): void {
    this.game.level?.destroyProp(id, this.silent);
  }

  enable(id: string, on = true): void {
    this.game.level?.setInteract(id, on);
  }

  alert(...groups: string[]): void {
    if (this.silent) return;
    const p = this.game.player.pos;
    this.game.enemies.alertAll(groups.length ? groups : null, p.x, p.y, p.z);
  }

  toast(text: string): void {
    if (!this.silent) this.game.events.emit('toast', { text, kind: 'info' });
  }

  sound(name: string, zone?: string, vol = 1): void {
    if (this.silent) return;
    const v = this.marker;
    if (zone && this.game.level?.locate(zone, v)) this.game.audio.play(name, { x: v.x, y: v.y, z: v.z, ref: 25, vol });
    else this.game.audio.play(name, { vol });
  }

  explodeAt(zone: string, radius = 7, damage = 300): void {
    if (this.silent) return;
    const v = this.marker;
    if (this.game.level?.locate(zone, v)) this.game.combat.explode(v.x, v.y - 0.8, v.z, radius, damage, true);
  }

  /** Starts an on-screen countdown; `fn` runs if it reaches zero. */
  timer(label: string, seconds: number, fn: () => void): void {
    if (this.silent) return;
    this.countdown = { label, t: seconds, fn };
  }
  clearTimer(): void {
    this.countdown = null;
    this.game.events.emit('timer', null);
  }

  fail(reason: string): void {
    if (this.failed || this.done) return;
    this.failed = true;
    this.game.onMissionFailed(reason);
  }

  give(what: 'medkit' | 'armor' | 'ammo'): void {
    if (this.silent) return;
    const g = this.game;
    if (what === 'medkit') g.player.medkits = Math.min(4, g.player.medkits + 1);
    else if (what === 'armor') g.player.armor = Math.min(100, g.player.armor + 50);
    else g.weapons.resupply();
  }

  /** Number of living enemies in the given groups (all groups if none given). */
  remaining(...groups: string[]): number {
    return this.game.enemies.alive(groups.length ? groups : undefined);
  }

  // ------------------------------------------------------------------ notifications from the world

  onUsed(id: string): void {
    this.used.add(id);
  }
  onDestroyed(id: string): void {
    this.destroyed.add(id);
  }

  // ------------------------------------------------------------------ evaluation

  private test(c: Cond): boolean {
    const g = this.game;
    switch (c.k) {
      case 'reach':
        return !!g.level && g.level.inZone(c.zone, g.player.pos.x, g.player.pos.z);
      case 'kill':
        return c.groups.every((gr) => this.spawned.has(gr)) && g.enemies.alive(c.groups) === 0;
      case 'use':
        return this.used.has(c.id);
      case 'destroy':
        return c.ids.every((id) => this.destroyed.has(id));
      case 'survive':
        return this.stageTime >= c.seconds;
      case 'all':
        return c.of.every((s) => this.test(s));
      case 'any':
        return c.of.some((s) => this.test(s));
    }
  }

  private noteFor(c: Cond): string {
    const g = this.game;
    switch (c.k) {
      case 'kill': {
        const n = g.enemies.alive(c.groups);
        return n > 0 ? `${n} hostile${n === 1 ? '' : 's'} remaining` : '';
      }
      case 'destroy': {
        const n = c.ids.filter((id) => this.destroyed.has(id)).length;
        return c.ids.length > 1 ? `${n} / ${c.ids.length}` : '';
      }
      case 'survive':
        return formatTime(Math.max(0, c.seconds - this.stageTime));
      case 'all': {
        const parts = c.of.filter((s) => !this.test(s)).map((s) => this.noteFor(s)).filter(Boolean);
        const usesDone = c.of.filter((s) => s.k === 'use').length;
        if (usesDone > 1) return `${c.of.filter((s) => s.k === 'use' && this.test(s)).length} / ${usesDone}`;
        return parts[0] ?? '';
      }
      default:
        return '';
    }
  }

  note(): string {
    return this.stage ? this.noteFor(this.stage.done) : '';
  }

  /** Where the objective marker should point. Returns false if the stage has none. */
  markerPos(out: THREE.Vector3): boolean {
    const s = this.stage;
    const lv = this.game.level;
    if (!s || !lv) return false;
    if (s.marker) return lv.locate(s.marker, out);
    return this.autoMarker(s.done, out);
  }

  private autoMarker(c: Cond, out: THREE.Vector3): boolean {
    const lv = this.game.level;
    if (!lv) return false;
    if (c.k === 'reach') return lv.locate(c.zone, out);
    if (c.k === 'use') return !this.used.has(c.id) && lv.locate(c.id, out);
    if (c.k === 'destroy') {
      const id = c.ids.find((i) => !this.destroyed.has(i));
      return !!id && lv.locate(id, out);
    }
    if (c.k === 'all' || c.k === 'any') {
      for (const s of c.of) if (!this.test(s) && this.autoMarker(s, out)) return true;
    }
    return false;
  }

  update(dt: number): void {
    if (this.done || this.failed || !this.stage) return;
    const g = this.game;
    this.clock += dt;
    this.stageTime += dt;

    // Dialogue: one line at a time, each spoken aloud, the next waiting until it has been said.
    this.lineBusy -= dt;
    const due = this.lines[0];
    if (due && due.at <= this.clock && this.lineBusy <= 0) {
      // A recording still on its way gets a moment to arrive rather than the line going unspoken.
      if (g.audio.loading(due.key) && due.held < 1.5) due.held += dt;
      else {
        this.lines.shift();
        const via = due.via;
        let said = 0;
        if (via.startsWith('@')) {
          // Said in person: heard from where the speaker stands (or last stood).
          const e = g.enemies.byTag(via.slice(1));
          if (e) this.voiceFrom.set(e.pos.x, e.pos.y + 1.6, e.pos.z);
          said = g.audio.speak(due.key, { x: this.voiceFrom.x, y: this.voiceFrom.y, z: this.voiceFrom.z, ref: 34, vol: 1.3, reverb: 0.32 });
        } else if (via === 'self') {
          // Kestrel is the player: his own voice, heard directly.
          said = g.audio.speak(due.key, { vol: 0.85 });
        } else if (via === 'pa') {
          said = g.audio.speak(due.key, { radio: 'pa', vol: 1, reverb: 0.4 });
        } else {
          g.audio.play('radio', { vol: via === 'net' ? 0.45 : 0.7, bus: 'ui' });
          said = g.audio.speak(due.key, { radio: via === 'net' ? 'net' : 'comms', vol: 1, delay: 0.18 });
          if (said && via === 'comms') g.audio.play('radioEnd', { vol: 0.5, bus: 'ui', delay: 0.18 + said + 0.06 });
        }
        const read = 1.6 + due.text.length * 0.048;
        this.lineBusy = said ? said + 0.8 : read;
        g.events.emit('radio', { who: due.who, text: due.text, seconds: said ? said + 1 : 0 });
        if (this.lastLine) g.audio.release(this.lastLine);
        this.lastLine = due.key;
      }
    }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    if (g.level) {
      for (let i = this.watches.length - 1; i >= 0; i--) {
        const w = this.watches[i];
        if (w.test ? w.test() : g.level.inZone(w.zone as string, g.player.pos.x, g.player.pos.z)) {
          this.watches.splice(i, 1);
          w.fn();
        }
      }
    }
    if (this.countdown) {
      this.countdown.t -= dt;
      g.events.emit('timer', { label: this.countdown.label, seconds: this.countdown.t });
      if (this.countdown.t < 20 && !this.countdown.hurried) {
        this.countdown.hurried = true;
        g.audio.play('radio', { vol: 0.5, bus: 'ui' });
        g.audio.say(['hq_hurry'], { radio: true, bus: 'ui', vol: 1, delay: 0.18, steady: true });
      }
      if (this.countdown.t <= 0) {
        const fn = this.countdown.fn;
        this.countdown = null;
        g.events.emit('timer', null);
        fn();
        if (this.failed) return;
      }
    }

    this.noteT -= dt;
    if (this.noteT <= 0) {
      this.noteT = 0.25;
      const n = this.note();
      if (n !== this.lastNote) {
        this.lastNote = n;
        g.events.emit('objective', { text: this.stage.objective, note: n });
      }
    }

    if (this.test(this.stage.done)) {
      const finished = this.stage;
      finished.exit?.(this);
      const next = this.stageI + 1;
      if (next >= this.chapter.stages.length) {
        this.done = true;
        g.events.emit('objective', { text: finished.objective, note: '', done: true });
        g.onChapterComplete();
        return;
      }
      g.audio.play('objective', { vol: 0.7 });
      g.audio.play('radio', { vol: 0.5, delay: 0.3, bus: 'ui' });
      g.audio.say(['hq_objective'], { radio: true, bus: 'ui', vol: 0.95, delay: 0.48, steady: true });
      this.enter(next);
      g.saveCheckpoint(next);
    }
  }

  /** Developer / tester shortcut: completes the current objective immediately. */
  skipStage(): void {
    if (!this.stage || this.done) return;
    this.applyDone(this.stage.done);
    const force = (c: Cond): void => {
      if (c.k === 'kill') {
        for (const gr of c.groups) this.spawned.add(gr);
        for (const e of this.game.enemies.list) if (c.groups.includes(e.group)) e.damage(1e6, 'torso', e.pos.x, e.pos.z, false, true);
      } else if (c.k === 'reach') {
        const v = this.marker;
        if (this.game.level?.locate(c.zone, v)) this.game.player.pos.set(v.x, v.y - 1.2, v.z);
      } else if (c.k === 'survive') this.stageTime = c.seconds;
      else if (c.k === 'all' || c.k === 'any') c.of.forEach(force);
    };
    force(this.stage.done);
  }
}
