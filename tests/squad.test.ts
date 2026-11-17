import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { SQUAD } from '../src/game/enemies/squad';
import { ARCHETYPES } from '../src/game/enemies/types';
import { hasWeapon } from '../src/game/weapons/data';
import { scriptLines } from '../scripts/lib/script-lines.mjs';
import { join } from 'node:path';

describe('the squad', () => {
  it('is two named teammates with real soldiers and real weapons behind them', () => {
    expect(SQUAD.length).toBe(2);
    expect(new Set(SQUAD.map((m) => m.callsign)).size).toBe(SQUAD.length);
    for (const m of SQUAD) {
      const arch = ARCHETYPES[m.type];
      expect(arch, m.type).toBeDefined();
      expect(hasWeapon(arch.weapon), arch.weapon).toBe(true);
    }
  });

  it('keeps to both shoulders of the player and speaks in two different voices', () => {
    expect(SQUAD.map((m) => m.side).sort()).toEqual([-1, 1]);
    expect(new Set(SQUAD.map((m) => m.actor)).size).toBe(2);
  });

  it('wears a uniform no enemy wears', () => {
    const squadLook = JSON.stringify(ARCHETYPES[SQUAD[0].type].look.uniform);
    for (const [id, a] of Object.entries(ARCHETYPES)) {
      if (SQUAD.some((m) => m.type === id)) continue;
      expect(JSON.stringify(a.look.uniform), id).not.toBe(squadLook);
    }
  });

  it('goes in with the player unless the player turns it off', () => {
    expect(defaultSettings().squad).toBe(true);
  });

  it('is acknowledged by the story, which has a line for going in alone and one for going in with it', () => {
    const lines = scriptLines(join(__dirname, '..')).map((l) => `${l.who}: ${l.text}`);
    expect(lines.some((l) => l.startsWith('RUSK: One man.'))).toBe(true);
    expect(lines.some((l) => l.startsWith('RUSK: Three of them.'))).toBe(true);
    expect(lines.some((l) => l.includes('Merlin and Shrike'))).toBe(true);
  });
});
