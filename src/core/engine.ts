// Renderer, post-processing, environment lighting and the frame loop.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { studioEnvironment } from '../gfx/icons';
import { Sky, type EnvDef } from '../gfx/sky';
import { configureTextures } from '../gfx/textures';
import type { LightDef } from '../world/builder';
import { clamp } from './math';
import { store, type Quality } from './settings';

export interface QualityTier {
  pbr: boolean;
  post: boolean;
  msaa: number;
  shadowMap: number;
  shadowEvery: number;
  tex: number;
  normals: boolean;
  points: number;
  spots: number;
  dprCap: number;
  aniso: number;
  particles: number;
}

export const TIERS: Record<Quality, QualityTier> = {
  low: { pbr: false, post: false, msaa: 0, shadowMap: 0, shadowEvery: 0, tex: 256, normals: false, points: 2, spots: 1, dprCap: 1, aniso: 1, particles: 0.4 },
  medium: { pbr: true, post: true, msaa: 2, shadowMap: 1024, shadowEvery: 2, tex: 512, normals: true, points: 4, spots: 2, dprCap: 1.25, aniso: 4, particles: 0.7 },
  high: { pbr: true, post: true, msaa: 4, shadowMap: 2048, shadowEvery: 1, tex: 512, normals: true, points: 6, spots: 3, dprCap: 1.5, aniso: 8, particles: 1 },
  ultra: { pbr: true, post: true, msaa: 4, shadowMap: 3072, shadowEvery: 1, tex: 1024, normals: true, points: 8, spots: 4, dprCap: 2, aniso: 16, particles: 1.4 },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.02 },
    uAberration: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec3 uTint; uniform float uContrast; uniform float uSaturation;
    uniform float uVignette; uniform float uGrain; uniform float uAberration; uniform float uTime; varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uAberration > 0.001) {
        c.r = texture2D(tDiffuse, vUv + d * uAberration).r;
        c.b = texture2D(tDiffuse, vUv - d * uAberration).b;
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = max((c - 0.18) * uContrast + 0.18, 0.0) * uTint;
      float r = length(d * vec2(1.0, 0.88));
      c *= mix(1.0, smoothstep(0.92, 0.28, r), uVignette);
      float g = fract(sin(dot(vUv * vec2(1387.13, 947.91) + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c += g * uGrain * (0.35 + l);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

interface PooledLight {
  light: THREE.PointLight | THREE.SpotLight;
  def: LightDef | null;
}

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 900);
  /** First-person weapon layer, drawn on top with its own depth range so it never clips walls. */
  readonly vmScene = new THREE.Scene();
  readonly vmCamera = new THREE.PerspectiveCamera(56, 16 / 9, 0.01, 10);
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly vmSun = new THREE.DirectionalLight(0xffffff, 1);
  readonly vmHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly muzzleLight = new THREE.PointLight(0xffc27a, 0, 14, 1.8);
  readonly vmMuzzleLight = new THREE.PointLight(0xffc27a, 0, 3, 1.5);
  readonly blastLight = new THREE.PointLight(0xffa550, 0, 40, 1.6);
  readonly flashlight = new THREE.SpotLight(0xf2f6ff, 0, 42, 0.42, 0.55, 1.2);

  tier: QualityTier = TIERS.high;
  env: EnvDef | null = null;
  time = 0;
  frame = 0;
  fps = 60;
  frameMs = 16;
  width = 1;
  height = 1;
  onFrame: (dt: number) => void = () => {};
  onResize: () => void = () => {};
  /** Set by gameplay: world position the sun shadow box should follow. */
  readonly focus = new THREE.Vector3();

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  /** The one multisampled, depth-carrying target the 3D scene is drawn into. */
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private pool: PooledLight[] = [];
  private lightDefs: LightDef[] = [];
  private lightOff = new Set<string>();
  private running = false;
  private last = 0;
  private acc = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private envMap: THREE.Texture | null = null;
  private baseFov = 75;
  private clarity = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true });
    this.renderer.setClearColor(0x05070a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;

    this.scene.add(this.sky.mesh, this.hemi, this.sun, this.sun.target, this.muzzleLight, this.blastLight);
    this.scene.add(this.camera);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.flashlight.position.set(0.18, -0.12, 0.1);
    this.flashlight.target.position.set(0, 0, -10);
    this.camera.rotation.order = 'YXZ';
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmCamera, this.vmMuzzleLight);
    this.vmSun.position.set(0.4, 1, 0.6);
    this.sun.userData.dir = new THREE.Vector3(0.3, 1, 0.2).normalize();

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
    });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.applyQuality();
  }

  // ------------------------------------------------------------------ quality & sizing

  applyQuality(): void {
    const s = store.settings;
    this.tier = TIERS[s.quality];
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    configureTextures(this.tier.tex, Math.min(this.tier.aniso, maxAniso), this.tier.normals);
    const shadows = s.shadows && this.tier.shadowMap > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(this.tier.shadowMap, this.tier.shadowMap);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.06;
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: unknown }).map = null;
    }
    this.buildComposer();
    this.resize();
  }

  get shadowsOn(): boolean {
    return this.renderer.shadowMap.enabled;
  }

  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.sceneTarget = null;
    this.bloom = null;
    this.grade = null;
    if (!this.tier.post || !store.settings.postfx) return;
    // Memory matters more than anything else here: a multisampled HDR target with depth costs
    // 30 to 60 bytes per pixel, so exactly one exists. The scene is drawn into it; the composer's
    // other buffer, which only ever receives full-screen passes, has no samples and no depth.
    const plain = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    const c = new EffectComposer(this.renderer, plain);
    c.renderTarget2.dispose();
    this.sceneTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.tier.msaa, depthBuffer: true });
    c.renderTarget2 = this.sceneTarget;
    c.readBuffer = this.sceneTarget;
    c.writeBuffer = c.renderTarget1;
    c.addPass(new RenderPass(this.scene, this.camera));
    const vm = new RenderPass(this.vmScene, this.vmCamera);
    vm.clear = false;
    vm.clearDepth = true;
    c.addPass(vm);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 1.0);
    // Bloom is a blur: running it from a quarter of the frame is indistinguishable and a quarter of the memory.
    const bloomSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) => bloomSize(Math.ceil(w / 2), Math.ceil(h / 2));
    c.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
    this.composer = c;
    this.applyGrade();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dprCap) * clamp(store.settings.renderScale, 0.4, 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.updateProjectionMatrix();
    if (this.composer) {
      // Dense screens hide aliasing on their own, so they get fewer samples.
      const samples = dpr >= 1.5 ? Math.min(this.tier.msaa, 2) : this.tier.msaa;
      if (this.sceneTarget && this.sceneTarget.samples !== samples) {
        this.sceneTarget.dispose();
        this.sceneTarget.samples = samples;
      }
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
    }
    this.onResize();
  }

  /** Vertical field of view in degrees; converted so wide screens keep a sensible horizontal FOV. */
  setFov(deg: number): void {
    if (Math.abs(deg - this.baseFov) < 0.01) return;
    this.baseFov = deg;
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ environment

  setEnv(env: EnvDef): void {
    this.env = env;
    this.sky.apply(env);
    this.sky.mesh.visible = !env.indoor;
    const dir = new THREE.Vector3(...env.sunDir).normalize();
    this.sun.color.setHex(env.sunColor);
    this.sun.intensity = env.indoor ? 0 : env.sunIntensity;
    this.sun.castShadow = this.shadowsOn && !env.indoor;
    this.sun.userData.dir = dir;
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;
    const skyCol = new THREE.Color(env.hemiSky);
    const skyLum = skyCol.r * 0.21 + skyCol.g * 0.72 + skyCol.b * 0.07;
    const sceneLum = skyLum * env.hemiIntensity;
    this.vmSun.color.setHex(env.sunColor);
    this.vmSun.intensity = env.indoor ? 0.2 : Math.min(1.6, env.sunIntensity * 0.5);
    this.vmSun.position.copy(dir);
    this.vmHemi.color.setHex(env.hemiSky);
    this.vmHemi.groundColor.setHex(env.hemiGround);
    this.vmHemi.intensity = clamp(0.35 + 0.15 * sceneLum, 0.4, 0.65) / Math.max(0.12, skyLum);
    this.scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);
    this.renderer.setClearColor(env.fogColor, 1);
    this.renderer.toneMappingExposure = env.exposure;
    this.clarity = 0;
    if (this.tier.pbr) {
      this.envMap = this.sky.bakeEnvironment(this.renderer);
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = env.envIntensity;
    } else this.scene.environment = null;
    // The weapon in hand is lit by a neutral studio so it always reads, scaled by how bright the scene is.
    this.vmScene.environment = studioEnvironment(this.renderer);
    // Metal only shows its shape through what it reflects, so the reflections stay strong enough to read.
    this.vmScene.environmentIntensity = clamp(0.34 + 0.14 * sceneLum, 0.42, 0.72);
    const r = env.shadowRange ?? 46;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    this.applyGrade();
  }

  private applyGrade(): void {
    if (!this.grade) return;
    const g = this.env?.grade;
    const u = this.grade.uniforms;
    (u.uTint.value as THREE.Vector3).set(...(g?.tint ?? [1, 1, 1]));
    u.uContrast.value = g?.contrast ?? 1.04;
    u.uSaturation.value = g?.saturation ?? 1;
  }

  /**
   * 0..1 while looking through a magnified scope: a real objective lens gathers light and its
   * narrow view cuts through haze, so distant targets are brighter and clearer than to the naked eye.
   */
  setClarity(t: number): void {
    const env = this.env;
    if (!env) return;
    const k = clamp(t, 0, 1);
    if (Math.abs(k - this.clarity) < 0.004) return;
    this.clarity = k;
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = env.fogDensity * (1 - 0.55 * k);
    this.renderer.toneMappingExposure = env.exposure * (1 + 0.3 * k);
  }

  /** 0..1 amount of chromatic aberration (driven by damage / explosions). */
  setAberration(v: number): void {
    if (this.grade) this.grade.uniforms.uAberration.value = v * 0.012;
  }

  // ------------------------------------------------------------------ pooled level lights

  setLights(defs: LightDef[]): void {
    for (const p of this.pool) {
      this.scene.remove(p.light);
      if (p.light instanceof THREE.SpotLight) this.scene.remove(p.light.target);
      p.light.dispose();
    }
    this.pool = [];
    this.lightDefs = defs;
    this.lightOff.clear();
    const spotsWanted = defs.some((d) => d.spot) ? this.tier.spots : 0;
    const pointsWanted = defs.some((d) => !d.spot) ? this.tier.points : 0;
    for (let i = 0; i < pointsWanted; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.7);
      this.scene.add(l);
      this.pool.push({ light: l, def: null });
    }
    for (let i = 0; i < spotsWanted; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, 0.9, 0.6, 1.4);
      this.scene.add(l, l.target);
      this.pool.push({ light: l, def: null });
    }
  }

  setLightGroup(group: string, on: boolean): void {
    if (on) this.lightOff.delete(group);
    else this.lightOff.add(group);
  }

  private updateLights(): void {
    if (!this.pool.length) return;
    const cx = this.camera.position.x;
    const cy = this.camera.position.y;
    const cz = this.camera.position.z;
    // Re-rank a few times a second; fade by distance so reassignment never pops.
    if (this.frame % 8 === 0) {
      const scored: Array<{ d: LightDef; s: number }> = [];
      for (const d of this.lightDefs) {
        if (d.group && this.lightOff.has(d.group)) continue;
        const dist = Math.hypot(d.x - cx, d.y - cy, d.z - cz);
        if (dist > 70 + d.range) continue;
        scored.push({ d, s: dist - d.range * 0.8 });
      }
      scored.sort((a, b) => a.s - b.s);
      const points = scored.filter((s) => !s.d.spot);
      const spots = scored.filter((s) => s.d.spot);
      let pi = 0;
      let si = 0;
      for (const p of this.pool) {
        const isSpot = p.light instanceof THREE.SpotLight;
        const next = isSpot ? spots[si++] : points[pi++];
        p.def = next ? next.d : null;
        if (p.def) {
          p.light.position.set(p.def.x, p.def.y, p.def.z);
          p.light.color.setHex(p.def.color);
          p.light.distance = p.def.range;
          if (isSpot && p.def.spot) {
            const sl = p.light as THREE.SpotLight;
            sl.target.position.set(p.def.spot.tx, p.def.spot.ty, p.def.spot.tz);
            sl.angle = p.def.spot.angle;
          }
        }
      }
    }
    for (const p of this.pool) {
      if (!p.def) {
        p.light.intensity = 0;
        continue;
      }
      const d = p.def;
      const dist = Math.hypot(d.x - cx, d.y - cy, d.z - cz);
      const fade = clamp((70 + d.range - dist) / 25, 0, 1);
      let k = 1;
      if (d.flicker) {
        const n = Math.sin(this.time * 31 + d.x * 3.1) * Math.sin(this.time * 17.3 + d.z * 1.7);
        k = n > 1 - d.flicker ? 0.15 : 1;
      }
      p.light.intensity = d.intensity * fade * k;
    }
  }

  // ------------------------------------------------------------------ loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      const elapsed = now - this.last;
      const cap = store.settings.fpsCap;
      if (cap > 0 && elapsed < 1000 / cap - 1) return;
      this.last = now;
      const dt = Math.min(elapsed / 1000, 0.05);
      this.acc += elapsed;
      this.fpsAcc += elapsed;
      this.fpsN++;
      if (this.fpsAcc >= 500) {
        this.frameMs = this.fpsAcc / this.fpsN;
        this.fps = 1000 / this.frameMs;
        this.fpsAcc = 0;
        this.fpsN = 0;
      }
      this.time += dt;
      this.frame++;
      this.onFrame(dt);
      this.render();
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }

  render(): void {
    const r = this.renderer;
    this.sky.uniforms.uTime.value = this.time;
    this.sky.mesh.position.copy(this.camera.position);
    this.sky.mesh.scale.setScalar(this.camera.far * 0.9);
    this.sky.mesh.updateMatrix();
    this.updateLights();

    if (this.sun.castShadow) {
      const range = this.env?.shadowRange ?? 46;
      const texel = (range * 2) / this.tier.shadowMap;
      const fx = Math.round(this.focus.x / texel) * texel;
      const fz = Math.round(this.focus.z / texel) * texel;
      const dir = this.sun.userData.dir as THREE.Vector3;
      this.sun.target.position.set(fx, this.focus.y, fz);
      this.sun.position.set(fx + dir.x * 120, this.focus.y + dir.y * 120, fz + dir.z * 120);
      r.shadowMap.needsUpdate = this.frame % Math.max(1, this.tier.shadowEvery) === 0;
    } else if (this.sun.userData.dir) {
      const dir = this.sun.userData.dir as THREE.Vector3;
      this.sun.position.copy(this.camera.position).addScaledVector(dir, 100);
      this.sun.target.position.copy(this.camera.position);
    }

    r.info.reset();
    if (this.composer) {
      if (this.grade) this.grade.uniforms.uTime.value = this.time % 100;
      // Always start a frame with the scene target as the buffer the scene pass draws into.
      this.composer.readBuffer = this.composer.renderTarget2;
      this.composer.writeBuffer = this.composer.renderTarget1;
      this.composer.render();
    } else {
      r.autoClear = false;
      r.clear();
      r.render(this.scene, this.camera);
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }

  /** Renders a single frame synchronously (used when the loop is stopped, e.g. for thumbnails). */
  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }
  get triangles(): number {
    return this.renderer.info.render.triangles;
  }
  get memory(): { geometries: number; textures: number } {
    return this.renderer.info.memory;
  }
}
