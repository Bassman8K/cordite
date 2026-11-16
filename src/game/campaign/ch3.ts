import { fbm, lerp, smoothstep } from '../../core/math';
import type { LevelBuilder } from '../../world/builder';
import type { RGB } from '../../world/geo';
import { ammoCrate, barrels, C, crate, crateCluster, dish, fence, generator, house, jersey, sandbags, scatter, table, tower, truck } from '../../world/props';
import { all, kill, reach, survive, use, type ChapterDef } from './types';

const PI = Math.PI;
const PLATEAU = 31;
/** The trail meanders up the valley. */
const pathX = (z: number) => 18 * Math.sin(z * 0.045);
const flatSpots: Array<[number, number, number, number]> = [
  // x, z, radius, height (NaN = keep the trail's own height)
  [0, -82, 32, PLATEAU],
  [48, -84, 9, PLATEAU],
];

function baseHeight(z: number): number {
  return smoothstep(100, -58, z) * 30;
}

function height(x: number, z: number): number {
  const base = baseHeight(z);
  let h = base + (fbm(x * 0.028 + 7, z * 0.028 + 3, 4, 11) - 0.5) * 15 + (fbm(x * 0.11, z * 0.11, 3, 5) - 0.5) * 2.2;
  // Valley walls
  const wall = Math.max(0, Math.abs(x) - 54) * 1.25 + Math.max(0, -112 - z) * 1.6 + Math.max(0, z - 108) * 1.4;
  if (wall > 0) {
    // Broken rock faces instead of a flat ramp: crags vary the pitch, gullies cut into it.
    const crag = fbm(x * 0.035 + 11, z * 0.035 + 5, 4, 17);
    h += wall * (1 + crag * 0.7) + (fbm(x * 0.1, z * 0.1, 3, 9) - 0.5) * 9 * Math.min(1, wall / 12);
  }
  // Trail and clearings
  const pm = smoothstep(11, 4.5, Math.abs(x - pathX(z))) * smoothstep(-62, -52, z);
  h = lerp(h, base + 0.4, pm);
  for (const [fx, fz, r, fh] of flatSpots) h = lerp(h, fh, smoothstep(r * 1.32, r, Math.hypot(x - fx, z - fz)));
  h = lerp(h, baseHeight(30) + 0.4, smoothstep(15, 9, Math.hypot(x - pathX(30), z - 30)));
  h = lerp(h, baseHeight(96) + 0.4, smoothstep(12, 7, Math.hypot(x - pathX(96), z - 96)));
  return h;
}

