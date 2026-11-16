// In-game heads-up display. DOM is only touched when a value actually changes.

import * as THREE from 'three';
import { clamp, DEG, formatTime, wrapAngle } from '../core/math';
import { input } from '../core/input';
import { store } from '../core/settings';
import type { Game } from '../game/game';
import { weaponIcon } from '../gfx/icons';
import { actionKey, el, esc, q } from './dom';

const CARDINALS: Array<[number, string]> = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];

export class Hud {
  readonly root: HTMLElement;
  private obj: HTMLElement;
  private objT: HTMLElement;
  private objN: HTMLElement;
  private hp: HTMLElement;
  private bars: HTMLElement[];
  private armor: HTMLElement;
  private kits: HTMLElement;
  private stance: HTMLElement;
  private wIcon: HTMLImageElement;
  private mag: HTMLElement;
  private res: HTMLElement;
  private wName: HTMLElement;
  private wMode: HTMLElement;
  private wThrown: HTMLElement;
  private reload: HTMLElement;
  private reloadBar: HTMLElement;
  private cross: HTMLElement;
  private hit: HTMLElement;
  private killTx: HTMLElement;
  private prompt: HTMLElement;
  private promptKey: HTMLElement;
  private promptTx: HTMLElement;
  private promptBar: HTMLElement;
  private sub: HTMLElement;
  private toasts: HTMLElement;
  private dmg: HTMLElement;
  private vig: HTMLElement;
  private blind: HTMLElement;
  private scope: HTMLElement;
  private mark: HTMLElement;
  private markTx: HTMLElement;
  private gren: HTMLElement;
  private fps: HTMLElement;
  private timer: HTMLElement;
  private timerB: HTMLElement;
  private timerL: HTMLElement;
  private threat: HTMLElement;
  private compass: HTMLCanvasElement;
  private radar: HTMLCanvasElement;
  private radarWrap: HTMLElement;
  private cache: Record<string, string | number | boolean> = {};
  private subT = 0;
  private v = new THREE.Vector3();
  private frame = 0;
  private pulse = 0;
  private blindAmt = 0;

