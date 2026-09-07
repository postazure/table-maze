import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ANGEL_STEP_MS, HEART, ITEM_SLOT, Tile, key, manhattan } from '../src/engine/types';
import type {
  BossData,
  GameState,
  LevelData,
  MagicItem,
  Monster,
  Rect,
  RunStats,
  Shrine,
  ShrineKind,
  Vec,
} from '../src/engine/types';
import { makeRng } from '../src/engine/rng';
import { Game } from '../src/engine/game';
import { LOG_MAX, damageMonster, gameOver, heroAttack, heroAttackValue, monsterAttack, pushLog, pushSfx } from '../src/engine/combat';
import { updateMonsters } from '../src/engine/monsters';
import { clearSave, loadGame, saveGame } from '../src/engine/save';
import { equip, heroMoveMs, upgradeRandomItem } from '../src/engine/items';
import { SHOP_MARGIN, generateShopLevel, offerAt } from '../src/engine/shop';
import { makeBossMonster } from '../src/engine/boss';
import { bossRetryCost, lurkerSightRange, newHero } from '../src/engine/balance';
import { generateLevel } from '../src/engine/maze';
import {
  BUFF_URGENT_MS,
  BUFF_WARN_MS,
  FREEZE_MS,
  addBuff,
  buffPhase,
  SPIRIT_MAX_MULT,
  buffDef,
  frostIntervalMs,
  furyAtk,
  shrineDurationMs,
  spiritMult,
  stoneDef,
  wardTempHp,
} from '../src/engine/shrines';

// ---------------------------------------------------------------------------
// Test fixtures: hand-drawn levels so nothing depends on the generator.
// ---------------------------------------------------------------------------

/** '#' = wall, anything else = floor. 'S' marks start, 'E' marks the exit. */
function mkLevel(rows: string[], over: Partial<LevelData> = {}): LevelData {
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[][] = rows.map((r) => Array.from(r, (c) => (c === '#' ? Tile.Wall : Tile.Floor)));
  let start: Vec = { x: 1, y: 1 };
  let exit: Vec = { x: width - 2, y: height - 2 };
  rows.forEach((r, y) =>
    Array.from(r).forEach((c, x) => {
      if (c === 'S') start = { x, y };
      if (c === 'E') exit = { x, y };
    }),
  );
  return {
    depth: 1,
    seed: 1,
    kind: 'maze',
    theme: 'crypt',
    width,
    height,
    tiles,
    start,
    exit,
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
    ...over,
  };
}

function mkMonster(over: Partial<Monster> & { pos: Vec }): Monster {
  const base: Monster = {
    id: 'm1',
    kind: 'guard',
    name: 'Skeleton',
    glyph: '\u{1F480}',
    pos: { x: 0, y: 0 },
    rpos: { x: 0, y: 0 },
    home: { x: 0, y: 0 },
    hp: 5,
    maxHp: 5,
    atk: 2,
    def: 0,
    xp: 5,
    gold: 3,
    moveInterval: 400,
    moveCooldown: 0,
    attackInterval: 700,
    attackCooldown: 0,
    state: 'idle',
    sightRange: 4,
    leash: 8,
    alive: true,
    level: 1,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    frozenMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
  const m: Monster = { ...base, ...over };
  m.pos = { ...over.pos };
  m.rpos = over.rpos ? { ...over.rpos } : { ...over.pos };
  m.home = over.home ? { ...over.home } : { ...over.pos };
  return m;
}

/** Drop a hand-made level into a game and stand the hero on `at`. */
function install(g: Game, level: LevelData, at: Vec): void {
  const st = g.state;
  st.level = level;
  st.hero.pos = { ...at };
  st.hero.rpos = { ...at };
  st.trail = new Set<string>([key(at)]);
  st.path = [];
  st.pointer = null;
  st.fx = [];
  st.sfx = [];
  st.descending = 0;
}

/**
 * A hand-made boss chamber. Same map syntax as `mkLevel`, plus the `BossData`
 * the per-tick rules read. The real generators live behind `generateBossLevel`
 * and nothing here depends on their layouts.
 */
function mkBossLevel(rows: string[], boss: BossData, over: Partial<LevelData> = {}): LevelData {
  return mkLevel(rows, { kind: 'boss', depth: 3, boss, ...over });
}

/** Necromancer state with the shipped numbers, overridable per test. */
function necroData(over: Partial<Extract<BossData, { kind: 'necromancer' }>> = {}): BossData {
  return {
    kind: 'necromancer',
    defeated: false,
    spellMs: 90000,
    spellTotalMs: 90000,
    spawnMs: 4000,
    spawnEveryMs: 5000,
    maxMinions: 8,
    crystalsTotal: 2,
    ...over,
  };
}

/** A 9x3 straight corridor along y = 1. */
const CORRIDOR = ['#########', '#.......#', '#########'];
/** A 15x3 corridor for tests that need room to run away. */
const LONG_CORRIDOR = ['#'.repeat(15), `#${'.'.repeat(13)}#`, '#'.repeat(15)];
/** A 7x7 chamber (floor at 1..5 both ways) for the necromancer's tests. */
const CHAMBER = ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######'];

/** Trail keys "1,1" .. "n,1". */
function trailTo(n: number): Set<string> {
  const out = new Set<string>();
  for (let x = 1; x <= n; x++) out.add(`${x},1`);
  return out;
}

function corridorGame(over: Partial<LevelData> = {}): Game {
  const g = Game.forTest(1234);
  install(g, mkLevel(CORRIDOR, over), { x: 1, y: 1 });
  return g;
}

// ---------------------------------------------------------------------------

test('pointerAt queues an adjacent tile and tick(140) walks the hero', () => {
  const g = corridorGame();
  g.pointerAt({ x: 2, y: 1 });
  assert.equal(g.state.path.length, 1);

  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
  assert.equal(g.state.path.length, 0);
  assert.ok(g.state.trail.has('2,1'));
  assert.ok(g.state.trail.has('1,1'));
});

test('pointerAt bfs-jumps to a nearby tile and truncates on backtrack', () => {
  const g = corridorGame();
  g.pointerAt({ x: 4, y: 1 }); // 3 tiles away -> auto path
  assert.deepEqual(g.state.path, [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
  ]);

  g.pointerAt({ x: 2, y: 1 }); // already queued -> truncate back to it
  assert.equal(g.state.path.length, 1);

  g.pointerAt({ x: 1, y: 1 }); // the hero's own tile -> cancel
  assert.equal(g.state.path.length, 0);

  g.pointerEnd();
  assert.equal(g.state.pointer, null);
});

test('walking onto a key picks it up', () => {
  const g = corridorGame({
    keys: [{ id: 'k1', pos: { x: 2, y: 1 }, kind: 'door', taken: false }],
  });
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.equal(g.state.hero.keys.door, 1);
  assert.equal(g.state.level.keys[0].taken, true);
});

test('chests are solid: the hero bumps them, opens with a key, and the game freezes', () => {
  const g = corridorGame({
    chests: [
      {
        id: 'c1',
        pos: { x: 2, y: 1 },
        opened: false,
        loot: { gold: 12, xp: 3, item: { name: 'Iron Sword', atk: 2 } },
      },
    ],
  });
  const atk0 = g.state.hero.atk;

  // No key: bump, red blink, stay put, nothing opens.
  g.pointerAt({ x: 2, y: 1 });
  assert.equal(g.state.path.length, 1, 'a chest is a legal drag target');
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 }, 'never stands on a chest');
  assert.equal(g.state.level.chests[0].opened, false, 'locked without a key');
  assert.equal(g.state.hero.atk, atk0);
  assert.ok(g.state.fx.some((f) => f.kind === 'flash'), 'locked cue is a flash, not words');
  assert.equal(g.state.modal, null);

  // With a key: opens, loot applies at once, modal freezes the world.
  g.state.hero.keys.chest = 1;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 });
  assert.equal(g.state.level.chests[0].opened, true);
  assert.equal(g.state.hero.keys.chest, 0);
  assert.equal(g.state.hero.gold, 12);
  assert.equal(g.state.hero.atk, atk0 + 2);
  const modal = g.state.modal as { kind: string; loot: { item?: { name: string } } } | null;
  assert.ok(modal, 'a modal is up');
  assert.equal(modal.kind, 'chest');
  assert.equal(modal.loot.item?.name, 'Iron Sword');

  const playMs = g.state.stats.playMs;
  g.pointerAt({ x: 1, y: 2 });
  g.tick(500);
  assert.equal(g.state.stats.playMs, playMs, 'time stands still under the modal');
  assert.equal(g.state.path.length, 0, 'input is ignored under the modal');

  g.dismissModal();
  assert.equal(g.state.modal, null);
  g.tick(16);
  assert.ok(g.state.stats.playMs > playMs, 'the world runs again');

  // An opened chest is still solid and no longer a drag target.
  g.pointerAt({ x: 2, y: 1 });
  assert.equal(g.state.path.length, 0);
  // Path-finding routes around chests: the corridor is blocked past it.
  g.pointerAt({ x: 4, y: 1 });
  assert.equal(g.state.path.length, 0, 'cannot path through a chest');
});

test('a closed door blocks without a key and opens with one', () => {
  const g = corridorGame({
    doors: [{ id: 'd1', pos: { x: 2, y: 1 }, open: false }],
  });

  g.pointerAt({ x: 2, y: 1 });
  assert.equal(g.state.path.length, 0, 'a locked door is not a legal drag target');
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 });
  assert.equal(g.state.level.doors[0].open, false);

  g.state.hero.keys.door = 1;
  g.pointerAt({ x: 2, y: 1 });
  assert.equal(g.state.path.length, 1);
  g.tick(150);
  assert.equal(g.state.level.doors[0].open, true);
  assert.equal(g.state.hero.keys.door, 0);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
});

test('stepping onto the exit starts the descent and advances the depth', () => {
  const g = corridorGame();
  g.state.level.exit = { x: 2, y: 1 };
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.ok(g.state.descending > 0);

  g.tick(800);
  assert.equal(g.state.descending, 0);
  assert.equal(g.state.depth, 2);
  assert.equal(g.state.stats.deepest, 2);
  assert.equal(g.state.hero.keys.door, 0);
  assert.deepEqual(g.state.hero.pos, g.state.level.start);
  assert.equal(g.state.trail.size, 1);
});

test('heroAttack kills a 1hp monster and grants xp/gold', () => {
  const g = corridorGame();
  const m = mkMonster({ pos: { x: 2, y: 1 }, hp: 1, xp: 5, gold: 3 });
  g.state.level.monsters.push(m);

  heroAttack(g.state, m, makeRng(7));
  assert.equal(m.alive, false);
  assert.ok(m.hp <= 0);
  assert.equal(g.state.hero.xp, 5);
  assert.equal(g.state.hero.gold, 3);
  assert.equal(g.state.stats.kills, 1);
  assert.ok(g.state.log.some((l) => l.text.includes('Slew the')));
});

test('walking into a monster attacks it and clears the queued path', () => {
  const g = corridorGame();
  const m = mkMonster({
    pos: { x: 3, y: 1 },
    hp: 30,
    maxHp: 30,
    attackInterval: 99999,
    attackCooldown: 99999,
  });
  g.state.level.monsters.push(m);

  g.pointerAt({ x: 3, y: 1 });
  assert.equal(g.state.path.length, 2, 'a monster is a legal drag target');
  g.tick(150); // step to (2,1)
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
  g.state.pointer = null; // no hold-to-attack for this assertion
  g.tick(150); // swing instead of stepping
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
  assert.ok(m.hp < 30);
  assert.equal(g.state.path.length, 0);
});

test('monsterAttack knocks the hero down without ever killing them', () => {
  const g = Game.forTest(1234);
  install(g, mkLevel(LONG_CORRIDOR), { x: 10, y: 1 });
  const st = g.state;
  // Walk a trail 1,1 .. 10,1 by hand.
  st.trail = trailTo(10);
  st.hero.pos = { x: 10, y: 1 };
  st.hero.hp = 1;
  st.hero.maxHp = 20;
  const m = mkMonster({ pos: { x: 11, y: 1 }, atk: 50, sightRange: 4 });
  st.level.monsters.push(m);

  monsterAttack(st, m, makeRng(3));

  assert.ok(st.hero.hp >= 1, 'hero hp never drops below 1');
  assert.equal(st.hero.hp, 1, 'wakes up from a quarter heart');
  assert.equal(st.hero.sleeping, true);
  assert.equal(st.path.length, 0);
  // Knocked back to 9,1, then carried to the most recent trail tile that is
  // out of the monster's reach and sight (>= sightRange + 2 = 6 tiles).
  assert.deepEqual(st.hero.pos, { x: 5, y: 1 });
  assert.ok(st.log.some((l) => l.text === 'Knocked down!'));
  assert.ok(st.fx.some((f) => f.kind === 'shake'));
});

test('retreat skips tiles near a monster or on a patrol route', () => {
  const g = Game.forTest(1234);
  install(g, mkLevel(LONG_CORRIDOR), { x: 10, y: 1 });
  const st = g.state;
  st.trail = trailTo(10);
  st.hero.pos = { x: 10, y: 1 };
  st.hero.hp = 1;
  const m = mkMonster({ pos: { x: 11, y: 1 }, atk: 50, sightRange: 4 });
  // A beat walker sitting where the hero would otherwise have been dropped.
  const patrol = mkMonster({
    id: 'p1',
    kind: 'patrol',
    pos: { x: 5, y: 1 },
    sightRange: 1,
    patrolPath: [
      { x: 5, y: 1 },
      { x: 6, y: 1 },
    ],
    attackInterval: 99999,
  });
  st.level.monsters.push(m, patrol);

  monsterAttack(st, m, makeRng(3));
  // 6,1..9,1 are too close to the guard, 2,1..8,1 too close to the patrol (and
  // its route is out of bounds anyway): the hero wakes up back at the start.
  assert.deepEqual(st.hero.pos, { x: 1, y: 1 });
});

