// Unified input: keyboard + mouse (pointer lock), gamepad and touch all feed the same actions.

import { clamp } from './math';
import { IS_TOUCH, store, type Action } from './settings';

const ACTIONS = Object.keys(store.settings.binds) as Action[];

class Input {
  /** Movement axes in [-1, 1]: x = strafe right, y = forward. */
  moveX = 0;
  moveY = 0;
  /** Accumulated look delta in radians (already scaled by sensitivity). */
  lookX = 0;
  lookY = 0;
  locked = false;
  /** Device in use right now: decides the prompts shown and whether the on-screen controls appear. */
  device: 'kbm' | 'pad' | 'touch' = IS_TOUCH ? 'touch' : 'kbm';
  enabled = false;
  onLockChange: (locked: boolean) => void = () => {};
  onDeviceChange: (device: 'kbm' | 'pad' | 'touch') => void = () => {};
  /**
   * Kind of pointer seen last. Browsers follow every touch with made-up mouse events for old pages;
   * those must not be read as a mouse, or a tap would fire, turn the view or hide the touch controls.
   */
  private pointer: 'mouse' | 'touch' = IS_TOUCH ? 'touch' : 'mouse';
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
  /** Cursor position at the last free (uncaptured) mouse move; NaN = no reference yet. */
  private freeX = NaN;
  private freeY = NaN;
  private lastLockTry = -1e9;
  /** Extra multiplier applied to look input (ADS / scope slow-down). */
  lookScale = 1;

  private setDevice(d: 'kbm' | 'pad' | 'touch'): void {
    if (this.device === d) return;
    this.device = d;
    this.onDeviceChange(d);
  }

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;
    // Real pointer events say what produced them, so they decide between touch and mouse. This also
    // covers laptops with a touch screen and tablets with a trackpad, where both are present.
    const seePointer = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        // A resting mouse can twitch; only a click or a deliberate move takes over from touch.
        if (e.type !== 'pointerdown' && Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) < 4) return;
        if (this.pointer !== 'mouse') this.freeX = NaN; // no jump from where the cursor was before
        this.pointer = 'mouse';
        this.setDevice('kbm');
      } else {
        this.pointer = 'touch';
        this.freeX = NaN;
        this.setDevice('touch');
      }
    };
    window.addEventListener('pointerdown', seePointer, true);
    window.addEventListener('pointermove', seePointer, true);
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
      this.setDevice('kbm');
      // Playing from the keyboard without the mouse captured (for example after resuming with a
      // key): a key press is a chance to capture it. Escape is the browser's release key.
      if (this.enabled && !this.locked && e.code !== 'Escape') this.lock(true);
    });
    window.addEventListener('keyup', (e) => this.codes.delete(e.code));
    window.addEventListener('blur', () => this.codes.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (this.pointer === 'touch') return; // made-up mouse event after a tap
      if (this.captureNext) {
        const fn = this.captureNext;
        this.captureNext = null;
        fn(`Mouse${e.button}`);
        return;
      }
      this.codes.add(`Mouse${e.button}`);
      this.setDevice('kbm');
      if (this.enabled && !this.locked) this.lock();
    });
    window.addEventListener('mouseup', (e) => this.codes.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.pointer === 'touch' || this.device === 'touch') {
        this.freeX = NaN;
        return;
      }
      let mx: number;
      let my: number;
      if (this.locked) {
        mx = e.movementX || 0;
        my = e.movementY || 0;
      } else {
        // The browser has not captured the mouse (it refused, cannot, or has not been clicked yet).
        // Turn anyway, from how far the visible cursor moved, so the player is never stuck.
        const px = this.freeX;
        const py = this.freeY;
        this.freeX = e.clientX;
        this.freeY = e.clientY;
        if (Number.isNaN(px)) return;
        mx = e.clientX - px;
        my = e.clientY - py;
      }
      const s = 0.0022 * store.settings.sens * this.lookScale;
      // Ignore the occasional huge spurious delta browsers emit when the lock engages.
      this.lookX += clamp(mx, -400, 400) * s;
      this.lookY += clamp(my, -400, 400) * s * (store.settings.invertY ? -1 : 1);
    });
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.pulse(e.deltaY > 0 ? 'next' : 'prev');
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.freeX = NaN;
      if (!this.locked) this.codes.clear();
      this.onLockChange(this.locked);
    });
  }

  /**
   * Asks the browser to capture the mouse. Browsers only grant this straight from a click or key
   * press, so it is one plain request with nothing to retry. Raw "unadjusted" input is deliberately
   * not requested: where it is unsupported the request fails and has to be repeated, and a repeated
   * request no longer counts as coming from the click, so the mouse would never be captured.
   * `throttled` spaces out speculative attempts (key presses) so a refusal is not hammered.
   */
  lock(throttled = false): void {
    if (!this.canvas || this.locked || this.device === 'touch') return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (throttled && now - this.lastLockTry < 1300) return;
    this.lastLockTry = now;
    try {
      const p = this.canvas.requestPointerLock() as Promise<void> | void;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
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
    if (down) this.setDevice('touch');
  }
  /** One-frame press (wheel, touch taps). */
  pulse(a: Action): void {
    this.pulses.add(a);
  }
  setTouchMove(x: number, y: number): void {
    this.touchMoveX = x;
    this.touchMoveY = y;
    if (x || y) this.setDevice('touch');
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
    // Keyboard turning (arrow keys by default), independent of the mouse.
    const kx = (this.down('lookRight') ? 1 : 0) - (this.down('lookLeft') ? 1 : 0);
    const ky = (this.down('lookDown') ? 1 : 0) - (this.down('lookUp') ? 1 : 0);
    if (this.enabled && (kx || ky)) {
      const rate = 2.2 * store.settings.sens * this.lookScale * dt;
      this.lookX += kx * rate;
      this.lookY += ky * rate * 0.6;
    }
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
    if (lx || ly || rx || ry) this.setDevice('pad');
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
      if (d) this.setDevice('pad');
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
