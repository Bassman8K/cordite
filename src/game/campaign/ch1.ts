import { ammoCrate, barrel, barrels, C, CONTAINER_TINTS, container, containerBlock, crate, crateCluster, explosiveBarrel, fence, floodlight, house, jeep, jersey, lamp, laptop, pallet, sandbags, shelf, table, tower, truck, wallLight, warehouse } from '../../world/props';
import type { LevelBuilder } from '../../world/builder';
import { reach, use, type ChapterDef } from './types';

const PI = Math.PI;

function build(b: LevelBuilder): void {
  b.world.baseSurf = 'concrete';
  b.playArea(-72, -80, 72, 70, false);
  const r = b.rng;

  // ---- ground, water and the quay edge
  b.flat(0, 6, 146, 128, 'asphalt', { y: 0 });
  b.waterPlane(0, -160, 600, 204, -1.35);
  b.box(0, -3, -58.4, 146, 3, 0.8, 'concrete', { collide: false });
  b.blocker(-72, -58.6, 13.4, -58.6);
  b.blocker(24.6, -58.6, 72, -58.6);
  b.blocker(13.4, -58.6, 13.4, -79.4);
  b.blocker(24.6, -58.6, 24.6, -79.4);
  b.blocker(13.4, -79.4, 24.6, -79.4);
  for (let x = -66; x <= 66; x += 12) if (x < 12 || x > 26) b.cyl(x, 0, -57.4, 0.22, 0.55, 'darkmetal', { collide: false, sides: 8 });
  // Painted quay line and lane markings
  b.flat(0, -56.2, 146, 0.35, 'paint', { y: 0.015, tint: [0.75, 0.62, 0.1] });
  for (const z of [25, 15, 5, -5, -15]) b.flat(-14, z, 84, 0.14, 'paint', { y: 0.015, tint: [0.5, 0.5, 0.5] });

  // ---- perimeter
  b.wall(-72, 70, 72, 70, 3.4, 'concrete', { t: 0.5 });
  b.wall(-72, 70, -72, -58, 3.4, 'concrete', { t: 0.5 });
  b.wall(72, 70, 72, -58, 3.4, 'concrete', { t: 0.5 });
  for (let x = -66; x <= 66; x += 11) b.box(x, 3.4, 70, 0.5, 0.5, 0.6, 'concrete', { collide: false });

  // ---- pier and the boat waiting at its end
  b.box(19, -0.45, -69, 11, 0.45, 21.5, 'planks', { collide: false, uvs: 0.4 });
  for (let z = -60; z >= -78; z -= 6) for (const x of [14.3, 23.7]) b.cyl(x, -3, z, 0.24, 3.6, 'wood', { collide: false, sides: 7, tint: C.brown });
  for (const x of [14.2, 23.8]) for (let z = -62; z >= -78; z -= 4) b.cyl(x, 0, z, 0.06, 0.9, 'darkmetal', { collide: false, sides: 5 });
  b.box(28.4, -1.75, -75, 2.5, 0.85, 7, 'rubber', { collide: false, tint: [0.12, 0.13, 0.14] });
  b.box(28.4, -0.95, -73.4, 1.3, 0.7, 1.4, 'paint', { collide: false, tint: C.dark });
  b.glow(28.4, 0.2, -78, 0x39ff6a, 0.9);
  lamp(b, 19, -70, { h: 5, yaw: PI, color: 0xcfe0ff, intensity: 180 });

  // ---- freighter moored along the east quay (scenery)
  b.box(52, -2.2, -73, 70, 9.5, 17, 'paint', { collide: false, tint: [0.16, 0.05, 0.04], uvs: 0.2 });
  b.box(52, 7.3, -73, 70, 0.6, 17.4, 'metal', { collide: false, tint: C.dark });
  b.box(74, 7.9, -73, 16, 9, 14, 'paint', { collide: false, tint: C.cream });
  for (let i = 0; i < 9; i++) b.at(65.96, -78 + i * 1.25, -PI / 2, () => b.panelGlow(0, 12.6, 0, 0.8, 0.7, 0xffe0a0, 2.2));
  for (let i = 0; i < 8; i++) {
    const lv = r.int(1, 3);
    for (let l = 0; l < lv; l++) b.box(22 + i * 6.3, 7.9 + l * 2.6, -73 + r.range(-3, 3), 6.06, 2.59, 2.44, 'corrugated', { collide: false, tint: r.pick(CONTAINER_TINTS) });
  }
  b.glow(86, 20, -73, 0xff2a1a, 1.6);

  // ================================================================ OUTER YARD (south)
  b.playerStart(-60, 63, 20);
  container(b, -52, 60, 0.12, C.rustc);
  container(b, -64, 55, PI / 2, C.navy);
  crateCluster(b, -44, 53, 4, 1.4);
  pallet(b, -56, 50, 0.3);
  // Guard shack by the gate
  house(b, -24, 60, 6, 5, { h: 2.8, doors: [['n', 0, 1.4]], windows: [['w', 0], ['e', 0], ['s', 0]], mat: 'plaster', tint: C.cream });
  b.light(-24, 2.3, 60, 0xffc98a, 40, 10, { glow: 0.8 });
  table(b, -24.6, 61.7, 0, 1.4, 0.7);
  // Motor pool
  truck(b, 8, 59, 0.14, C.olive, 'cargo');
  truck(b, 22, 61, -0.08, C.grey, 'fuel');
  truck(b, 34, 58, 0.3, C.tan, 'flat');
  jeep(b, 46, 46, 1.25, C.tan);
  barrels(b, 0, 46, 4);
  crateCluster(b, 28, 44, 5, 1.8);
  pallet(b, -6, 54, 1.1);
  pallet(b, -9, 55.5, 0.2);
  jersey(b, -30, 40, 0.1, 2);
  jersey(b, 16, 38, -0.05, 2);
  sandbags(b, 50, 54, 56, 54, 1.0);
  explosiveBarrel(b, 24.5, 64.5);
  explosiveBarrel(b, 25.3, 65.1);
  lamp(b, -42, 46, { yaw: PI / 2 });
  lamp(b, 4, 50, { yaw: 0 });
  lamp(b, 40, 62, { yaw: PI });
  floodlight(b, -6, 32.5, 0.5);
  floodlight(b, -20, 32.5, -0.5);
  const th = tower(b, 60, 62, 0, 5);
  b.light(60, th + 2.1, 62, 0xffd9a0, 30, 9);
  // Inner fence with the gate into the stacks
  fence(b, -72, 30, -14.5, 30, 2.6, { barbed: true });
  fence(b, -5.5, 30, 72, 30, 2.6, { barbed: true });
  b.box(-14.5, 0, 30, 0.3, 3, 0.3, 'darkmetal', {});
  b.box(-5.5, 0, 30, 0.3, 3, 0.3, 'darkmetal', {});
  b.zone('yard', -10, 24.5, 5.5);

  b.enemy('guard', -24, 56.2, { yawDeg: 180, group: 'start' });
  b.enemy('guard', -30, 47, { group: 'start', patrol: [[-30, 47], [18, 47], [18, 41], [-30, 41]] });
  b.enemy('guard', 12, 53, { yawDeg: 90, group: 'start' });
  b.enemy('guard', 14.5, 54.2, { yawDeg: -80, group: 'start' });
  b.enemy('guard', 44, 60, { group: 'start', patrol: [[44, 60], [44, 38], [58, 38], [58, 50]] });
  b.enemy('guard', 60, 62, { y: th, hold: true, yawDeg: 60, group: 'start', weapon: 'ak74m' });

  // ================================================================ CONTAINER STACKS
  const rows = [20, 10, 0, -10, -20];
  for (const z of rows) {
    for (let x = -62; x <= 27; x += 6.4) {
      if (Math.abs(x + 24) < 3.4 || Math.abs(x - 4) < 3.4) continue;
      const levels = r.chance(0.28) ? 3 : r.chance(0.55) ? 2 : 1;
      const open = levels === 1 && r.chance(0.2);
      for (let l = 0; l < levels; l++) container(b, x + r.range(-0.12, 0.12), z + r.range(-0.1, 0.1), open && r.chance(0.5) ? PI : 0, r.pick(CONTAINER_TINTS), { level: l, open: open && l === 0 });
    }
  }
  // Lane clutter: places to hide and things to hide behind
  crateCluster(b, -24, 15, 3, 1.0);
  barrels(b, 4.6, 4.6, 3);
  pallet(b, -24.4, -5, 0.4);
  crate(b, 5, -14.6, 1.1, { stack: 2 });
  jersey(b, -40, 25, 0, 1);
  pallet(b, 16, 25.2, 1.4);
  crateCluster(b, -52, 5, 3, 0.9);
  for (const [x, z, yaw] of [[-24, 26.5, 0], [4, 26.5, 0], [-24, -4.5, PI], [4, -4.5, PI], [-45, 5, PI / 2], [18, -15, -PI / 2], [-45, -15, PI / 2], [18, 5, -PI / 2]] as const) lamp(b, x, z, { yaw, h: 8, intensity: 300, range: 26 });
  // Service road east of the stacks
  for (const z of [22, 4, -14]) lamp(b, 33.5, z, { yaw: PI / 2, h: 7 });
  jersey(b, 36, 28, PI / 2, 1);

  b.enemy('guard', -24, 5, { group: 'yard', patrol: [[-24, 25], [-24, -25]] });
  b.enemy('guard', 4, -5, { group: 'yard', patrol: [[4, -25], [4, 25]] });
  b.enemy('guard', -40, 15, { group: 'yard', patrol: [[-58, 15], [-28, 15]] });
  b.enemy('guard', 14, 5, { group: 'yard', patrol: [[8, 5], [26, 5], [26, -5], [8, -5]] });
  b.enemy('guard', -10, -15, { group: 'yard', patrol: [[-20, -15], [0, -15]] });
  b.enemy('guard', -50, -5, { yawDeg: -90, group: 'yard' });
  b.enemy('guard', 36, 12, { group: 'yard', patrol: [[36, 24], [36, -18]], weapon: 'ak74m' });

  // ================================================================ HARBOR OFFICE (east)
  house(b, 52, 3, 16, 12, { h: 3.2, doors: [['w', 1.5, 1.5], ['s', -4, 1.4]], windows: [['w', -3], ['n', -3], ['n', 3], ['e', 0]], mat: 'brick', upper: 1, lit: 0.45, floor: 'tile' });
  b.wall(52, -3, 52, 3.5, 3.2, 'plaster', { t: 0.2, gaps: [[4.2, 5.8]] });
  table(b, 56.5, 0.5, PI / 2, 1.8, 0.8);
  laptop(b, 56.5, 0.78, 0.5, -PI / 2);
  b.interact('manifest', 56.5, 0.95, 0.5, 'Download the shipping manifest', { kind: 'intel', hold: 1.6, radius: 2.4 });
  table(b, 47.5, 6.5, 0, 1.6, 0.8);
  shelf(b, 58.9, 6, PI / 2, 2.4);
  shelf(b, 46, -2.6, 0, 2.2);
  b.light(48, 2.8, 2, 0xffe2b0, 55, 11, { glow: 0.5 });
  b.light(56, 2.8, 3, 0xdfe9ff, 55, 11, { glow: 0.5 });
  wallLight(b, 43.8, 2.6, 4.5, -PI / 2);
  barrels(b, 41.5, -4.5, 3);
  crate(b, 41.6, 10.2, 1.0, { stack: 2 });
  jeep(b, 40, 16, 0.1, C.dark);

  b.enemy('guard', 42, 2, { yawDeg: 90, group: 'office', weapon: 'ak74m' });
  b.enemy('officer', 55, 4, { yawDeg: 160, group: 'office' });
  b.enemy('guard', 48.5, -1.2, { yawDeg: 20, group: 'office' });

  // ================================================================ NORTH QUAY
  // Gantry crane
  for (const x of [-18, 0]) for (const z of [-53, -41]) b.box(x, 0, z, 1.1, 25, 1.1, 'paint', { tint: C.yellow, pen: 2 });
  for (const z of [-53, -41]) b.box(-9, 24, z, 20, 1.4, 1.2, 'paint', { tint: C.yellow, collide: false });
  for (const x of [-18, 0]) b.box(x, 12, -47, 0.5, 0.6, 12, 'paint', { tint: C.yellow, collide: false });
  b.box(-9, 25.4, -58, 2.2, 1.6, 44, 'paint', { tint: C.yellow, collide: false });
  b.box(-9, 22.6, -50, 3, 2.6, 3.4, 'metal', { tint: C.white, collide: false });
  b.panelGlow(-9, 23.2, -48.28, 2.2, 1.2, 0xbfe0ff, 1.6);
  b.glow(-9, 27.6, -79, 0xff2a1a, 1.8);
  b.glow(-9, 27.6, -37, 0xff2a1a, 1.8);
  floodlight(b, -9, -39.5, 0, { h: 9, intensity: 600 });
  // The container the manifest points to
  container(b, 10, -44, -PI / 2, C.blue, { open: true });
  b.interact('tku7', 10, 1.1, -45.2, 'Inspect container TKU-7', { kind: 'use', hold: 1.2, radius: 3.2, enabled: false });
  b.zone('quayside', 10, -34, 9);
  containerBlock(b, 40, -47, 0, 3, 2, 3);
  containerBlock(b, -34, -52.5, 0, 2, 1, 2);
  container(b, 24, -38, 0.3, C.orange);
  crateCluster(b, 2, -36, 4, 1.6);
  pallet(b, 16, -51, 0.2);
  barrels(b, -4, -55, 4);
  jersey(b, 30, -30, 0, 2);
  lamp(b, 26, -52, { yaw: PI, h: 8, intensity: 320 });
  lamp(b, -26, -44, { yaw: 0, h: 8, intensity: 300 });
  sandbags(b, 15, -56.8, 23, -56.8, 1.0);

  b.enemy('guard', 2, -42, { group: 'quay', patrol: [[2, -42], [34, -40]] });
  b.enemy('guard', 20, -48, { yawDeg: 200, group: 'quay', weapon: 'ak74m' });
  b.enemy('guard', -10, -34, { group: 'quay', patrol: [[-28, -34], [8, -32]] });
  b.enemy('guard', 34, -33, { yawDeg: 170, group: 'quay' });

  // Warehouse, west
  warehouse(b, -50, -40, 26, 18, { h: 6.5, tint: C.grey, doors: [['e', 0, 6, 4.2], ['s', -5, 5, 4.2]] });
  crateCluster(b, -56, -45, 6, 3, 'crate');
  shelf(b, -62.4, -38, PI / 2, 3);
  shelf(b, -62.4, -43, PI / 2, 3);
  pallet(b, -44, -44, 0.5);
  pallet(b, -46.5, -36, 1.2);
  ammoCrate(b, 'supply-warehouse', -58, -33.2, 0);
  explosiveBarrel(b, -35.6, -30.6);
  explosiveBarrel(b, -36.4, -31.5);
  barrel(b, -35.2, -32.1, C.rustc);
  jersey(b, -30, -46, PI / 2, 1);
  // Comms mast: can only be brought down with the charge
  b.prop('target', -66, 8, -54, 1e12, 0, (o) => {
    b.box(-66, 0, -54, 0.5, 27, 0.5, 'grate', { ...o, tint: C.grey, uvs: 2, pen: 0.15 });
    for (let i = 1; i < 7; i++) b.box(-66, i * 4, -54, 0.9, 0.08, 0.9, 'darkmetal', { ...o, collide: false });
    b.box(-66, 21, -54, 2.4, 0.5, 0.2, 'metal', { ...o, collide: false, tint: C.white });
    b.box(-66, 24, -54, 0.2, 0.5, 2.4, 'metal', { ...o, collide: false, tint: C.white });
  }, 'mast');
  b.glow(-66, 27.4, -54, 0xff2a1a, 1.8, 'mastlight');
  b.box(-64.6, 0, -52.6, 1.2, 1.6, 0.8, 'paint', { tint: C.grey });
  b.panelGlow(-64.6, 1.0, -52.19, 0.3, 0.12, 0x39ff6a, 4, 'mastlight');
  b.interact('mast', -64.6, 1.1, -51.9, 'Plant charge on the comms mast', { kind: 'plant', hold: 2, radius: 2.6, enabled: false });

  b.enemy('rifleman', -47, -40, { yawDeg: 90, group: 'qrf' });
  b.enemy('rifleman', -50, -37, { yawDeg: 90, group: 'qrf' });
  b.enemy('rusher', -44, -43, { yawDeg: 90, group: 'qrf' });
  b.enemy('rusher', -52, -44, { yawDeg: 120, group: 'qrf' });
  b.enemy('heavy', -55, -40, { yawDeg: 90, group: 'qrf' });
  b.enemy('rifleman', 36, -20, { yawDeg: 180, group: 'qrf' });
  b.enemy('rifleman', 38, -24, { yawDeg: 180, group: 'qrf' });

  // Last stand at the pier
  b.zone('boat', 19, -76, 3.2);
  b.enemy('rifleman', 30, -50, { yawDeg: 90, group: 'pier' });
  b.enemy('rusher', 6, -52, { yawDeg: -90, group: 'pier' });
  b.enemy('shotgunner', 26, -42, { yawDeg: 140, group: 'pier' });
  b.enemy('heavy', 44, -38, { yawDeg: 100, group: 'pier' });
  b.enemy('marksman', 40.2, -47, { y: 7.8, hold: true, yawDeg: 90, group: 'pier' });
  b.pickup('medkit', 21, -57.6);
  b.pickup('ammo', 16, -57.6);
  b.pickup('medkit', -22.4, 59.4);
  b.pickup('armor', 47, 8.6);
  b.pickup('grenade', -57, -36);
}

