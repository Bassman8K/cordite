// Fully synthesised audio. No samples are shipped: each sound is rendered into a small buffer the
// first time it is needed, positional sounds go through a panner, and the score is generative.

import { clamp, lerp } from './math';
import { store } from './settings';
import type { Surface } from '../world/collision';

type Buf = Float32Array;
type GenFn = (sr: number) => Buf;

// ------------------------------------------------------------------ tiny DSP toolkit

const TAU = Math.PI * 2;
const mk = (sr: number, sec: number): Buf => new Float32Array(Math.max(1, Math.floor(sr * sec)));

function noise(sr: number, sec: number): Buf {
  const b = mk(sr, sec);
  for (let i = 0; i < b.length; i++) b[i] = Math.random() * 2 - 1;
  return b;
}
/** One-pole low-pass. `fc` may be a number or a function of time (seconds). */
function lp(b: Buf, sr: number, fc: number | ((t: number) => number)): Buf {
  let y = 0;
  for (let i = 0; i < b.length; i++) {
    const f = typeof fc === 'number' ? fc : fc(i / sr);
    const a = 1 - Math.exp((-TAU * f) / sr);
    y += a * (b[i] - y);
    b[i] = y;
  }
  return b;
}
function hp(b: Buf, sr: number, fc: number): Buf {
  let y = 0;
  const a = 1 - Math.exp((-TAU * fc) / sr);
  for (let i = 0; i < b.length; i++) {
    y += a * (b[i] - y);
    b[i] -= y;
  }
  return b;
}
/** Two-pole resonant band-pass (state-variable). */
function bp(b: Buf, sr: number, fc: number | ((t: number) => number), q = 3): Buf {
  let low = 0;
  let band = 0;
  for (let i = 0; i < b.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(typeof fc === 'number' ? fc : fc(i / sr), sr * 0.22)) / sr);
    low += f * band;
    const high = b[i] - low - band / q;
    band += f * high;
    b[i] = band;
  }
  return b;
}
/** Exponential decay envelope with a short attack. */
function decay(b: Buf, sr: number, tau: number, attack = 0.001, start = 0): Buf {
  for (let i = 0; i < b.length; i++) {
    const t = i / sr - start;
    b[i] *= t < 0 ? 0 : Math.min(1, t / attack) * Math.exp(-t / tau);
  }
  return b;
}
function tone(sr: number, sec: number, f0: number, f1 = f0, sweep = sec, shape: 'sin' | 'saw' | 'sq' | 'tri' = 'sin'): Buf {
  const b = mk(sr, sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const k = Math.min(1, t / sweep);
    const f = f0 * Math.pow(f1 / f0, k);
    ph += f / sr;
    const p = ph - Math.floor(ph);
    b[i] = shape === 'sin' ? Math.sin(ph * TAU) : shape === 'saw' ? p * 2 - 1 : shape === 'sq' ? (p < 0.5 ? 1 : -1) : Math.abs(p * 4 - 2) - 1;
  }
  return b;
}
function mix(dst: Buf, src: Buf, gain = 1, at = 0): Buf {
  const n = Math.min(dst.length - at, src.length);
  for (let i = 0; i < n; i++) dst[at + i] += src[i] * gain;
  return dst;
}
function sat(b: Buf, drive = 1): Buf {
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive);
  return b;
}
function norm(b: Buf, peak = 0.9): Buf {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
  return b;
}
function fadeOut(b: Buf, sr: number, sec: number): Buf {
  const n = Math.min(b.length, Math.floor(sr * sec));
  for (let i = 0; i < n; i++) b[b.length - 1 - i] *= i / n;
  return b;
}
/** Makes a buffer loop seamlessly by cross-fading its tail into its head. */
function loopable(b: Buf, sr: number, sec = 0.6): Buf {
  const n = Math.floor(sr * sec);
  const out = b.slice(0, b.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = out[i] * t + b[b.length - n + i] * (1 - t);
  }
  return out;
}

interface ShotP {
  dur: number;
  crack: number;
  f0: number;
  f1: number;
  body: number;
  sub: number;
  subF: number;
  tail: number;
  drive: number;
}
function shot(sr: number, p: ShotP): Buf {
  const out = mk(sr, p.dur);
  mix(out, decay(hp(noise(sr, 0.05), sr, 2400), sr, 0.007), p.crack);
  mix(out, decay(lp(noise(sr, p.dur), sr, (t) => p.f1 + (p.f0 - p.f1) * Math.exp(-t / 0.035)), sr, p.body), 1.5);
  mix(out, decay(tone(sr, 0.4, p.subF, p.subF * 0.42, 0.09), sr, 0.085), p.sub);
  if (p.tail > 0) mix(out, decay(lp(noise(sr, p.dur), sr, 850), sr, p.dur * 0.3, 0.02), p.tail);
  return fadeOut(norm(sat(out, p.drive), 0.92), sr, 0.03);
}

function clicks(sr: number, sec: number, times: number[], f: number, tau = 0.012, gain = 1): Buf {
  const out = mk(sr, sec);
  for (const t of times) {
    const c = decay(bp(noise(sr, 0.06), sr, f * (0.85 + Math.random() * 0.3), 4), sr, tau);
    mix(out, c, gain * (0.7 + Math.random() * 0.3), Math.floor(t * sr));
  }
  return norm(out, 0.8);
}

