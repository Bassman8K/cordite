import { audio } from './core/audio';
import { Engine } from './core/engine';
import { input } from './core/input';
import { store } from './core/settings';
import { CHAPTERS } from './game/campaign';
import { Game } from './game/game';
import { WEAPONS } from './game/weapons/data';
import { platform } from './ui/platform';
import { UI } from './ui/ui';

declare const __APP_VERSION__: string;

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const engine = new Engine(canvas);
const game = new Game(engine);
input.attach(canvas);
const ui = new UI(game);

const params = new URLSearchParams(location.search);

/** Hooks for automated testing and the tester options. Harmless in normal play. */
const debug = {
  game,
  store,
  engine,
  input,
  ui,
  chapters: CHAPTERS,
  weapons: WEAPONS,
  version: __APP_VERSION__,
  start: (n = 1, fromCheckpoint = false) => game.startChapter(CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, n - 1))], fromCheckpoint),
  skip: () => game.mission?.skipStage(),
  god: (on = true) => store.set('god', on),
  tp: (x: number, z: number, y?: number) => game.player.pos.set(x, y ?? game.nav.heightAt(x, z), z),
  look: (yawDeg: number, pitchDeg = 0) => {
    game.player.yaw = (yawDeg * Math.PI) / 180;
    game.player.pitch = (pitchDeg * Math.PI) / 180;
  },
  state: () => ({
    state: game.state,
    chapter: game.chapter?.id,
    stage: game.mission?.stage?.id,
    stageI: game.mission?.stageI,
    pos: game.player.pos.toArray().map((v) => +v.toFixed(2)),
    health: Math.round(game.player.health),
    enemies: game.enemies.alive(), squad: game.squad.list.length,
    fighting: game.enemies.fighting,
    fps: Math.round(engine.fps),
    calls: engine.drawCalls,
    tris: engine.triangles,
    mem: engine.memory,
  }),
};
(window as unknown as { __cordite: typeof debug }).__cordite = debug;

const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

engine.start();
(document.getElementById('boot') as HTMLElement).classList.add('gone');
platform.registerServiceWorker();
const autoplay = params.get('play');
if (autoplay) void debug.start(parseInt(autoplay, 10) || 1);
else {
  // Menus sit over a live view of the next chapter to play.
  const next = CHAPTERS.find((c) => c.id === store.progress.checkpoint?.chapter) ?? CHAPTERS.find((c) => !store.progress.chapters[c.id]?.done) ?? CHAPTERS[0];
  ui.home('title');
  void game.loadBackdrop(next);
}
