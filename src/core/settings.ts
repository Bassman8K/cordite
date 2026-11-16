// Persistent settings + campaign progress (localStorage). Everything degrades gracefully if
// storage is unavailable (private browsing, sandboxed webviews).

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type Difficulty = 'recruit' | 'regular' | 'veteran' | 'realist';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint'
  | 'fire' | 'ads' | 'reload' | 'interact' | 'melee' | 'grenade' | 'medkit'
  | 'primary' | 'secondary' | 'swap' | 'next' | 'prev' | 'firemode' | 'flashlight' | 'pause' | 'map';

export const DEFAULT_BINDS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  interact: ['KeyE'],
  melee: ['KeyV', 'Mouse3'],
  grenade: ['KeyG'],
  medkit: ['KeyH'],
  primary: ['Digit1'],
  secondary: ['Digit2'],
  swap: ['KeyQ'],
  next: ['WheelDown'],
  prev: ['WheelUp'],
  firemode: ['KeyB'],
  flashlight: ['KeyF'],
  pause: ['Escape', 'KeyP'],
  map: ['Tab'],
};

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump / vault', crouch: 'Crouch',
  sprint: 'Sprint / steady aim', fire: 'Fire', ads: 'Aim down sights', reload: 'Reload', interact: 'Interact', melee: 'Melee',
  grenade: 'Throw grenade', medkit: 'Use medkit', primary: 'Primary weapon', secondary: 'Secondary weapon', swap: 'Last weapon',
  next: 'Next weapon', prev: 'Previous weapon', firemode: 'Fire mode', flashlight: 'Flashlight', pause: 'Pause', map: 'Objectives',
};

export interface Settings {
  /** Settings schema version, used to migrate old saves. */
  v: number;
  quality: Quality;
  renderScale: number;
  shadows: boolean;
  postfx: boolean;
  fov: number;
  fpsCap: number;
  showFps: boolean;
  sens: number;
  adsSens: number;
  invertY: boolean;
  toggleAds: boolean;
  toggleCrouch: boolean;
  master: number;
  sfx: number;
  music: number;
  difficulty: Difficulty;
  crosshair: boolean;
  radar: boolean;
  subtitles: boolean;
  blood: boolean;
  aimAssist: boolean;
  autoFire: boolean;
  bob: boolean;
  god: boolean;
  infiniteAmmo: boolean;
  unlockAll: boolean;
  binds: Record<Action, string[]>;
}

export interface ChapterRecord {
  done: boolean;
  bestTime: number;
  bestGrade: string;
  bestAccuracy: number;
}

export interface Checkpoint {
  chapter: string;
  stage: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  armor: number;
  medkits: number;
  grenades: number;
  time: number;
  stats: { shots: number; hits: number; kills: number; headshots: number; deaths: number };
}

export interface Loadout {
  primary: string;
  secondary: string;
  melee: string;
  throwable: string;
}

export interface Progress {
  unlocked: number;
  chapters: Record<string, ChapterRecord>;
  loadout: Loadout;
  checkpoint: Checkpoint | null;
  totals: { kills: number; headshots: number; shots: number; playSeconds: number };
  seenIntro: boolean;
}

const SETTINGS_VERSION = 2;
const isTouch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in globalThis);
const mem = typeof navigator !== 'undefined' ? ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) : 8;
const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 8) : 8;

export function defaultSettings(): Settings {
  // Small machines start on the lighter tiers; anyone can change it in Settings, Video.
  const quality: Quality = isTouch ? (mem >= 6 ? 'medium' : 'low') : mem <= 4 || cores <= 4 ? 'medium' : 'high';
  return {
    v: SETTINGS_VERSION,
    quality,
    renderScale: isTouch ? 0.8 : 1,
    shadows: true,
    postfx: true,
    fov: 64,
    fpsCap: 0,
    showFps: false,
    sens: 1,
    adsSens: 0.75,
    invertY: false,
    toggleAds: isTouch,
    toggleCrouch: true,
    master: 0.9,
    sfx: 1,
    music: 0.55,
    difficulty: 'regular',
    crosshair: true,
    radar: true,
    subtitles: true,
    blood: true,
    aimAssist: isTouch,
    autoFire: isTouch,
    bob: true,
    god: false,
    infiniteAmmo: false,
    unlockAll: false,
    binds: structuredClone(DEFAULT_BINDS),
  };
}

export function defaultProgress(): Progress {
  return {
    unlocked: 1,
    chapters: {},
    loadout: { primary: 'm4a1', secondary: 'glock17', melee: 'kabar', throwable: 'm67' },
    checkpoint: null,
    totals: { kills: 0, headshots: 0, shots: 0, playSeconds: 0 },
    seenIntro: false,
  };
}

const KEY_SETTINGS = 'cordite.settings.v1';
const KEY_PROGRESS = 'cordite.progress.v1';

function read<T extends object>(key: string, base: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: play on without saving */
  }
}

type Listener = (key: keyof Settings) => void;

class Store {
  settings: Settings = read(KEY_SETTINGS, { ...defaultSettings(), v: 0 });
  progress: Progress = read(KEY_PROGRESS, defaultProgress());
  private listeners = new Set<Listener>();

  constructor() {
    // A save written before versioning (or a fresh install) arrives here as v0.
    if (this.settings.v !== SETTINGS_VERSION) {
      // v2: the default field of view was far too wide (78 degrees vertical), which made targets tiny.
      if (this.settings.fov > 72) this.settings.fov = defaultSettings().fov;
      this.settings.v = SETTINGS_VERSION;
      write(KEY_SETTINGS, this.settings);
    }
    // Merge in any binds added since the save was written.
    this.settings.binds = { ...structuredClone(DEFAULT_BINDS), ...this.settings.binds };
    this.progress.loadout = { ...defaultProgress().loadout, ...this.progress.loadout };
    this.progress.totals = { ...defaultProgress().totals, ...this.progress.totals };
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.settings[key] === value) return;
    this.settings[key] = value;
    write(KEY_SETTINGS, this.settings);
    for (const l of this.listeners) l(key);
  }

  saveSettings(): void {
    write(KEY_SETTINGS, this.settings);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  saveProgress(): void {
    write(KEY_PROGRESS, this.progress);
  }

  resetProgress(): void {
    this.progress = defaultProgress();
    this.saveProgress();
  }

  resetSettings(): void {
    this.settings = defaultSettings();
    write(KEY_SETTINGS, this.settings);
    for (const l of this.listeners) l('quality');
  }
}

export const store = new Store();
export const IS_TOUCH = isTouch;

/** Difficulty multipliers applied to enemy accuracy, damage dealt to the player and reaction time. */
export const DIFFICULTY: Record<Difficulty, { label: string; blurb: string; enemyAcc: number; dmgIn: number; react: number; regen: number }> = {
  recruit: { label: 'Recruit', blurb: 'Forgiving. Enemies react slowly and hit softly.', enemyAcc: 0.55, dmgIn: 0.45, react: 1.5, regen: 1.6 },
  regular: { label: 'Regular', blurb: 'The intended experience.', enemyAcc: 0.8, dmgIn: 0.7, react: 1.0, regen: 1 },
  veteran: { label: 'Veteran', blurb: 'Sharp enemies. Cover is not optional.', enemyAcc: 1.0, dmgIn: 1.0, react: 0.75, regen: 0.7 },
  realist: { label: 'Realist', blurb: 'Lethal ballistics both ways. No crosshair, no radar.', enemyAcc: 1.15, dmgIn: 1.6, react: 0.6, regen: 0.35 },
};
