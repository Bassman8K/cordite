// Visual effects: pooled particles, tracers, shell casings, bullet-hole decals and weather.
// Everything is pre-allocated; nothing here creates garbage during play.

import * as THREE from 'three';
import type { Engine } from '../core/engine';
import { clamp, lerp, rand } from '../core/math';
import { store } from '../core/settings';
import type { EmitterDef } from '../world/builder';
import type { Surface, World } from '../world/collision';
import { makeSprite } from './textures';

const P_VERT = /* glsl */ `
attribute vec4 aColor; attribute float aSize; varying vec4 vColor; uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize <= 0.0 ? 0.0 : clamp(aSize * uScale / max(0.05, -mv.z), 1.0, 640.0);
}`;
const P_FRAG = /* glsl */ `
uniform sampler2D uMap; varying vec4 vColor;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * a, a * PREMUL);
}`;

/** Fixed-size ring buffer of point sprites simulated on the CPU. */
class Pool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private next = 0;
  private live = 0;
  readonly mat: THREE.ShaderMaterial;

  constructor(readonly n: number, additive: boolean, map: THREE.Texture) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: P_FRAG.replace('PREMUL', additive ? '0.0' : '1.0'),
      uniforms: { uMap: { value: map }, uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number, grav = 0, drag = 0): void {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = a;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.size[i] = s0;
    this.live = Math.max(this.live, 1);
  }

  update(dt: number): void {
    if (!this.live) return;
    let live = 0;
    const { pos, vel, life, max, size, s0, s1, col, a0, grav, drag } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      live++;
      const k = 1 - drag[i] * dt;
      const j = i * 3;
      vel[j] *= k;
      vel[j + 1] = vel[j + 1] * k - grav[i] * dt;
      vel[j + 2] *= k;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      const t = 1 - life[i] / max[i];
      size[i] = s0[i] + (s1[i] - s0[i]) * Math.sqrt(t);
      // Quick fade in, long fade out.
      col[i * 4 + 3] = a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
    }
    this.live = live;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    this.live = 0;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

const W_VERT = /* glsl */ `
attribute vec3 aSeed; uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; uniform float uSize; uniform float uScale; uniform float uBox;
varying float vFade;
void main() {
  vec3 p = aSeed * uBox + uVel * uTime * (0.7 + aSeed.x * 0.6);
  p.x += sin(uTime * 0.7 + aSeed.y * 40.0) * uVel.y * -0.04;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vFade = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(p));
  vec4 mv = viewMatrix * vec4(p + uCam, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale / max(1.2, -mv.z), 1.0, 70.0);
}`;
const W_FRAG = /* glsl */ `
uniform vec4 uColor; uniform float uStreak; varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = uStreak > 0.5 ? smoothstep(0.035, 0.0, abs(c.x)) * smoothstep(0.5, 0.15, abs(c.y)) : smoothstep(0.5, 0.1, length(c));
  a *= uColor.a * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor.rgb * a, a);
}`;

const SURF_DUST: Record<Surface, [number, number, number]> = {
  concrete: [0.55, 0.54, 0.52], metal: [0.5, 0.5, 0.5], wood: [0.5, 0.38, 0.24], dirt: [0.4, 0.32, 0.23], sand: [0.72, 0.62, 0.45],
  snow: [0.92, 0.94, 0.97], grass: [0.32, 0.3, 0.2], water: [0.8, 0.86, 0.9], flesh: [0.35, 0.02, 0.02], glass: [0.8, 0.85, 0.9], fabric: [0.45, 0.43, 0.38],
};

interface Casing {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; spin: number; life: number; floor: number; big: boolean;
}

export class FX {
  readonly group = new THREE.Group();
  private smoke: Pool;
  private glow: Pool;
  private tracers: THREE.InstancedMesh;
  private tracerN = 0;
  private casings: THREE.InstancedMesh;
  private casingList: Casing[] = [];
  private holes: THREE.InstancedMesh;
  private holeNext = 0;
  private scorch: THREE.InstancedMesh;
  private scorchNext = 0;
  private weather: THREE.Points | null = null;
  private weatherMat: THREE.ShaderMaterial | null = null;
  private emitters: EmitterDef[] = [];
  private emitAcc = 0;
  private blastT = 0;
  private blastPeak = 0;
  private flashT = 0;
  /** Tint applied to smoke and dust so they sit in the scene's lighting. */
  readonly ambient = new THREE.Color(1, 1, 1);
  world: World | null = null;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private e = new THREE.Euler();
  private disposables: Array<{ dispose(): void }> = [];
  private scale = 1;

