import { fbm, lerp, smoothstep } from '../../core/math';
import type { LevelBuilder } from '../../world/builder';
import { aaGun, ammoCrate, apc, barrels, C, cargoPlane, consoleDesk, crate, crateCluster, door, explosiveBarrel, fence, floodlight, fuelTank, house, jeep, jersey, lamp, pallet, sandbags, scatter, table, tank, tent, tower, truck, warehouse, block } from '../../world/props';
import { destroy, kill, reach, type ChapterDef } from './types';

const PI = Math.PI;

function height(x: number, z: number): number {
  // Dunes to the south, dead-flat hardpan under the airfield.
  const dunes = (fbm(x * 0.018 + 2, z * 0.018 + 9, 4, 21) - 0.42) * 13 + (fbm(x * 0.08, z * 0.08, 2, 4) - 0.5) * 1.2;
  let h = Math.max(0, dunes) * smoothstep(30, 52, z);
  // An eroded escarpment rings the basin: steep at the foot, ragged along the crest.
  const dx = Math.max(0, Math.abs(x) - 100);
  const dz = Math.max(0, z - 96) + Math.max(0, -74 - z);
  const d = Math.hypot(dx, dz);
  if (d > 0) {
    const crest = 20 + fbm(x * 0.022 + 40, z * 0.022 + 7, 4, 31) * 34;
    const gullies = (fbm(x * 0.09, z * 0.09, 3, 12) - 0.5) * 7 * Math.min(1, d / 10);
    h += (1 - Math.exp(-d / 13)) * crest + gullies;
  }
  // Keep the approach to both gates walkable.
  for (const gx of [-40, 30]) h = lerp(h, 0, smoothstep(16, 8, Math.abs(x - gx)) * smoothstep(60, 34, z));
  return h;
}

