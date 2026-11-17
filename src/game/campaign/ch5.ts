import type { LevelBuilder } from '../../world/builder';
import { ammoCrate, barrels, bunk, C, ceilingLight, consoleDesk, crate, crateCluster, door, explosiveBarrel, generator, gridMap, serverRack, shelf, table } from '../../world/props';
import { reach, use, type ChapterDef } from './types';

const PI = Math.PI;
const CELL = 2.5;
const COLS = 40;
const ROWS = 33;
const HEIGHT = 3.8;

/** The facility is authored as carved rectangles on a grid, then turned into walls by gridMap. */
function plan(): string[] {
  const g: string[][] = Array.from({ length: ROWS }, () => Array<string>(COLS).fill('#'));
  const carve = (c0: number, r0: number, c1: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = '.';
  };
  const put = (c: number, r: number, ch: string) => (g[r][c] = ch);
  carve(1, 1, 5, 2); // service exit
  carve(3, 3, 3, 12); // service tunnel, north-south
  carve(3, 12, 10, 12); // service tunnel, east-west
  carve(12, 5, 27, 14); // test chamber
  for (const [c, r] of [[15, 7], [15, 12], [24, 7], [24, 12]]) put(c, r, '#');
  carve(20, 16, 20, 17); // chamber approach
  carve(14, 18, 26, 21); // security hall
  carve(28, 19, 29, 19); // lab corridor
  carve(30, 14, 38, 24); // laboratories
  carve(35, 13, 35, 13);
  carve(33, 9, 38, 12); // data vault
  carve(8, 20, 13, 20); // west corridor
  carve(1, 17, 7, 23); // barracks
  carve(20, 22, 20, 27); // south corridor
  carve(17, 28, 23, 31); // lift lobby
  carve(21, 25, 26, 25);
  carve(22, 24, 26, 26); // storage
  carve(13, 24, 19, 26); // generator room
  // Doors
  put(27, 19, '1');
  put(20, 15, '2');
  put(11, 12, '3');
  // Lights: L = main circuit, r = alarm circuit
  const lights: Array<[number, number]> = [[20, 30], [20, 26], [20, 23], [16, 19], [20, 20], [24, 19], [10, 20], [4, 18], [4, 22], [15, 25], [24, 25], [28, 19], [32, 16], [36, 16], [32, 22], [36, 22], [35, 10], [14, 6], [20, 6], [26, 6], [14, 13], [20, 13], [26, 13], [20, 10], [6, 12], [3, 8], [3, 4], [3, 1]];
  for (const [c, r] of lights) put(c, r, 'L');
  for (const [c, r] of [[20, 28], [20, 21], [16, 21], [25, 21], [12, 20], [29, 19], [17, 9], [23, 9], [9, 12], [3, 10], [3, 6], [4, 2]]) put(c, r, 'r');
  return g.map((row) => row.join(''));
}

