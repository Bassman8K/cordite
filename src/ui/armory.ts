// Armory: browse every weapon, inspect it in 3D with its real specifications, and build a loadout.

import { store, type Loadout } from '../core/settings';
import { WEAPONS, getWeapon, hasWeapon } from '../game/weapons/data';
import { CLASS_LABEL, CLASS_ORDER, type WeaponClass, type WeaponDef } from '../game/weapons/types';
import { weaponIcon } from '../gfx/icons';
import { el, esc, press, q } from './dom';
import type { UI } from './ui';

const MODES: Record<string, string> = { auto: 'Automatic', semi: 'Semi-automatic', burst2: '2-round burst', burst3: '3-round burst', bolt: 'Bolt action', pump: 'Pump action', lever: 'Lever action', da: 'Double action', sa: 'Single action', single: 'Single shot' };
const FEEDS: Record<string, string> = { box: 'Detachable box', drum: 'Drum', pan: 'Pan', belt: 'Belt', helical: 'Helical', tube: 'Tube', internal: 'Internal, clip-loaded', enbloc: 'En-bloc clip', cyl: 'Cylinder', gate: 'Loading gate', single: 'Breech / muzzle', double: 'Twin barrels', tank: 'Fuel tank', none: '' };
const THROW: Record<string, string> = { frag: 'Fragmentation', impact: 'Impact fuze', stun: 'Flash-bang', fire: 'Incendiary', smoke: 'Smoke', remote: 'Remote charge', mine: 'Directional mine' };

const slotFor = (d: WeaponDef): Array<keyof Loadout> => (d.slot === 'melee' ? ['melee'] : d.slot === 'thrown' ? ['throwable'] : ['primary', 'secondary']);
const SLOT_LABEL: Record<keyof Loadout, string> = { primary: 'Primary', secondary: 'Secondary', melee: 'Melee', throwable: 'Thrown' };

function specs(d: WeaponDef): Array<[string, string]> {
  if (d.slot === 'melee') return [['Type', d.calLabel], ['Damage', String(d.meleeDamage)], ['Reach', `${d.meleeRange.toFixed(1)} m`], ['Swing', `${d.meleeTime.toFixed(2)} s`], ['Origin', d.country], ['Era', d.year < 0 ? `${-d.year} BC` : String(d.year)]];
  if (d.slot === 'thrown') {
    return [['Type', THROW[d.throwKind] ?? d.calLabel], ['Fuze', d.fuse > 0 ? `${d.fuse.toFixed(1)} s` : d.throwKind === 'remote' ? 'On command' : d.throwKind === 'mine' ? 'Proximity' : 'On impact'], ['Blast radius', `${d.blast?.r ?? 0} m`], ['Carried', String(d.carry)], ['Origin', d.country], ['Introduced', String(d.year)]];
  }
  const out: Array<[string, string]> = [
    ['Calibre', d.calLabel],
    ['Muzzle velocity', `${Math.round(d.mv)} m/s`],
    ['Muzzle energy', d.proj === 'bullet' || d.proj === 'arrow' ? `${Math.round(d.energy).toLocaleString('en')} J` : '—'],
    ['Rate of fire', `${d.rpm} rpm`],
    ['Capacity', `${d.mag}${d.feed !== 'none' ? ` · ${FEEDS[d.feed] ?? ''}` : ''}`],
    ['Action', d.modes.map((m) => MODES[m]).join(' / ')],
    ['Weight', `${d.mass.toFixed(d.mass < 10 ? 2 : 1)} kg`],
    ['Length', `${Math.round(d.length * 1000)} mm`],
    ['Barrel', d.barrel > 0 ? `${Math.round(d.barrel * 1000)} mm` : '—'],
    ['Reload', d.perRound > 0 ? `${d.perRound.toFixed(2)} s per round` : `${d.reload.toFixed(1)} s`],
    ['Effective range', `${d.range} m`],
    ['Sight', d.scoped ? `${d.zoom}× optic` : d.look.opts.has('dot') || d.look.opts.has('holo') ? 'Reflex' : 'Iron sights'],
  ];
  return out;
}