test('a sleeping hero ignores input, heals to full, then wakes', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 12;
  hero.hp = 1;
  hero.sleeping = true;
  g.pointerAt({ x: 2, y: 1 });
  assert.equal(g.state.path.length, 0, 'no path while asleep');
  g.tick(300);
  assert.deepEqual(hero.pos, { x: 1, y: 1 });
  assert.ok(hero.hp > 1, 'sleep heals fast');
  assert.equal(hero.sleeping, true);
  for (let i = 0; i < 40 && hero.sleeping; i++) g.tick(100);
  assert.equal(hero.sleeping, false, 'awake within ~4s');
  assert.equal(hero.hp, hero.maxHp, 'woke at full health');
  assert.ok(g.state.fx.some((f) => f.kind === 'flash'), 'wake-up flash');
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.deepEqual(hero.pos, { x: 2, y: 1 }, 'control is back');
});

test('monsters leave a sleeping hero alone', () => {
  const m = mkMonster({ pos: { x: 2, y: 1 }, kind: 'lurker', state: 'chasing', sightRange: 5, leash: 9, home: { x: 6, y: 1 } });
  const g = corridorGame({ monsters: [m] });
  const hero = g.state.hero;
  hero.maxHp = 40;
  hero.hp = 1;
  hero.sleeping = true;
  const rng = makeRng(2);
  for (let i = 0; i < 20; i++) updateMonsters(g.state, 100, rng);
  assert.ok(hero.hp >= 1 && hero.hitFlash === 0, 'never attacked while asleep');
  assert.notEqual(m.state, 'chasing', 'the lurker gives up the chase and holds its ground');
});

test('the world holds still while the hero sleeps off a knockdown', () => {
  const m = mkMonster({ pos: { x: 3, y: 1 }, kind: 'lurker', state: 'chasing', sightRange: 5, leash: 9, home: { x: 6, y: 1 }, moveInterval: 50 });
  const g = corridorGame({ monsters: [m] });
  const hero = g.state.hero;
  hero.maxHp = 40;
  hero.hp = 1;
  hero.sleeping = true;
  const before = { ...m.pos };

  for (let i = 0; i < 10; i++) g.tick(100);

  assert.deepEqual(m.pos, before, 'monsters do not so much as step while hearts refill');
  assert.equal(m.state, 'chasing', 'nothing about the monster is re-evaluated either');
  assert.ok(hero.hp > 1, 'hearts are refilling meanwhile');
});

test('out-of-combat regen ticks 1hp every 600ms', () => {
  const g = corridorGame();
  g.state.hero.hp = 5;
  g.state.hero.maxHp = 20;
  g.state.hero.sinceCombat = 5000;
  g.tick(600);
  assert.equal(g.state.hero.hp, 6);
  g.tick(600);
  assert.equal(g.state.hero.hp, 7);
});

test('standing still for 3s speeds up regen from 600ms/hp to 480ms/hp', () => {
  const g = corridorGame();
  g.state.hero.maxHp = 20;
  g.state.hero.hp = 20; // full: regen is a no-op while we prime the still timer
  g.state.hero.sinceCombat = 5000;
  g.state.path.length = 0;

  g.tick(3000); // stand still for exactly the 3s threshold
  assert.equal(g.state.hero.hp, 20, 'still full, nothing to regen yet');

  g.state.hero.hp = 10;
  g.tick(480);
  assert.equal(g.state.hero.hp, 11, '480ms is enough once the still bonus is active');
  g.tick(480);
  assert.equal(g.state.hero.hp, 12);
});

test('moving resets the standing-still regen bonus', () => {
  const g = corridorGame();
  g.state.hero.maxHp = 20;
  g.state.hero.hp = 20;
  g.state.hero.sinceCombat = 5000;
  g.state.path.length = 0;

  g.tick(3000); // stand still long enough to earn the bonus
  g.pointerAt({ x: 2, y: 1 }); // queue a single step
  g.tick(heroMoveMs(g.state.hero));
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 }, 'the hero actually moved');

  g.state.hero.hp = 10;
  g.tick(480);
  assert.equal(g.state.hero.hp, 10, 'the step reset the still timer: 480ms is not enough at the normal rate');
  g.tick(120);
  assert.equal(g.state.hero.hp, 11, 'normal rate resumes: 600ms after the step');
});

test('a lurker starts chasing when the hero comes within sightRange', () => {
  // 7x5 with a single corridor along y = 2, floors at x = 1..5.
  const level = mkLevel(['#######', '#######', '#.....#', '#######', '#######']);
  const g = Game.forTest(99);
  install(g, level, { x: 1, y: 2 });

  const lurk = mkMonster({
    id: 'l1',
    kind: 'lurker',
    pos: { x: 5, y: 2 },
    home: { x: 5, y: 2 },
    sightRange: 3,
    leash: 6,
    moveInterval: 200,
    attackInterval: 99999,
  });
  level.monsters.push(lurk);
  const rng = makeRng(11);

  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng); // hero 4 tiles away -> out of sight
  assert.equal(lurk.state, 'idle');
  assert.deepEqual(lurk.pos, { x: 5, y: 2 });

  g.state.hero.pos = { x: 2, y: 2 }; // now 3 tiles away
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'chasing');
  assert.deepEqual(lurk.pos, { x: 4, y: 2 }, 'steps toward the hero');

  // Out of leash from home -> gives up and holds its ground.
  g.state.hero.pos = { x: 1, y: 2 };
  lurk.leash = 1;
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'returning');
  assert.deepEqual(lurk.pos, { x: 4, y: 2 }, 'stays put instead of walking home');
});

test('lurker aggro range shrinks with the level gap, capped both ways', () => {
  // At or under the hero's level: the full range, never more.
  assert.equal(lurkerSightRange(4, 3, 3), 4);
  assert.equal(lurkerSightRange(4, 1, 9), 4, 'out-levelling one does not sharpen it');
  // One level over: one tile less. Two over: two.
  assert.equal(lurkerSightRange(4, 4, 3), 3);
  assert.equal(lurkerSightRange(4, 5, 3), 2);
  // The drop is capped at two tiles however far ahead it gets...
  assert.equal(lurkerSightRange(4, 20, 1), 2);
  // ...and it never falls under two tiles, whatever the base.
  assert.equal(lurkerSightRange(3, 20, 1), 2);
});

test('a lurker over the hero level waits until they are closer', () => {
  // 11x5 with a single corridor along y = 2, floors at x = 1..9.
  const level = mkLevel(['###########', '###########', '#.........#', '###########', '###########']);
  const g = Game.forTest(7);
  install(g, level, { x: 1, y: 2 });

  const lurk = mkMonster({
    id: 'l2',
    kind: 'lurker',
    pos: { x: 7, y: 2 },
    home: { x: 7, y: 2 },
    sightRange: 4,
    leash: 8,
    level: 4, // two clear levels over a level-one hero
    moveInterval: 200,
    attackInterval: 99999,
  });
  level.monsters.push(lurk);
  const rng = makeRng(23);

  g.state.hero.level = 1;
  g.state.hero.pos = { x: 4, y: 2 }; // 3 tiles: inside its base range, outside the cut-back one
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'idle', 'a hero three levels under gets room to back out');

  g.state.hero.pos = { x: 5, y: 2 }; // 2 tiles
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'chasing', 'step close enough and it still comes');
});

test('a lurker reaches its full range once the hero catches up', () => {
  const level = mkLevel(['###########', '###########', '#.........#', '###########', '###########']);
  const g = Game.forTest(7);
  install(g, level, { x: 1, y: 2 });

  const lurk = mkMonster({
    id: 'l3',
    kind: 'lurker',
    pos: { x: 7, y: 2 },
    home: { x: 7, y: 2 },
    sightRange: 4,
    leash: 8,
    level: 4,
    moveInterval: 200,
    attackInterval: 99999,
  });
  level.monsters.push(lurk);
  const rng = makeRng(23);

  g.state.hero.level = 4; // level with it
  g.state.hero.pos = { x: 3, y: 2 }; // 4 tiles away
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'chasing');
});

test('a guard never moves and only fights once it has been hit', () => {
  const g = corridorGame();
  const guard = mkMonster({ pos: { x: 2, y: 1 }, kind: 'guard', hp: 30, maxHp: 30, atk: 3, attackInterval: 700 });
  g.state.level.monsters.push(guard);
  g.state.hero.hp = 20;
  g.state.hero.maxHp = 20;

  updateMonsters(g.state, 16, makeRng(5));
  assert.deepEqual(guard.pos, { x: 2, y: 1 }, 'guards never move');
  assert.equal(g.state.hero.hp, 20, 'an untouched guard lets the hero squeeze by');

  heroAttack(g.state, guard, makeRng(5)); // provoke it
  updateMonsters(g.state, 16, makeRng(5));
  assert.ok(g.state.hero.hp < 20, 'once hit, it hits back');
  assert.equal(guard.attackCooldown, 700);

  // ...and it settles down again after a few quiet seconds.
  g.state.hero.hp = 20;
  guard.attackCooldown = 0;
  updateMonsters(g.state, 6000, makeRng(5));
  assert.equal(g.state.hero.hp, 20, 'the guard goes back to dozing');
});

test('a patrol walks its route back and forth', () => {
  const level = mkLevel(['#######', '#######', '#.....#', '#######', '#######']);
  const g = Game.forTest(5);
  install(g, level, { x: 1, y: 2 });
  g.state.hero.pos = { x: 1, y: 2 };

  const route: Vec[] = [
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 5, y: 2 },
  ];
  const p = mkMonster({
    id: 'p1',
    kind: 'patrol',
    pos: { x: 4, y: 2 },
    home: { x: 4, y: 2 },
    patrolPath: route,
    patrolIndex: 1,
    patrolDir: 1,
    sightRange: 0,
    moveInterval: 100,
    attackInterval: 99999,
  });
  level.monsters.push(p);
  const rng = makeRng(2);

  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    p.moveCooldown = 0;
    updateMonsters(g.state, 16, rng);
    seen.push(key(p.pos));
  }
  assert.deepEqual(seen, ['5,2', '4,2', '3,2', '4,2'], 'bounces at both ends');
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

class MemStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

function useMemStorage(): MemStorage {
  const mem = new MemStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mem,
    configurable: true,
    writable: true,
  });
  return mem;
}

test('save/load round-trips a run', () => {
  useMemStorage();
  const g = Game.forTest(4242);
  g.pointerAt({ x: g.state.hero.pos.x, y: g.state.hero.pos.y });
  g.state.hero.gold = 17;
  g.state.stats.kills = 3;

  saveGame(g.state);
  const loaded = loadGame() as GameState;
  assert.ok(loaded, 'a save round-trips');
  assert.equal(loaded.seed, g.state.seed);
  assert.equal(loaded.depth, g.state.depth);
  assert.equal(loaded.hero.gold, 17);
  assert.equal(loaded.stats.kills, 3);
  assert.ok(loaded.trail instanceof Set);
  assert.equal(loaded.trail.size, g.state.trail.size);
  assert.equal(loaded.level.width, g.state.level.width);
  assert.equal(loaded.level.tiles.length, g.state.level.height);
  assert.deepEqual(loaded.path, []);
  assert.equal(loaded.pointer, null);
  assert.deepEqual(loaded.fx, []);

  // A loaded state must be a usable Game.
  const g2 = new Game(loaded);
  assert.ok(g2.state.trail instanceof Set);
  g2.tick(16);

  clearSave();
  assert.equal(loadGame(), null);
});

test('loadGame rejects corrupt or stale saves', () => {
  const mem = useMemStorage();
  mem.setItem('table-maze:save', 'not json{{');
  assert.equal(loadGame(), null);
  mem.setItem('table-maze:save', JSON.stringify({ version: 999, depth: 1, seed: 1 }));
  assert.equal(loadGame(), null);
  mem.setItem('table-maze:save', JSON.stringify({ version: 1, depth: 1, seed: 1 }));
  assert.equal(loadGame(), null);
});

test('a fresh run starts on the level start tile with a welcome message', () => {
  const g = Game.forTest(777);
  assert.deepEqual(g.state.hero.pos, g.state.level.start);
  assert.equal(g.state.depth, 1);
  assert.equal(g.state.trail.size, 1);
  assert.ok(g.state.log.some((l) => l.text.includes('Drag your finger')));
});

test('onChange fires when the hero actually moves', () => {
  const g = corridorGame();
  let calls = 0;
  g.onChange = () => {
    calls += 1;
  };
  g.tick(16);
  assert.equal(calls, 0, 'idle ticks do not persist');
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.equal(calls, 1);
});

test('monsters heal on their own once out of combat', () => {
  const m = mkMonster({ pos: { x: 7, y: 1 }, kind: 'guard', hp: 2, maxHp: 10, sinceCombat: 0 });
  const g = corridorGame({ monsters: [m] });
  const rng = makeRng(5);
  // Hero is far away (6 tiles); the guard never moves, so it just waits.
  updateMonsters(g.state, 3000, rng);
  assert.equal(m.hp, 2, 'no healing before the regen delay');
  updateMonsters(g.state, 1000 + 1500, rng);
  assert.equal(m.hp, 3, 'one hp after the delay plus one regen tick');
  updateMonsters(g.state, 1500 * 20, rng);
  assert.equal(m.hp, 10, 'never heals past maxHp');
});

test('monsters carry a level and combat resets their regen clock', () => {
  const m = mkMonster({ pos: { x: 2, y: 1 }, kind: 'guard', hp: 5, maxHp: 10, sinceCombat: 9000, level: 3 });
  const g = corridorGame({ monsters: [m] });
  assert.equal(m.level, 3);
  heroAttack(g.state, m, makeRng(1));
  assert.equal(m.sinceCombat, 0);
});

// ---------------------------------------------------------------------------
// Shops and magic items
// ---------------------------------------------------------------------------

/**
 * A game standing in a shop, `at` tiles, with `gold` in the purse. The default
 * spot is the floor tile just under the first podium's bottom-left corner.
 */
function shopGame(gold: number, at: Vec = { x: 3 + SHOP_MARGIN, y: 7 }): Game {
  const g = Game.forTest(2024);
  g.state.depth = 3;
  install(g, generateShopLevel(3, g.state.seed, g.state.hero), at);
  g.state.hero.gold = gold;
  return g;
}

