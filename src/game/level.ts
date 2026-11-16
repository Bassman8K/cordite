// Runtime side of a built level: destructible props, doors, pickups and interactables.

import * as THREE from 'three';
import { input } from '../core/input';
import { rand } from '../core/math';
import { buildLevelMeshes, type LevelMeshes } from '../gfx/levelmesh';
import { MaterialLib } from '../gfx/materials';
import type { InteractDef, LevelBuilder, PickupDef, PropDef, ZoneDef } from '../world/builder';
import type { Game } from './game';

interface PropState {
  def: PropDef;
  hp: number;
  alive: boolean;
}
interface Pickup {
  kind: PickupDef['kind'];
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  t: number;
}
export interface InteractState {
  def: InteractDef;
  enabled: boolean;
  done: boolean;
  progress: number;
}

const PICK_COLOR: Record<PickupDef['kind'], number> = { ammo: 0x6f7d3a, medkit: 0xd8dde0, armor: 0x3c5a78, grenade: 0x4a5a3a };
const PICK_GLOW: Record<PickupDef['kind'], number> = { ammo: 0x554400, medkit: 0x551010, armor: 0x103050, grenade: 0x304010 };

export class LevelRuntime {
  readonly meshes: LevelMeshes;
  readonly lib: MaterialLib;
  readonly group = new THREE.Group();
  private props = new Map<string, PropState>();
  private pickups: Pickup[] = [];
  readonly interacts: InteractState[] = [];
  readonly zones: Map<string, ZoneDef>;
  private pickGeo = { ammo: new THREE.BoxGeometry(0.34, 0.2, 0.22), medkit: new THREE.BoxGeometry(0.3, 0.2, 0.2), armor: new THREE.BoxGeometry(0.36, 0.42, 0.14), grenade: new THREE.SphereGeometry(0.1, 8, 6) };
  private pickMat = new Map<string, THREE.MeshStandardMaterial>();
  private chargeGeo = new THREE.BoxGeometry(0.22, 0.09, 0.14);
  private chargeMat = new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.8, emissive: 0x330000 });
  private charges: THREE.Mesh[] = [];
  private fires: Array<{ x: number; y: number; z: number; t: number; size: number }> = [];
  /** Interactable currently in reach (HUD prompt). */
  focus: InteractState | null = null;
  private time = 0;

  constructor(private readonly game: Game, readonly builder: LevelBuilder) {
    const e = game.engine;
    const env = e.env;
    this.lib = new MaterialLib(e.tier.pbr);
    this.meshes = buildLevelMeshes(
      builder,
      this.lib,
      {
        deep: 0x06141c,
        sky: env?.skyHorizon ?? 0x8899aa,
        sunDir: new THREE.Vector3(...(env?.sunDir ?? [0.3, 1, 0.2])).normalize(),
        sunColor: env?.sunColor ?? 0xffffff,
        fogColor: env?.fogColor ?? 0x889099,
        fogDensity: env?.fogDensity ?? 0.01,
      },
      e.shadowsOn,
      () => e.height,
    );
    this.group.add(this.meshes.group);
    this.zones = builder.zones;
    for (const p of builder.props) this.props.set(p.id, { def: p, hp: p.hp, alive: true });
    for (const i of builder.interacts) this.interacts.push({ def: i, enabled: i.enabled, done: false, progress: 0 });
    for (const p of builder.pickups) this.spawnPickup(p.kind, p.x, p.y, p.z);
  }

  // ------------------------------------------------------------------ zones

  inZone(id: string, x: number, z: number): boolean {
    const zn = this.zones.get(id);
    if (!zn) return false;
    if (zn.hw !== undefined && zn.hd !== undefined) return Math.abs(x - zn.x) <= zn.hw && Math.abs(z - zn.z) <= zn.hd;
    return Math.hypot(x - zn.x, z - zn.z) <= zn.r;
  }

  /** World position of a zone, interactable or prop (for HUD markers). */
  locate(id: string, out: THREE.Vector3): boolean {
    const zn = this.zones.get(id);
    if (zn) {
      out.set(zn.x, (zn.y ?? 0) + 1.2, zn.z);
      return true;
    }
    const it = this.interacts.find((i) => i.def.id === id);
    if (it) {
      out.set(it.def.x, it.def.y + 0.3, it.def.z);
      return true;
    }
    const pr = this.props.get(id);
    if (pr) {
      out.set(pr.def.x, pr.def.y + 0.5, pr.def.z);
      return true;
    }
    const e = this.game.enemies.byTag(id);
    if (e) {
      out.set(e.pos.x, e.pos.y + 2.1, e.pos.z);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ props

  propAlive(id: string): boolean {
    return this.props.get(id)?.alive ?? false;
  }

  damageProp(def: PropDef, dmg: number): void {
    const st = this.props.get(def.id);
    if (!st || !st.alive || def.kind === 'door') return;
    st.hp -= dmg;
    if (st.hp <= 0) this.destroyProp(def.id, false);
  }

  damagePropsNear(x: number, y: number, z: number, r: number, dmg: number): void {
    for (const st of this.props.values()) {
      if (!st.alive || st.def.kind === 'door') continue;
      const d = Math.hypot(st.def.x - x, st.def.y - y, st.def.z - z);
      if (d < r + 1) {
        st.hp -= dmg * Math.max(0.15, 1 - d / (r + 1));
        if (st.hp <= 0) this.destroyProp(st.def.id, false);
      }
    }
  }

  destroyProp(id: string, silent: boolean): void {
    const st = this.props.get(id);
    if (!st || !st.alive) return;
    st.alive = false;
    const g = this.game;
    for (const s of st.def.solids) g.world.remove(s);
    for (const m of this.meshes.props.get(id) ?? []) m.visible = false;
    if (!silent) {
      if (st.def.blast > 0) {
        // Deferred a frame so chained barrels cook off in sequence rather than recursing.
        const d = st.def;
        g.after(0.05 + Math.random() * 0.12, () => g.combat.explode(d.x, d.y, d.z, d.blast, 260, true, { fire: d.blast > 8 }));
        if (d.blast > 8) this.fires.push({ x: d.x, y: d.y - 0.5, z: d.z, t: 25, size: 2.2 });
      } else if (st.def.kind === 'target') {
        g.fx.explosion(st.def.x, st.def.y, st.def.z, 3);
        g.audio.play('explosion', { x: st.def.x, y: st.def.y, z: st.def.z, ref: 20, vol: 0.7 });
      }
    }
    g.mission?.onDestroyed(id);
  }

  openDoor(id: string, silent = false): void {
    const st = this.props.get(id);
    if (!st || !st.alive) return;
    st.alive = false;
    for (const s of st.def.solids) this.game.world.remove(s);
    for (const m of this.meshes.props.get(id) ?? []) m.visible = false;
    if (!silent) this.game.audio.play('bolt', { x: st.def.x, y: st.def.y, z: st.def.z, ref: 6, rate: 0.6 });
  }

  // ------------------------------------------------------------------ pickups

  spawnPickup(kind: PickupDef['kind'], x: number, y: number, z: number): void {
    let mat = this.pickMat.get(kind);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: PICK_COLOR[kind], roughness: 0.6, metalness: 0.2, emissive: PICK_GLOW[kind], emissiveIntensity: 1.4 });
      this.pickMat.set(kind, mat);
    }
    const mesh = new THREE.Mesh(this.pickGeo[kind], mat);
    mesh.position.set(x, y + 0.3, z);
    this.group.add(mesh);
    this.pickups.push({ kind, mesh, x, y, z, t: rand(0, 6) });
  }

  // ------------------------------------------------------------------ interactables

  setInteract(id: string, enabled: boolean): void {
    const it = this.interacts.find((i) => i.def.id === id);
    if (it) it.enabled = enabled;
  }

  /** Marks an interactable as already used (when loading a later checkpoint). */
  completeInteract(id: string): void {
    const it = this.interacts.find((i) => i.def.id === id);
    if (!it || it.done) return;
    it.done = true;
    if (it.def.kind === 'plant') this.placeCharge(it.def);
  }

  private placeCharge(d: InteractDef): void {
    const m = new THREE.Mesh(this.chargeGeo, this.chargeMat);
    m.position.set(d.x, d.y, d.z);
    this.group.add(m);
    this.charges.push(m);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    this.time += dt;
    this.meshes.update(g.engine.time);

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.mesh.rotation.y = pk.t * 1.4;
      pk.mesh.position.y = pk.y + 0.32 + Math.sin(pk.t * 2.2) * 0.05;
      if (!p.alive || Math.hypot(pk.x - p.pos.x, pk.z - p.pos.z) > 1.25 || Math.abs(pk.y - p.pos.y) > 1.8) continue;
      let taken = true;
      if (pk.kind === 'ammo') {
        g.weapons.addAmmo();
        g.events.emit('toast', { text: 'Ammunition', kind: 'pickup' });
        g.audio.play('ammo', { vol: 0.8 });
      } else if (pk.kind === 'medkit') {
        if (p.medkits < 4) {
          p.medkits++;
          g.events.emit('toast', { text: 'Medkit', kind: 'pickup' });
          g.audio.play('pickup');
        } else taken = false;
      } else if (pk.kind === 'armor') {
        if (p.armor < 100) {
          p.armor = Math.min(100, p.armor + 50);
          g.events.emit('toast', { text: 'Body armour', kind: 'pickup' });
          g.audio.play('pickup', { rate: 0.8 });
        } else taken = false;
      } else if (g.weapons.addThrown(1)) {
        g.events.emit('toast', { text: g.weapons.thrown.name, kind: 'pickup' });
        g.audio.play('pickup', { rate: 1.2 });
      } else taken = false;
      if (taken) {
        this.group.remove(pk.mesh);
        this.pickups.splice(i, 1);
      }
    }

    // Nearest usable interactable in front of the player.
    let best: InteractState | null = null;
    let bestD = Infinity;
    if (p.alive) {
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      for (const it of this.interacts) {
        if (!it.enabled || it.done) continue;
        const dx = it.def.x - p.pos.x;
        const dz = it.def.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > it.def.radius || Math.abs(it.def.y - (p.pos.y + 1)) > 2.2) continue;
        if (d > 0.6 && (dx * fx + dz * fz) / d < 0.2) continue;
        if (d < bestD) {
          bestD = d;
          best = it;
        }
      }
    }
    if (best !== this.focus) {
      if (this.focus) this.focus.progress = 0;
      this.focus = best;
    }
    if (best) {
      if (input.down('interact')) {
        best.progress += dt / Math.max(0.05, best.def.hold);
        if (best.progress >= 1) this.use(best);
      } else best.progress = Math.max(0, best.progress - dt * 2);
      g.events.emit('prompt', this.focus ? { text: best.def.label, progress: best.progress } : null);
    } else g.events.emit('prompt', null);

    // Charges blink; wreckage burns for a while.
    this.chargeMat.emissiveIntensity = Math.sin(this.time * 9) > 0.6 ? 6 : 0.4;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (Math.random() < dt * 22) g.fx.fire(f.x + rand(-1, 1) * f.size * 0.5, f.y, f.z + rand(-1, 1) * f.size * 0.5, f.size * 0.6);
      if (f.t <= 0) this.fires.splice(i, 1);
    }
  }

  private use(it: InteractState): void {
    const g = this.game;
    it.progress = 0;
    this.focus = null;
    g.events.emit('prompt', null);
    if (it.def.kind === 'resupply') {
      g.weapons.resupply();
      g.player.medkits = Math.max(g.player.medkits, 3);
      g.player.armor = Math.max(g.player.armor, 50);
      g.audio.play('ammo');
      g.events.emit('toast', { text: 'Resupplied', kind: 'pickup' });
      g.requestArmory();
      return;
    }
    it.done = true;
    if (it.def.kind === 'plant') {
      this.placeCharge(it.def);
      g.audio.play('plant');
    } else g.audio.play(it.def.kind === 'terminal' ? 'uiConfirm' : 'pickup');
    g.mission?.onUsed(it.def.id);
  }

  dispose(): void {
    this.meshes.dispose();
    this.lib.dispose();
    for (const g of Object.values(this.pickGeo)) g.dispose();
    for (const m of this.pickMat.values()) m.dispose();
    this.chargeGeo.dispose();
    this.chargeMat.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