export function armoryScreen(ui: UI, opts: { slot?: keyof Loadout; inGame?: boolean; resume?: boolean }): HTMLElement {
  const renderer = ui.game.engine.renderer;
  const load = store.progress.loadout;
  let target: keyof Loadout | null = opts.slot ?? null;
  const startId = target && hasWeapon(load[target]) ? load[target] : hasWeapon(load.primary) ? load.primary : 'm4a1';
  let sel = getWeapon(startId);
  let cls: WeaponClass | 'all' = target === 'melee' ? 'melee' : target === 'throwable' ? 'thrown' : sel.cls;
  let query = '';
  let sort: 'name' | 'year' | 'power' = 'name';

  const s = el('section', 'screen');
  s.innerHTML = `
    <div class="topbar"><button class="back">${opts.resume ? 'Resume' : 'Back'}</button><h1>Armory</h1><div class="rule"></div><span class="label a">${WEAPONS.length} weapons · ${new Set(WEAPONS.map((w) => w.country)).size} countries</span></div>
    <div class="armory-body">
      <div class="panel classes" style="padding:10px"></div>
      <div class="gridwrap">
        <div class="search"><input type="search" placeholder="Search name, calibre, country, year" autocomplete="off" spellcheck="false" />
          <div class="seg sortseg"><button data-s="name" class="on">A–Z</button><button data-s="year">Year</button><button data-s="power">Power</button></div></div>
        <div class="wgrid"></div>
      </div>
      <div class="wdetail"><div class="stage3d hit"><span class="label hint">Drag to rotate</span></div><div class="panel winfo"></div></div>
    </div>`;
  press(q(s, '.back'), () => (opts.resume ? ui.resume() : ui.back()), 'uiBack');
  const classes = q(s, '.classes');
  const grid = q(s, '.wgrid');
  const info = q(s, '.winfo');
  const stage = q(s, '.stage3d');
  ui.showroom.show(stage);
  if (ui.game.weapons.rig) ui.game.weapons.rig.setVisible(false);
  ui.onLeave(() => ui.game.weapons.rig.setVisible(ui.game.state !== 'menu' && ui.game.state !== 'loading'));

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target as HTMLImageElement;
      img.src = weaponIcon(renderer, getWeapon(img.dataset.id as string), 320, 110, true);
      io.unobserve(img);
    }
  }, { root: grid, rootMargin: '200px' });
  ui.onLeave(() => io.disconnect());

  const equipped = (id: string) => Object.values(store.progress.loadout).includes(id);

  const renderInfo = () => {
    const d = sel;
    ui.showroom.set(d);
    const bars: Array<[string, number]> = d.slot === 'gun' ? [['Damage', d.bars.damage], ['Range', d.bars.range], ['Accuracy', d.bars.accuracy], ['Fire rate', d.bars.rate], ['Mobility', d.bars.mobility], ['Control', d.bars.control]] : [['Damage', d.bars.damage], [d.slot === 'melee' ? 'Reach' : 'Radius', d.bars.range], ['Speed', d.bars.rate]];
    const slots = slotFor(d);
    info.innerHTML = `
      <div class="label a">${esc(CLASS_LABEL[d.cls])} · ${esc(d.country)} · ${d.year < 0 ? `${-d.year} BC` : d.year}</div>
      <h2>${esc(d.name)}</h2>
      <div class="bars">${bars.map(([n, v]) => `<span class="label">${n}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div>`).join('')}</div>
      <div class="specs">${specs(d).map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div class="equip">${slots.map((sl) => `<button class="btn ${store.progress.loadout[sl] === d.id ? 'ghost' : ''} ${target && target !== sl ? 'ghost' : ''}" data-slot="${sl}">${store.progress.loadout[sl] === d.id ? `Equipped · ${SLOT_LABEL[sl]}` : `Equip ${SLOT_LABEL[sl]}`}</button>`).join('')}</div>`;
    for (const b of info.querySelectorAll<HTMLElement>('[data-slot]')) {
      press(b, () => {
        const sl = b.dataset.slot as keyof Loadout;
        const l = store.progress.loadout;
        // Equipping a gun that already sits in the other slot swaps the two.
        if ((sl === 'primary' || sl === 'secondary') && l[sl === 'primary' ? 'secondary' : 'primary'] === d.id) l[sl === 'primary' ? 'secondary' : 'primary'] = l[sl];
        l[sl] = d.id;
        store.saveProgress();
        if (opts.inGame) ui.game.weapons.setLoadout(l);
        if (opts.inGame) ui.game.weapons.rig.setVisible(false);
        renderInfo();
        renderGrid(false);
      }, 'uiConfirm');
    }
  };

  const renderGrid = (resetScroll = true) => {
    const ql = query.trim().toLowerCase();
    let list = WEAPONS.filter((w) => (cls === 'all' || w.cls === cls) && (!ql || `${w.name} ${w.calLabel} ${w.country} ${w.year} ${CLASS_LABEL[w.cls]}`.toLowerCase().includes(ql)));
    if (target === 'primary' || target === 'secondary') list = list.filter((w) => w.slot === 'gun');
    list = list.slice().sort((a, b) => (sort === 'year' ? a.year - b.year : sort === 'power' ? b.bars.damage - a.bars.damage : a.name.localeCompare(b.name)));
    const top = grid.scrollTop;
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const w of list) {
      const b = el('button', `wcard ${w === sel ? 'on' : ''} ${equipped(w.id) ? 'eq' : ''}`);
      b.innerHTML = `<img alt="" data-id="${w.id}" /><b>${esc(w.name)}</b><i>${esc(w.calLabel)} · ${w.year < 0 ? `${-w.year} BC` : w.year}</i>`;
      press(b, () => {
        sel = w;
        for (const o of grid.querySelectorAll('.wcard.on')) o.classList.remove('on');
        b.classList.add('on');
        renderInfo();
      });
      io.observe(b.firstElementChild as Element);
      frag.append(b);
    }
    if (!list.length) frag.append(el('div', 'label', 'No weapons match that search'));
    grid.append(frag);
    grid.scrollTop = resetScroll ? 0 : top;
  };

  const renderClasses = () => {
    classes.innerHTML = '';
    const entries: Array<[WeaponClass | 'all', string, number]> = [['all', 'All weapons', WEAPONS.length], ...CLASS_ORDER.map((c) => [c, CLASS_LABEL[c], WEAPONS.filter((w) => w.cls === c).length] as [WeaponClass, string, number])];
    for (const [id, label, n] of entries) {
      const b = el('button', id === cls ? 'on' : '', `${label}<span>${n}</span>`);
      press(b, () => {
        cls = id;
        target = null;
        renderClasses();
        renderGrid();
      });
      classes.append(b);
    }
  };

  const search = q<HTMLInputElement>(s, '.search input');
  search.addEventListener('input', () => {
    query = search.value;
    if (query && cls !== 'all') {
      cls = 'all';
      renderClasses();
    }
    renderGrid();
  });
  search.addEventListener('keydown', (e) => e.stopPropagation());
  for (const b of s.querySelectorAll<HTMLElement>('.sortseg button')) {
    press(b, () => {
      sort = b.dataset.s as typeof sort;
      for (const o of s.querySelectorAll('.sortseg button')) o.classList.toggle('on', o === b);
      renderGrid();
    });
  }
  renderClasses();
  renderGrid();
  renderInfo();
  requestAnimationFrame(() => grid.querySelector('.wcard.on')?.scrollIntoView({ block: 'center' }));
  return s;
}