test('a boss follows every third floor, then the shop, then the next depth', () => {
  const g = corridorGame();
  const st = g.state;
  st.depth = 3;
  st.stats.deepest = 3;
  st.level.exit = { x: 2, y: 1 };

  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  g.tick(800);
  assert.equal(st.level.kind, 'boss', 'depth 3 leads into the boss chamber');
  assert.equal(st.depth, 3, 'a boss chamber is not a new floor');
  assert.equal(st.stats.deepest, 3);
  assert.deepEqual(st.hero.pos, st.level.start);
  assert.equal(st.modal?.kind, 'bossIntro', 'and it opens with the briefing');

  // Nothing moves until the player has read who is down there.
  const frozen = st.stats.playMs;
  g.tick(500);
  assert.equal(st.stats.playMs, frozen, 'the world waits behind the intro');
  g.dismissModal();
  g.tick(16);
  assert.ok(st.stats.playMs > frozen, 'and runs once it is dismissed');

  // Out of a beaten chamber by its stairs: the shop, at the same depth.
  install(g, mkBossLevel(CORRIDOR, { kind: 'minotaur', defeated: true }, { exit: { x: 2, y: 1 } }), {
    x: 1,
    y: 1,
  });
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  g.tick(800);
  assert.equal(st.level.kind, 'shop', 'the boss is followed by the shop');
  assert.equal(st.depth, 3, 'a shop is not a new floor either');
  assert.deepEqual(st.hero.pos, st.level.start);
  assert.equal(st.level.shop?.offers.length, 3);
  assert.ok(st.log.some((l) => l.text === 'Shop'));

  // Out through the stairs at the top of the shop: on to depth 4.
  const stairs = st.level.exit;
  st.hero.pos = { x: stairs.x, y: stairs.y + 1 };
  st.hero.rpos = { x: stairs.x, y: stairs.y + 1 };
  g.pointerAt(stairs);
  g.tick(150);
  g.tick(800);
  assert.equal(st.level.kind, 'maze');
  assert.equal(st.depth, 4);
  assert.equal(st.stats.deepest, 4);
  assert.ok(st.log.some((l) => l.text === 'Depth 4'));
});

test('a podium fills four tiles and any of them opens the offer', () => {
  const g = shopGame(9999);
  const st = g.state;
  const shop = st.level.shop as NonNullable<LevelData['shop']>;
  const offer = shop.offers[0];

  // All four tiles of the block belong to the same podium and are solid.
  for (const d of [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ]) {
    const tile = { x: offer.pos.x + d.x, y: offer.pos.y + d.y };
    assert.equal(offerAt(st.level, tile)?.id, offer.id);
  }
  assert.equal(offerAt(st.level, { x: offer.pos.x - 1, y: offer.pos.y }), null);
  assert.equal(offerAt(st.level, { x: offer.pos.x, y: offer.pos.y + 2 }), null);

  // Walking into the bottom-left tile of the block opens the offer popup.
  const front = { x: offer.pos.x, y: offer.pos.y + 1 };
  g.pointerAt(front);
  assert.equal(st.path.length, 1, 'a podium is a legal drag target');
  g.tick(150);

  assert.deepEqual(st.hero.pos, { x: 3 + SHOP_MARGIN, y: 7 }, 'podiums are solid');
  const modal = st.modal as { kind: string; offerId: string; price: number; gold: number; soldOut: boolean } | null;
  assert.ok(modal, 'the offer popup is up');
  assert.equal(modal.kind, 'shopOffer');
  assert.equal(modal.offerId, offer.id);
  assert.equal(modal.price, offer.price);
  assert.equal(modal.gold, 9999);
  assert.equal(modal.soldOut, false);
  assert.equal(st.hero.gold, 9999, 'looking is free');
  assert.equal(shop.boughtItem, false);
});

test('buying from the offer popup pays, equips and shows the prize', () => {
  const g = shopGame(9999);
  const st = g.state;
  const shop = st.level.shop as NonNullable<LevelData['shop']>;
  const offer = shop.offers[0];

  g.pointerAt({ x: offer.pos.x, y: offer.pos.y + 1 });
  g.tick(150);
  g.buyOffer(offer.id);

  assert.equal(st.hero.gold, 9999 - offer.price, 'the gold is spent');
  assert.equal(shop.boughtItem, true);
  assert.equal(st.hero.gear[ITEM_SLOT[offer.item.kind]]?.kind, offer.item.kind);
  const modal = st.modal as { kind: string; item: MagicItem; replaced: MagicItem | null } | null;
  assert.ok(modal, 'a popup shows the new item');
  assert.equal(modal.kind, 'item');
  assert.equal(modal.item.kind, offer.item.kind);
  assert.equal(modal.replaced, null);
  assert.ok(st.fx.some((f) => f.kind === 'ring'));

  // The other podiums are sold out: the popup says so and buying is refused.
  g.dismissModal();
  const other = shop.offers[1];
  st.hero.pos = { x: other.pos.x, y: other.pos.y + 2 };
  const goldLeft = st.hero.gold;
  g.pointerAt({ x: other.pos.x, y: other.pos.y + 1 });
  g.tick(150);
  const sold = st.modal as { kind: string; soldOut: boolean } | null;
  assert.ok(sold);
  assert.equal(sold.kind, 'shopOffer');
  assert.equal(sold.soldOut, true);
  g.buyOffer(other.id);
  assert.equal(st.hero.gear[ITEM_SLOT[other.item.kind]], null, 'only one item per shop');
  assert.equal(st.hero.gold, goldLeft);
});

test('a podium the hero cannot afford opens but will not sell', () => {
  const g = shopGame(0);
  const st = g.state;
  const shop = st.level.shop as NonNullable<LevelData['shop']>;
  const offer = shop.offers[0];

  g.pointerAt({ x: offer.pos.x, y: offer.pos.y + 1 });
  g.tick(150);
  const modal = st.modal as { kind: string; gold: number; price: number } | null;
  assert.ok(modal);
  assert.equal(modal.kind, 'shopOffer');
  assert.equal(modal.gold, 0);
  assert.ok(modal.price > 0);

  g.buyOffer(offer.id);
  assert.equal(st.hero.gold, 0);
  assert.equal(shop.boughtItem, false);
  assert.equal(st.hero.gear.offense, null);
  assert.equal((st.modal as { kind: string }).kind, 'shopOffer', 'the popup stays up');
});

test('the offer popup names the item it would replace', () => {
  const g = shopGame(9999);
  const st = g.state;
  const shop = st.level.shop as NonNullable<LevelData['shop']>;
  const offer = shop.offers[0];
  const worn: MagicItem = { kind: offer.item.kind === 'longSword' ? 'frostBlade' : 'longSword', level: 2 };
  equip(st.hero, worn);

  g.pointerAt({ x: offer.pos.x, y: offer.pos.y + 1 });
  g.tick(150);
  const modal = st.modal as { kind: string; replaces: MagicItem | null } | null;
  assert.ok(modal);
  assert.equal(modal.replaces?.kind, worn.kind);
});

test('the long sword swings two tiles down a straight corridor', () => {
  const g = corridorGame();
  equip(g.state.hero, { kind: 'longSword', level: 3 });
  const m = mkMonster({
    pos: { x: 3, y: 1 },
    hp: 40,
    maxHp: 40,
    attackInterval: 99999,
    attackCooldown: 99999,
  });
  g.state.level.monsters.push(m);

  g.pointerAt({ x: 3, y: 1 });
  assert.equal(g.state.path.length, 2);
  g.state.pointer = null; // no hold-to-attack for this assertion
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 }, 'the hero holds their ground');
  assert.ok(m.hp < 40, 'and still lands the hit');
  assert.equal(g.state.path.length, 0);
  assert.ok(g.state.fx.some((f) => f.kind === 'slash'));

  // Holding the finger on a monster two tiles away keeps swinging.
  const hp = m.hp;
  g.pointerAt({ x: 3, y: 1 });
  g.tick(400);
  assert.ok(m.hp < hp, 'hold-to-attack reaches too');
});

test('the shield amulet eats one hit and recharges on its timer', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 20;
  hero.hp = 20;
  equip(hero, { kind: 'shieldAmulet', level: 1 }); // 7600ms recharge
  hero.shieldReady = true;
  const m = mkMonster({ pos: { x: 2, y: 1 }, atk: 5 });
  g.state.level.monsters.push(m);

  monsterAttack(g.state, m, makeRng(3));
  assert.equal(hero.hp, 20, 'the bubble swallowed the hit');
  assert.equal(hero.shieldReady, false);
  assert.deepEqual(hero.pos, { x: 1, y: 1 }, 'and the knockback with it');
  assert.ok(g.state.fx.some((f) => f.kind === 'ring'));
  assert.ok(!g.state.fx.some((f) => f.kind === 'text'), 'wordless');

  monsterAttack(g.state, m, makeRng(3));
  assert.ok(hero.hp < 20, 'the next hit lands');

  hero.hp = 20;
  g.state.level.monsters.length = 0;
  g.tick(7000);
  assert.equal(hero.shieldReady, false, 'not yet');
  g.tick(700);
  assert.equal(hero.shieldReady, true, 'the bubble is back');
});

test('the poison dagger keeps hurting once a second', () => {
  const g = corridorGame();
  equip(g.state.hero, { kind: 'poisonDagger', level: 4 }); // 5s, 2 per tick
  const m = mkMonster({
    pos: { x: 2, y: 1 },
    hp: 40,
    maxHp: 40,
    attackInterval: 99999,
    attackCooldown: 99999,
  });
  g.state.level.monsters.push(m);

  heroAttack(g.state, m, makeRng(9));
  assert.equal(m.poisonMs, 5000);
  assert.equal(m.poisonDmg, 2);
  const hp = m.hp;

  updateMonsters(g.state, 500, makeRng(1));
  assert.equal(m.hp, hp, 'nothing before the first second is up');
  updateMonsters(g.state, 500, makeRng(1));
  assert.equal(m.hp, hp - 2, 'one tick per second');
  assert.equal(m.poisonMs, 4000);

  for (let i = 0; i < 8; i++) updateMonsters(g.state, 500, makeRng(1));
  assert.equal(m.poisonMs, 0);
  assert.equal(m.poisonDmg, 0);
  assert.equal(m.hp, hp - 10, 'five ticks in all, then it wears off');
});

test('the frost blade halves a monster pace until it thaws', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 40;
  hero.hp = 40;
  equip(hero, { kind: 'frostBlade', level: 2 }); // 2600ms
  const m = mkMonster({ pos: { x: 2, y: 1 }, hp: 40, maxHp: 40, atk: 1, attackInterval: 800 });
  g.state.level.monsters.push(m);

  heroAttack(g.state, m, makeRng(4));
  assert.equal(m.slowMs, 2600);

  updateMonsters(g.state, 16, makeRng(4));
  assert.equal(m.attackCooldown, 1600, 'attacks come at half speed');

  updateMonsters(g.state, 3000, makeRng(4));
  assert.equal(m.slowMs, 0, 'and it thaws out');
});

test('the fire staff throws a fireball at the nearest monster', () => {
  const g = corridorGame();
  equip(g.state.hero, { kind: 'fireStaff', level: 1 }); // every 5600ms, 3 damage
  const near = mkMonster({ id: 'a', pos: { x: 4, y: 1 }, hp: 40, maxHp: 40, attackInterval: 99999, attackCooldown: 99999 });
  const beside = mkMonster({ id: 'b', pos: { x: 5, y: 1 }, hp: 40, maxHp: 40, attackInterval: 99999, attackCooldown: 99999 });
  const far = mkMonster({ id: 'c', pos: { x: 7, y: 1 }, hp: 40, maxHp: 40, attackInterval: 99999, attackCooldown: 99999 });
  g.state.level.monsters.push(near, beside, far);

  g.tick(5500);
  assert.equal(near.hp, 40, 'the staff is still charging');
  g.tick(200);
  assert.equal(near.hp, 37, 'the nearest monster takes the fireball');
  assert.equal(beside.hp, 39, 'its neighbour catches half');
  assert.equal(far.hp, 40, 'the one down the hall is untouched');
  assert.ok(g.state.fx.some((f) => f.kind === 'projectile'));
  assert.ok(g.state.fx.some((f) => f.kind === 'ring' && f.t < 0), 'the burst is delayed');
});

test('thorn mail bites the monster that hit the hero', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 30;
  hero.hp = 30;
  equip(hero, { kind: 'thornMail', level: 6 }); // 3 back
  const m = mkMonster({ pos: { x: 2, y: 1 }, hp: 20, maxHp: 20, atk: 3 });
  g.state.level.monsters.push(m);

  monsterAttack(g.state, m, makeRng(6));
  assert.ok(hero.hp < 30, 'the hit still lands');
  assert.equal(m.hp, 17, 'and the mail bites back');
});

test('a knockdown heals every monster still standing back to full', () => {
  const g = Game.forTest(1234);
  install(g, mkLevel(LONG_CORRIDOR), { x: 10, y: 1 });
  const st = g.state;
  st.trail = trailTo(10);
  st.hero.hp = 1;
  st.hero.maxHp = 20;
  const bruiser = mkMonster({ id: 'b', pos: { x: 11, y: 1 }, atk: 50, hp: 3, maxHp: 30, sightRange: 4 });
  const poisoned = mkMonster({ id: 'p', pos: { x: 13, y: 1 }, hp: 10, maxHp: 25, poisonMs: 3000, poisonDmg: 2, slowMs: 1500 });
  const corpse = mkMonster({ id: 'c', pos: { x: 12, y: 1 }, hp: 0, maxHp: 20, alive: false });
  st.level.monsters.push(bruiser, poisoned, corpse);

  monsterAttack(st, bruiser, makeRng(3));
  assert.equal(st.hero.sleeping, true);
  assert.equal(bruiser.hp, 30, 'the one that hit you is back to full');
  assert.equal(poisoned.hp, 25, 'so is everything else on the floor');
  assert.equal(poisoned.poisonMs, 0, 'poison is cured');
  assert.equal(poisoned.poisonDmg, 0);
  assert.equal(poisoned.slowMs, 0, 'frost thaws');
  assert.equal(corpse.alive, false, 'the dead stay dead');
  assert.equal(corpse.hp, 0);
  assert.equal(st.fx.filter((f) => f.kind === 'flash').length, 2, 'a green cue on each healed monster');
});

test('the phoenix feather burst is not a knockdown: monsters stay hurt', () => {
  const g = corridorGame();
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 20;
  hero.hp = 1;
  hero.pos = { x: 4, y: 1 };
  equip(hero, { kind: 'phoenixFeather', level: 3 });
  const m = mkMonster({ pos: { x: 3, y: 1 }, atk: 50, hp: 5, maxHp: 30 });
  st.level.monsters.push(m);
  monsterAttack(st, m, makeRng(5));
  assert.equal(hero.sleeping, false, 'the feather kept the hero up');
  assert.equal(m.hp, 5, 'nothing healed');
});

