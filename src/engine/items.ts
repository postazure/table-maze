/**
 * Magic items: names, per-level stats, prices, shop rolls and equipping.
 *
 * Every item is PASSIVE. The controls never change: items fire on conditions
 * (low hearts), on timers (fireball, shield recharge) or on chance (chain
 * lightning). All of an item's numbers are derived from `MagicItem.level`,
 * which is the dungeon depth it was bought at.
 *
 * `itemStats` returns one flat bag with a neutral value for everything the
 * item does not do, so callers can merge the three equipped items into a
 * single bag (`heroStats`) and read numbers without knowing which item is on.
 */
import type { Hero, ItemKind, ItemSlot, MagicItem, Rng } from './types';
import { HEART, ITEM_KINDS, ITEM_SLOT } from './types';
import { spiritForLevel } from './balance';

/** Slots in display / roll order. */
export const ITEM_SLOTS: readonly ItemSlot[] = ['offense', 'defense', 'spirit'];

/** ms between hero steps without speed boots (~7 tiles/s). */
export const DEFAULT_MOVE_MS = 140;

/**
 * Everything any item can change, flat. Neutral values (see `NEUTRAL`) mean
 * "this item does not do that": 0, 1 for multipliers, false for flags.
 */
export interface ItemStats {
  /** Constant bonuses, applied to hero.atk / def / spirit / maxHp on equip. */
  atkBonus: number;
  defBonus: number;
  /** Every spirit-slot item carries one; see `SPIRIT_SLOT_BONUS`. */
  spiritBonus: number;
  maxHpBonus: number;
  /** Melee reach in tiles (1 = adjacent only, 2 = long sword). */
  reach: number;
  /** Fire staff. */
  fireIntervalMs: number;
  fireDmg: number;
  fireRange: number;
  /** Lightning wand. */
  chainChance: number;
  chainTargets: number;
  chainDmg: number;
  /** Poison dagger. */
  poisonMs: number;
  poisonDmg: number;
  /** Frost blade. */
  slowMs: number;
  /** Berserker axe: extra attack while at or below half hearts. */
  berserkAtk: number;
  /** Shield amulet. */
  shieldRechargeMs: number;
  /** Speed boots: ms per step (0 = use DEFAULT_MOVE_MS). */
  moveMs: number;
  /** Thorn mail. */
  thornDmg: number;
  /** Phoenix feather. */
  phoenixCooldownMs: number;
  /** Regen ring: out-of-combat regen speed multiplier. */
  regenMult: number;
  /** Stone ring. */
  knockbackImmune: boolean;
  /** Gold charm / xp tome. */
  goldMult: number;
  xpMult: number;
  /** Life amulet: one quarter heart every this many ms, even in combat. */
  lifePulseMs: number;
  /** Key compass. */
  compass: boolean;
  /** Vampire fang. */
  vampKillHeal: number;
  vampHitChance: number;
  /** Bane totem. */
  baneRadius: number;
  baneSlowMult: number;
  baneSightPenalty: number;
}

/** All-neutral stats: the bag an unequipped hero has. */
export const NEUTRAL: ItemStats = {
  atkBonus: 0,
  defBonus: 0,
  spiritBonus: 0,
  maxHpBonus: 0,
  reach: 1,
  fireIntervalMs: 0,
  fireDmg: 0,
  fireRange: 0,
  chainChance: 0,
  chainTargets: 0,
  chainDmg: 0,
  poisonMs: 0,
  poisonDmg: 0,
  slowMs: 0,
  berserkAtk: 0,
  shieldRechargeMs: 0,
  moveMs: 0,
  thornDmg: 0,
  phoenixCooldownMs: 0,
  regenMult: 1,
  knockbackImmune: false,
  goldMult: 1,
  xpMult: 1,
  lifePulseMs: 0,
  compass: false,
  vampKillHeal: 0,
  vampHitChance: 0,
  baneRadius: 0,
  baneSlowMult: 1,
  baneSightPenalty: 0,
};

