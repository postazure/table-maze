/**
 * Tuning numbers: level size, hero progression, monster stats, loot, damage.
 * Nothing here touches the DOM and all randomness comes from an `Rng`.
 */
import type { Hero, Loot, LootItem, Monster, MonsterKind, Rng, Vec } from './types';
import { HEART } from './types';

// ---------------------------------------------------------------------------
// Level size
// ---------------------------------------------------------------------------

const BASE_W = 21;
const BASE_H = 31;
const MAX_W = 41;
const MAX_H = 61;

/** Odd tile counts, always portrait. Grows two tiles every other depth. */
export function levelDims(depth: number): { width: number; height: number } {
  const d = Math.max(1, Math.floor(depth));
  const grow = Math.floor((d - 1) / 2);
  const width = Math.min(MAX_W, BASE_W + 2 * grow);
  const height = Math.min(MAX_H, BASE_H + 2 * grow);
  return { width, height };
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.round(10 * Math.pow(l, 1.5));
}

export function newHero(): Hero {
  return {
    pos: { x: 1, y: 1 },
    rpos: { x: 1, y: 1 },
    facing: 'S',
    hp: 3 * HEART,
    maxHp: 3 * HEART,
    atk: 2,
    def: 0,
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    gold: 0,
    keys: { door: 0, chest: 0 },
    items: [],
    hitFlash: 0,
    stun: 0,
    sleeping: false,
    gear: { offense: null, defense: null, spirit: null },
    shieldReady: false,
    timers: { shield: 0, fire: 0, life: 0, phoenix: 0, bane: 0 },
    lungeT: 0,
    sinceCombat: 99999,
  };
}