test('the phoenix feather skips one knockdown, then needs its cooldown', () => {
  const g = corridorGame();
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 20;
  hero.hp = 1;
  equip(hero, { kind: 'phoenixFeather', level: 1 }); // 28.5s cooldown
  st.trail = new Set(['1,1', '2,1', '3,1', '4,1', '5,1']);
  hero.pos = { x: 5, y: 1 };
  const m = mkMonster({ pos: { x: 6, y: 1 }, atk: 50 });
  st.level.monsters.push(m);

  monsterAttack(st, m, makeRng(3));
  assert.equal(hero.sleeping, false, 'straight back onto their feet');
  assert.equal(hero.hp, 12, 'half the hearts, rounded up to whole ones');
  assert.equal(hero.timers.phoenix, 28500);
  assert.ok(st.fx.some((f) => f.kind === 'ring'));
  assert.ok(st.log.some((l) => l.text.includes('feather')));

  // The cooldown runs down with the clock...
  g.tick(1000);
  assert.equal(hero.timers.phoenix, 27500);

  // ...and a second knockdown before it is up is an ordinary nap.
  hero.pos = { x: 5, y: 1 };
  hero.hp = 1;
  monsterAttack(st, m, makeRng(3));
  assert.equal(hero.sleeping, true);
  assert.equal(hero.hp, 1);
});

test('a health potion bursts the hero back up instead of a knockdown', () => {
  const g = corridorGame();
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 20;
  hero.hp = 1;
  hero.potionCapacity = 2;
  hero.potions = 2;
  st.trail = new Set(['1,1', '2,1', '3,1', '4,1', '5,1']);
  hero.pos = { x: 5, y: 1 };
  const m = mkMonster({ pos: { x: 6, y: 1 }, atk: 50 });
  st.level.monsters.push(m);

  monsterAttack(st, m, makeRng(3));
  assert.equal(hero.sleeping, false, 'the potion kept the hero up');
  assert.equal(hero.hp, 12, 'half the hearts, rounded up to whole ones');
  assert.equal(hero.potions, 1, 'one charge spent');
  assert.ok(st.fx.some((f) => f.kind === 'ring'));
  assert.ok(
    st.fx.some((f) => f.kind === 'text' && f.text === 'Potion!'),
    'a floating cue over the hero says a potion was used',
  );
  assert.ok(st.log.some((l) => l.text.includes('potion')));
});

test('the phoenix feather is spent before a health potion', () => {
  const g = corridorGame();
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 20;
  hero.hp = 1;
  equip(hero, { kind: 'phoenixFeather', level: 1 });
  hero.potionCapacity = 1;
  hero.potions = 1;
  st.trail = new Set(['1,1', '2,1', '3,1', '4,1', '5,1']);
  hero.pos = { x: 5, y: 1 };
  const m = mkMonster({ pos: { x: 6, y: 1 }, atk: 50 });
  st.level.monsters.push(m);

  monsterAttack(st, m, makeRng(3));
  assert.equal(hero.sleeping, false);
  assert.equal(hero.potions, 1, 'the free feather went first, the potion is untouched');
  assert.ok(st.log.some((l) => l.text.includes('feather')));
  assert.ok(!st.fx.some((f) => f.kind === 'text' && f.text === 'Potion!'), 'no potion cue when the feather did it');
});

test('a potion answers the first hit; a second monster in the same tick does not get a free follow-up', () => {
  const g = Game.forTest(1234);
  const level = mkLevel(LONG_CORRIDOR); // start defaults to (1,1)
  install(g, level, { x: 7, y: 1 });
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 20;
  hero.hp = 1;
  hero.def = 0;
  hero.potionCapacity = 1;
  hero.potions = 1;
  st.trail = trailTo(7);
  // A huge sightRange makes every trail tile and neighbour "unsafe" (see
  // `isSafeSpot` in combat.ts), so the burst-back-up's retreat falls all the
  // way through to the level's start tile — right next to a second monster
  // planted there, hard enough to finish the hero off in one more swing.
  const near = mkMonster({ id: 'near', kind: 'patrol', pos: { x: 6, y: 1 }, atk: 50, sightRange: 999, attackInterval: 99999 });
  const atStart = mkMonster({
    id: 'atStart',
    kind: 'patrol',
    pos: { x: level.start.x + 1, y: level.start.y },
    atk: 999,
    sightRange: 999,
    attackInterval: 99999,
  });
  st.level.monsters.push(near, atStart);

  updateMonsters(st, 16, makeRng(3));

  // Without the fix: `near`'s hit spends the potion and bursts the hero back
  // up right onto the level's start tile (sleeping stays false), then
  // `atStart` — waiting right there — gets a free swing in the very same
  // tick and knocks the now-potionless hero down anyway: the potion
  // "triggered" and the hero was knocked out right after, in the same
  // instant, instead of the potion actually saving them.
  assert.equal(hero.potions, 0, 'exactly one charge spent, not burned twice');
  assert.equal(hero.sleeping, false, 'the potion held: no knockdown this tick');
  assert.ok(hero.hp > 1, 'burst back up to half hearts, not left on a sliver');
  assert.deepEqual(hero.pos, level.start, 'burst-back-up did retreat all the way to the start tile');
});

test('speed boots quicken every step', () => {
  const plain = corridorGame();
  plain.pointerAt({ x: 2, y: 1 });
  plain.tick(100);
  assert.deepEqual(plain.state.hero.pos, { x: 1, y: 1 }, '100ms is not a step without boots');

  const g = corridorGame();
  equip(g.state.hero, { kind: 'speedBoots', level: 1 });
  assert.equal(heroMoveMs(g.state.hero), 100);
  g.pointerAt({ x: 2, y: 1 });
  g.tick(100);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
  assert.ok(g.state.fx.some((f) => f.kind === 'flash'), 'boots kick up dust');
});

test('the gold charm swells monster drops and chest gold', () => {
  const g = corridorGame({
    chests: [{ id: 'c1', pos: { x: 2, y: 1 }, opened: false, loot: { gold: 10, xp: 4 } }],
  });
  const hero = g.state.hero;
  equip(hero, { kind: 'goldCharm', level: 2 }); // x1.6
  const m = mkMonster({ id: 'm9', pos: { x: 6, y: 1 }, hp: 1, gold: 10, xp: 5 });
  g.state.level.monsters.push(m);

  heroAttack(g.state, m, makeRng(7));
  assert.equal(hero.gold, 16, 'monster gold is multiplied');
  assert.equal(hero.xp, 5, 'a gold charm does not touch xp');

  hero.keys.chest = 1;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.equal(hero.gold, 32);
  assert.equal(g.state.level.chests[0].loot.gold, 16, 'the popup shows what was pocketed');
  assert.equal(g.state.level.chests[0].loot.xp, 4);
});

test('the hero carries one of each trinket; a duplicate is coins instead', () => {
  const sword = () => ({ name: 'Rusty Sword', atk: 2 });
  const g = corridorGame({
    chests: [{ id: 'c1', pos: { x: 2, y: 1 }, opened: false, loot: { gold: 10, xp: 4, item: sword() } }],
  });
  const hero = g.state.hero;
  const atk = hero.atk;
  const chest = g.state.level.chests[0];

  hero.keys.chest = 1;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.equal(hero.atk, atk + 2, 'the first sword is a real prize');
  assert.equal(hero.gold, 10);
  g.dismissModal();

  // The same sword out of a second chest: nothing to gain, so it pays coins.
  chest.opened = false;
  chest.loot = { gold: 10, xp: 4, item: sword() };
  hero.keys.chest = 1;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.equal(chest.opened, true);
  assert.equal(hero.atk, atk + 2, 'a second Rusty Sword adds nothing');
  assert.ok(hero.gold > 20, `the duplicate is melted down for coins (${hero.gold})`);
  assert.equal(chest.loot.item, undefined, 'and the popup shows coins');
});

test('a health potion trinket always raises capacity, even a repeat', () => {
  const potion = () => ({ name: 'Health Potion', potionCapacity: 1 });
  const g = corridorGame({
    chests: [{ id: 'c1', pos: { x: 2, y: 1 }, opened: false, loot: { gold: 10, xp: 4, item: potion() } }],
  });
  const hero = g.state.hero;
  const chest = g.state.level.chests[0];

  hero.keys.chest = 1;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.equal(hero.potionCapacity, 1);
  assert.equal(hero.potions, 1);
  g.dismissModal();

  // The same name out of a second chest: unlike a sword, it is never a
  // duplicate. Capacity keeps rising and no gold is melted out of it.
  chest.opened = false;
  chest.loot = { gold: 10, xp: 4, item: potion() };
  hero.keys.chest = 1;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.equal(hero.potionCapacity, 2, 'capacity keeps rising on a repeat');
  assert.equal(hero.potions, 2);
  assert.equal(chest.loot.item?.potionCapacity, 1, 'never melted down for coins');
});

test('health potions refill to capacity at the start of the next level', () => {
  const g = corridorGame();
  g.state.level.exit = { x: 2, y: 1 };
  g.state.hero.potionCapacity = 3;
  g.state.hero.potions = 0;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  g.tick(800);
  assert.equal(g.state.depth, 2);
  assert.equal(g.state.hero.potions, 3);
});

test('the key compass points at the nearest key, then at the stairs', () => {
  const g = corridorGame({
    keys: [
      { id: 'k1', pos: { x: 6, y: 1 }, kind: 'chest', taken: false },
      { id: 'k2', pos: { x: 3, y: 1 }, kind: 'door', taken: false },
    ],
  });
  g.state.level.exit = { x: 7, y: 1 };
  assert.equal(g.state.compass, null, 'no compass without the item');

  equip(g.state.hero, { kind: 'keyCompass', level: 2 });
  g.tick(16);
  assert.deepEqual(g.state.compass, { x: 3, y: 1 }, 'the nearer key');

  for (const k of g.state.level.keys) k.taken = true;
  g.tick(600);
  assert.deepEqual(g.state.compass, { x: 7, y: 1 }, 'the stairs once the keys are gone');
});

test('the bane totem slows monsters that come close', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 40;
  hero.hp = 40;
  equip(hero, { kind: 'baneTotem', level: 3 });
  const near = mkMonster({ id: 'n', pos: { x: 3, y: 1 }, kind: 'patrol', moveInterval: 400, attackInterval: 99999, patrolPath: [{ x: 3, y: 1 }, { x: 4, y: 1 }], patrolIndex: 0, patrolDir: 1, sightRange: 0 });
  const away = mkMonster({ id: 'f', pos: { x: 6, y: 1 }, kind: 'patrol', moveInterval: 400, attackInterval: 99999, patrolPath: [{ x: 6, y: 1 }, { x: 7, y: 1 }], patrolIndex: 0, patrolDir: 1, sightRange: 0 });
  g.state.level.monsters.push(near, away);

  updateMonsters(g.state, 16, makeRng(8));
  assert.equal(near.moveCooldown, 600, 'inside the totem the monster drags its feet');
  assert.equal(away.moveCooldown, 400, 'outside it walks normally');
});

test('the vampire fang heals the hero on a kill', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 30;
  hero.hp = 10;
  equip(hero, { kind: 'vampireFang', level: 6 }); // 3 quarter hearts per kill
  const m = mkMonster({ pos: { x: 2, y: 1 }, hp: 1 });
  g.state.level.monsters.push(m);

  heroAttack(g.state, m, makeRng(12));
  assert.equal(m.alive, false);
  assert.ok(hero.hp >= 13, 'the kill heals');
  assert.ok(hero.hp <= hero.maxHp);
});

test('the berserker axe hits harder once the hearts run low', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 20;
  hero.hp = 20;
  equip(hero, { kind: 'berserkerAxe', level: 4 }); // +4 while at or below half
  const m = mkMonster({ pos: { x: 2, y: 1 }, hp: 200, maxHp: 200, def: 0, attackInterval: 99999, attackCooldown: 99999 });
  g.state.level.monsters.push(m);

  const before = m.hp;
  heroAttack(g.state, m, makeRng(21));
  const healthy = before - m.hp;

  hero.hp = 10; // half hearts exactly
  const mid = m.hp;
  heroAttack(g.state, m, makeRng(21));
  const wounded = mid - m.hp;
  assert.equal(wounded - healthy, 4, 'the axe adds its bonus while wounded');
});

test('the stone ring shrugs off knockback', () => {
  const g = corridorGame();
  const hero = g.state.hero;
  hero.maxHp = 30;
  hero.hp = 30;
  equip(hero, { kind: 'stoneRing', level: 4 });
  hero.pos = { x: 4, y: 1 };
  const m = mkMonster({ pos: { x: 3, y: 1 }, atk: 4 });
  g.state.level.monsters.push(m);

  monsterAttack(g.state, m, makeRng(5));
  assert.deepEqual(hero.pos, { x: 4, y: 1 }, 'not shoved an inch');
  assert.ok(hero.hp < 30);
});

// ---------------------------------------------------------------------------
// Monster balance: patrols slow you down, guards doze, lurkers give up
// ---------------------------------------------------------------------------