const NAMES: Record<ItemKind, string> = {
  longSword: 'Long Sword',
  fireStaff: 'Fire Staff',
  lightningWand: 'Lightning Wand',
  poisonDagger: 'Poison Dagger',
  frostBlade: 'Frost Blade',
  berserkerAxe: 'Berserker Axe',
  shieldAmulet: 'Shield Amulet',
  speedBoots: 'Speed Boots',
  thornMail: 'Thorn Mail',
  phoenixFeather: 'Phoenix Feather',
  regenRing: 'Regen Ring',
  stoneRing: 'Stone Ring',
  goldCharm: 'Gold Charm',
  xpTome: 'XP Tome',
  lifeAmulet: 'Life Amulet',
  keyCompass: 'Key Compass',
  vampireFang: 'Vampire Fang',
  baneTotem: 'Bane Totem',
};

export function itemName(kind: ItemKind): string {
  return NAMES[kind];
}

/** The kinds that can show up in a given slot, in ITEM_KINDS order. */
export function kindsForSlot(slot: ItemSlot): ItemKind[] {
  return ITEM_KINDS.filter((k) => ITEM_SLOT[k] === slot);
}

/**
 * Spirit a spirit-slot item carries, whatever else it does. The slot is the
 * hero's channel to the dungeon's magic, so wearing anything in it makes the
 * floor's shrines go further; which item it is only decides what else you get.
 */
export function spiritSlotBonus(level: number): number {
  return 1 + Math.floor(Math.max(1, Math.floor(level || 1)) / 3);
}

/** Full stat bag of one item at its own level. */
export function itemStats(item: MagicItem): ItemStats {
  const L = Math.max(1, Math.floor(item.level || 1));
  const s: ItemStats = { ...NEUTRAL };
  if (ITEM_SLOT[item.kind] === 'spirit') s.spiritBonus = spiritSlotBonus(L);
  switch (item.kind) {
    // --- offense ---------------------------------------------------------
    case 'longSword':
      s.reach = 2;
      s.atkBonus = Math.floor(L / 3);
      break;
    case 'fireStaff':
      s.fireIntervalMs = Math.max(2500, 6000 - 400 * L);
      s.fireDmg = 2 + L;
      s.fireRange = 6;
      break;
    case 'lightningWand':
      s.chainChance = Math.min(0.7, 0.35 + 0.02 * L);
      s.chainTargets = 2 + Math.floor(L / 4);
      s.chainDmg = 1 + Math.floor(L / 2);
      break;
    case 'poisonDagger':
      s.poisonMs = (3 + Math.floor(L / 2)) * 1000;
      s.poisonDmg = 1 + Math.floor(L / 4);
      break;
    case 'frostBlade':
      s.slowMs = 2000 + 300 * L;
      break;
    case 'berserkerAxe':
      s.berserkAtk = 2 + Math.floor(L / 2);
      break;
    // --- defense ---------------------------------------------------------
    case 'shieldAmulet':
      s.shieldRechargeMs = Math.max(3000, 8000 - 400 * L);
      break;
    case 'speedBoots':
      s.moveMs = L >= 6 ? 90 : 100;
      break;
    case 'thornMail':
      s.thornDmg = 1 + Math.floor(L / 3);
      break;
    case 'phoenixFeather':
      s.phoenixCooldownMs = Math.max(10000, 30000 - 1500 * L);
      break;
    case 'regenRing':
      s.regenMult = 3;
      break;
    case 'stoneRing':
      s.defBonus = 1 + Math.floor(L / 4);
      s.knockbackImmune = true;
      break;
    // --- spirit ----------------------------------------------------------
    case 'goldCharm':
      s.goldMult = 1.5 + 0.1 * Math.floor(L / 2);
      break;
    case 'xpTome':
      s.xpMult = 1.5 + 0.1 * Math.floor(L / 2);
      break;
    case 'lifeAmulet':
      s.maxHpBonus = HEART * (1 + Math.floor(L / 4));
      s.lifePulseMs = 6000;
      break;
    case 'keyCompass':
      s.compass = true;
      break;
    case 'vampireFang':
      s.vampKillHeal = 1 + Math.floor(L / 3);
      s.vampHitChance = 0.15;
      break;
    case 'baneTotem':
      s.baneRadius = 3;
      s.baneSlowMult = 1.5;
      s.baneSightPenalty = 2;
      break;
    default:
      break;
  }
  return s;
}

