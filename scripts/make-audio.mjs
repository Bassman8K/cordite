// Builds the recorded audio the game ships in public/audio/ from freely licensed source packs:
// real voice actors for callouts, real grunts and screams, and real gunshot recordings layered
// with the game's own generated thump and tail for weight.
//
// The source packs are not kept in the repository. Download and unzip them into one folder:
//   vo/    Kenney "Voiceover Pack" (CC0)        https://opengameart.org/content/voiceover-pack-40-lines
//   yell/  megaboots "Male Grunt/Yelling sounds" (CC0)   https://opengameart.org/content/male-gruntyelling-sounds
//   guns/  Vincent Sevedge gunshot recordings (CC BY 3.0) https://opengameart.org/content/gunshot-sounds
// then run:  FFMPEG=/path/to/ffmpeg node scripts/make-audio.mjs <that folder>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
const FF = process.env.FFMPEG || 'ffmpeg';
if (!src || !existsSync(src)) throw new Error('usage: FFMPEG=/path/to/ffmpeg node scripts/make-audio.mjs <folder with vo/ yell/ guns/>');
const out = join(root, 'public/audio');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const SR = 44100;

const find = (dir, name) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    } else if (n === name) return p;
  }
  return null;
};
const need = (dir, name) => {
  const p = find(join(src, dir), name);
  if (!p) throw new Error(`missing ${dir}/${name}`);
  return p;
};
function decode(file) {
  const r = spawnSync(FF, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg could not read ${file}: ${String(r.stderr).slice(0, 200)}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
}
function encode(x, name, args) {
  const buf = Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  const r = spawnSync(FF, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', ...args, join(out, name)], { input: buf, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg could not write ${name}: ${String(r.stderr).slice(0, 200)}`);
}
const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
function normalize(x, peak = 0.95) {
  const m = peakOf(x);
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}
/** Cuts silence from both ends, keeping a few milliseconds of lead-in. */
function trim(x, level = 0.02) {
  const thr = peakOf(x) * level;
  let a = 0;
  let b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < thr) a++;
  while (b > a && Math.abs(x[b]) < thr) b--;
  return x.slice(Math.max(0, a - Math.floor(SR * 0.004)), Math.min(x.length, b + Math.floor(SR * 0.03)));
}
function fade(x, inSec, outSec) {
  const a = Math.floor(SR * inSec);
  const b = Math.floor(SR * outSec);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}
function highpass(x, fc) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] -= y;
  }
  return x;
}
/** Plays `x` faster or slower (rate above 1 is higher and shorter), by linear interpolation. */
function repitch(x, rate) {
  const n = Math.floor(x.length / rate);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate;
    const k = Math.floor(p);
    y[i] = x[k] + (x[Math.min(x.length - 1, k + 1)] - x[k]) * (p - k);
  }
  return y;
}
/** Where each shot starts in a recording of several. */
function onsets(x) {
  const win = Math.floor(SR * 0.005);
  const peak = peakOf(x);
  const found = [];
  let last = -1e9;
  for (let i = 0; i + win < x.length; i += win) {
    let e = 0;
    for (let j = 0; j < win; j++) e = Math.max(e, Math.abs(x[i + j]));
    if (e > peak * 0.5 && i - last > SR * 0.35) {
      found.push(i);
      last = i;
    }
  }
  return found;
}

const manifest = {};
const MP3 = ['-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100'];
// Gunshots are stored without loss and without the start-up delay MP3 adds: a late shot feels wrong.
const FLAC = ['-c:a', 'flac', '-sample_fmt', 's16', '-ar', '32000', '-compression_level', '8'];

// ------------------------------------------------------------------ voice lines
const LINES = ['reloading', 'cover_me', 'fire_in_the_hole', 'get_down', 'go_go_go', 'look_out', 'medic', 'rpg', 'sniper', 'suppressing_fire', 'target_destroyed', 'target_engaged', 'watch_my_back', 'call_for_backup'];
// The pack has two voices in two folders; these two file names exist in only one of them each.
const maleDir = dirname(need('vo', 'hold.ogg'));
const femaleDir = dirname(need('vo', 'war_hold.ogg'));
const voice = (file, name, peak) => {
  encode(fade(normalize(trim(decode(file)), peak), 0.002, 0.02), `${name}.mp3`, MP3);
  manifest[name] = `${name}.mp3`;
};
for (const l of LINES) voice(join(maleDir, `war_${l}.ogg`), `vo_${l}`, 0.94);
voice(join(maleDir, 'hold.ogg'), 'vo_hold', 0.94);
// Headquarters, from the second voice in the pack.
for (const l of ['mission_completed', 'mission_failed', 'objective_achieved', 'hurry_up']) voice(join(femaleDir, `${l}.ogg`), `hq_${l}`, 0.9);