test('a patrol is solid: the hero cannot route through it and fights it instead', () => {
  const patrol = mkMonster({
    id: 'p1',
    kind: 'patrol',
    pos: { x: 2, y: 1 },
    hp: 20,
    maxHp: 20,
    attackInterval: 99999,
    attackCooldown: 99999,
    patrolPath: [
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
  });
  const g = corridorGame({ monsters: [patrol] });
  const hero = g.state.hero;
  hero.hp = 20;
  hero.maxHp = 20;

  g.pointerAt({ x: 4, y: 1 });
  assert.equal(g.state.path.length, 0, 'a drag never routes through a patrol');

  g.pointerAt({ x: 2, y: 1 });
  assert.equal(g.state.path.length, 1, 'but the patrol itself is a legal target');
  g.state.pointer = null; // no hold-to-attack for this assertion

  g.tick(150);
  assert.deepEqual(hero.pos, { x: 1, y: 1 }, 'the hero stays put');
  assert.deepEqual(patrol.pos, { x: 2, y: 1 }, 'and so does the patrol');
  assert.ok(patrol.hp < 20, 'walking into it is a swing');
  assert.equal(hero.stun, 0, 'no stagger');
  assert.equal(g.state.path.length, 0, 'the swing clears the queue');

  const hp = patrol.hp;
  g.tick(320);
  assert.ok(patrol.hp < hp, 'and the hero stays on it');
});

test('a patrol that walks into the queued path is fought, not passed', () => {
  const patrol = mkMonster({
    id: 'p1',
    kind: 'patrol',
    pos: { x: 5, y: 1 },
    hp: 20,
    maxHp: 20,
    attackInterval: 99999,
    attackCooldown: 99999,
  });
  const g = corridorGame({ monsters: [patrol] });
  g.pointerAt({ x: 4, y: 1 });
  g.state.pointer = null;
  assert.equal(g.state.path.length, 3);
  g.tick(150); // step to 2,1
  patrol.pos = { x: 3, y: 1 }; // it wandered onto the next queued tile
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 }, 'the hero does not swap through');
  assert.deepEqual(patrol.pos, { x: 3, y: 1 });
  assert.ok(patrol.hp < 20, 'the hero swings at what blocks the way');
  assert.equal(g.state.path.length, 0);
});

test('stopping next to a monster starts a fight that carries on by itself', () => {
  // The monster never swings back, so knockback cannot muddy the positions.
  const m = mkMonster({ pos: { x: 3, y: 1 }, kind: 'guard', hp: 40, maxHp: 40, attackCooldown: 99999 });
  const g = corridorGame({ monsters: [m] });
  g.pointerAt({ x: 2, y: 1 }); // walk up next to it, never onto it
  g.pointerEnd();
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
  assert.equal(g.state.path.length, 0);
  assert.ok(m.hp < 40, 'arriving in melee range is enough to swing');
  const afterFirst = m.hp;
  g.tick(320);
  g.tick(320);
  assert.ok(m.hp < afterFirst - 1, 'and the hero keeps swinging with no input');
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 }, 'without moving');
});

test('a monster that walks up to an idle hero is fought too', () => {
  const m = mkMonster({ pos: { x: 2, y: 1 }, kind: 'lurker', hp: 40, maxHp: 40, attackCooldown: 99999, state: 'chasing' });
  const g = corridorGame({ monsters: [m] });
  g.tick(50);
  assert.ok(m.hp < 40, 'the hero fights back without a drag');
  const hp = m.hp;
  for (let i = 0; i < 3; i++) g.tick(320);
  assert.ok(m.hp < hp, 'and keeps at it');
});

test('the long sword picks a fight from two tiles away', () => {
  const m = mkMonster({ pos: { x: 3, y: 1 }, kind: 'guard', hp: 40, maxHp: 40, attackCooldown: 99999 });
  const g = corridorGame({ monsters: [m] });
  equip(g.state.hero, { kind: 'longSword', level: 3 });
  g.tick(50);
  assert.ok(m.hp < 40, 'in weapon range counts as in range');
  assert.ok(g.state.fx.some((f) => f.kind === 'slash'));
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 });
});

test('the hero prefers the adjacent monster over one at sword reach', () => {
  const near = mkMonster({ id: 'near', pos: { x: 2, y: 1 }, kind: 'guard', hp: 40, maxHp: 40, attackCooldown: 99999 });
  const far = mkMonster({ id: 'far', pos: { x: 3, y: 1 }, kind: 'guard', hp: 40, maxHp: 40, attackCooldown: 99999 });
  const g = corridorGame({ monsters: [far, near] });
  equip(g.state.hero, { kind: 'longSword', level: 3 });
  g.tick(50);
  assert.ok(near.hp < 40, 'the adjacent one takes the hit');
  assert.equal(far.hp, 40, 'the far one is left alone');
});

test('dragging the hero out of reach ends an automatic fight', () => {
  const m = mkMonster({ pos: { x: 3, y: 1 }, kind: 'guard', hp: 40, maxHp: 40, attackCooldown: 99999 });
  const g = corridorGame({ monsters: [m] });
  g.pointerAt({ x: 2, y: 1 });
  g.pointerEnd();
  g.tick(150);
  assert.ok(m.hp < 40, 'engaged');
  const hp = m.hp;
  g.pointerAt({ x: 1, y: 1 }); // walk away
  g.pointerEnd();
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 });
  for (let i = 0; i < 3; i++) g.tick(320);
  assert.equal(m.hp, hp, 'out of reach, no more swings');
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 }, 'and the hero does not chase');
});

test('a knocked-down hero stops fighting', () => {
  const g = Game.forTest(1234);
  install(g, mkLevel(LONG_CORRIDOR), { x: 10, y: 1 });
  const st = g.state;
  st.trail = trailTo(10);
  st.hero.hp = 1;
  st.hero.maxHp = 20;
  const m = mkMonster({ pos: { x: 11, y: 1 }, hp: 200, maxHp: 200, atk: 50, sightRange: 4 });
  st.level.monsters.push(m);

  g.tick(50); // the hero swings first, then the monster's blow lands
  assert.ok(m.hitFlash > 0, 'the fight started on its own');
  assert.equal(st.hero.sleeping, true, 'and ended with a knockdown');
  assert.equal(m.hp, 200, 'which healed the monster back to full');
  for (let i = 0; i < 4; i++) g.tick(320);
  assert.equal(m.hp, 200, 'a sleeping hero swings at nothing');
  assert.equal(st.hero.sleeping, true);
});

test('holding the finger on a patrol still swings at it', () => {
  const patrol = mkMonster({
    id: 'p1',
    kind: 'patrol',
    pos: { x: 2, y: 1 },
    hp: 20,
    maxHp: 20,
    attackInterval: 99999,
    attackCooldown: 99999,
  });
  const g = corridorGame({ monsters: [patrol] });
  g.state.pointer = { x: 2, y: 1 };
  g.tick(400);
  assert.ok(patrol.hp < 20, 'patrols can be fought on purpose');
  assert.deepEqual(g.state.hero.pos, { x: 1, y: 1 }, 'a swing is not a shove');
});

test('a patrol hit never knocks the hero back, a guard hit does', () => {
  const g = corridorGame();
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 30;
  hero.hp = 30;
  hero.pos = { x: 4, y: 1 };

  const patrol = mkMonster({ id: 'p1', kind: 'patrol', pos: { x: 3, y: 1 }, atk: 3 });
  st.level.monsters.push(patrol);
  monsterAttack(st, patrol, makeRng(5));
  assert.deepEqual(hero.pos, { x: 4, y: 1 }, 'patrols slow you, they do not shove');
  assert.ok(hero.hp < 30, 'the hit still lands');

  patrol.alive = false;
  hero.hp = 30;
  const guard = mkMonster({ id: 'g1', kind: 'guard', pos: { x: 3, y: 1 }, atk: 3 });
  st.level.monsters.push(guard);
  monsterAttack(st, guard, makeRng(5));
  assert.deepEqual(hero.pos, { x: 5, y: 1 }, 'guards still knock the hero back');
});

test('a lurker gives up once the hero is out of aggro range', () => {
  const level = mkLevel(LONG_CORRIDOR);
  const g = Game.forTest(99);
  install(g, level, { x: 8, y: 1 });

  const lurk = mkMonster({
    id: 'l1',
    kind: 'lurker',
    pos: { x: 10, y: 1 },
    home: { x: 10, y: 1 },
    sightRange: 3,
    leash: 20, // plenty of leash left: only losing sight ends the chase
    moveInterval: 200,
    attackInterval: 99999,
  });
  level.monsters.push(lurk);
  const rng = makeRng(11);

  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'chasing');
  assert.deepEqual(lurk.pos, { x: 9, y: 1 }, 'steps toward the hero');

  g.state.hero.pos = { x: 1, y: 1 }; // 8 tiles away: well past sightRange + 1
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'returning', 'the chase is off');
  assert.deepEqual(lurk.pos, { x: 9, y: 1 }, 'and it stays right where it gave up');
});

test('a lurker eventually walks back to where it started chasing, once it gives up', () => {
  const level = mkLevel(LONG_CORRIDOR);
  const g = Game.forTest(99);
  install(g, level, { x: 8, y: 1 });

  const lurk = mkMonster({
    id: 'l1',
    kind: 'lurker',
    pos: { x: 10, y: 1 },
    home: { x: 10, y: 1 },
    sightRange: 3,
    leash: 20,
    moveInterval: 200,
    attackInterval: 99999,
  });
  level.monsters.push(lurk);
  const rng = makeRng(11);

  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng); // aggroes, steps to (9,1); chaseFrom = (10,1)
  g.state.hero.pos = { x: 1, y: 1 };
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng); // gives up, holds at (9,1)
  assert.equal(lurk.state, 'returning');

  // Well within the hold window: it does not budge yet — a hero who only
  // peeks back and forth briefly should not find it already walking off.
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 1000, rng);
  assert.equal(lurk.state, 'returning');
  assert.deepEqual(lurk.pos, { x: 9, y: 1 }, 'still holding its give-up spot');

  // The hold window runs out: it commits to walking back to where the chase
  // began (its home, in this case) instead of camping there forever.
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 2500, rng);
  assert.equal(lurk.state, 'returning');
  assert.deepEqual(lurk.pos, { x: 10, y: 1 }, 'stepped back toward chaseFrom');

  // And once it actually arrives, it settles back to idle, ready for a fresh
  // chase (and a fresh chaseFrom) next time.
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'idle');
});

test('a lurker can still be re-baited while it holds its give-up spot', () => {
  const level = mkLevel(LONG_CORRIDOR);
  const g = Game.forTest(99);
  install(g, level, { x: 8, y: 1 });

  const lurk = mkMonster({
    id: 'l1',
    kind: 'lurker',
    pos: { x: 10, y: 1 },
    home: { x: 10, y: 1 },
    sightRange: 3,
    leash: 20,
    moveInterval: 200,
    attackInterval: 99999,
  });
  level.monsters.push(lurk);
  const rng = makeRng(11);

  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng); // aggroes, steps to (9,1)
  g.state.hero.pos = { x: 1, y: 1 };
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng); // gives up, holds at (9,1)
  assert.equal(lurk.state, 'returning');

  // The hero ducks back within range before the hold window runs out: it
  // re-aggroes and chases from wherever it is, instead of walking home.
  g.state.hero.pos = { x: 7, y: 1 };
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 500, rng);
  assert.equal(lurk.state, 'chasing', 're-baited before it committed to leaving');
  assert.deepEqual(lurk.pos, { x: 8, y: 1 }, 'chases the hero instead of walking home');
});

test('a patrol never chases the hero off its route', () => {
  const level = mkLevel(LONG_CORRIDOR);
  const g = Game.forTest(7);
  install(g, level, { x: 5, y: 1 });

  const route: Vec[] = [
    { x: 8, y: 1 },
    { x: 9, y: 1 },
  ];
  const p = mkMonster({
    id: 'p1',
    kind: 'patrol',
    pos: { x: 8, y: 1 },
    patrolPath: route,
    patrolIndex: 0,
    patrolDir: 1,
    sightRange: 6, // it can see the hero and still does not care
    moveInterval: 100,
    attackInterval: 99999,
  });
  level.monsters.push(p);
  const rng = makeRng(3);

  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    p.moveCooldown = 0;
    updateMonsters(g.state, 16, rng);
    seen.push(key(p.pos));
  }
  assert.deepEqual(seen, ['9,1', '8,1', '9,1', '8,1'], 'it just walks its beat');
  assert.notEqual(p.state, 'chasing');
});

test('the help screen pauses the game and dismisses like any modal', () => {
  const g = corridorGame();
  g.openHelp();
  assert.equal(g.state.modal?.kind, 'help');
  const t0 = g.state.stats.playMs;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(300);
  assert.equal(g.state.stats.playMs, t0, 'paused');
  assert.equal(g.state.path.length, 0);
  g.dismissModal();
  assert.equal(g.state.modal, null);
  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
});

test('once engaged, the hero keeps swinging without input while the monster is in reach', () => {
  const m = mkMonster({ pos: { x: 3, y: 1 }, kind: 'guard', hp: 40, maxHp: 40, atk: 0 });
  const g = corridorGame({ monsters: [m] });
  g.pointerAt({ x: 3, y: 1 });
  g.tick(150); // step to 2,1
  g.state.pointer = null;
  g.tick(150); // first swing (walk-into)
  const afterFirst = m.hp;
  assert.ok(afterFirst < 40);
  g.pointerEnd();
  // No finger, no path: the hero keeps attacking on the swing cadence.
  g.tick(320);
  g.tick(320);
  assert.ok(m.hp < afterFirst - 1, 'kept swinging without a held finger');
  assert.equal(g.state.hero.pos.x, 2, 'never stepped onto the monster');
});

test('engagement ends when the monster dies or the player drags elsewhere', () => {
  const m = mkMonster({ pos: { x: 3, y: 1 }, kind: 'guard', hp: 3, maxHp: 3, atk: 0, xp: 0 });
  const g = corridorGame({ monsters: [m] });
  g.state.hero.atk = 2;
  g.pointerAt({ x: 3, y: 1 });
  g.tick(150);
  g.state.pointer = null;
  g.tick(150);
  for (let i = 0; i < 6 && m.alive; i++) g.tick(320);
  assert.equal(m.alive, false, 'auto-attack finishes the fight');

  // A fresh drag away breaks engagement with a healthy monster.
  const m2 = mkMonster({ pos: { x: 4, y: 1 }, kind: 'guard', hp: 40, maxHp: 40, atk: 0 });
  g.state.level.monsters.push(m2);
  g.state.hero.pos = { x: 3, y: 1 };
  g.state.hero.rpos = { x: 3, y: 1 };
  g.pointerAt({ x: 4, y: 1 });
  g.tick(150);
  g.state.pointer = null;
  const hp = m2.hp;
  assert.ok(hp < 40, 'engaged');
  g.pointerAt({ x: 2, y: 1 }); // walk away
  g.tick(150);
  g.tick(320);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 });
  assert.equal(m2.hp, hp, 'walking away disengages');
  g.tick(320);
  assert.equal(m2.hp, hp, 'and stays disengaged');
});

// ---------------------------------------------------------------------------
// Boss chambers
// ---------------------------------------------------------------------------

