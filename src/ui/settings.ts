// Settings: gameplay, video, audio, controls and the tester options.

import { audio } from '../core/audio';
import { input } from '../core/input';
import { ACTION_LABELS, DEFAULT_BINDS, DIFFICULTY, store, type Action, type Difficulty, type Quality, type Settings } from '../core/settings';
import { el, esc, keyName, press, q } from './dom';
import { platform } from './platform';
import type { UI } from './ui';

type Tab = 'game' | 'video' | 'audio' | 'controls' | 'tester';
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

export function settingsScreen(ui: UI): HTMLElement {
  const engine = ui.game.engine;
  let tab: Tab = 'game';
  const s = el('section', 'screen scrim-full');
  s.innerHTML = `
    <div class="topbar"><button class="back">Back</button><h1>Settings</h1><div class="rule"></div></div>
    <div class="settings-body"><div class="panel classes tabs" style="padding:10px"></div><div class="rows"></div></div>`;
  press(q(s, '.back'), () => ui.back(), 'uiBack');
  const tabs = q(s, '.tabs');
  const rows = q(s, '.rows');

  const row = (name: string, desc: string, control: HTMLElement): HTMLElement => {
    const r = el('div', 'row', `<div><div class="n">${esc(name)}</div>${desc ? `<div class="d">${esc(desc)}</div>` : ''}</div>`);
    const c = el('div', 'c');
    c.append(control);
    r.append(c);
    rows.append(r);
    return r;
  };

  const toggle = (name: string, desc: string, key: BoolKey, after?: () => void) => {
    const b = el('button', `switch ${store.settings[key] ? 'on' : ''}`);
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', name);
    press(b, () => {
      store.set(key, !store.settings[key]);
      b.classList.toggle('on', store.settings[key]);
      after?.();
    });
    row(name, desc, b);
  };

  const slider = (name: string, desc: string, key: NumKey, min: number, max: number, step: number, fmt: (v: number) => string, after?: () => void) => {
    const wrap = el('div', '', '');
    wrap.style.cssText = 'display:flex;align-items:center;gap:12px;flex:1';
    const inp = el('input');
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(store.settings[key]);
    inp.setAttribute('aria-label', name);
    const val = el('span', 'val', fmt(store.settings[key]));
    const paint = () => inp.style.setProperty('--p', `${((parseFloat(inp.value) - min) / (max - min)) * 100}%`);
    paint();
    inp.addEventListener('input', () => {
      store.set(key, parseFloat(inp.value));
      val.textContent = fmt(store.settings[key]);
      paint();
      after?.();
    });
    wrap.append(inp, val);
    row(name, desc, wrap);
  };

  const seg = <T extends string | number>(name: string, desc: string, options: Array<[T, string]>, get: () => T, set: (v: T) => void) => {
    const g = el('div', 'seg');
    for (const [v, label] of options) {
      const b = el('button', get() === v ? 'on' : '', label);
      press(b, () => {
        set(v);
        for (const o of g.children) o.classList.toggle('on', o === b);
      });
      g.append(b);
    }
    return row(name, desc, g);
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const render = () => {
    rows.innerHTML = '';
    if (tab === 'game') {
      const r = seg<Difficulty>('Difficulty', DIFFICULTY[store.settings.difficulty].blurb, (Object.keys(DIFFICULTY) as Difficulty[]).map((d) => [d, DIFFICULTY[d].label]), () => store.settings.difficulty, (v) => {
        store.set('difficulty', v);
        q(r, '.d').textContent = DIFFICULTY[v].blurb;
      });
      toggle('Crosshair', 'Hip-fire reticle that widens with movement and recoil. Always off on Realist.', 'crosshair');
      toggle('Threat radar', 'Shows enemies that have noticed you. Always off on Realist.', 'radar');
      toggle('Subtitles', 'Radio traffic as text.', 'subtitles');
      toggle('Blood', 'Impact effects on hits.', 'blood');
      toggle('View bob', 'Camera movement while walking and running.', 'bob');
      toggle('Auto-fire on touch', 'Fires when the sights rest on a target. For phones and tablets.', 'autoFire');
    } else if (tab === 'video') {
      seg<Quality>('Quality', 'Low: no shadows or post-processing, lightest on memory. High: soft shadows, bloom, 4× anti-aliasing.', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], () => store.settings.quality, (v) => {
        store.set('quality', v);
        engine.applyQuality();
      });
      slider('Render scale', 'Internal resolution. Lower it for a big frame-rate gain on weak GPUs.', 'renderScale', 0.5, 1, 0.05, pct, () => engine.resize());
      toggle('Shadows', '', 'shadows', () => engine.applyQuality());
      toggle('Post-processing', 'Bloom, colour grade, vignette and film grain.', 'postfx', () => engine.applyQuality());
      slider('Field of view', 'Vertical, in degrees. Lower values make distant targets larger.', 'fov', 50, 90, 1, (v) => `${v}°`);
      seg<number>('Frame-rate cap', 'Capping saves battery and heat.', [[0, 'Off'], [30, '30'], [60, '60'], [120, '120']], () => store.settings.fpsCap, (v) => store.set('fpsCap', v));
      toggle('Performance readout', 'Frame time, draw calls and triangles.', 'showFps');
      if (!platform.touch || platform.desktop) {
        const fs = el('button', 'btn ghost small', 'Toggle full screen');
        press(fs, () => platform.toggleFullscreen());
        row('Full screen', platform.desktop ? 'Also F11.' : '', fs);
      }
      rows.append(el('p', 'note', 'Texture and material quality take effect when the next chapter loads. Everything else applies immediately.'));
    } else if (tab === 'audio') {
      slider('Master volume', '', 'master', 0, 1, 0.05, pct, () => audio.applyVolumes());
      slider('Effects', 'Weapons, impacts, footsteps, ambience.', 'sfx', 0, 1, 0.05, pct, () => audio.applyVolumes());
      slider('Music', 'The score follows the fight: quiet when you are unseen, driving in contact.', 'music', 0, 1, 0.05, pct, () => audio.applyVolumes());
      rows.append(el('p', 'note', 'All audio is synthesised on your device. The game ships with no sound files.'));
    } else if (tab === 'controls') {
      slider('Look sensitivity', '', 'sens', 0.2, 3, 0.05, (v) => v.toFixed(2));
      slider('Aiming sensitivity', 'Multiplier while aiming down sights (scaled further by zoom).', 'adsSens', 0.2, 1.5, 0.05, (v) => v.toFixed(2));
      toggle('Invert vertical look', '', 'invertY');
      toggle('Toggle aim', 'Press once to aim instead of holding.', 'toggleAds');
      toggle('Toggle crouch', '', 'toggleCrouch');
      for (const a of Object.keys(DEFAULT_BINDS) as Action[]) {
        const b = el('button', 'keycap', esc(store.settings.binds[a].map(keyName).join(' / ')));
        press(b, () => {
          b.classList.add('listen');
          b.textContent = 'Press a key…';
          input.captureNext = (code) => {
            if (code !== 'Escape') {
              store.settings.binds[a] = [code];
              store.saveSettings();
            }
            b.classList.remove('listen');
            b.textContent = store.settings.binds[a].map(keyName).join(' / ');
          };
        });
        row(ACTION_LABELS[a], '', b);
      }
      const reset = el('button', 'btn ghost small', 'Restore default keys');
      press(reset, () => {
        store.settings.binds = structuredClone(DEFAULT_BINDS);
        store.saveSettings();
        render();
      });
      row('Defaults', 'Gamepads are supported automatically: sticks to move and look, triggers to aim and fire.', reset);
    } else {
      rows.append(el('p', 'note', 'Tester options. These exist so builds can be checked quickly; they are off by default and do not affect saved ratings unless you finish a chapter with them on.'));
      toggle('Invulnerable', 'Take no damage.', 'god');
      toggle('Bottomless magazines', 'Firing does not use ammunition.', 'infiniteAmmo');
      toggle('Unlock every chapter', 'Open the whole campaign without completing earlier chapters.', 'unlockAll');
      toggle('Performance readout', '', 'showFps');
      if (ui.inGame) {
        const skip = el('button', 'btn ghost small', 'Complete objective');
        press(skip, () => {
          ui.game.mission?.skipStage();
          ui.resume();
        });
        row('Skip the current objective', 'Jumps the mission forward one checkpoint.', skip);
      }
      const wipe = el('button', 'btn danger small', 'Erase progress');
      let armed = false;
      press(wipe, () => {
        if (!armed) {
          armed = true;
          wipe.textContent = 'Press again to confirm';
          return;
        }
        store.resetProgress();
        wipe.textContent = 'Progress erased';
        wipe.setAttribute('disabled', '');
      });
      row('Reset campaign', 'Clears completed chapters, checkpoints, ratings and statistics on this device.', wipe);
      const defaults = el('button', 'btn ghost small', 'Restore default settings');
      press(defaults, () => {
        store.resetSettings();
        engine.applyQuality();
        audio.applyVolumes();
        render();
      });
      row('Reset settings', '', defaults);
    }
  };

  const NAMES: Array<[Tab, string]> = [['game', 'Gameplay'], ['video', 'Video'], ['audio', 'Audio'], ['controls', 'Controls'], ['tester', 'Tester']];
  const renderTabs = () => {
    tabs.innerHTML = '';
    for (const [id, label] of NAMES) {
      const b = el('button', id === tab ? 'on' : '', label);
      press(b, () => {
        tab = id;
        renderTabs();
        render();
        rows.scrollTop = 0;
      });
      tabs.append(b);
    }
  };
  renderTabs();
  render();
  ui.onLeave(() => (input.captureNext = null));
  return s;
}
