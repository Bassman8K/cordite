// Tiny DOM helpers shared by the HUD and menus.

import { audio } from '../core/audio';
import type { Action } from '../core/settings';
import { store } from '../core/settings';
import { input } from '../core/input';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Escapes text destined for innerHTML. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function q<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T {
  return root.querySelector(sel) as T;
}

/** Click handler with interface sounds. */
export function press(target: HTMLElement, fn: (e: Event) => void, sound = 'uiClick'): void {
  target.addEventListener('click', (e) => {
    audio.unlock();
    audio.uiPlay(sound, 0.8);
    fn(e);
  });
  target.addEventListener('pointerenter', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse') audio.uiPlay('uiHover', 0.6);
  });
}

const NAMES: Record<string, string> = {
  Space: 'Space', Escape: 'Esc', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
  Tab: 'Tab', Enter: 'Enter', Backspace: 'Bksp', CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
};
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

const PAD: Partial<Record<Action, string>> = { interact: 'X', reload: 'X', jump: 'A', crouch: 'B', fire: 'RT', ads: 'LT', grenade: 'LB', melee: 'RB', swap: 'Y', medkit: 'D-pad ↑', pause: 'Start' };
/** Label for an action on whatever device the player is using right now. */
export function actionKey(a: Action): string {
  if (input.device === 'pad') return PAD[a] ?? '';
  if (input.device === 'touch') return 'TAP';
  return keyName(store.settings.binds[a][0] ?? '');
}