  constructor(parent: HTMLElement, private readonly game: Game) {
    const r = (this.root = el('div'));
    r.id = 'hud';
    r.hidden = true;
    r.innerHTML = `
      <div class="h-vig"></div>
      <div class="h-scope"><i></i></div>
      <div class="h-blind"></div>
      <div class="h-obj sh"><div class="label">Objective</div><div class="t"></div><div class="nt"></div></div>
      <div class="h-compass"><canvas></canvas></div>
      <div class="h-threat sh"></div>
      <div class="h-timer" hidden><span class="label"></span><b></b></div>
      <div class="h-radar"><canvas></canvas></div>
      <div class="h-toasts"></div>
      <div class="h-mark sh" hidden><i></i><span></span></div>
      <div class="h-dmg"></div>
      <div class="h-gren" hidden><i>!</i></div>
      <div class="h-cross"><i class="l"></i><i class="r"></i><i class="u"></i><i class="d"></i><i class="c"></i></div>
      <div class="h-hit"></div>
      <div class="h-kill sh"></div>
      <div class="h-prompt sh" hidden><span class="key"></span><span class="tx"></span><i></i></div>
      <div class="h-sub"></div>
      <div class="h-vitals sh">
        <div class="h-hp"><b>100</b><span class="label">Health</span></div>
        <div class="h-bar"><i></i><i></i><i></i><i></i></div>
        <div class="h-armor"><i></i></div>
        <div class="h-kit"><span>Medkit <b class="kits">2</b></span><span class="stance">Standing</span></div>
      </div>
      <div class="h-weapon sh">
        <img alt="" />
        <div class="h-ammo"><b class="mag">30</b><span>/</span><span class="res">180</span></div>
        <div class="h-wname"></div>
        <div class="h-wmeta"><span class="mode"></span><span class="thrown"></span></div>
        <div class="h-reload"><i></i></div>
      </div>
      <div class="h-fps"></div>`;
    parent.append(r);
    this.obj = q(r, '.h-obj');
    this.objT = q(r, '.h-obj .t');
    this.objN = q(r, '.h-obj .nt');
    this.hp = q(r, '.h-hp b');
    this.bars = Array.from(r.querySelectorAll<HTMLElement>('.h-bar i'));
    this.armor = q(r, '.h-armor i');
    this.kits = q(r, '.kits');
    this.stance = q(r, '.stance');
    this.wIcon = q<HTMLImageElement>(r, '.h-weapon img');
    this.mag = q(r, '.mag');
    this.res = q(r, '.res');
    this.wName = q(r, '.h-wname');
    this.wMode = q(r, '.mode');
    this.wThrown = q(r, '.thrown');
    this.reload = q(r, '.h-reload');
    this.reloadBar = q(r, '.h-reload i');
    this.cross = q(r, '.h-cross');
    this.hit = q(r, '.h-hit');
    this.killTx = q(r, '.h-kill');
    this.prompt = q(r, '.h-prompt');
    this.promptKey = q(r, '.h-prompt .key');
    this.promptTx = q(r, '.h-prompt .tx');
    this.promptBar = q(r, '.h-prompt i');
    this.sub = q(r, '.h-sub');
    this.toasts = q(r, '.h-toasts');
    this.dmg = q(r, '.h-dmg');
    this.vig = q(r, '.h-vig');
    this.blind = q(r, '.h-blind');
    this.scope = q(r, '.h-scope');
    this.mark = q(r, '.h-mark');
    this.markTx = q(r, '.h-mark span');
    this.gren = q(r, '.h-gren');
    this.fps = q(r, '.h-fps');
    this.timer = q(r, '.h-timer');
    this.timerL = q(r, '.h-timer .label');
    this.timerB = q(r, '.h-timer b');
    this.threat = q(r, '.h-threat');
    this.compass = q<HTMLCanvasElement>(r, '.h-compass canvas');
    this.radar = q<HTMLCanvasElement>(r, '.h-radar canvas');
    this.radarWrap = q(r, '.h-radar');
    this.bind();
  }

  private bind(): void {
    const ev = this.game.events;
    ev.on('objective', (o) => {
      this.objT.textContent = o.done ? 'Chapter complete' : o.text;
      this.objN.textContent = o.note;
      if (this.cache.objText !== o.text) {
        this.cache.objText = o.text;
        this.obj.classList.remove('flash');
        void this.obj.offsetWidth;
        this.obj.classList.add('flash');
      }
    });
    ev.on('weapon', () => this.refreshWeapon());
    ev.on('hit', (h) => {
      this.hit.classList.remove('on', 'kill');
      void this.hit.offsetWidth;
      this.hit.classList.add('on');
      if (h.kill) this.hit.classList.add('kill');
      this.game.audio.uiPlay(h.kill ? 'killmark' : 'hitmark', h.kill ? 0.75 : 0.5);
      if (h.kill) {
        this.killTx.textContent = h.head ? (h.dist > 60 ? `Headshot · ${Math.round(h.dist)} m` : 'Headshot') : h.dist > 90 ? `Enemy down · ${Math.round(h.dist)} m` : 'Enemy down';
        this.killTx.classList.remove('on');
        void this.killTx.offsetWidth;
        this.killTx.classList.add('on');
      }
    });
    ev.on('damage', (d) => {
      if (d.kind === 'fall') return;
      const i = el('i');
      i.style.transform = `rotate(${(-d.angle / DEG).toFixed(1)}deg)`;
      this.dmg.append(i);
      setTimeout(() => i.remove(), 1300);
      while (this.dmg.childElementCount > 5) this.dmg.firstElementChild?.remove();
    });
    ev.on('radio', (l) => {
      if (!store.settings.subtitles) return;
      this.sub.innerHTML = `<b>${esc(l.who)}</b>${esc(l.text)}`;
      this.sub.classList.add('on');
      this.subT = 2.4 + l.text.length * 0.05;
    });
    ev.on('toast', (t) => {
      const d = el('div', `h-toast ${t.kind}`);
      d.textContent = t.text;
      this.toasts.append(d);
      setTimeout(() => d.remove(), 2800);
      while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    });
    ev.on('prompt', (p) => {
      if (!p) {
        if (!this.prompt.hidden) this.prompt.hidden = true;
        return;
      }
      this.prompt.hidden = false;
      const key = actionKey('interact');
      if (this.cache.pk !== key) {
        this.cache.pk = key;
        this.promptKey.textContent = key;
      }
      if (this.cache.pt !== p.text) {
        this.cache.pt = p.text;
        this.promptTx.textContent = `Hold · ${p.text}`;
      }
      this.promptBar.style.width = `${(p.progress * 100).toFixed(1)}%`;
    });
    ev.on('timer', (t) => {
      this.timer.hidden = !t;
      if (t) {
        this.timerL.textContent = t.label;
        this.timerB.textContent = formatTime(Math.ceil(t.seconds));
      }
    });
    ev.on('grenade', (g) => {
      this.gren.hidden = !g;
      if (g) this.gren.style.transform = `rotate(${(-g.angle / DEG).toFixed(1)}deg)`;
    });
    ev.on('blind', (b) => {
      this.blindAmt = Math.max(this.blindAmt, b);
    });
  }

