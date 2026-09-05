import type { GameState, ItemSlot, MagicItem, Modal, ShrineKind } from '../engine/types';
import { buffAtk, buffDef, buffPhase, type BuffPhase } from '../engine/shrines';

/**
 * One running shrine effect, as the HUD shows it: a glyph, how much of it is
 * left, and how hard that should blink. Never a number — the timer is the bar
 * and the blink, the same rule the pip over the hero's head follows.
 */
export interface HudBuff {
  kind: ShrineKind;
  /** 0-100, stepped so the HUD is not re-rendered for every millisecond. */
  pct: number;
  phase: BuffPhase;
  /**
   * Whole seconds left, for the help screen — which is the one place that says
   * how long in words, because the game is paused behind it. The HUD chip and
   * the pip over the hero stay wordless. 0 for the ward, which has no clock.
   */
  secondsLeft: number;
  /** The depth the shrine was generated at; its numbers all come from this. */
  level: number;
}

export interface HudModel {
  depth: number;
  level: number;
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  /** Attack and defense as they stand right now, shrine bonuses included. */
  atk: number;
  def: number;
  /** True while a shrine is what is propping that number up. */
  atkBuffed: boolean;
  defBuffed: boolean;
  /** Spirit: how much further this hero's shrines go. */
  spirit: number;
  gold: number;
  doorKeys: number;
  chestKeys: number;
  kills: number;
  stunned: boolean;
  log: string[]; // last 3 messages, oldest first
  /** Ward shrine: temporary quarter hearts left, and what they started at. */
  tempHp: number;
  tempHpMax: number;
  /** Running shrine effects, ward first. Empty when nothing is running. */
  buffs: HudBuff[];
  /** One magic item per slot, or null if empty. */
  gear: Record<ItemSlot, MagicItem | null>;
  /** The kind of level the hero is currently on (drives the depth badge). */
  levelKind: 'maze' | 'shop' | 'boss';
  /** Current popup, compared by reference. */
  modal: Modal | null;
}

/** Round a fraction to 2% steps: smooth enough to watch, cheap enough to diff. */
function steppedPct(value: number, max: number): number {
  if (max <= 0) return 0;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return Math.round(pct / 2) * 2;
}

export function deriveHudModel(state: GameState): HudModel {
  const hero = state.hero;
  const atkBonus = buffAtk(hero);
  const defBonus = buffDef(hero);
  const tempHp = hero.tempHp ?? 0;
  const buffs: HudBuff[] = [];
  // The ward has no clock: its bar drains as the temporary hearts are spent,
  // and it never blinks.
  if (tempHp > 0) {
    buffs.push({
      kind: 'ward',
      pct: steppedPct(tempHp, hero.tempHpMax || tempHp),
      phase: 'solid',
      secondsLeft: 0,
      level: 1,
    });
  }
  for (const b of hero.buffs ?? []) {
    buffs.push({
      kind: b.kind,
      pct: steppedPct(b.ms, b.totalMs),
      phase: buffPhase(b.ms),
      secondsLeft: Math.ceil(b.ms / 1000),
      level: b.level,
    });
  }
  return {
    depth: state.depth,
    level: hero.level,
    hp: hero.hp,
    maxHp: hero.maxHp,
    xp: hero.xp,
    xpToNext: hero.xpToNext,
    atk: hero.atk + atkBonus,
    def: hero.def + defBonus,
    atkBuffed: atkBonus > 0,
    defBuffed: defBonus > 0,
    spirit: hero.spirit,
    gold: hero.gold,
    doorKeys: hero.keys.door ?? 0,
    chestKeys: hero.keys.chest ?? 0,
    kills: state.stats.kills,
    stunned: hero.sleeping || hero.stun > 0,
    tempHp,
    tempHpMax: hero.tempHpMax ?? 0,
    buffs,
    gear: hero.gear,
    levelKind: state.level.kind,
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
    a.atkBuffed !== b.atkBuffed ||
    a.defBuffed !== b.defBuffed ||
    a.spirit !== b.spirit ||
    a.tempHp !== b.tempHp ||
    a.tempHpMax !== b.tempHpMax ||
    a.buffs.length !== b.buffs.length ||
    a.levelKind !== b.levelKind ||
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
  for (let i = 0; i < a.buffs.length; i++) {
    const x = a.buffs[i];
    const y = b.buffs[i];
    if (x.kind !== y.kind || x.pct !== y.pct || x.phase !== y.phase) return false;
    if (x.secondsLeft !== y.secondsLeft || x.level !== y.level) return false;
  }
  return true;
}
