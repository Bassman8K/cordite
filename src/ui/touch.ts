// On-screen controls for phones and tablets: a floating move stick on the left, drag-to-look on
// the right, and action buttons under the right thumb.

import { input } from '../core/input';
import { clamp } from '../core/math';
import { store, type Action } from '../core/settings';
import type { Game } from '../game/game';
import { el } from './dom';

const BUTTONS: Array<[string, Action, string]> = [
  ['fire', 'fire', 'Fire'],
  ['ads', 'ads', 'Aim'],
  ['jump', 'jump', 'Jump'],
  ['crouch', 'crouch', 'Duck'],
  ['reload', 'reload', 'Load'],
  ['swap', 'swap', 'Swap'],
  ['nade', 'grenade', 'Nade'],
  ['knife', 'melee', 'Blade'],
  ['med', 'medkit', 'Med'],
];

export class TouchControls {
  readonly root: HTMLElement;
  private use: HTMLElement;

  constructor(parent: HTMLElement, private readonly game: Game) {
    const r = (this.root = el('div'));
    r.id = 'touch';
    r.hidden = true;
    const zl = el('div', 'zone zl');
    const zr = el('div', 'zone zr');
    const stick = el('div', 'stick', '<i></i>');
    const knob = stick.firstElementChild as HTMLElement;
    r.append(zl, zr, stick);

    // ---- move stick
    let moveId = -1;
    let ox = 0;
    let oy = 0;
    const R = 58;
    zl.addEventListener('pointerdown', (e) => {
      if (moveId !== -1) return;
      moveId = e.pointerId;
      ox = e.clientX;
      oy = e.clientY;
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
      stick.classList.add('on');
      knob.style.transform = '';
      zl.setPointerCapture(e.pointerId);
    });
    zl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== moveId) return;
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx *= R / l;
        dy *= R / l;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.setTouchMove(dx / R, -dy / R);
    });
    const endMove = (e: PointerEvent) => {
      if (e.pointerId !== moveId) return;
      moveId = -1;
      stick.classList.remove('on');
      input.setTouchMove(0, 0);
    };
    zl.addEventListener('pointerup', endMove);
    zl.addEventListener('pointercancel', endMove);

    // ---- look: any drag on the right side (including one that starts on the fire button)
    const look = (target: HTMLElement) => {
      let id = -1;
      let lx = 0;
      let ly = 0;
      target.addEventListener('pointerdown', (e) => {
        if (id !== -1) return;
        id = e.pointerId;
        lx = e.clientX;
        ly = e.clientY;
        target.setPointerCapture(e.pointerId);
      });
      target.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const k = 0.0046 * store.settings.sens;
        input.addLook((e.clientX - lx) * k, (e.clientY - ly) * k * 0.85);
        lx = e.clientX;
        ly = e.clientY;
      });
      const end = (e: PointerEvent) => {
        if (e.pointerId === id) id = -1;
      };
      target.addEventListener('pointerup', end);
      target.addEventListener('pointercancel', end);
    };
    look(zr);

    for (const [cls, action, label] of BUTTONS) {
      const b = el('button', `tb ${cls}`, label);
      const down = (e: PointerEvent) => {
        e.preventDefault();
        input.setVirtual(action, true);
        b.classList.add('on');
        if (navigator.vibrate && action === 'fire') navigator.vibrate(8);
      };
      const up = () => {
        input.setVirtual(action, false);
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      if (action === 'fire' || action === 'ads') look(b);
      r.append(b);
    }
    this.use = el('button', 'tb use', 'Use');
    this.use.hidden = true;
    this.use.addEventListener('pointerdown', () => input.setVirtual('interact', true));
    const useUp = () => input.setVirtual('interact', false);
    this.use.addEventListener('pointerup', useUp);
    this.use.addEventListener('pointercancel', useUp);
    this.use.addEventListener('pointerleave', useUp);
    const pause = el('button', 'tb pause', 'II');
    pause.addEventListener('click', () => this.game.pause());
    r.append(this.use, pause);
    parent.append(r);

    game.events.on('prompt', (p) => {
      const show = !!p;
      if (this.use.hidden === show) this.use.hidden = !show;
      if (!show) input.setVirtual('interact', false);
    });
    void clamp;
  }

  show(v: boolean): void {
    this.root.hidden = !v;
    if (!v) {
      input.setTouchMove(0, 0);
      for (const [, action] of BUTTONS) input.setVirtual(action, false);
    }
  }
}