  show(v: boolean): void {
    this.root.hidden = !v;
    if (v) {
      this.cache = {};
      this.refreshWeapon();
    }
  }

  private refreshWeapon(): void {
    const w = this.game.weapons;
    if (!w.gun) return;
    const d = w.gun.def;
    this.wIcon.src = weaponIcon(this.game.engine.renderer, d, 384, 128, true);
    this.wName.textContent = d.name;
    this.cache.mag = -1;
  }

  private set(key: string, value: string | number | boolean, fn: () => void): void {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn();
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    const w = g.weapons;
    const s = store.settings;
    this.frame++;
    const realist = s.difficulty === 'realist';

    // ---- vitals
    const hp = Math.ceil(p.health);
    this.set('hp', hp, () => {
      this.hp.textContent = String(hp);
      const col = hp <= 30 ? '#ff4d3d' : '#e9edf0';
      for (let i = 0; i < 4; i++) {
        const f = clamp((p.health - i * 25) / 25, 0, 1) * 100;
        this.bars[i].style.setProperty('--f', `${f.toFixed(0)}%`);
        this.bars[i].style.setProperty('--hc', col);
      }
      this.hp.style.color = hp <= 30 ? '#ff4d3d' : '';
    });
    this.set('armor', Math.round(p.armor), () => (this.armor.style.width = `${p.armor}%`));
    this.set('kits', p.medkits, () => (this.kits.textContent = String(p.medkits)));
    const st = p.healing > 0 ? 'Treating wounds' : p.crouched ? 'Crouched' : p.sprinting ? 'Sprinting' : 'Standing';
    this.set('stance', st, () => (this.stance.textContent = st));

    // ---- weapon
    const gun = w.gun;
    if (gun) {
      this.set('mag', gun.mag, () => {
        this.mag.textContent = String(gun.mag);
        this.mag.classList.toggle('low', gun.mag <= Math.max(1, gun.def.mag * 0.25));
      });
      this.set('res', gun.reserve, () => (this.res.textContent = String(gun.reserve)));
      this.set('mode', w.modeLabel, () => (this.wMode.innerHTML = `<b>${w.modeLabel}</b>`));
      const th = `${w.thrown.name.split(' ')[0]} × ${w.thrownCount}`;
      this.set('thrown', th, () => (this.wThrown.textContent = th));
      const rp = w.reloadProgress;
      this.set('rl', rp >= 0, () => this.reload.classList.toggle('on', rp >= 0));
      if (rp >= 0) this.reloadBar.style.width = `${(rp * 100).toFixed(0)}%`;
    }

    // ---- crosshair / scope
    const scoped = w.scoped;
    const sb = Math.round(w.scopeBlend * 20) / 20;
    this.set('scope', sb, () => (this.scope.style.opacity = String(sb)));
    const showCross = s.crosshair && !realist && p.alive && w.ads < 0.55 && !p.sprinting && !scoped && !w.isBusy;
    this.set('cross', showCross, () => (this.cross.style.opacity = showCross ? '1' : '0'));
    if (showCross) {
      const cam = g.engine.camera;
      const px = (Math.tan(w.spread * DEG) / Math.tan((cam.fov * DEG) / 2)) * (g.engine.height / 2);
      const gap = Math.round(clamp(px, 3, 90));
      this.set('gap', gap, () => this.cross.style.setProperty('--g', `${gap}px`));
    }

    // ---- damage vignette, flash blindness
    this.pulse += dt;
    const low = p.alive && p.health < 35 ? (1 - p.health / 35) * (0.55 + 0.25 * Math.sin(this.pulse * 5)) : 0;
    const vig = clamp(g.hurtAmount * 0.95 + low, 0, 1);
    this.set('vig', Math.round(vig * 40), () => (this.vig.style.opacity = vig.toFixed(2)));
    this.blindAmt = Math.max(0, Math.min(this.blindAmt, p.blind));
    const bl = clamp(this.blindAmt / 1.6, 0, 1);
    this.set('blind', Math.round(bl * 30), () => (this.blind.style.opacity = bl.toFixed(2)));
    if (p.blind <= 0) this.blindAmt = 0;

    // ---- subtitles
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.sub.classList.remove('on');
    }