test('the necromancer finishing his spell ends the run', () => {
  const g = Game.forTest(31);
  const level = mkBossLevel(CORRIDOR, necroData({ spellMs: 50, crystalsTotal: 1 }));
  level.monsters.push(makeBossMonster('boss', 3, { x: 7, y: 1 }, 'necro'));
  level.monsters.push(makeBossMonster('crystal', 3, { x: 5, y: 1 }, 'crystal1'));
  install(g, level, { x: 1, y: 1 });
  const st = g.state;
  st.depth = 3;
  st.stats.deepest = 3;

  g.tick(40);
  assert.equal(st.over, false, 'still time on the clock');

  g.tick(40);
  assert.equal(st.over, true, 'and then there is not');
  const modal = st.modal as { kind: string; cause: string; boss: string; stats: RunStats } | null;
  assert.ok(modal, 'the game-over screen is up');
  assert.equal(modal.kind, 'gameOver');
  assert.equal(modal.cause, 'The Necromancer finished his spell.');
  assert.equal(modal.boss, 'necromancer');
  assert.equal(modal.stats.deepest, 3);
  assert.equal(modal.stats.bosses, 0);
  assert.ok(st.log.some((l) => l.text === 'The Necromancer finished his spell.'));
});

test("the necromancer's spell clock waits for the hero to wake up", () => {
  const g = Game.forTest(31);
  const level = mkBossLevel(CORRIDOR, necroData({ spellMs: 50, crystalsTotal: 1 }));
  level.monsters.push(makeBossMonster('boss', 3, { x: 7, y: 1 }, 'necro'));
  level.monsters.push(makeBossMonster('crystal', 3, { x: 5, y: 1 }, 'crystal1'));
  install(g, level, { x: 1, y: 1 });
  const st = g.state;
  st.hero.maxHp = 40;
  st.hero.hp = 1;
  st.hero.sleeping = true;

  // Plenty of time to finish the spell if the clock kept running while the
  // hero naps — it shouldn't: a helpless, asleep hero can't do anything about
  // it, so the whole boss chamber freezes the same as it would for a modal.
  g.tick(200);

  assert.equal(st.over, false, "the clock didn't move while the hero slept");
  const boss = level.boss as Extract<BossData, { kind: 'necromancer' }>;
  assert.equal(boss.spellMs, 50, 'spellMs unchanged');
});

test('the necromancer raises a skeleton on his clock, up to his limit', () => {
  const g = Game.forTest(37);
  const level = mkBossLevel(CHAMBER, necroData({ spawnMs: 100, spawnEveryMs: 1000, maxMinions: 1 }), {
    exit: { x: 3, y: 3 },
  });
  const necro = makeBossMonster('boss', 3, { x: 3, y: 3 }, 'necro');
  level.monsters.push(necro, makeBossMonster('crystal', 3, { x: 5, y: 5 }, 'crystal1'));
  install(g, level, { x: 1, y: 1 });
  g.state.depth = 3;
  const minions = (): Monster[] => level.monsters.filter((m) => m.kind === 'minion' && m.alive);

  g.tick(50);
  assert.equal(minions().length, 0, 'not yet');

  g.tick(100);
  assert.equal(minions().length, 1, 'one rises beside him');
  const first = minions()[0];
  assert.equal(Math.abs(first.pos.x - 3) + Math.abs(first.pos.y - 3), 1, 'right next to him');
  assert.equal(first.state, 'chasing', 'and it comes for the hero at once');

  g.tick(1000);
  assert.equal(minions().length, 1, 'his limit holds');

  first.alive = false;
  g.tick(1000);
  const alive = minions();
  assert.equal(alive.length, 1, 'a fallen skeleton makes room for the next');
  assert.notEqual(alive[0].id, first.id, 'ids stay unique');
});

test('smashing every crystal sends the necromancer packing and wins the floor', () => {
  const g = Game.forTest(77);
  const level = mkBossLevel(CHAMBER, necroData({ crystalsTotal: 2 }), { exit: { x: 3, y: 3 } });
  const necro = makeBossMonster('boss', 3, { x: 3, y: 3 }, 'necro');
  const first = makeBossMonster('crystal', 3, { x: 1, y: 5 }, 'crystal1');
  const last = makeBossMonster('crystal', 3, { x: 5, y: 5 }, 'crystal2');
  const minion = makeBossMonster('minion', 3, { x: 2, y: 3 }, 'minion0');
  level.monsters.push(necro, first, last, minion);
  install(g, level, { x: 5, y: 4 });
  const st = g.state;
  st.depth = 3;
  first.alive = false;
  first.hp = 0;
  last.hp = 1;
  st.hero.xpToNext = 9999; // keep the crystal's xp from muddying the reward
  const maxHp0 = st.hero.maxHp;

  heroAttack(st, last, makeRng(5));
  assert.equal(last.alive, false, 'the last crystal is dust');

  g.tick(16);
  assert.equal(level.boss?.defeated, true);
  assert.equal(necro.alive, false, 'he does not stay to argue');
  assert.equal(minion.alive, false, 'and his skeletons crumble with him');
  assert.deepEqual(level.exit, { x: 3, y: 3 }, 'the stairs were under him');
  assert.ok(st.fx.some((f) => f.kind === 'text' && f.text.includes('flees')));

  const modal = st.modal as { kind: string; boss: string; upgraded: MagicItem | null; heart: boolean } | null;
  assert.ok(modal, 'the win popup is up');
  assert.equal(modal.kind, 'bossWon');
  assert.equal(modal.boss, 'necromancer');
  assert.equal(modal.upgraded, null, 'a hero with no gear gets no upgrade');
  assert.equal(modal.heart, true);
  assert.equal(st.stats.bosses, 1);
  assert.equal(st.hero.maxHp, maxHp0 + HEART, 'they get a heart instead');
  assert.equal(st.hero.hp, st.hero.maxHp, 'and are patched up');
});

test('a minotaur hit takes a third of the hearts and three of them end the run', () => {
  const g = Game.forTest(11);
  const level = mkBossLevel(LONG_CORRIDOR, { kind: 'minotaur', defeated: false });
  const bull = makeBossMonster('minotaur', 3, { x: 6, y: 1 }, 'minotaur');
  level.monsters.push(bull);
  install(g, level, { x: 7, y: 1 });
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 12;
  hero.hp = 12;
  hero.def = 99; // armour is no help at all

  monsterAttack(st, bull, makeRng(3));
  assert.equal(hero.hp, 8, 'a third of max hp, defense ignored');
  assert.deepEqual(hero.pos, { x: 8, y: 1 }, 'and a shove with it');
  assert.ok(st.fx.some((f) => f.kind === 'shake'));

  monsterAttack(st, bull, makeRng(3));
  assert.equal(hero.hp, 4);
  assert.equal(st.over, false, 'still standing');

  monsterAttack(st, bull, makeRng(3));
  assert.equal(hero.hp, 0, 'left on the floor at zero');
  assert.equal(hero.sleeping, false, 'nobody naps in a boss chamber');
  assert.equal(st.over, true);
  const modal = st.modal as { kind: string; cause: string; boss: string; retryCost: number } | null;
  assert.ok(modal);
  assert.equal(modal.kind, 'gameOver');
  assert.equal(modal.cause, 'The Minotaur caught you.');
  assert.equal(modal.boss, 'minotaur');
  assert.equal(modal.retryCost, bossRetryCost(st.depth, 0), 'priced at this depth, no retries spent yet');
});

test('retryBoss: paying for another shot heals the hero, refreshes the chamber, and costs gold', () => {
  const g = Game.forTest(11);
  const level = mkBossLevel(LONG_CORRIDOR, { kind: 'minotaur', defeated: false });
  const bull = makeBossMonster('minotaur', 3, { x: 6, y: 1 }, 'minotaur');
  level.monsters.push(bull);
  install(g, level, { x: 7, y: 1 });
  const st = g.state;
  const hero = st.hero;
  st.depth = 3;
  hero.maxHp = 12;
  hero.hp = 12;
  hero.def = 99;
  hero.gold = 1000;

  monsterAttack(st, bull, makeRng(3));
  monsterAttack(st, bull, makeRng(3));
  monsterAttack(st, bull, makeRng(3));
  assert.equal(st.over, true);
  const cost = (st.modal as { retryCost: number }).retryCost;
  assert.equal(cost, bossRetryCost(3, 0));

  g.retryBoss();
  assert.equal(st.over, false, 'the run is back on');
  assert.equal(hero.gold, 1000 - cost, 'paid in full');
  assert.equal(st.stats.bossRetries, 1);
  assert.equal(hero.hp, hero.maxHp, 'a fresh shot means full hearts');
  assert.deepEqual(hero.pos, st.level.start, 'back at the chamber entrance');
  assert.equal(st.level.kind, 'boss', 'still a boss chamber');
  assert.equal(st.level.boss?.defeated, false, 'the fight is on again, not already won');
  assert.equal(st.modal?.kind, 'bossIntro', 'briefed again before anything runs');
});

test('retryBoss: refuses without enough gold, and the run stays over', () => {
  const g = Game.forTest(11);
  const level = mkBossLevel(LONG_CORRIDOR, { kind: 'minotaur', defeated: false });
  const bull = makeBossMonster('minotaur', 3, { x: 6, y: 1 }, 'minotaur');
  level.monsters.push(bull);
  install(g, level, { x: 7, y: 1 });
  const st = g.state;
  const hero = st.hero;
  st.depth = 3;
  hero.maxHp = 12;
  hero.hp = 12;
  hero.def = 99;
  hero.gold = 1;

  monsterAttack(st, bull, makeRng(3));
  monsterAttack(st, bull, makeRng(3));
  monsterAttack(st, bull, makeRng(3));
  assert.equal(st.over, true);

  g.retryBoss();
  assert.equal(st.over, true, 'still over: too poor to buy back in');
  assert.equal(hero.gold, 1, 'nothing spent');
  assert.equal(st.stats.bossRetries, 0);
  assert.equal(st.modal?.kind, 'gameOver', 'the same modal is still up');
});

test('retryBoss: a second retry this run costs more than the first', () => {
  const g = Game.forTest(11);
  const level = mkBossLevel(LONG_CORRIDOR, { kind: 'minotaur', defeated: false });
  const bull = makeBossMonster('minotaur', 3, { x: 6, y: 1 }, 'minotaur');
  level.monsters.push(bull);
  install(g, level, { x: 7, y: 1 });
  const st = g.state;
  const hero = st.hero;
  st.depth = 3;
  hero.gold = 100000;

  monsterAttack(st, bull, makeRng(3));
  monsterAttack(st, bull, makeRng(3));
  monsterAttack(st, bull, makeRng(3));
  const firstCost = (st.modal as { retryCost: number }).retryCost;
  g.retryBoss();
  assert.equal(st.stats.bossRetries, 1);

  // A second death this run (whatever the freshly generated chamber holds —
  // gameOver only needs the state, not a specific attacker) prices the next
  // retry one notch higher.
  gameOver(st, 'test cause');
  const secondCost = (st.modal as { retryCost: number }).retryCost;
  assert.equal(secondCost, bossRetryCost(3, 1));
  assert.ok(secondCost > firstCost, 'leaning on it again costs more');
});

test('a health potion also saves the hero in a boss chamber', () => {
  const g = Game.forTest(11);
  const level = mkBossLevel(LONG_CORRIDOR, { kind: 'minotaur', defeated: false });
  const bull = makeBossMonster('minotaur', 3, { x: 6, y: 1 }, 'minotaur');
  level.monsters.push(bull);
  install(g, level, { x: 7, y: 1 });
  const st = g.state;
  const hero = st.hero;
  hero.maxHp = 12;
  hero.hp = 4; // one more hit would otherwise end the run
  hero.def = 99;
  hero.potionCapacity = 1;
  hero.potions = 1;

  monsterAttack(st, bull, makeRng(3));
  assert.equal(hero.hp, 8, 'half of 12, rounded up to a whole heart');
  assert.equal(hero.sleeping, false);
  assert.equal(hero.potions, 0, 'the potion is spent');
  assert.equal(st.over, false, 'the run goes on');
});

/**
 * A room (x 2..4, y 3..5) with exactly two ways out, north through (3,2) and
 * south through (3,6), each opening onto a corridor. Everything the angels do
 * hangs off those two doorways.
 */
const ANGEL_ROOMS = [
  '###########',
  '###.......#',
  '###.#######',
  '##...######',
  '##...######',
  '##...######',
  '###.#######',
  '###.......#',
  '###########',
];
const ANGEL_ROOM: Rect = { x: 2, y: 3, w: 3, h: 3 };

/** The two-door room, the hero in the middle of it, and no angels yet. */
function angelGame(seed = 13): { g: Game; level: LevelData } {
  const g = Game.forTest(seed);
  const level = mkBossLevel(ANGEL_ROOMS, {
    kind: 'angels',
    defeated: false,
    rooms: [ANGEL_ROOM],
  });
  install(g, level, { x: 3, y: 4 });
  g.state.depth = 3;
  g.state.hero.maxHp = 12;
  g.state.hero.hp = 12;
  return { g, level };
}

/** Drop an awake angel on `pos`. */
function awakeAngel(level: LevelData, pos: Vec, id: string): Monster {
  const m = makeBossMonster('angel', 3, pos, id);
  m.state = 'chasing';
  level.monsters.push(m);
  return m;
}

test('an awake angel walks to a doorway of the hero\'s room and holds it', () => {
  const { g, level } = angelGame();
  const angel = awakeAngel(level, { x: 9, y: 1 }, 'angel1');
  const hero = g.state.hero;

  // The north door is seven steps away, the south one eleven: it takes the
  // near one, one tile per step clock, never in a hurry.
  g.tick(ANGEL_STEP_MS);
  assert.deepEqual(angel.pos, { x: 8, y: 1 }, 'one tile per step clock');
  for (let i = 0; i < 6; i++) g.tick(ANGEL_STEP_MS);
  assert.deepEqual(angel.pos, { x: 3, y: 2 }, 'straight to the near doorway');

  // And there it stays: a door held is the whole point.
  for (let i = 0; i < 5; i++) g.tick(ANGEL_STEP_MS);
  assert.deepEqual(angel.pos, { x: 3, y: 2 });
  assert.equal(angel.state, 'chasing', 'still only laying siege');
  assert.equal(hero.hp, 12, 'and it never lays a finger on you');

  // Walk right up to it: while a way out is open, it will not touch you.
  hero.pos = { x: 3, y: 3 };
  hero.rpos = { x: 3, y: 3 };
  for (let i = 0; i < 3; i++) g.tick(ANGEL_STEP_MS);
  assert.equal(hero.hp, 12, 'stone keeps its distance until you are cornered');
  assert.equal(g.state.over, false);
});

