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

/** Low-pass applied several times, for a steeper roll-off than a single pole gives. */
function lpN(b: Buf, sr: number, fc: number, n = 2): Buf {
  for (let i = 0; i < n; i++) lp(b, sr, fc);
  return b;
}

/**
 * A narrow band of noise that dies away: the ring of something struck. Unlike a sine wave it never
 * settles on one exact pitch, which is what makes synthetic sounds read as a machine.
 */
function ring(sr: number, sec: number, f: number, q: number, tau: number, attack = 0.001): Buf {
  return decay(bp(noise(sr, sec), sr, f, q), sr, tau, attack);
}

/** Adds later, quieter, duller copies of the start of a sound: its slap off nearby surfaces. */
function slap(b: Buf, sr: number, head: number, taps: Array<[number, number, number]>): Buf {
  const first = b.slice(0, Math.min(b.length, Math.floor(sr * head)));
  for (const [delay, gain, cutoff] of taps) mix(b, lp(first.slice(), sr, cutoff), gain, Math.floor(sr * delay));
  return b;
}

/** Each generated sound differs a little from the last, so repeated shots are not copies. */
const vary = (): number => 0.9 + Math.random() * 0.2;

interface ShotP {
  dur: number;
  /** Loudness of the first crack. */
  crack: number;
  /** Where the blast's top end starts, in Hz: high is sharp (rifles), low is dull (shotguns). */
  bright: number;
  /** How long the blast takes to die away, in seconds. */
  body: number;
  /** Weight of the low thump, and the band it sits in. */
  thump: number;
  thumpF: number;
  /** Level of the long tail. */
  tail: number;
  drive: number;
}
/**
 * A gunshot is a burst of noise, not a note: a crack lasting milliseconds, a blast whose top end
 * closes in a few hundredths of a second, one or two cycles of low pressure, the slap off the
 * surroundings and a tail rolling away. Nothing in it holds a pitch.
 */
function shot(sr: number, p: ShotP): Buf {
  const out = mk(sr, p.dur);
  mix(out, decay(noise(sr, 0.02), sr, 0.0016), p.crack * 0.9);
  mix(out, decay(hp(noise(sr, 0.04), sr, 2000), sr, 0.006 * vary()), p.crack);
  const top = p.bright * vary();
  mix(out, decay(lp(hp(noise(sr, p.dur), sr, 140), sr, (t) => 420 + (top - 420) * Math.exp(-t / 0.03)), sr, p.body * vary()), 1.5);
  // Too short to be heard as a tone: roughly two cycles.
  mix(out, decay(tone(sr, 0.12, p.thumpF * vary(), p.thumpF * 0.7, 0.06), sr, 0.02 + 0.3 / p.thumpF), p.thump * 0.9);
  mix(out, decay(lpN(noise(sr, 0.4), sr, p.thumpF * 1.6, 3), sr, 0.07, 0.003), p.thump * 3.2);
  slap(out, sr, 0.05, [
    [0.038 + Math.random() * 0.02, 0.22, 3200],
    [0.09 + Math.random() * 0.04, 0.13, 1800],
    [0.17 + Math.random() * 0.06, 0.08, 1100],
  ]);
  if (p.tail > 0) mix(out, decay(lpN(noise(sr, p.dur), sr, 1000, 2), sr, p.dur * 0.3, 0.025), p.tail * 1.6);
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
  const out = mk(sr, 0.26);
  if (kind === 'hard') {
    mix(out, decay(lp(noise(sr, 0.2), sr, 1500 * vary()), sr, 0.03), 1);
    mix(out, decay(lpN(noise(sr, 0.2), sr, 210, 2), sr, 0.035, 0.002), 2.2);
    mix(out, decay(hp(noise(sr, 0.05), sr, 3000), sr, 0.01), 0.25, Math.floor(sr * 0.045));
  } else if (kind === 'metal') {
    // A grating rings at several unrelated frequencies at once.
    mix(out, ring(sr, 0.24, 520 * vary(), 9, 0.05), 0.5);
    mix(out, ring(sr, 0.24, 1270 * vary(), 12, 0.04), 0.35);
    mix(out, ring(sr, 0.2, 2150 * vary(), 14, 0.025), 0.2);
    mix(out, decay(lp(noise(sr, 0.1), sr, 2500), sr, 0.02), 0.8);
    mix(out, decay(lpN(noise(sr, 0.2), sr, 230, 2), sr, 0.03, 0.002), 1.4);
  } else if (kind === 'wood') {
    mix(out, ring(sr, 0.2, 200 * vary(), 4, 0.035), 1.1);
    mix(out, ring(sr, 0.15, 560 * vary(), 6, 0.02), 0.3);
    mix(out, decay(lp(noise(sr, 0.1), sr, 1100), sr, 0.02), 0.6);
  } else if (kind === 'snow') {
    mix(out, decay(bp(noise(sr, 0.24), sr, 2600 * vary(), 1.2), sr, 0.07, 0.02), 1);
    mix(out, decay(lp(noise(sr, 0.2), sr, 500), sr, 0.05), 0.6);
  } else {
    mix(out, decay(lp(noise(sr, 0.22), sr, 620 * vary()), sr, 0.045, 0.004), 1.2);
    mix(out, decay(bp(noise(sr, 0.2), sr, 3200, 1.5), sr, 0.03, 0.01), 0.18);
  }
  return fadeOut(norm(out, 0.7), sr, 0.02);
}

