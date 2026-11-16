// First-person weapon rig. Everything here is procedural animation layered on the weapon model:
// sway, bob, recoil, aiming down sights, reloads, bolt/pump cycling, weapon swaps and melee.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Engine } from '../../core/engine';
import { clamp, damp, DEG, lerp, rand, smoothstep } from '../../core/math';
import { makeSprite } from '../../gfx/textures';
import { buildWeaponModel, disposeWeaponModel, WEAPON_MATERIALS, type WeaponModel } from './model';
import type { WeaponDef } from './types';

const SHOULDER = new Set(['tube', 'rpg', 'pzf', 'm202', 'piat']);
const bump = (u: number, a: number, b: number) => smoothstep(a, (a + b) / 2, u) * (1 - smoothstep((a + b) / 2, b, u));

export interface RigInput {
  ads: number;
  sprint: boolean;
  bobX: number;
  bobY: number;
  /** Look delta this frame, radians. */
  lookX: number;
  lookY: number;
  /** 0..1: weapon dropped out of view (healing, throwing, melee). */
  lowered: number;
  spin: number;
  crouch: number;
}

function makeArm(left: boolean): THREE.Group {
  const g = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.36, 3, 8).rotateX(Math.PI / 2).translate(0, 0, 0.27), WEAPON_MATERIALS.cloth);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.05, 8).rotateX(Math.PI / 2).translate(0, 0, 0.09), WEAPON_MATERIALS.rubber);
  const hand = new THREE.Mesh(new RoundedBoxGeometry(0.088, 0.062, 0.115, 2, 0.02).translate(0, 0, 0.015), WEAPON_MATERIALS.skin);
  const thumb = new THREE.Mesh(new RoundedBoxGeometry(0.026, 0.03, 0.07, 1, 0.01).translate(left ? 0.05 : -0.05, 0.012, -0.01), WEAPON_MATERIALS.skin);
  g.add(fore, cuff, hand, thumb);
  return g;
}

export class ViewModel {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private holder = new THREE.Group();
  private armR = makeArm(false);
  private armL = makeArm(true);
  private flash = new THREE.Group();
  private flashMat: THREE.MeshBasicMaterial;
  private flashTex: THREE.Texture;
  private meleeHolder = new THREE.Group();
  private meleeModel: WeaponModel | null = null;
  private meleeArm = makeArm(false);
  model: WeaponModel | null = null;
  def: WeaponDef | null = null;

