// Menu screens: title, campaign, pause, results, credits, loading.

import { formatTime } from '../core/math';
import { DIFFICULTY, store, type Difficulty, type Loadout } from '../core/settings';
import { CHAPTERS } from '../game/campaign';
import type { ChapterDef } from '../game/campaign/types';
import { WEAPONS, getWeapon, hasWeapon } from '../game/weapons/data';
import { weaponIcon } from '../gfx/icons';
import { actionKey, el, esc, press, q } from './dom';
import { platform } from './platform';
import type { UI } from './ui';

declare const __APP_VERSION__: string;

export const TIPS = [
  'Crouching halves how far the enemy can see you, and steadies your aim.',
  'Rounds drop over distance. Hold higher on long shots, especially with pistol calibres.',
  'Rifle rounds punch through thin cover: wood, sheet metal, plaster. So do theirs.',
  'A glint on a rooftop is a scope looking back at you.',
  'Health only regenerates to the end of its current segment. Medkits do the rest.',
  'Hold Sprint while scoped to hold your breath and steady the reticle.',
  'Enemies flank. If the shooting stops, check your sides.',
  'Resupply crates refill everything and let you change your loadout mid-mission.',
  'Heavier weapons slow you down and take longer to bring up to the eye.',
  'A suppressed weapon and a blade will take you a long way before anyone knows you are there.',
  'Pump and bolt actions must be worked between shots. Count your rounds.',
  'Hold the grenade key to cook a frag. Not for long.',
];
export const randomTip = () => TIPS[Math.floor(Math.random() * TIPS.length)];

const fmtLong = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
};

const unlocked = (c: ChapterDef) => store.settings.unlockAll || c.n <= store.progress.unlocked;

// ------------------------------------------------------------------ title