function step(sr: number, kind: 'hard' | 'metal' | 'wood' | 'soft' | 'snow'): Buf {
  const out = mk(sr, 0.24);
  if (kind === 'hard') {
    mix(out, decay(lp(noise(sr, 0.2), sr, 1500), sr, 0.03), 1);
    mix(out, decay(tone(sr, 0.1, 140, 80), sr, 0.03), 0.7);
    mix(out, decay(hp(noise(sr, 0.05), sr, 3000), sr, 0.01), 0.25, Math.floor(sr * 0.045));
  } else if (kind === 'metal') {
    mix(out, decay(tone(sr, 0.2, 520, 500), sr, 0.06), 0.4);
    mix(out, decay(tone(sr, 0.2, 1270, 1250), sr, 0.045), 0.25);
    mix(out, decay(lp(noise(sr, 0.1), sr, 2500), sr, 0.02), 0.8);
  } else if (kind === 'wood') {
    mix(out, decay(tone(sr, 0.15, 210, 150), sr, 0.035), 1);
    mix(out, decay(lp(noise(sr, 0.1), sr, 1100), sr, 0.02), 0.6);
  } else if (kind === 'snow') {
    mix(out, decay(bp(noise(sr, 0.24), sr, 2600, 1.2), sr, 0.07, 0.02), 1);
    mix(out, decay(lp(noise(sr, 0.2), sr, 500), sr, 0.05), 0.6);
  } else {
    mix(out, decay(lp(noise(sr, 0.22), sr, 620), sr, 0.045, 0.004), 1.2);
    mix(out, decay(bp(noise(sr, 0.2), sr, 3200, 1.5), sr, 0.03, 0.01), 0.18);
  }
  return fadeOut(norm(out, 0.7), sr, 0.02);
}

/** Speech-like garble for enemy shouts: a buzzy source through moving formants. */
function garble(sr: number, sec: number, pitch: number): Buf {
  const src = tone(sr, sec, pitch, pitch * 0.82, sec, 'saw');
  const breath = noise(sr, sec);
  for (let i = 0; i < src.length; i++) src[i] = src[i] * 0.8 + breath[i] * 0.25;
  const syl = 5 + Math.floor(Math.random() * 3);
  const f1 = [650, 400, 750, 320, 520, 600, 450];
  const f2 = [1100, 2000, 1300, 2400, 900, 1700, 1500];
  const a = bp(src.slice(), sr, (t) => f1[Math.floor((t / sec) * syl) % f1.length], 5);
  const b = bp(src.slice(), sr, (t) => f2[Math.floor((t / sec) * syl) % f2.length], 6);
  const out = mk(sr, sec);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const ph = ((t / sec) * syl) % 1;
    const env = Math.sin(Math.min(1, ph * 1.4) * Math.PI) ** 0.6;
    out[i] = (a[i] + b[i] * 0.6) * env;
  }
  return fadeOut(norm(out, 0.7), sr, 0.04);
}

