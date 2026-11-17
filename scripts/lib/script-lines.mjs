// The spoken script: every line a character says over the radio, read out of the campaign sources.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A line is either said on the spot, `m.radio('WHO', 'text', ...)`, or kept in a list as `line('WHO', 'text')`.
const CALL = /(?:\.radio|\bline)\(\s*'([A-Z]+)',\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`)/g;

/** Every `radio(who, text)` line in the campaign, in chapter order. */
export function scriptLines(root) {
  const dir = join(root, 'src/game/campaign');
  const lines = [];
  for (const file of readdirSync(dir).filter((f) => /^ch\d+\.ts$/.test(f)).sort()) {
    const source = readFileSync(join(dir, file), 'utf8');
    const calls = (source.match(/\.radio\(|\bline\(/g) ?? []).length;
    let found = 0;
    for (const m of source.matchAll(CALL)) {
      found++;
      const text = (m[2] ?? m[3] ?? m[4]).replace(/\\(['"\\])/g, '$1');
      lines.push({ chapter: file.replace('.ts', ''), who: m[1], text, key: lineKey(m[1], text) });
    }
    // A line built from variables cannot be voiced ahead of time; fail loudly rather than ship it silent.
    if (found !== calls) throw new Error(`${file}: ${calls} radio() or line() calls but only ${found} are plain text`);
  }
  return lines;
}

/** Same hash as `lineKey` in src/core/audio.ts: the name of the recording for one line. */
export function lineKey(who, text) {
  let h = 0x811c9dc5;
  const s = `${who}|${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `say_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** The text as it should be read aloud: codes and capitals spelled the way a person would say them. */
export function spoken(text) {
  return text
    .replace(/\bTKU-7\b/g, 'T K U seven')
    .replace(/\bLANTERN\b/g, 'Lantern')
    .replace(/:/g, ',');
}

/**
 * Lines the controller says in every mission, whenever the moment comes. Each list is alternatives;
 * the game picks one. They are spoken in OVERWATCH's voice and stored as hq_<name>~<n>.
 */
export const STOCK = {
  objective: ['Objective complete.', 'Good work. Keep moving.', 'Confirmed. On to the next.'],
  complete: ['Mission complete. Good work, Kestrel.', 'That is the job done. Mission complete.'],
  failed: ['Kestrel? Kestrel, respond. Mission failed.', 'We have lost him. Mission failed.'],
  hurry: ['You are running out of time, Kestrel.', 'Clock is against you. Move.'],
};

/**
 * Who speaks with which voice. The voices are Kokoro's (Apache 2.0); a blend mixes two of them into
 * a voice of its own. `speed` is the pace: the villain takes his time, the frightened contact does not.
 */
export const CAST = {
  OVERWATCH: { voice: 'bf_emma', lang: 'en-gb', speed: 1 },
  KESTREL: { voice: 'am_michael', lang: 'en-us', speed: 1 },
  WREN: { voice: 'af_heart', lang: 'en-us', speed: 1.08 },
  RUSK: { voice: { bm_lewis: 0.7, bm_fable: 0.3 }, lang: 'en-gb', speed: 0.88 },
};
