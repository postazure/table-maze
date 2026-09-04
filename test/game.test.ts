import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ITEM_SLOT, Tile, key } from '../src/engine/types';
import type { GameState, LevelData, MagicItem, Monster, Vec } from '../src/engine/types';
import { makeRng } from '../src/engine/rng';
import { Game } from '../src/engine/game';
import { heroAttack, monsterAttack } from '../src/engine/combat';
import { updateMonsters } from '../src/engine/monsters';
import { clearSave, loadGame, saveGame } from '../src/engine/save';
import { equip, heroMoveMs } from '../src/engine/items';
import { generateShopLevel } from '../src/engine/shop';

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
  st.descending = 0;
}

/** A 9x3 straight corridor along y = 1. */
const CORRIDOR = ['#########', '#.......#', '#########'];
/** A 15x3 corridor for tests that need room to run away. */
const LONG_CORRIDOR = ['#'.repeat(15), `#${'.'.repeat(13)}#`, '#'.repeat(15)];

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
  assert.notEqual(m.state, 'chasing', 'the lurker gives up the chase and heads home');
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

  // Out of leash from home -> gives up and walks back.
  g.state.hero.pos = { x: 1, y: 2 };
  lurk.leash = 1;
  lurk.moveCooldown = 0;
  updateMonsters(g.state, 16, rng);
  assert.equal(lurk.state, 'returning');
  assert.deepEqual(lurk.pos, { x: 5, y: 2 }, 'heads home');
});

test('a guard never moves and only fights once it has been hit', () => {
  const g = corridorGame();
  const guard = mkMonster({ pos: { x: 2, y: 1 }, kind: 'guard', atk: 3, attackInterval: 700 });
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

/** A game standing in a shop, `at` tiles, with `gold` in the purse. */
function shopGame(gold: number, at: Vec = { x: 3, y: 5 }): Game {
  const g = Game.forTest(2024);
  g.state.depth = 3;
  install(g, generateShopLevel(3, g.state.seed, g.state.hero), at);
  g.state.hero.gold = gold;
  return g;
}

test('a shop follows every third floor and leads on to the next depth', () => {
  const g = corridorGame();
  const st = g.state;
  st.depth = 3;
  st.stats.deepest = 3;
  st.level.exit = { x: 2, y: 1 };

  g.pointerAt({ x: 2, y: 1 });
  g.tick(150);
  g.tick(800);
  assert.equal(st.level.kind, 'shop', 'depth 3 is followed by the shop');
  assert.equal(st.depth, 3, 'a shop is not a new floor');
  assert.equal(st.stats.deepest, 3);
  assert.deepEqual(st.hero.pos, st.level.start);
  assert.equal(st.level.shop?.offers.length, 3);
  assert.ok(st.log.some((l) => l.text === 'Shop'));

  // Out through the stairs at the top of the shop: on to depth 4.
  st.hero.pos = { x: 5, y: 2 };
  st.hero.rpos = { x: 5, y: 2 };
  g.pointerAt({ x: 5, y: 1 });
  g.tick(150);
  g.tick(800);
  assert.equal(st.level.kind, 'maze');
  assert.equal(st.depth, 4);
  assert.equal(st.stats.deepest, 4);
  assert.ok(st.log.some((l) => l.text === 'Depth 4'));
});

test('walking into a pedestal buys the item and freezes the game', () => {
  const g = shopGame(9999);
  const st = g.state;
  const shop = st.level.shop as NonNullable<LevelData['shop']>;
  const offer = shop.offers[0];

  g.pointerAt(offer.pos);
  assert.equal(st.path.length, 1, 'a pedestal is a legal drag target');
  g.tick(150);

  assert.deepEqual(st.hero.pos, { x: 3, y: 5 }, 'pedestals are solid');
  assert.equal(st.hero.gold, 9999 - offer.price, 'the gold is spent');
  assert.equal(shop.bought, true);
  assert.equal(st.hero.gear[ITEM_SLOT[offer.item.kind]]?.kind, offer.item.kind);
  const modal = st.modal as { kind: string; item: MagicItem; replaced: MagicItem | null } | null;
  assert.ok(modal, 'a popup shows the new item');
  assert.equal(modal.kind, 'item');
  assert.equal(modal.item.kind, offer.item.kind);
  assert.equal(modal.replaced, null);
  assert.ok(st.fx.some((f) => f.kind === 'ring'));

  // The other pedestals are sold out: they only blink.
  g.dismissModal();
  const other = shop.offers[1];
  st.hero.pos = { x: other.pos.x, y: other.pos.y + 1 };
  st.fx.length = 0;
  const goldLeft = st.hero.gold;
  g.pointerAt(other.pos);
  g.tick(150);
  assert.equal(st.hero.gear[ITEM_SLOT[other.item.kind]], null, 'only one item per shop');
  assert.equal(st.hero.gold, goldLeft);
  assert.equal(st.modal, null);
  assert.ok(st.fx.some((f) => f.kind === 'flash'), 'sold out is a blink, not words');
});

test('a pedestal the hero cannot afford just blinks', () => {
  const g = shopGame(0);
  const st = g.state;
  const shop = st.level.shop as NonNullable<LevelData['shop']>;
  const offer = shop.offers[0];

  g.pointerAt(offer.pos);
  g.tick(150);
  assert.equal(st.hero.gold, 0);
  assert.equal(shop.bought, false);
  assert.equal(st.modal, null);
  assert.equal(st.hero.gear.offense, null);
  assert.ok(st.fx.some((f) => f.kind === 'flash'));
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

test('the hero shoves past a patrol instead of fighting it', () => {
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
  assert.equal(g.state.path.length, 3, 'a drag routes straight through a patrol');
  g.state.pointer = null; // no hold-to-attack for this assertion

  g.tick(150);
  assert.deepEqual(hero.pos, { x: 2, y: 1 }, 'the hero takes the tile');
  assert.deepEqual(patrol.pos, { x: 1, y: 1 }, 'and the patrol is pushed behind');
  assert.equal(patrol.hp, 20, 'no swing');
  assert.equal(hero.hp, 20, 'and no damage either way');
  assert.equal(hero.stun, 350, 'shoving costs a moment');
  assert.equal(g.state.path.length, 2, 'the rest of the path is still queued');

  g.tick(150);
  assert.deepEqual(hero.pos, { x: 2, y: 1 }, 'the stagger holds the hero still');
  g.tick(300);
  assert.deepEqual(hero.pos, { x: 4, y: 1 }, 'then the walk carries on');
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
  assert.deepEqual(lurk.pos, { x: 10, y: 1 }, 'and it heads home');
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