function build(b: LevelBuilder): void {
  b.playArea(-72, -112, 72, 108, true);
  const snow: RGB = [0.93, 0.95, 0.99];
  b.setTerrain(
    264,
    2,
    height,
    (_x, _z, _h, slope) => (slope > 0.85 ? 'concrete' : 'snow'),
    (x, z, _h, slope) => {
      const n = 0.9 + fbm(x * 0.15, z * 0.15, 2, 3) * 0.2;
      const rock = smoothstep(0.62, 0.95, slope);
      const trail = smoothstep(6, 2, Math.abs(x - pathX(z))) * 0.14;
      return [lerp(snow[0] * n - trail, 0.36, rock), lerp(snow[1] * n - trail, 0.36, rock), lerp(snow[2] * n - trail * 0.8, 0.39, rock)];
    },
    'snow',
  );
  const H = (x: number, z: number) => b.gy(x, z);
  const r = b.rng;
  const clear = (x: number, z: number) => {
    if (Math.abs(x - pathX(z)) < 6.5 && z > -56) return false;
    if (Math.hypot(x, z + 82) < 40 || Math.hypot(x - 48, z + 84) < 13) return false;
    if (Math.hypot(x - pathX(30), z - 30) < 14 || Math.hypot(x - pathX(96), z - 96) < 9) return false;
    return (b.terrain?.slopeAt(x, z) ?? 0) < 0.6;
  };
  scatter(b, 'snowpine', 190, -70, -58, 70, 106, clear, [0.9, 1.7]);
  scatter(b, 'rock', 46, -66, -56, 66, 104, (x, z) => clear(x, z) && Math.abs(x - pathX(z)) < 22, [0.8, 1.9]);
  scatter(b, 'deadtree', 22, -66, -110, 66, -54, (x, z) => Math.hypot(x, z + 82) > 40 && (b.terrain?.slopeAt(x, z) ?? 0) < 0.7, [0.8, 1.2]);

  // ---- start
  const sx = pathX(96);
  b.playerStart(sx, 97, 0);
  b.at(sx + 4, 99, 0.4, () => crateCluster(b, 0, 0, 3, 1.2), H(sx + 4, 99));

  // ---- checkpoint half-way up
  const cx = pathX(30);
  const cy = H(cx, 30);
  b.at(cx, 30, 0, () => {
    house(b, -7, 0, 6, 5, { h: 2.8, mat: 'planks', tint: [0.5, 0.42, 0.34], doors: [['e', 0, 1.4]], windows: [['s', 0], ['n', 0]], roof: 'gable', roofMat: 'corrugated', roofTint: C.snow, floor: 'planks' });
    table(b, -8, 0.6, PI / 2, 1.2, 0.7);
    b.light(-7, 2.2, 0, 0xffc98a, 40, 9, { glow: 0.7 });
    sandbags(b, -3, 6, 3, 6, 1.0);
    sandbags(b, 3.5, -5, 7, -2, 1.0);
    jersey(b, 0, 2, 0.1, 1);
    barrels(b, 6, 4, 3, C.olive);
    b.pickup('medkit', -7, -1);
    b.pickup('ammo', 4, 3);
  }, cy);
  b.zone('checkpoint', cx, 33, 9);

  // ---- sniper nests on the high ground either side of the pass
  const nests: Array<[number, number]> = [[-31, -4], [35, -27]];
  nests.forEach(([nx, nz], i) => {
    const ny = H(nx, nz);
    let top = 0;
    b.at(nx, nz, 0, () => {
      top = tower(b, 0, 0, i ? 0.6 : -0.5, 4.5);
      sandbags(b, -3, 3.4, 3, 3.4, 1.0);
    }, ny);
    b.glow(nx, ny + 7.2, nz, 0xffe2b0, 0.8);
    b.enemy('wintermarksman', nx, nz, { y: ny + top, hold: true, yawDeg: 170, group: 'snipers' });
    b.enemy('winter', nx + 2.5, nz + 5, { yawDeg: 170, group: 'snipers' });
  });

  // ---- relay station on the plateau
  const P = PLATEAU;
  b.at(0, -82, 0, () => {
    fence(b, -28, 22, -4.5, 22, 2.6, { barbed: true });
    fence(b, 4.5, 22, 28, 22, 2.6, { barbed: true });
    fence(b, -28, 22, -28, -24, 2.6, { barbed: true });
    fence(b, -28, -24, 28, -24, 2.6, { barbed: true });
    fence(b, 28, -24, 28, -6, 2.6, { barbed: true });
    fence(b, 28, 2, 28, 22, 2.6, { barbed: true });
    for (const gx of [-4.5, 4.5]) b.box(gx, 0, 22, 0.35, 3.1, 0.35, 'darkmetal', {});
    house(b, -15, -10, 14, 10, { h: 3.2, mat: 'concrete', tint: [0.7, 0.72, 0.74], doors: [['e', 0, 1.5], ['s', 3, 1.4]], windows: [['s', -3], ['n', 0], ['w', 0]], floor: 'tile' });
    b.light(-15, 2.8, -10, 0xdfe9ff, 70, 13, { glow: 0.5 });
    table(b, -19, -12, 0, 1.6, 0.8);
    ammoCrate(b, 'supply-station', -11.5, -13.6, 0);
    generator(b, -20, 3, PI / 2);
    crateCluster(b, -8, 8, 5, 2.4);
    crate(b, 12, 12, 1.1, { stack: 2 });
    barrels(b, 20, 16, 4, C.olive);
    truck(b, 8, 15, 0.3, C.snow, 'cargo');
    sandbags(b, -3, 16, 3, 16, 1.0);
    sandbags(b, 10, 4, 15, 2, 1.0);
    jersey(b, -12, 14, 0.4, 2);
    b.box(22, 0, -18, 0.5, 26, 0.5, 'grate', { tint: C.grey, pen: 0.15, uvs: 2 });
    b.glow(22, 26.4, -18, 0xff2a1a, 1.8);
    b.pickup('medkit', -18.5, -7);
    b.pickup('armor', -20, -13);
    b.pickup('grenade', -9, -8);
  }, P);
  dish(b, 'dish1', 10, -73, 0.3, P);
  dish(b, 'dish2', 17, -92, -0.5, P);
  dish(b, 'dish3', -6, -100, 0.9, P);
  let stationTower = 0;
  b.at(23, -64, PI, () => (stationTower = tower(b, 0, 0, 0, 5)), P);
  b.glow(23, P + 7.6, -64, 0xffe2b0, 0.8);
  b.zone('gate', 0, -57, 6);
  b.zone('lz', 48, -84, 6);
  b.glow(48, P + 0.3, -84, 0x39ff6a, 1.2);

  // ================================================================ forces
  const z0 = (z: number): [number, number] => [pathX(z), z];
  b.enemy('winter', ...z0(72), { yawDeg: 180, group: 'pass', patrol: [z0(74), z0(52)] });
  b.enemy('winter', pathX(60) + 3, 60, { yawDeg: 180, group: 'pass' });
  b.enemy('winter', cx + 1, 37, { yawDeg: 180, group: 'pass', crouch: true });
  b.enemy('winter', cx - 2, 28, { yawDeg: 180, group: 'pass' });
  b.enemy('winter', cx + 9, 31, { yawDeg: 160, group: 'pass' });
  b.enemy('rusher', cx - 5, 31, { yawDeg: 90, group: 'pass' });

  b.enemy('winter', -3, -62, { yawDeg: 180, group: 'station', crouch: true });
  b.enemy('winter', 12, -77, { yawDeg: 180, group: 'station' });
  b.enemy('winter', -7, -74, { yawDeg: 160, group: 'station', patrol: [[-7, -74], [16, -70], [18, -96], [-8, -98]] });
  b.enemy('heavy', 2, -68, { yawDeg: 180, group: 'station' });
  b.enemy('winter', -14, -90, { yawDeg: 90, group: 'station' });
  b.enemy('officer', -17, -93, { yawDeg: 90, group: 'station' });
  b.enemy('winter', 14, -98, { yawDeg: 170, group: 'station' });
  b.enemy('wintermarksman', 23, -64, { y: P + stationTower, hold: true, yawDeg: 180, group: 'station' });

  const wave = (group: string, list: Array<[string, number, number]>) => {
    for (const [type, x, z] of list) b.enemy(type, x, z, { yawDeg: 0, group });
  };
  wave('qrf1', [['winter', -3, -46], ['winter', 3, -44], ['rusher', 0, -42], ['winter', -6, -40], ['rusher', 6, -48], ['winter', 44, -80]]);
  wave('qrf2', [['heavy', 0, -44], ['winter', -4, -42], ['winter', 4, -42], ['rusher', -8, -46], ['rusher', 8, -46], ['shotgunner', 0, -40], ['winter', 46, -88]]);
  wave('lzguard', [['winter', 44, -80], ['winter', 50, -88], ['rusher', 40, -86]]);
  b.pickup('ammo', pathX(64) - 3, 64);
  b.pickup('medkit', pathX(-20) + 2, -20);
  b.pickup('ammo', pathX(-40) - 2, -40);
}

