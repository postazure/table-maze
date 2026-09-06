/**
 * The worlds' art, merged. `WORLD_PROP_ART` is what the renderer draws a
 * `Prop` with (by `Prop.art`, then `Prop.art + ':' + Prop.state` when that
 * exists); `WORLD_MONSTER_CFGS` is folded into `MONSTER_CFGS` here at import
 * time so the renderer builds their sprites with everyone else's; and
 * `WORLD_DEFEAT_ART` is the game-over scene per world.
 */
import type { WorldKind } from '../../engine/types';
import type { ArtSpec } from '../itemArt';
import { MONSTER_CFGS } from '../monsterArt';
import * as greece from './greeceArt';
import * as arkham from './arkhamArt';
import * as cemetery from './cemeteryArt';

export const WORLD_PROP_ART: Record<string, ArtSpec> = {
  ...greece.PROP_ART,
  ...arkham.PROP_ART,
  ...cemetery.PROP_ART,
};

export const WORLD_DEFEAT_ART: Record<WorldKind, ArtSpec> = {
  minotaur: greece.DEFEAT_ART,
  necromancer: arkham.DEFEAT_ART,
  angels: cemetery.DEFEAT_ART,
};

Object.assign(MONSTER_CFGS, greece.MONSTER_CFGS, arkham.MONSTER_CFGS, cemetery.MONSTER_CFGS);

/** Art for a prop: the state variant when the table has one, else the base. */
export function propArt(art: string, state?: string): ArtSpec | null {
  if (state && WORLD_PROP_ART[`${art}:${state}`]) return WORLD_PROP_ART[`${art}:${state}`];
  return WORLD_PROP_ART[art] ?? null;
}
