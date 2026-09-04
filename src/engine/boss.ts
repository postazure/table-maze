/**
 * Boss chambers: the level that follows every third maze floor, right before
 * the shop. Three encounters rotate (see `bossKindForDepth`):
 *
 *  - necromancer: smash five crystals before the spell completes.
 *  - minotaur:    find the stairs while an unkillable hunter follows.
 *  - angels:      find the stairs through rooms haunted by weeping angels
 *                 that only move while the hero's back is turned.
 *
 * This module is generation + the monster factory + tiny pure helpers. The
 * per-tick rules (spell clock, skeleton spawns, angel wake-ups, win / lose)
 * live in game.ts; the movement AI lives in monsters.ts.
 *
 * STUB: the layouts below are placeholders so the rest of the game can be
 * built and tested against the API. The real generators replace them.
 */
import type { BossKind, BossMonsterKind, LevelData, Monster, Rect, Vec } from './types';
import { BOSS_KINDS, Tile } from './types';
import { hashSeed, makeRng } from './rng';
import { themeForDepth } from './themes';

/** Salt so boss rolls never share a stream with the maze or shop generators. */
export const BOSS_SALT = 6161;

/** A boss chamber follows every maze floor whose depth is a multiple of this. */
export const BOSS_EVERY = 3;

/** Display names, "The ..." form. */
export function bossName(kind: BossKind): string {
  switch (kind) {
    case 'necromancer':
      return 'The Necromancer';
    case 'minotaur':
      return 'The Minotaur';
    case 'angels':
      return 'The Weeping Angels';
  }
}

/**
 * Which boss guards the floor `depth` (a multiple of BOSS_EVERY). Every run
 * of three bosses contains each kind once, in a seed-shuffled order, so a
 * player meets all three before any repeats.
 */
export function bossKindForDepth(depth: number, runSeed: number): BossKind {
  const round = Math.max(1, Math.floor(depth / BOSS_EVERY)); // 1 for depth 3, 2 for 6, ...
  const block = Math.floor((round - 1) / BOSS_KINDS.length);
  const order = makeRng(hashSeed(runSeed, block, BOSS_SALT)).shuffle([...BOSS_KINDS]);
  return order[(round - 1) % BOSS_KINDS.length];
}

/** Index of the room in `rooms` containing `p`, or -1. */
export function roomAt(rooms: readonly Rect[], p: Vec): number {
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h) return i;
  }
  return -1;
}

/**
 * A fully formed boss-chamber monster on `pos`, scaled to `depth`.
 * Deterministic (no rng): the caller decides where and when.
 */
