import * as THREE from 'three';

/** Everything that defines the look and mood of a chapter's environment. */
export interface EnvDef {
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  sunDir: [number, number, number];
  sunColor: number;
  /** Directional light strength. */
  sunIntensity: number;
  /** HDR brightness of the visible disc (0 hides it). */
  sunDisc: number;
  moon?: boolean;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  fogDensity: number;
  stars: number;
  clouds: number;
  cloudColor: number;
  envIntensity: number;
  exposure: number;
  weather?: 'rain' | 'snow' | 'dust';
  weatherAmount?: number;
  /** Colour grade: tint multiplier, contrast, saturation. */
  grade?: { tint: [number, number, number]; contrast: number; saturation: number };
  indoor?: boolean;
  reverb: 'open' | 'urban' | 'indoor' | 'cave';
  ambience: string[];
  /** Half-size of the sun shadow box in metres. */
  shadowRange?: number;
  /** Musical root note (MIDI) for the generative score. */
  musicRoot?: number;
  /** Base surface where there is no terrain. */
  ground?: string;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 0.0);
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w; // pin to the far plane
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunDisc; uniform float uMoon;
uniform float uStars; uniform float uClouds; uniform vec3 uCloudColor; uniform float uTime;
varying vec3 vDir;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uBottom, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  // Halo and disc
  col += uSunColor * (pow(sd, 6.0) * 0.12 + pow(sd, 90.0) * 0.5) * min(uSunDisc, 4.0) * 0.5;
  float disc = smoothstep(0.9993 - uMoon * 0.0006, 0.9997 - uMoon * 0.0004, sd);
  col += uSunColor * disc * uSunDisc;
  if (uStars > 0.01 && h > 0.0) {
    vec2 sp = d.xz / (h + 0.35) * 190.0;
    float st = hash(floor(sp));
    float tw = 0.7 + 0.3 * sin(uTime * 2.0 + st * 90.0);
    col += vec3(smoothstep(0.9965, 1.0, st)) * tw * uStars * smoothstep(0.0, 0.3, h) * 1.4;
  }
  if (uClouds > 0.01 && h > -0.02) {
    vec2 cp = d.xz / (h + 0.22) * 1.3 + vec2(uTime * 0.006, uTime * 0.003);
    float c = fbm(cp);
    float dens = smoothstep(1.0 - uClouds, 1.15 - uClouds * 0.6, c + 0.25);
    float lit = 0.55 + 0.45 * fbm(cp * 1.7 + 4.0);
    vec3 cc = uCloudColor * lit + uSunColor * pow(sd, 8.0) * 0.25 * uSunDisc * 0.1;
    col = mix(col, cc, dens * smoothstep(-0.02, 0.2, h) * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor() {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunDisc: { value: 0 },
      uMoon: { value: 0 },
      uStars: { value: 0 },
      uClouds: { value: 0 },
      uCloudColor: { value: new THREE.Color() },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
  }

  apply(env: EnvDef): void {
    const u = this.uniforms;
    (u.uTop.value as THREE.Color).setHex(env.skyTop);
    (u.uHorizon.value as THREE.Color).setHex(env.skyHorizon);
    (u.uBottom.value as THREE.Color).setHex(env.skyBottom);
    (u.uSunDir.value as THREE.Vector3).set(...env.sunDir).normalize();
    (u.uSunColor.value as THREE.Color).setHex(env.sunColor);
    u.uSunDisc.value = env.indoor ? 0 : env.sunDisc;
    u.uMoon.value = env.moon ? 1 : 0;
    u.uStars.value = env.stars;
    u.uClouds.value = env.clouds;
    (u.uCloudColor.value as THREE.Color).setHex(env.cloudColor);
  }

  /** Bakes the sky into a prefiltered environment map for image-based lighting. */
  bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    this.envRT?.dispose();
    const scene = new THREE.Scene();
    const disc = this.uniforms.uSunDisc.value as number;
    this.uniforms.uSunDisc.value = Math.min(disc, 6); // keep the sun from producing fireflies in reflections
    scene.add(this.mesh);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(scene, 0.02, 0.1, 10);
    pmrem.dispose();
    scene.remove(this.mesh);
    this.uniforms.uSunDisc.value = disc;
    return this.envRT.texture;
  }

  dispose(): void {
    this.envRT?.dispose();
    this.envRT = null;
  }
}
