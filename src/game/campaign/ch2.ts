import type { LevelBuilder } from '../../world/builder';
import { ammoCrate, barrels, block, C, car, consoleDesk, crate, crateCluster, crater, explosiveBarrel, house, jersey, lamp, pallet, rubble, sandbags, table, truck } from '../../world/props';
import type { RGB } from '../../world/geo';
import { kill, reach, survive, use, type ChapterDef } from './types';

const PI = Math.PI;
const WALLS: RGB[] = [[0.62, 0.58, 0.5], [0.55, 0.5, 0.46], [0.66, 0.62, 0.56], [0.5, 0.48, 0.47], [0.6, 0.52, 0.44], [0.48, 0.5, 0.52]];

function build(b: LevelBuilder): void {
  b.world.baseSurf = 'concrete';
  b.playArea(-52, -100, 52, 92, true);
  const r = b.rng;

  // ---- streets
  b.flat(0, -4, 104, 192, 'asphalt', { y: 0 });
  for (const sx of [-1, 1]) b.flat(sx * 7.75, 16, 1.5, 152, 'concrete', { y: 0.02, tint: [0.75, 0.75, 0.75] });
  for (let z = 86; z > -58; z -= 9) b.flat(0, z, 0.16, 4, 'paint', { y: 0.02, tint: [0.7, 0.7, 0.66] });
  for (const z of [40, -8]) b.flat(0, z, 100, 0.16, 'paint', { y: 0.02, tint: [0.55, 0.55, 0.52] });

  // ---- city blocks. Inner rows front the boulevard; outer rows are the skyline behind the alleys.
  const inner = (x: number, z: number, d: number, h: number) => block(b, x, z, 18, d, h, { tint: r.pick(WALLS), mat: r.chance(0.5) ? 'plaster' : 'brick', lit: 0.03 });
  const outer = (x: number, z: number, d: number, h: number) => block(b, x, z, 19, d, h, { tint: r.pick(WALLS), mat: 'plaster', lit: 0.02 });
  // South segment (z 44..90)
  inner(-17, 79, 22, 15);
  inner(-17, 56, 24, 12);
  inner(17, 80, 20, 18);
  inner(17, 57, 26, 11);
  // Middle segment west: cafe (enterable) + block
  house(b, -17, 24, 18, 20, { h: 3.4, mat: 'brick', tint: [0.7, 0.62, 0.55], doors: [['e', 0, 2.2], ['w', -5, 1.3]], windows: [['e', -6, 2.2], ['e', 6, 2.2], ['s', 0, 1.6]], upper: 3, lit: 0.04, floor: 'tile' });
  inner(-17, 5, 18, 14);
  // Middle segment east: block + clinic (single storey, flat roof)
  inner(17, 25, 22, 16);
  house(b, 17, 4, 18, 16, { h: 3.4, mat: 'plaster', tint: [0.8, 0.82, 0.8], doors: [['w', 0, 1.8], ['e', 4, 1.3]], windows: [['w', -5], ['w', 5], ['s', 0]], floor: 'tile' });
  // North segment, with narrow passages through to the back alleys at z = -35.5
  inner(-17, -24, 20, 13);
  inner(-17, -47.5, 21, 17);
  inner(17, -24, 20, 9);
  inner(17, -47.5, 21, 15);
  // Skyline
  for (const sx of [-1, 1]) {
    outer(sx * 40.5, 68, 44, r.range(18, 26));
    outer(sx * 40.5, 16, 40, r.range(16, 24));
    outer(sx * 40.5, -36, 48, r.range(18, 28));
  }
  // Street ends are choked with debris and barricades
  for (const [x, z, yaw] of [[0, 90.5, 0.05], [-48, 40, PI / 2], [48, 40, PI / 2], [-48, -8, PI / 2], [48, -8, PI / 2]] as const) {
    truck(b, x, z, yaw, C.rustc, 'cargo');
    rubble(b, x + (yaw ? 0 : 6), z + (yaw ? 3.5 : 0.5), 3.5, 9, 'concrete', [0.6, 0.58, 0.55]);
  }
  b.wall(-8, 91.4, 8, 91.4, 4, 'concrete', { t: 0.6 });

  // ---- hotel plaza (north)
  b.flat(0, -65, 34, 10, 'tile', { y: 0.02, tint: [0.7, 0.7, 0.68] });
  house(b, 0, -79, 32, 18, { h: 4.2, mat: 'plaster', tint: [0.78, 0.74, 0.62], doors: [['s', 0, 3.4], ['n', 10, 1.5]], windows: [['s', -11, 2.4], ['s', -6, 2.4], ['s', 6, 2.4], ['s', 11, 2.4], ['e', 0], ['w', 0]], upper: 4, lit: 0.12, floor: 'tile' });
  block(b, -33.5, -84, 35, 30, 22, { tint: WALLS[3], lit: 0.03 });
  block(b, 37, -79, 28, 20, 19, { tint: WALLS[1], lit: 0.03 });
  b.cyl(0, 0, -63.5, 2.6, 0.6, 'concrete', { sides: 14, tint: C.grey });
  b.cyl(0, 0.6, -63.5, 0.5, 1.4, 'concrete', { sides: 8, tint: C.grey, collide: false });
  // Lobby
  for (const x of [-9, 9]) for (const z of [-75, -83]) b.box(x, 0, z, 0.7, 4.2, 0.7, 'plaster', { tint: C.cream });
  b.box(-10, 0, -84.5, 7, 1.1, 1.0, 'wood', { tint: C.brown });
  consoleDesk(b, 8, -85.4, 0, 2.4);
  b.interact('uplink', 8, 1.1, -84.6, "Start Wren's uplink", { kind: 'terminal', hold: 1.5, radius: 2.6, enabled: false });
  ammoCrate(b, 'supply-hotel', -13, -73.5, PI / 2);
  for (const [x, z] of [[-4, -74], [4, -76], [0, -82], [-13, -80]] as const) table(b, x, z, r.range(0, 1.5), 1.4, 0.8);
  b.light(0, 3.8, -79, 0xffe2b0, 90, 16, { glow: 0.6 });
  b.light(-10, 3.8, -82, 0xffe2b0, 60, 12, { glow: 0.5 });
  b.zone('lobby', 0, -79, 7);
  // Service yard behind the hotel
  b.wall(16, -88, 52, -88, 3, 'brick', { t: 0.4, gaps: [] });
  crateCluster(b, 4, -93, 4, 2);
  barrels(b, 18, -95, 4);
  truck(b, -8, -95, 0.1, C.grey, 'cargo');
  b.zone('exfil', 30, -94.5, 4.5);

  // ---- battlefield dressing along the Mile
  const wrecks: Array<[number, number, number]> = [[-3.5, 76, 0.3], [4, 66, -0.5], [-2, 55, 1.4], [5, 47, 0.1], [-4.5, 31, -0.2], [3, 22, 0.9], [-1.5, 10, 0.4], [4.5, 1, -0.3], [-4, -14, 0.2], [2.5, -21, 1.1], [-3, -44, -0.4], [4, -52, 0.3]];
  for (const [x, z, yaw] of wrecks) car(b, x, z, yaw, C.rustc, true);
  car(b, -12, 40.5, PI / 2, [0.35, 0.1, 0.1], false);
  car(b, 13, -8.5, PI / 2 + 0.1, [0.15, 0.2, 0.3], false);
  for (const [x, z] of [[1, 60], [-5, 40], [4, 14], [-2, -4], [2, -36], [-9, -62], [9, -58]] as const) crater(b, x, z, r.range(1.6, 2.6));
  jersey(b, -3.5, 44.8, 0.05, 2);
  jersey(b, 4, 35.5, -0.08, 2);
  sandbags(b, -6.5, 62, -1.5, 62, 1.0);
  sandbags(b, 2, 51, 6.5, 51, 1.0);
  rubble(b, -7.5, 70, 2.6, 10, 'brick', [0.6, 0.45, 0.4]);
  rubble(b, 7.6, 18, 2.4, 9, 'concrete');
  rubble(b, -7.2, -18, 2.6, 10, 'brick', [0.6, 0.45, 0.4]);
  explosiveBarrel(b, 5.6, 34.2);
  explosiveBarrel(b, -5.8, -26.4);
  for (const z of [78, 54, 28, 4, -20, -44]) for (const sx of [-1, 1]) lamp(b, sx * 7.6, z + sx * 3, { yaw: sx > 0 ? -PI / 2 : PI / 2, on: false, h: 7 });
  // Back alleys: tight, cluttered, good for flanking
  for (const sx of [-1, 1]) {
    for (const z of [62, 24, -2, -30, -50]) {
      if (r.chance(0.6)) crate(b, sx * 28.5 + r.range(-1, 1), z + r.range(-4, 4), 1.1, { stack: r.int(1, 2), yaw: r.range(0, 1) });
      else pallet(b, sx * 28.5 + r.range(-0.8, 0.8), z + r.range(-4, 4), r.range(0, 3));
    }
    barrels(b, sx * 29.4, 12, 3);
  }
  // Cafe interior
  b.box(-22, 0, 18.5, 1.0, 1.1, 6, 'wood', { tint: C.brown });
  for (const [x, z] of [[-13, 19], [-13, 28], [-18, 29.5]] as const) table(b, x, z, 0, 1.2, 1.2);
  b.pickup('medkit', -22.6, 30);
  b.pickup('ammo', -11, 16);
  // Clinic interior
  for (const z of [0, 8]) b.box(21, 0, z, 2.0, 0.6, 0.9, 'fabric', { tint: C.white });
  b.pickup('medkit', 21, 4);
  b.pickup('medkit', 12, -1.5);
  b.pickup('armor', 23.5, 10);
  // Smoke on the skyline, fires in the street
  b.emitter('smoke', -40, 22, 60, 5);
  b.emitter('smoke', 42, 24, -30, 6);
  b.emitter('smoke', -34, 23, -80, 5);
  b.emitter('fire', 4, 0.6, 66, 1.2);
  b.emitter('fire', -3, 0.6, -44, 1.3);
  b.emitter('smoke', 4, 1.4, 66, 1.4);
  b.emitter('smoke', -3, 1.4, -44, 1.6);

  // ================================================================ forces
  b.playerStart(-2, 85, 0);
  b.zone('cross1', 0, 40, 9, { hw: 9, hd: 5 });
  // South segment
  b.enemy('rifleman', 4.5, 63, { yawDeg: 180, group: 'street1' });
  b.enemy('rifleman', -4, 61, { yawDeg: 180, group: 'street1', crouch: true });
  b.enemy('rifleman', -3, 52.5, { yawDeg: 170, group: 'street1' });
  b.enemy('rusher', 5.5, 49, { yawDeg: 190, group: 'street1' });
  b.enemy('rifleman', 3.5, 44, { yawDeg: 180, group: 'street1' });
  b.enemy('rusher', -28.5, 50, { yawDeg: 180, group: 'street1' });
  // Middle segment and overwatch
  b.enemy('rifleman', -5, 29, { yawDeg: 180, group: 'cross' });
  b.enemy('rifleman', 4.5, 19.5, { yawDeg: 180, group: 'cross' });
  b.enemy('shotgunner', -15, 22, { yawDeg: 90, group: 'cross' });
  b.enemy('marksman', 10.4, -2.2, { y: 3.65, hold: true, yawDeg: 160, group: 'cross' });
  b.enemy('rifleman', 28.5, 14, { yawDeg: 180, group: 'cross' });
  // The machine-gun nest
  sandbags(b, -4.5, -27.4, 4.5, -27.4, 1.05);
  sandbags(b, -4.6, -27.4, -4.6, -31.5, 1.05);
  sandbags(b, 4.6, -27.4, 4.6, -31.5, 1.05);
  b.enemy('heavy', 0, -29.2, { hold: true, yawDeg: 180, group: 'mg' });
  b.enemy('rifleman', -3.2, -30.5, { yawDeg: 180, group: 'mg' });
  b.enemy('rifleman', 3.2, -30.5, { yawDeg: 180, group: 'mg' });
  b.enemy('rifleman', -28.5, -22, { yawDeg: 180, group: 'mg', patrol: [[-28.5, -22], [-28.5, -44]] });
  b.zone('nest', 0, -29, 6);
  // Hotel plaza
  b.enemy('rifleman', -13, -65, { yawDeg: 180, group: 'hotelguard' });
  b.enemy('rifleman', 9, -66, { yawDeg: 180, group: 'hotelguard' });
  b.enemy('shotgunner', 0, -71.5, { yawDeg: 180, group: 'hotelguard' });
  b.enemy('rusher', -5, -77, { yawDeg: 180, group: 'hotelguard' });
  b.enemy('officer', 6, -80, { yawDeg: 180, group: 'hotelguard' });
  // Counter-attack waves on the hotel
  const wave = (group: string, list: Array<[string, number, number]>) => {
    for (const [type, x, z] of list) b.enemy(type, x, z, { yawDeg: 0, group });
  };
  wave('wave1', [['rifleman', -4, -40], ['rifleman', 4, -42], ['rusher', -28.5, -52], ['rusher', 28.5, -52], ['rifleman', 0, -46]]);
  wave('wave2', [['heavy', 0, -38], ['rifleman', -5, -36], ['rifleman', 5, -36], ['shotgunner', -28.5, -40], ['rusher', 28.5, -40], ['rifleman', 3, -50]]);
  wave('wave3', [['rusher', -3, -44], ['rusher', 3, -44], ['shotgunner', 0, -48], ['rifleman', -28.5, -56], ['rifleman', 28.5, -56], ['elite', 0, -40], ['elite', -5, -52]]);
  wave('chasers', [['rifleman', 24, -93], ['rusher', 36, -91], ['rifleman', 44, -96]]);
  b.pickup('ammo', 6.4, 41);
  b.pickup('grenade', -6.2, 12);
  b.pickup('ammo', -28.5, -36);
  b.pickup('medkit', 4, -60);
}

