// Interface manager: owns the HUD, the menu screens and the transitions between them.

import '@fontsource-variable/oxanium/wght.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './styles.css';

import { audio } from '../core/audio';
import { input } from '../core/input';
import { IS_TOUCH, store } from '../core/settings';
import type { ChapterDef } from '../game/campaign/types';
import type { Game, GameState } from '../game/game';
import { armoryScreen } from './armory';
import { el } from './dom';
import { Hud } from './hud';
import { platform } from './platform';
import { campaignScreen, completeScreen, creditsScreen, deadScreen, loadingScreen, pauseScreen, titleScreen } from './screens';
import { settingsScreen } from './settings';
import { Showroom } from './showroom';
import { TouchControls } from './touch';

export type ScreenName = 'title' | 'campaign' | 'armory' | 'settings' | 'pause' | 'dead' | 'failed' | 'complete' | 'credits' | 'loading';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = (ui: UI, opts: any) => HTMLElement;

const BUILDERS: Record<ScreenName, Builder> = {
  title: titleScreen,
  campaign: campaignScreen,
  armory: armoryScreen,
  settings: settingsScreen,
  pause: pauseScreen,
  dead: deadScreen,
  failed: deadScreen,
  complete: completeScreen,
  credits: creditsScreen,
  loading: loadingScreen,
};

interface Entry {
  name: ScreenName;
  opts: unknown;
}

export class UI {
  readonly root: HTMLElement;
  readonly hud: Hud;
  readonly touch: TouchControls;
  readonly showroom: Showroom;
  private layer: HTMLElement;
  private fade: HTMLElement;
  private stack: Entry[] = [];
  private current: HTMLElement | null = null;
  private leave: Array<() => void> = [];
  private stateTimer = 0;
  /** Loading-screen progress bar (set while a chapter builds). */
  progress: ((label: string, f: number) => void) | null = null;

  constructor(readonly game: Game) {
    this.root = document.getElementById('ui') as HTMLElement;
    const grain = el('div');
    grain.id = 'grain';
    this.root.append(grain);
    this.hud = new Hud(this.root, game);
    this.layer = el('div');
    this.layer.id = 'screens';
    this.root.append(this.layer);
    this.touch = new TouchControls(this.root, game);
    const rotate = el('div', '', '<div><div class="label a">Rotate your device</div><p class="tip">CORDITE plays in landscape.</p></div>');
    rotate.id = 'rotate';
    this.fade = el('div');
    this.fade.id = 'fade';
    this.root.append(rotate, this.fade);
    this.showroom = new Showroom(game.engine);

    game.onState = (s) => this.onState(s);
    game.onArmory = () => {
      game.pause();
      this.home('armory', { inGame: true, resume: true });
    };
    game.onProgress = (label, f) => this.progress?.(label, f);

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.current || input.captureNext) return;
      e.preventDefault();
      const top = this.stack[this.stack.length - 1];
      if (!top) return;
      if (top.name === 'pause') this.resume();
      else if (this.stack.length > 1) this.back();
      else if (top.name === 'armory' && (top.opts as { resume?: boolean } | undefined)?.resume) this.resume();
    });
    // Frame hook for the HUD.
    const prev = game.engine.onFrame;
    game.engine.onFrame = (dt) => {
      prev(dt);
      if (!this.hud.root.hidden) this.hud.update(dt);
    };
  }

  // ------------------------------------------------------------------ navigation

  /** Registers cleanup to run when the current screen goes away. */
  onLeave(fn: () => void): void {
    this.leave.push(fn);
  }

  private render(): void {
    for (const fn of this.leave.splice(0)) fn();
    const old = this.current;
    if (old) {
      old.classList.add('out');
      setTimeout(() => old.remove(), 230);
    }
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.current = null;
      this.showroom.close();
      return;
    }
    if (top.name !== 'armory') this.showroom.close();
    const node = BUILDERS[top.name](this, top.opts ?? {});
    this.current = node;
    this.layer.append(node);
    (node.querySelector('[autofocus]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  go(name: ScreenName, opts?: unknown): void {
    this.stack.push({ name, opts });
    this.render();
  }
  back(): void {
    if (this.stack.length <= 1) return;
    audio.uiPlay('uiBack', 0.7);
    this.stack.pop();
    this.render();
  }
  /** Replaces the whole stack. */
  home(name: ScreenName, opts?: unknown): void {
    this.stack = [{ name, opts }];
    this.render();
  }
  clear(): void {
    this.stack = [];
    this.render();
  }
  get top(): ScreenName | null {
    return this.stack.length ? this.stack[this.stack.length - 1].name : null;
  }
  /** True when a mission is running behind the menus. */
  get inGame(): boolean {
    return this.game.state === 'paused';
  }

  // ------------------------------------------------------------------ flow helpers used by screens

  async startChapter(def: ChapterDef, fromCheckpoint: boolean): Promise<void> {
    audio.unlock();
    audio.uiPlay('uiConfirm', 0.9);
    platform.immerse();
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 380));
    this.home('loading', { chapter: def });
    this.fade.classList.remove('on');
    await this.game.startChapter(def, fromCheckpoint);
  }

  resume(): void {
    this.game.resume();
  }

  async quitToMenu(): Promise<void> {
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 350));
    await this.game.quitToMenu();
    this.fade.classList.remove('on');
  }

  private onState(s: GameState): void {
    clearTimeout(this.stateTimer);
    const playing = s === 'playing';
    this.hud.show(playing || s === 'dead');
    this.touch.show(playing && (IS_TOUCH || input.device === 'touch'));
    if (playing) {
      this.clear();
      if (!IS_TOUCH) input.lock();
    } else if (s === 'paused') {
      if (this.top !== 'armory') this.home('pause');
    } else if (s === 'dead') {
      this.stateTimer = window.setTimeout(() => {
        if (this.game.state === 'dead') {
          this.hud.show(false);
          this.home('dead', { reason: '' });
        }
      }, 1500);
    } else if (s === 'failed') {
      this.stateTimer = window.setTimeout(() => this.home('failed', { reason: this.game.failReason }), 700);
    } else if (s === 'complete') {
      this.home('complete');
    } else if (s === 'menu') {
      if (!this.top || this.top === 'loading' || this.top === 'pause' || this.top === 'dead' || this.top === 'failed' || this.top === 'complete') this.home('title');
    }
    void store;
  }
}