  constructor(private readonly engine: Engine) {
    const tier = engine.tier.particles;
    this.scale = tier;
    const smokeTex = makeSprite('smoke', 64);
    const glowTex = makeSprite('glow', 64);
    this.smoke = new Pool(Math.round(1400 * tier), false, smokeTex);
    this.glow = new Pool(Math.round(900 * tier), true, glowTex);
    this.group.add(this.smoke.points, this.glow.points);

    const tGeo = new THREE.BoxGeometry(1, 1, 1);
    const tMat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.tracers = new THREE.InstancedMesh(tGeo, tMat, 96);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.setColorAt(0, new THREE.Color(1, 1, 1));
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.tracers.renderOrder = 12;

    const cGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 6);
    const cMat = new THREE.MeshStandardMaterial({ color: 0xb8923f, roughness: 0.35, metalness: 0.9 });
    this.casings = new THREE.InstancedMesh(cGeo, cMat, 40);
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casings.frustumCulled = false;
    this.casings.count = 0;

    const plane = new THREE.PlaneGeometry(1, 1);
    const holeTex = makeSprite('hole', 64);
    const hMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0x8a8a8a });
    this.holes = new THREE.InstancedMesh(plane, hMat, 180);
    this.holes.frustumCulled = false;
    this.holes.count = 0;
    const scorchTex = makeSprite('scorch', 64);
    const sMat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, color: 0x555555 });
    this.scorch = new THREE.InstancedMesh(plane, sMat, 24);
    this.scorch.frustumCulled = false;
    this.scorch.count = 0;
    this.group.add(this.tracers, this.casings, this.holes, this.scorch);
    this.disposables.push(smokeTex, glowTex, tGeo, tMat, cGeo, cMat, plane, holeTex, hMat, scorchTex, sMat, this.smoke.mat, this.glow.mat, this.smoke.points.geometry, this.glow.points.geometry);
  }

  setEmitters(list: EmitterDef[]): void {
    this.emitters = list;
  }

  setWeather(kind: 'rain' | 'snow' | 'dust' | undefined, amount = 1): void {
    if (this.weather) {
      this.group.remove(this.weather);
      this.weather.geometry.dispose();
      this.weatherMat?.dispose();
      this.weather = null;
      this.weatherMat = null;
    }
    if (!kind) return;
    const n = Math.round((kind === 'rain' ? 5200 : kind === 'snow' ? 3800 : 1400) * amount * clamp(this.scale, 0.35, 1.2));
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const cfg = {
      rain: { vel: [1.5, -21, 0.6], size: 0.5, color: [0.55, 0.62, 0.72, 0.2], streak: 1, box: 24 },
      snow: { vel: [1.6, -1.7, 0.5], size: 0.075, color: [0.95, 0.97, 1, 0.8], streak: 0, box: 30 },
      dust: { vel: [2.6, -0.1, 0.9], size: 0.05, color: [0.85, 0.72, 0.5, 0.5], streak: 0, box: 26 },
    }[kind];
    this.weatherMat = new THREE.ShaderMaterial({
      vertexShader: W_VERT,
      fragmentShader: W_FRAG,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(...cfg.vel) }, uSize: { value: cfg.size },
        uScale: { value: 800 }, uBox: { value: cfg.box }, uColor: { value: new THREE.Vector4(...cfg.color) }, uStreak: { value: cfg.streak },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.weather = new THREE.Points(geo, this.weatherMat);
    this.weather.frustumCulled = false;
    this.weather.renderOrder = 9;
    this.group.add(this.weather);
  }

  // ------------------------------------------------------------------ emitters

  private dustRGB(surf: Surface, out: [number, number, number]): void {
    const c = SURF_DUST[surf] ?? SURF_DUST.concrete;
    out[0] = c[0] * this.ambient.r;
    out[1] = c[1] * this.ambient.g;
    out[2] = c[2] * this.ambient.b;
  }
  private rgb: [number, number, number] = [1, 1, 1];

  /** Bullet strike: dust puff, sparks on hard surfaces, and a hole decal. */
  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surf: Surface, big = 1, decal = true): void {
    const c = this.rgb;
    this.dustRGB(surf, c);
    const n = surf === 'metal' ? 1 : 3;
    for (let i = 0; i < n; i++) {
      this.smoke.emit(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * rand(0.6, 2.2) + rand(-0.5, 0.5), ny * rand(0.6, 2.2) + rand(0, 0.8), nz * rand(0.6, 2.2) + rand(-0.5, 0.5), rand(0.35, 0.9), 0.1 * big, rand(0.5, 1.0) * big, c[0], c[1], c[2], 0.5, -0.2, 2.2);
    }
    if (surf === 'metal' || (surf === 'concrete' && Math.random() < 0.35)) {
      const k = surf === 'metal' ? 6 : 2;
      for (let i = 0; i < k; i++) this.glow.emit(x, y, z, nx * rand(2, 7) + rand(-3, 3), ny * rand(2, 7) + rand(-1, 4), nz * rand(2, 7) + rand(-3, 3), rand(0.12, 0.4), 0.05, 0.015, 3, 2.0, 0.8, 1, 9, 0.5);
    }
    if (surf === 'water') this.smoke.emit(x, y + 0.1, z, 0, 3, 0, 0.5, 0.2, 0.8, 0.85, 0.9, 0.95, 0.5, 6, 0.5);
    if (decal && surf !== 'water' && surf !== 'flesh' && surf !== 'fabric') this.hole(x, y, z, nx, ny, nz, rand(0.07, 0.11) * big);
  }

  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    if (!store.settings.blood) return;
    for (let i = 0; i < 5; i++) {
      this.smoke.emit(x, y, z, dx * rand(0.5, 3) + rand(-0.8, 0.8), dy * rand(0.5, 3) + rand(-0.2, 1.2), dz * rand(0.5, 3) + rand(-0.8, 0.8), rand(0.25, 0.55), 0.06, rand(0.25, 0.5), 0.3 * this.ambient.r + 0.08, 0.01, 0.01, 0.75, 5, 1.5);
    }
  }

  hole(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number): void {
    const i = this.holeNext;
    this.holeNext = (i + 1) % 180;
    this.holes.count = Math.max(this.holes.count, i + 1);
    this.placeDecal(this.holes, i, x, y, z, nx, ny, nz, size);
  }

  scorchMark(x: number, y: number, z: number, size: number): void {
    const i = this.scorchNext;
    this.scorchNext = (i + 1) % 24;
    this.scorch.count = Math.max(this.scorch.count, i + 1);
    this.placeDecal(this.scorch, i, x, y, z, 0, 1, 0, size);
  }

  private placeDecal(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number): void {
    this.v1.set(nx, ny, nz);
    this.q.setFromUnitVectors(this.v2.set(0, 0, 1), this.v1);
    this.e.set(0, 0, Math.random() * 6.28);
    this.q.multiply(new THREE.Quaternion().setFromEuler(this.e));
    this.m4.compose(this.v2.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012), this.q, this.v3.set(size, size, size));
    mesh.setMatrixAt(i, this.m4);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** World-space muzzle flash (enemy weapons, and the player's as seen in the world). */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, power = 1, suppressed = false): void {
    if (!suppressed) {
      this.glow.emit(x + dx * 0.1, y + dy * 0.1, z + dz * 0.1, dx * 2, dy * 2, dz * 2, 0.05, 0.5 * power, 0.9 * power, 4, 2.6, 1.0, 1);
      this.glow.emit(x + dx * 0.35, y + dy * 0.35, z + dz * 0.35, dx * 6, dy * 6, dz * 6, 0.045, 0.28 * power, 0.5 * power, 4, 2.8, 1.2, 1);
    }
    const a = this.ambient;
    this.smoke.emit(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2, dx * rand(1, 3), dy * rand(1, 3) + 0.4, dz * rand(1, 3), rand(0.5, 1.1), 0.12, 0.7 * power, 0.6 * a.r, 0.6 * a.g, 0.6 * a.b, suppressed ? 0.12 : 0.22, -0.3, 2.5);
  }

  /** Lights the scene briefly from the player's muzzle. */
  playerFlash(x: number, y: number, z: number, power: number): void {
    const l = this.engine.muzzleLight;
    l.position.set(x, y, z);
    l.intensity = 90 * power;
    this.flashT = 0.05;
  }

  explosion(x: number, y: number, z: number, radius: number, fire = false): void {
    const s = radius / 6;
    const a = this.ambient;
    this.glow.emit(x, y + 0.3, z, 0, 0, 0, 0.14, 4 * s, 9 * s, 5, 4, 2.4, 1);
    const nf = Math.round(14 * this.scale);
    for (let i = 0; i < nf; i++) {
      const th = Math.random() * 6.283;
      const up = rand(0.2, 1);
      const sp = rand(1.5, 6) * s;
      this.glow.emit(x, y + 0.3, z, Math.cos(th) * sp * (1 - up * 0.5), up * sp * 1.4, Math.sin(th) * sp * (1 - up * 0.5), rand(0.3, 0.65) * (fire ? 2 : 1), 1.2 * s, 3.4 * s, 3.6, 1.5, 0.35, 0.9, -1, 2.4);
    }
    const ns = Math.round(18 * this.scale);
    for (let i = 0; i < ns; i++) {
      const th = Math.random() * 6.283;
      const sp = rand(0.5, 4) * s;
      const g = rand(0.12, 0.3);
      this.smoke.emit(x + rand(-0.5, 0.5), y + rand(0.2, 1.2), z + rand(-0.5, 0.5), Math.cos(th) * sp, rand(1, 4.5) * s, Math.sin(th) * sp, rand(2.2, 4.5), 1.6 * s, rand(5, 8.5) * s, g * (a.r + 0.25), g * (a.g + 0.25), g * (a.b + 0.25), 0.72, -0.5, 1.1);
    }
    const nk = Math.round(26 * this.scale);
    for (let i = 0; i < nk; i++) {
      const th = Math.random() * 6.283;
      const sp = rand(5, 19) * s;
      this.glow.emit(x, y + 0.3, z, Math.cos(th) * sp, rand(3, 15) * s, Math.sin(th) * sp, rand(0.5, 1.3), 0.09, 0.02, 4, 2.4, 0.8, 1, 13, 0.4);
    }
    // Ground-hugging dust ring
    const c = this.rgb;
    this.dustRGB('dirt', c);
    for (let i = 0; i < Math.round(12 * this.scale); i++) {
      const th = (i / 12) * 6.283 + rand(-0.2, 0.2);
      this.smoke.emit(x, y + 0.2, z, Math.cos(th) * rand(5, 9) * s, rand(0.2, 1), Math.sin(th) * rand(5, 9) * s, rand(1.2, 2.2), 1 * s, 4.5 * s, c[0], c[1], c[2], 0.5, 0, 2.2);
    }
    const l = this.engine.blastLight;
    l.position.set(x, y + 1.2, z);
    l.distance = radius * 6;
    this.blastPeak = 2600 * s;
    this.blastT = 0.4;
    this.scorchMark(x, y + 0.02, z, radius * 0.9);
  }

  /** One puff of a persistent smoke screen. */
  smokeCloud(x: number, y: number, z: number, r: number): void {
    const a = this.ambient;
    const g = 0.62;
    this.smoke.emit(x + rand(-r, r) * 0.6, y + rand(0.3, 1.8), z + rand(-r, r) * 0.6, rand(-0.4, 0.4), rand(0.1, 0.5), rand(-0.4, 0.4), rand(3, 5), 2.2, r * 1.3, g * (a.r + 0.2), g * (a.g + 0.2), g * (a.b + 0.2), 0.8, -0.05, 0.6);
  }

  /** Scope glint that gives away an aiming sniper. */
  glint(x: number, y: number, z: number): void {
    this.glow.emit(x, y, z, 0, 0, 0, 0.18, 1.1, 0.35, 3.4, 3.8, 4.4, 1);
  }

  fire(x: number, y: number, z: number, size = 1): void {
    this.glow.emit(x + rand(-0.3, 0.3) * size, y + rand(0, 0.3), z + rand(-0.3, 0.3) * size, rand(-0.3, 0.3), rand(1, 2.6) * size, rand(-0.3, 0.3), rand(0.4, 0.9), 0.7 * size, 0.15 * size, 3.4, 1.4, 0.3, 0.8, -0.6, 0.8);
  }

  /** Single blob of a flamethrower stream. */
  flame(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    this.glow.emit(x, y, z, vx, vy, vz, rand(0.5, 0.8), 0.18, rand(1.2, 2.0), 3.8, 1.7, 0.4, 0.85, -1.2, 1.1);
    if (Math.random() < 0.3) {
      const a = this.ambient;
      this.smoke.emit(x, y, z, vx * 0.6, vy * 0.6 + 1, vz * 0.6, rand(0.9, 1.6), 0.4, 2.6, 0.12 * a.r + 0.03, 0.12 * a.g + 0.03, 0.12 * a.b + 0.03, 0.5, -0.9, 1.2);
    }
  }

  trail(x: number, y: number, z: number, size = 0.5): void {
    const a = this.ambient;
    this.smoke.emit(x, y, z, rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3), rand(0.9, 1.7), size * 0.5, size * 2.4, 0.7 * (a.r + 0.2), 0.7 * (a.g + 0.2), 0.7 * (a.b + 0.2), 0.4, -0.2, 0.8);
    this.glow.emit(x, y, z, 0, 0, 0, 0.07, size * 1.4, size * 0.4, 4, 2.4, 0.8, 0.9);
  }

  dust(x: number, y: number, z: number, surf: Surface, size = 1): void {
    const c = this.rgb;
    this.dustRGB(surf, c);
    this.smoke.emit(x, y, z, rand(-0.5, 0.5), rand(0.2, 0.9), rand(-0.5, 0.5), rand(0.6, 1.2), 0.2 * size, 1.1 * size, c[0], c[1], c[2], 0.3, 0, 1.6);
  }

  casing(x: number, y: number, z: number, vx: number, vy: number, vz: number, big = false): void {
    if (this.casingList.length >= 40) this.casingList.shift();
    let floor = y - 1.5;
    if (this.world) {
      const g = { y: 0, surf: 'concrete' as Surface };
      this.world.groundAt(x, z, 0.05, y, g);
      floor = g.y;
    }
    this.casingList.push({ x, y, z, vx, vy, vz, rx: Math.random() * 6, ry: Math.random() * 6, spin: rand(8, 22), life: 2.4, floor, big });
  }

  // ------------------------------------------------------------------ tracers (immediate mode)

  beginTracers(): void {
    this.tracerN = 0;
  }
  addTracer(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, width: number, r: number, g: number, b: number): void {
    if (this.tracerN >= 96) return;
    this.v1.set(dx, dy, dz);
    this.q.setFromUnitVectors(this.v2.set(0, 0, 1), this.v1);
    this.m4.compose(this.v2.set(x - dx * len * 0.5, y - dy * len * 0.5, z - dz * len * 0.5), this.q, this.v3.set(width, width, len));
    this.tracers.setMatrixAt(this.tracerN, this.m4);
    this.tracers.setColorAt(this.tracerN, this.col.setRGB(r, g, b));
    this.tracerN++;
  }
  private col = new THREE.Color();
  endTracers(): void {
    this.tracers.count = this.tracerN;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const cam = this.engine.camera;
    const scale = this.engine.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.smoke.mat.uniforms.uScale.value = scale;
    this.glow.mat.uniforms.uScale.value = scale;
    this.smoke.update(dt);
    this.glow.update(dt);

    if (this.weatherMat) {
      const u = this.weatherMat.uniforms;
      u.uTime.value = this.engine.time;
      (u.uCam.value as THREE.Vector3).copy(cam.position);
      u.uScale.value = scale;
    }

    // Lights fade quickly back to zero.
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.engine.muzzleLight.intensity = 0;
    }
    if (this.blastT > 0) {
      this.blastT -= dt;
      this.engine.blastLight.intensity = this.blastT > 0 ? this.blastPeak * Math.pow(this.blastT / 0.4, 2) : 0;
    }

    // Shell casings
    const list = this.casingList;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.life -= dt;
      if (c.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      c.vy -= 12 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      c.rx += c.spin * dt;
      c.ry += c.spin * 0.7 * dt;
      if (c.y < c.floor + 0.006) {
        c.y = c.floor + 0.006;
        if (c.vy < -1.2) {
          c.vy *= -0.35;
          c.vx *= 0.5;
          c.vz *= 0.5;
          c.spin *= 0.5;
        } else {
          c.vy = 0;
          c.vx = c.vz = 0;
          c.spin = 0;
        }
      }
    }
    for (const c of list) {
      this.e.set(c.rx, c.ry, 0);
      this.q.setFromEuler(this.e);
      const s = c.big ? 2.2 : 1;
      this.m4.compose(this.v1.set(c.x, c.y, c.z), this.q, this.v2.set(s, s, s));
      this.casings.setMatrixAt(n++, this.m4);
    }
    this.casings.count = n;
    if (n) this.casings.instanceMatrix.needsUpdate = true;

    // Level emitters near the camera
    this.emitAcc += dt;
    if (this.emitAcc > 0.09) {
      this.emitAcc = 0;
      const a = this.ambient;
      for (const e of this.emitters) {
        const d = Math.hypot(e.x - cam.position.x, e.z - cam.position.z);
        if (d > 90) continue;
        if (e.kind === 'fire') {
          this.fire(e.x, e.y, e.z, e.size);
          if (Math.random() < 0.5) this.smoke.emit(e.x, e.y + 0.6, e.z, rand(-0.2, 0.2), rand(1.2, 2.4), rand(-0.2, 0.2), rand(2.5, 4.5), 0.8 * e.size, 3.6 * e.size, 0.1 + 0.1 * a.r, 0.1 + 0.1 * a.g, 0.1 + 0.1 * a.b, 0.5, -0.3, 0.5);
        } else if (e.kind === 'smoke') {
          if (Math.random() < 0.6) this.smoke.emit(e.x, e.y, e.z, rand(-0.2, 0.2) + 0.6, rand(1.0, 2.2), rand(-0.2, 0.2), rand(4, 7), 1 * e.size, 6 * e.size, 0.14 + 0.2 * a.r, 0.14 + 0.2 * a.g, 0.14 + 0.2 * a.b, 0.55, -0.15, 0.4);
        } else if (e.kind === 'steam') {
          if (Math.random() < 0.5) this.smoke.emit(e.x, e.y, e.z, rand(-0.3, 0.3), rand(0.8, 1.6), rand(-0.3, 0.3), rand(1, 2), 0.3 * e.size, 1.8 * e.size, 0.8 * (a.r + 0.3), 0.8 * (a.g + 0.3), 0.8 * (a.b + 0.3), 0.3, -0.4, 1);
        } else if (Math.random() < 0.12) {
          for (let i = 0; i < 5; i++) this.glow.emit(e.x, e.y, e.z, rand(-2, 2), rand(-1, 2), rand(-2, 2), rand(0.2, 0.6), 0.05, 0.01, 4, 3, 1.4, 1, 9, 0.5);
        }
      }
    }
  }

  clear(): void {
    this.smoke.clear();
    this.glow.clear();
    this.casingList.length = 0;
    this.casings.count = 0;
    this.holes.count = 0;
    this.scorch.count = 0;
    this.holeNext = this.scorchNext = 0;
    this.tracers.count = 0;
    this.engine.muzzleLight.intensity = 0;
    this.engine.blastLight.intensity = 0;
  }

  dispose(): void {
    this.setWeather(undefined);
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }

  /** Brightness used to tint smoke: derived from the environment's ambient light. */
  setAmbient(hex: number, intensity: number): void {
    this.ambient.setHex(hex).multiplyScalar(lerp(0.25, 1, clamp(intensity, 0, 1)));
  }
}
