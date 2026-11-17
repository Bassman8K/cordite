// Speaks the story's radio lines with Piper (https://github.com/OHF-Voice/piper1-gpl), an offline
// neural voice, and leaves one WAV per line in <folder>/speech/ for scripts/make-audio.mjs to pack.
//
//   PIPER=/path/to/piper VOICES=/folder/with/the/.onnx/files node scripts/make-speech.mjs <folder>
//
// Voices (rhasspy/piper-voices on Hugging Face), each released into the public domain by its speaker:
//   en_GB-cori-high, en_US-joe-medium, en_US-kristin-medium, en_US-norman-medium
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAST, STOCK, scriptLines, spoken } from './lib/script-lines.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = process.argv[2];
const PIPER = process.env.PIPER || 'piper';
const VOICES = process.env.VOICES;
if (!folder || !VOICES) throw new Error('usage: PIPER=/path/to/piper VOICES=/folder/with/voices node scripts/make-speech.mjs <folder>');
const out = join(folder, 'speech');
mkdirSync(out, { recursive: true });

let made = 0;
const lines = scriptLines(root);
for (const [name, texts] of Object.entries(STOCK)) texts.forEach((text, i) => lines.push({ who: 'OVERWATCH', text, key: `hq_${name}_${i}` }));
for (const l of lines) {
  const file = join(out, `${l.key}.wav`);
  if (existsSync(file) && statSync(file).size > 2000) continue;
  const cast = CAST[l.who];
  if (!cast) throw new Error(`no voice cast for ${l.who}`);
  const model = join(VOICES, `${cast.model}.onnx`);
  if (!existsSync(model)) throw new Error(`voice not found: ${model}`);
  const r = spawnSync(PIPER, ['-m', model, '-f', file, '--length-scale', String(cast.length), '--sentence-silence', String(cast.pause)], { input: `${spoken(l.text)}\n`, maxBuffer: 1 << 26 });
  if (r.status !== 0 || !existsSync(file)) throw new Error(`piper failed on "${l.text}": ${String(r.stderr).slice(-300)}`);
  made++;
}
console.log(`speech: ${lines.length} lines, ${made} newly spoken -> ${out}`);
