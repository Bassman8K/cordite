// Unified input: keyboard + mouse (pointer lock), gamepad and touch all feed the same actions.

import { clamp } from './math';
import { store, type Action } from './settings';

const ACTIONS = Object.keys(store.settings.binds) as Action[];

class Input {
  /** Movement axes in [-1, 1]: x = strafe right, y = forward. */
  moveX = 0;
  moveY = 0;
  /** Accumulated look delta in radians (already scaled by sensitivity). */
  lookX = 0;
  lookY = 0;
  locked = false;
  /** Last device used, so the HUD can show the right prompts. */
  device: 'kbm' | 'pad' | 'touch' = 'kbm';
  enabled = false;
  onLockChange: (locked: boolean) => void = () => {};
  /** Fired for any key press while rebinding. */
  captureNext: ((code: string) => void) | null = null;

  private codes = new Set<string>();
  private now = new Map<Action, boolean>();
  private prev = new Map<Action, boolean>();
  private virtual = new Map<Action, boolean>();
  private pulses = new Set<Action>();
  private touchMoveX = 0;
  private touchMoveY = 0;
  private padPrev: boolean[] = [];
  private canvas: HTMLElement | null = null;
  /** Extra multiplier applied to look input (ADS / scope slow-down). */
  lookScale = 1;

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (this.captureNext) {
        e.preventDefault();
        const fn = this.captureNext;
        this.captureNext = null;
        fn(e.code);
        return;
      }
      if (this.enabled && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || (e.code === 'KeyS' && e.ctrlKey))) e.preventDefault();
      if (e.repeat) return;
      this.codes.add(e.code);
      this.device = 'kbm';
    });
    window.addEventListener('keyup', (e) => this.codes.delete(e.code));
    window.addEventListener('blur', () => this.codes.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (this.captureNext) {
        const fn = this.captureNext;
        this.captureNext = null;
        fn(`Mouse${e.button}`);
        return;
      }
      this.codes.add(`Mouse${e.button}`);
      this.device = 'kbm';
      if (this.enabled && !this.locked) this.lock();
    });
    window.addEventListener('mouseup', (e) => this.codes.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = 0.0022 * store.settings.sens * this.lookScale;
      // Ignore the occasional huge spurious delta browsers emit when the lock engages.
      const mx = clamp(e.movementX, -400, 400);
      const my = clamp(e.movementY, -400, 400);
      this.lookX += mx * s;
      this.lookY += my * s * (store.settings.invertY ? -1 : 1);
    });
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.pulse(e.deltaY > 0 ? 'next' : 'prev');
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.codes.clear();
      this.onLockChange(this.locked);
    });
  }

  lock(): void {
    if (!this.canvas || this.device === 'touch') return;
    try {
      const p = (this.canvas as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void }).requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          // Raw input unsupported (or denied): fall back to standard pointer lock.
          try {
            const q = this.canvas?.requestPointerLock() as Promise<void> | void;
            if (q && typeof (q as Promise<void>).catch === 'function') (q as Promise<void>).catch(() => {});
          } catch {
            /* headless or unsupported */
          }
        });
      }
    } catch {
      /* unsupported */
    }
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Touch / UI buttons hold an action down. */
  setVirtual(a: Action, down: boolean): void {
    this.virtual.set(a, down);
    if (down) this.device = 'touch';
  }
  /** One-frame press (wheel, touch taps). */
  pulse(a: Action): void {
    this.pulses.add(a);
  }
  setTouchMove(x: number, y: number): void {
    this.touchMoveX = x;
    this.touchMoveY = y;
    if (x || y) this.device = 'touch';
  }
  addLook(dx: number, dy: number): void {
    this.lookX += dx * this.lookScale;
    this.lookY += dy * this.lookScale * (store.settings.invertY ? -1 : 1);
  }

  down(a: Action): boolean {
    return this.now.get(a) === true;
  }
  pressed(a: Action): boolean {
    return this.now.get(a) === true && this.prev.get(a) !== true;
  }
  released(a: Action): boolean {
    return this.now.get(a) !== true && this.prev.get(a) === true;
  }

  consumeLook(out: { x: number; y: number }): void {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
  }

  /** Call once at the start of each frame. */
  update(dt: number): void {
    const binds = store.settings.binds;
    for (const a of ACTIONS) {
      this.prev.set(a, this.now.get(a) === true);
      let d = this.virtual.get(a) === true || this.pulses.has(a);
      if (!d) for (const code of binds[a]) if (this.codes.has(code)) { d = true; break; }
      this.now.set(a, d);
    }
    this.pulses.clear();
    let mx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let my = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    mx += this.touchMoveX;
    my += this.touchMoveY;
    this.pollPad(dt, (x, y) => {
      mx += x;
      my += y;
    });
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    this.moveX = mx;
    this.moveY = my;
  }

  private pollPad(dt: number, move: (x: number, y: number) => void): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    const lx = dz(pad.axes[0]);
    const ly = dz(pad.axes[1]);
    const rx = dz(pad.axes[2]);
    const ry = dz(pad.axes[3]);
    if (lx || ly || rx || ry) this.device = 'pad';
    move(lx, -ly);
    const curve = (v: number) => Math.sign(v) * v * v;
    const speed = 3.4 * store.settings.sens * this.lookScale;
    this.lookX += curve(rx) * speed * dt;
    this.lookY += curve(ry) * speed * 0.7 * dt * (store.settings.invertY ? -1 : 1);
    const map: Array<[number, Action]> = [
      [7, 'fire'], [6, 'ads'], [0, 'jump'], [1, 'crouch'], [2, 'reload'], [3, 'swap'], [4, 'grenade'], [5, 'melee'],
      [10, 'sprint'], [11, 'melee'], [12, 'medkit'], [13, 'flashlight'], [14, 'firemode'], [9, 'pause'], [8, 'map'],
    ];
    const hold = new Set<Action>(['fire', 'ads', 'sprint']);
    for (const [i, a] of map) {
      const b = pad.buttons[i];
      const d = !!b && (b.pressed || b.value > 0.35);
      if (d) this.device = 'pad';
      if (hold.has(a)) {
        if (d) this.now.set(a, true);
      } else if (d && !this.padPrev[i]) {
        this.now.set(a, true);
      }
      // X doubles as interact while held.
      if (i === 2 && d) this.now.set('interact', true);
      this.padPrev[i] = d;
    }
  }

  /** Clears held state (used when menus open so nothing sticks). */
  reset(): void {
    this.codes.clear();
    this.virtual.clear();
    this.pulses.clear();
    this.lookX = this.lookY = 0;
    this.touchMoveX = this.touchMoveY = 0;
    for (const a of ACTIONS) {
      this.now.set(a, false);
      this.prev.set(a, false);
    }
  }
}

export const input = new Input();