/**
 * Merged bag of everything the hero currently wears. No two kinds in different
 * slots touch the same field, so "take whatever differs from neutral" is safe.
 */
export function heroStats(hero: Hero): ItemStats {
  const out: ItemStats = { ...NEUTRAL };
  const gear = hero.gear;
  if (!gear) return out;
  for (const slot of ITEM_SLOTS) {
    const item = gear[slot];
    if (!item) continue;
    const s = itemStats(item);
    for (const field of STAT_FIELDS) {
      if (s[field] !== NEUTRAL[field]) assignStat(out, field, s);
    }
  }
  return out;
}

const STAT_FIELDS = Object.keys(NEUTRAL) as (keyof ItemStats)[];

function assignStat(target: ItemStats, field: keyof ItemStats, from: ItemStats): void {
  // One tiny cast keeps the merge loop generic without widening ItemStats.
  (target as unknown as Record<string, number | boolean>)[field] = from[field];
}

/** ms per hero step, honouring speed boots. */
export function heroMoveMs(hero: Hero): number {
  const ms = heroStats(hero).moveMs;
  return ms > 0 ? ms : DEFAULT_MOVE_MS;
}

/** Is the berserker bonus live right now (at or below half hearts)? */
export function berserkActive(hero: Hero, stats: ItemStats = heroStats(hero)): boolean {
  return stats.berserkAtk > 0 && hero.hp * 2 <= hero.maxHp;
}

/** Gold price of one item, always a multiple of 5. */
export function itemPrice(kind: ItemKind, level: number): number {
  const L = Math.max(1, Math.floor(level || 1));
  const slot = ITEM_SLOT[kind];
  const mult = slot === 'offense' ? 1.1 : slot === 'spirit' ? 0.9 : 1;
  const raw = (20 + 15 * L) * mult;
  return Math.max(5, Math.round(raw / 5) * 5);
}

/**
 * One offer per slot (offense, defense, spirit), all at `level = depth`.
 * A kind the hero already wears in that slot is skipped when the slot has
 * something else to offer.
 */
export function rollShopOffers(depth: number, rng: Rng, owned: Hero['gear']): MagicItem[] {
  const level = Math.max(1, Math.floor(depth));
  const out: MagicItem[] = [];
  for (const slot of ITEM_SLOTS) {
    const all = kindsForSlot(slot);
    const ownedKind = owned?.[slot]?.kind ?? null;
    const pool = all.filter((k) => k !== ownedKind);
    const kinds = pool.length > 0 ? pool : all;
    out.push({ kind: rng.pick(kinds), level });
  }
  return out;
}

/** The item the hero wears of this kind, or null. */
export function hasItem(hero: Hero, kind: ItemKind): MagicItem | null {
  const item = hero.gear?.[ITEM_SLOT[kind]] ?? null;
  return item && item.kind === kind ? item : null;
}

/**
 * Put `item` in its slot: the old item's constant bonuses come off first, the
 * new one's go on. Returns whatever was pushed out of the slot.
 */
