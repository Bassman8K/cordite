import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineKey, SOUND_NAMES } from '../src/core/audio';
import { averageColor, PHOTO } from '../src/gfx/textures';
import { WEAPONS } from '../src/game/weapons/data';
import { CAST, lineKey as buildKey, scriptLines, STOCK } from '../scripts/lib/script-lines.mjs';

const root = join(__dirname, '..');
const dir = join(root, 'public/audio');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, string>;
/** Sounds on file, without their take numbers. */
const recorded = new Set(Object.keys(manifest).map((n) => n.split('~')[0]));
const generated = new Set(SOUND_NAMES());

describe('recorded audio', () => {
  it('lists only files that exist, and ships no file that is not listed', () => {
    for (const file of Object.values(manifest)) expect(existsSync(join(dir, file)), file).toBe(true);
    const listed = new Set(Object.values(manifest));
    const stray = readdirSync(dir).filter((f) => /\.(mp3|flac)$/.test(f) && !listed.has(f));
    expect(stray).toEqual([]);
  });

  it('numbers the takes of a sound from 0 without gaps', () => {
    const takes = new Map<string, number[]>();
    for (const name of Object.keys(manifest)) {
      const [sound, n] = name.split('~');
      if (n !== undefined) takes.set(sound, [...(takes.get(sound) ?? []), Number(n)]);
    }
    for (const [sound, list] of takes) expect(list.sort((a, b) => a - b), sound).toEqual(list.map((_, i) => i));
  });

  it('credits every source it was built from', () => {
    const credits = readFileSync(join(dir, 'CREDITS.txt'), 'utf8');
    const sources = JSON.parse(readFileSync(join(root, 'scripts/audio-sources.json'), 'utf8')) as Record<string, { author: string; license: string }>;
    for (const [id, s] of Object.entries(sources)) {
      expect(credits, `Freesound ${id}`).toContain(`https://freesound.org/s/${id}/`);
      expect(credits).toContain(s.author);
      // Only licences that allow a game to ship the sound: public domain or attribution.
      expect(['publicdomain/zero/1.0', 'licenses/by/4.0', 'licenses/by/3.0']).toContain(s.license);
    }
  });
});

describe('spoken dialogue', () => {
  const lines = scriptLines(root);

  it('has a recording for every line of the story', () => {
    expect(lines.length).toBeGreaterThan(40);
    for (const l of lines) expect(manifest[l.key], `${l.chapter} ${l.who}: ${l.text}`).toMatch(/\.mp3$/);
  });

  it('names a line the same way in the game as in the build', () => {
    for (const l of lines) expect(lineKey(l.who, l.text)).toBe(buildKey(l.who, l.text));
    expect(lineKey('OVERWATCH', 'Move.')).toMatch(/^say_[0-9a-f]{8}$/);
  });

  it('gives every speaker a voice, and no two lines the same recording', () => {
    for (const l of lines) expect(CAST[l.who], l.who).toBeDefined();
    const byKey = new Map<string, string>();
    for (const l of lines) {
      const text = `${l.who}|${l.text}`;
      expect(byKey.get(l.key) ?? text, l.key).toBe(text);
      byKey.set(l.key, text);
    }
  });

  it('has every take of the controller\'s stock lines', () => {
    for (const [name, texts] of Object.entries(STOCK)) texts.forEach((_, i) => expect(manifest[`hq_${name}~${i}`], `hq_${name}~${i}`).toBeDefined());
  });

  it('gives both soldier voices the same set of callouts', () => {
    const one = Object.keys(manifest).filter((n) => n.startsWith('vo_')).map((n) => n.slice(3)).sort();
    const two = Object.keys(manifest).filter((n) => n.startsWith('vo2_')).map((n) => n.slice(4)).sort();
    expect(one.length).toBeGreaterThanOrEqual(15);
    expect(two).toEqual(one);
  });
});

describe('weapon sounds', () => {
  /** Classes with no recording to be had: rockets, the stun gun and flamethrowers stay generated. */
  const GENERATED_ONLY = new Set(['shotLauncher', 'shotTaser', 'flame']);

  it('plays recorded gunfire for every firearm, with several takes for the common ones', () => {
    const count = new Map<string, number>();
    for (const w of WEAPONS) {
      if (w.cls === 'melee' || w.cls === 'thrown') continue;
      count.set(w.sound, (count.get(w.sound) ?? 0) + 1);
      if (!GENERATED_ONLY.has(w.sound)) expect(recorded.has(w.sound), `${w.name} -> ${w.sound}`).toBe(true);
    }
    for (const [sound, n] of count) {
      if (GENERATED_ONLY.has(sound) || n < 10) continue;
      const takes = Object.keys(manifest).filter((k) => k.startsWith(`${sound}~`)).length;
      expect(takes, sound).toBeGreaterThanOrEqual(2);
    }
  });

  it('has a generated stand-in for every sound class, for the moment before a recording has loaded', () => {
    for (const w of WEAPONS) expect(generated.has(w.sound), `${w.name} -> ${w.sound}`).toBe(true);
    for (const name of ['boltAction', 'boltHeavy', 'ping', 'radioEnd', 'magIn', 'magOut', 'pump', 'dry', 'casing']) expect(generated.has(name), name).toBe(true);
  });

  it('matches weapons to the cartridge they fire', () => {
    const sound = (id: string) => WEAPONS.find((w) => w.id === id)?.sound;
    const byName = (name: string) => WEAPONS.find((w) => w.name === name)?.sound;
    expect(byName('AK-47')).toBe('shotAk');
    expect(byName('M16A4')).toBe('shotAr');
    expect(byName('FN FAL')).toBe('shotBattle');
    expect(byName('M1 Garand')).toBe('shotGarand');
    expect(byName('Glock 17')).toBe('shotPistol');
    expect(byName('Colt M1911A1')).toBe('shot45');
    expect(byName('HK MP5A3')).toBe('shotSmg');
    expect(byName('FN P90')).toBe('shotPdw');
    expect(byName('Barrett M82A1')).toBe('shotAmr');
    expect(byName('Browning M2HB')).toBe('shotHmg');
    expect(byName('PKM')).toBe('shotLmg');
    expect(byName('Remington 870')).toBe('shotShotgun');
    expect(byName('HK MP5SD')).toBe('shotSup');
    expect(sound('no-such-weapon')).toBeUndefined();
  });
});

describe('photographed surfaces', () => {
  it('has a colour, relief and roughness image for every surface the game asks for', () => {
    const tex = join(root, 'public/tex');
    const credits = readFileSync(join(tex, 'CREDITS.txt'), 'utf8');
    expect(Object.keys(PHOTO).length).toBeGreaterThanOrEqual(10);
    for (const name of Object.keys(PHOTO)) {
      for (const part of ['c', 'n', 'o']) expect(existsSync(join(tex, `${name}_${part}.jpg`)), `${name}_${part}.jpg`).toBe(true);
      expect(credits, name).toContain(`${name}_*.jpg`);
      // Every one stands in for a generated texture, which is what shows until the photograph has loaded.
      expect(averageColor(name), name).not.toBeNull();
    }
    const expected = new Set(Object.keys(PHOTO).flatMap((n) => ['c', 'n', 'o'].map((p) => `${n}_${p}.jpg`)));
    expect(readdirSync(tex).filter((f) => f.endsWith('.jpg') && !expected.has(f))).toEqual([]);
  });
});