export function makeBossMonster(kind: BossMonsterKind, depth: number, pos: Vec, id: string): Monster {
  const d = Math.max(1, Math.floor(depth));
  const NEVER = 1e9;
  const base: Monster = {
    id,
    kind,
    name: 'Skeleton',
    glyph: '💀',
    pos: { x: pos.x, y: pos.y },
    rpos: { x: pos.x, y: pos.y },
    home: { x: pos.x, y: pos.y },
    hp: 1,
    maxHp: 1,
    atk: 0,
    def: 0,
    level: d,
    xp: 0,
    gold: 0,
    moveInterval: NEVER,
    moveCooldown: 0,
    attackInterval: NEVER,
    attackCooldown: 0,
    state: 'idle',
    sightRange: 0,
    leash: 0,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
  switch (kind) {
    case 'minion':
      // Trash: two or three swings, a quarter-heart nip, but it shoves.
      base.name = 'Skeleton';
      base.glyph = '💀';
      base.hp = base.maxHp = 3 + 2 * d;
      base.atk = 1;
      base.moveInterval = 420;
      base.attackInterval = 800;
      base.sightRange = 999;
      base.state = 'chasing';
      base.xp = 2 + d;
      base.gold = 1;
      break;
    case 'crystal':
      // Furniture with hit points: about five swings for a hero at depth.
      base.name = 'Crystal';
      base.glyph = '🔮';
      base.hp = base.maxHp = 8 + 4 * d;
      base.xp = 5 + 2 * d;
      break;
    case 'boss':
      base.name = 'Necromancer';
      base.glyph = '🧙';
      base.level = d + 3;
      base.invulnerable = true;
      break;
    case 'minotaur':
      // Slow, relentless, unkillable. Hits take a third of max hp (combat.ts).
      base.name = 'Minotaur';
      base.glyph = '🐂';
      base.level = d + 3;
      base.invulnerable = true;
      base.moveInterval = 380;
      base.attackInterval = 900;
      base.sightRange = 999;
      base.state = 'chasing';
      break;
    case 'angel':
      // Fast while unwatched, frozen while watched. Touch = a third of max hp.
      base.name = 'Angel';
      base.glyph = '🗿';
      base.level = d + 3;
      base.invulnerable = true;
      base.moveInterval = 170;
      base.attackInterval = 500;
      base.sightRange = 999;
      base.state = 'idle';
      break;
  }
  return base;
}

/**
 * The boss chamber that follows maze floor `depth`. Deterministic for a
 * (depth, runSeed) pair. `kind: 'boss'`, `boss` set, no keys/doors/chests.
 */
export function generateBossLevel(depth: number, runSeed: number): LevelData {
  const d = Math.max(1, Math.floor(depth));
  const kind = bossKindForDepth(d, runSeed);
  const seed = hashSeed(runSeed, d, BOSS_SALT);
  switch (kind) {
    case 'necromancer':
      return stubNecromancer(d, seed);
    case 'minotaur':
      return stubMinotaur(d, seed);
    case 'angels':
      return stubAngels(d, seed);
  }
}

// ---------------------------------------------------------------------------
// Placeholder layouts (replaced by the real generators)
// ---------------------------------------------------------------------------

function emptyRoom(width: number, height: number): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      row.push(x >= 1 && x <= width - 2 && y >= 1 && y <= height - 2 ? Tile.Floor : Tile.Wall);
    }
    tiles.push(row);
  }
  return tiles;
}

function baseLevel(d: number, seed: number, width: number, height: number): LevelData {
  return {
    depth: d,
    seed,
    kind: 'boss',
    theme: themeForDepth(d).id,
    width,
    height,
    tiles: emptyRoom(width, height),
    start: { x: Math.floor(width / 2), y: height - 2 },
    exit: { x: Math.floor(width / 2), y: 1 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
  };
}

function stubNecromancer(d: number, seed: number): LevelData {
  const lv = baseLevel(d, seed, 15, 15);
  const centre = { x: 7, y: 7 };
  lv.exit = centre;
  lv.monsters.push(makeBossMonster('boss', d, centre, 'necro'));
  const spots: Vec[] = [
    { x: 1, y: 1 },
    { x: 13, y: 1 },
    { x: 1, y: 13 },
    { x: 13, y: 13 },
    { x: 7, y: 2 },
  ];
  spots.forEach((p, i) => lv.monsters.push(makeBossMonster('crystal', d, p, `crystal${i + 1}`)));
  lv.boss = {
    kind: 'necromancer',
    defeated: false,
    spellMs: 90000,
    spellTotalMs: 90000,
    spawnMs: 4000,
    spawnEveryMs: 5000,
    maxMinions: 8,
    crystalsTotal: spots.length,
  };
  return lv;
}

function stubMinotaur(d: number, seed: number): LevelData {
  const lv = baseLevel(d, seed, 15, 21);
  lv.monsters.push(makeBossMonster('minotaur', d, { x: 7, y: 3 }, 'minotaur'));
  lv.boss = { kind: 'minotaur', defeated: false };
  return lv;
}

function stubAngels(d: number, seed: number): LevelData {
  const lv = baseLevel(d, seed, 15, 21);
  const rooms: Rect[] = [
    { x: 1, y: 14, w: 13, h: 6 },
    { x: 1, y: 7, w: 13, h: 7 },
    { x: 1, y: 1, w: 13, h: 6 },
  ];
  const angel = makeBossMonster('angel', d, { x: 2, y: 8 }, 'angel1');
  angel.roomId = 1;
  lv.monsters.push(angel);
  lv.boss = { kind: 'angels', defeated: false, rooms };
  return lv;
}
