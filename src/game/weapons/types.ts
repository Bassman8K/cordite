export type WeaponClass = 'handgun' | 'smg' | 'assault' | 'battle' | 'sniper' | 'classic' | 'shotgun' | 'mg' | 'launcher' | 'special' | 'melee' | 'thrown';

export const CLASS_LABEL: Record<WeaponClass, string> = {
  handgun: 'Handguns',
  smg: 'Submachine Guns',
  assault: 'Assault Rifles',
  battle: 'Battle & Marksman',
  sniper: 'Sniper & Anti-Materiel',
  classic: 'Classic Rifles',
  shotgun: 'Shotguns',
  mg: 'Machine Guns',
  launcher: 'Launchers',
  special: 'Special',
  melee: 'Melee',
  thrown: 'Thrown',
};
export const CLASS_ORDER: WeaponClass[] = ['handgun', 'smg', 'assault', 'battle', 'sniper', 'classic', 'shotgun', 'mg', 'launcher', 'special', 'melee', 'thrown'];

export type FireMode = 'auto' | 'semi' | 'burst2' | 'burst3' | 'bolt' | 'pump' | 'lever' | 'da' | 'sa' | 'single';
export type Feed = 'box' | 'drum' | 'pan' | 'belt' | 'helical' | 'tube' | 'internal' | 'enbloc' | 'cyl' | 'gate' | 'single' | 'double' | 'tank' | 'none';
export type Projectile = 'bullet' | 'rocket' | 'grenade' | 'flame' | 'arrow' | 'taser' | 'flare';
export type SoundClass = 'shotPistol' | 'shotMagnum' | 'shotSmg' | 'shotRifle' | 'shotBattle' | 'shotSniper' | 'shotAmr' | 'shotShotgun' | 'shotLmg' | 'shotMini' | 'shotSup' | 'shotLauncher' | 'shotThump' | 'shotBow' | 'shotTaser' | 'flame';

export interface Caliber {
  label: string;
  /** Projectile mass in grams (per pellet for shot). */
  g: number;
  /** Drag: fraction of speed lost per metre (dv/ds = -k v). */
  k: number;
  /** Depth of concrete-equivalent material the round can defeat, in metres. */
  pen: number;
  pellets?: number;
  /** Wound multiplier for projectiles that do not rely on energy (arrows, bolts). */
  mul?: number;
  proj?: Projectile;
  blast?: { r: number; dmg: number; fire?: boolean; stun?: boolean };
}

export interface Look {
  style: string;
  opts: Set<string>;
}

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  slot: 'gun' | 'melee' | 'thrown';
  country: string;
  year: number;
  cal: string;
  calLabel: string;
  /** Unloaded mass in kg. */
  mass: number;
  /** Overall length and barrel length in metres. */
  length: number;
  barrel: number;
  rpm: number;
  /** Muzzle velocity m/s. */
  mv: number;
  mag: number;
  modes: FireMode[];
  feed: Feed;
  look: Look;
  // ---- derived handling
  damage: number;
  pellets: number;
  bulletG: number;
  drag: number;
  pen: number;
  range: number;
  moa: number;
  recoil: number;
  recoilH: number;
  hipSpread: number;
  adsSpread: number;
  /** Pellet cone in degrees for shot. */
  pattern: number;
  adsTime: number;
  reload: number;
  reloadEmpty: number;
  /** Seconds per round for tube / gate loading (0 = whole magazine at once). */
  perRound: number;
  /** Seconds to work a manual action between shots (0 for self-loaders). */
  cycle: number;
  mobility: number;
  zoom: number;
  scoped: boolean;
  suppressed: boolean;
  reserve: number;
  proj: Projectile;
  blast: Caliber['blast'] | null;
  sound: SoundClass;
  /** Seconds of barrel spin-up before firing (rotary guns). */
  spin: number;
  /** Delay between trigger and release (bows). */
  draw: number;
  /** Launcher that is discarded after one shot. */
  disposable: boolean;
  guided: boolean;
  tracer: number;
  // ---- melee
  meleeDamage: number;
  meleeRange: number;
  meleeTime: number;
  // ---- thrown
  throwKind: 'frag' | 'impact' | 'stun' | 'fire' | 'smoke' | 'remote' | 'mine' | '';
  fuse: number;
  carry: number;
  // ---- normalised 0..1 bars for the armory
  bars: { damage: number; range: number; accuracy: number; rate: number; mobility: number; control: number };
  /** Muzzle energy in joules, shown in the armory. */
  energy: number;
}
