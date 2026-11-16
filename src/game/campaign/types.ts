import type { Loadout } from '../../core/settings';
import type { EnvDef } from '../../gfx/sky';
import type { LevelBuilder } from '../../world/builder';
import type { Mission } from '../mission';

/** What has to be true for a stage to be complete. */
export type Cond =
  | { k: 'reach'; zone: string }
  | { k: 'kill'; groups: string[] }
  | { k: 'use'; id: string }
  | { k: 'destroy'; ids: string[] }
  | { k: 'survive'; seconds: number }
  | { k: 'all'; of: Cond[] }
  | { k: 'any'; of: Cond[] };

export const reach = (zone: string): Cond => ({ k: 'reach', zone });
export const kill = (...groups: string[]): Cond => ({ k: 'kill', groups });
export const use = (id: string): Cond => ({ k: 'use', id });
export const destroy = (...ids: string[]): Cond => ({ k: 'destroy', ids });
export const survive = (seconds: number): Cond => ({ k: 'survive', seconds });
export const all = (...of: Cond[]): Cond => ({ k: 'all', of });
export const any = (...of: Cond[]): Cond => ({ k: 'any', of });

/**
 * A stage is one objective. Each stage boundary is a checkpoint.
 * `enter` runs when the stage begins (spawns, radio). `exit` runs when it completes and should hold
 * every lasting change to the world (doors, lights, wreckage), because it is replayed silently when
 * a checkpoint further along is loaded.
 */
export interface StageDef {
  id: string;
  objective: string;
  done: Cond;
  /** Zone, interactable or prop the HUD marker points at. */
  marker?: string;
  enter?: (m: Mission) => void;
  exit?: (m: Mission) => void;
}

export interface ChapterDef {
  id: string;
  n: number;
  title: string;
  codename: string;
  location: string;
  clock: string;
  tagline: string;
  brief: string[];
  intel: string[];
  recommended: Partial<Loadout>;
  env: EnvDef;
  /** Multiplier on how far enemies can see (darkness, weather). */
  visibility: number;
  seed: number;
  build(b: LevelBuilder): void;
  /** Runs (silently) every time the chapter starts, before any stage: initial world state. */
  setup?: (m: Mission) => void;
  stages: StageDef[];
  debrief: string;
  /** Slow orbit used behind the menus: centre, height, radius. */
  /** Menu backdrop camera: orbits (x, y, z) at radius r, or swings about angle sweep[0] by ± sweep[1] radians. */
  menuCam: { x: number; y: number; z: number; r: number; sweep?: [number, number] };
  accent: string;
  /** Par time in seconds for an S rating. */
  par: number;
}
