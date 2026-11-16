// Armory showroom: the selected weapon as a slowly turning 3D model, drawn in the engine's
// overlay layer so it sits on top of the (dimmed) world without a second WebGL context.

import * as THREE from 'three';
import type { Engine } from '../core/engine';
import { clamp, DEG } from '../core/math';
import { buildWeaponModel, disposeWeaponModel, type WeaponModel } from '../game/weapons/model';
import type { WeaponDef } from '../game/weapons/types';

export class Showroom {
  private root = new THREE.Group();
  private spin = new THREE.Group();
  private dim: THREE.Mesh;
  private key = new THREE.DirectionalLight(0xfff1dc, 3.2);
  private rim = new THREE.DirectionalLight(0x8fb8ff, 2.4);
  private model: WeaponModel | null = null;
  private length = 1;
  private height = 0.3;
  private yaw = -0.7;
  private pitch = 0.14;
  private dragging = false;
  private stage: HTMLElement | null = null;
  private raf = 0;
  private last = 0;
  private prevEnv = 1;
  private idle = 0;
  open = false;

  constructor(private readonly engine: Engine) {
    this.dim = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    this.dim.position.z = -9;
    this.dim.renderOrder = -10;
    this.key.position.set(1.5, 2.5, 2);
    this.rim.position.set(-2.5, 1, -2);
    this.root.add(this.spin, this.key, this.rim);
  }

  /** `stage` is the transparent DOM element the model should appear inside (also the drag surface). */
  show(stage: HTMLElement): void {
    this.stage = stage;
    if (!this.open) {
      this.open = true;
      this.engine.vmScene.add(this.dim, this.root);
      this.prevEnv = this.engine.vmScene.environmentIntensity;
      this.engine.vmScene.environmentIntensity = 1.05;
      this.last = performance.now();
      const tick = (now: number) => {
        if (!this.open) return;
        this.raf = requestAnimationFrame(tick);
        this.update(Math.min(0.05, (now - this.last) / 1000));
        this.last = now;
      };
      this.raf = requestAnimationFrame(tick);
    }
    let px = 0;
    let py = 0;
    stage.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.idle = 0;
      px = e.clientX;
      py = e.clientY;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - px) * 0.009;
      this.pitch = clamp(this.pitch + (e.clientY - py) * 0.006, -0.9, 0.9);
      px = e.clientX;
      py = e.clientY;
    });
    const end = () => (this.dragging = false);
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  set(def: WeaponDef): void {
    if (this.model) {
      this.spin.remove(this.model.group);
      disposeWeaponModel(this.model);
    }
    const m = (this.model = buildWeaponModel(def, true));
    const box = new THREE.Box3().setFromObject(m.group);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    m.group.position.set(-c.x, -c.y, -c.z);
    this.length = Math.max(0.12, size.z);
    this.height = Math.max(0.08, size.y);
    this.spin.add(m.group);
  }

  private update(dt: number): void {
    const st = this.stage;
    const cam = this.engine.vmCamera;
    if (!st || !st.isConnected) return;
    const r = st.getBoundingClientRect();
    const W = this.engine.width;
    const H = this.engine.height;
    const dist = 3.2;
    const halfH = Math.tan((cam.fov * DEG) / 2) * dist;
    const halfW = halfH * cam.aspect;
    const nx = ((r.left + r.width / 2) / W) * 2 - 1;
    const ny = -(((r.top + r.height / 2) / H) * 2 - 1);
    this.root.position.set(nx * halfW, ny * halfH, -dist);
    // Fit the weapon inside the stage, but never blow small items up absurdly.
    const fitW = ((r.width / W) * 2 * halfW * 0.8) / this.length;
    const fitH = ((r.height / H) * 2 * halfH * 0.8) / Math.max(this.height, this.length * 0.34);
    this.spin.scale.setScalar(Math.min(fitW, fitH, 6.5));
    if (!this.dragging) {
      this.idle += dt;
      if (this.idle > 1.2) this.yaw += dt * 0.32;
    }
    // Models point along -Z; turn them side-on to the viewer by default.
    this.spin.rotation.set(this.pitch, this.yaw + Math.PI / 2, 0, 'YXZ');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    cancelAnimationFrame(this.raf);
    this.engine.vmScene.remove(this.dim, this.root);
    this.engine.vmScene.environmentIntensity = this.prevEnv;
    if (this.model) {
      this.spin.remove(this.model.group);
      disposeWeaponModel(this.model);
      this.model = null;
    }
    this.stage = null;
  }
}