/** Mouth shapes as the first two resonances of the vocal tract, in Hz. */
const VOWELS: Array<[number, number]> = [[750, 1200], [520, 1750], [330, 2200], [520, 920], [650, 1650], [430, 1050]];

/**
 * A hoarse, breathy shout. Real voices buzz from the vocal cords; imitating that buzz with an
 * oscillator is what makes synthetic speech sound like a robot. This uses breath noise alone,
 * shaped by a moving mouth, so it reads as a person's rough shout heard through the noise of a fight.
 */
function bark(sr: number, syllables: number, len: number, shapes?: Array<[number, number]>): Buf {
  const out = mk(sr, syllables * len + 0.1);
  const pick = (): [number, number] => VOWELS[Math.floor(Math.random() * VOWELS.length)];
  for (let k = 0; k < syllables; k++) {
    const from = shapes?.[k * 2] ?? pick();
    const to = shapes?.[k * 2 + 1] ?? pick();
    const d = len * (0.85 + Math.random() * 0.3);
    const src = hp(noise(sr, d), sr, 260);
    const glide = (a: number, b: number) => (t: number) => a + (b - a) * Math.min(1, t / (d * 0.6));
    const f1 = bp(src.slice(), sr, glide(from[0] * vary(), to[0]), 6);
    const f2 = bp(src.slice(), sr, glide(from[1] * vary(), to[1]), 8);
    const f3 = bp(src.slice(), sr, 2750 * vary(), 7);
    const syl = mk(sr, d);
    for (let i = 0; i < syl.length; i++) {
      const t = i / syl.length;
      const env = Math.min(1, t / 0.1) * Math.min(1, (1 - t) / 0.4);
      syl[i] = (f1[i] + f2[i] * 0.7 + f3[i] * 0.22) * env;
    }
    const at = Math.floor(sr * (k * len + 0.01));
    // A hard consonant in front of most syllables.
    if (Math.random() < 0.75) mix(out, decay(hp(noise(sr, 0.03), sr, 2600), sr, 0.007), 0.35, Math.max(0, at - Math.floor(sr * 0.008)));
    mix(out, syl, 1, at);
  }
  return fadeOut(norm(lp(out, sr, 5200), 0.6), sr, 0.03);
}

