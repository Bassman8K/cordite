// Looking around must always work on a computer: with the mouse captured, with the capture refused
// by the browser, and from the keyboard alone.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (e: Record<string, unknown>) => void;
class FakeTarget {
  private handlers = new Map<string, Handler[]>();
  addEventListener(type: string, fn: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  dispatch(type: string, e: Record<string, unknown> = {}): void {
    for (const fn of this.handlers.get(type) ?? []) fn({ preventDefault() {}, ...e });
  }
}

const win = new FakeTarget();
const doc = Object.assign(new FakeTarget(), { pointerLockElement: null as unknown, exitPointerLock: vi.fn() });
const requestPointerLock = vi.fn((..._args: unknown[]) => Promise.reject(new Error('NotAllowedError')));
const canvas = Object.assign(new FakeTarget(), { requestPointerLock });
vi.stubGlobal('window', win);
vi.stubGlobal('document', doc);

const { input } = await import('../src/core/input');
const { DEFAULT_BINDS, store, withoutLookKeysOnMovement } = await import('../src/core/settings');

const look = { x: 0, y: 0 };
const takeLook = () => {
  input.consumeLook(look);
  return { ...look };
};
const setLocked = (on: boolean) => {
  doc.pointerLockElement = on ? canvas : null;
  doc.dispatch('pointerlockchange');
};

beforeAll(() => {
  input.attach(canvas as unknown as HTMLElement);
});

beforeEach(() => {
  setLocked(false);
  input.reset();
  input.enabled = true;
  win.dispatch('pointerdown', { type: 'pointerdown', pointerType: 'mouse' });
  input.device = 'kbm';
  input.lookScale = 1;
  requestPointerLock.mockClear();
  win.dispatch('mousemove', { clientX: 400, clientY: 300, movementX: 0, movementY: 0 });
  takeLook();
});

describe('capturing the mouse', () => {
  it('asks for a plain pointer lock, once, inside the click', () => {
    canvas.dispatch('mousedown', { button: 0 });
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
    // No options: raw-input mode needs a second, later request when it is unsupported, and browsers
    // refuse a capture request that no longer comes straight from the click.
    expect(requestPointerLock.mock.calls[0]).toHaveLength(0);
  });

  it('does not ask again while the mouse is already captured', () => {
    setLocked(true);
    canvas.dispatch('mousedown', { button: 0 });
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it('survives a browser without the promise form of the request', () => {
    requestPointerLock.mockImplementationOnce(() => undefined as unknown as Promise<never>);
    expect(() => canvas.dispatch('mousedown', { button: 0 })).not.toThrow();
  });
});

describe('turning with the mouse', () => {
  it('uses movement deltas while the mouse is captured', () => {
    setLocked(true);
    win.dispatch('mousemove', { movementX: 50, movementY: -20, clientX: 400, clientY: 300 });
    const l = takeLook();
    expect(l.x).toBeCloseTo(50 * 0.0022 * store.settings.sens, 6);
    expect(l.y).toBeCloseTo(-20 * 0.0022 * store.settings.sens, 6);
  });

  it('still turns when the browser refuses to capture the mouse', () => {
    expect(input.locked).toBe(false);
    win.dispatch('mousemove', { clientX: 460, clientY: 300, movementX: 0, movementY: 0 });
    expect(takeLook().x).toBeGreaterThan(0);
    win.dispatch('mousemove', { clientX: 430, clientY: 330, movementX: 0, movementY: 0 });
    const back = takeLook();
    expect(back.x).toBeLessThan(0);
    expect(back.y).toBeGreaterThan(0);
  });

  it('ignores the first movement after the mouse is released, so the view does not jump', () => {
    setLocked(true);
    setLocked(false);
    win.dispatch('mousemove', { clientX: 900, clientY: 50, movementX: 0, movementY: 0 });
    expect(takeLook()).toEqual({ x: 0, y: 0 });
  });

  it('does nothing while a menu is open', () => {
    input.enabled = false;
    win.dispatch('mousemove', { clientX: 700, clientY: 300, movementX: 30, movementY: 0 });
    expect(takeLook()).toEqual({ x: 0, y: 0 });
  });

  it('leaves the view alone when a touch screen is in use', () => {
    input.device = 'touch';
    win.dispatch('mousemove', { clientX: 700, clientY: 300, movementX: 0, movementY: 0 });
    expect(takeLook()).toEqual({ x: 0, y: 0 });
  });
});

describe('touch screens and mice on the same device', () => {
  const touchDown = () => win.dispatch('pointerdown', { type: 'pointerdown', pointerType: 'touch' });
  const mouseMoved = (dx: number) => win.dispatch('pointermove', { type: 'pointermove', pointerType: 'mouse', movementX: dx, movementY: 0 });

  it('ignores the mouse events a browser synthesises after a touch', () => {
    touchDown();
    expect(input.device).toBe('touch');
    win.dispatch('mousemove', { clientX: 200, clientY: 200, movementX: 0, movementY: 0 });
    win.dispatch('mousemove', { clientX: 500, clientY: 260, movementX: 0, movementY: 0 });
    expect(takeLook()).toEqual({ x: 0, y: 0 });
    canvas.dispatch('mousedown', { button: 0 });
    expect(requestPointerLock).not.toHaveBeenCalled();
    expect(input.device).toBe('touch');
    input.update(0.016);
    expect(input.down('fire')).toBe(false);
  });

  it('hands over to a real mouse as soon as one is moved', () => {
    touchDown();
    mouseMoved(9);
    expect(input.device).toBe('kbm');
    win.dispatch('mousemove', { clientX: 300, clientY: 300, movementX: 0, movementY: 0 });
    win.dispatch('mousemove', { clientX: 340, clientY: 300, movementX: 0, movementY: 0 });
    expect(takeLook().x).toBeGreaterThan(0);
    canvas.dispatch('mousedown', { button: 0 });
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('does not let a nudge of the mouse take over from touch', () => {
    touchDown();
    mouseMoved(1);
    expect(input.device).toBe('touch');
  });

  it('tells the interface when the device in use changes', () => {
    const seen: string[] = [];
    input.onDeviceChange = (d) => seen.push(d);
    touchDown();
    mouseMoved(9);
    touchDown();
    input.onDeviceChange = () => {};
    expect(seen).toEqual(['touch', 'kbm', 'touch']);
  });
});

describe('turning with the keyboard', () => {
  const hold = (code: string) => win.dispatch('keydown', { code, repeat: false });
  const release = (code: string) => win.dispatch('keyup', { code });

  it('turns right and left with the arrow keys', () => {
    hold('ArrowRight');
    input.update(0.1);
    expect(takeLook().x).toBeGreaterThan(0);
    release('ArrowRight');
    hold('ArrowLeft');
    input.update(0.1);
    expect(takeLook().x).toBeLessThan(0);
    release('ArrowLeft');
  });

  it('looks up and down with the arrow keys', () => {
    hold('ArrowUp');
    input.update(0.1);
    expect(takeLook().y).toBeLessThan(0);
    release('ArrowUp');
    hold('ArrowDown');
    input.update(0.1);
    expect(takeLook().y).toBeGreaterThan(0);
    release('ArrowDown');
  });

  it('keeps the arrow keys for looking only', () => {
    hold('ArrowUp');
    input.update(0.1);
    expect(input.moveY).toBe(0);
    release('ArrowUp');
    hold('KeyW');
    input.update(0.1);
    expect(input.moveY).toBe(1);
    release('KeyW');
  });
});

describe('key bindings saved by an older version', () => {
  it('lose the arrow keys from movement so they can turn the view', () => {
    const old = structuredClone(DEFAULT_BINDS);
    old.forward = ['KeyW', 'ArrowUp'];
    old.back = ['KeyS', 'ArrowDown'];
    old.left = ['KeyA', 'ArrowLeft'];
    old.right = ['KeyD', 'ArrowRight'];
    const fixed = withoutLookKeysOnMovement(old);
    expect(fixed.forward).toEqual(['KeyW']);
    expect(fixed.back).toEqual(['KeyS']);
    expect(fixed.left).toEqual(['KeyA']);
    expect(fixed.right).toEqual(['KeyD']);
  });

  it('never leave a movement action with no key at all', () => {
    const old = structuredClone(DEFAULT_BINDS);
    old.forward = ['ArrowUp'];
    expect(withoutLookKeysOnMovement(old).forward).toEqual(['ArrowUp']);
  });
});