test('angels keep to their own clock, however fast the hero runs', () => {
  const { g, level } = angelGame(5);
  const angel = awakeAngel(level, { x: 9, y: 1 }, 'angel1');
  const hero = g.state.hero;
  hero.pos = { x: 3, y: 7 };
  hero.rpos = { x: 3, y: 7 };

  // Four hero steps inside one angel step: the hero is over four times quicker.
  g.pointerAt({ x: 7, y: 7 });
  for (let i = 0; i < 4; i++) g.tick(heroMoveMs(hero));
  assert.deepEqual(hero.pos, { x: 7, y: 7 }, 'the hero covers four tiles');
  assert.deepEqual(angel.pos, { x: 9, y: 1 }, 'and the angel has not stirred');
  g.pointerAt(null);
  g.state.path.length = 0;
});

test('with every door held the angels close in, and a touch turns you to stone', () => {
  const { g, level } = angelGame(29);
  const north = awakeAngel(level, { x: 3, y: 2 }, 'angel1');
  const south = awakeAngel(level, { x: 9, y: 7 }, 'angel2');
  const hero = g.state.hero;

  // The south angel walks its seven tiles to the other door. Until it lands,
  // the hero still has a way out and nobody is touched.
  for (let i = 0; i < 6; i++) g.tick(ANGEL_STEP_MS);
  assert.deepEqual(south.pos, { x: 3, y: 7 }, 'one step short of the doorway');
  assert.equal(hero.hp, 12, 'a door still open is a hero still safe');

  g.tick(ANGEL_STEP_MS);
  assert.deepEqual(south.pos, { x: 3, y: 6 }, 'and now the room is sealed');
  assert.equal(hero.hp, 12, 'sealing it is not yet the kill');

  // Sealed: both of them come in off the doors.
  g.tick(ANGEL_STEP_MS);
  assert.equal(north.state, 'closing');
  assert.equal(south.state, 'closing');
  assert.deepEqual(north.pos, { x: 3, y: 3 }, 'in off the north door');
  assert.deepEqual(south.pos, { x: 3, y: 5 }, 'in off the south door');
  assert.equal(hero.hp, 12, 'still just short of reach');

  g.tick(ANGEL_STEP_MS);
  assert.ok(hero.hp < 12, 'and then the touching starts');
  assert.ok(g.state.fx.some((f) => f.kind === 'flash'), 'the tile greys over');

  for (let i = 0; i < 6; i++) g.tick(ANGEL_STEP_MS);
  assert.equal(g.state.over, true, 'three touches is a run');
  const modal = g.state.modal as { kind: string; cause: string } | null;
  assert.equal(modal?.kind, 'gameOver');
  assert.equal(modal?.cause, 'You were turned to stone.');
});

test('break away from the ring and the angels go back to the doors', () => {
  const { g, level } = angelGame(31);
  const north = awakeAngel(level, { x: 3, y: 2 }, 'angel1');
  const south = awakeAngel(level, { x: 3, y: 6 }, 'angel2');
  const hero = g.state.hero;

  g.tick(ANGEL_STEP_MS);
  assert.equal(north.state, 'closing', 'sealed in from the first step');
  assert.equal(south.state, 'closing');

  // Out of the room and away down the south corridor, well clear of both.
  hero.pos = { x: 9, y: 7 };
  hero.rpos = { x: 9, y: 7 };
  g.tick(ANGEL_STEP_MS);
  assert.equal(north.state, 'chasing', 'lose them and the siege starts over');
  assert.equal(south.state, 'chasing');
  assert.equal(hero.hp, 12);
});

test('nobody walks through an angel, and nobody hurts one', () => {
  const { g, level } = angelGame(17);
  awakeAngel(level, { x: 3, y: 3 }, 'angel1');
  const st = g.state;
  const hero = st.hero;

  g.pointerAt({ x: 3, y: 3 });
  g.tick(heroMoveMs(hero));
  assert.deepEqual(hero.pos, { x: 3, y: 4 }, 'the hero swings instead of stepping');
  assert.ok(st.fx.some((f) => f.kind === 'text' && f.text === 'Immune'), 'and cannot hurt it');
  g.pointerAt(null);
  st.path.length = 0;
});

test('an idle angel wakes when the hero walks into its room', () => {
  const g = Game.forTest(17);
  const rooms: Rect[] = [
    { x: 1, y: 1, w: 3, h: 1 },
    { x: 9, y: 1, w: 5, h: 1 },
  ];
  const level = mkBossLevel(LONG_CORRIDOR, { kind: 'angels', defeated: false, rooms });
  const angel = makeBossMonster('angel', 3, { x: 11, y: 1 }, 'angel1');
  angel.roomId = 1;
  level.monsters.push(angel);
  install(g, level, { x: 1, y: 1 });
  const st = g.state;
  st.depth = 3;
  st.hero.facing = 'W';

  g.tick(16);
  assert.equal(angel.state, 'idle', 'another room is none of its business');
  assert.deepEqual(angel.pos, { x: 11, y: 1 });

  st.hero.pos = { x: 9, y: 1 };
  st.hero.rpos = { x: 9, y: 1 };
  g.tick(16);
  assert.equal(angel.state, 'chasing', 'walk in and it opens its eyes');
  assert.ok(st.fx.some((f) => f.kind === 'text' && f.text === '!'));
  assert.ok(st.log.some((l) => l.text === 'An angel stirs...'));
});

test('reaching the stairs beats the minotaur, then the shop follows', () => {
  const g = Game.forTest(23);
  const level = mkBossLevel(CORRIDOR, { kind: 'minotaur', defeated: false }, { exit: { x: 2, y: 1 } });
  install(g, level, { x: 1, y: 1 });
  const st = g.state;
  st.depth = 3;
  equip(st.hero, { kind: 'stoneRing', level: 2 });

  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  const modal = st.modal as { kind: string; boss: string; upgraded: MagicItem | null; heart: boolean } | null;
  assert.ok(modal, 'the stairs are the win');
  assert.equal(modal.kind, 'bossWon');
  assert.equal(modal.boss, 'minotaur');
  assert.equal(modal.upgraded?.kind, 'stoneRing');
  assert.equal(modal.upgraded?.level, 3, 'the worn item gained a level');
  assert.equal(modal.heart, false);
  assert.equal(st.hero.gear.defense?.level, 3, 'in place, so the hero wears the upgrade');
  assert.equal(st.stats.bosses, 1);
  assert.equal(level.boss?.defeated, true);
  assert.ok(st.descending > 0, 'the descent is queued up behind the popup');

  g.tick(800);
  assert.equal(st.level.kind, 'boss', 'which holds it back');
  g.dismissModal();
  g.tick(800);
  assert.equal(st.level.kind, 'shop', 'and lets it run');
  assert.equal(st.depth, 3);
});

test('upgradeRandomItem bumps a worn item and re-applies its bonuses', () => {
  const hero = newHero();
  equip(hero, { kind: 'stoneRing', level: 3 }); // +1 def
  const def0 = hero.def;
  const up = upgradeRandomItem(hero, makeRng(1));
  assert.equal(up?.kind, 'stoneRing');
  assert.equal(up?.level, 4);
  assert.equal(hero.gear.defense, up, 'the same object, bumped in place');
  assert.equal(hero.def, def0 + 1, 'and its defense re-applied at the new level');

  const other = newHero();
  equip(other, { kind: 'lifeAmulet', level: 3 }); // +1 heart
  const maxHp0 = other.maxHp;
  other.hp = 5;
  const grew = upgradeRandomItem(other, makeRng(2));
  assert.equal(grew?.level, 4);
  assert.equal(other.maxHp, maxHp0 + HEART, 'another heart at level 4');
  assert.equal(other.hp, 5 + HEART, 'and it arrives full');

  assert.equal(upgradeRandomItem(newHero(), makeRng(3)), null, 'a bare hero has nothing to bump');
});

test('an invulnerable monster shrugs off every hit', () => {
  const g = corridorGame();
  const bull = makeBossMonster('minotaur', 3, { x: 3, y: 1 }, 'minotaur');
  bull.hp = bull.maxHp = 10;
  g.state.level.monsters.push(bull);

  damageMonster(g.state, bull, 99, makeRng(1));
  assert.equal(bull.hp, 10, 'not a scratch');
  assert.equal(bull.alive, true);
  assert.equal(bull.hitFlash, 0, 'not even a flinch');
  assert.equal(g.state.stats.kills, 0);
  assert.ok(g.state.fx.some((f) => f.kind === 'text' && f.text === 'Immune'));

  heroAttack(g.state, bull, makeRng(2));
  assert.equal(bull.hp, 10, 'swinging at it is just as pointless');
});

test('a finished run is wiped from the save and its button starts a new one', () => {
  useMemStorage();
  const g = Game.forTest(4321);
  const level = mkBossLevel(CORRIDOR, { kind: 'minotaur', defeated: false });
  install(g, level, { x: 1, y: 1 });
  const st = g.state;
  st.depth = 3;
  st.stats.deepest = 3;

  saveGame(st);
  const live = loadGame() as GameState;
  assert.ok(live, 'a run in progress saves');

  // Reloading mid-boss lands back in the briefing, with the clock still held.
  const resumed = new Game(live);
  assert.equal(resumed.state.modal?.kind, 'bossIntro');

  const bull = makeBossMonster('minotaur', 3, { x: 2, y: 1 }, 'minotaur');
  level.monsters.push(bull);
  st.hero.maxHp = 9;
  st.hero.hp = 1;
  monsterAttack(st, bull, makeRng(3));
  assert.equal(st.over, true);

  saveGame(st);
  assert.equal(loadGame(), null, 'a dead run wipes the save instead of writing it');

  // A saved state that did end never comes back either.
  const dead = new Game({ ...live, over: true });
  assert.equal(dead.state.depth, 1, 'a dead save starts a fresh run');
  assert.equal(dead.state.level.kind, 'maze');

  g.dismissModal();
  assert.equal(st.over, true, 'the old state is left alone...');
  assert.equal(g.state.over, false, '...and the game is on a new one');
  assert.equal(g.state.depth, 1);
  assert.equal(g.state.modal, null);
  assert.equal(g.state.stats.bosses, 0);
  clearSave();
});

// ---------------------------------------------------------------------------
// Sound cues. The engine only names moments; src/audio decides what they
// sound like, so these tests are about which moments get named.
// ---------------------------------------------------------------------------

test('a step, a key and a locked chest each name their own sound', () => {
  const g = corridorGame({
    keys: [{ id: 'k1', pos: { x: 3, y: 1 }, kind: 'chest', taken: false }],
    chests: [{ id: 'c1', pos: { x: 5, y: 1 }, opened: false, loot: { gold: 5, xp: 1 } }],
  });

  g.pointerAt({ x: 2, y: 1 });
  g.tick(140);
  assert.deepEqual(g.state.sfx, ['step']);

  g.state.sfx = [];
  g.pointerAt({ x: 3, y: 1 });
  g.tick(140);
  assert.deepEqual(g.state.sfx, ['step', 'keyChest']);

  // The key just picked up is a chest key, so spend it and come back locked.
  g.state.hero.keys.chest = 0;
  g.state.sfx = [];
  g.pointerAt({ x: 4, y: 1 });
  g.tick(140);
  g.pointerAt({ x: 5, y: 1 });
  g.tick(140);
  assert.ok(g.state.sfx.includes('locked'));
  assert.ok(!g.state.sfx.includes('chestOpen'));
});

test('opening a chest and taking the stairs each get one specific sound', () => {
  const chest = corridorGame({
    chests: [{ id: 'c1', pos: { x: 3, y: 1 }, opened: false, loot: { gold: 5, xp: 1 } }],
  });
  chest.state.hero.keys.chest = 1;
  chest.pointerAt({ x: 2, y: 1 });
  chest.tick(140);
  chest.pointerAt({ x: 3, y: 1 });
  chest.tick(140);
  assert.equal(chest.state.sfx.filter((s) => s === 'chestOpen').length, 1);

  const stairs = corridorGame();
  stairs.state.level.exit = { x: 2, y: 1 };
  stairs.pointerAt({ x: 2, y: 1 });
  stairs.tick(150);
  assert.equal(stairs.state.sfx.filter((s) => s === 'stairs').length, 1);
});

test('a swing that lands and kills names swing, hit and kill in that order', () => {
  const g = corridorGame({ monsters: [mkMonster({ pos: { x: 2, y: 1 }, hp: 1, def: 0 })] });
  g.state.hero.atk = 50;
  g.pointerAt({ x: 2, y: 1 });
  g.tick(140);
  assert.deepEqual(g.state.sfx, ['swing', 'hit', 'kill']);
});

test('hitting something invulnerable says immune and nothing else', () => {
  const g = corridorGame({
    monsters: [mkMonster({ pos: { x: 2, y: 1 }, hp: 20, invulnerable: true })],
  });
  g.pointerAt({ x: 2, y: 1 });
  g.tick(140);
  assert.deepEqual(g.state.sfx, ['swing', 'immune']);
});

test('the sound queue is capped, so a muted run never banks a backlog', () => {
  const g = corridorGame();
  for (let i = 0; i < 200; i++) pushSfx(g.state, 'hit');
  assert.ok(g.state.sfx.length <= 24, `queue grew to ${g.state.sfx.length}`);
  // What survives is the newest end of the queue, not the oldest.
  pushSfx(g.state, 'levelUp');
  assert.equal(g.state.sfx[g.state.sfx.length - 1], 'levelUp');
});


// ---------------------------------------------------------------------------
// Shrines
// ---------------------------------------------------------------------------

/** One shrine of `kind` on the corridor, two tiles along from the hero. */
function shrineGame(kind: ShrineKind, at: Vec = { x: 2, y: 1 }, level = 1): { g: Game; shrine: Shrine } {
  const shrine: Shrine = { id: 'sh1', pos: at, kind, used: false, level };
  const g = corridorGame({ shrines: [shrine] });
  return { g, shrine };
}