export const ch3: ChapterDef = {
  id: 'thin-air',
  n: 3,
  title: 'Thin Air',
  codename: 'OVERWATCH',
  location: 'Orlov Pass relay station',
  clock: '06:55',
  tagline: 'Two thousand metres up, in a storm, against people who can see further than you.',
  brief: [
    'LANTERN is blind without a sky link. Corvane has seized a relay station at the head of the Orlov Pass to give it one, and put marksmen on the high ground to keep it.',
    'Climb the pass, take the sniper teams off the ridges, then put a charge on each of the three dishes. Hold the station until the storm grounds their response, and extract from the east ridge.',
  ],
  intel: [
    'This is long-range country. Bullets drop and take time to arrive: hold over, and lead anything that moves.',
    'Snow in the air cuts how far anyone can see. Their snipers show a glint just before they fire.',
    'Crouch behind rock. Pine trunks stop pistol rounds, not rifle rounds.',
  ],
  recommended: { primary: 'awm', secondary: 'mp7' },
  env: {
    skyTop: 0x8494a6, skyHorizon: 0xc3ced9, skyBottom: 0xb4bfca,
    sunDir: [0.5, 0.42, 0.6], sunColor: 0xfff4e6, sunIntensity: 2.2, sunDisc: 1.2,
    hemiSky: 0xe0e8f2, hemiGround: 0x9eabba, hemiIntensity: 1.95,
    fogColor: 0xc0cbd6, fogDensity: 0.0098,
    stars: 0, clouds: 0.9, cloudColor: 0xe1e6eb,
    envIntensity: 0.9, exposure: 0.8,
    weather: 'snow', weatherAmount: 1,
    grade: { tint: [0.96, 1.0, 1.06], contrast: 1.06, saturation: 0.8 },
    reverb: 'open', ambience: ['ambGale:0.5'], shadowRange: 60, musicRoot: 40,
  },
  visibility: 0.62,
  seed: 3301,
  build,
  stages: [
    {
      id: 'climb',
      objective: 'Climb the pass to the checkpoint',
      done: reach('checkpoint'),
      enter: (m) => {
        m.spawn('pass');
        m.radio('OVERWATCH', 'Kestrel, you are at the foot of the pass. Follow the trail north. A checkpoint sits half-way up.', 1.2);
        m.radio('OVERWATCH', 'Wind is gusting. Past two hundred metres you will have to hold over.', 9);
      },
    },
    {
      id: 'snipers',
      objective: 'Eliminate the sniper teams above the pass',
      done: kill('snipers'),
      enter: (m) => {
        m.spawn('snipers');
        m.radio('OVERWATCH', 'Two sniper teams on the ridges, one west, one east, each in a tower. They own the trail from here up. Take them first.', 0.8);
      },
    },
    {
      id: 'station',
      objective: 'Reach the relay station gate',
      done: reach('gate'),
      enter: (m) => {
        m.spawn('station');
        m.radio('OVERWATCH', 'Ridges are clear. Station is on the plateau at the top. One way in: the south gate.', 0.8);
      },
    },
    {
      id: 'charges',
      objective: 'Plant charges on all three dishes',
      done: all(use('dish1'), use('dish2'), use('dish3')),
      enter: (m) => {
        m.enable('dish1');
        m.enable('dish2');
        m.enable('dish3');
        m.radio('OVERWATCH', 'Three dishes inside the wire. A charge on each control box. There is a resupply crate in the station hut.', 0.6);
      },
    },
    {
      id: 'hold',
      objective: 'Hold the station until the storm closes in',
      marker: 'gate',
      done: survive(80),
      enter: (m) => {
        m.radio('OVERWATCH', 'Charges are set, but their response force is already on the trail. Keep them off those dishes until the weather shuts the pass.', 0.5);
        m.after(5, () => {
          m.spawn('qrf1');
          m.alert('qrf1');
        });
        m.after(40, () => {
          m.spawn('qrf2');
          m.alert('qrf2');
          m.radio('OVERWATCH', 'Second wave, machine gun with them. Storm front is two minutes out.', 0);
        });
      },
      exit: (m) => {
        m.explodeAt('dish1', 8, 380);
        m.explodeAt('dish2', 8, 380);
        m.explodeAt('dish3', 8, 380);
        m.destroyProp('dish1');
        m.destroyProp('dish2');
        m.destroyProp('dish3');
      },
    },
    {
      id: 'lz',
      objective: 'Reach the extraction point on the east ridge',
      done: reach('lz'),
      enter: (m) => {
        m.spawn('lzguard');
        m.after(1, () => m.alert('lzguard'));
        m.radio('OVERWATCH', 'Dishes are gone. LANTERN is blind. Pickup is the green beacon through the east gate. Go now, the pass is closing.', 1);
      },
    },
  ],
  debrief: 'Without the relay Corvane has one option left: fly LANTERN to a site that already has line of sight. A cargo aircraft is being fuelled at Kharan Flats.',
  menuCam: { x: 0, y: 44, z: -70, r: 62 },
  accent: '#bfe3ff',
  par: 660,
};
