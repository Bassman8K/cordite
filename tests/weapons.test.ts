import { describe, expect, it } from 'vitest';
import { CALIBERS, WEAPONS, getWeapon } from '../src/game/weapons/data';
import { CLASS_ORDER } from '../src/game/weapons/types';

describe('arsenal database', () => {
  it('has a large, uniquely identified roster', () => {
    const ids = new Set(WEAPONS.map((w) => w.id));
    expect(ids.size).toBe(WEAPONS.length);
    expect(WEAPONS.length).toBeGreaterThanOrEqual(250);
  });

  it('covers every class', () => {
    for (const cls of CLASS_ORDER) expect(WEAPONS.some((w) => w.cls === cls), cls).toBe(true);
  });

  it('derives sane handling numbers for every firearm', () => {
    for (const w of WEAPONS.filter((x) => x.slot === 'gun')) {
      const tag = `${w.id} (${w.name})`;
      expect(CALIBERS[w.cal], tag).toBeDefined();
      expect(w.modes.every(Boolean), `${tag} modes`).toBe(true);
      expect(w.mag, tag).toBeGreaterThan(0);
      expect(w.mv, tag).toBeGreaterThan(0);
      expect(w.rpm, tag).toBeGreaterThan(0);
      expect(w.damage, tag).toBeGreaterThan(0);
      expect(Number.isFinite(w.recoil), tag).toBe(true);
      expect(w.reload, tag).toBeGreaterThan(0);
      expect(w.reserve, tag).toBeGreaterThan(0);
      expect(w.mobility, tag).toBeGreaterThanOrEqual(0.5);
      expect(w.mobility, tag).toBeLessThanOrEqual(1);
      expect(w.adsTime, tag).toBeGreaterThan(0.1);
      expect(w.year, tag).toBeGreaterThan(1200);
      for (const v of Object.values(w.bars)) {
        expect(v, `${tag} bar`).toBeGreaterThanOrEqual(0);
        expect(v, `${tag} bar`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('orders damage by physics, not by hand', () => {
    const d = (id: string) => getWeapon(id).damage;
    expect(d('glock17')).toBeLessThan(d('m4a1'));
    expect(d('m4a1')).toBeLessThan(d('ak47'));
    expect(d('ak47')).toBeLessThan(d('fal'));
    expect(d('fal')).toBeLessThan(d('awm'));
    expect(d('awm')).toBeLessThan(d('m82'));
    // A 9mm takes several hits on a 100 HP target; a .50 BMG does not.
    expect(d('glock17')).toBeGreaterThan(20);
    expect(d('glock17')).toBeLessThan(45);
    expect(d('m82')).toBeGreaterThan(200);
  });

  it('gives heavier, softer-shooting guns less recoil', () => {
    expect(getWeapon('m4a1').recoil).toBeLessThan(getWeapon('ak47').recoil);
    expect(getWeapon('m249').recoil).toBeLessThan(getWeapon('m4a1').recoil);
    expect(getWeapon('glock17').recoil).toBeLessThan(getWeapon('deagle').recoil);
    expect(getWeapon('m82').mobility).toBeLessThan(getWeapon('m4a1').mobility);
  });

  it('melee and thrown entries are complete', () => {
    for (const w of WEAPONS.filter((x) => x.slot === 'melee')) {
      expect(w.meleeDamage, w.id).toBeGreaterThan(0);
      expect(w.meleeRange, w.id).toBeGreaterThan(1);
    }
    for (const w of WEAPONS.filter((x) => x.slot === 'thrown')) {
      expect(w.throwKind, w.id).not.toBe('');
      expect(w.carry, w.id).toBeGreaterThan(0);
      expect(w.blast, w.id).not.toBeNull();
    }
  });
});