export function equip(hero: Hero, item: MagicItem): MagicItem | null {
  const slot = ITEM_SLOT[item.kind];
  if (!hero.gear) hero.gear = { offense: null, defense: null, spirit: null };
  if (!hero.timers) hero.timers = { shield: 0, fire: 0, life: 0, phoenix: 0, bane: 0 };

  const old = hero.gear[slot] ?? null;
  if (old) {
    const s = itemStats(old);
    hero.atk -= s.atkBonus;
    hero.def -= s.defBonus;
    hero.spirit -= s.spiritBonus;
    if (s.maxHpBonus) {
      hero.maxHp = Math.max(1, hero.maxHp - s.maxHpBonus);
      hero.hp = Math.max(1, Math.min(hero.hp, hero.maxHp));
    }
  }

  hero.gear[slot] = item;
  const n = itemStats(item);
  hero.atk += n.atkBonus;
  hero.def += n.defBonus;
  hero.spirit += n.spiritBonus;
  if (n.maxHpBonus) {
    hero.maxHp += n.maxHpBonus;
    hero.hp += n.maxHpBonus;
  }

  // Fresh item, fresh timers for whatever that slot drives.
  if (slot === 'offense') {
    hero.timers.fire = 0;
  } else if (slot === 'defense') {
    hero.shieldReady = false;
    hero.timers.shield = 0;
    hero.timers.phoenix = 0;
  } else {
    hero.timers.life = 0;
    hero.timers.bane = 0;
  }
  return old;
}

/**
 * What the shop's forge charges to raise `item` one level. Cheaper than a new
 * item of the level it is going to, since the hero already owns the thing,
 * and a round number of gold like every other price.
 */
export function upgradePrice(item: MagicItem): number {
  const L = Math.max(1, Math.floor(item.level || 1));
  const raw = 10 + 10 * L;
  return Math.max(10, Math.round(raw / 5) * 5);
}

/**
 * Boss reward: bump one worn item a level and re-apply its constant bonuses.
 * Returns the item that grew, or null when the hero wears nothing at all —
 * the caller then hands out a heart instead.
 */
export function upgradeRandomItem(hero: Hero, rng: Rng): MagicItem | null {
  const gear = hero.gear;
  if (!gear) return null;
  const filled = ITEM_SLOTS.filter((slot) => gear[slot] !== null);
  if (filled.length === 0) return null;
  return upgradeItem(hero, rng.pick(filled));
}

/**
 * Raise the item in `slot` one level and re-apply its constant bonuses.
 *
 * The item object is mutated in place, so `hero.gear[slot]` keeps pointing at
 * the same reference (the bossWon popup and the help screen both hold on to
 * it). Timers are left alone: an upgrade is not a re-equip. Null when the
 * slot is empty.
 */
export function upgradeItem(hero: Hero, slot: ItemSlot): MagicItem | null {
  const item = hero.gear?.[slot] ?? null;
  if (!item) return null;
  const before = itemStats(item);
  item.level = Math.max(1, Math.floor(item.level || 1)) + 1;
  const after = itemStats(item);

  hero.atk += after.atkBonus - before.atkBonus;
  hero.def += after.defBonus - before.defBonus;
  hero.spirit += after.spiritBonus - before.spiritBonus;
  const dHp = after.maxHpBonus - before.maxHpBonus;
  if (dHp !== 0) {
    // Extra hearts arrive full: hp moves with maxHp, then is clamped either way.
    hero.maxHp = Math.max(1, hero.maxHp + dHp);
    hero.hp = Math.max(1, Math.min(hero.hp + dHp, hero.maxHp));
  }
  return item;
}

/**
 * Fill in the magic-item fields a hero from an older save may be missing.
 * SAVE_VERSION already rejects stale saves; this is belt and braces.
 */
export function reviveGear(hero: Hero): void {
  const g = hero.gear as Partial<Hero['gear']> | undefined;
  hero.gear = {
    offense: g?.offense ?? null,
    defense: g?.defense ?? null,
    spirit: g?.spirit ?? null,
  };
  // Spirit is exactly the level curve plus the worn item, so a save written
  // before the stat existed rebuilds rather than being thrown away.
  if (typeof hero.spirit !== 'number') {
    const worn = hero.gear.spirit;
    hero.spirit = spiritForLevel(hero.level) + (worn ? itemStats(worn).spiritBonus : 0);
  }
  if (typeof hero.shieldReady !== 'boolean') hero.shieldReady = false;
  const t = hero.timers as Partial<Hero['timers']> | undefined;
  hero.timers = {
    shield: t?.shield ?? 0,
    fire: t?.fire ?? 0,
    life: t?.life ?? 0,
    phoenix: t?.phoenix ?? 0,
    bane: t?.bane ?? 0,
  };
}