function build(b: LevelBuilder): void {
  b.world.baseSurf = 'concrete';
  const rows = plan();
  const cx = (c: number) => -(COLS * CELL) / 2 + (c + 0.5) * CELL;
  const cz = (r: number) => -(ROWS * CELL) / 2 + (r + 0.5) * CELL;
  b.playArea(-(COLS * CELL) / 2, -(ROWS * CELL) / 2, (COLS * CELL) / 2, (ROWS * CELL) / 2, false);
  b.flat(0, 0, COLS * CELL, ROWS * CELL, 'tile', { y: 0, tint: [0.62, 0.64, 0.66] });
  b.box(0, HEIGHT, 0, COLS * CELL, 0.4, ROWS * CELL, 'panel', { tint: [0.4, 0.42, 0.45], uvs: 0.4 });
  gridMap(b, rows, CELL, HEIGHT, 'panel', [0.62, 0.65, 0.68], (ch, x, z) => {
    if (ch === 'L') ceilingLight(b, x, HEIGHT, z, { group: 'main', intensity: 24, range: 12, color: 0xdfe9ff, flicker: b.rng.chance(0.14) ? 0.05 : undefined });
    else if (ch === 'r') {
      b.flatDown(x, HEIGHT - 0.02, z, 0.5, 0.5, 0xff2a1a, 6, 'alarm');
      b.light(x, HEIGHT - 0.4, z, 0xff2a1a, 46, 11, { group: 'alarm', flicker: 0.5 });
    } else if (ch === '1') door(b, 'door1', x, z, PI / 2, CELL, HEIGHT - 0.4, C.yellow);
    else if (ch === '2') door(b, 'door2', x, z, 0, CELL, HEIGHT - 0.4, C.yellow);
    else if (ch === '3') door(b, 'door3', x, z, PI / 2, CELL, HEIGHT - 0.4, C.grey);
  });
  // Hazard stripes at each blast door
  for (const [c, r, horiz] of [[27, 19, false], [20, 15, true], [11, 12, false]] as const) b.flat(cx(c), cz(r), horiz ? CELL : 0.5, horiz ? 0.5 : CELL, 'paint', { y: 0.02, tint: C.yellow });

  // ---- lift lobby (start)
  b.playerStart(cx(20), cz(30.4), 0);
  b.box(cx(20), 0, cz(31) + 1.1, 3.2, 3.0, 0.2, 'metal', { tint: C.grey });
  b.flat(cx(20), cz(31) + 0.4, 3.4, 0.5, 'paint', { y: 0.02, tint: C.yellow });
  crateCluster(b, cx(17.6), cz(31), 2, 0.8);
  // Blast partition: breaks the line of sight from the corridor into the lift lobby.
  b.box(cx(20), 0, cz(28.2), 3.6, HEIGHT, 0.35, 'panel', { tint: [0.5, 0.52, 0.56] });
  // ---- storage and generator rooms off the south corridor
  crateCluster(b, cx(25), cz(24.3), 5, 2.0);
  crate(b, cx(26), cz(26), 1.1, { stack: 2 });
  explosiveBarrel(b, cx(23), cz(26.2));
  b.pickup('ammo', cx(24), cz(26));
  generator(b, cx(14), cz(24.2), 0, C.yellow);
  generator(b, cx(17), cz(24.2), 0, C.yellow);
  barrels(b, cx(13.3), cz(26), 3, C.olive);
  b.emitter('steam', cx(15.5), 2.6, cz(24.4), 0.8);
  // ---- security hall
  consoleDesk(b, cx(16), cz(18) - 0.6, 0, 4.2);
  b.interact('override', cx(16), 1.1, cz(18) + 0.2, 'Override the lockdown', { kind: 'terminal', hold: 1.8, radius: 2.6, enabled: false });
  table(b, cx(15), cz(21), 0, 1.8, 0.8);
  shelf(b, cx(26) + 0.8, cz(20.5), PI / 2, 2.4);
  b.box(cx(17), 0, cz(19.6), 2.2, 1.1, 0.5, 'panel', { tint: C.grey });
  b.box(cx(23), 0, cz(19.6), 2.2, 1.1, 0.5, 'panel', { tint: C.grey });
  b.zone('security', cx(20), cz(20), 5);
  // ---- barracks
  for (const r of [17.4, 19.2, 21, 22.8]) bunk(b, cx(1) + 0.3, cz(r), PI / 2);
  for (const r of [17.4, 22.8]) bunk(b, cx(5), cz(r), 0);
  ammoCrate(b, 'supply-barracks', cx(6.6), cz(20), PI / 2);
  shelf(b, cx(4), cz(23) + 0.9, 0, 2.6);
  b.pickup('medkit', cx(3), cz(20));
  b.pickup('armor', cx(6), cz(18));
  // ---- laboratories and the data vault
  for (const r of [15, 17.2]) serverRack(b, cx(32.5), cz(r), 0, 4);
  for (const r of [21, 23.2]) serverRack(b, cx(32.5), cz(r), 0, 4);
  consoleDesk(b, cx(37) + 0.3, cz(16), -PI / 2, 3.2);
  consoleDesk(b, cx(37) + 0.3, cz(22), -PI / 2, 3.2);
  table(b, cx(35.5), cz(19), 0, 2.2, 1.0, 'darkmetal');
  serverRack(b, cx(33.5), cz(9) - 0.5, 0, 3);
  serverRack(b, cx(33) - 0.4, cz(11), PI / 2, 2);
  consoleDesk(b, cx(36.8), cz(9) - 0.5, 0, 2.6);
  b.interact('core', cx(36.8), 1.1, cz(9) + 0.3, "Copy LANTERN's source", { kind: 'terminal', hold: 2.4, radius: 2.6, enabled: false });
  b.pickup('medkit', cx(38), cz(12));
  b.pickup('ammo', cx(30), cz(24));
  // ---- test chamber: the prototype on its plinth
  const px = cx(20);
  const pz = cz(8.5);
  b.cyl(px, 0, pz, 2.6, 0.4, 'darkmetal', { sides: 16 });
  b.cyl(px, 0.4, pz, 0.9, 2.2, 'paint', { sides: 12, tint: C.white, pen: 3 });
  for (const yy of [1.0, 1.6, 2.2]) b.cyl(px, yy, pz, 1.25, 0.12, 'darkmetal', { sides: 16, collide: false, caps: 3 });
  b.sphere(px, 3.0, pz, 0.55, 'emissive', { tint: [0.6, 5, 4.4], collide: false });
  b.light(px, 3.0, pz, 0x5fffe0, 90, 16, { glow: 2.2 });
  b.interact('device', px, 1.0, pz + 2.9, 'Plant the charge on LANTERN', { kind: 'plant', hold: 2.6, radius: 2.8, enabled: false });
  for (const [c, r] of [[13, 6], [26, 6], [13, 13], [26, 13]] as const) consoleDesk(b, cx(c), cz(r), c < 20 ? PI / 2 : -PI / 2, 2.4);
  crateCluster(b, cx(17), cz(11), 3, 1.2, 'crate', C.grey);
  crateCluster(b, cx(23.4), cz(11), 3, 1.2, 'crate', C.grey);
  b.box(cx(18), 0, cz(13.4), 3, 1.1, 0.5, 'panel', { tint: C.grey });
  b.box(cx(22), 0, cz(13.4), 3, 1.1, 0.5, 'panel', { tint: C.grey });
  // ---- service tunnel and the way out
  barrels(b, cx(7), cz(12) - 0.6, 2, C.rustc);
  b.zone('tunnel', cx(3), cz(1.4), 3.2);
  b.box(cx(3), 0, cz(1) - 1.15, 3, 3, 0.2, 'grate', { tint: C.grey, uvs: 2 });
  b.glow(cx(3), 3.2, cz(1), 0x39ff6a, 1.2);

  // ================================================================ forces
  const E = (type: string, c: number, r: number, group: string, yawDeg = 180, o: { crouch?: boolean; hold?: boolean } = {}) => b.enemy(type, cx(c), cz(r), { yawDeg, group, ...o });
  E('rifleman', 20, 23.4, 'entry');
  E('rifleman', 22.6, 25, 'entry', 90, { crouch: true });
  E('shotgunner', 25, 25, 'entry', 90);
  E('rifleman', 16, 25.4, 'entry', -90);
  E('elite', 17, 20.4, 'sec', 180, { crouch: true });
  E('elite', 23, 20.4, 'sec', 180, { crouch: true });
  E('eliterusher', 20, 19.2, 'sec');
  E('elite', 25, 18.4, 'sec', 200);
  E('rifleman', 4, 19, 'barracks', -90);
  E('rusher', 3, 22, 'barracks', -90);
  E('rifleman', 6, 21.4, 'barracks', -90);
  E('elite', 31, 19, 'labs', 90);
  E('elite', 34.6, 15.6, 'labs', 120);
  E('eliterusher', 35, 20.4, 'labs', 90);
  E('elite', 37, 23.6, 'labs', 60);
  E('eliterusher', 35, 11.4, 'labs', 0);
  E('elite', 37.4, 10.6, 'labs', 20);
  E('eliteheavy', 20, 11.6, 'chamber');
  E('elite', 14, 9, 'chamber', 150);
  E('elite', 26, 9, 'chamber', 210);
  E('elite', 17, 6, 'chamber', 170);
  E('eliterusher', 23, 6, 'chamber', 190);
  E('eliterusher', 13.4, 12.4, 'chamber', 120);
  E('eliterusher', 5, 12, 'escape', -90);
  E('elite', 3, 7, 'escape', 180);
  E('elite', 4, 1.6, 'escape', 180);
  E('eliterusher', 20, 18.8, 'chase', 0);
  E('elite', 18, 20, 'chase', 0);
}