/** Spend banked xp on as many level-ups as it covers. */
export function applyLevelUp(hero: Hero): void {
  let guard = 0;
  while (hero.xp >= hero.xpToNext && guard++ < 200) {
    hero.xp -= hero.xpToNext;
    hero.level += 1;
    hero.maxHp += HEART; // one more heart
    hero.atk += 1;
    if (hero.level % 2 === 0) hero.def += 1;
    hero.hp = hero.maxHp;
    hero.xpToNext = xpForLevel(hero.level);
  }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

type Look = { name: string; glyph: string };

/** Depth tier 0..4; sturdy glyphs for guards, mobile for patrols, sneaky for lurkers. */
const BESTIARY: Record<MonsterKind, Look[][]> = {
  guard: [
    [
      { name: 'Spider', glyph: '🕷️' },
      { name: 'Scorpion', glyph: '🦂' },
    ],
    [
      { name: 'Goblin', glyph: '👺' },
      { name: 'Scorpion', glyph: '🦂' },
    ],
    [
      { name: 'Skeleton', glyph: '💀' },
      { name: 'Zombie', glyph: '🧟' },
    ],
    [
      { name: 'Ogre', glyph: '👹' },
      { name: 'Skeleton', glyph: '💀' },
    ],
    [
      { name: 'Drake', glyph: '🐉' },
      { name: 'Ogre', glyph: '👹' },
    ],
  ],
  patrol: [
    [
      { name: 'Rat', glyph: '🐀' },
      { name: 'Bat', glyph: '🦇' },
    ],
    [
      { name: 'Snake', glyph: '🐍' },
      { name: 'Bat', glyph: '🦇' },
    ],
    [
      { name: 'Goblin', glyph: '👺' },
      { name: 'Zombie', glyph: '🧟' },
    ],
    [
      { name: 'Vampire', glyph: '🧛' },
      { name: 'Goblin', glyph: '👺' },
    ],
    [
      { name: 'Ogre', glyph: '👹' },
      { name: 'Vampire', glyph: '🧛' },
    ],
  ],
  lurker: [
    [
      { name: 'Bat', glyph: '🦇' },
      { name: 'Spider', glyph: '🕷️' },
    ],
    [
      { name: 'Snake', glyph: '🐍' },
      { name: 'Spider', glyph: '🕷️' },
    ],
    [
      { name: 'Wraith', glyph: '👻' },
      { name: 'Snake', glyph: '🐍' },
    ],
    [
      { name: 'Wraith', glyph: '👻' },
      { name: 'Vampire', glyph: '🧛' },
    ],
    [
      { name: 'Vampire', glyph: '🧛' },
      { name: 'Wraith', glyph: '👻' },
    ],
  ],
};

function tierOf(depth: number): number {
  if (depth <= 3) return 0;
  if (depth <= 7) return 1;
  if (depth <= 12) return 2;
  if (depth <= 20) return 3;
  return 4;
}

/** Fully-formed monster of `kind` sitting on `pos`, scaled to `depth`. */
export function makeMonster(
  kind: MonsterKind,
  depth: number,
  rng: Rng,
  pos: Vec,
  id: string,
): Monster {
  const depthN = Math.max(1, Math.floor(depth));
  const look = rng.pick(BESTIARY[kind][tierOf(depthN)]);
  // Guards and lurkers are a level above the dungeon depth; patrols match it.
  // Every level, a few monsters roll one level higher to stand out.
  const level = depthN + (kind === 'patrol' ? 0 : 1) + (rng.chance(0.2) ? 1 : 0);
  const d = level;

  let hp: number;
  let atk: number;
  let def: number;
  let moveInterval: number;
  let attackInterval: number;
  let sightRange: number;
  let leash: number;
  let xp: number;
  let gold: number;

  switch (kind) {
    case 'guard':
      // Rooted, tanky, hits hard but slowly.
      hp = 6 + 3 * d;
      atk = 1 + Math.floor(d / 2); // half a heart from level 2
      def = Math.floor(d / 2);
      moveInterval = 100000; // never moves
      attackInterval = 900;
      sightRange = 2;
      leash = 0;
      xp = 6 + 3 * d;
      gold = rng.int(1, 4 + d);
      break;
    case 'patrol':
      // Walks its beat; squishy.
      hp = 4 + 2 * d;
      atk = Math.max(1, Math.floor(d / 2)); // a quarter heart for the first few levels
      def = Math.floor((d - 1) / 3);
      moveInterval = 450;
      attackInterval = 800;
      sightRange = 3;
      leash = 0;
      xp = 4 + 2 * d;
      gold = rng.int(0, 2 + d);
      break;
    default:
      // Lurker: fast enough to punish a careless hero, slower than a running one.
      hp = 5 + 2 * d;
      atk = 1 + Math.floor((d - 1) / 2);
      def = Math.floor(d / 3);
      moveInterval = 260;
      attackInterval = 700;
      sightRange = 4;
      leash = 7;
      xp = 5 + 3 * d;
      gold = rng.int(1, 3 + d);
      break;
  }

  return {
    id,
    kind,
    name: look.name,
    glyph: look.glyph,
    pos: { x: pos.x, y: pos.y },
    rpos: { x: pos.x, y: pos.y },
    home: { x: pos.x, y: pos.y },
    hp,
    maxHp: hp,
    atk,
    def,
    level,
    xp,
    gold,
    moveInterval,
    moveCooldown: 0,
    attackInterval,
    attackCooldown: 0,
    state: 'idle',
    sightRange,
    leash,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

const SWORDS = ['Rusty Sword', 'Iron Sword', 'Steel Sword', 'Silver Sword', 'Dragonfang Sword'];
const SHIELDS = ['Cracked Shield', 'Wooden Shield', 'Iron Shield', 'Tower Shield', 'Aegis Shield'];
const AMULETS = ['Copper Amulet', 'Jade Amulet', 'Ruby Amulet', 'Star Amulet', 'Heartstone Amulet'];
const RINGS = ['Tin Ring', 'Bone Ring', 'Gold Ring', 'Opal Ring', 'Ring of Ages'];

export function rollChestLoot(depth: number, rng: Rng): Loot {
  const d = Math.max(1, Math.floor(depth));
  const tier = tierOf(d);
  const loot: Loot = {
    gold: rng.int(5, 15) * d,
    xp: 3 * d,
  };
  if (rng.chance(0.45)) {
    const roll = rng.int(0, 3);
    let item: LootItem;
    if (roll === 0) item = { name: SWORDS[tier], atk: 1 + Math.floor(d / 5) };
    else if (roll === 1) item = { name: SHIELDS[tier], def: 1 + Math.floor(d / 7) };
    else if (roll === 2) item = { name: AMULETS[tier], maxHp: HEART * (1 + Math.floor(d / 4)) }; // whole hearts
    else item = { name: RINGS[tier], maxHp: HEART * (1 + Math.floor(d / 6)) };
    loot.item = item;
  }
  return loot;
}

// ---------------------------------------------------------------------------
// Combat maths
// ---------------------------------------------------------------------------

/** Damage of one hit; always at least 1 so fights cannot stall. */
/**
 * Damage in quarter-hearts. A plain hit is attack minus defense (at least a
 * quarter heart); one hit in five is a crit for one extra quarter.
 */
export function damage(attackerAtk: number, defenderDef: number, rng: Rng): number {
  const base = Math.max(1, attackerAtk - defenderDef);
  return base + (rng.chance(0.2) ? 1 : 0);
}
