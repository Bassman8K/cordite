import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/game/campaign';
import type { Cond } from '../src/game/campaign/types';
import { ARCHETYPES } from '../src/game/enemies/types';
import { hasWeapon } from '../src/game/weapons/data';
import { LevelBuilder } from '../src/world/builder';
import { NavGrid } from '../src/world/navgrid';

/** Builds a chapter exactly as the game does (geometry, collision, nav grid) without a GPU. */
function load(n: number) {
  const def = CHAPTERS[n];
  const b = new LevelBuilder(def.seed);
  def.build(b);
  const bd = b.bounds;
  const nav = new NavGrid(b.world, bd.minX, bd.minZ, bd.maxX, bd.maxZ, 0.6, 0.3);
  nav.build(b.navSeeds.length ? b.navSeeds : [[b.spawn.x, b.spawn.z]]);
  return { def, b, nav };
}

const conds = (c: Cond): Cond[] => (c.k === 'all' || c.k === 'any' ? c.of.flatMap(conds) : [c]);

describe('campaign', () => {
  it('has six chapters in order with unique ids', () => {
    expect(CHAPTERS.length).toBe(6);
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(6);
    CHAPTERS.forEach((c, i) => expect(c.n).toBe(i + 1));
  });

  for (let n = 0; n < CHAPTERS.length; n++) {
    describe(`chapter ${n + 1}: ${CHAPTERS[n].title}`, () => {
      const { def, b, nav } = load(n);
      const reach = (x: number, z: number, snap = 2.5) => nav.nearest(x, z, snap) >= 0;

      it('builds a non-trivial level', () => {
        expect(b.world.solids.length).toBeGreaterThan(40);
        expect(b.buckets.size).toBeGreaterThan(3);
        let verts = 0;
        for (const bk of b.buckets.values()) {
          verts += bk.pos.length / 3;
          expect(bk.pos.every(Number.isFinite), `finite geometry in ${bk.mat}`).toBe(true);
        }
        expect(verts).toBeGreaterThan(2000);
        expect(nav.walk.reduce((a, v) => a + v, 0)).toBeGreaterThan(1500);
      });

      it('starts the player on walkable ground, clear of walls', () => {
        expect(reach(b.spawn.x, b.spawn.z, 1)).toBe(true);
        expect(b.world.blocked(b.spawn.x, b.spawn.y, b.spawn.z, 0.34, 1.8)).toBe(false);
      });

      it('references only things that exist', () => {
        const groups = new Set(b.enemies.map((e) => e.group));
        const props = new Set(b.props.map((p) => p.id));
        const uses = new Set(b.interacts.map((i) => i.id));
        const tags = new Set(b.enemies.map((e) => e.id).filter(Boolean));
        for (const st of def.stages) {
          for (const c of conds(st.done)) {
            if (c.k === 'reach') expect(b.zones.has(c.zone), `${st.id}: zone ${c.zone}`).toBe(true);
            if (c.k === 'kill') for (const g of c.groups) expect(groups.has(g), `${st.id}: group ${g}`).toBe(true);
            if (c.k === 'use') expect(uses.has(c.id), `${st.id}: interact ${c.id}`).toBe(true);
            if (c.k === 'destroy') for (const id of c.ids) expect(props.has(id), `${st.id}: prop ${id}`).toBe(true);
          }
          if (st.marker) expect(b.zones.has(st.marker) || uses.has(st.marker) || props.has(st.marker) || tags.has(st.marker), `${st.id}: marker ${st.marker}`).toBe(true);
        }
        for (const e of b.enemies) {
          expect(ARCHETYPES[e.type], `enemy type ${e.type}`).toBeDefined();
          if (e.weapon) expect(hasWeapon(e.weapon), `enemy weapon ${e.weapon}`).toBe(true);
        }
        for (const id of [def.recommended.primary, def.recommended.secondary]) if (id) expect(hasWeapon(id), `recommended ${id}`).toBe(true);
      });

      it('lets the player walk to every objective', () => {
        for (const z of b.zones.values()) expect(reach(z.x, z.z, Math.max(2.5, z.r)), `zone ${z.id} at ${z.x.toFixed(1)}, ${z.z.toFixed(1)}`).toBe(true);
        for (const i of b.interacts) expect(reach(i.x, i.z, i.radius), `interact ${i.id} at ${i.x.toFixed(1)}, ${i.z.toFixed(1)}`).toBe(true);
        for (const p of b.pickups) expect(reach(p.x, p.z, 1.5), `pickup ${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(true);
        for (const p of b.props) if (p.kind === 'target') expect(reach(p.x, p.z, 16), `target ${p.id}`).toBe(true);
      });

      it('places every mobile enemy on reachable ground', () => {
        for (const e of b.enemies) {
          if (e.hold) continue; // tower and rooftop positions are deliberately off the nav grid
          expect(reach(e.x, e.z, 1.6), `${e.type} (${e.group}) at ${e.x.toFixed(1)}, ${e.z.toFixed(1)}`).toBe(true);
          const y = nav.heightAt(e.x, e.z);
          expect(b.world.blocked(e.x, y, e.z, 0.3, 1.7), `${e.type} (${e.group}) inside geometry at ${e.x.toFixed(1)}, ${e.z.toFixed(1)}`).toBe(false);
          if (e.patrol) for (let i = 0; i < e.patrol.length; i += 2) expect(reach(e.patrol[i], e.patrol[i + 1], 2), `patrol point of ${e.type} (${e.group})`).toBe(true);
        }
      });

      it('can path from the start to each objective in order', () => {
        const path: number[] = [];
        let x = b.spawn.x;
        let z = b.spawn.z;
        for (const st of def.stages) {
          for (const c of conds(st.done)) {
            let tx = NaN;
            let tz = NaN;
            if (c.k === 'reach') {
              const zn = b.zones.get(c.zone);
              if (zn) [tx, tz] = [zn.x, zn.z];
            } else if (c.k === 'use') {
              const it = b.interacts.find((i) => i.id === c.id);
              if (it) [tx, tz] = [it.x, it.z];
            }
            if (Number.isNaN(tx)) continue;
            expect(nav.findPath(x, z, tx, tz, path, 400000), `${st.id}: route to ${c.k} target`).toBe(true);
            x = tx;
            z = tz;
          }
        }
      });
    });
  }
});
