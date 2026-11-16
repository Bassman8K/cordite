import type { LevelBuilder } from '../../world/builder';
import type { RGB } from '../../world/geo';
import { ammoCrate, apc, barrels, C, consoleDesk, crate, crateCluster, crater, door, explosiveBarrel, fence, floodlight, generator, heli, helipad, house, jersey, lamp, pallet, rock, rubble, sandbags, table, tent, truck } from '../../world/props';
import { kill, reach, survive, use, type ChapterDef } from './types';

const PI = Math.PI;
const STONE: RGB = [0.6, 0.58, 0.54];

function crenels(b: LevelBuilder, x1: number, z1: number, x2: number, z2: number, y: number): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.floor(len / 3);
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    b.box(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, 1.2, 0.9, 1.2, 'rock', { tint: STONE, collide: false, ao: 1 });
  }
}

function build(b: LevelBuilder): void {
  b.world.baseSurf = 'sand';
  b.playArea(-72, -82, 72, 96, true);
  const r = b.rng;
  b.flat(0, 7, 150, 184, 'sand', { y: 0 });
  b.flat(0, -12.5, 110, 115, 'concrete', { y: 0.02, tint: [0.72, 0.7, 0.66] });
  b.waterPlane(0, 0, 900, 900, -2.2);
  // Rocky shoreline either side of the headland
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1;
    rock(b, side * r.range(60, 71), r.range(-80, 95), r.range(1.4, 3.2));
  }
  for (let i = 0; i < 12; i++) rock(b, r.range(-70, 70), r.range(-81, -73), r.range(1.6, 3));

  // ================================================================ THE WALLS
  const WH = 7;
  const wall = (x1: number, z1: number, x2: number, z2: number, gaps?: number[][]) => {
    b.wall(x1, z1, x2, z2, WH, 'rock', { t: 2.6, tint: STONE, gaps, pen: 3 });
    crenels(b, x1, z1, x2, z2, WH);
  };
  wall(-55, 45, 55, 45, [[52, 58, 0, 5.4]]);
  wall(-55, 45, -55, -70);
  wall(55, 45, 55, -70);
  wall(-55, -70, 55, -70);
  // Gate towers and corner bastions
  for (const sx of [-1, 1]) {
    b.box(sx * 7.5, 0, 45.4, 7, 10, 7.5, 'rock', { tint: STONE, pen: 3 });
    crenels(b, sx * 7.5 - 3, 42, sx * 7.5 + 3, 42, 10);
    crenels(b, sx * 7.5 - 3, 48.8, sx * 7.5 + 3, 48.8, 10);
    b.box(sx * 55, 0, 45, 10, 9, 10, 'rock', { tint: STONE, pen: 3 });
    b.box(sx * 55, 0, -70, 10, 9, 10, 'rock', { tint: STONE, pen: 3 });
    crenels(b, sx * 55 - 4.4, 49.4, sx * 55 + 4.4, 49.4, 9);
    b.glow(sx * 7.5, 10.6, 45.4, 0xffd9a0, 1.2);
  }
  door(b, 'gate', 0, 45, 0, 6, 5.4, C.brown);
  b.interact('gatecharge', 0, 1.2, 46.9, 'Plant a breaching charge on the gate', { kind: 'plant', hold: 2.2, radius: 3, enabled: false });
  b.zone('gate', 0, 52, 6.5);

  // ================================================================ THE BEACH (south)
  b.playerStart(4, 92.5, 0);
  sandbags(b, -1, 89.6, 9, 89.6, 1.1);
  rock(b, -5, 90.4, 1.6);
  for (const [x1, x2, z] of [[-34, -22, 73], [-8, 4, 74], [18, 30, 72], [-26, -14, 61], [8, 20, 60], [34, 44, 63]] as const) sandbags(b, x1, z, x2, z, 1.0);
  for (const [x, z] of [[-18, 82], [10, 84], [30, 80], [-40, 78], [0, 67], [-30, 66], [24, 66], [44, 74]] as const) {
    jersey(b, x, z, r.range(-0.6, 0.6), 1);
  }
  for (const [x, z] of [[-10, 79], [16, 70], [-22, 56], [6, 54], [38, 58], [-46, 66]] as const) crater(b, x, z, r.range(1.8, 2.8));
  apc(b, -14, 66.5, 0.5, [0.2, 0.2, 0.18]);
  b.emitter('smoke', -14, 2.4, 66.5, 1.6);
  b.emitter('fire', -14.5, 1.2, 66, 1.0);
  fence(b, -50, 86, -30, 86, 1.4, { barbed: true });
  fence(b, 22, 87, 46, 87, 1.4, { barbed: true });
  rubble(b, 36, 50, 3, 8, 'rock', STONE);
  rubble(b, -30, 49.5, 3, 8, 'rock', STONE);
  for (let i = 0; i < 9; i++) rock(b, r.range(-58, 58), r.range(52, 92), r.range(0.9, 1.7));
  b.pickup('ammo', -4, 73);
  b.pickup('medkit', 22, 71);

  // ================================================================ THE COURTYARD
  house(b, -36, 27, 18, 11, { h: 3.6, mat: 'brick', tint: [0.62, 0.58, 0.52], doors: [['e', 0, 1.4], ['n', 4, 1.3]], windows: [['e', -3.5], ['e', 3.5], ['s', 0], ['n', -4]], floor: 'planks', roof: 'gable', roofTint: C.rustc });
  ammoCrate(b, 'supply-court', -31, 23.4, 0);
  table(b, -40, 27, 0, 1.8, 0.8);
  b.light(-36, 3.0, 27, 0xffd9a0, 60, 12, { glow: 0.5 });
  tent(b, -30, 11, 0.1, 5, 7, C.olive);
  tent(b, -22.5, 11, 0.1, 5, 7, C.olive);
  truck(b, 34, 30, 0.2, C.olive, 'cargo');
  truck(b, 36, 20, -0.1, C.olive, 'fuel');
  apc(b, 28, 10.5, 1.4, C.olive);
  crateCluster(b, 20, 34, 6, 3);
  crateCluster(b, -14, 34, 5, 2.4);
  pallet(b, 14, 12, 0.4);
  barrels(b, 44, 12, 4, C.olive);
  explosiveBarrel(b, 39.4, 25);
  explosiveBarrel(b, 40.3, 25.6);
  sandbags(b, -12, 30, -4, 30, 1.0);
  sandbags(b, 4, 30, 12, 30, 1.0);
  sandbags(b, -3, 18, 3, 18, 1.0);
  jersey(b, -20, 22, 0.3, 2);
  jersey(b, 20, 24, -0.2, 2);
  b.cyl(0, 0, 23.5, 2.8, 0.6, 'rock', { sides: 14, tint: STONE });
  b.cyl(0, 0.6, 23.5, 0.14, 9, 'darkmetal', { sides: 6, collide: false });
  b.box(0.9, 8.2, 23.5, 1.6, 1.0, 0.04, 'fabric', { tint: [0.5, 0.06, 0.05], collide: false });
  for (const [x, z, yaw] of [[-50, 20, PI / 2], [50, 34, -PI / 2], [-50, -30, PI / 2], [50, -30, -PI / 2], [-22, 41, PI], [22, 41, PI]] as const) lamp(b, x, z, { yaw, h: 6.5, intensity: 200, color: 0xffd9a0 });
  floodlight(b, -8, 41, PI, { h: 5, intensity: 260 });
  floodlight(b, 8, 41, PI, { h: 5, intensity: 260 });

  // ================================================================ THE KEEP
  house(b, 0, -10, 40, 30, { h: 5, mat: 'brick', tint: [0.52, 0.5, 0.48], t: 0.8, doors: [['s', 0, 3.4], ['e', -6, 1.6], ['n', 9, 1.7]], windows: [['s', -12, 2.2], ['s', 12, 2.2], ['w', 0, 2.2], ['w', 8, 2.2], ['e', 6, 2.2]], floor: 'tile', upper: 2, lit: 0.18 });
  for (const x of [-11, 11]) for (const z of [-2, -10, -18]) b.box(x, 0, z, 1.0, 5, 1.0, 'rock', { tint: STONE, pen: 3 });
  table(b, 0, -14, 0, 6, 1.4, 'wood');
  consoleDesk(b, -15, -23.8, 0, 3.2);
  consoleDesk(b, 15, -23.8, 0, 3.2);
  crateCluster(b, -16, 0.5, 4, 1.4);
  crateCluster(b, 16, -4, 4, 1.4);
  b.box(0, 0, -21.5, 8, 0.4, 4, 'planks', { tint: C.brown });
  for (const [x, z] of [[-10, -6], [10, -6], [0, -18], [-10, -20], [10, -20]] as const) b.light(x, 4.4, z, 0xffcf96, 55, 13, { glow: 0.5 });
  b.pickup('medkit', -18, -22);
  b.pickup('armor', 18, 2);
  b.pickup('ammo', 6, 3);

  // ================================================================ NORTH TERRACE: uplink and helipad
  b.box(22, 0, -56, 0.6, 30, 0.6, 'grate', { tint: C.grey, pen: 0.2, uvs: 2 });
  for (let i = 1; i < 7; i++) b.box(22, i * 4.2, -56, 1.2, 0.1, 1.2, 'darkmetal', { collide: false });
  b.sphere(22.9, 24, -56, 1.5, 'paint', { tint: C.white, dome: true, squash: 0.5, collide: false });
  b.sphere(21.1, 19, -56, 1.2, 'paint', { tint: C.white, dome: true, squash: 0.5, collide: false });
  b.glow(22, 30.5, -56, 0xff2a1a, 2);
  house(b, 14, -48, 9, 7, { h: 3.2, mat: 'concrete', tint: [0.7, 0.7, 0.68], doors: [['s', 0, 1.4]], windows: [['w', 0], ['e', 0]], floor: 'tile' });
  consoleDesk(b, 14, -50.6, 0, 3.2);
  b.interact('uplink', 14, 1.1, -49.8, 'Upload the kill-code', { kind: 'terminal', hold: 2.4, radius: 2.6, enabled: false });
  b.light(14, 2.8, -48, 0x9fd8ff, 60, 11, { glow: 0.5 });
  ammoCrate(b, 'supply-uplink', 21, -44, PI / 2);
  generator(b, 28, -50, 0.2);
  sandbags(b, 6, -40, 12, -40, 1.0);
  sandbags(b, 16, -40, 24, -40, 1.0);
  sandbags(b, 27, -44, 27, -52, 1.0);
  sandbags(b, 3, -44, 3, -52, 1.0);
  crate(b, 30, -42, 1.1, { stack: 2 });
  helipad(b, -32, -50);
  heli(b, -32, -50, 0.5, [0.14, 0.15, 0.16]);
  crateCluster(b, -18, -60, 4, 1.6);
  jersey(b, -20, -40, 0, 2);
  jersey(b, -44, -38, 0.2, 1);
  b.zone('uplinkzone', 14, -45, 9);
  b.zone('helipad', -27, -46, 4.2);

  // ================================================================ forces
  for (const sx of [-1, 1]) {
    b.enemy('elitesniper', sx * 7.5, 44.6, { y: 10, hold: true, yawDeg: 180, group: 'wall' });
    b.enemy('eliteheavy', sx * 54, 46, { y: 9, hold: true, yawDeg: 180, group: 'wall' });
  }
  b.enemy('elite', -20, 60.2, { yawDeg: 180, group: 'beach', crouch: true });
  b.enemy('elite', 14, 59.2, { yawDeg: 180, group: 'beach', crouch: true });
  b.enemy('elite', 39, 62.2, { yawDeg: 180, group: 'beach', crouch: true });
  b.enemy('eliterusher', -2, 62, { yawDeg: 180, group: 'beach' });
  b.enemy('rocketeer', 24, 56, { yawDeg: 180, group: 'beach' });

  b.enemy('elite', -8, 29, { yawDeg: 180, group: 'court', crouch: true });
  b.enemy('elite', 8, 29, { yawDeg: 180, group: 'court', crouch: true });
  b.enemy('eliteheavy', 0, 17, { yawDeg: 180, group: 'court' });
  b.enemy('elite', -24, 20, { yawDeg: 160, group: 'court' });
  b.enemy('elite', 22, 26, { yawDeg: 200, group: 'court' });
  b.enemy('eliterusher', -14, 37, { yawDeg: 180, group: 'court' });
  b.enemy('eliterusher', 16, 37, { yawDeg: 180, group: 'court' });
  b.enemy('shotgunner', -28, 25, { yawDeg: 120, group: 'court' });
  b.enemy('rocketeer', 40, 14, { yawDeg: 220, group: 'court' });
  b.enemy('elite', 30, 34, { yawDeg: 220, group: 'court' });

  b.enemy('boss', 0, -20, { yawDeg: 180, group: 'boss', id: 'rusk' });
  b.enemy('elite', -8, -16, { yawDeg: 180, group: 'boss' });
  b.enemy('elite', 8, -16, { yawDeg: 180, group: 'boss' });
  b.enemy('eliteheavy', 0, -8, { yawDeg: 180, group: 'boss' });
  b.enemy('eliterusher', -14, -4, { yawDeg: 180, group: 'boss' });
  b.enemy('eliterusher', 14, -4, { yawDeg: 180, group: 'boss' });

  const wave = (group: string, list: Array<[string, number, number]>) => {
    for (const [type, x, z] of list) b.enemy(type, x, z, { yawDeg: 0, group });
  };
  wave('w1', [['elite', -40, -8], ['elite', -44, -14], ['eliterusher', -36, -18], ['elite', 40, -8], ['eliterusher', 44, -16]]);
  wave('w2', [['eliteheavy', -42, -4], ['elite', -38, -10], ['eliterusher', -46, -20], ['elite', 42, -6], ['elite', 38, -12], ['rocketeer', 46, -2]]);
  wave('w3', [['eliterusher', -40, -22], ['eliterusher', 40, -22], ['elite', -44, -10], ['elite', 44, -10], ['eliteheavy', 42, -16], ['elitesniper', -46, -4]]);
  wave('pad', [['elite', -40, -44], ['eliterusher', -24, -58], ['elite', -44, -58]]);
}

