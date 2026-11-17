// Builds the recorded audio the game ships in public/audio/ from freely licensed recordings:
// gunfire recorded from the real weapons (one set per cartridge), real reloads, footsteps, bullet
// impacts, explosions and weather, human voice actors for the soldiers, and the spoken story lines.
//
// The sources are not kept in the repository. Put them in one folder:
//   vo/      Kenney "Voiceover Pack" (CC0)                https://opengameart.org/content/voiceover-pack-40-lines
//   yell/    megaboots "Male Grunt/Yelling sounds" (CC0)  https://opengameart.org/content/male-gruntyelling-sounds
//   guns/    Vincent Sevedge gunshot recordings (CC BY 3.0)   https://opengameart.org/content/gunshot-sounds
//   steps/   qubodup "Different steps on wood, stone, leaves, gravel and mud" (CC0)
//            https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud
//   snow/    Corsica_S "Walking in snow" (CC0), from https://opengameart.org (corsica_s-walking_in_snow.7z)
//   impact/  qubodup "Impact" (CC0)                        https://opengameart.org/content/impact
//   fs/      Freesound recordings as <id>.mp3; scripts/audio-sources.json lists each one, and any
//            that are missing are downloaded from there by this script
//   speech/  the story lines, spoken by scripts/make-speech.mjs
// then run:  FFMPEG=/path/to/ffmpeg node scripts/make-audio.mjs <that folder>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAST, STOCK, scriptLines } from './lib/script-lines.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
const FF = process.env.FFMPEG || 'ffmpeg';
if (!src || !existsSync(src)) throw new Error('usage: FFMPEG=/path/to/ffmpeg node scripts/make-audio.mjs <folder with the source recordings>');
const out = join(root, 'public/audio');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const SR = 44100;
const sec = (t) => Math.round(t * SR);

// ------------------------------------------------------------------ files
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
  const p = existsSync(join(src, dir)) ? find(join(src, dir), name) : null;
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
const loaded = new Map();
const load = (file) => {
  if (!loaded.has(file)) loaded.set(file, decode(file));
  return loaded.get(file);
};

