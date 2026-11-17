// Turns a LevelBuilder's plain-array output into three.js objects.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, RNG } from '../core/math';
import type { LevelBuilder } from '../world/builder';
import type { GeoBucket } from '../world/geo';
import type { MaterialLib } from './materials';
import { makeSprite } from './textures';

export interface LevelMeshes {
  group: THREE.Group;
  /** Meshes belonging to dynamic props (keyed by prop id) so they can be hidden or swapped. */
  props: Map<string, THREE.Mesh[]>;
  /** Emissive meshes by light group, for power cuts and alarms. */
  emissiveGroups: Map<string, THREE.Mesh[]>;
  glows: THREE.Points | null;
  glowGroups: Map<string, number[]>;
  water: THREE.Mesh[];
  update(time: number): void;
  setGroup(group: string, on: boolean): void;
  dispose(): void;
}

function bucketGeometry(b: GeoBucket): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function colored(geo: THREE.BufferGeometry, r: number, g: number, b: number, shadeY = 0): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox as THREE.Box3;
  for (let i = 0; i < n; i++) {
    const t = shadeY ? 1 - shadeY + shadeY * ((pos.getY(i) - bb.min.y) / Math.max(1e-3, bb.max.y - bb.min.y)) : 1;
    col[i * 3] = r * t;
    col[i * 3 + 1] = g * t;
    col[i * 3 + 2] = b * t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo.index ? geo.toNonIndexed() : geo;
}