    // ---- threat state
    const th = g.enemies.fighting > 0 ? 'hot' : g.enemies.suspicious > 0 ? 'sus' : '';
    this.set('threat', th, () => {
      this.threat.className = `h-threat sh ${th}`;
      this.threat.textContent = th === 'hot' ? 'Contact' : th === 'sus' ? 'Suspicious' : '';
    });

    // ---- objective marker
    const m = g.mission;
    const cam = g.engine.camera;
    let bearing = NaN;
    if (m && m.markerPos(this.v) && p.alive) {
      const dist = Math.hypot(this.v.x - p.pos.x, this.v.z - p.pos.z);
      bearing = Math.atan2(this.v.x - p.pos.x, -(this.v.z - p.pos.z));
      const W = g.engine.width;
      const H = g.engine.height;
      this.v.project(cam);
      let x = this.v.x;
      let y = this.v.y;
      if (this.v.z > 1) {
        // Behind the camera: push it to the nearest screen edge.
        x = -x;
        y = -1;
        const k = 1 / Math.max(Math.abs(x), 1e-3);
        if (Math.abs(x) > 1) x *= k;
      }
      x = clamp(x, -0.92, 0.92);
      y = clamp(y, -0.86, 0.8);
      this.mark.hidden = dist < 2.5;
      this.mark.style.transform = `translate(${((x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -50%)`;
      const d = `${Math.round(dist)} m`;
      this.set('md', d, () => (this.markTx.textContent = d));
    } else if (!this.mark.hidden) this.mark.hidden = true;

    if (this.frame % 2 === 0) this.drawCompass(bearing);
    const radarOn = s.radar && !realist;
    this.set('radar', radarOn, () => (this.radarWrap.hidden = !radarOn));
    if (radarOn && this.frame % 3 === 0) this.drawRadar(bearing);