/** Webbing, a sling and loose kit shifting as someone moves suddenly. */
function rattle(sr: number): Buf {
  const out = mk(sr, 0.45);
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const at = Math.floor(sr * (0.01 + Math.random() * 0.3));
    mix(out, ring(sr, 0.08, 1400 + Math.random() * 2600, 5, 0.008 + Math.random() * 0.01), 0.4 + Math.random() * 0.5, at);
  }
  mix(out, decay(bp(noise(sr, 0.4), sr, 900, 0.7), sr, 0.12, 0.03), 0.5);
  return fadeOut(norm(out, 0.5), sr, 0.03);
}

const GEN: Record<string, GenFn> = {
  // ---- gunshots by acoustic class
  shotPistol: (sr) => shot(sr, { dur: 0.42, crack: 0.9, bright: 3000, body: 0.045, thump: 0.6, thumpF: 135, tail: 0.18, drive: 1.5 }),
  shotMagnum: (sr) => shot(sr, { dur: 0.7, crack: 1.1, bright: 3200, body: 0.07, thump: 1.1, thumpF: 105, tail: 0.3, drive: 1.9 }),
  shotSmg: (sr) => shot(sr, { dur: 0.3, crack: 0.8, bright: 3600, body: 0.035, thump: 0.45, thumpF: 150, tail: 0.12, drive: 1.36 }),
  shotAr: (sr) => shot(sr, { dur: 0.6, crack: 1.3, bright: 4200, body: 0.06, thump: 0.85, thumpF: 110, tail: 0.28, drive: 1.77 }),
  shotBattle: (sr) => shot(sr, { dur: 0.8, crack: 1.3, bright: 3600, body: 0.075, thump: 1.1, thumpF: 92, tail: 0.36, drive: 1.97 }),
  shotSniper: (sr) => shot(sr, { dur: 1.3, crack: 1.5, bright: 3800, body: 0.09, thump: 1.3, thumpF: 78, tail: 0.5, drive: 2.04 }),
  shotAmr: (sr) => shot(sr, { dur: 1.7, crack: 1.6, bright: 3000, body: 0.13, thump: 1.8, thumpF: 60, tail: 0.65, drive: 2.31 }),
  shotShotgun: (sr) => shot(sr, { dur: 0.85, crack: 0.9, bright: 2400, body: 0.1, thump: 1.25, thumpF: 84, tail: 0.38, drive: 2.04 }),
  shotLmg: (sr) => shot(sr, { dur: 0.5, crack: 1.2, bright: 3400, body: 0.06, thump: 1.0, thumpF: 98, tail: 0.25, drive: 1.9 }),
  shotMini: (sr) => shot(sr, { dur: 0.16, crack: 1.1, bright: 3600, body: 0.03, thump: 0.7, thumpF: 110, tail: 0, drive: 1.7 }),
  shotSup: (sr) => {
    // A suppressed shot is mostly the action cycling: a muffled pop, a soft thump, gas.
    const out = mk(sr, 0.26);
    mix(out, decay(lp(noise(sr, 0.2), sr, (t) => 600 + 2200 * Math.exp(-t / 0.01)), sr, 0.022 * vary()), 1.1);
    mix(out, decay(lpN(noise(sr, 0.2), sr, 260, 2), sr, 0.035, 0.002), 1.6);
    mix(out, clicks(sr, 0.12, [0.006, 0.034, 0.05], 2600, 0.005), 0.5);
    mix(out, decay(hp(noise(sr, 0.2), sr, 4500), sr, 0.05, 0.01), 0.1);
    return fadeOut(norm(out, 0.55), sr, 0.02);
  },
  shotLauncher: (sr) => {
    const out = mk(sr, 1.3);
    mix(out, decay(bp(noise(sr, 1.3), sr, (t) => 300 + 2400 * Math.min(1, t / 0.5), 1.4), sr, 0.45, 0.02), 1.2);
    mix(out, decay(tone(sr, 0.12, 95, 60, 0.06), sr, 0.03), 1.2);
    mix(out, decay(lpN(noise(sr, 0.6), sr, 180, 3), sr, 0.16, 0.004), 5);
    mix(out, decay(lp(noise(sr, 0.5), sr, 700), sr, 0.14), 1.0);
    return fadeOut(norm(sat(out, 1.5), 0.9), sr, 0.1);
  },
  shotThump: (sr) => {
    // The hollow thunk of a grenade leaving a short, wide tube.
    const out = mk(sr, 0.5);
    mix(out, ring(sr, 0.3, 190 * vary(), 5, 0.045), 1.6);
    mix(out, decay(lpN(noise(sr, 0.3), sr, 240, 2), sr, 0.06, 0.003), 2.4);
    mix(out, decay(lp(noise(sr, 0.3), sr, 1300), sr, 0.035), 0.8);
    return fadeOut(norm(sat(out, 1.4), 0.85), sr, 0.03);
  },
  shotBow: (sr) => {
    const out = mk(sr, 0.4);
    mix(out, ring(sr, 0.4, 225 * vary(), 14, 0.06), 1.1);
    mix(out, ring(sr, 0.3, 480 * vary(), 16, 0.035), 0.5);
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
    // Being hit: the thud of the impact, then a sharp breath in.
    const out = mk(sr, 0.4);
    mix(out, decay(lpN(noise(sr, 0.2), sr, 240, 2), sr, 0.035, 0.002), 2.6);
    mix(out, decay(lp(noise(sr, 0.2), sr, 1400), sr, 0.025), 0.8);
    mix(out, decay(bp(noise(sr, 0.28), sr, (t) => 1300 + 2600 * t, 1.6), sr, 0.09, 0.05), 0.45, Math.floor(sr * 0.07));
    return norm(sat(out, 1.5), 0.8);
  },
  hurtBlast: (sr) => {
    const out = mk(sr, 0.6);
    mix(out, decay(lpN(noise(sr, 0.6), sr, 130, 3), sr, 0.16, 0.004), 6);
    mix(out, decay(lp(noise(sr, 0.5), sr, 600), sr, 0.12), 1);
    return norm(sat(out, 1.6), 0.85);
  },
  bodyfall: (sr) => {
    const out = mk(sr, 0.5);
    mix(out, decay(lpN(noise(sr, 0.4), sr, 170, 3), sr, 0.07, 0.004), 5);
    mix(out, decay(lp(noise(sr, 0.4), sr, 700), sr, 0.09), 0.9);
    mix(out, rattle(sr), 0.5, Math.floor(sr * 0.03));
    return norm(out, 0.6);
  },
  grunt: (sr) => {
    // The breath knocked out of someone.
    const out = mk(sr, 0.34);
    mix(out, bark(sr, 1, 0.17, [[700, 1150], [470, 900]]), 1);
    mix(out, decay(lpN(noise(sr, 0.2), sr, 230, 2), sr, 0.04, 0.002), 1.6);
    return fadeOut(norm(out, 0.55), sr, 0.03);
  },
  shout1: (sr) => bark(sr, 1, 0.24),
  shout2: (sr) => bark(sr, 2, 0.17),
  shout3: (sr) => bark(sr, 3, 0.14),
  rattle: (sr) => rattle(sr),
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
  mKick: (sr) => {
    // A big skinned drum: a short low note with the slap of the beater and the rumble of the shell.
    const out = mk(sr, 0.9);
    mix(out, decay(tone(sr, 0.6, 78, 58, 0.25), sr, 0.11), 1);
    mix(out, decay(lpN(noise(sr, 0.5), sr, 150, 3), sr, 0.12, 0.003), 4);
    mix(out, decay(bp(noise(sr, 0.06), sr, 1100, 1.2), sr, 0.008), 0.35);
    return norm(sat(out, 1.3), 0.9);
  },
  mSnare: (sr) => {
    const out = mk(sr, 0.4);
    mix(out, decay(bp(noise(sr, 0.4), sr, 1700, 0.8), sr, 0.09), 1);
    mix(out, decay(tone(sr, 0.2, 190, 140), sr, 0.05), 0.6);
    return norm(out, 0.8);
  },
  mHat: (sr) => norm(decay(bp(noise(sr, 0.14), sr, 4200, 1.1), sr, 0.03, 0.012), 0.4),
  // A muffled heartbeat of a drum for tension: felt more than heard.
  mPulse: (sr) => norm(mix(decay(tone(sr, 0.3, 62, 50, 0.12), sr, 0.07), decay(lpN(noise(sr, 0.3), sr, 120, 3), sr, 0.08, 0.004), 4), 0.8),
  mTom: (sr) => norm(mix(decay(tone(sr, 0.7, 95, 66, 0.3), sr, 0.16), decay(lpN(noise(sr, 0.5), sr, 190, 3), sr, 0.1, 0.003), 3.5), 0.9),
  mHit: (sr) => {
    const out = mk(sr, 3);
    mix(out, decay(tone(sr, 3, 49, 36, 2), sr, 1.1), 1);
    mix(out, decay(lp(noise(sr, 3), sr, 500), sr, 0.8), 0.7);
    return norm(sat(out, 1.6), 0.9);
  },
};