const GEN: Record<string, GenFn> = {
  // ---- gunshots by acoustic class
  shotPistol: (sr) => shot(sr, { dur: 0.42, crack: 0.9, f0: 3000, f1: 420, body: 0.045, sub: 0.6, subF: 135, tail: 0.18, drive: 2.2 }),
  shotMagnum: (sr) => shot(sr, { dur: 0.7, crack: 1.1, f0: 3200, f1: 300, body: 0.07, sub: 1.1, subF: 105, tail: 0.3, drive: 2.8 }),
  shotSmg: (sr) => shot(sr, { dur: 0.3, crack: 0.8, f0: 3600, f1: 500, body: 0.035, sub: 0.45, subF: 150, tail: 0.12, drive: 2.0 }),
  shotRifle: (sr) => shot(sr, { dur: 0.6, crack: 1.3, f0: 4200, f1: 330, body: 0.06, sub: 0.85, subF: 110, tail: 0.28, drive: 2.6 }),
  shotBattle: (sr) => shot(sr, { dur: 0.8, crack: 1.3, f0: 3600, f1: 260, body: 0.075, sub: 1.1, subF: 92, tail: 0.36, drive: 2.9 }),
  shotSniper: (sr) => shot(sr, { dur: 1.3, crack: 1.5, f0: 3800, f1: 220, body: 0.09, sub: 1.3, subF: 78, tail: 0.5, drive: 3.0 }),
  shotAmr: (sr) => shot(sr, { dur: 1.7, crack: 1.6, f0: 3000, f1: 160, body: 0.13, sub: 1.8, subF: 60, tail: 0.65, drive: 3.4 }),
  shotShotgun: (sr) => shot(sr, { dur: 0.85, crack: 0.9, f0: 2400, f1: 210, body: 0.1, sub: 1.25, subF: 84, tail: 0.38, drive: 3.0 }),
  shotLmg: (sr) => shot(sr, { dur: 0.5, crack: 1.2, f0: 3400, f1: 290, body: 0.06, sub: 1.0, subF: 98, tail: 0.25, drive: 2.8 }),
  shotMini: (sr) => shot(sr, { dur: 0.16, crack: 1.1, f0: 3600, f1: 380, body: 0.03, sub: 0.7, subF: 110, tail: 0, drive: 2.5 }),
  shotSup: (sr) => {
    const out = mk(sr, 0.22);
    mix(out, decay(lp(noise(sr, 0.2), sr, (t) => 500 + 2600 * Math.exp(-t / 0.012)), sr, 0.028), 1.2);
    mix(out, decay(tone(sr, 0.1, 150, 70, 0.05), sr, 0.03), 0.4);
    mix(out, clicks(sr, 0.1, [0.004, 0.03], 2800, 0.006), 0.35);
    return fadeOut(norm(out, 0.55), sr, 0.02);
  },
  shotLauncher: (sr) => {
    const out = mk(sr, 1.2);
    mix(out, decay(bp(noise(sr, 1.2), sr, (t) => 300 + 2400 * Math.min(1, t / 0.5), 1.4), sr, 0.45, 0.02), 1.2);
    mix(out, decay(tone(sr, 0.4, 150, 45, 0.15), sr, 0.12), 1.4);
    mix(out, decay(lp(noise(sr, 0.5), sr, 700), sr, 0.14), 1.0);
    return fadeOut(norm(sat(out, 2), 0.9), sr, 0.1);
  },
  shotThump: (sr) => {
    const out = mk(sr, 0.5);
    mix(out, decay(tone(sr, 0.4, 210, 60, 0.12), sr, 0.11), 1.4);
    mix(out, decay(lp(noise(sr, 0.3), sr, 1300), sr, 0.04), 0.8);
    return fadeOut(norm(sat(out, 1.8), 0.85), sr, 0.03);
  },
  shotBow: (sr) => {
    const out = mk(sr, 0.4);
    mix(out, decay(tone(sr, 0.4, 240, 205), sr, 0.07), 0.9);
    mix(out, decay(tone(sr, 0.4, 487, 470), sr, 0.04), 0.4);
    mix(out, decay(bp(noise(sr, 0.2), sr, (t) => 3000 - 6000 * t, 2), sr, 0.05), 0.6);
    return norm(out, 0.6);
  },
  shotTaser: (sr) => {
    const out = mk(sr, 0.5);
    for (let i = 0; i < out.length; i++) out[i] = (Math.random() * 2 - 1) * (Math.sin((i / sr) * TAU * 55) > 0.4 ? 1 : 0.05);
    return fadeOut(norm(hp(out, sr, 1800), 0.5), sr, 0.05);
  },
  flame: (sr) => {
    const n = lp(noise(sr, 2.4), sr, 900);
    const m = lp(noise(sr, 2.4), sr, 7);
    for (let i = 0; i < n.length; i++) n[i] *= 0.6 + m[i] * 9;
    return loopable(norm(mix(n, hp(noise(sr, 2.4), sr, 3500), 0.07), 0.7), sr, 0.4);
  },
  // ---- weapon handling
  magOut: (sr) => clicks(sr, 0.3, [0.01, 0.1], 1700, 0.012),
  magIn: (sr) => clicks(sr, 0.3, [0.02, 0.09, 0.11], 1250, 0.016),
  bolt: (sr) => clicks(sr, 0.5, [0.01, 0.13, 0.27, 0.38], 2100, 0.012),
  pump: (sr) => {
    const out = mk(sr, 0.5);
    mix(out, decay(bp(noise(sr, 0.14), sr, 1300, 2), sr, 0.045, 0.01), 1);
    mix(out, decay(bp(noise(sr, 0.14), sr, 1700, 2), sr, 0.04, 0.01), 1, Math.floor(sr * 0.2));
    mix(out, clicks(sr, 0.5, [0.1, 0.31], 2600, 0.008), 0.7);
    return norm(out, 0.8);
  },
  shellIn: (sr) => clicks(sr, 0.2, [0.01, 0.06], 1500, 0.014),
  dry: (sr) => clicks(sr, 0.12, [0.005], 3200, 0.006),
  click: (sr) => clicks(sr, 0.1, [0.004], 2400, 0.007),
  draw: (sr) => {
    const out = mk(sr, 0.36);
    mix(out, decay(bp(noise(sr, 0.3), sr, (t) => 900 + 4000 * t, 0.9), sr, 0.1, 0.05), 0.5);
    mix(out, clicks(sr, 0.36, [0.24], 2000, 0.01), 0.6);
    return norm(out, 0.45);
  },
  swish: (sr) => norm(decay(bp(noise(sr, 0.3), sr, (t) => 700 + 5200 * Math.sin(Math.min(1, t / 0.2) * Math.PI), 1.2), sr, 0.09, 0.05), 0.6),
  casing: (sr) => {
    const out = mk(sr, 0.5);
    for (const [t, g] of [[0, 1], [0.13, 0.5], [0.21, 0.25]] as const) {
      mix(out, decay(tone(sr, 0.15, 3300 + Math.random() * 500), sr, 0.028), 0.5 * g, Math.floor(t * sr));
      mix(out, decay(tone(sr, 0.15, 5100 + Math.random() * 700), sr, 0.02), 0.3 * g, Math.floor(t * sr));
    }
    return norm(out, 0.35);
  },
  // ---- impacts
  hitConcrete: (sr) => {
    const out = mk(sr, 0.35);
    mix(out, decay(hp(noise(sr, 0.2), sr, 900), sr, 0.02), 1);
    mix(out, decay(lp(noise(sr, 0.35), sr, 1800), sr, 0.09, 0.01), 0.35);
    return norm(out, 0.7);
  },
  hitMetal: (sr) => {
    const out = mk(sr, 0.5);
    for (const f of [1750, 2890, 4130, 6200]) mix(out, decay(tone(sr, 0.5, f * (0.94 + Math.random() * 0.12)), sr, 0.07 + Math.random() * 0.06), 0.3);
    mix(out, decay(hp(noise(sr, 0.05), sr, 2500), sr, 0.006), 0.9);
    return norm(out, 0.7);
  },
  ricochet: (sr) => {
    const out = mk(sr, 0.55);
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = 2600 * Math.pow(0.42, t / 0.5) * (1 + Math.sin(t * 90) * 0.035);
      ph += f / sr;
      out[i] = Math.sin(ph * TAU) * Math.exp(-t / 0.2);
    }
    mix(out, decay(hp(noise(sr, 0.04), sr, 3000), sr, 0.005), 0.7);
    return norm(out, 0.5);
  },
  hitWood: (sr) => {
    const out = mk(sr, 0.25);
    mix(out, decay(tone(sr, 0.2, 320, 160), sr, 0.03), 1);
    mix(out, decay(lp(noise(sr, 0.2), sr, 2200), sr, 0.02), 0.8);
    return norm(out, 0.7);
  },
  hitDirt: (sr) => norm(decay(lp(noise(sr, 0.3), sr, 700), sr, 0.05, 0.003), 0.6),
  hitFlesh: (sr) => {
    const out = mk(sr, 0.22);
    mix(out, decay(lp(noise(sr, 0.2), sr, 850), sr, 0.035), 1);
    mix(out, decay(tone(sr, 0.15, 120, 70), sr, 0.035), 0.9);
    return norm(out, 0.75);
  },
  whiz: (sr) => norm(decay(bp(noise(sr, 0.3), sr, (t) => 2200 - 4200 * t, 3), sr, 0.07, 0.03), 0.6),
  crack: (sr) => norm(decay(hp(noise(sr, 0.06), sr, 3500), sr, 0.004), 0.8),
  explosion: (sr) => {
    const out = mk(sr, 2.6);
    mix(out, decay(tone(sr, 1.2, 72, 26, 0.5), sr, 0.42), 1.9);
    mix(out, decay(lp(noise(sr, 2.6), sr, (t) => 160 + 5200 * Math.exp(-t / 0.11)), sr, 0.42), 2.0);
    mix(out, decay(lp(noise(sr, 2.6), sr, 420), sr, 0.9, 0.05), 0.7);
    for (let i = 0; i < 26; i++) mix(out, decay(hp(noise(sr, 0.03), sr, 1500 + Math.random() * 2500), sr, 0.006), 0.22 * Math.random(), Math.floor((0.15 + Math.random() * 1.3) * sr));
    return fadeOut(norm(sat(out, 2.6), 0.97), sr, 0.4);
  },
  grenadeBounce: (sr) => {
    const out = mk(sr, 0.2);
    mix(out, decay(tone(sr, 0.2, 1150, 1050), sr, 0.03), 0.6);
    mix(out, decay(lp(noise(sr, 0.1), sr, 2400), sr, 0.012), 0.8);
    return norm(out, 0.5);
  },
  pin: (sr) => {
    const out = clicks(sr, 0.4, [0.01, 0.07], 3400, 0.008);
    mix(out, decay(tone(sr, 0.3, 4300), sr, 0.07), 0.25, Math.floor(sr * 0.07));
    return norm(out, 0.5);
  },
  flashbang: (sr) => {
    const out = mk(sr, 1.2);
    mix(out, decay(hp(noise(sr, 0.4), sr, 1200), sr, 0.06), 2);
    mix(out, decay(tone(sr, 0.3, 190, 70, 0.1), sr, 0.08), 1);
    return fadeOut(norm(sat(out, 3), 0.95), sr, 0.2);
  },
  tinnitus: (sr) => {
    const out = tone(sr, 3.2, 5900);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] *= Math.min(1, t / 0.05) * Math.exp(-t / 0.95) * 0.35;
    }
    return out;
  },
  // ---- body & movement
  stepHard: (sr) => step(sr, 'hard'),
  stepMetal: (sr) => step(sr, 'metal'),
  stepWood: (sr) => step(sr, 'wood'),
  stepSoft: (sr) => step(sr, 'soft'),
  stepSnow: (sr) => step(sr, 'snow'),
  jump: (sr) => norm(decay(bp(noise(sr, 0.2), sr, 900, 0.8), sr, 0.05, 0.02), 0.3),
  land: (sr) => {
    const out = mk(sr, 0.3);
    mix(out, decay(tone(sr, 0.2, 110, 55), sr, 0.05), 1);
    mix(out, decay(lp(noise(sr, 0.25), sr, 900), sr, 0.05), 0.8);
    return norm(out, 0.7);
  },
  hurt: (sr) => {
    const out = mk(sr, 0.3);
    mix(out, decay(tone(sr, 0.2, 95, 50), sr, 0.06), 1.2);
    mix(out, decay(lp(noise(sr, 0.2), sr, 1400), sr, 0.03), 0.9);
    return norm(sat(out, 2), 0.8);
  },
  hurtBlast: (sr) => norm(sat(mix(decay(tone(sr, 0.5, 70, 35), sr, 0.15), decay(lp(noise(sr, 0.5), sr, 600), sr, 0.12), 1), 2), 0.85),
  bodyfall: (sr) => {
    const out = mk(sr, 0.5);
    mix(out, decay(tone(sr, 0.3, 90, 48), sr, 0.07), 1);
    mix(out, decay(lp(noise(sr, 0.4), sr, 700), sr, 0.09), 0.9);
    mix(out, decay(bp(noise(sr, 0.2), sr, 2200, 1), sr, 0.04), 0.2, Math.floor(sr * 0.12));
    return norm(out, 0.6);
  },
  grunt: (sr) => {
    const src = tone(sr, 0.3, 150 + Math.random() * 40, 95, 0.25, 'saw');
    const out = bp(src, sr, (t) => 700 - 900 * t, 4);
    mix(out, lp(noise(sr, 0.3), sr, 900), 0.15);
    return fadeOut(norm(decay(out, sr, 0.11, 0.015), 0.55), sr, 0.03);
  },
  shout1: (sr) => garble(sr, 0.55, 165),
  shout2: (sr) => garble(sr, 0.75, 140),
  shout3: (sr) => garble(sr, 0.45, 190),
  medkit: (sr) => {
    const out = mk(sr, 1.5);
    mix(out, decay(bp(noise(sr, 0.4), sr, (t) => 1200 + 7000 * t, 1.5), sr, 0.2, 0.05), 0.6);
    mix(out, clicks(sr, 1.2, [0.45, 0.55, 0.9], 1900, 0.012), 0.6);
    mix(out, decay(bp(noise(sr, 0.5), sr, 2600, 0.7), sr, 0.12, 0.06), 0.3, Math.floor(sr * 0.95));
    return norm(out, 0.5);
  },
  pickup: (sr) => {
    const out = mk(sr, 0.25);
    mix(out, decay(tone(sr, 0.1, 880), sr, 0.03), 0.6);
    mix(out, decay(tone(sr, 0.15, 1320), sr, 0.045), 0.6, Math.floor(sr * 0.06));
    return norm(out, 0.4);
  },
  ammo: (sr) => clicks(sr, 0.3, [0.01, 0.06, 0.13], 1500, 0.014),
  heartbeat: (sr) => {
    const out = mk(sr, 0.8);
    mix(out, decay(tone(sr, 0.2, 62, 42), sr, 0.06), 1);
    mix(out, decay(tone(sr, 0.2, 56, 38), sr, 0.07), 0.75, Math.floor(sr * 0.26));
    return norm(out, 0.9);
  },
  // ---- interface
  hitmark: (sr) => norm(decay(tone(sr, 0.05, 2700, 2200), sr, 0.011), 0.4),
  killmark: (sr) => {
    const out = mk(sr, 0.22);
    mix(out, decay(tone(sr, 0.18, 880, 470, 0.1), sr, 0.045), 1);
    mix(out, decay(hp(noise(sr, 0.03), sr, 3000), sr, 0.005), 0.7);
    return norm(out, 0.55);
  },
  uiHover: (sr) => norm(decay(tone(sr, 0.05, 2300), sr, 0.008), 0.18),
  uiClick: (sr) => {
    const out = mk(sr, 0.12);
    mix(out, decay(tone(sr, 0.1, 740, 520), sr, 0.02), 1);
    mix(out, decay(hp(noise(sr, 0.03), sr, 4000), sr, 0.004), 0.5);
    return norm(out, 0.4);
  },
  uiBack: (sr) => norm(decay(tone(sr, 0.14, 520, 300, 0.1), sr, 0.035), 0.35),
  uiConfirm: (sr) => {
    const out = mk(sr, 0.4);
    mix(out, decay(tone(sr, 0.2, 587), sr, 0.07), 0.7);
    mix(out, decay(tone(sr, 0.3, 880), sr, 0.11), 0.7, Math.floor(sr * 0.08));
    mix(out, decay(tone(sr, 0.3, 1760), sr, 0.08), 0.15, Math.floor(sr * 0.08));
    return norm(out, 0.4);
  },
  uiDeny: (sr) => norm(decay(tone(sr, 0.2, 150, 140, 0.2, 'sq'), sr, 0.07), 0.25),
  uiOpen: (sr) => norm(decay(bp(noise(sr, 0.4), sr, (t) => 400 + 3000 * t, 1), sr, 0.12, 0.08), 0.3),
  objective: (sr) => {
    const out = mk(sr, 1.2);
    [392, 523.25, 659.25].forEach((f, i) => {
      mix(out, decay(tone(sr, 0.9, f), sr, 0.3), 0.5, Math.floor(sr * i * 0.11));
      mix(out, decay(tone(sr, 0.9, f * 2), sr, 0.2), 0.12, Math.floor(sr * i * 0.11));
    });
    return norm(out, 0.45);
  },
  checkpoint: (sr) => {
    const out = mk(sr, 0.9);
    mix(out, decay(tone(sr, 0.8, 659.25), sr, 0.25), 0.5);
    mix(out, decay(tone(sr, 0.8, 987.77), sr, 0.3), 0.5, Math.floor(sr * 0.12));
    return norm(out, 0.35);
  },
  fail: (sr) => {
    const out = mk(sr, 1.6);
    [220, 207.65, 174.61].forEach((f, i) => mix(out, decay(tone(sr, 1.2, f, f, 1, 'tri'), sr, 0.4), 0.6, Math.floor(sr * i * 0.22)));
    return norm(lp(out, sr, 1800), 0.5);
  },
  radio: (sr) => {
    const out = mk(sr, 0.3);
    mix(out, decay(bp(noise(sr, 0.2), sr, 2400, 1), sr, 0.06, 0.005), 0.5);
    mix(out, decay(tone(sr, 0.09, 1250), sr, 0.03), 0.6, Math.floor(sr * 0.1));
    return norm(out, 0.32);
  },
  beep: (sr) => norm(decay(tone(sr, 0.1, 1900), sr, 0.03), 0.3),
  plant: (sr) => {
    const out = mk(sr, 0.5);
    mix(out, clicks(sr, 0.3, [0.02, 0.1], 1500, 0.014), 0.8);
    mix(out, decay(tone(sr, 0.08, 2400), sr, 0.03), 0.5, Math.floor(sr * 0.25));
    mix(out, decay(tone(sr, 0.08, 2400), sr, 0.03), 0.5, Math.floor(sr * 0.36));
    return norm(out, 0.45);
  },
  alarm: (sr) => {
    const out = mk(sr, 1.6);
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = 620 + 260 * (t % 0.8 < 0.4 ? 0 : 1);
      ph += f / sr;
      out[i] = (Math.sin(ph * TAU) + Math.sin(ph * TAU * 2) * 0.3) * 0.5;
    }
    return lp(out, sr, 2500);
  },
  // ---- ambience loops
  ambWind: (sr) => {
    const n = bp(noise(sr, 8), sr, 420, 0.7);
    const m = lp(noise(sr, 8), sr, 0.35);
    for (let i = 0; i < n.length; i++) n[i] *= 0.45 + clamp(m[i] * 60, -0.35, 0.6);
    return loopable(norm(n, 0.5), sr, 1.2);
  },
  ambGale: (sr) => {
    const m = lp(noise(sr, 8), sr, 0.5);
    const n = bp(noise(sr, 8), sr, (t) => 650 + clamp(m[Math.min(m.length - 1, Math.floor(t * sr))] * 9000, -300, 700), 2.2);
    mix(n, lp(noise(sr, 8), sr, 240), 1.6);
    return loopable(norm(n, 0.6), sr, 1.2);
  },
  ambRain: (sr) => {
    const n = hp(noise(sr, 5), sr, 1800);
    mix(n, lp(noise(sr, 5), sr, 500), 0.9);
    for (let i = 0; i < 260; i++) mix(n, decay(tone(sr, 0.03, 1800 + Math.random() * 3000), sr, 0.006), 0.5, Math.floor(Math.random() * (n.length - sr * 0.05)));
    return loopable(norm(n, 0.45), sr, 0.8);
  },
  ambNight: (sr) => {
    const out = mk(sr, 6);
    for (let k = 0; k < 9; k++) {
      const f = 3900 + Math.random() * 1500;
      const start = Math.random() * 5;
      const rate = 14 + Math.random() * 10;
      for (let i = Math.floor(start * sr); i < Math.min(out.length, Math.floor((start + 0.7 + Math.random() * 0.6) * sr)); i++) {
        const t = i / sr;
        out[i] += Math.sin(t * TAU * f) * (Math.sin(t * TAU * rate) > 0.2 ? 1 : 0) * 0.1;
      }
    }
    mix(out, lp(noise(sr, 6), sr, 300), 0.5);
    return loopable(norm(out, 0.3), sr, 0.8);
  },
  ambWaves: (sr) => {
    const n = lp(noise(sr, 9), sr, 900);
    for (let i = 0; i < n.length; i++) {
      const t = i / sr;
      n[i] *= 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin((t / 4.5) * TAU - 1.2), 2);
    }
    return loopable(norm(n, 0.45), sr, 1.0);
  },
  ambHum: (sr) => {
    const out = mk(sr, 4);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] = Math.sin(t * TAU * 50) * 0.5 + Math.sin(t * TAU * 100) * 0.25 + Math.sin(t * TAU * 150.5) * 0.1 + Math.sin(t * TAU * 301) * 0.03;
    }
    mix(out, lp(noise(sr, 4), sr, 1400), 0.5);
    return loopable(norm(out, 0.35), sr, 0.5);
  },
  ambDust: (sr) => {
    const n = bp(noise(sr, 7), sr, 1500, 0.6);
    const m = lp(noise(sr, 7), sr, 0.4);
    for (let i = 0; i < n.length; i++) n[i] *= 0.4 + clamp(m[i] * 50, -0.3, 0.6);
    mix(n, lp(noise(sr, 7), sr, 200), 1.2);
    return loopable(norm(n, 0.4), sr, 1);
  },
  rotor: (sr) => {
    const n = lp(noise(sr, 2), sr, 700);
    for (let i = 0; i < n.length; i++) {
      const t = i / sr;
      n[i] = n[i] * (0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(t * TAU * 11), 3)) + Math.sin(t * TAU * 44) * 0.12;
    }
    return loopable(norm(n, 0.7), sr, 0.2);
  },
  fire: (sr) => {
    const n = lp(noise(sr, 4), sr, 600);
    for (let i = 0; i < 160; i++) mix(n, decay(hp(noise(sr, 0.02), sr, 2000), sr, 0.004), 0.6 * Math.random(), Math.floor(Math.random() * (n.length - sr * 0.05)));
    return loopable(norm(n, 0.5), sr, 0.5);
  },
  // ---- percussion for the score
  mKick: (sr) => norm(sat(decay(tone(sr, 0.5, 130, 38, 0.09), sr, 0.16), 2), 0.95),
  mSnare: (sr) => {
    const out = mk(sr, 0.4);
    mix(out, decay(bp(noise(sr, 0.4), sr, 1700, 0.8), sr, 0.09), 1);
    mix(out, decay(tone(sr, 0.2, 190, 140), sr, 0.05), 0.6);
    return norm(out, 0.8);
  },
  mHat: (sr) => norm(decay(hp(noise(sr, 0.1), sr, 7000), sr, 0.018), 0.5),
  mTom: (sr) => norm(decay(tone(sr, 0.7, 95, 60, 0.3), sr, 0.25), 0.9),
  mHit: (sr) => {
    const out = mk(sr, 3);
    mix(out, decay(tone(sr, 3, 49, 36, 2), sr, 1.1), 1);
    mix(out, decay(lp(noise(sr, 3), sr, 500), sr, 0.8), 0.7);
    return norm(sat(out, 1.6), 0.9);
  },
};

