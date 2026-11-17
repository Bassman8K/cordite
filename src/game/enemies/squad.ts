import * as THREE from 'three';
import { store } from '../../core/settings';
import type { Game } from '../game';
import { Ally, type SquadMember } from './ally';

/** The two who go in with the player. Kestrel is the player; the squad are named for birds of prey too. */
export const SQUAD: SquadMember[] = [
  { callsign: 'MERLIN', type: 'ally', side: -1, actor: 'vo', voice: 0.9 },
  { callsign: 'SHRIKE', type: 'allygunner', side: 1, actor: 'vo2', voice: 1 },
];

/** The player's squad: owns its soldiers and keeps them beside the player. */
export class Squad {
  readonly group = new THREE.Group();
  list: Ally[] = [];

  constructor(private readonly game: Game) {
    this.group.name = 'squad';
  }

  /** Forms the squad up beside the player, at the start of a chapter or a checkpoint. */
  muster(): void {
    this.clear();
    if (!store.settings.squad) return;
    const p = this.game.player;
    for (const m of SQUAD) {
      const a = new Ally(this.game, m, p.pos.x, p.pos.y, p.pos.z, p.yaw);
      a.rejoin();
      this.list.push(a);
      this.group.add(a.mesh);
    }
  }

  update(dt: number): void {
    for (const a of this.list) a.update(dt);
  }

  clear(): void {
    for (const a of this.list) {
      this.group.remove(a.mesh);
      a.dispose();
    }
    this.list.length = 0;
  }
}
