import * as THREE from 'three';
import { getTexture, hasTexture } from './textures';

interface MatDef {
  tex?: string;
  color?: number;
  rough: number;
  metal: number;
  nScale?: number;
  double?: boolean;
  alphaTest?: number;
  env?: number;
}

const DEFS: Record<string, MatDef> = {
  concrete: { tex: 'concrete', rough: 0.93, metal: 0 },
  asphalt: { tex: 'asphalt', rough: 0.86, metal: 0 },
  brick: { tex: 'brick', rough: 0.9, metal: 0 },
  plaster: { tex: 'plaster', rough: 0.95, metal: 0 },
  tile: { tex: 'tile', rough: 0.38, metal: 0, env: 1.2 },
  panel: { tex: 'panel', rough: 0.5, metal: 0.15 },
  rock: { tex: 'rock', rough: 0.95, metal: 0 },
  metal: { tex: 'metal', rough: 0.5, metal: 0.75 },
  darkmetal: { tex: 'metal', color: 0x3c4046, rough: 0.52, metal: 0.85 },
  corrugated: { tex: 'corrugated', rough: 0.62, metal: 0.4 },
  rust: { tex: 'rust', rough: 0.92, metal: 0.25 },
  grate: { tex: 'grate', rough: 0.6, metal: 0.7 },
  paint: { tex: 'paint', rough: 0.55, metal: 0.2 },
  wood: { tex: 'planks', rough: 0.82, metal: 0 },
  planks: { tex: 'planks', rough: 0.85, metal: 0 },
  crate: { tex: 'crate', rough: 0.85, metal: 0 },
  sandbag: { tex: 'sandbag', rough: 1, metal: 0 },
  fabric: { tex: 'fabric', rough: 1, metal: 0 },
  rubber: { tex: 'rubber', rough: 0.9, metal: 0 },
  glass: { rough: 0.06, metal: 0.9, env: 1.6 },
  dirt: { tex: 'dirt', rough: 1, metal: 0 },
  sand: { tex: 'sand', rough: 1, metal: 0 },
  snow: { tex: 'snow', rough: 0.8, metal: 0 },
  grass: { tex: 'grass', rough: 1, metal: 0 },
  chainlink: { tex: 'chainlink', rough: 0.55, metal: 0.7, double: true, alphaTest: 0.5 },
};

/** Per-level material cache. Cheap Lambert shading on the lowest quality tier. */
export class MaterialLib {
  private cache = new Map<string, THREE.Material>();
  constructor(private readonly pbr: boolean) {}

  get(name: string): THREE.Material {
    const hit = this.cache.get(name);
    if (hit) return hit;
    let m: THREE.Material;
    if (name === 'emissive') {
      m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    } else {
      const d = DEFS[name] ?? DEFS.concrete;
      const tex = d.tex && hasTexture(d.tex) ? getTexture(d.tex) : null;
      if (this.pbr) {
        const sm = new THREE.MeshStandardMaterial({
          color: d.color ?? 0xffffff,
          roughness: d.rough,
          metalness: d.metal,
          vertexColors: true,
          map: tex?.map ?? null,
          normalMap: tex?.normalMap ?? null,
          side: d.double ? THREE.DoubleSide : THREE.FrontSide,
          alphaTest: d.alphaTest ?? 0,
          envMapIntensity: d.env ?? 1,
        });
        if (tex?.normalMap) sm.normalScale.setScalar(d.nScale ?? 1);
        m = sm;
      } else {
        m = new THREE.MeshLambertMaterial({
          color: d.color ?? 0xffffff,
          vertexColors: true,
          map: tex?.map ?? null,
          side: d.double ? THREE.DoubleSide : THREE.FrontSide,
          alphaTest: d.alphaTest ?? 0,
        });
      }
    }
    m.name = name;
    this.cache.set(name, m);
    return m;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}
