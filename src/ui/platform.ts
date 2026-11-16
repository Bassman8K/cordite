// Where are we running? The same web build ships inside Electron (desktop), Capacitor (Android /
// iOS) and as an installable web app.

import { IS_TOUCH } from '../core/settings';

interface DesktopBridge {
  desktop: boolean;
  quit(): void;
  fullscreen(): void;
}
const bridge = (window as unknown as { cordite?: DesktopBridge }).cordite;

export const platform = {
  desktop: !!bridge?.desktop,
  native: !!(window as unknown as { Capacitor?: unknown }).Capacitor,
  touch: IS_TOUCH,
  get installed(): boolean {
    return this.desktop || this.native || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  },
  quit(): void {
    bridge?.quit();
  },
  toggleFullscreen(): void {
    if (bridge) bridge.fullscreen();
    else if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  },
  /** Phones: go full screen and landscape when a mission starts (best effort; iOS ignores both). */
  immerse(): void {
    if (!IS_TOUCH || bridge) return;
    const root = document.documentElement;
    const lock = () => (screen.orientation as unknown as { lock?(o: string): Promise<void> }).lock?.('landscape').catch(() => {});
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().then(lock, () => {});
    else void lock();
  },
  registerServiceWorker(): void {
    if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:' && !bridge && !this.native) {
      window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }
  },
};