export const ch1: ChapterDef = {
  id: 'dead-water',
  n: 1,
  title: 'Dead Water',
  codename: 'INFILTRATION',
  location: 'Port Calder container terminal',
  clock: '02:10',
  tagline: 'Find the shipment before it sails.',
  brief: [
    'Three nights ago a Corvane Group convoy lifted LANTERN from a closed test range: a guidance-override package that can turn any guided weapon in the air against whoever launched it.',
    'Signals put the crates at Port Calder, booked onto a freighter due out at first light. You go in alone and quiet. Get the manifest from the harbor office, find the container, and make sure that ship leaves without it.',
  ],
  intel: [
    'Darkness and rain halve how far a guard can see. Crouching halves it again.',
    'A suppressed shot is only heard a few metres away. Anything louder brings the yard down on you.',
    'A blade from behind is silent and final.',
  ],
  recommended: { primary: 'mp5sd', secondary: 'mk23' },
  env: {
    skyTop: 0x04070d, skyHorizon: 0x111b2a, skyBottom: 0x05080c,
    sunDir: [-0.45, 0.72, 0.35], sunColor: 0x93abd0, sunIntensity: 2.6, sunDisc: 2.6, moon: true,
    hemiSky: 0x7f9fd0, hemiGround: 0x2a3344, hemiIntensity: 2.2,
    fogColor: 0x0b111a, fogDensity: 0.0135,
    stars: 0.15, clouds: 0.78, cloudColor: 0x161f2c,
    envIntensity: 0.8, exposure: 1.45,
    weather: 'rain', weatherAmount: 1,
    grade: { tint: [0.92, 0.98, 1.1], contrast: 1.08, saturation: 0.9 },
    reverb: 'urban', ambience: ['ambRain:0.5', 'ambWaves:0.22'], shadowRange: 42, musicRoot: 38,
  },
  visibility: 0.5,
  seed: 1101,
  build,
  stages: [
    {
      id: 'infil',
      objective: 'Slip through the outer yard into the container stacks',
      done: reach('yard'),
      enter: (m) => {
        m.spawn('start', 'yard', 'office');
        m.radio('OVERWATCH', 'Kestrel, you are inside the wire. Gate into the stacks is north of you. Six on the outer yard, more beyond.', 1.5);
        if (m.squad) m.radio('OVERWATCH', 'Merlin and Shrike are on your shoulder. They hold their fire until you start it.', 8);
        m.radio('OVERWATCH', 'Stay out of the lamps and they will not see you until you are close.', m.squad ? 14 : 8);
      },
    },
    {
      id: 'manifest',
      objective: 'Download the shipping manifest from the harbor office',
      done: use('manifest'),
      enter: (m) => {
        m.radio('OVERWATCH', 'Harbor office is the brick block east of the stacks. The manifest lives on the duty terminal.', 1);
      },
    },
    {
      id: 'container',
      objective: 'Find container TKU-7 on the north quay',
      done: use('tku7'),
      enter: (m) => {
        m.enable('tku7');
        m.spawn('quay');
        m.radio('OVERWATCH', 'Got it. LANTERN is listed in TKU-7, blue box, staged under the gantry crane on the north quay.', 0.6);
        m.onZone('quayside', () => m.radio('OVERWATCH', 'That is your box. Doors are open. I do not like that.', 0));
      },
    },
    {
      id: 'mast',
      objective: 'Cut their comms: plant a charge on the mast',
      done: use('mast'),
      enter: (m) => {
        m.enable('mast');
        m.spawn('qrf');
        m.sound('alarm', undefined, 0.5);
        m.after(1.2, () => m.alert());
        m.radio('KESTREL', 'Container is empty. They moved it.', 0.3);
        m.radio('OVERWATCH', 'Then it is already at sea, and they know you are there. Their reaction force is rolling out of the west warehouse.', 3);
        m.radio('OVERWATCH', 'Kill the mast behind that warehouse before they call the freighter back. There is a resupply crate inside.', 8);
      },
      exit: (m) => {
        m.explodeAt('mast', 8, 400);
        m.destroyProp('mast');
        m.lights('mastlight', false);
      },
    },
    {
      id: 'exfil',
      objective: 'Reach the boat at the end of the pier',
      done: reach('boat'),
      enter: (m) => {
        m.spawn('pier');
        m.after(2, () => m.alert('pier'));
        m.radio('OVERWATCH', 'Mast is down. They are deaf. Boat is on the pier under the green light. Move.', 1.5);
        m.radio('OVERWATCH', 'Marksman on the stacks east of the pier. Watch for the glint.', 9);
      },
    },
  ],
  debrief: 'LANTERN left Port Calder before you arrived, but the manifest names the buyer\'s broker: a contact in the old town of Dravik who goes by Wren.',
  menuCam: { x: -4, y: 15, z: -6, r: 60 },
  accent: '#59b8ff',
  par: 480,
};