  private hip = new THREE.Vector3();
  private adsPos = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private rot = new THREE.Euler();
  private swX = 0;
  private swY = 0;
  private sprintT = 0;
  private recoilZ = 0;
  private recoilP = 0;
  private recoilR = 0;
  private recoilY = 0;
  private slide = 0;
  private reloadT = -1;
  private reloadDur = 1;
  private reloadEmpty = false;
  private roundT = -1;
  private cycleT = -1;
  private cycleDur = 1;
  private switchT = -1;
  private switchDur = 0.5;
  private onSwap: (() => void) | null = null;
  private low = 0;
  private meleeT = -1;
  private meleeDur = 0.4;
  private flashT = 0;
  private time = 0;
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(private readonly engine: Engine) {
    this.root.add(this.pivot, this.meleeHolder);
    this.pivot.add(this.holder, this.armR, this.armL);
    this.flashTex = makeSprite('flash', 128);
    this.flashMat = new THREE.MeshBasicMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(3.2, 2.4, 1.4), fog: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), this.flashMat);
    const sideA = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.55).rotateX(Math.PI / 2).translate(0, 0, -0.26), this.flashMat);
    const sideB = sideA.clone();
    sideB.rotation.z = Math.PI / 2;
    this.flash.add(face, sideA, sideB);
    this.flash.visible = false;
    this.holder.add(this.flash);
    this.meleeHolder.visible = false;
    this.meleeHolder.add(this.meleeArm);
    engine.vmScene.add(this.root);
  }

  setWeapon(def: WeaponDef, model: WeaponModel): void {
    if (this.model) this.holder.remove(this.model.group);
    this.def = def;
    this.model = model;
    this.holder.add(model.group);
    const style = def.look.style;
    if (style === 'pistol' || style === 'revolver') this.hip.set(0.1, -0.115, -0.46);
    else if (SHOULDER.has(style)) this.hip.set(0.2, -0.22, -0.16);
    else if (style === 'minigun') this.hip.set(0.14, -0.3, -0.42);
    else if (style === 'bow') this.hip.set(0.02, -0.07, -0.52);
    else this.hip.set(0.135, -0.172, Math.min(-0.34, -0.04 - model.rear));
    this.adsPos.set(-model.sight.x, -model.sight.y, -model.sight.z);
    this.flash.position.copy(model.muzzle);
    // Hands: firing hand on the grip, support hand under the forend.
    const hand = style === 'bow' ? new THREE.Vector3(0, 0, 0.11) : new THREE.Vector3(0, -0.062, 0.036);
    this.placeArm(this.armR, hand, style === 'bow' ? [0.3, -0.25, 0.9] : [0.2, -0.36, 0.91]);
    const twoHand = style === 'pistol' || style === 'revolver';
    this.placeArm(this.armL, this.tmpV.copy(model.gripL).add(new THREE.Vector3(twoHand ? -0.02 : 0, -0.022, 0)).clone(), twoHand ? [-0.5, -0.28, 0.82] : [-0.42, -0.4, 0.81]);
    this.armL.visible = def.slot === 'gun';
    this.reloadT = this.cycleT = this.roundT = -1;
    if (model.mag) {
      model.mag.position.set(0, 0, 0);
      model.mag.visible = true;
    }
    if (model.action) model.action.position.set(0, 0, 0);
  }

  private placeArm(arm: THREE.Group, at: THREE.Vector3, dir: [number, number, number]): void {
    arm.position.copy(at);
    this.tmpV.set(dir[0], dir[1], dir[2]).normalize();
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.tmpV);
  }

  setMelee(def: WeaponDef): void {
    if (this.meleeModel) {
      this.meleeHolder.remove(this.meleeModel.group);
      disposeWeaponModel(this.meleeModel);
    }
    this.meleeModel = buildWeaponModel(def, true);
    this.meleeHolder.add(this.meleeModel.group);
    this.placeArm(this.meleeArm, new THREE.Vector3(0, -0.01, 0.045), [0.25, -0.35, 0.9]);
  }

  // ------------------------------------------------------------------ triggers

  kick(def: WeaponDef, ads: number): void {
    const k = lerp(1, 0.55, ads);
    this.recoilZ += clamp(0.012 + def.recoil * 0.013, 0.012, 0.085) * k;
    this.recoilP += clamp(def.recoil * 0.014, 0.004, 0.11) * k;
    this.recoilR += rand(-1, 1) * clamp(def.recoil * 0.012, 0.004, 0.05) * k;
    this.recoilY += rand(-1, 1) * clamp(def.recoil * 0.006, 0.002, 0.03) * k;
    this.slide = 1;
  }

  flashNow(power: number): void {
    this.flashT = 0.045;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * 6.283;
    this.flash.scale.setScalar(power * rand(0.8, 1.2));
    this.engine.vmMuzzleLight.intensity = 5 * power;
    if (this.model) {
      this.holder.updateWorldMatrix(true, false);
      this.engine.vmMuzzleLight.position.copy(this.model.muzzle).applyMatrix4(this.holder.matrixWorld);
    }
  }

  startReload(duration: number, empty: boolean): void {
    this.reloadT = 0;
    this.reloadDur = duration;
    this.reloadEmpty = empty;
  }
  /** One shell / round pushed in during a tube or gate reload. */
  roundIn(): void {
    this.roundT = 0;
  }
  cancelReload(): void {
    this.reloadT = -1;
    this.roundT = -1;
    if (this.model?.mag) {
      this.model.mag.position.set(0, 0, 0);
      this.model.mag.visible = true;
    }
  }
  startCycle(duration: number): void {
    this.cycleT = 0;
    this.cycleDur = duration;
  }
  /** Lowers the weapon, calls `swap` at the bottom, then raises the new one. */
  startSwitch(duration: number, swap: () => void): void {
    this.switchT = 0;
    this.switchDur = duration;
    this.onSwap = swap;
    this.cancelReload();
  }
  startMelee(duration: number): void {
    this.meleeT = 0;
    this.meleeDur = duration;
  }
  hideMag(hidden: boolean): void {
    if (this.model?.mag) this.model.mag.visible = !hidden;
  }

  get switching(): boolean {
    return this.switchT >= 0;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, s: RigInput): void {
    const m = this.model;
    const def = this.def;
    if (!m || !def) return;
    this.time += dt;
    const ads = s.ads * s.ads * (3 - 2 * s.ads);
    const loose = 1 - ads * 0.82;
    const pos = this.pos.lerpVectors(this.hip, this.adsPos, ads);
    let rx = 0;
    let ry = 0;
    let rz = 0;

    // Weapon lags behind the view when turning.
    const inv = dt > 0 ? 1 / dt : 0;
    this.swX = damp(this.swX, clamp(s.lookX * inv * 0.011, -0.075, 0.075), 9, dt);
    this.swY = damp(this.swY, clamp(s.lookY * inv * 0.011, -0.06, 0.06), 9, dt);
    ry += this.swX * loose;
    rx += this.swY * loose;
    pos.x += this.swX * 0.22 * loose;
    pos.y -= this.swY * 0.18 * loose;
    rz += this.swX * 0.5 * loose;

    // Breathing and footsteps.
    pos.y += Math.sin(this.time * 1.7) * 0.0016 * loose;
    rx += Math.sin(this.time * 1.25) * 0.0035 * loose;
    pos.x += s.bobX * 0.75 * loose;
    pos.y -= s.bobY * 0.6 * loose;
    rz += s.bobX * 0.7 * loose;

    // Sprint: weapon swings across the body.
    this.sprintT = damp(this.sprintT, s.sprint ? 1 : 0, 9, dt);
    const sp = this.sprintT;
    if (sp > 0.001) {
      const pistol = def.cls === 'handgun';
      ry += (pistol ? 0.25 : 0.62) * sp;
      rx += (pistol ? 0.5 : -0.2) * sp;
      pos.x -= 0.05 * sp;
      pos.y -= (pistol ? 0.02 : 0.045) * sp;
      pos.z += 0.035 * sp;
    }
    pos.y -= s.crouch * 0.012 * loose;
    rz -= s.crouch * 0.05 * loose;

    // Recoil springs back.
    this.recoilZ = damp(this.recoilZ, 0, 13, dt);
    this.recoilP = damp(this.recoilP, 0, 11, dt);
    this.recoilR = damp(this.recoilR, 0, 10, dt);
    this.recoilY = damp(this.recoilY, 0, 10, dt);
    this.slide = damp(this.slide, 0, 30, dt);
    pos.z += this.recoilZ;
    pos.y += this.recoilP * 0.06;
    rx += this.recoilP;
    rz += this.recoilR;
    ry += this.recoilY;

    let actionZ = m.spins ? 0 : m.actionTravel * this.slide * (def.cycle > 0 ? 0 : 1);

    // Magazine reload
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      const u = Math.min(1, this.reloadT);
      const dip = smoothstep(0, 0.16, u) * (1 - smoothstep(0.84, 1, u));
      pos.y -= 0.05 * dip;
      pos.x -= 0.012 * dip;
      pos.z += 0.03 * dip;
      rz += 0.44 * dip;
      rx += 0.2 * dip;
      ry += 0.14 * dip;
      if (m.mag) {
        const out = smoothstep(0.12, 0.28, u) * (1 - smoothstep(0.5, 0.66, u));
        m.mag.position.set(0, -0.26 * out, 0.03 * out);
        m.mag.visible = !(u > 0.29 && u < 0.5);
        rx += bump(u, 0.6, 0.72) * 0.05;
      }
      if (this.reloadEmpty) actionZ = Math.max(actionZ, m.actionTravel * bump(u, 0.8, 0.96));
      if (this.reloadT >= 1) {
        this.reloadT = -1;
        if (m.mag) {
          m.mag.position.set(0, 0, 0);
          m.mag.visible = true;
        }
      }
    }
    if (this.roundT >= 0) {
      this.roundT += dt / 0.4;
      const b = Math.sin(Math.PI * Math.min(1, this.roundT));
      pos.y -= 0.014 * b;
      rx += 0.05 * b;
      rz += 0.3;
      pos.y -= 0.03;
      if (this.roundT >= 1) this.roundT = -1;
    }

    // Bolt / pump / lever
    if (this.cycleT >= 0) {
      this.cycleT += dt / this.cycleDur;
      const u = Math.min(1, this.cycleT);
      const b = Math.sin(Math.PI * u);
      actionZ = m.actionTravel * b;
      const bolt = def.modes[0] === 'bolt';
      rz += (bolt ? 0.16 : 0.05) * b;
      rx += (bolt ? 0.05 : 0.07) * b;
      pos.y -= 0.01 * b;
      pos.z += (bolt ? 0.0 : 0.012) * b;
      if (this.cycleT >= 1) this.cycleT = -1;
    }

    // Swap weapons
    let drop = 0;
    if (this.switchT >= 0) {
      const before = this.switchT;
      this.switchT += dt / this.switchDur;
      if (before < 0.5 && this.switchT >= 0.5 && this.onSwap) {
        const fn = this.onSwap;
        this.onSwap = null;
        fn();
      }
      const u = Math.min(1, this.switchT);
      drop = u < 0.5 ? smoothstep(0, 0.5, u) : 1 - smoothstep(0.5, 1, u);
      if (this.switchT >= 1) this.switchT = -1;
    }
    this.low = damp(this.low, s.lowered, 11, dt);
    drop = Math.max(drop, this.low);
    pos.y -= 0.3 * drop;
    rx -= 0.65 * drop;
    rz += 0.2 * drop;

    if (m.action) {
      if (m.spins) m.action.rotation.z += s.spin * 42 * dt;
      else if (def.look.style === 'lever') {
        m.action.position.z = 0;
        m.action.rotation.x = 0;
        m.action.position.y = actionZ * 0.6;
        m.action.position.z = actionZ * -0.4;
      } else m.action.position.z = actionZ;
    }

    this.pivot.position.copy(pos);
    this.pivot.rotation.set(rx, ry, rz);

    // Muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.engine.vmMuzzleLight.intensity = 0;
      }
    }

    // Melee swing: the blade sweeps across the view while the gun drops away.
    if (this.meleeT >= 0) {
      this.meleeT += dt / this.meleeDur;
      const u = Math.min(1, this.meleeT);
      const e = smoothstep(0.05, 0.75, u);
      this.meleeHolder.visible = true;
      this.meleeHolder.position.set(lerp(0.3, -0.16, e), lerp(-0.04, -0.2, e) - smoothstep(0.75, 1, u) * 0.3, lerp(-0.28, -0.5, Math.sin(e * Math.PI)));
      this.meleeHolder.rotation.set(lerp(0.5, -0.5, e), lerp(-0.9, 1.0, e), lerp(-0.5, 0.9, e));
      if (this.meleeT >= 1) {
        this.meleeT = -1;
        this.meleeHolder.visible = false;
      }
    }

    // A magnified scope fills the view: the HUD draws the reticle instead.
    this.pivot.visible = !(def.scoped && s.ads > 0.8);
  }

  /** World-space position of the muzzle, corrected for the weapon layer's separate field of view. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.toWorld(this.model ? this.model.muzzle : this.tmpV.set(0, 0, -0.5), out);
  }
  ejectWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.toWorld(this.model ? this.model.eject : this.tmpV.set(0.05, 0, -0.2), out);
  }
  private toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const cam = this.engine.camera;
    this.holder.updateWorldMatrix(true, false);
    out.copy(local).applyMatrix4(this.holder.matrixWorld);
    const k = Math.tan((cam.fov * DEG) / 2) / Math.tan((this.engine.vmCamera.fov * DEG) / 2);
    out.x *= k;
    out.y *= k;
    return out.applyMatrix4(cam.matrixWorld);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.engine.vmScene.remove(this.root);
    this.flashTex.dispose();
    this.flashMat.dispose();
    if (this.meleeModel) disposeWeaponModel(this.meleeModel);
    void this.tmpQ;
  }
}