export const ch2: ChapterDef = {
  id: 'shattered-mile',
  n: 2,
  title: 'Shattered Mile',
  codename: 'CONTACT',
  location: 'Old town, Dravik',
  clock: '16:40',
  tagline: 'One boulevard. Every window is watching it.',
  brief: [
    "The manifest names a broker in Dravik who goes by Wren. Wren has the buyer's file, and wants out. Corvane has sealed the old town to stop that happening.",
    'The only way to the Hotel Meridian is the Mile, the boulevard that runs the length of the district. It is covered from end to end. Reach Wren, hold the lobby while the file comes down, then get out the back.',
  ],
  intel: [
    'A machine gun owns the boulevard north of the first cross street. The back alleys either side go around it.',
    'Burnt-out cars and rubble are cover. Plaster and car doors are not: rifle rounds go straight through.',
    'The hotel lobby has a resupply crate. Use it before the counter-attack.',
  ],
  recommended: { primary: 'scarh', secondary: 'm4bene' },
  env: {
    skyTop: 0x66717d, skyHorizon: 0xa9aeb0, skyBottom: 0x4a4d50,
    sunDir: [0.35, 0.8, 0.5], sunColor: 0xfff0dc, sunIntensity: 2.4, sunDisc: 0,
    hemiSky: 0xc4ccd4, hemiGround: 0x5a5650, hemiIntensity: 2.4,
    fogColor: 0x9a9fa2, fogDensity: 0.0105,
    stars: 0, clouds: 0.97, cloudColor: 0x8d9397,
    envIntensity: 0.9, exposure: 0.92,
    weather: 'dust', weatherAmount: 0.5,
    grade: { tint: [1.03, 1.0, 0.95], contrast: 1.08, saturation: 0.78 },
    reverb: 'urban', ambience: ['ambWind:0.22', 'battle'], shadowRange: 50, musicRoot: 36,
  },
  visibility: 1,
  seed: 2207,
  build,
  stages: [
    {
      id: 'advance',
      objective: 'Push up the Mile to the first cross street',
      done: reach('cross1'),
      enter: (m) => {
        m.spawn('street1');
        m.radio('OVERWATCH', 'You are at the south end of the Mile. Hotel Meridian is the tall cream block at the far end. Corvane is dug in between.', 1.2);
        m.radio('WREN', 'Whoever you are, hurry. They are going door to door.', 8);
      },
    },
    {
      id: 'mgnest',
      objective: 'Silence the machine-gun nest on the boulevard',
      marker: 'nest',
      done: kill('mg'),
      enter: (m) => {
        m.spawn('cross', 'mg');
        m.radio('OVERWATCH', 'Machine gun, sandbagged, dead ahead. Do not walk into that. Alleys left and right run north behind the buildings.', 0.8);
        m.radio('OVERWATCH', 'Marksman on the clinic roof, east side. One storey up.', 9);
      },
    },
    {
      id: 'hotel',
      objective: 'Reach the Hotel Meridian lobby',
      done: reach('lobby'),
      enter: (m) => {
        m.spawn('hotelguard');
        m.radio('OVERWATCH', 'Gun is down. Plaza ahead, hotel beyond it. Wren is in the lobby.', 0.8);
      },
    },
    {
      id: 'uplink',
      objective: "Start Wren's uplink at the lobby terminal",
      done: use('uplink'),
      enter: (m) => {
        m.enable('uplink');
        m.radio('WREN', 'You made it. The file is on the hotel server. I need ninety seconds on that terminal, and they will come for it.', 0.6);
        m.radio('OVERWATCH', 'Restock from the crate by the door before you start it.', 7);
      },
    },
    {
      id: 'hold',
      objective: 'Hold the lobby until the transfer completes',
      marker: 'lobby',
      done: survive(88),
      enter: (m) => {
        m.radio('WREN', 'Transfer is running. Keep them off me.', 0.5);
        m.after(4, () => {
          m.spawn('wave1');
          m.alert('wave1');
        });
        m.after(32, () => {
          m.spawn('wave2');
          m.alert('wave2');
          m.radio('OVERWATCH', 'Second group coming down the boulevard, heavy weapon with them.', 0);
        });
        m.after(60, () => {
          m.spawn('wave3');
          m.alert('wave3');
          m.radio('WREN', 'Seventy percent. Nearly there.', 0);
        });
      },
    },
    {
      id: 'exfil',
      objective: 'Leave through the service yard behind the hotel',
      done: reach('exfil'),
      enter: (m) => {
        m.spawn('chasers');
        m.after(1.5, () => m.alert('chasers'));
        m.radio('WREN', 'Done. I have it. Service door, north wall. Go, go.', 0.4);
        m.radio('OVERWATCH', 'File names the handover: a relay station on the Orlov Pass. That is where LANTERN gets its eyes.', 7);
      },
    },
  ],
  debrief: "Wren's file shows LANTERN needs a line of sight to the sky. Corvane has taken a military relay station high on the Orlov Pass to give it one.",
  menuCam: { x: 0, y: 17, z: 10, r: 46, sweep: [4.8, 0.13] },
  accent: '#ff9a4d',
  par: 600,
};
