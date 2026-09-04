import type { GameState, ItemSlot, MagicItem, Modal } from '../engine/types';

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
  /** One magic item per slot, or null if empty. */
  gear: Record<ItemSlot, MagicItem | null>;
  /** True when the hero is standing on a shop level. */
  shop: boolean;
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
    stunned: hero.sleeping || hero.stun > 0,
    gear: hero.gear,
    shop: state.level.kind === 'shop',
    modal: state.modal,
    log: state.log.slice(-3).map((m) => m.text),
  };
}

function gearSlotEquals(a: MagicItem | null, b: MagicItem | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.level === b.level;
}

/** Shallow compare, including log array contents and per-slot gear. */
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
    a.shop !== b.shop ||
    a.modal !== b.modal ||
    a.log.length !== b.log.length ||
    !gearSlotEquals(a.gear.offense, b.gear.offense) ||
    !gearSlotEquals(a.gear.defense, b.gear.defense) ||
    !gearSlotEquals(a.gear.spirit, b.gear.spirit)
  ) {
    return false;
  }
  for (let i = 0; i < a.log.length; i++) {
    if (a.log[i] !== b.log[i]) return false;
  }
  return true;
}