function build(b: LevelBuilder): void {
  b.playArea(-106, -78, 106, 100, true);
  b.setTerrain(
    300,
    2.5,
    height,
    (_x, _z, _h, slope) => (slope > 0.9 ? 'concrete' : 'sand'),
    (x, z, h, slope) => {
      const n = 0.86 + fbm(x * 0.12, z * 0.12, 2, 8) * 0.28;
      const rock = smoothstep(0.7, 1.0, slope);
      const pan = smoothstep(46, 30, z) * (1 - smoothstep(-2, 2, h)) * 0.0;
      return [lerp(0.86 * n, 0.45, rock) - pan, lerp(0.74 * n, 0.38, rock) - pan, lerp(0.54 * n, 0.3, rock) - pan];
    },
    'sand',
  );
  const r = b.rng;
  const dune = (x: number, z: number) => z > 34 && Math.abs(x + 40) > 9 && Math.abs(x - 30) > 9 && Math.hypot(x + 6, z - 92) > 7 && (b.terrain?.slopeAt(x, z) ?? 0) < 0.6;
  scatter(b, 'rock', 46, -98, 36, 98, 96, dune, [0.9, 2.2]);
  scatter(b, 'drybush', 70, -98, 32, 98, 96, dune, [0.7, 1.4], false);
  scatter(b, 'palm', 9, -98, 34, 98, 60, dune, [0.9, 1.2]);

  // ---- hard surfaces
  b.flat(0, -40, 196, 26, 'asphalt', { y: 0.03 });
  for (let x = -88; x <= 88; x += 14) b.flat(x, -40, 7, 0.5, 'paint', { y: 0.05, tint: [0.8, 0.8, 0.76] });
  for (const z of [-52.2, -27.8]) b.flat(0, z, 196, 0.3, 'paint', { y: 0.05, tint: [0.8, 0.8, 0.76] });
  b.flat(12, -6, 150, 42, 'concrete', { y: 0.03, tint: [0.82, 0.8, 0.76] });
  b.flat(-60, 4, 76, 34, 'concrete', { y: 0.03, tint: [0.78, 0.76, 0.72] });

  // ---- perimeter
  const F = (x1: number, z1: number, x2: number, z2: number) => fence(b, x1, z1, x2, z2, 2.8, { barbed: true });
  F(-96, 28, -43.5, 28);
  F(-36.5, 28, 26.5, 28);
  F(33.5, 28, 96, 28);
  F(-96, 28, -96, -72);
  F(96, 28, 96, -72);
  F(-96, -72, 96, -72);
  for (const gx of [-43.5, -36.5, 26.5, 33.5]) b.box(gx, 0, 28, 0.4, 3.2, 0.4, 'darkmetal', {});
  for (const gx of [-40, 30]) {
    jersey(b, gx - 2, 33, 0.3, 1);
    jersey(b, gx + 2.5, 24, -0.2, 1);
    sandbags(b, gx + 5, 25.5, gx + 9, 25.5, 1.0);
  }
  b.zone('perimeter', -40, 26, 5.5);
  const t1 = tower(b, -47, 23.5, 0, 6);
  const t2 = tower(b, 37, 23.5, 0, 6);
  floodlight(b, -30, 26, PI, { h: 5, intensity: 300 });
  floodlight(b, 22, 26, PI, { h: 5, intensity: 300 });

  // ---- hangars and the lift blockhouse (west)
  warehouse(b, -30, 0, 30, 24, { h: 8, tint: C.tan, doors: [['e', 0, 12, 6], ['s', -6, 6, 4.5]], lights: 'hangar' });
  warehouse(b, -66, 0, 26, 24, { h: 8, tint: C.tan, doors: [['e', 0, 10, 6], ['w', 4, 4, 4]], lights: 'hangar' });
  jeep(b, -30, 2, 0.4, C.tan, true);
  crateCluster(b, -38, -6, 6, 3);
  crateCluster(b, -22, 7, 5, 2.4);
  pallet(b, -36, 6, 0.3);
  apc(b, -66, 1, 0.1, C.tan);
  crateCluster(b, -72, -7, 5, 2.4);
  ammoCrate(b, 'supply-hangar', -58, 9.5, PI);
  barrels(b, -54.4, -9, 4, C.olive);
  house(b, -88, -4, 8, 8, { h: 3.2, mat: 'concrete', tint: [0.72, 0.7, 0.66], doors: [['e', 0, 1.5]], floor: 'tile' });
  door(b, 'liftdoor', -84, -4, PI / 2, 1.5, 2.25, C.yellow);
  b.panelGlow(-83.92, 2.5, -4, 0.01, 0.01, 0xff2a1a, 1);
  b.light(-88, 2.8, -4, 0xff5a40, 40, 9, { glow: 0.6 });
  b.zone('lift', -88.6, -4, 2.4);
  b.box(-88.6, 0, -6.8, 2.6, 2.4, 0.3, 'grate', { tint: C.yellow, uvs: 2 });

  // ---- apron: the aircraft, tents, motor pool
  cargoPlane(b, 'plane', 36, -4, PI);
  for (let i = 0; i < 4; i++) tent(b, -6 + i * 6.2, 15, 0, 5, 7, C.tan);
  truck(b, 2, -18, 0.05, C.tan, 'fuel');
  truck(b, 14, 21, 1.5, C.tan, 'cargo');
  jeep(b, 60, 22, -0.4, C.tan);
  tank(b, -6, -16, 0.2, C.tan, 0.5);
  crateCluster(b, 16, 8, 6, 3);
  pallet(b, 22, 14, 0.2);
  pallet(b, 25, 15.5, 1.0);
  jersey(b, 10, -22, 0, 2);
  sandbags(b, 54, -6, 60, -6, 1.0);
  sandbags(b, 20, 20.5, 26, 20.5, 1.0);
  for (const [x, z] of [[-12, -22], [18, -24], [62, 2], [-50, 16]] as const) lamp(b, x, z, { h: 8, yaw: r.range(0, 6), intensity: 240, color: 0xffe6c0 });

  // ---- operations building and control tower (east)
  house(b, 80, 10, 16, 10, { h: 3.4, mat: 'concrete', tint: [0.76, 0.72, 0.64], doors: [['w', 0, 1.5], ['n', 4, 1.3]], windows: [['w', -3], ['s', -4], ['s', 4], ['n', -4]], floor: 'tile' });
  consoleDesk(b, 84, 13.6, 0, 3.2);
  table(b, 76, 12, 0, 1.6, 0.8);
  b.light(80, 3, 10, 0xffe2b0, 70, 13, { glow: 0.5 });
  block(b, 80, 20.2, 7, 7, 15, { mat: 'concrete', tint: [0.7, 0.68, 0.62], lit: 0.2 });
  b.box(80, 15.3, 20.2, 9, 3, 9, 'glass', { tint: [0.1, 0.14, 0.16], collide: false });
  b.box(80, 18.3, 20.2, 9.6, 0.4, 9.6, 'concrete', { collide: false });
  b.glow(80, 20, 20.2, 0xff2a1a, 1.8);
  barrels(b, 70.4, 4, 4, C.olive);
  crate(b, 70.4, 16, 1.1, { stack: 2 });

  // ---- fuel depot (north-east) and the two AA positions north of the runway
  fuelTank(b, 'fuel1', 66, -22);
  fuelTank(b, 'fuel2', 76, -22);
  fuelTank(b, 'fuel3', 86, -22);
  explosiveBarrel(b, 71, -18.4);
  explosiveBarrel(b, 81, -18.4);
  sandbags(b, 60, -16, 64, -16, 1.0);
  aaGun(b, 'aa1', -50, -61, PI);
  aaGun(b, 'aa2', 52, -61, PI);
  crateCluster(b, -44, -60, 3, 1.4);
  crateCluster(b, 58, -60, 3, 1.4);
  sandbags(b, -56, -56, -52, -56, 1.0);
  sandbags(b, 46, -56, 50, -56, 1.0);

  // ================================================================ forces
  b.playerStart(-6, 92, 0);
  b.enemy('rifleman', -34, 46, { yawDeg: 180, group: 'outer', patrol: [[-34, 46], [10, 50], [34, 44]] });
  b.enemy('rifleman', 26, 40, { yawDeg: 180, group: 'outer', patrol: [[26, 40], [-20, 42]] });
  b.enemy('rifleman', -42.5, 26, { yawDeg: 180, group: 'outer' });
  b.enemy('rifleman', -37, 25, { yawDeg: 180, group: 'outer', crouch: true });
  b.enemy('rifleman', 32, 25.5, { yawDeg: 180, group: 'outer' });
  b.enemy('marksman', -47, 23.5, { y: t1, hold: true, yawDeg: 180, group: 'outer' });
  b.enemy('marksman', 37, 23.5, { y: t2, hold: true, yawDeg: 180, group: 'outer' });

  b.enemy('rifleman', 62, -14, { yawDeg: 200, group: 'depot' });
  b.enemy('heavy', 70, -14, { yawDeg: 200, group: 'depot' });
  b.enemy('rifleman', 82, -15, { yawDeg: 220, group: 'depot', patrol: [[82, -15], [62, -15]] });
  b.enemy('rusher', 56, -10, { yawDeg: 240, group: 'depot' });
  b.enemy('rifleman', 90, -12, { yawDeg: 240, group: 'depot' });

  for (const [gx, tag] of [[-50, 'a'], [52, 'b']] as const) {
    b.enemy('rocketeer', gx + 4, -58, { yawDeg: 180, group: 'aa' });
    b.enemy('rifleman', gx - 4, -57, { yawDeg: 180, group: 'aa', crouch: true });
    b.enemy('rifleman', gx, -55, { yawDeg: 180, group: 'aa', id: `aa-${tag}` });
  }
  b.enemy('elite', 30, -18, { yawDeg: 180, group: 'apron' });
  b.enemy('elite', 44, 12, { yawDeg: 200, group: 'apron' });
  b.enemy('rifleman', 20, 6, { yawDeg: 220, group: 'apron' });
  b.enemy('rifleman', 52, -12, { yawDeg: 200, group: 'apron' });
  b.enemy('shotgunner', 12, -10, { yawDeg: 240, group: 'apron' });
  b.enemy('rusher', -24, 4, { yawDeg: 120, group: 'apron' });
  b.enemy('rifleman', -34, -4, { yawDeg: 120, group: 'apron' });
  b.enemy('heavy', -62, 4, { yawDeg: 100, group: 'apron' });

  b.enemy('officer', 84, 11, { yawDeg: -90, group: 'commander', id: 'cmd' });
  b.enemy('elite', 76, 8, { yawDeg: -90, group: 'commander' });
  b.enemy('elite', 78, 13, { yawDeg: -90, group: 'commander' });
  b.enemy('eliterusher', 70, 10, { yawDeg: -90, group: 'commander' });

  b.enemy('eliterusher', -78, -10, { yawDeg: 90, group: 'last' });
  b.enemy('eliterusher', -80, 4, { yawDeg: 90, group: 'last' });
  b.enemy('elite', -74, -3, { yawDeg: 90, group: 'last' });
  b.pickup('ammo', -38, 31);
  b.pickup('medkit', 9.5, 21);
  b.pickup('ammo', 58, -4);
  b.pickup('grenade', 48, -58);
  b.pickup('medkit', 77, 6.5);
  b.pickup('armor', -27, -9);
}