/** Low-poly vegetation and rocks, merged into single geometries so each kind is one instanced draw. */
function instanceGeometry(kind: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rng = new RNG(kind.length * 977 + 13);
  if (kind === 'pine' || kind === 'snowpine') {
    parts.push(colored(new THREE.CylinderGeometry(0.1, 0.2, 2.6, 6).translate(0, 1.3, 0), 0.24, 0.17, 0.11));
    const snow = kind === 'snowpine';
    for (let i = 0; i < 4; i++) {
      const r = 1.7 - i * 0.36;
      const c = new THREE.ConeGeometry(r, 2.3, 7).translate(0, 2.6 + i * 1.45, 0);
      parts.push(snow ? colored(c, 0.62, 0.68, 0.7, 0.62) : colored(c, 0.1, 0.2, 0.11, 0.45));
    }
  } else if (kind === 'tree' || kind === 'deadtree') {
    parts.push(colored(new THREE.CylinderGeometry(0.16, 0.28, 3.4, 6).translate(0, 1.7, 0), 0.22, 0.16, 0.11));
    if (kind === 'tree') {
      for (let i = 0; i < 5; i++) {
        const s = rng.range(1.2, 1.9);
        const blob = new THREE.IcosahedronGeometry(s, 0).translate(rng.range(-1.1, 1.1), 3.8 + rng.range(0, 1.8), rng.range(-1.1, 1.1));
        parts.push(colored(blob, 0.16, 0.27, 0.11, 0.5));
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const br = new THREE.CylinderGeometry(0.03, 0.09, 2.2, 4).rotateZ(rng.range(0.5, 1.1) * (i % 2 ? 1 : -1)).rotateY(rng.range(0, 6.28)).translate(0, 2.7 + i * 0.4, 0);
        parts.push(colored(br, 0.2, 0.15, 0.1));
      }
    }
  } else if (kind === 'palm') {
    parts.push(colored(new THREE.CylinderGeometry(0.13, 0.2, 5.5, 6).translate(0, 2.75, 0), 0.36, 0.29, 0.19));
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.ConeGeometry(0.42, 3.0, 4).rotateZ(1.25).translate(1.4, 5.3, 0).rotateY((i / 7) * Math.PI * 2);
      parts.push(colored(leaf, 0.2, 0.31, 0.12, 0.3));
    }
  } else if (kind === 'bush' || kind === 'drybush') {
    for (let i = 0; i < 4; i++) {
      const blob = new THREE.IcosahedronGeometry(rng.range(0.4, 0.7), 0).translate(rng.range(-0.5, 0.5), rng.range(0.3, 0.6), rng.range(-0.5, 0.5));
      parts.push(kind === 'bush' ? colored(blob, 0.17, 0.26, 0.11, 0.5) : colored(blob, 0.4, 0.34, 0.2, 0.5));
    }
  } else {
    // rock
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 0.72 + fbm(x * 1.7 + 5, z * 1.7 + y * 1.3, 3, 9) * 0.6;
      p.setXYZ(i, x * k, Math.max(-0.3, y * k * 0.72), z * k);
    }
    parts.push(colored(g, 0.36, 0.35, 0.33, 0.35));
  }
  const merged = mergeGeometries(parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    q.deleteAttribute('uv');
    return q;
  }));
  merged.computeVertexNormals();
  for (const p of parts) p.dispose();
  return merged;
}

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WATER_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uFogColor; uniform float uFogDensity;
varying vec3 vWorld;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float waves(vec2 p) { return noise(p * 0.55 + uTime * 0.35) * 0.6 + noise(p * 1.7 - uTime * 0.5) * 0.3 + noise(p * 4.1 + uTime * 0.9) * 0.1; }
void main() {
  vec2 p = vWorld.xz;
  float e = 0.25;
  float h = waves(p);
  vec3 n = normalize(vec3((h - waves(p + vec2(e, 0.0))) * 1.6, 1.0, (h - waves(p + vec2(0.0, e))) * 1.6));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = mix(uDeep, uSky, clamp(fres * 0.9 + 0.06, 0.0, 1.0));
  vec3 r = reflect(-normalize(uSunDir), n);
  col += uSunColor * pow(max(dot(r, v), 0.0), 120.0) * 2.5;
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
}`;

const GLOW_VERT = /* glsl */ `
attribute float size; attribute vec3 color; varying vec3 vColor; uniform float uScale;
void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(size * uScale / max(0.1, -mv.z), 300.0); }`;
const GLOW_FRAG = /* glsl */ `
uniform sampler2D uMap; varying vec3 vColor;
void main() { float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vColor * a, a); }`;

export interface WaterLook {
  deep: number;
  sky: number;
  sunDir: THREE.Vector3;
  sunColor: number;
  fogColor: number;
  fogDensity: number;
}

export function buildLevelMeshes(b: LevelBuilder, lib: MaterialLib, look: WaterLook, shadows: boolean, viewportH: () => number): LevelMeshes {
  const group = new THREE.Group();
  group.name = 'level';
  const props = new Map<string, THREE.Mesh[]>();
  const emissiveGroups = new Map<string, THREE.Mesh[]>();
  const disposables: Array<{ dispose(): void }> = [];

  for (const [key, bucket] of b.buckets) {
    if (!bucket.idx.length) continue;
    const geo = bucketGeometry(bucket);
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, lib.get(bucket.mat));
    const flat = bucket.mat === 'emissive' || bucket.mat === 'glass';
    mesh.castShadow = shadows && !flat && bucket.mat !== 'chainlink';
    mesh.receiveShadow = shadows && bucket.mat !== 'emissive';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    const owner = key.split('|')[0];
    if (owner.startsWith('dyn:')) {
      const id = owner.slice(4);
      const list = props.get(id) ?? [];
      list.push(mesh);
      props.set(id, list);
    } else if (owner.startsWith('egrp:')) {
      const id = owner.slice(5);
      const list = emissiveGroups.get(id) ?? [];
      list.push(mesh);
      emissiveGroups.set(id, list);
    }
  }

  // Terrain
  if (b.terrain) {
    const t = b.terrain;
    const n1 = t.n + 1;
    const pos = new Float32Array(n1 * n1 * 3);
    const col = new Float32Array(n1 * n1 * 3);
    const uv = new Float32Array(n1 * n1 * 2);
    // One repeat of the ground every 2.5 m: the size the photographed ground materials were shot at.
    const uvs = 0.4;
    for (let iz = 0; iz < n1; iz++) {
      for (let ix = 0; ix < n1; ix++) {
        const i = iz * n1 + ix;
        const x = t.minX + ix * t.cell;
        const z = t.minZ + iz * t.cell;
        const h = t.h[i];
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        uv[i * 2] = x * uvs;
        uv[i * 2 + 1] = z * uvs;
        const c = b.terrainColor ? b.terrainColor(x, z, h, t.slopeAt(x, z)) : [1, 1, 1];
        col[i * 3] = c[0];
        col[i * 3 + 1] = c[1];
        col[i * 3 + 2] = c[2];
      }
    }
    const idx = new Uint32Array(t.n * t.n * 6);
    let k = 0;
    for (let iz = 0; iz < t.n; iz++) {
      for (let ix = 0; ix < t.n; ix++) {
        const a = iz * n1 + ix;
        idx[k++] = a;
        idx[k++] = a + n1;
        idx[k++] = a + 1;
        idx[k++] = a + 1;
        idx[k++] = a + n1;
        idx[k++] = a + n1 + 1;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, lib.get(b.terrainMat));
    mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // Instanced vegetation / rocks
  const byKind = new Map<string, typeof b.instances>();
  for (const inst of b.instances) {
    const list = byKind.get(inst.kind) ?? [];
    list.push(inst);
    byKind.set(inst.kind, list);
  }
  if (byKind.size) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    disposables.push(mat);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const [kind, list] of byKind) {
      const geo = instanceGeometry(kind);
      disposables.push(geo);
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it.yaw);
        m4.compose(new THREE.Vector3(it.x, it.y - 0.05, it.z), q, new THREE.Vector3(it.s, it.s, it.s));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setRGB(it.tint[0], it.tint[1], it.tint[2]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadows;
      im.receiveShadow = shadows;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  // Water
  const water: THREE.Mesh[] = [];
  let waterMat: THREE.ShaderMaterial | null = null;
  if (b.water.length) {
    waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(look.deep) },
        uSky: { value: new THREE.Color(look.sky) },
        uSunDir: { value: look.sunDir },
        uSunColor: { value: new THREE.Color(look.sunColor) },
        uFogColor: { value: new THREE.Color(look.fogColor) },
        uFogDensity: { value: look.fogDensity },
      },
    });
    disposables.push(waterMat);
    for (const w of b.water) {
      const geo = new THREE.PlaneGeometry(w.w, w.d).rotateX(-Math.PI / 2);
      disposables.push(geo);
      const m = new THREE.Mesh(geo, waterMat);
      m.position.set(w.x, w.y, w.z);
      group.add(m);
      water.push(m);
    }
  }

  // Lamp glows: one additive point cloud.
  let glows: THREE.Points | null = null;
  const glowGroups = new Map<string, number[]>();
  let glowBase: Float32Array | null = null;
  if (b.glows.length) {
    const n = b.glows.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const c = new THREE.Color();
    b.glows.forEach((g, i) => {
      pos.set([g.x, g.y, g.z], i * 3);
      c.setHex(g.color);
      col.set([c.r * 1.6, c.g * 1.6, c.b * 1.6], i * 3);
      size[i] = g.size;
      if (g.group) {
        const list = glowGroups.get(g.group) ?? [];
        list.push(i);
        glowGroups.set(g.group, list);
      }
    });
    glowBase = col.slice();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const tex = makeSprite('glow', 64);
    const mat = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uMap: { value: tex }, uScale: { value: 600 } }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    disposables.push(geo, mat, tex);
    glows = new THREE.Points(geo, mat);
    glows.frustumCulled = false;
    group.add(glows);
  }

  return {
    group,
    props,
    emissiveGroups,
    glows,
    glowGroups,
    water,
    update(time: number) {
      if (waterMat) waterMat.uniforms.uTime.value = time;
      if (glows) (glows.material as THREE.ShaderMaterial).uniforms.uScale.value = viewportH() * 0.9;
    },
    setGroup(name: string, on: boolean) {
      for (const m of emissiveGroups.get(name) ?? []) m.visible = on;
      const list = glowGroups.get(name);
      if (list && glows && glowBase) {
        const attr = glows.geometry.attributes.color as THREE.BufferAttribute;
        for (const i of list) for (let k = 0; k < 3; k++) (attr.array as Float32Array)[i * 3 + k] = on ? glowBase[i * 3 + k] : 0;
        attr.needsUpdate = true;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
