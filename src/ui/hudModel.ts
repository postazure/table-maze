import type { Boon, BossKind, GameState, ItemSlot, MagicItem, Modal, RelicKind, ShrineKind } from '../engine/types';
import { buffAtk, buffDef, buffPhase, type BuffPhase } from '../engine/shrines';
import { lensActive } from '../engine/lens';
import { WORLDS } from '../engine/worlds';

/**
 * One running shrine effect, as the HUD shows it: a glyph, how much of it is
 * left, and how hard that should blink. Never a number — the timer is the bar
 * and the blink, the same rule the pip over the hero's head follows.
 */
/**
 * One running shrine effect, as the help screen shows it. Nothing about a buff
 * reaches the HUD any more — the pips floating over the hero are the at-a-
 * glance read, and the detail lives behind the help button.
 */
export interface HudBuff {
  kind: ShrineKind;
  phase: BuffPhase;
  /**
   * Whole seconds left. The help screen is the one place that says how long in
   * words, because the game is paused behind it; the pip over the hero stays
   * wordless. 0 for the ward, which has no clock.
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
  /** Health potions: charges left, and how many the hero can carry. */
  potions: number;
  potionCapacity: number;
  stunned: boolean;
  /** The run's log, oldest first. Read only by the help screen's Log tab. */
  log: string[];
  /** Ward shrine: temporary quarter hearts left, and what they started at. */
  tempHp: number;
  tempHpMax: number;
  /** Running shrine effects, ward first. Empty when nothing is running. */
  buffs: HudBuff[];
  /** One magic item per slot, or null if empty. */
  gear: Record<ItemSlot, MagicItem | null>;
  /**
   * Carrying a Cracked Lens that still works down here. It has no numbers to
   * show and no clock to run down, so the HUD only ever says yes or no.
   */
  lens: boolean;
  /** Carrying an orb through a wing right now. */
  carrying: boolean;
  /** Relics in the pack, boss trophies not yet spent, and the boons this run runs under. */
  relics: RelicKind[];
  trophies: BossKind[];
  boons: Boon[];
  /** Every boss world's collectible ever won, by id (see engine/worlds). Outlives the run. */
  collection: string[];
  /** The kind of level the hero is currently on (drives the depth badge). */
  levelKind: 'maze' | 'shop' | 'boss' | 'world';
  /** The world's own name (`WORLDS[kind].name`) on a world floor; null everywhere else. */
  worldName: string | null;
  /** Current popup, compared by reference. */
  modal: Modal | null;
}

export function deriveHudModel(state: GameState): HudModel {
  const hero = state.hero;
  const atkBonus = buffAtk(hero);
  const defBonus = buffDef(hero);
  const tempHp = hero.tempHp ?? 0;
  const buffs: HudBuff[] = [];
  // The ward has no clock: its bar drains as the temporary hearts are spent,
  // and it never blinks.
  if (tempHp > 0) buffs.push({ kind: 'ward', phase: 'solid', secondsLeft: 0, level: 1 });
  for (const b of hero.buffs ?? []) {
    buffs.push({
      kind: b.kind,
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
    potions: hero.potions ?? 0,
    potionCapacity: hero.potionCapacity ?? 0,
    stunned: hero.sleeping || hero.stun > 0,
    tempHp,
    tempHpMax: hero.tempHpMax ?? 0,
    buffs,
    gear: hero.gear,
    lens: lensActive(hero, state.depth),
    carrying: !!hero.carrying,
    relics: hero.relics ?? [],
    trophies: hero.trophies ?? [],
    boons: state.boons ?? [],
    collection: state.collection ?? [],
    levelKind: state.level.kind,
    worldName: state.level.kind === 'world' && state.level.world ? WORLDS[state.level.world.kind].name : null,
    modal: state.modal,
    log: state.log.map((m) => m.text),
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
    a.potions !== b.potions ||
    a.potionCapacity !== b.potionCapacity ||
    a.stunned !== b.stunned ||
    a.atkBuffed !== b.atkBuffed ||
    a.defBuffed !== b.defBuffed ||
    a.spirit !== b.spirit ||
    a.tempHp !== b.tempHp ||
    a.tempHpMax !== b.tempHpMax ||
    a.buffs.length !== b.buffs.length ||
    a.lens !== b.lens ||
    a.carrying !== b.carrying ||
    a.relics.length !== b.relics.length ||
    a.trophies.length !== b.trophies.length ||
    a.boons.length !== b.boons.length ||
    a.collection.length !== b.collection.length ||
    a.levelKind !== b.levelKind ||
    a.worldName !== b.worldName ||
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
  for (let i = 0; i < a.relics.length; i++) if (a.relics[i] !== b.relics[i]) return false;
  for (let i = 0; i < a.trophies.length; i++) if (a.trophies[i] !== b.trophies[i]) return false;
  for (let i = 0; i < a.collection.length; i++) if (a.collection[i] !== b.collection[i]) return false;
  for (let i = 0; i < a.boons.length; i++) {
    if (a.boons[i].kind !== b.boons[i].kind || a.boons[i].runsLeft !== b.boons[i].runsLeft) return false;
  }
  for (let i = 0; i < a.buffs.length; i++) {
    const x = a.buffs[i];
    const y = b.buffs[i];
    if (x.kind !== y.kind || x.phase !== y.phase) return false;
    if (x.secondsLeft !== y.secondsLeft || x.level !== y.level) return false;
  }
  return true;
}