export const ch4: ChapterDef = {
  id: 'furnace',
  n: 4,
  title: 'Furnace',
  codename: 'DENIAL',
  location: 'Kharan Flats airstrip',
  clock: '18:20',
  tagline: 'Nothing leaves the ground.',
  brief: [
    'With the relay gone, Corvane means to fly LANTERN out. A cargo aircraft is fuelling at a desert strip at Kharan Flats, covered by two anti-aircraft guns that keep our own air away.',
    'Burn the fuel depot, kill both guns, then cripple the aircraft before it can taxi. The base commander carries the pass for the lift behind the west hangar: LANTERN itself is underneath.',
  ],
  intel: [
    'Fuel tanks, engines and gun mounts are destructible. Explosives are quickest; a launcher in your second slot is worth the weight.',
    'Open ground. Towers at both gates hold marksmen: deal with them from the dunes before you cross.',
    'Once the guns are down the aircraft starts its engines. You will be on a clock.',
  ],
  recommended: { primary: 'scarh', secondary: 'rpg7' },
  env: {
    skyTop: 0x2c4a78, skyHorizon: 0xffa35c, skyBottom: 0x3b2a20,
    sunDir: [0.78, 0.2, -0.35], sunColor: 0xffb070, sunIntensity: 4.6, sunDisc: 14,
    hemiSky: 0xd9b9a2, hemiGround: 0x7a5a3c, hemiIntensity: 1.9,
    fogColor: 0xd9a070, fogDensity: 0.0042,
    stars: 0, clouds: 0.32, cloudColor: 0xffc49a,
    envIntensity: 1.0, exposure: 0.86,
    weather: 'dust', weatherAmount: 0.7,
    grade: { tint: [1.06, 1.0, 0.92], contrast: 1.1, saturation: 1.05 },
    reverb: 'open', ambience: ['ambDust:0.4'], shadowRange: 70, musicRoot: 41,
  },
  visibility: 1.15,
  seed: 4409,
  build,
  stages: [
    {
      id: 'approach',
      objective: 'Cross the dunes and breach the perimeter',
      done: reach('perimeter'),
      enter: (m) => {
        m.spawn('outer');
        m.radio('OVERWATCH', 'Kharan Flats. Airfield is north over the dunes, fenced, two gates, a tower on each. West gate is your way in.', 1.2);
        m.radio('OVERWATCH', 'Sun is behind you and in their eyes. Use it while it lasts.', 9);
      },
    },
    {
      id: 'fuel',
      objective: 'Destroy the fuel depot',
      done: destroy('fuel1', 'fuel2', 'fuel3'),
      enter: (m) => {
        m.spawn('depot', 'apron');
        m.radio('OVERWATCH', 'You are inside. Fuel depot is the three white tanks at the north-east corner. Put holes in them, or better, something that burns.', 0.8);
      },
    },
    {
      id: 'aa',
      objective: 'Knock out both anti-aircraft guns',
      done: destroy('aa1', 'aa2'),
      enter: (m) => {
        m.spawn('aa');
        m.radio('OVERWATCH', 'That will be seen from orbit. Now the guns: one each end of the runway, north side. They have rockets up there too.', 1.5);
      },
    },
    {
      id: 'plane',
      objective: 'Destroy all four engines before the aircraft taxis',
      done: destroy('plane-eng1', 'plane-eng2', 'plane-eng3', 'plane-eng4'),
      enter: (m) => {
        m.sound('rotor', 'plane-eng1', 0.7);
        m.timer('Aircraft departs', 150, () => m.fail('The aircraft took off with LANTERN aboard.'));
        m.radio('OVERWATCH', 'Guns are down, and they know it. The aircraft is spinning up. Four engines, under the wings. Kill all four.', 0.6);
      },
      exit: (m) => {
        m.clearTimer();
      },
    },
    {
      id: 'commander',
      objective: 'Take the lift pass from the base commander',
      marker: 'cmd',
      done: kill('commander'),
      enter: (m) => {
        m.spawn('commander');
        m.after(1, () => m.alert('commander'));
        m.radio('OVERWATCH', 'It is not going anywhere. Hold is empty though: LANTERN never left the bunker. Commander is in the operations block under the control tower, and he has the lift pass.', 1);
      },
      exit: (m) => {
        m.openDoor('liftdoor');
      },
    },
    {
      id: 'lift',
      objective: 'Take the lift behind the west hangar',
      done: reach('lift'),
      enter: (m) => {
        m.spawn('last');
        m.after(1, () => m.alert('last'));
        m.radio('OVERWATCH', 'You have the pass. Blockhouse at the far west end, past both hangars. The yellow door.', 0.8);
      },
    },
  ],
  debrief: 'The aircraft was a decoy for the satellites. LANTERN is still in the black site under the airfield, and its builders are down there with it.',
  menuCam: { x: 14, y: 22, z: -6, r: 74 },
  accent: '#ffb347',
  par: 720,
};