/** Freesound recordings, by id. Every one used is credited; one that is not on disk is downloaded. */
const SOURCES = JSON.parse(readFileSync(join(root, 'scripts/audio-sources.json'), 'utf8'));
const used = new Set();
async function fetchSources() {
  mkdirSync(join(src, 'fs'), { recursive: true });
  for (const [id, s] of Object.entries(SOURCES)) {
    const file = join(src, 'fs', `${id}.mp3`);
    if (existsSync(file) && statSync(file).size > 500) continue;
    const r = await fetch(s.url, { headers: { 'User-Agent': 'audio-build' } });
    if (!r.ok) throw new Error(`could not download Freesound ${id} (${s.title}): HTTP ${r.status}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
}
function fs(id) {
  if (!SOURCES[id]) throw new Error(`Freesound ${id} is used but not listed in scripts/audio-sources.json`);
  used.add(String(id));
  return load(join(src, 'fs', `${id}.mp3`));
}

// ------------------------------------------------------------------ signal tools
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
  return x.slice(Math.max(0, a - sec(0.004)), Math.min(x.length, b + sec(0.03)));
}
function fade(x, inSec, outSec) {
  const a = sec(inSec);
  const b = Math.min(sec(outSec), x.length);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b; i++) x[x.length - 1 - i] *= i / b;
  return x;
}
/** A second-order filter (RBJ cookbook): 'highpass', 'lowpass' or 'lowshelf'. */
function biquad(x, type, f, gainDb = 0, q = 0.707) {
  const w = (2 * Math.PI * f) / SR;
  const cs = Math.cos(w);
  const sn = Math.sin(w);
  const alpha = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
  } else if (type === 'lowpass') {
    b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
  } else {
    const A = 10 ** (gainDb / 40);
    const k = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cs + k); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - k);
    a0 = A + 1 + (A - 1) * cs + k; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - k;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
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
/** The sample where the sound nearest `t` actually begins: the first one to reach a third of the local peak. */
function snap(x, t, win = 0.03) {
  const a = Math.max(0, sec(t - win));
  const b = Math.min(x.length, sec(t + win));
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = a; i < b; i++) if (Math.abs(x[i]) > peak * 0.33) return i;
  return sec(t);
}
/**
 * The same for one round inside automatic fire, where the previous round is still ringing: find the
 * loudest instant near `t` and step back to where that round's attack begins.
 */
function snapPeak(x, t, win) {
  const a = Math.max(0, sec(t - win));
  const b = Math.min(x.length, sec(t + win));
  let p = a;
  for (let i = a; i < b; i++) if (Math.abs(x[i]) > Math.abs(x[p])) p = i;
  const peak = Math.abs(x[p]);
  for (let i = Math.max(0, p - sec(0.008)); i < p; i++) if (Math.abs(x[i]) > peak * 0.33) return i;
  return p;
}
/** One event cut out of a longer recording, beginning a moment before its attack. */
function cut(x, t, len, pre = 0.003) {
  const s = Math.max(0, snap(x, t) - sec(pre));
  return x.slice(s, Math.min(x.length, s + sec(len)));
}
/** A plain stretch of a recording, no attack to find. */
const span = (x, a, b) => x.slice(sec(a), Math.min(x.length, sec(b)));
const rms = (x, a, b) => {
  let s = 0;
  const lo = Math.max(0, a);
  const hi = Math.min(x.length, b);
  for (let i = lo; i < hi; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, hi - lo));
};
/**
 * Joins the start of one shot to the ring-out recorded after another, so a shot cut from the middle
 * of a burst still dies away naturally. The tail is brought to the level the body ends at.
 */
function splice(body, tail, xf = 0.012) {
  const n = sec(xf);
  const endLevel = rms(body, body.length - sec(0.03), body.length);
  const tailLevel = rms(tail, 0, sec(0.03));
  const g = tailLevel > 0 ? Math.min(3, endLevel / tailLevel) : 1;
  const y = new Float32Array(body.length + tail.length - n);
  y.set(body.subarray(0, body.length - n));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    y[body.length - n + i] = body[body.length - n + i] * Math.cos((u * Math.PI) / 2) + tail[i] * g * Math.sin((u * Math.PI) / 2);
  }
  for (let i = n; i < tail.length; i++) y[body.length - n + i] = tail[i] * g;
  return y;
}
/** Lets a sound die away from `hold` seconds on: undoes a recorder's automatic gain holding the echo up. */
function decay(x, hold, tau) {
  const h = sec(hold);
  for (let i = h; i < x.length; i++) x[i] *= Math.exp(-(i - h) / (tau * SR));
  return x;
}
/** Rounds off anything above 0.7 instead of clipping it. */
function limit(x) {
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > 0.7) x[i] = Math.sign(x[i]) * (0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
  }
  return x;
}
/** Sets how loud a shot is by the energy of its first tenth of a second, so takes of one class match. */
function levelShot(x, loud) {
  const r = rms(x, 0, sec(0.1));
  const p = peakOf(x);
  if (r > 0) {
    const g = Math.min((0.3 * loud) / r, (2.4 * loud) / p);
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  return limit(x);
}
/** Evens out a voice so quiet syllables carry over gunfire, then brings it back up to full level. */
function compress(x, threshold, ratio, peak = 0.95) {
  normalize(x, 1);
  const att = Math.exp(-1 / (0.004 * SR));
  const rel = Math.exp(-1 / (0.09 * SR));
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    if (env > threshold) x[i] *= (threshold + (env - threshold) / ratio) / env;
  }
  return normalize(x, peak);
}
/** Where each shot starts in a recording of several widely spaced ones. */
function onsets(x) {
  const win = sec(0.005);
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
const MP3_SPEECH = ['-c:a', 'libmp3lame', '-b:a', '40k', '-ar', '22050'];
const MP3_LONG = ['-c:a', 'libmp3lame', '-b:a', '72k', '-ar', '32000'];
// Short sounds are stored without loss and without the start-up delay MP3 adds: a late shot feels wrong.
const FLAC = ['-c:a', 'flac', '-sample_fmt', 's16', '-ar', '32000', '-compression_level', '8'];
const kind = { MP3: 'mp3', FLAC: 'flac' };
/** Writes one or several takes of a sound and lists them. */
function put(name, takes, args, ext) {
  const list = Array.isArray(takes) ? takes : [takes];
  list.forEach((x, i) => {
    const key = list.length > 1 ? `${name}~${i}` : name;
    const file = list.length > 1 ? `${name}_${i}.${ext}` : `${name}.${ext}`;
    encode(x, file, args);
    manifest[key] = file;
  });
}
const flac = (name, takes) => put(name, takes, FLAC, kind.FLAC);
/** The same real recording at slightly different speeds: enough that repeats are not identical. */
const variants = (x, rates = [0.94, 1, 1.07]) => rates.map((r) => (r === 1 ? x : repitch(x, r)));
/** A short everyday sound: rumble removed, both ends faded, brought to a set peak. */
const tidy = (x, peak, hp = 70, fadeOut = 0.03) => fade(normalize(biquad(trim(x, 0.012), 'highpass', hp), peak), 0.001, fadeOut);

await fetchSources();

// ------------------------------------------------------------------ soldiers' voices
// Two voice actors from the same pack, so a squad is not one man talking to himself.
const LINES = ['reloading', 'cover_me', 'fire_in_the_hole', 'get_down', 'go_go_go', 'look_out', 'medic', 'rpg', 'sniper', 'suppressing_fire', 'target_destroyed', 'target_engaged', 'watch_my_back', 'call_for_backup', 'hold'];
// The pack has its two voices in two folders; these two file names exist in only one of them each.
const maleDir = dirname(need('vo', 'hold.ogg'));
const femaleDir = dirname(need('vo', 'war_hold.ogg'));
const shout = (file) => fade(compress(biquad(trim(decode(file)), 'highpass', 120), 0.22, 4, 0.95), 0.002, 0.02);
for (const l of LINES) {
  put(`vo_${l}`, shout(join(maleDir, l === 'hold' ? 'hold.ogg' : `war_${l}.ogg`)), MP3, kind.MP3);
  // (the pack misspells one file name in this folder)
  put(`vo2_${l}`, shout(join(femaleDir, l === 'suppressing_fire' ? 'war_supressing_fire.ogg' : `war_${l}.ogg`)), MP3, kind.MP3);
}

// ------------------------------------------------------------------ pain and death
const PAIN = ['1yell4', '1yell5', '1yell10', '2yell7', '2yell1', '3grunt1', '3grunt3', '3yell4', 'yell12', 'yell7'];
const DEATH = ['2yell11', '2yell8', '3yell11', '3yell12', '3yell15', 'yell4', 'yell1', '3yell10'];
put('pain', PAIN.map((n) => fade(normalize(trim(decode(need('yell', `${n}.wav`))), 0.9), 0.002, 0.03)), MP3, kind.MP3);
put('death', DEATH.map((n) => fade(normalize(trim(decode(need('yell', `${n}.wav`))), 0.9), 0.002, 0.04)), MP3, kind.MP3);

// ------------------------------------------------------------------ the story, spoken
const speech = (key) => {
  const file = join(src, 'speech', `${key}.wav`);
  if (!existsSync(file)) throw new Error(`no recording for line ${key}: run scripts/make-speech.mjs first`);
  return fade(compress(biquad(trim(decode(file), 0.01), 'highpass', 90), 0.3, 3, 0.93), 0.004, 0.05);
};
for (const l of scriptLines(root)) put(l.key, speech(l.key), MP3_SPEECH, kind.MP3);
for (const [name, texts] of Object.entries(STOCK)) put(`hq_${name}`, texts.map((_, i) => speech(`hq_${name}_${i}`)), MP3_SPEECH, kind.MP3);

// ------------------------------------------------------------------ gunfire
// Every class is cut from recordings of real weapons firing that cartridge. Nothing is layered on top
// and nothing is re-pitched: the only work done is cutting single shots out, removing rumble, matching
// levels and rounding off clipped peaks.
/** One shot from a recording: [id, time of the shot, length, optional forced die-away {hold, tau}] */
const S = (id, t, len, die) => ({ id, t, len, die });
/**
 * One round from inside a burst, `period` seconds before the next, finished with the ring-out recorded
 * after a burst ends. `tau` is how fast that ring-out is let die: automatic fire stacks many of them.
 */
const B = (id, t, period, tailId, tailAt, tailLen, tau = 0.17) => ({ id, t, period, tailId, tailAt, tailLen, tau });
/** A shot from the Sevedge pack, whose files hold several widely spaced shots each. */
const V = (file, n) => ({ file, n });
const sevedge = new Map();
function sevedgeShot(file, n) {
  if (!sevedge.has(file)) {
    const x = decode(need('guns', file));
    const starts = onsets(x);
    const shots = starts
      .map((s, i) => ({ s, gap: ((starts[i + 1] ?? x.length) - s) / SR }))
      .filter((o) => o.gap > 0.55)
      .map((o) => x.slice(Math.max(0, o.s - sec(0.004)), o.s + sec(Math.min(1.1, o.gap - 0.04))));
    if (!shots.length) throw new Error(`no usable shots found in ${file}`);
    sevedge.set(file, shots);
  }
  const shots = sevedge.get(file);
  return Float32Array.from(shots[n % shots.length]);
}
const GUNS = {
  // .22 rimfire: a .22 Magnum pistol
  shot22: { loud: 0.5, takes: [S(427594, 0.2, 0.6)] },
  // 9 mm and the other small pistol cartridges: Glock 19X, SIG P226 Legion, S&W M&P9, a 9 mm pistol, Vektor CP1, ASP
  shotPistol: { loud: 0.72, takes: [S(828786, 0.01, 0.55), S(711549, 0.05, 0.45), S(692587, 0.01, 0.65), S(427592, 0.125, 0.65), S(712087, 0.02, 0.5), S(734061, 0.04, 0.42)] },
  // .45 ACP: SIG P220, H&K USP45, Colt 1911
  shot45: { loud: 0.78, takes: [S(712085, 0.02, 0.55), S(734062, 0.045, 0.65), S(740897, 0.02, 0.6, { hold: 0.05, tau: 0.1 })] },
  // big-bore handguns: Desert Eagle .50 AE, a Glock 20SF converted to .50 GI
  shotMagnum: { loud: 0.92, takes: [S(712310, 0.015, 0.65), S(734055, 0.035, 0.65)] },
  // 5.7 mm and 4.6 mm: FN P90, shots from one automatic burst and the burst's last shot ringing out
  shotPdw: { loud: 0.72, takes: [B(740896, 0.233, 0.061, 740896, 3.04, 0.5), B(740896, 0.295, 0.061, 740896, 3.04, 0.5), B(740896, 0.355, 0.061, 740896, 3.04, 0.5), B(740896, 0.417, 0.061, 740896, 3.04, 0.5), S(740896, 2.978, 0.55)] },
  // 5.56 mm rifles: Colt M4A1, an AR-15, M16s on a US Navy range, Colt Model 733, Colt M16A1
  shotAr: { loud: 0.9, takes: [S(737569, 0.04, 0.8, { hold: 0.06, tau: 0.13 }), S(427596, 0.08, 0.75, { hold: 0.12, tau: 0.16 }), S(162396, 0.02, 0.5, { hold: 0.04, tau: 0.1 }), S(162403, 0.01, 0.5, { hold: 0.04, tau: 0.1 }), B(704511, 1.648, 0.069, 704511, 3.724, 0.9), B(693546, 0.165, 0.078, 693546, 7.28, 0.3), B(693546, 0.25, 0.078, 693546, 7.28, 0.3)] },
  // 7.62x39 and 5.45 mm Kalashnikovs: an AK-47 (two recordists), Saiga MK-030, an SKS
  shotAk: { loud: 0.92, takes: [S(520934, 1.12, 0.85), S(163457, 0.004, 0.5), S(698984, 0.088, 0.7), S(698984, 4.356, 0.55), S(698984, 9.778, 0.55), V('sks.wav', 0), V('sks.wav', 1)] },
  // 7.62 NATO rifles: FN SCAR-H, SIG716, Saiga MK-106 in .308, H&K HK51
  shotBattle: { loud: 0.96, takes: [S(702225, 0.031, 0.8), S(692584, 0.014, 0.85), S(696023, 0.03, 0.85), B(693547, 0.027, 0.088, 693547, 5.34, 0.9, 0.3)] },
  // .30-06: M1 Garand
  shotGarand: { loud: 0.96, takes: [S(385785, 0.04, 0.95, { hold: 0.07, tau: 0.2 })] },
  // full-power bolt-action service rifles: Mosin-Nagant, Lee-Enfield .303
  shotBolt: { loud: 0.96, takes: [V('mosin.wav', 0), V('mosin.wav', 2), S(450852, 0.23, 0.5)] },
  // modern sniper rifles: M2010 Enhanced Sniper Rifle (.300 Win Mag) at a US Army match, and a range recording
  shotSniper: { loud: 0.98, takes: [S(855608, 0.012, 1.2), S(524739, 0.705, 0.95, { hold: 0.1, tau: 0.32 }), S(524738, 0.69, 1.1, { hold: 0.1, tau: 0.32 })] },
  // .50 BMG rifles: a single shot on an outdoor range, and an M2's first round with that shot's ring-out
  shotAmr: { loud: 1, takes: [S(668071, 0.018, 0.75), B(239138, 1.143, 0.105, 668071, 0.125, 0.6, 0.4)] },
  // .50 machine guns: Browning M2, the first round of three bursts
  shotHmg: { loud: 1, takes: [B(239138, 0.005, 0.105, 239138, 0.56, 0.38), B(239138, 1.143, 0.105, 239138, 0.56, 0.38), B(239138, 2.731, 0.105, 239138, 0.56, 0.38)] },
  // 7.62 mm machine guns: IWI Negev NG-7 and a US Army gun, finished with an M60 burst dying away
  shotLmg: { loud: 0.93, takes: [B(725798, 0.056, 0.067, 538302, 7.56, 1.0), B(725798, 0.14, 0.067, 538302, 7.56, 1.0), B(725798, 0.21, 0.067, 538302, 7.56, 1.0), B(482122, 0.014, 0.088, 538302, 7.56, 1.0), B(482122, 0.102, 0.088, 538302, 7.56, 1.0)] },
  // 5.56 mm machine guns: KAC LAMG
  shotLmgLight: { loud: 0.9, takes: [B(693856, 0.2, 0.105, 538302, 7.56, 0.8), B(693856, 0.31, 0.105, 538302, 7.56, 0.8), B(693856, 0.42, 0.105, 538302, 7.56, 0.8), B(693856, 0.53, 0.105, 538302, 7.56, 0.8)] },
  // rotary guns fire 7.62 NATO far faster than one shot can ring: short HK51 rounds
  shotMini: { loud: 0.85, takes: [B(693547, 0.027, 0.05, 693547, 5.34, 0.22, 0.07), B(693547, 0.118, 0.05, 693547, 5.34, 0.22, 0.07), B(693547, 0.21, 0.05, 693547, 5.34, 0.22, 0.07)] },
  // 12 gauge: Remington 870, a Beretta 687 on a range, two more shotguns, a 20 gauge
  shotShotgun: { loud: 0.96, takes: [S(702672, 0.04, 0.8), S(405504, 0.065, 0.85), S(473846, 0.003, 0.75), S(163455, 0.02, 0.6), S(427595, 0.06, 0.65), V('shotty.wav', 0)] },
  // suppressed pistols and submachine guns: SIG P226, Springfield 1911 Operator, FN FNX-45 with an Osprey, H&K MP7
  shotSup: { loud: 0.42, takes: [S(828790, 0.022, 0.34), S(828790, 0.774, 0.45), S(827945, 0.02, 0.45), S(693855, 0.04, 0.17), S(732250, 0.008, 0.45)] },
  // suppressed heavy rifles: McMillan Tac-50
  shotSupHeavy: { loud: 0.6, takes: [S(737570, 0.014, 1.1, { hold: 0.08, tau: 0.28 })] },
  // 40 mm grenade launchers: M203
  shotThump: { loud: 0.8, takes: [S(162402, 0.02, 0.42), S(163458, 0.01, 0.38), S(162401, 0.02, 0.4)] },
  // a bow being loosed
  shotBow: { loud: 0.5, takes: [S(384918, 0.08, 0.35)] },
};
function gunTake(t) {
  let x;
  if (t.file) x = sevedgeShot(t.file, t.n);
  else if (t.period) {
    const burst = fs(t.id);
    const start = Math.max(0, snapPeak(burst, t.t, Math.min(0.03, t.period * 0.45)) - sec(0.002));
    const body = burst.slice(start, start + sec(t.period - 0.004));
    x = decay(splice(body, Float32Array.from(span(fs(t.tailId), t.tailAt, t.tailAt + t.tailLen)), 0.01), t.period, t.tau);
  } else x = Float32Array.from(cut(fs(t.id), t.t, t.len));
  if (t.die) decay(x, t.die.hold, t.die.tau);
  return x;
}
for (const [name, g] of Object.entries(GUNS)) {
  flac(name, g.takes.map((t) => fade(levelShot(biquad(biquad(gunTake(t), 'highpass', 45), 'lowshelf', 130, 3), g.loud), 0, 0.09)));
}
// 9 mm submachine guns fire the pistol cartridge: the same recordings serve both.
for (let i = 0; i < 4; i++) manifest[`shotSmg~${i}`] = manifest[`shotPistol~${i}`];

// ------------------------------------------------------------------ handling the weapon
const piece = (id, a, b) => Float32Array.from(span(fs(id), a, b));
/** Several separate movements played back to back with a short gap, for an action too slow as recorded. */
function joined(parts, gap = 0.05) {
  const n = parts.reduce((s, p) => s + p.length, 0) + sec(gap) * (parts.length - 1);
  const y = new Float32Array(n);
  let at = 0;
  for (const p of parts) {
    y.set(fade(p, 0.002, 0.02), at);
    at += p.length + sec(gap);
  }
  return y;
}
flac('magOut', [tidy(piece(815879, 0.02, 0.32), 0.7, 150), tidy(piece(812532, 0.08, 0.34), 0.7, 150)]);
flac('magIn', [tidy(piece(171209, 1.12, 1.6), 0.8, 120), tidy(piece(171614, 0.15, 0.52), 0.8, 120), tidy(piece(427593, 0.5, 0.82), 0.8, 120), tidy(piece(427599, 1.98, 2.36), 0.8, 120)]);
// a slide or charging handle pulled and let go
flac('bolt', [tidy(piece(427593, 1.5, 1.98), 0.8, 150), tidy(joined([piece(427599, 3.36, 3.62), piece(427599, 4.22, 4.56)]), 0.8, 150), tidy(piece(815879, 1.38, 1.87), 0.8, 150)]);
// a bolt-action rifle worked by hand: up and back, forward and down
flac('boltAction', variants(tidy(joined([piece(620928, 0.12, 0.27), piece(620928, 0.4, 0.56), piece(620928, 0.99, 1.15), piece(620928, 1.29, 1.5)], 0.045), 0.8, 150), [0.95, 1.04]));
// heavy weapons: the charging handle of a Barrett M82A1
flac('boltHeavy', variants(tidy(piece(855599, 0.04, 0.82), 0.85, 100), [1, 0.92]));
flac('pump', [tidy(piece(613801, 0.03, 0.62), 0.85, 120), tidy(piece(673320, 2.98, 3.62), 0.85, 120)]);
flac('dry', [tidy(piece(427603, 0.02, 0.42), 0.6, 200), tidy(piece(725402, 0.01, 0.34), 0.6, 200), tidy(piece(842748, 0, 0.25), 0.5, 200)]);
// spent brass landing on a hard floor
flac('casing', variants(tidy(piece(778028, 0, 0.3), 0.5, 400), [0.9, 1, 1.12]));
// the empty clip leaving an M1 Garand
flac('ping', tidy(piece(725398, 0.02, 0.95), 0.75, 300, 0.2));
// a radio keyed and released
flac('radio', tidy(piece(692588, 0.04, 0.33), 0.5, 200));
flac('radioEnd', tidy(piece(700160, 0.1, 0.62), 0.32, 200, 0.08));

// ------------------------------------------------------------------ footsteps
const step = (x, peak = 0.5) => fade(normalize(biquad(trim(x, 0.03), 'highpass', 60), peak), 0.002, 0.05);
const concrete = fs(712084);
flac('stepHard', [0.28, 1.28, 2.51, 3.56, 4.68, 5.79].map((t) => step(Float32Array.from(cut(concrete, t, 0.3, 0.02)))).concat([step(decode(need('steps', 'stone01.ogg')))]));
flac('stepWood', ['wood01.ogg', 'wood02.ogg', 'wood03.ogg'].map((f) => step(decode(need('steps', f)))));
flac('stepSoft', [step(decode(need('steps', 'gravel.ogg')), 0.45), step(decode(need('steps', 'mud02.ogg')), 0.45), ...variants(step(decode(need('steps', 'gravel.ogg')), 0.45), [0.9, 1.1])]);
flac('stepSnow', ['gravel_01', 'gravel_02', 'gravel_03', 'gravel_05', 'gravel_06', 'gravel_and_ice_02'].map((n) => step(decode(need('snow', `Corsica_S-Walking_on_snow_covered_${n}.flac`)), 0.5)));
flac('stepMetal', [...variants(step(Float32Array.from(span(fs(421151), 0, 0.3)), 0.55), [0.94, 1.05]), ...variants(step(fs(398554).slice(), 0.5), [1, 0.92])]);

// ------------------------------------------------------------------ bullets arriving
const thud = (file) => fade(normalize(biquad(trim(decode(need('impact', file)), 0.01), 'highpass', 60), 0.8), 0.001, 0.04);
flac('hitConcrete', variants(thud('qubodupImpactStone.flac')));
flac('hitMetal', variants(thud('qubodupImpactMetal.flac')));
flac('hitWood', variants(thud('qubodupImpactWood.flac')));
flac('hitFlesh', [thud('qubodupImpactMeat01.flac'), thud('qubodupImpactMeat02.flac'), tidy(piece(511194, 0.05, 0.6), 0.8, 60)]);
// a real round passing a microphone on a range, and the whoosh of a slower one
flac('crack', variants(tidy(fs(855248).slice(), 0.85, 300, 0.02), [0.92, 1, 1.1]));
flac('whiz', variants(tidy(piece(789222, 0, 0.42), 0.6, 200, 0.1), [0.9, 1, 1.12]));
// a slingshot round whining off rock
flac('ricochet', variants(tidy(piece(394187, 0.1, 1.5), 0.6, 300, 0.4), [0.92, 1.08]));
flac('bodyfall', tidy(piece(504626, 0.05, 1.3), 0.7, 40, 0.15));

// ------------------------------------------------------------------ explosions
// US Department of Defense footage: M67 fragmentation grenades and a demolition charge.
const blast = (x, len) => fade(limit(normalize(biquad(biquad(x, 'highpass', 30), 'lowshelf', 110, 5), 1.25)), 0, Math.min(0.6, len * 0.4));
put('explosion', [blast(Float32Array.from(cut(fs(182431), 0.02, 2.2)), 2.2), blast(Float32Array.from(cut(fs(182432), 0.53, 2.4)), 2.4), blast(Float32Array.from(cut(fs(67472), 0.01, 1.8)), 1.8), blast(Float32Array.from(cut(fs(182430), 0.02, 2.2)), 2.2)], ['-c:a', 'libmp3lame', '-b:a', '96k', '-ar', '44100'], kind.MP3);

// ------------------------------------------------------------------ the world
/** A stretch of weather made to repeat without a seam: its end is blended into its beginning. */
function loop(x, xf = 0.6) {
  const n = sec(xf);
  const y = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    y[i] = x[i] * Math.sin((u * Math.PI) / 2) + x[x.length - n + i] * Math.cos((u * Math.PI) / 2);
  }
  return y;
}
put('ambRain', normalize(biquad(loop(Float32Array.from(span(fs(700155), 2, 16.6))), 'highpass', 60), 0.5), MP3_LONG, kind.MP3);
put('ambWaves', normalize(biquad(loop(fs(852826).slice(), 0.3), 'highpass', 40), 0.6), MP3_LONG, kind.MP3);
put('rotor', normalize(biquad(loop(fs(187681).slice(), 0.2), 'highpass', 35), 0.8), MP3_LONG, kind.MP3);
// fighting somewhere else in the city
put('distant', [855242, 855243, 855244, 854635].map((id) => fade(normalize(biquad(trim(fs(id).slice(), 0.02), 'highpass', 50), 0.8), 0.02, 0.25)), MP3, kind.MP3);

// ------------------------------------------------------------------ what was built, and whose work it is
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
const unused = Object.keys(SOURCES).filter((id) => !used.has(id));
if (unused.length) console.warn(`audio-sources.json lists recordings that nothing uses: ${unused.join(' ')}`);
const LICENSE = { 'publicdomain/zero/1.0': 'CC0', 'licenses/by/4.0': 'CC BY 4.0', 'licenses/by/3.0': 'CC BY 3.0' };
const credit = (id) => {
  const s = SOURCES[id];
  const lic = LICENSE[s.license];
  if (!lic) throw new Error(`Freesound ${id} has a licence this game cannot use: ${s.license}`);
  return `  ${s.title} - ${s.author} - ${lic} - https://freesound.org/s/${id}/`;
};
const ids = [...used].sort((a, b) => Number(a) - Number(b));
const byLicense = (lic) => ids.filter((id) => LICENSE[SOURCES[id].license] === lic);
writeFileSync(
  join(out, 'CREDITS.txt'),
  `Recorded audio in this folder
=============================

Nothing here is synthesised gunfire. Every shot, reload, footstep, impact and explosion is a
recording of the real thing, cut and levelled by scripts/make-audio.mjs.

Soldiers' voices (vo_*.mp3, vo2_*.mp3)
  Kenney "Voiceover Pack", www.kenney.nl. Male voice: Jeffrey M. Smith.
  Creative Commons Zero (CC0). https://opengameart.org/content/voiceover-pack-40-lines

Pain and death sounds (pain_*.mp3, death_*.mp3)
  "Male Grunt/Yelling sounds" by megaboots.
  Creative Commons Zero (CC0). https://opengameart.org/content/male-gruntyelling-sounds

Story dialogue (say_*.mp3, hq_*.mp3)
  Spoken by Piper (https://github.com/OHF-Voice/piper1-gpl), a neural voice that runs offline,
  with voices their speakers released into the public domain:
${Object.entries(CAST).map(([who, c]) => `    ${who.padEnd(10)} ${c.model}`).join('\n')}
  These are computer voices modelled on real people, not performances by actors.

Gunshots, part (shotAk_5.flac, shotAk_6.flac, shotBolt_0.flac, shotBolt_1.flac, shotShotgun_5.flac)
  Recordings of an SKS, a Mosin-Nagant rifle and a shotgun,
  Copyright (c) 2009 Vincent Sevedge, Creative Commons Attribution 3.0 Unported
  (https://creativecommons.org/licenses/by/3.0/), from
  https://opengameart.org/content/gunshot-sounds
  Changes: individual shots cut out and levelled.

Footsteps and impacts, part
  "Different steps on wood, stone, leaves, gravel and mud" and "Impact" by qubodup, CC0,
  https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud
  https://opengameart.org/content/impact
  "Walking in snow" by Corsica_S, CC0, https://opengameart.org

Freesound recordings under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/)
Changes: single events cut out, rumble removed, levelled.
${byLicense('CC BY 4.0').map(credit).join('\n')}

Freesound recordings in the public domain (CC0), credited with thanks
${byLicense('CC0').map(credit).join('\n')}

Music, interface sounds, wind and a few small effects are generated in code.
`,
);
const total = readdirSync(out).reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(`audio: ${Object.keys(manifest).length} sounds in ${readdirSync(out).length - 2} files, ${(total / 1048576).toFixed(2)} MB -> public/audio/`);