/** Walk the hero one tile east onto whatever is there. */
function stepEast(g: Game): void {
  g.pointerAt({ x: g.state.hero.pos.x + 1, y: g.state.hero.pos.y });
  g.tick(140);
}

/** Floor neighbours of `p`, straight off the tile grid. */
function floorNbs(level: LevelData, p: Vec): Vec[] {
  return [
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x, y: p.y - 1 },
  ].filter((n) => level.tiles[n.y]?.[n.x] === Tile.Floor);
}

test('generated floors carry shrines that share no tile with anything else', () => {
  for (const depth of [1, 2, 5, 9]) {
    const level = generateLevel(depth, 4242 + depth, depth);
    const shrines = level.shrines ?? [];
    assert.ok(shrines.length > 0, `depth ${depth} has no shrines`);

    const taken = new Set<string>([key(level.start), key(level.exit)]);
    for (const k of level.keys) taken.add(key(k.pos));
    for (const d of level.doors) taken.add(key(d.pos));
    for (const c of level.chests) taken.add(key(c.pos));
    for (const m of level.monsters) taken.add(key(m.pos));

    const seen = new Set<string>();
    for (const sh of shrines) {
      const k = key(sh.pos);
      assert.equal(sh.used, false);
      assert.equal(sh.level, depth);
      assert.equal(level.tiles[sh.pos.y][sh.pos.x], Tile.Floor, 'a shrine must sit on floor');
      assert.ok(!taken.has(k), `shrine at ${k} shares a tile with something else`);
      assert.ok(!seen.has(k), `two shrines on ${k}`);
      seen.add(k);
    }
  }
});

test('a floor spreads its shrines over the route, its long warrens and the map', () => {
  for (const depth of [1, 3, 6, 11]) {
    for (const salt of [0, 1, 2]) {
      const level = generateLevel(depth, 909 + salt * 7919, depth);
      const shrines = level.shrines ?? [];

      // At least one wayside alcove: a dead end you step into and back out of.
      assert.ok(
        shrines.some((sh) => floorNbs(level, sh.pos).length === 1),
        `depth ${depth}/${salt} has no dead-end shrine`,
      );

      // A floor with a long warren always buries one at the back of it.
      const warrenTiles = new Set((level.warrens ?? []).flatMap((w) => w.tiles.map(key)));
      const hasLongWarren = (level.warrens ?? []).some((w) => w.tiles.length >= 16);
      if (hasLongWarren) {
        assert.ok(
          shrines.some((sh) => warrenTiles.has(key(sh.pos))),
          `depth ${depth}/${salt} has a long warren but no shrine in one`,
        );
      }

      // And none of them are bunched together.
      for (let i = 0; i < shrines.length; i++) {
        for (let j = i + 1; j < shrines.length; j++) {
          const d = manhattan(shrines[i].pos, shrines[j].pos);
          assert.ok(d >= 4, `shrines ${i} and ${j} are only ${d} tiles apart`);
        }
      }
    }
  }
});

test('a shrine in a corridor is walked over, not walked into', () => {
  // The warren shrines stand mid-corridor. Nothing about a shrine is solid, so
  // a drag routes straight through one and the hero lights it in passing.
  const shrine: Shrine = { id: 'sh1', pos: { x: 3, y: 1 }, kind: 'mend', used: false, level: 1 };
  const g = corridorGame({ shrines: [shrine] });
  g.pointerAt({ x: 5, y: 1 });
  for (let i = 0; i < 6; i++) g.tick(140);

  assert.deepEqual(g.state.hero.pos, { x: 5, y: 1 }, 'the hero should have walked on past');
  assert.equal(shrine.used, true, 'and lit the shrine on the way');
  assert.equal(g.state.hero.buffs.length, 1);
});

test('walking over a shrine lights it once and starts the effect', () => {
  const { g, shrine } = shrineGame('fury');
  const base = g.state.hero.atk;
  stepEast(g);

  assert.equal(shrine.used, true);
  assert.deepEqual(g.state.hero.pos, { x: 2, y: 1 }, 'a shrine never blocks the tile it sits on');
  assert.equal(g.state.hero.buffs.length, 1);
  assert.equal(g.state.hero.buffs[0].kind, 'fury');
  assert.equal(heroAttackValue(g.state), base + furyAtk(1));
  assert.ok(g.state.sfx.includes('shrine'));

  // Walking back over a spent shrine does nothing at all.
  g.state.hero.buffs = [];
  g.pointerAt({ x: 1, y: 1 });
  g.tick(140);
  stepEast(g);
  assert.equal(g.state.hero.buffs.length, 0);
});

test('a shrine buff counts down and is dropped when it runs out', () => {
  const { g } = shrineGame('stone');
  stepEast(g);
  const buff = g.state.hero.buffs[0];
  const total = buff.totalMs;
  assert.ok(total > 0);
  assert.equal(buffDef(g.state.hero), stoneDef(1));

  g.tick(total / 2);
  assert.ok(g.state.hero.buffs[0].ms < total);
  g.tick(total);
  assert.equal(g.state.hero.buffs.length, 0, 'the buff outlived its own clock');
});

test('the buff timer reads solid, then warns, then goes urgent', () => {
  assert.equal(buffPhase(BUFF_WARN_MS + 1), 'solid');
  assert.equal(buffPhase(BUFF_WARN_MS), 'warn');
  assert.equal(buffPhase(BUFF_URGENT_MS + 1), 'warn');
  assert.equal(buffPhase(BUFF_URGENT_MS), 'urgent');
  assert.equal(buffPhase(0), 'urgent');
});

test('ward hearts soak a hit before the hero does, and pop when they are gone', () => {
  const { g } = shrineGame('ward');
  stepEast(g);
  const hero = g.state.hero;
  assert.equal(hero.tempHp, wardTempHp(1));
  assert.equal(hero.tempHpMax, wardTempHp(1));

  // A hit far bigger than the pool: the ward takes what it can and the rest
  // lands on the hero's own hearts.
  hero.def = 0;
  const hp = hero.hp;
  const m = mkMonster({ pos: { x: 3, y: 1 }, atk: 40 });
  g.state.level.monsters.push(m);
  monsterAttack(g.state, m, makeRng(9));
  assert.equal(hero.tempHp, 0, 'the ward should be spent');
  assert.equal(hero.tempHpMax, 0);
  assert.ok(hero.hp < hp, 'the overflow should still land');
  assert.ok(g.state.sfx.includes('wardBreak'));
});

test('a small hit is soaked by the ward alone', () => {
  const g = corridorGame({ monsters: [mkMonster({ pos: { x: 2, y: 1 }, atk: 2 })] });
  const hero = g.state.hero;
  hero.tempHp = 30;
  hero.tempHpMax = 30;
  const hp = hero.hp;
  monsterAttack(g.state, g.state.level.monsters[0], makeRng(3));
  assert.equal(hero.hp, hp, 'temporary hearts go first');
  assert.ok(hero.tempHp < 30);
});

test('a frost shrine throws an ice ball at the nearest monster and freezes it', () => {
  const { g } = shrineGame('frost');
  const m = mkMonster({ pos: { x: 5, y: 1 }, hp: 20 });
  g.state.level.monsters.push(m);
  stepEast(g);

  const buff = g.state.hero.buffs[0];
  buff.timer = frostIntervalMs(1); // the staff is charged
  g.tick(16);

  assert.ok(m.hp < 20, 'the ice ball should have landed');
  assert.ok(m.frozenMs > 0 && m.frozenMs <= FREEZE_MS);
  assert.ok(g.state.sfx.includes('iceball'));
});

test('a frozen monster neither moves nor swings', () => {
  const g = corridorGame({
    monsters: [mkMonster({ pos: { x: 2, y: 1 }, kind: 'patrol', frozenMs: 1000, moveInterval: 100 })],
  });
  const m = g.state.level.monsters[0];
  const hp = g.state.hero.hp;
  for (let i = 0; i < 10; i++) updateMonsters(g.state, 50, makeRng(7));
  assert.deepEqual(m.pos, { x: 2, y: 1 }, 'a frozen monster stays put');
  assert.equal(g.state.hero.hp, hp, 'a frozen monster does not swing');
  assert.equal(m.frozenMs, 500, 'the thaw clock still runs');
});

test('a time bubble makes nearby monsters wait longer between moves', () => {
  const setup = (bubble: boolean) => {
    const g = corridorGame({
      monsters: [mkMonster({ pos: { x: 5, y: 1 }, kind: 'lurker', state: 'chasing', moveInterval: 400 })],
    });
    if (bubble) addBuff(g.state.hero, 'time', 1);
    updateMonsters(g.state, 16, makeRng(5));
    return g.state.level.monsters[0];
  };
  const plain = setup(false);
  const slowed = setup(true);
  assert.ok(slowed.moveCooldown > plain.moveCooldown, 'the bubble should stretch the cooldown');
});

test('a mending shrine refills hearts mid-fight', () => {
  const { g } = shrineGame('mend');
  stepEast(g);
  const hero = g.state.hero;
  hero.hp = 1;
  hero.sinceCombat = 0; // out-of-combat regen is nowhere near, so this is mending
  g.tick(600);
  assert.ok(hero.hp > 1, 'mending should have pulsed');
});

test('a knockdown clears every shrine effect', () => {
  const g = corridorGame({ monsters: [mkMonster({ pos: { x: 2, y: 1 }, atk: 500 })] });
  const hero = g.state.hero;
  addBuff(hero, 'fury', 1);
  hero.tempHp = 4;
  hero.tempHpMax = 4;
  g.state.trail = trailTo(8);
  monsterAttack(g.state, g.state.level.monsters[0], makeRng(2));
  assert.equal(hero.sleeping, true);
  assert.deepEqual(hero.buffs, []);
  assert.equal(hero.tempHp, 0);
});

test('save/load keeps running shrine effects and temporary hearts', () => {
  useMemStorage();
  const g = Game.forTest(88);
  addBuff(g.state.hero, 'frost', 3);
  g.state.hero.tempHp = 6;
  g.state.hero.tempHpMax = 8;
  saveGame(g.state);
  const loaded = loadGame() as GameState;
  clearSave();

  assert.ok(loaded);
  assert.equal(loaded.hero.buffs.length, 1);
  assert.equal(loaded.hero.buffs[0].kind, 'frost');
  assert.equal(loaded.hero.buffs[0].level, 3);
  assert.equal(loaded.hero.tempHp, 6);
  assert.equal(loaded.hero.tempHpMax, 8);
});


test('spirit stretches a timed shrine and fattens the ward', () => {
  // Duration is the currency of a timed shrine, hearts the currency of the
  // ward, and spirit buys more of whichever one the shrine has.
  assert.ok(shrineDurationMs('fury', 5) > shrineDurationMs('fury', 0));
  assert.ok(wardTempHp(1, 5) > wardTempHp(1, 0));
  // ...and never both at once for the same shrine: the ward has no clock to
  // stretch, and a timed shrine's potency takes no spirit argument at all.
  assert.equal(shrineDurationMs('ward', 99), 0);

  const plain = corridorGame();
  plain.state.hero.spirit = 0;
  const weak = addBuff(plain.state.hero, 'frost', 1);

  const blessed = corridorGame();
  blessed.state.hero.spirit = 6;
  const strong = addBuff(blessed.state.hero, 'frost', 1);

  assert.ok(strong.totalMs > weak.totalMs, 'a high-spirit hero holds it longer');
  assert.equal(strong.ms, strong.totalMs, 'and starts full');
});

test('spirit never gives more than double, however high it climbs', () => {
  assert.equal(spiritMult(0), 1);
  assert.equal(spiritMult(1000), SPIRIT_MAX_MULT);
  assert.equal(shrineDurationMs('time', 1000), shrineDurationMs('time', 0) * SPIRIT_MAX_MULT);
  assert.equal(wardTempHp(1, 1000), wardTempHp(1, 0) * SPIRIT_MAX_MULT);
});

test('a buff keeps the length it was lit with when the hero levels up', () => {
  const g = corridorGame();
  g.state.hero.spirit = 2;
  const buff = addBuff(g.state.hero, 'fury', 1);
  const lit = buff.totalMs;

  // Levelling mid-effect must not move the bar the player is watching.
  g.state.hero.spirit = 20;
  g.tick(1000);
  assert.equal(buff.totalMs, lit);
  assert.equal(buff.ms, lit - 1000);
});

test('a ward lit at high spirit hands out more hearts', () => {
  const { g } = shrineGame('ward');
  g.state.hero.spirit = 8;
  stepEast(g);
  assert.equal(g.state.hero.tempHp, wardTempHp(1, 8));
  assert.ok(g.state.hero.tempHp > wardTempHp(1, 0));
});


// ---------------------------------------------------------------------------
// The run log
// ---------------------------------------------------------------------------

test('log lines no longer expire: the log is a history, not a set of toasts', () => {
  const g = corridorGame();
  pushLog(g.state, 'Picked up a chest key');
  // Far longer than the six seconds the HUD used to fade a line out over.
  for (let i = 0; i < 60; i++) g.tick(1000);
  assert.ok(
    g.state.log.some((l) => l.text === 'Picked up a chest key'),
    'a line the player opens the log to find must still be there',
  );
});

test('the log keeps the newest LOG_MAX lines and no more', () => {
  const g = corridorGame();
  g.state.log.length = 0;
  for (let i = 0; i < LOG_MAX * 2; i++) {
    pushLog(g.state, `line ${i}`);
    g.tick(500); // clears the de-duplication window between pushes
  }
  assert.equal(g.state.log.length, LOG_MAX);
  assert.equal(g.state.log[g.state.log.length - 1].text, `line ${LOG_MAX * 2 - 1}`, 'newest last');
  assert.ok(!g.state.log.some((l) => l.text === 'line 0'), 'the oldest fell off');
});

test('the same event twice in a row is one line, but not forever', () => {
  const g = corridorGame();
  g.state.log.length = 0;
  pushLog(g.state, 'Slew the Slime');
  pushLog(g.state, 'Slew the Slime');
  assert.equal(g.state.log.length, 1, 'one event, one line');

  g.tick(1000);
  pushLog(g.state, 'Slew the Slime');
  assert.equal(g.state.log.length, 2, 'the same thing a second later really happened twice');
});