    this.set('fpsOn', s.showFps, () => (this.fps.hidden = !s.showFps));
    if (s.showFps && this.frame % 20 === 0) {
      const e = g.engine;
      this.fps.textContent = `${Math.round(e.fps)} FPS · ${e.frameMs.toFixed(1)} MS · ${e.drawCalls} DRAWS · ${(e.triangles / 1000).toFixed(0)}K TRIS`;
    }
    void input;
  }

  private sizeCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c.getContext('2d') as CanvasRenderingContext2D;
  }

  private drawCompass(markBearing: number): void {
    const c = this.compass;
    const ctx = this.sizeCanvas(c);
    const W = c.width;
    const H = c.height;
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    // Heading in compass degrees (north = the level's -Z).
    const heading = ((-this.game.player.yaw / DEG) % 360 + 360) % 360;
    const span = 70;
    const k = W / 2 / span;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let a = 0; a < 360; a += 5) {
      const d = wrapAngle((a - heading) * DEG) / DEG;
      if (Math.abs(d) > span) continue;
      const x = W / 2 + d * k;
      const edge = 1 - Math.pow(Math.abs(d) / span, 3);
      const major = a % 45 === 0;
      const mid = a % 15 === 0;
      ctx.fillStyle = `rgba(233,237,240,${(major ? 0.95 : mid ? 0.6 : 0.3) * edge})`;
      ctx.fillRect(Math.round(x), H * 0.62, major ? 2 : 1, H * (major ? 0.34 : mid ? 0.22 : 0.12));
      if (major) {
        const name = CARDINALS.find((cd) => cd[0] === a)?.[1] ?? '';
        ctx.font = `${name.length === 1 ? 700 : 500} ${Math.round(H * (name.length === 1 ? 0.46 : 0.34))}px 'Oxanium Variable', sans-serif`;
        ctx.fillStyle = `rgba(${name === 'N' ? '255,178,46' : '233,237,240'},${edge})`;
        ctx.fillText(name, x, H * (name.length === 1 ? 0.04 : 0.14));
      }
    }
    ctx.fillStyle = '#ffb22e';
    ctx.beginPath();
    ctx.moveTo(W / 2 - H * 0.14, H);
    ctx.lineTo(W / 2 + H * 0.14, H);
    ctx.lineTo(W / 2, H * 0.74);
    ctx.fill();
    if (!Number.isNaN(markBearing)) {
      const d = clamp(wrapAngle(markBearing - heading * DEG) / DEG, -span, span);
      const x = W / 2 + d * k;
      ctx.fillStyle = '#5fdccb';
      ctx.beginPath();
      ctx.moveTo(x, H * 0.5);
      ctx.lineTo(x + H * 0.16, H * 0.72);
      ctx.lineTo(x, H * 0.94);
      ctx.lineTo(x - H * 0.16, H * 0.72);
      ctx.fill();
    }
  }

  private drawRadar(markBearing: number): void {
    const c = this.radar;
    const ctx = this.sizeCanvas(c);
    const S = c.width;
    if (!S) return;
    const g = this.game;
    const p = g.player;
    const R = S / 2 - 2;
    const cx = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(6,9,12,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cx, R, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    for (const f of [1, 0.5]) {
      ctx.beginPath();
      ctx.arc(cx, cx, R * f, 0, 6.283);
      ctx.stroke();
    }
    // View cone
    const half = (g.engine.camera.fov * DEG * g.engine.camera.aspect) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(cx, cx);
    ctx.arc(cx, cx, R, -Math.PI / 2 - half * 0.6, -Math.PI / 2 + half * 0.6);
    ctx.fill();
    const range = 45;
    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    for (const e of g.enemies.list) {
      if (!e.alive || e.state === 'idle' || e.state === 'patrol') continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      let rx = (dx * cos - dz * sin) / range;
      let rf = (-dx * sin - dz * cos) / range;
      const l = Math.hypot(rx, rf);
      if (l > 1) {
        rx /= l;
        rf /= l;
      }
      ctx.fillStyle = e.state === 'combat' ? (l > 1 ? 'rgba(255,77,61,0.5)' : '#ff4d3d') : '#ffb22e';
      ctx.beginPath();
      ctx.arc(cx + rx * R * 0.94, cx - rf * R * 0.94, S * 0.028, 0, 6.283);
      ctx.fill();
    }
    if (!Number.isNaN(markBearing)) {
      const a = markBearing + p.yaw;
      ctx.fillStyle = '#5fdccb';
      ctx.beginPath();
      ctx.arc(cx + Math.sin(a) * R * 0.94, cx - Math.cos(a) * R * 0.94, S * 0.03, 0, 6.283);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx, cx - S * 0.06);
    ctx.lineTo(cx + S * 0.04, cx + S * 0.045);
    ctx.lineTo(cx - S * 0.04, cx + S * 0.045);
    ctx.fill();
  }
}