/** Sounds that get several randomly chosen takes. */
const TAKES = /^(shot(?!Taser)|step|hit|shout|grunt|hurt$|casing|rattle)/;

// Sounds that exist as recordings and have no generator of their own. Until the recording has loaded
// (or in a build that carries none) the nearest generated sound stands in.
const STAND_IN: Record<string, string> = {
  shot22: 'shotSmg', shot45: 'shotPistol', shotPdw: 'shotSmg', shotAk: 'shotAr', shotGarand: 'shotBattle', shotBolt: 'shotBattle',
  shotHmg: 'shotAmr', shotLmgLight: 'shotLmg', shotSupHeavy: 'shotSup', boltAction: 'bolt', boltHeavy: 'bolt', ping: 'casing', radioEnd: 'radio',
};
for (const [name, like] of Object.entries(STAND_IN)) GEN[name] = GEN[like];

/** The name of the recording of one spoken line. scripts/lib/script-lines.mjs hashes the same way. */
export function lineKey(who: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${who}|${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `say_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** `shotAr~3` is take 3 of the sound `shotAr`. */
const soundOf = (name: string): string => {
  const cut = name.lastIndexOf('~');
  return cut > 0 ? name.slice(0, cut) : name;
};
/**
 * Recordings too long or too many to keep in memory all the time: the story's dialogue, weather loops
 * and the gunfire of weapons nobody is holding. They are fetched when first wanted.
 */
const onDemand = (sound: string): boolean => /^(say_|amb|shot|rotor)/.test(sound);
/** How much near-silence a decoded file starts with (compressed formats pad the front). */
function leadIn(b: AudioBuffer): number {
  const d = b.getChannelData(0);
  const max = Math.min(d.length, Math.floor(b.sampleRate * 0.08));
  let i = 0;
  while (i < max && Math.abs(d[i]) < 0.004) i++;
  return i >= max ? 0 : Math.max(0, i / b.sampleRate - 0.002);
}
/** A loop with its end blended into its beginning, so it repeats without a click or a gap. */
function seamless(c: AudioContext, b: AudioBuffer): AudioBuffer {
  const sr = b.sampleRate;
  const d = b.getChannelData(0);
  let a = 0;
  let z = d.length - 1;
  while (a < z && Math.abs(d[a]) < 1e-3) a++;
  while (z > a && Math.abs(d[z]) < 1e-3) z--;
  const n = Math.min(Math.floor(sr * 0.25), Math.floor((z - a) / 4));
  const len = z - a - n;
  if (len < sr) return b;
  const out = c.createBuffer(1, len, sr);
  const o = out.getChannelData(0);
  o.set(d.subarray(a, a + len));
  for (let i = 0; i < n; i++) {
    const u = (i / n) * (Math.PI / 2);
    o[i] = d[a + i] * Math.sin(u) + d[a + len + i] * Math.cos(u);
  }
  return out;
}

/** Renders one sound outside the audio engine (tests and tools). */
export function renderSound(name: string, sampleRate = 48000): Float32Array | null {
  const gen = GEN[name];
  return gen ? gen(sampleRate) : null;
}
export const SOUND_NAMES = (): string[] => Object.keys(GEN);

const STEP_BY_SURFACE: Record<Surface, string> = {
  concrete: 'stepHard', metal: 'stepMetal', wood: 'stepWood', dirt: 'stepSoft', sand: 'stepSoft', snow: 'stepSnow',
  grass: 'stepSoft', water: 'stepSoft', flesh: 'stepSoft', glass: 'stepHard', fabric: 'stepSoft',
};
const HIT_BY_SURFACE: Record<Surface, string> = {
  concrete: 'hitConcrete', metal: 'hitMetal', wood: 'hitWood', dirt: 'hitDirt', sand: 'hitDirt', snow: 'hitDirt',
  grass: 'hitDirt', water: 'hitDirt', flesh: 'hitFlesh', glass: 'hitConcrete', fabric: 'hitDirt',
};

export interface PlayOpts {
  /** Play through a radio: band-limited, as heard over a headset. */
  radio?: boolean;
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
  /** Recorded sounds in memory, from audio/. A sound with several takes is stored as name~0, name~1... */
  private samples = new Map<string, AudioBuffer>();
  private sampleTakes = new Map<string, number>();
  private samplesAsked = false;
  /** Every recording this build carries, by sound: the takes and where each is fetched from. */
  private onFile = new Map<string, [name: string, url: string][]>();
  private listed = false;
  /** Sounds being fetched right now, and sounds asked for before the list of recordings arrived. */
  private pending = new Map<string, Promise<void>>();
  private wanted = new Set<string>();
  private leads = new WeakMap<AudioBuffer, number>();
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
  /** Narrow bands of looping noise tuned to the chord: an airy, string-like bed with no synthetic edge. */
  private air: BiquadFilterNode[] = [];
  private airSrc: AudioBufferSourceNode | null = null;
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
      void this.loadSamples();
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
    // Recordings come first; anything not recorded (or not loaded yet) is generated.
    const recorded = this.sampleTakes.get(name);
    if (recorded) {
      const hit = this.samples.get(`${name}~${Math.floor(Math.random() * recorded)}`);
      if (hit) return hit;
    }
    const single = this.samples.get(name);
    if (single) return single;
    // Recorded but not in memory yet: fetch it for next time and make do with the generated sound now.
    if (!recorded) this.prepare(name);
    const gen = GEN[name];
    if (!gen) return null;
    // Sounds heard again and again get several takes, picked at random, so bursts are not copies.
    const takes = TAKES.test(name) ? 3 : 1;
    const key = takes > 1 ? `${name}~${Math.floor(Math.random() * takes)}` : name;
    let b = this.buffers.get(key);
    if (!b) {
      const data = gen(this.ctx.sampleRate);
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.getChannelData(0).set(data);
      this.buffers.set(key, b);
    }
    return b;
  }

  /** Pre-renders sounds during loading so the first gunshot never hitches. */
  warm(names: string[]): void {
    for (const n of names) {
      this.prepare(n);
      if (!this.onFile.has(n)) this.buffer(n);
    }
  }

  /** Starts fetching the recording of a sound that is only loaded on demand. Cheap to call repeatedly. */
  prepare(name: string): void {
    if (this.samples.has(name) || this.sampleTakes.has(name)) return;
    if (this.listed) void this.loadSound(name);
    else if (onDemand(name)) this.wanted.add(name);
  }

  /** True while a recording asked for with prepare() is still on its way. */
  loading(name: string): boolean {
    return this.pending.has(name) || (this.samplesAsked && !this.listed && this.wanted.has(name));
  }

  /** Lets go of an on-demand recording that will not be needed again soon. */
  release(name: string): void {
    for (const [take] of this.onFile.get(name) ?? []) this.samples.delete(take);
    this.sampleTakes.delete(name);
  }

  /** True once a recording of this sound (or of any take of it) has loaded. */
  has(name: string): boolean {
    return this.samples.has(name) || this.sampleTakes.has(name);
  }

  /**
   * Loads the recorded audio listed in audio/manifest.json: real voices and gunshots. Every file is
   * optional. Whatever is missing or fails to decode falls back to the generated sound of that name.
   */
  private async loadSamples(base = './audio/'): Promise<void> {
    const c = this.ctx;
    if (!c || this.samplesAsked || typeof fetch !== 'function') return;
    this.samplesAsked = true;
    const first = new Set<string>();
    try {
      const manifest = (await (await fetch(`${base}manifest.json`)).json()) as Record<string, string>;
      for (const [name, file] of Object.entries(manifest)) {
        const sound = soundOf(name);
        const takes = this.onFile.get(sound) ?? [];
        takes.push([name, base + file]);
        this.onFile.set(sound, takes);
        if (!onDemand(sound)) first.add(sound);
      }
    } catch {
      /* this build carries no recordings */
    }
    this.listed = true;
    for (const n of this.wanted) first.add(n);
    this.wanted.clear();
    await Promise.all([...first].map((n) => this.loadSound(n)));
  }

  /** Fetches and decodes every take of one sound. */
  private loadSound(sound: string): Promise<void> {
    const c = this.ctx;
    const takes = this.onFile.get(sound);
    if (!c || !takes || this.samples.has(sound) || this.sampleTakes.has(sound)) return Promise.resolve();
    const running = this.pending.get(sound);
    if (running) return running;
    const loop = sound.startsWith('amb') || sound === 'rotor';
    const job = Promise.all(
      takes.map(async ([name, url]) => {
        try {
          const decoded = await c.decodeAudioData(await (await fetch(url)).arrayBuffer());
          const buf = loop ? seamless(c, decoded) : decoded;
          if (!loop) this.leads.set(buf, leadIn(buf));
          this.samples.set(name, buf);
        } catch {
          /* keep the generated version */
        }
      }),
    ).then(() => {
      this.pending.delete(sound);
      // Takes are numbered from 0; count them only if every one arrived, so a random pick never misses.
      const numbered = takes.filter(([name]) => name !== sound);
      if (numbered.length && numbered.every(([name]) => this.samples.has(name))) this.sampleTakes.set(sound, numbered.length);
      if (loop && this.wantAmb.some((a) => a.split(':')[0] === sound)) this.setAmbience(this.wantAmb, this.battle);
    });
    this.pending.set(sound, job);
    return job;
  }

  /**
   * Plays one spoken story line if its recording is in memory, and returns how long it runs in seconds
   * (0 when there is nothing to play). Everything else is turned down a little while it is said.
   */
  speak(name: string, o: PlayOpts = {}): number {
    const c = this.ctx;
    const buf = this.samples.get(name);
    if (!c || c.state !== 'running' || !buf) return 0;
    const seconds = buf.duration - (this.leads.get(buf) ?? 0);
    this.play(name, { bus: 'ui', ...o });
    const t = c.currentTime + (o.delay ?? 0);
    const level = store.settings.sfx;
    this.sfx.gain.cancelScheduledValues(t);
    this.sfx.gain.setTargetAtTime(level * 0.6, t, 0.08);
    this.sfx.gain.setTargetAtTime(level, t + seconds, 0.3);
    return seconds;
  }

  /**
   * A spoken line: one of `lines` that has a recording, picked at random. Without recordings it
   * falls back to `fallback` (a generated sound), so the cue is never lost.
   */
  say(lines: string[], o: PlayOpts = {}, fallback = ''): void {
    const ready = lines.filter((l) => this.samples.has(l) || this.sampleTakes.has(l));
    if (ready.length) this.play(ready[Math.floor(Math.random() * ready.length)], o);
    else if (fallback) this.play(fallback, o);
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
    if (o.radio) {
      // Heard over a headset: only the narrow band a radio carries.
      const low = c.createBiquadFilter();
      low.type = 'highpass';
      low.frequency.value = 430;
      const high = c.createBiquadFilter();
      high.type = 'lowpass';
      high.frequency.value = 3000;
      node.connect(low);
      low.connect(high);
      node = high;
    }
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
    src.start(c.currentTime + (o.delay ?? 0) + (positional ? Math.min(0.6, dist / 343) : 0), this.leads.get(buf) ?? 0);
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
    const keep = new Set(names.map((name) => name.split(':')[0]));
    for (const sound of this.onFile.keys()) if (sound.startsWith('amb') && !keep.has(sound)) this.release(sound);
    for (const name of names) {
      const [n, v] = name.split(':');
      // A recorded loop that is still being fetched starts when it arrives (loadSound calls back here).
      if (!this.samples.has(n) && (this.onFile.has(n) || !this.listed)) {
        this.prepare(n);
        if (this.onFile.has(n) || onDemand(n)) continue;
      }
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
    this.airSrc?.stop(c.currentTime + 3);
    this.airSrc = null;
    this.air = [];
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
    this.padGain.gain.setTargetAtTime(0.13, c.currentTime, 2.5);
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
        // Soft, rounded tones only. Sawtooth waves are what give a score its synthesiser buzz.
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = this.hz(notes[i]);
        osc.detune.value = det;
        const g = c.createGain();
        g.gain.value = i === 0 ? 0.5 : 0.24;
        osc.connect(g).connect(this.padFilter);
        osc.start();
        this.pad.push({ osc, gain: g });
      }
    }
    const hiss = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const hd = hiss.getChannelData(0);
    for (let i = 0; i < hd.length; i++) hd[i] = Math.random() * 2 - 1;
    this.airSrc = c.createBufferSource();
    this.airSrc.buffer = hiss;
    this.airSrc.loop = true;
    const airGain = c.createGain();
    airGain.gain.value = 9;
    airGain.connect(this.padGain);
    this.air = notes.map((n) => {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = this.hz(n + 12);
      f.Q.value = 26;
      (this.airSrc as AudioBufferSourceNode).connect(f).connect(airGain);
      return f;
    });
    this.airSrc.start();
    this.nextNote = c.currentTime + 0.2;
    this.step16 = 0;
  }

  private retune(): void {
    const c = this.ctx;
    if (!c || !this.pad.length) return;
    const notes = this.chordNotes();
    this.pad.forEach((p, i) => p.osc.frequency.setTargetAtTime(this.hz(notes[i >> 1]), c.currentTime, 0.6));
    this.air.forEach((f, i) => f.frequency.setTargetAtTime(this.hz(notes[i] + 12), c.currentTime, 0.6));
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
          this.pluck(r + arp[(this.step16 / 4) % 8 | 0], t, 0.045, 1.6, 'sine');
        }
      } else {
        // Tension is a muffled drum pulse, like a heartbeat, rather than a synthesiser line.
        if (I > 0.22 && i % 4 === 0) this.drum('mPulse', t, 0.3 + I * 0.3, i === 8 ? 1.12 : 1);
        if (I > 0.55) {
          if (i === 0 || i === 6 || i === 10) this.drum('mKick', t, 0.55);
          if (i === 4 || i === 12) this.drum('mSnare', t, 0.26);
          if (I > 0.8 && i % 4 === 2) this.drum('mHat', t, 0.1);
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
        // Recorded far-off gunfire is already distant: place it near enough that it is not filtered twice.
        if (n > 1 && this.has('distant')) this.play('distant', { x: this.lx + Math.cos(a) * 55, y: this.ly, z: this.lz + Math.sin(a) * 55, ref: 40, vol: 0.55 });
        else for (let i = 0; i < n; i++) {
          this.play(n === 1 ? 'explosion' : 'shotAr', { x: this.lx + Math.cos(a) * d, y: this.ly, z: this.lz + Math.sin(a) * d, ref: n === 1 ? 60 : 22, vol: 0.9, delay: i * (0.09 + Math.random() * 0.05) });
        }
      }
    }
  }
}

export const audio = new AudioSys();
export type { AudioSys };