const STEP_BY_SURFACE: Record<Surface, string> = {
  concrete: 'stepHard', metal: 'stepMetal', wood: 'stepWood', dirt: 'stepSoft', sand: 'stepSoft', snow: 'stepSnow',
  grass: 'stepSoft', water: 'stepSoft', flesh: 'stepSoft', glass: 'stepHard', fabric: 'stepSoft',
};
const HIT_BY_SURFACE: Record<Surface, string> = {
  concrete: 'hitConcrete', metal: 'hitMetal', wood: 'hitWood', dirt: 'hitDirt', sand: 'hitDirt', snow: 'hitDirt',
  grass: 'hitDirt', water: 'hitDirt', flesh: 'hitFlesh', glass: 'hitConcrete', fabric: 'hitDirt',
};

export interface PlayOpts {
  vol?: number;
  rate?: number;
  /** World position: makes the sound positional. */
  x?: number;
  y?: number;
  z?: number;
  /** Reference distance in metres (louder sounds carry further). */
  ref?: number;
  /** 0..1 send to the environment reverb. */
  reverb?: number;
  delay?: number;
  bus?: 'sfx' | 'ui';
}

interface Loop {
  src: AudioBufferSourceNode;
  gain: GainNode;
  name: string;
}

class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ui!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private muffle!: BiquadFilterNode;
  private verb!: ConvolverNode;
  private verbGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loops: Loop[] = [];
  private voices = 0;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private verbKind = '';
  private verbSend = 0.25;
  private muffleT = 0;
  private wantAmb: string[] = [];
  private lastPlay = new Map<string, number>();
  // score
  private musicOn = false;
  private musicMode: 'menu' | 'game' = 'menu';
  private intensity = 0;
  private intensityTarget = 0;
  private nextNote = 0;
  private step16 = 0;
  private root = 38;
  private pad: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private padFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private drumGain: GainNode | null = null;
  private pulseGain: GainNode | null = null;
  private chord = 0;
  private battleTimer = 6;
  private battle = false;

  /** Must be called from a user gesture at least once. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master.connect(comp).connect(c.destination);
      this.muffle = c.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.muffle.connect(this.master);
      this.sfx = c.createGain();
      this.sfx.connect(this.muffle);
      this.ambBus = c.createGain();
      this.ambBus.connect(this.muffle);
      this.ui = c.createGain();
      this.ui.connect(this.master);
      this.musicBus = c.createGain();
      this.musicBus.connect(this.master);
      this.verb = c.createConvolver();
      this.verbGain = c.createGain();
      this.verbGain.gain.value = 0.9;
      this.verb.connect(this.verbGain).connect(this.muffle);
      this.setReverb('open');
      this.applyVolumes();
      if (this.wantAmb.length) this.setAmbience(this.wantAmb, this.battle);
      if (this.musicOn) this.buildScore();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = store.settings;
    this.master.gain.value = s.master;
    this.sfx.gain.value = s.sfx;
    this.ambBus.gain.value = s.sfx * 0.8;
    this.ui.gain.value = s.sfx * 0.9;
    this.musicBus.gain.value = s.music * 0.9;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private buffer(name: string): AudioBuffer | null {
    if (!this.ctx) return null;
    let b = this.buffers.get(name);
    if (!b) {
      const gen = GEN[name];
      if (!gen) return null;
      const data = gen(this.ctx.sampleRate);
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.getChannelData(0).set(data);
      this.buffers.set(name, b);
    }
    return b;
  }

  /** Pre-renders sounds during loading so the first gunshot never hitches. */
  warm(names: string[]): void {
    for (const n of names) this.buffer(n);
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    const c = this.ctx;
    if (!c) return;
    const l = c.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  play(name: string, o: PlayOpts = {}): void {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.voices > 40) return;
    const buf = this.buffer(name);
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const gain = c.createGain();
    let vol = o.vol ?? 1;
    let node: AudioNode = src;
    const positional = o.x !== undefined;
    let dist = 0;
    if (positional) {
      dist = Math.hypot((o.x as number) - this.lx, (o.y ?? this.ly) - this.ly, (o.z as number) - this.lz);
      const ref = o.ref ?? 4;
      // Inverse-distance rolloff computed here (cheaper and more controllable than the panner's own).
      vol *= ref / Math.max(ref, dist);
      if (vol < 0.004) return;
      if (dist > 18) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lerp(15000, 900, clamp((dist - 18) / 140, 0, 1));
        node.connect(f);
        node = f;
      }
      const pan = c.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'linear';
      pan.rolloffFactor = 0;
      pan.positionX.value = o.x as number;
      pan.positionY.value = o.y ?? this.ly;
      pan.positionZ.value = o.z as number;
      node.connect(pan);
      node = pan;
    }
    gain.gain.value = vol;
    node.connect(gain);
    gain.connect(o.bus === 'ui' ? this.ui : this.sfx);
    const send = o.reverb ?? (positional ? this.verbSend : 0);
    if (send > 0) {
      const sg = c.createGain();
      sg.gain.value = vol * send * (positional ? 1 + Math.min(2, dist / 30) : 1);
      node.connect(sg).connect(this.verb);
    }
    this.voices++;
    src.onended = () => {
      this.voices--;
      gain.disconnect();
    };
    // Sound takes time to travel: far shots are heard late.
    src.start(c.currentTime + (o.delay ?? 0) + (positional ? Math.min(0.6, dist / 343) : 0));
  }

  /** Rate-limited play, for sounds that could fire many times a frame (impacts, casings). */
  playLimited(name: string, minGap: number, o: PlayOpts = {}): void {
    const now = performance.now() / 1000;
    if (now - (this.lastPlay.get(name) ?? -9) < minGap) return;
    this.lastPlay.set(name, now);
    this.play(name, o);
  }

  uiPlay(name: string, vol = 1): void {
    this.play(name, { bus: 'ui', vol });
  }

  footstep(surf: Surface, vol: number, x?: number, y?: number, z?: number): void {
    this.play(STEP_BY_SURFACE[surf] ?? 'stepHard', { vol: vol * 0.55, x, y, z, ref: 2.5, rate: 0.9 + Math.random() * 0.2 });
  }

  impact(surf: Surface, x: number, y: number, z: number): void {
    this.playLimited(HIT_BY_SURFACE[surf] ?? 'hitConcrete', 0.03, { x, y, z, ref: 3, vol: 0.8 });
    if (surf === 'metal' && Math.random() < 0.25) this.play('ricochet', { x, y, z, ref: 4, vol: 0.5 });
  }

  /** Close explosions dull hearing for a few seconds. */
  deafen(amount: number): void {
    this.muffleT = Math.max(this.muffleT, amount);
    if (amount > 0.6) this.play('tinnitus', { vol: clamp(amount - 0.3, 0, 0.8) });
  }

  setReverb(kind: 'open' | 'urban' | 'indoor' | 'cave'): void {
    if (!this.ctx || kind === this.verbKind) return;
    this.verbKind = kind;
    const sr = this.ctx.sampleRate;
    const p = { open: [1.6, 0.35, 0.16], urban: [1.9, 0.5, 0.24], indoor: [1.1, 0.75, 0.34], cave: [2.8, 0.85, 0.42] }[kind];
    const len = Math.floor(sr * p[0]);
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // Early slap + diffuse tail that darkens over time.
        const early = t < 0.09 && Math.random() < 0.012 ? 1.4 : 0;
        const a = 1 - Math.exp((-TAU * lerp(7000, 700, Math.min(1, t / p[0]))) / sr);
        y += a * ((Math.random() * 2 - 1 + early) - y);
        d[i] = y * Math.exp(-t / (p[0] * 0.28)) * p[1] * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    this.verb.buffer = ir;
    this.verbSend = p[2];
  }

  setAmbience(names: string[], battle = false): void {
    this.wantAmb = names;
    this.battle = battle;
    const c = this.ctx;
    if (!c) return;
    for (const l of this.loops) {
      l.gain.gain.setTargetAtTime(0, c.currentTime, 0.4);
      l.src.stop(c.currentTime + 2);
    }
    this.loops = [];
    for (const name of names) {
      const [n, v] = name.split(':');
      const buf = this.buffer(n);
      if (!buf) continue;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(v ? parseFloat(v) : 0.5, c.currentTime, 0.8);
      src.connect(gain).connect(this.ambBus);
      src.start();
      this.loops.push({ src, gain, name: n });
    }
  }

  // ---------------------------------------------------------------- generative score

  startMusic(mode: 'menu' | 'game', rootMidi = 38): void {
    this.musicMode = mode;
    this.root = rootMidi;
    this.intensity = 0;
    this.intensityTarget = 0;
    if (this.musicOn) {
      this.retune();
      return;
    }
    this.musicOn = true;
    if (this.ctx) this.buildScore();
  }

  stopMusic(): void {
    this.musicOn = false;
    const c = this.ctx;
    if (!c || !this.padGain) return;
    this.padGain.gain.setTargetAtTime(0, c.currentTime, 0.5);
    for (const p of this.pad) p.osc.stop(c.currentTime + 3);
    this.pad = [];
    this.padGain = null;
  }

  /** 0 = exploring, 0.5 = alerted, 1 = firefight. */
  setIntensity(v: number): void {
    this.intensityTarget = clamp(v, 0, 1);
  }

  private hz(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private chordNotes(): number[] {
    // i - VI - iv - v in natural minor, voiced as root / fifth / tenth.
    const roots = [0, -4, 5, -5];
    const third = [3, 4, 3, 3];
    const r = this.root + roots[this.chord % 4];
    return [r, r + 7, r + 12 + third[this.chord % 4], r + 19];
  }

  private buildScore(): void {
    const c = this.ctx as AudioContext;
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 520;
    this.padFilter.Q.value = 0.7;
    this.padGain = c.createGain();
    this.padGain.gain.value = 0;
    this.padGain.gain.setTargetAtTime(0.16, c.currentTime, 2.5);
    this.padFilter.connect(this.padGain).connect(this.musicBus);
    const send = c.createGain();
    send.gain.value = 0.35;
    this.padGain.connect(send).connect(this.verb);
    this.drumGain = c.createGain();
    this.drumGain.gain.value = 0;
    this.drumGain.connect(this.musicBus);
    this.pulseGain = c.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(this.musicBus);
    const notes = this.chordNotes();
    this.pad = [];
    for (let i = 0; i < notes.length; i++) {
      for (const det of [-7, 6]) {
        const osc = c.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sawtooth';
        osc.frequency.value = this.hz(notes[i]);
        osc.detune.value = det;
        const g = c.createGain();
        g.gain.value = i === 0 ? 0.6 : 0.2;
        osc.connect(g).connect(this.padFilter);
        osc.start();
        this.pad.push({ osc, gain: g });
      }
    }
    this.nextNote = c.currentTime + 0.2;
    this.step16 = 0;
  }

  private retune(): void {
    const c = this.ctx;
    if (!c || !this.pad.length) return;
    const notes = this.chordNotes();
    this.pad.forEach((p, i) => p.osc.frequency.setTargetAtTime(this.hz(notes[i >> 1]), c.currentTime, 0.6));
  }

  private drum(name: string, when: number, vol: number, rate = 1): void {
    const c = this.ctx as AudioContext;
    const buf = this.buffer(name);
    if (!buf || !this.drumGain) return;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = vol;
    s.connect(g).connect(this.drumGain);
    s.start(when);
  }

  private pluck(midi: number, when: number, vol: number, dur = 0.22, type: OscillatorType = 'sawtooth'): void {
    const c = this.ctx as AudioContext;
    if (!this.pulseGain) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = this.hz(midi);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, when);
    f.frequency.exponentialRampToValueAtTime(220, when + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    o.connect(f).connect(g).connect(this.pulseGain);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  private schedule(): void {
    const c = this.ctx as AudioContext;
    const game = this.musicMode === 'game';
    const bpm = game ? 104 : 66;
    const s16 = 60 / bpm / 4;
    while (this.nextNote < c.currentTime + 0.25) {
      const t = this.nextNote;
      const i = this.step16 % 16;
      const bar = Math.floor(this.step16 / 16);
      if (i === 0 && bar % 4 === 0 && this.step16 > 0) {
        this.chord++;
        this.retune();
      }
      const I = this.intensity;
      const r = this.root + [0, -4, 5, -5][this.chord % 4];
      if (!game) {
        // Menu: slow arpeggio over the pad.
        if (i % 4 === 0) {
          const arp = [12, 19, 24, 27, 24, 19, 31, 24];
          this.pluck(r + arp[(this.step16 / 4) % 8 | 0], t, 0.05, 1.4, 'triangle');
        }
      } else {
        if (I > 0.22 && i % 2 === 0) this.pluck(r + (i === 6 || i === 14 ? 7 : 0), t, 0.05 + I * 0.07, 0.16);
        if (I > 0.55) {
          if (i === 0 || i === 6 || i === 10) this.drum('mKick', t, 0.5);
          if (i === 4 || i === 12) this.drum('mSnare', t, 0.3);
          if (i % 2 === 0) this.drum('mHat', t, 0.12 + (i % 4 === 0 ? 0.08 : 0));
          if (bar % 4 === 3 && i >= 12) this.drum('mTom', t, 0.35, 1 + (i - 12) * 0.08);
        } else if (I > 0.2 && i === 0 && bar % 2 === 0) {
          this.drum('mTom', t, 0.22, 0.8);
        }
        if (i === 0 && bar % 8 === 0 && I < 0.5) this.drum('mHit', t, 0.3);
      }
      this.nextNote += s16;
      this.step16++;
    }
  }

  /** Call once per frame. */
  update(dt: number): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    if (this.muffleT > 0 || this.muffle.frequency.value < 19000) {
      this.muffleT = Math.max(0, this.muffleT - dt * 0.35);
      this.muffle.frequency.value = lerp(20000, 350, clamp(this.muffleT, 0, 1) ** 0.6);
    }
    if (this.musicOn && this.padGain) {
      this.intensity = lerp(this.intensity, this.intensityTarget, 1 - Math.exp(-dt * (this.intensityTarget > this.intensity ? 1.8 : 0.35)));
      const I = this.intensity;
      const now = c.currentTime;
      this.padFilter?.frequency.setTargetAtTime(480 + I * 1500 + Math.sin(now * 0.13) * 140, now, 0.3);
      this.drumGain?.gain.setTargetAtTime(clamp((I - 0.15) * 1.3, 0, 1) * 0.9, now, 0.4);
      this.pulseGain?.gain.setTargetAtTime(this.musicMode === 'menu' ? 0.8 : clamp(I * 1.4, 0, 1), now, 0.4);
      this.schedule();
    }
    if (this.battle) {
      this.battleTimer -= dt;
      if (this.battleTimer <= 0) {
        this.battleTimer = 2 + Math.random() * 9;
        const a = Math.random() * TAU;
        const d = 180 + Math.random() * 260;
        const n = Math.random() < 0.15 ? 1 : 2 + Math.floor(Math.random() * 6);
        for (let i = 0; i < n; i++) {
          this.play(n === 1 ? 'explosion' : 'shotRifle', { x: this.lx + Math.cos(a) * d, y: this.ly, z: this.lz + Math.sin(a) * d, ref: n === 1 ? 60 : 22, vol: 0.9, delay: i * (0.09 + Math.random() * 0.05) });
        }
      }
    }
  }
}

export const audio = new AudioSys();
export type { AudioSys };