// ------------------------------------------------------------------ pain and death
const PAIN = ['1yell4', '1yell5', '1yell10', '2yell7', '2yell1', '3grunt1', '3grunt3', '3yell4', 'yell12', 'yell7'];
const DEATH = ['2yell11', '2yell8', '3yell11', '3yell12', '3yell15', 'yell4', 'yell1', '3yell10'];
PAIN.forEach((n, i) => {
  encode(fade(normalize(trim(decode(need('yell', `${n}.wav`))), 0.9), 0.002, 0.03), `pain_${i}.mp3`, MP3);
  manifest[`pain~${i}`] = `pain_${i}.mp3`;
});
DEATH.forEach((n, i) => {
  encode(fade(normalize(trim(decode(need('yell', `${n}.wav`))), 0.9), 0.002, 0.04), `death_${i}.mp3`, MP3);
  manifest[`death~${i}`] = `death_${i}.mp3`;
});

// ------------------------------------------------------------------ gunshots
// The game's own generator supplies the low thump and the tail a small recorder cannot capture.
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
let renderSound;
try {
  ({ renderSound } = await server.ssrLoadModule('/src/core/audio.ts'));
} finally {
  await server.close();
}
const recordings = {};
for (const [key, file] of [['pistol', 'cz.wav'], ['rifle', 'sks.wav'], ['big', 'mosin.wav'], ['shotgun', 'shotty.wav']]) {
  const x = decode(need('guns', file));
  const starts = onsets(x);
  // Only shots with room to ring out before the next one.
  recordings[key] = starts
    .map((s, i) => ({ s, gap: ((starts[i + 1] ?? x.length) - s) / SR }))
    .filter((o) => o.gap > 0.55)
    .map((o) => fade(highpass(x.slice(Math.max(0, o.s - Math.floor(SR * 0.004)), o.s + Math.floor(SR * Math.min(1.25, o.gap - 0.04))), 60), 0.001, 0.12));
  if (!recordings[key].length) throw new Error(`no usable shots found in ${file}`);
}
/** class, recording, playback rate, longest length in seconds, level of the generated layer, takes */
const SHOTS = [
  ['shotPistol', 'pistol', 1.0, 0.7, 0.4, 3],
  ['shotMagnum', 'pistol', 0.86, 0.9, 0.55, 2],
  ['shotSmg', 'pistol', 1.12, 0.45, 0.4, 3],
  ['shotRifle', 'rifle', 1.0, 0.9, 0.45, 3],
  ['shotLmg', 'rifle', 0.93, 0.7, 0.5, 3],
  ['shotMini', 'rifle', 1.06, 0.22, 0.45, 2],
  ['shotBattle', 'big', 1.04, 1.0, 0.5, 3],
  ['shotSniper', 'big', 0.94, 1.25, 0.55, 2],
  ['shotAmr', 'big', 0.74, 1.25, 0.75, 2],
  ['shotShotgun', 'shotgun', 1.0, 0.9, 0.5, 2],
];
for (const [name, rec, rate, maxLen, layer, takes] of SHOTS) {
  for (let i = 0; i < takes; i++) {
    const real = normalize(repitch(recordings[rec][i % recordings[rec].length], rate * (1 + (i - 1) * 0.015)), 1);
    const made = renderSound(name, SR);
    const n = Math.min(Math.floor(SR * maxLen), Math.max(real.length, made.length));
    const mix = new Float32Array(n);
    for (let k = 0; k < n; k++) mix[k] = Math.tanh(((real[k] ?? 0) + (made[k] ?? 0) * layer) * 1.15);
    encode(fade(normalize(mix, 0.95), 0, 0.06), `${name}_${i}.flac`, FLAC);
    manifest[`${name}~${i}`] = `${name}_${i}.flac`;
  }
}

writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
writeFileSync(
  join(out, 'CREDITS.txt'),
  `Recorded audio in this folder
=============================

Voice lines (vo_*.mp3, hq_*.mp3)
  Kenney "Voiceover Pack", www.kenney.nl. Male voice: Jeffrey M. Smith.
  Creative Commons Zero (CC0). https://opengameart.org/content/voiceover-pack-40-lines

Pain and death sounds (pain_*.mp3, death_*.mp3)
  "Male Grunt/Yelling sounds" by megaboots.
  Creative Commons Zero (CC0). https://opengameart.org/content/male-gruntyelling-sounds

Gunshots (shot*.flac)
  Recordings of a CZ-52 pistol, an SKS, a Mosin-Nagant rifle and a shotgun,
  Copyright (c) 2009 Vincent Sevedge, Creative Commons Attribution 3.0 Unported
  (https://creativecommons.org/licenses/by/3.0/), from
  https://opengameart.org/content/gunshot-sounds
  Changes: individual shots cut out, re-pitched for different weapon classes and
  mixed with generated low-frequency and tail layers by scripts/make-audio.mjs.

Everything else the game plays is generated in code.
`,
);
const total = readdirSync(out).reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(`audio: ${Object.keys(manifest).length} files, ${(total / 1048576).toFixed(2)} MB -> public/audio/`);