export function titleScreen(ui: UI): HTMLElement {
  const pr = store.progress;
  const done = CHAPTERS.filter((c) => pr.chapters[c.id]?.done).length;
  const cp = pr.checkpoint;
  const cpChapter = cp ? CHAPTERS.find((c) => c.id === cp.chapter) : undefined;
  const next = CHAPTERS.find((c) => !pr.chapters[c.id]?.done && unlocked(c)) ?? CHAPTERS[0];
  const items: Array<[string, string, string]> = [];
  if (cpChapter) items.push(['continue', 'Continue', `Chapter ${cpChapter.n} · ${cpChapter.title}`]);
  else if (done > 0 && done < CHAPTERS.length) items.push(['next', 'Continue', `Chapter ${next.n} · ${next.title}`]);
  items.push(['campaign', done === 0 && !cpChapter ? 'Start campaign' : 'Campaign', `${CHAPTERS.length} chapters`]);
  items.push(['armory', 'Armory', `${WEAPONS.length} weapons`]);
  items.push(['settings', 'Settings', '']);
  items.push(['credits', 'Credits', '']);
  if (platform.desktop) items.push(['quit', 'Quit', '']);
  const s = el('section', 'screen title scrim-left');
  s.innerHTML = `
    <header class="stagger">
      <h1 class="logo" aria-label="Cordite">CORD<span class="round"></span>TE</h1>
      <div class="logo-sub"><i></i><span>Operation Lantern</span><i></i></div>
    </header>
    <nav class="menu-list stagger">
      ${items.map(([a, label, sub], i) => `<button data-a="${a}" class="${i === 0 ? 'primary' : ''}" ${i === 0 ? 'autofocus' : ''}><span class="idx">${String(i + 1).padStart(2, '0')}</span><span>${label}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('')}
    </nav>
    <footer class="title-foot">
      <div class="ver">Cordite ${__APP_VERSION__}<br />Single-player · offline · nothing leaves this device</div>
      <div class="panel progress-card">
        <div class="label a">Campaign progress</div>
        <div class="pips">${CHAPTERS.map((c) => `<i class="${pr.chapters[c.id]?.done ? 'on' : ''}"></i>`).join('')}</div>
        <div class="kv"><span>Chapters cleared</span><b>${done} / ${CHAPTERS.length}</b></div>
        <div class="kv"><span>Hostiles neutralised</span><b>${pr.totals.kills}</b></div>
        <div class="kv"><span>Time in the field</span><b>${fmtLong(pr.totals.playSeconds)}</b></div>
      </div>
    </footer>`;
  for (const b of s.querySelectorAll<HTMLElement>('[data-a]')) {
    press(b, () => {
      const a = b.dataset.a;
      if (a === 'continue' && cpChapter) void ui.startChapter(cpChapter, true);
      else if (a === 'next') ui.go('campaign', { select: next.id });
      else if (a === 'campaign') ui.go('campaign', {});
      else if (a === 'armory') ui.go('armory', {});
      else if (a === 'settings') ui.go('settings', {});
      else if (a === 'credits') ui.go('credits', {});
      else if (a === 'quit') platform.quit();
    });
  }
  return s;
}

// ------------------------------------------------------------------ campaign

const SLOTS: Array<[keyof Loadout, string]> = [['primary', 'Primary'], ['secondary', 'Secondary'], ['melee', 'Melee'], ['throwable', 'Thrown']];

export function loadoutStrip(ui: UI, onPick: (slot: keyof Loadout) => void): HTMLElement {
  const wrap = el('div', 'loadout-strip');
  const l = store.progress.loadout;
  for (const [slot, label] of SLOTS) {
    const def = getWeapon(hasWeapon(l[slot]) ? l[slot] : slot === 'melee' ? 'kabar' : slot === 'throwable' ? 'm67' : 'm4a1');
    const b = el('button', 'slot');
    b.innerHTML = `<span class="label">${label}</span><img alt="" src="${weaponIcon(ui.game.engine.renderer, def, 320, 110, true)}" /><b>${esc(def.name)}</b>`;
    press(b, () => onPick(slot));
    wrap.append(b);
  }
  return wrap;
}

export function campaignScreen(ui: UI, opts: { select?: string }): HTMLElement {
  const pr = store.progress;
  let sel = CHAPTERS.find((c) => c.id === opts.select) ?? CHAPTERS.find((c) => c.id === pr.checkpoint?.chapter) ?? CHAPTERS.find((c) => !pr.chapters[c.id]?.done && unlocked(c)) ?? CHAPTERS[0];
  const s = el('section', 'screen scrim-full');
  s.innerHTML = `
    <div class="topbar"><button class="back">Back</button><h1>Campaign</h1><div class="rule"></div><span class="label a">Operation Lantern</span></div>
    <div class="campaign-body"><div class="chapters"></div><div class="panel detail"></div></div>`;
  press(q(s, '.back'), () => ui.back(), 'uiBack');
  const list = q(s, '.chapters');
  const detail = q(s, '.detail');

  const renderDetail = () => {
    const c = sel;
    const rec = pr.chapters[c.id];
    const open = unlocked(c);
    const cp = pr.checkpoint?.chapter === c.id ? pr.checkpoint : null;
    detail.style.setProperty('--c', c.accent);
    const rec2 = c.recommended;
    const recNames = [rec2.primary, rec2.secondary].filter((id): id is string => !!id && hasWeapon(id)).map((id) => getWeapon(id).name);
    detail.innerHTML = `
      <div class="detail-art"><img alt="" src="./art/${c.id}.jpg" />
        <div class="detail-head"><div class="num">${String(c.n).padStart(2, '0')}</div>
          <div><div class="label a" style="color:${c.accent}">${esc(c.codename)} · ${esc(c.location)} · ${esc(c.clock)}</div><h2>${esc(c.title)}</h2></div></div>
      </div>
      <div class="detail-scroll">
        <div>${c.brief.map((p) => `<p>${esc(p)}</p>`).join('')}
          <ul class="intel">${c.intel.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>
        <div>
          <div class="label">Loadout</div><div class="ls"></div>
          ${recNames.length ? `<div class="kv" style="margin-top:8px"><span>Suggested</span><b>${esc(recNames.join(' · '))}</b></div><button class="btn ghost small usesug" style="margin-top:8px">Use suggested loadout</button>` : ''}
          <div class="label" style="margin-top:16px">Difficulty</div>
          <div class="seg diff" style="margin-top:8px">${(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => `<button data-d="${d}" class="${store.settings.difficulty === d ? 'on' : ''}">${DIFFICULTY[d].label}</button>`).join('')}</div>
          <div class="dimtext blurb" style="margin-top:8px;font-size:15px">${esc(DIFFICULTY[store.settings.difficulty].blurb)}</div>
          ${rec?.done ? `<div style="margin-top:14px"><div class="kv"><span>Best time</span><b>${formatTime(rec.bestTime)}</b></div><div class="kv"><span>Best rating</span><b class="amber">${rec.bestGrade}</b></div><div class="kv"><span>Best accuracy</span><b>${Math.round(rec.bestAccuracy * 100)}%</b></div></div>` : ''}
        </div>
      </div>
      <div class="detail-foot">
        ${!open ? `<span class="label">Locked · complete chapter ${c.n - 1} first</span>` : cp ? `<button class="btn resume" autofocus>Resume · checkpoint ${cp.stage + 1}/${c.stages.length}</button><button class="btn ghost deploy">Restart chapter</button>` : `<button class="btn deploy" autofocus>Deploy</button>`}
        <span class="label" style="margin-left:auto">${c.stages.length} objectives · par ${formatTime(c.par)}</span>
      </div>`;
    const img = q<HTMLImageElement>(detail, '.detail-art img');
    img.addEventListener('error', () => img.remove());
    q(detail, '.ls').append(loadoutStrip(ui, (slot) => ui.go('armory', { slot })));
    const sug = detail.querySelector<HTMLElement>('.usesug');
    if (sug) {
      press(sug, () => {
        store.progress.loadout = { ...store.progress.loadout, ...rec2 };
        store.saveProgress();
        renderDetail();
      }, 'uiConfirm');
    }
    for (const b of detail.querySelectorAll<HTMLElement>('.diff button')) {
      press(b, () => {
        store.set('difficulty', b.dataset.d as Difficulty);
        for (const o of detail.querySelectorAll('.diff button')) o.classList.toggle('on', o === b);
        q(detail, '.blurb').textContent = DIFFICULTY[store.settings.difficulty].blurb;
      });
    }
    const dep = detail.querySelector<HTMLElement>('.deploy');
    if (dep) press(dep, () => void ui.startChapter(c, false), 'uiConfirm');
    const res = detail.querySelector<HTMLElement>('.resume');
    if (res) press(res, () => void ui.startChapter(c, true), 'uiConfirm');
  };

  const renderList = () => {
    list.innerHTML = '';
    for (const c of CHAPTERS) {
      const rec = pr.chapters[c.id];
      const open = unlocked(c);
      const b = el('button', `chapter ${c === sel ? 'on' : ''} ${open ? '' : 'locked'}`);
      b.style.setProperty('--c', c.accent);
      b.innerHTML = `<span class="n">${String(c.n).padStart(2, '0')}</span><span><div class="t">${esc(c.title)}</div><div class="s">${esc(c.codename)}</div></span><span class="g">${open ? (rec?.done ? rec.bestGrade : '') : ''}</span>`;
      press(b, () => {
        sel = c;
        renderList();
        renderDetail();
      });
      list.append(b);
    }
  };
  renderList();
  renderDetail();
  return s;
}

// ------------------------------------------------------------------ pause

const REF: Array<[Parameters<typeof actionKey>[0], string]> = [
  ['fire', 'Fire'], ['ads', 'Aim'], ['reload', 'Reload'], ['interact', 'Interact (hold)'], ['melee', 'Blade'], ['grenade', 'Throw (hold to cook)'],
  ['medkit', 'Medkit'], ['crouch', 'Crouch'], ['sprint', 'Sprint / steady scope'], ['firemode', 'Fire mode'], ['swap', 'Swap weapon'], ['flashlight', 'Flashlight'],
];

export function pauseScreen(ui: UI): HTMLElement {
  const g = ui.game;
  const c = g.chapter;
  const s = el('section', 'screen scrim-full');
  s.innerHTML = `
    <div class="split">
      <div class="stack stagger">
        <div class="label a">Paused</div>
        <h1 class="bigword" style="font-size:clamp(34px,5vw,64px);margin-bottom:14px">${esc(c?.title ?? 'Paused')}</h1>
        <button class="btn wide" data-a="resume" autofocus>Resume</button>
        <button class="btn ghost wide" data-a="checkpoint">Restart from checkpoint</button>
        <button class="btn ghost wide" data-a="chapter">Restart chapter</button>
        <button class="btn ghost wide" data-a="armory">Change loadout</button>
        <button class="btn ghost wide" data-a="settings">Settings</button>
        <button class="btn ghost wide" data-a="quit">Quit to menu</button>
      </div>
      <div class="panel">
        <div class="label a">Current objective</div>
        <p style="margin:8px 0 4px;font:600 22px/1.2 var(--font-d);letter-spacing:.06em">${esc(g.mission?.stage?.objective ?? '')}</p>
        <div class="kv"><span>Objective</span><b>${(g.mission?.stageI ?? 0) + 1} / ${c?.stages.length ?? 1}</b></div>
        <div class="kv"><span>Mission time</span><b>${formatTime(g.time)}</b></div>
        <div class="kv"><span>Difficulty</span><b>${DIFFICULTY[store.settings.difficulty].label}</b></div>
        <div class="label" style="margin:18px 0 8px">Controls</div>
        <div class="controls-ref">${REF.map(([a, label]) => `<div class="kv"><span>${label}</span><b>${esc(actionKey(a))}</b></div>`).join('')}</div>
      </div>
    </div>`;
  for (const b of s.querySelectorAll<HTMLElement>('[data-a]')) {
    press(b, () => {
      const a = b.dataset.a;
      if (a === 'resume') ui.resume();
      else if (a === 'checkpoint' && c) void ui.startChapter(c, true);
      else if (a === 'chapter' && c) void ui.startChapter(c, false);
      else if (a === 'armory') ui.go('armory', { inGame: true });
      else if (a === 'settings') ui.go('settings', {});
      else if (a === 'quit') void ui.quitToMenu();
    });
  }
  return s;
}

// ------------------------------------------------------------------ death / failure

export function deadScreen(ui: UI, opts: { reason?: string }): HTMLElement {
  const g = ui.game;
  const c = g.chapter;
  const failed = !!opts.reason;
  const s = el('section', 'screen scrim-red centered');
  s.innerHTML = `
    <div class="label" style="color:var(--red)">${failed ? 'Mission failed' : 'Killed in action'}</div>
    <h1 class="bigword red">${failed ? 'Failed' : 'K.I.A.'}</h1>
    <p class="tip">${esc(failed ? (opts.reason as string) : randomTip())}</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
      <button class="btn" data-a="checkpoint" autofocus>Retry from checkpoint</button>
      <button class="btn ghost" data-a="chapter">Restart chapter</button>
      <button class="btn ghost" data-a="quit">Quit to menu</button>
    </div>`;
  for (const b of s.querySelectorAll<HTMLElement>('[data-a]')) {
    press(b, () => {
      const a = b.dataset.a;
      if (a === 'checkpoint' && c) void ui.startChapter(c, true);
      else if (a === 'chapter' && c) void ui.startChapter(c, false);
      else void ui.quitToMenu();
    });
  }
  return s;
}

// ------------------------------------------------------------------ chapter complete

export function completeScreen(ui: UI): HTMLElement {
  const r = ui.game.result;
  const s = el('section', 'screen scrim-full centered');
  if (!r) return s;
  const c = r.chapter;
  const next = CHAPTERS.find((x) => x.n === c.n + 1);
  s.innerHTML = `
    <div class="label a">Chapter ${String(c.n).padStart(2, '0')} complete${r.best ? ' · new best' : ''}</div>
    <h1 class="bigword" style="font-size:clamp(30px,5vw,60px)">${esc(c.title)}</h1>
    <div class="grade">${r.grade}</div>
    <div class="stats">
      <div class="stat"><span class="label">Time</span><b>${formatTime(r.time)}</b></div>
      <div class="stat"><span class="label">Accuracy</span><b>${Math.round(r.accuracy * 100)}%</b></div>
      <div class="stat"><span class="label">Kills · headshots</span><b>${r.kills} · ${r.headshots}</b></div>
      <div class="stat"><span class="label">Deaths</span><b>${r.deaths}</b></div>
    </div>
    <p class="debrief">${esc(c.debrief)}</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
      ${next ? `<button class="btn" data-a="next" autofocus>Next · ${esc(next.title)}</button>` : `<button class="btn" data-a="credits" autofocus>Credits</button>`}
      <button class="btn ghost" data-a="replay">Replay</button>
      <button class="btn ghost" data-a="quit">Menu</button>
    </div>`;
  for (const b of s.querySelectorAll<HTMLElement>('[data-a]')) {
    press(b, () => {
      const a = b.dataset.a;
      if (a === 'next' && next) {
        void ui.quitToMenu().then(() => ui.go('campaign', { select: next.id }));
      } else if (a === 'replay') void ui.startChapter(c, false);
      else if (a === 'credits') void ui.quitToMenu().then(() => ui.go('credits', {}));
      else void ui.quitToMenu();
    });
  }
  return s;
}

// ------------------------------------------------------------------ credits & loading

export function creditsScreen(ui: UI): HTMLElement {
  const s = el('section', 'screen scrim-full');
  s.innerHTML = `
    <div class="topbar"><button class="back">Back</button><h1>Credits</h1><div class="rule"></div></div>
    <div class="rows" style="max-width:820px">
      <p class="debrief"><b class="amber">CORDITE</b> is a single-player tactical shooter built to be small. Its worlds, soldiers, weapons and textures are generated in code when a chapter loads; the voices and the gunfire are real recordings.</p>
      <div class="row"><div><div class="n">Engine</div><div class="d">three.js (MIT) rendering on WebGL 2. Collision, ballistics, navigation, AI, character animation and sound design are written for this game.</div></div><div></div></div>
      <div class="row"><div><div class="n">Voices</div><div class="d">Soldier callouts and headquarters: Kenney Voiceover Pack (kenney.nl), male voice Jeffrey M. Smith, CC0. Pain and death: "Male Grunt/Yelling sounds" by megaboots, CC0.</div></div><div></div></div>
      <div class="row"><div><div class="n">Gunfire</div><div class="d">Recordings of a CZ-52, an SKS, a Mosin-Nagant and a shotgun, © 2009 Vincent Sevedge, used under Creative Commons Attribution 3.0. Cut, re-pitched and layered with generated sound for this game.</div></div><div></div></div>
      <div class="row"><div><div class="n">Typefaces</div><div class="d">Oxanium, Barlow Condensed and Share Tech Mono, used under the SIL Open Font License.</div></div><div></div></div>
      <div class="row"><div><div class="n">Weapons</div><div class="d">Specifications are approximate and drawn from public reference figures. Names of real firearms are the trademarks of their respective owners and are used descriptively; no endorsement is implied.</div></div><div></div></div>
      <div class="row"><div><div class="n">Story</div><div class="d">Port Calder, Dravik, the Corvane Group and everyone in them are fictional.</div></div><div></div></div>
      <div class="row"><div><div class="n">Version</div><div class="d">${__APP_VERSION__}</div></div><div></div></div>
    </div>`;
  press(q(s, '.back'), () => ui.back(), 'uiBack');
  return s;
}

export function loadingScreen(ui: UI, opts: { chapter?: ChapterDef }): HTMLElement {
  const c = opts.chapter;
  const s = el('section', 'screen loading');
  s.innerHTML = `
    <div class="label a" style="color:${c?.accent ?? ''}">${c ? `Chapter ${String(c.n).padStart(2, '0')} · ${esc(c.location)} · ${esc(c.clock)}` : 'Loading'}</div>
    <h2>${esc(c?.title ?? 'Stand by')}</h2>
    <p class="tip">${esc(randomTip())}</p>
    <div class="label st">Stand by</div>
    <div class="loadbar"><i></i></div>`;
  const bar = q(s, '.loadbar i');
  const st = q(s, '.st');
  ui.progress = (label, f) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    st.textContent = label;
  };
  ui.onLeave(() => (ui.progress = null));
  return s;
}