export const ch5: ChapterDef = {
  id: 'black-site',
  n: 5,
  title: 'Black Site',
  codename: 'RETRIEVAL',
  location: 'Sub-level 3, beneath Kharan Flats',
  clock: '19:05',
  tagline: 'Bring a light. Leave nothing working.',
  brief: [
    'Under the airfield is the laboratory where Corvane rebuilt LANTERN from the stolen crates. The prototype is there, and so is the only complete copy of its source.',
    'Break the lockdown at the security station, pull the source from the data vault, then put a charge on the prototype itself. When it is armed you will have a little over a minute to reach the service tunnel.',
  ],
  intel: [
    'Corridors are tight and sight lines short: shotguns, submachine guns and carbines shine here. Your flashlight is on F.',
    'Corvane operators wear plate. Calibres that penetrate cut through it; pistol rounds mostly do not. Aim high.',
    'The barracks in the west wing has a resupply crate.',
  ],
  recommended: { primary: 'aa12', secondary: 'mp7' },
  env: {
    skyTop: 0x020304, skyHorizon: 0x05070a, skyBottom: 0x020304,
    sunDir: [0.2, 1, 0.2], sunColor: 0x000000, sunIntensity: 0, sunDisc: 0,
    hemiSky: 0x8fa0b4, hemiGround: 0x3a3f46, hemiIntensity: 0.55,
    fogColor: 0x05070a, fogDensity: 0.02,
    stars: 0, clouds: 0, cloudColor: 0x000000,
    envIntensity: 0.25, exposure: 1.12,
    grade: { tint: [0.95, 1.0, 1.05], contrast: 1.1, saturation: 0.85 },
    indoor: true, reverb: 'indoor', ambience: ['ambHum:0.35'], musicRoot: 35,
  },
  visibility: 0.7,
  seed: 5503,
  build,
  setup: (m) => {
    m.lights('alarm', false);
  },
  stages: [
    {
      id: 'descend',
      objective: 'Find the security station',
      done: reach('security'),
      enter: (m) => {
        m.spawn('entry', 'sec', 'barracks');
        m.radio('OVERWATCH', 'Signal is weak down there. Security station is north of the lift, at the junction. Every door past it is locked from that room.', 1.2);
        m.radio('RUSK', 'Attention, all staff. There is an intruder below ground. Security will shoot on sight. Stay out of their way.', 11, 'pa');
      },
    },
    {
      id: 'override',
      objective: 'Override the lockdown at the security terminal',
      done: use('override'),
      enter: (m) => {
        m.enable('override');
        m.radio('OVERWATCH', 'That is the station. The console on the north wall releases the lab door.', 0.6);
      },
      exit: (m) => {
        m.openDoor('door1');
      },
    },
    {
      id: 'core',
      objective: "Copy LANTERN's source from the data vault",
      done: use('core'),
      enter: (m) => {
        m.enable('core');
        m.spawn('labs');
        m.radio('OVERWATCH', 'Lab door is open, east side. Vault is at the back of the laboratories, past the server racks.', 0.6);
        m.radio('RUSK', 'You are in my vault, Kestrel. Look around you. Everything in that room was bought and paid for.', 14, 'pa');
      },
      exit: (m) => {
        m.openDoor('door2');
      },
    },
    {
      id: 'device',
      objective: 'Plant the charge on the LANTERN prototype',
      done: use('device'),
      enter: (m) => {
        m.enable('device');
        m.spawn('chamber');
        m.radio('OVERWATCH', 'I have the source. Chamber door just released: north of the station. The prototype is the thing that glows.', 0.8);
        m.radio('OVERWATCH', 'They have a gunner in there. Use the pillars.', 8);
      },
      exit: (m) => {
        m.openDoor('door3');
      },
    },
    {
      id: 'escape',
      objective: 'Get out through the service tunnel',
      done: reach('tunnel'),
      enter: (m) => {
        m.lights('main', false);
        m.lights('alarm', true);
        m.sound('alarm', undefined, 0.6);
        m.spawn('escape', 'chase');
        m.after(1, () => m.alert('escape', 'chase'));
        m.timer('Detonation', 80, () => m.fail('You were still inside when the charge went off.'));
        m.radio('OVERWATCH', 'Charge is armed. Eighty seconds. West door of the chamber, then follow the tunnel north to the green light. Run.', 0.4);
        m.radio('RUSK', 'You would bury it? Then the last one sells for double. Run, little bird.', 10, 'pa');
      },
      exit: (m) => {
        m.clearTimer();
      },
    },
  ],
  debrief: 'The prototype is slag and its source is ours. One working unit remains: the one Major Rusk took to Cape Solace to sell at dawn.',
  menuCam: { x: 0, y: 2.6, z: -18, r: 9 },
  accent: '#5fffe0',
  par: 540,
};