export const ch6: ChapterDef = {
  id: 'last-light',
  n: 6,
  title: 'Last Light',
  codename: 'TERMINUS',
  location: 'Cape Solace fortress',
  clock: '05:40',
  tagline: 'One unit left. One man who knows how to use it.',
  brief: [
    'Major Rusk has the last working LANTERN unit at Cape Solace, an old coastal fort Corvane uses as its sale room. The buyers arrive at sunrise.',
    'Cross the beach, blow the gate, and clear the courtyard. Rusk will be in the keep. With him dead, the uplink mast on the north terrace will take the kill-code that bricks LANTERN for good. Then steal his helicopter.',
  ],
  intel: [
    'Snipers on both gate towers and machine guns on the corner bastions cover the beach. Move between sandbags and craters; do not stop in the open.',
    'Rusk wears heavy plate and carries an automatic shotgun. Keep your distance and use something that penetrates.',
    'Two resupply crates: the barracks hut in the courtyard, and beside the uplink.',
  ],
  recommended: { primary: 'mk48', secondary: 'm32' },
  env: {
    skyTop: 0x31507f, skyHorizon: 0xffb48c, skyBottom: 0x2a2c38,
    sunDir: [-0.82, 0.17, 0.3], sunColor: 0xffc49a, sunIntensity: 4.0, sunDisc: 12,
    hemiSky: 0xb9c2dc, hemiGround: 0x5a4c44, hemiIntensity: 1.9,
    fogColor: 0xcda592, fogDensity: 0.0058,
    stars: 0.06, clouds: 0.5, cloudColor: 0xffc6b0,
    envIntensity: 1.0, exposure: 0.9,
    grade: { tint: [1.04, 1.0, 0.97], contrast: 1.08, saturation: 1.0 },
    reverb: 'open', ambience: ['ambWaves:0.4', 'ambWind:0.2', 'battle'], shadowRange: 64, musicRoot: 38,
  },
  visibility: 1.1,
  seed: 6607,
  build,
  stages: [
    {
      id: 'beach',
      objective: 'Cross the beach to the fortress gate',
      done: reach('gate'),
      enter: (m) => {
        m.spawn('wall', 'beach');
        m.after(2.5, () => m.alert('wall', 'beach'));
        m.radio('OVERWATCH', 'Cape Solace. Gate is dead ahead, two hundred metres. Snipers on the gate towers, guns on the corners. This is the last one, Kestrel.', 1.2);
        m.radio('RUSK', 'One man. They sent one man. Somebody shoot him.', 9);
      },
    },
    {
      id: 'breach',
      objective: 'Blow the gate',
      done: use('gatecharge'),
      enter: (m) => {
        m.enable('gatecharge');
        m.spawn('court');
        m.radio('OVERWATCH', 'You are at the gate. Put a charge on it and stand clear.', 0.6);
      },
      exit: (m) => {
        m.explodeAt('gatecharge', 8, 320);
        m.openDoor('gate');
      },
    },
    {
      id: 'courtyard',
      objective: 'Clear the courtyard',
      done: kill('court'),
      enter: (m) => {
        m.after(0.8, () => m.alert('court'));
        m.radio('OVERWATCH', 'Gate is down. Courtyard is full of his best people. Barracks hut on your left has a crate.', 1.2);
      },
    },
    {
      id: 'rusk',
      objective: 'Eliminate Major Rusk',
      marker: 'rusk',
      done: kill('boss'),
      enter: (m) => {
        m.spawn('boss');
        m.radio('RUSK', 'You have cost me a great deal of money. Come inside. Let us settle the account.', 0.8);
        m.radio('OVERWATCH', 'He is in the keep, the big hall. He is armoured head to foot. Do not let him close the distance.', 7);
      },
    },
    {
      id: 'uplink',
      objective: 'Upload the kill-code at the uplink mast',
      done: use('uplink'),
      enter: (m) => {
        m.enable('uplink');
        m.radio('OVERWATCH', 'Rusk is down. Uplink hut is under the mast on the north terrace, out the back of the keep.', 1);
      },
    },
    {
      id: 'defend',
      objective: 'Defend the uplink until the upload completes',
      marker: 'uplinkzone',
      done: survive(92),
      enter: (m) => {
        m.radio('OVERWATCH', 'Code is going up. Ninety seconds and LANTERN is a paperweight. What is left of Corvane is coming for that hut.', 0.5);
        m.after(4, () => {
          m.spawn('w1');
          m.alert('w1');
        });
        m.after(34, () => {
          m.spawn('w2');
          m.alert('w2');
          m.radio('OVERWATCH', 'More from both flanks. Half way.', 0);
        });
        m.after(62, () => {
          m.spawn('w3');
          m.alert('w3');
          m.radio('OVERWATCH', 'Last of them. Hold.', 0);
        });
      },
    },
    {
      id: 'extract',
      objective: "Take Rusk's helicopter",
      done: reach('helipad'),
      enter: (m) => {
        m.spawn('pad');
        m.after(1, () => m.alert('pad'));
        m.radio('OVERWATCH', 'Upload confirmed. LANTERN is dead, every copy. His helicopter is on the pad, west side. Come home, Kestrel.', 0.8);
      },
    },
  ],
  debrief: 'LANTERN is gone: the prototype, the source, the last unit and the man selling it. Somewhere over the water the sun is coming up, and nobody below it knows how close it was.',
  menuCam: { x: 0, y: 27, z: 14, r: 72 },
  accent: '#ff8a70',
  par: 780,
};
