import type { GameState, Modal } from '../engine/types';

export interface HudModel {
  depth: number;
  level: number;
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  atk: number;
  def: number;
  gold: number;
  doorKeys: number;
  chestKeys: number;
  kills: number;
  stunned: boolean;
  log: string[]; // last 3 messages, oldest first
  /** Current popup, compared by reference. */
  modal: Modal | null;
}

export function deriveHudModel(state: GameState): HudModel {
  const hero = state.hero;
  return {
    depth: state.depth,
    level: hero.level,
    hp: hero.hp,
    maxHp: hero.maxHp,
    xp: hero.xp,
    xpToNext: hero.xpToNext,
    atk: hero.atk,
    def: hero.def,
    gold: hero.gold,
    doorKeys: hero.keys.door ?? 0,
    chestKeys: hero.keys.chest ?? 0,
    kills: state.stats.kills,
    stunned: hero.stun > 0,
    modal: state.modal,
    log: state.log.slice(-3).map((m) => m.text),
  };
}

/** Shallow compare, including log array contents. */
export function hudModelEquals(a: HudModel | null, b: HudModel): boolean {
  if (!a) return false;
  if (
    a.depth !== b.depth ||
    a.level !== b.level ||
    a.hp !== b.hp ||
    a.maxHp !== b.maxHp ||
    a.xp !== b.xp ||
    a.xpToNext !== b.xpToNext ||
    a.atk !== b.atk ||
    a.def !== b.def ||
    a.gold !== b.gold ||
    a.doorKeys !== b.doorKeys ||
    a.chestKeys !== b.chestKeys ||
    a.kills !== b.kills ||
    a.stunned !== b.stunned ||
    a.modal !== b.modal ||
    a.log.length !== b.log.length
  ) {
    return false;
  }
  for (let i = 0; i < a.log.length; i++) {
    if (a.log[i] !== b.log[i]) return false;
  }
  return true;
}
