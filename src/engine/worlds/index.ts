/**
 * The registry: one module per boss. game.ts and monsters.ts look a world
 * floor's module up here by `level.world.kind` and never import a module
 * directly.
 */
import type { WorldKind } from '../types';
import type { WorldModule } from './world';
import { GREECE } from './greece';
import { ARKHAM } from './arkham';
import { CEMETERY } from './cemetery';

export const WORLDS: Record<WorldKind, WorldModule> = {
  minotaur: GREECE,
  necromancer: ARKHAM,
  angels: CEMETERY,
};

export function worldFor(kind: WorldKind): WorldModule {
  return WORLDS[kind];
}

export type { WorldCtx, WorldModule } from './world';