const sec = (ms: number): string => `${Math.round(ms / 100) / 10}s`;
const pct = (p: number): string => `${Math.round(p * 100)}%`;
const hearts = (hp: number): string => {
  const h = hp / HEART;
  return `${Number.isInteger(h) ? h : h.toFixed(2)} heart${h === 1 ? '' : 's'}`;
};

/**
 * Plain-words explanation of what an item does, with the real numbers for
 * its level. Shown on the help screen.
 */
export function itemDescription(item: MagicItem): string {
  const s = itemStats(item);
  // Everything in the spirit slot raises Spirit, so that half of the sentence
  // is written once here rather than six times below.
  const spirit = s.spiritBonus > 0 ? ` +${s.spiritBonus} spirit, so shrines give more.` : '';
  return `${itemEffect(item, s)}${spirit}`;
}

function itemEffect(item: MagicItem, s: ItemStats): string {
  switch (item.kind) {
    case 'longSword':
      return `Your swings reach 2 tiles in a straight line, so you hit first.${s.atkBonus ? ` +${s.atkBonus} attack.` : ''}`;
    case 'fireStaff':
      return `Every ${sec(s.fireIntervalMs)} a fireball flies at the nearest monster within ${s.fireRange} tiles for ${s.fireDmg} damage. Monsters next to it take half.`;
    case 'lightningWand':
      return `${pct(s.chainChance)} of your hits chain lightning to up to ${s.chainTargets} nearby monsters for ${s.chainDmg} damage each.`;
    case 'poisonDagger':
      return `Your hits poison monsters: ${s.poisonDmg} damage every second for ${sec(s.poisonMs)}.`;
    case 'frostBlade':
      return `Your hits slow monsters for ${sec(s.slowMs)}. Slowed monsters move and attack at half speed.`;
    case 'berserkerAxe':
      return `While you are at half hearts or less, +${s.berserkAtk} attack.`;
    case 'shieldAmulet':
      return `A bubble blocks one hit completely. It comes back ${sec(s.shieldRechargeMs)} after it pops.`;
    case 'speedBoots':
      return `You walk faster: a step takes ${s.moveMs}ms instead of ${DEFAULT_MOVE_MS}ms.`;
    case 'thornMail':
      return `Any monster that hits you takes ${s.thornDmg} damage back.`;
    case 'phoenixFeather':
      return `When you would be knocked down, you burst back up with half your hearts instead of sleeping. Works once every ${sec(s.phoenixCooldownMs)}.`;
    case 'regenRing':
      return `Hearts refill ${s.regenMult}x faster while standing still, and sleep heals twice as fast.`;
    case 'stoneRing':
      return `+${s.defBonus} defense, and monsters can no longer shove you back.`;
    case 'goldCharm':
      return `You get ${pct(s.goldMult - 1)} more gold from monsters and chests.`;
    case 'xpTome':
      return `You get ${pct(s.xpMult - 1)} more XP from monsters and chests.`;
    case 'lifeAmulet':
      return `+${hearts(s.maxHpBonus)}, and a quarter heart refills every ${sec(s.lifePulseMs)} even while fighting.`;
    case 'keyCompass':
      return `An arrow above you points to the nearest key, or to the stairs when there are no keys left.`;
    case 'vampireFang':
      return `Each kill heals ${s.vampKillHeal} quarter heart${s.vampKillHeal === 1 ? '' : 's'}, and ${pct(s.vampHitChance)} of your hits heal a quarter heart.`;
    case 'baneTotem':
      return `Monsters within ${s.baneRadius} tiles move and attack ${pct(s.baneSlowMult - 1)} slower, and lurkers see ${s.baneSightPenalty} tiles less far.`;
  }
}
