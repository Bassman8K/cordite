// Minimal typed event bus used to decouple gameplay from the HUD / menus.

export interface GameEvents {
  damage: { amount: number; angle: number; kind: string };
  hit: { kill: boolean; head: boolean; dist: number };
  ammo: void;
  weapon: void;
  objective: { text: string; note: string; done?: boolean };
  /** A line of dialogue. `seconds` is how long it takes to say, when it is spoken aloud. */
  radio: { who: string; text: string; seconds?: number };
  toast: { text: string; kind: 'info' | 'checkpoint' | 'pickup' | 'warn' };
  prompt: { text: string; progress: number } | null;
  state: string;
  timer: { label: string; seconds: number } | null;
  grenade: { angle: number; dist: number } | null;
  blind: number;
  reload: number;
}

type Handler<T> = (payload: T) => void;

export class Emitter<E> {
  private map = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<E[K]>)(payload);
  }
}
