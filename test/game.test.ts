import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Tile, key } from '../src/engine/types';
import type { GameState, LevelData, Monster, Vec } from '../src/engine/types';
import { makeRng } from '../src/engine/rng';
import { Game } from '../src/engine/game';
import { heroAttack, monsterAttack } from '../src/engine/combat';
import { updateMonsters } from '../src/engine/monsters';
import { clearSave, loadGame, saveGame } from '../src/engine/save';

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
  const g = corridorGame();
  const st = g.state;
  // Walk a trail 1,1 .. 5,1 by hand.
  st.trail = new Set(['1,1', '2,1', '3,1', '4,1', '5,1']);
  st.hero.pos = { x: 5, y: 1 };
  st.hero.hp = 1;
  st.hero.maxHp = 20;
  const m = mkMonster({ pos: { x: 6, y: 1 }, atk: 50 });
  st.level.monsters.push(m);

  monsterAttack(st, m, makeRng(3));

  assert.ok(st.hero.hp >= 1, 'hero hp never drops below 1');
  assert.equal(st.hero.hp, 1, 'wakes up from a quarter heart');
  assert.equal(st.hero.sleeping, true);
  assert.equal(st.path.length, 0);
  // Carried to the most recently walked tile that is 3+ tiles from the monster.
  assert.deepEqual(st.hero.pos, { x: 3, y: 1 });
  assert.ok(st.log.some((l) => l.text === 'Knocked down!'));
  assert.ok(st.fx.some((f) => f.kind === 'shake'));
});

test('retreat picks a nearby recently walked tile, not a far one', () => {
  const g = corridorGame();
  const st = g.state;
  st.trail = new Set(['1,1', '2,1', '3,1', '4,1', '5,1', '6,1']);
  st.hero.pos = { x: 6, y: 1 };
  st.hero.hp = 1;
  const m = mkMonster({ pos: { x: 7, y: 1 }, atk: 50 });
  st.level.monsters.push(m);
  monsterAttack(st, m, makeRng(3));
  // Knocked back to 5,1 then carried to 4,1 (3 tiles from the monster), not to 1,1.
  assert.deepEqual(st.hero.pos, { x: 4, y: 1 });
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

test('a guard never moves but attacks an adjacent hero', () => {
  const g = corridorGame();
  const guard = mkMonster({ pos: { x: 2, y: 1 }, kind: 'guard', atk: 3, attackInterval: 700 });
  g.state.level.monsters.push(guard);
  g.state.hero.hp = 20;
  g.state.hero.maxHp = 20;

  updateMonsters(g.state, 16, makeRng(5));
  assert.deepEqual(guard.pos, { x: 2, y: 1 });
  assert.ok(g.state.hero.hp < 20, 'adjacent hero takes a hit');
  assert.equal(guard.attackCooldown, 700);
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
