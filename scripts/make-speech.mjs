// Speaks the story's lines with Kokoro, an offline neural voice (model Apache 2.0, see speak.py),
// and leaves one WAV per line in <folder>/speech/ for scripts/make-audio.mjs to pack.
//
//   PYTHON=/path/to/python KOKORO=/folder/with/the/model node scripts/make-speech.mjs <folder>
//
// PYTHON is an interpreter with `kokoro-onnx` and `soundfile` installed. KOKORO holds
// kokoro-v1.0.onnx and voices-v1.0.bin from https://github.com/thewh1teagle/kokoro-onnx/releases.
// Lines already spoken are kept: delete <folder>/speech to speak everything again.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAST, STOCK, scriptLines, spoken } from './lib/script-lines.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const folder = process.argv[2];
const PYTHON = process.env.PYTHON || 'python3';
const KOKORO = process.env.KOKORO;
if (!folder || !KOKORO) throw new Error('usage: PYTHON=/path/to/python KOKORO=/folder/with/the/model node scripts/make-speech.mjs <folder>');
const out = join(folder, 'speech');
mkdirSync(out, { recursive: true });

const lines = scriptLines(root);
for (const [name, texts] of Object.entries(STOCK)) texts.forEach((text, i) => lines.push({ who: 'OVERWATCH', text, key: `hq_${name}_${i}` }));
const jobs = lines.map((l) => {
  const cast = CAST[l.who];
  if (!cast) throw new Error(`no voice cast for ${l.who}`);
  return { key: l.key, text: spoken(l.text), ...cast };
});
const list = join(out, 'jobs.json');
writeFileSync(list, JSON.stringify(jobs, null, 1));
const r = spawnSync(PYTHON, [join(here, 'speak.py'), list, KOKORO, out], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
if (r.status !== 0) throw new Error(`speaking failed: ${String(r.stderr).slice(-600)}`);
console.log(`speech: ${lines.length} lines, ${String(r.stdout).trim()} -> ${out}`);
