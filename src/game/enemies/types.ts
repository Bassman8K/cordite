export type RGBA = [number, number, number];

export interface SoldierLook {
  uniform: RGBA;
  vest: RGBA;
  /** null = soft cap / balaclava only. */
  helmet: RGBA | null;
  face: RGBA;
  boots: RGBA;
  pack: boolean;
  visor: boolean;
}

export interface Archetype {
  id: string;
  name: string;
  hp: number;
  /** Fraction of torso damage absorbed by body armour (reduced by penetrating rounds). */
  armor: number;
  weapon: string;
  /** Run speed m/s. */
  speed: number;
  /** [too close, preferred, maximum] engagement distance in metres. */
  range: [number, number, number];
  /** Aim error in degrees once settled (lower = deadlier). */
  accuracy: number;
  burst: [number, number];
  pause: [number, number];
  /** 0 = holds ground, 1 = constantly pushes. */
  aggression: number;
  grenades: number;
  sight: number;
  scale: number;
  look: SoldierLook;
  /** Scoped enemies give themselves away with lens glint. */
  glint?: boolean;
  /** Seconds spent lining up before each shot (rockets, snipers). */
  aimTime?: number;
}

const MILITIA: SoldierLook = { uniform: [0.2, 0.22, 0.25], vest: [0.11, 0.12, 0.13], helmet: null, face: [0.34, 0.25, 0.2], boots: [0.05, 0.05, 0.05], pack: false, visor: false };
const PMC: SoldierLook = { uniform: [0.36, 0.31, 0.22], vest: [0.2, 0.19, 0.14], helmet: [0.27, 0.25, 0.18], face: [0.42, 0.3, 0.23], boots: [0.1, 0.08, 0.06], pack: true, visor: false };
const WINTER: SoldierLook = { uniform: [0.5, 0.53, 0.57], vest: [0.2, 0.22, 0.24], helmet: [0.46, 0.49, 0.53], face: [0.08, 0.08, 0.09], boots: [0.12, 0.12, 0.12], pack: true, visor: true };
const ELITE: SoldierLook = { uniform: [0.13, 0.14, 0.16], vest: [0.07, 0.075, 0.085], helmet: [0.09, 0.095, 0.105], face: [0.06, 0.06, 0.07], boots: [0.04, 0.04, 0.04], pack: false, visor: true };
const HEAVY: SoldierLook = { uniform: [0.16, 0.17, 0.15], vest: [0.08, 0.085, 0.075], helmet: [0.09, 0.095, 0.085], face: [0.04, 0.04, 0.04], boots: [0.04, 0.04, 0.04], pack: true, visor: true };

const base: Omit<Archetype, 'id' | 'name' | 'weapon' | 'look'> = {
  hp: 100, armor: 0, speed: 4.6, range: [6, 22, 70], accuracy: 2.6, burst: [2, 4], pause: [0.7, 1.6], aggression: 0.45, grenades: 0, sight: 1, scale: 1,
};

export const ARCHETYPES: Record<string, Archetype> = {
  guard: { ...base, id: 'guard', name: 'Dock guard', hp: 80, weapon: 'aks74u', accuracy: 3.4, range: [5, 16, 50], aggression: 0.35, look: MILITIA },
  rifleman: { ...base, id: 'rifleman', name: 'Rifleman', weapon: 'ak74m', grenades: 1, look: PMC },
  rusher: { ...base, id: 'rusher', name: 'Assaulter', hp: 85, weapon: 'vityaz', speed: 5.6, range: [2, 8, 30], accuracy: 3.6, burst: [4, 8], pause: [0.3, 0.8], aggression: 0.95, look: PMC },
  shotgunner: { ...base, id: 'shotgunner', name: 'Breacher', hp: 115, armor: 0.2, weapon: 'saiga12', speed: 5.0, range: [2, 7, 20], accuracy: 3.0, burst: [1, 2], pause: [0.6, 1.2], aggression: 0.85, look: PMC },
  marksman: { ...base, id: 'marksman', name: 'Marksman', hp: 90, weapon: 'svd', range: [25, 70, 170], accuracy: 0.75, burst: [1, 1], pause: [2.0, 3.6], aggression: 0.05, sight: 2.4, look: PMC, glint: true, aimTime: 1.5 },
  heavy: { ...base, id: 'heavy', name: 'Machine gunner', hp: 230, armor: 0.45, weapon: 'pkp', speed: 3.2, range: [8, 28, 90], accuracy: 3.0, burst: [7, 14], pause: [1.0, 2.0], aggression: 0.3, scale: 1.08, look: HEAVY },
  rocketeer: { ...base, id: 'rocketeer', name: 'Grenadier', weapon: 'rpg7', range: [18, 45, 110], accuracy: 1.6, burst: [1, 1], pause: [4.5, 7], aggression: 0.1, sight: 1.6, look: PMC, aimTime: 2.2 },
  officer: { ...base, id: 'officer', name: 'Officer', hp: 130, weapon: 'aps', accuracy: 2.4, range: [4, 14, 45], aggression: 0.4, look: { ...PMC, helmet: null, vest: [0.1, 0.1, 0.09] } },
  winter: { ...base, id: 'winter', name: 'Mountain trooper', weapon: 'ak12', grenades: 1, accuracy: 2.4, look: WINTER },
  wintermarksman: { ...base, id: 'wintermarksman', name: 'Mountain sniper', hp: 90, weapon: 'sv98', range: [30, 90, 220], accuracy: 0.6, burst: [1, 1], pause: [2.4, 4.0], aggression: 0, sight: 3, look: WINTER, glint: true, aimTime: 1.7 },
  elite: { ...base, id: 'elite', name: 'Corvane operator', hp: 140, armor: 0.3, weapon: 'scarl', speed: 5.0, accuracy: 2.0, burst: [3, 5], pause: [0.5, 1.2], aggression: 0.65, grenades: 2, sight: 1.2, look: ELITE },
  eliterusher: { ...base, id: 'eliterusher', name: 'Corvane breacher', hp: 130, armor: 0.3, weapon: 'mp7', speed: 5.9, range: [2, 9, 30], accuracy: 2.8, burst: [5, 9], pause: [0.3, 0.7], aggression: 1, look: ELITE },
  elitesniper: { ...base, id: 'elitesniper', name: 'Corvane sniper', hp: 110, armor: 0.2, weapon: 'awm', range: [30, 90, 220], accuracy: 0.5, burst: [1, 1], pause: [2.2, 3.6], aggression: 0, sight: 3, look: ELITE, glint: true, aimTime: 1.5 },
  eliteheavy: { ...base, id: 'eliteheavy', name: 'Corvane gunner', hp: 280, armor: 0.5, weapon: 'mk48', speed: 3.3, range: [8, 28, 90], accuracy: 2.7, burst: [8, 16], pause: [0.9, 1.8], aggression: 0.35, scale: 1.1, look: HEAVY },
  boss: { ...base, id: 'boss', name: 'Major Rusk', hp: 1100, armor: 0.55, weapon: 'aa12', speed: 4.2, range: [3, 12, 40], accuracy: 2.6, burst: [3, 6], pause: [0.5, 1.1], aggression: 0.8, grenades: 4, sight: 1.5, scale: 1.14, look: { ...HEAVY, uniform: [0.2, 0.05, 0.04], helmet: [0.12, 0.03, 0.03] } },
};
