import test from 'node:test';
import assert from 'node:assert/strict';

import { Tile, key } from '../src/engine/types';
import type { LevelData, Modal, Monster, Prop, Vec, WorldData, WorldKind, WorldMonsterKind } from '../src/engine/types';
import { Game } from '../src/engine/game';
import { monsterAttack } from '../src/engine/combat';
import { makeRng } from '../src/engine/rng';
import { loadCollection } from '../src/engine/save';
import { WORLDS } from '../src/engine/worlds';
import type { WorldCtx, WorldModule } from '../src/engine/worlds';
import { makeWorldCtx, type WorldHost } from '../src/engine/worldRuntime';

// ---------------------------------------------------------------------------
// A fake world, registered over WORLDS.minotaur for the length of one test.
// WORLDS is a mutable record (see engine/worlds/index.ts); every test that
// touches it restores the real module in a `finally`, so the suite's other
// files never see the fake.
// ---------------------------------------------------------------------------

/** Per-test hooks the fake module's own callbacks defer to. Reset per test. */
interface Hooks {
  onEnter?(ctx: WorldCtx, tile: Vec): void;
  onBump?(ctx: WorldCtx, prop: Prop): void;
  step?(ctx: WorldCtx, m: Monster): Vec | null;
  fights?(ctx: WorldCtx, m: Monster): boolean;
  /** Extra props (beyond the standard portal-home) for stage `stage`. */
  extraProps?(stage: number): Prop[];
}
let hooks: Hooks = {};

/** A 9x7 open room: floor everywhere but the border, start at (1,1). */
function mkWorldLevel(kind: WorldKind, stage: number, runSeed: number, data: WorldData['data'] | null): LevelData {
  const width = 9;
  const height = 7;
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) row.push(x > 0 && y > 0 && x < width - 1 && y < height - 1 ? Tile.Floor : Tile.Wall);
    tiles.push(row);
  }
  const props: Prop[] = [
    { id: 'home', pos: { x: 3, y: 1 }, kind: 'portal-home', solid: true, art: 'portal-home' },
    ...(hooks.extraProps?.(stage) ?? []),
  ];
  return {
    depth: 1,
    seed: runSeed ^ stage,
    kind: 'world',
    theme: 'crypt',
    world: { kind, stage, data: data ?? {}, won: false },
    width,
    height,
    tiles,
    start: { x: 1, y: 1 },
    exit: { x: width - 2, y: height - 2 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
    props,
  };
}

const FAKE_WORLD: WorldModule = {
  kind: 'minotaur',
  name: 'Test World',
  intro: (stage, data) => ({ title: `Stage ${stage}`, lines: [`data: ${JSON.stringify(data)}`] }),
  collectible: { id: 'test-trinket', name: 'Test Trinket', description: 'A trinket, for testing.' },
  defeat: (stage, cause) => `Lost at stage ${stage} (${cause}).`,
  generate: (stage, runSeed, _hero, data) => mkWorldLevel('minotaur', stage, runSeed, data),
  onEnter: (ctx, tile) => hooks.onEnter?.(ctx, tile),
  onBump: (ctx, prop) => hooks.onBump?.(ctx, prop),
  step: (ctx, m) => hooks.step?.(ctx, m) ?? null,
  fights: (ctx, m) => hooks.fights?.(ctx, m) ?? true,
};

/** Swap the real minotaur module for the fake one, run `fn`, then restore it. */
function withFakeWorld(fn: () => void): void {
  const original = WORLDS.minotaur;
  WORLDS.minotaur = FAKE_WORLD;
  hooks = {};
  try {
    fn();
  } finally {
    WORLDS.minotaur = original;
    hooks = {};
  }
}

/** Walk the hero one tile (must be 4-adjacent) and let the step land. */
function step(g: Game, to: Vec): void {
  g.pointerAt(to);
  g.tick(150);
}

function mkMonster(over: Partial<Monster> & { kind: Monster['kind']; pos: Vec }): Monster {
  const base: Omit<Monster, 'kind' | 'pos' | 'rpos' | 'home'> = {
    id: 'm1',
    name: 'Test Monster',
    glyph: '?',
    hp: 10,
    maxHp: 10,
    atk: 1,
    def: 0,
    level: 1,
    xp: 0,
    gold: 0,
    moveInterval: 100,
    moveCooldown: 0,
    attackInterval: 500,
    attackCooldown: 0,
    state: 'idle',
    sightRange: 5,
    leash: 5,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    frozenMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
  const m: Monster = { ...base, ...over, pos: { ...over.pos } } as Monster;
  m.rpos = over.rpos ? { ...over.rpos } : { ...over.pos };
  m.home = over.home ? { ...over.home } : { ...over.pos };
  return m;
}

/** A hand-built maze floor: '#' wall, '.' floor, 'S' start. */
function mkMazeLevel(rows: string[], over: Partial<LevelData> = {}): LevelData {
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[][] = rows.map((r) => Array.from(r, (c) => (c === '#' ? Tile.Wall : Tile.Floor)));
  let start: Vec = { x: 1, y: 1 };
  rows.forEach((r, y) => Array.from(r).forEach((c, x) => { if (c === 'S') start = { x, y }; }));
  return {
    depth: 5,
    seed: 1,
    kind: 'maze',
    theme: 'crypt',
    width,
    height,
    tiles,
    start,
    exit: { x: width - 2, y: height - 2 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
    ...over,
  };
}

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

function useMemStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true, writable: true });
}

// ---------------------------------------------------------------------------

test('enterWorld stashes the main floor and enters stage 0 with worldIntro', () => {
  withFakeWorld(() => {
    const g = Game.forTest(1);
    const mainLevel = g.state.level;
    const mainDepth = g.state.depth;
    g.state.trail = new Set<string>(['1,1', '2,1']);

    g.enterWorld('minotaur');
    const st = g.state;
    assert.equal(st.level.kind, 'world');
    assert.equal(st.level.world?.kind, 'minotaur');
    assert.equal(st.level.world?.stage, 0);
    assert.ok(st.stash);
    assert.equal(st.stash?.level, mainLevel, 'the main floor is stashed by reference');
    assert.equal(st.stash?.depth, mainDepth);
    assert.deepEqual([...st.stash!.trail].sort(), ['1,1', '2,1']);
    assert.equal(st.depth, mainDepth, 'state.depth stays the main floor\'s');
    assert.equal(st.modal?.kind, 'worldIntro');
    assert.equal((st.modal as Extract<Modal, { kind: 'worldIntro' }>).world, 'minotaur');
    assert.equal((st.modal as Extract<Modal, { kind: 'worldIntro' }>).stage, 0);

    // Walking into the portal twice is not two trips.
    const stashBefore = st.stash;
    g.enterWorld('minotaur');
    assert.equal(st.stash, stashBefore, 'no-op: a modal (or an existing stash) refuses a second entry');
  });
});

test('returnHome restores the stashed level and places the hero next to the portal', () => {
  withFakeWorld(() => {
    hooks.onBump = (ctx, prop) => {
      if (prop.kind === 'portal-home') ctx.returnHome();
    };
    const MAIN = ['#######', '#S....#', '#.....#', '#.....#', '#######'];
    const mainLevel = mkMazeLevel(MAIN, { portal: { pos: { x: 4, y: 2 } } });

    const g = Game.forTest(2);
    g.state.level = mainLevel;
    g.state.depth = 5;
    g.state.hero.pos = { x: 1, y: 1 };
    g.state.hero.rpos = { x: 1, y: 1 };
    g.state.trail = new Set<string>([key({ x: 1, y: 1 })]);

    g.enterWorld('minotaur');
    g.dismissModal();
    const st = g.state;
    assert.equal(st.level.kind, 'world');

    // Bump the portal-home prop (placed at (3,1), two tiles from start).
    step(g, { x: 2, y: 1 });
    step(g, { x: 3, y: 1 });

    assert.equal(st.level, mainLevel, 'the stashed level is restored by reference');
    assert.equal(st.depth, 5);
    assert.equal(st.stash, null);
    // Adjacent to the portal (4,2): north (4,1) is the first free neighbour tried.
    assert.deepEqual(st.hero.pos, { x: 4, y: 1 });
    assert.deepEqual(st.hero.rpos, { x: 4, y: 1 });
    assert.equal(st.hero.carrying, null);
  });
});

test('goto calls generate with the current data and carries it into the new stage', () => {
  withFakeWorld(() => {
    hooks.onEnter = (ctx, tile) => {
      if (tile.x === 2 && tile.y === 1) {
        (ctx.world.data as Record<string, unknown>).seen = true;
        ctx.goto(1);
      }
    };
    const g = Game.forTest(3);
    g.enterWorld('minotaur');
    g.dismissModal();
    step(g, { x: 2, y: 1 });

    const st = g.state;
    assert.equal(st.level.world?.stage, 1);
    assert.equal((st.level.world?.data as Record<string, unknown>).seen, true, 'data rides from stage to stage');
    assert.equal(st.modal?.kind, 'worldIntro');
    assert.equal((st.modal as Extract<Modal, { kind: 'worldIntro' }>).stage, 1);
  });
});

test('a carried prop rides through goto when the next stage regenerates it hidden; anything else is set down', () => {
  withFakeWorld(() => {
    hooks.extraProps = (stage) =>
      stage === 0
        ? [{ id: 'gem', pos: { x: 2, y: 1 }, kind: 'gem', solid: false, art: 'gem', carriable: true }]
        : [{ id: 'gem', pos: { x: 1, y: 1 }, kind: 'gem', solid: false, art: 'gem', carriable: true, hidden: true }];
    hooks.onBump = (ctx) => ctx.goto(1);
    const g = Game.forTest(5);
    g.enterWorld('minotaur');
    g.dismissModal();
    const st = g.state;
    step(g, { x: 2, y: 1 });
    assert.equal(st.hero.carrying, 'gem', 'picked up');

    step(g, { x: 3, y: 1 }); // the portal-home prop: our hook sends the hero to stage 1 instead
    assert.equal(st.level.world?.stage, 1);
    assert.equal(st.hero.carrying, 'gem', 'still in the hero\'s arms on the new stage');
    const ghost = st.level.props!.find((p) => p.id === 'gem');
    assert.ok(ghost && ghost.hidden, 'the regenerated stage carries it hidden');

    // A stage that does not regenerate it: the hero arrives empty-handed.
    g.dismissModal();
    hooks.extraProps = () => [];
    hooks.onBump = (ctx) => ctx.goto(2);
    step(g, { x: 2, y: 1 });
    step(g, { x: 3, y: 1 });
    assert.equal(st.level.world?.stage, 2);
    assert.equal(st.hero.carrying, null);
  });
});

test('finish persists the collectible, sets won, and shows worldWon', () => {
  useMemStorage();
  withFakeWorld(() => {
    hooks.onEnter = (ctx, tile) => {
      if (tile.x === 2 && tile.y === 1) ctx.finish();
    };
    const g = Game.forTest(4);
    g.enterWorld('minotaur');
    g.dismissModal();
    step(g, { x: 2, y: 1 });

    const st = g.state;
    assert.equal(st.level.world?.won, true);
    assert.deepEqual(st.collection, ['test-trinket']);
    assert.deepEqual(loadCollection(), ['test-trinket']);
    assert.equal(st.modal?.kind, 'worldWon');
    const modal = st.modal as Extract<Modal, { kind: 'worldWon' }>;
    assert.equal(modal.world, 'minotaur');
    assert.equal(modal.collectible, 'Test Trinket');

    // Winning it twice never duplicates the entry.
    makeWorldCtx(fakeHost(), st, st.level.world!, makeRng(1)).finish();
    assert.deepEqual(st.collection, ['test-trinket']);
  });
});

test('a solid prop blocks the hero and bumps to onBump', () => {
  withFakeWorld(() => {
    let bumped: string | null = null;
    hooks.onBump = (_ctx, prop) => {
      bumped = prop.kind;
    };
    const g = Game.forTest(5);
    g.enterWorld('minotaur');
    g.dismissModal();
    const st = g.state;
    step(g, { x: 2, y: 1 });
    step(g, { x: 3, y: 1 }); // the portal-home prop's tile

    assert.deepEqual(st.hero.pos, { x: 2, y: 1 }, 'a solid prop blocks: the hero stays put');
    assert.equal(bumped, 'portal-home');
  });
});

test('a carriable prop is picked up and set down on swing', () => {
  withFakeWorld(() => {
    hooks.extraProps = () => [
      { id: 'trinket1', pos: { x: 2, y: 1 }, kind: 'trinket', solid: false, carriable: true, art: 'trinket' },
    ];
    const g = Game.forTest(6);
    g.enterWorld('minotaur');
    g.dismissModal();
    const st = g.state;
    // Not adjacent to the pickup tile: picking the trinket up must not, on
    // its own, auto-engage (and so auto-swing at, dropping it again) a
    // monster the hero has not actually walked up to yet.
    const m = mkMonster({ kind: 'guard', pos: { x: 2, y: 3 } });
    st.level.monsters = [m];

    step(g, { x: 2, y: 1 });
    assert.equal(st.hero.carrying, 'trinket1', 'walking onto it picks it up');
    const prop = st.level.props!.find((p) => p.id === 'trinket1')!;
    assert.equal(prop.hidden, true);
    g.pointerEnd();

    // Walk up to the monster: hands full is no way to fight, so arriving
    // next to it (and auto-engaging) sets the trinket back down at once.
    step(g, { x: 2, y: 2 });
    assert.equal(st.hero.carrying, null, 'set down to fight');
    assert.equal(prop.hidden, false);
    assert.deepEqual(prop.pos, { x: 2, y: 2 }, 'set down under the hero');
  });
});

test('state.freeze halts monsters and the hero, but still ages the clock and lerps the hero', () => {
  const g = Game.forTest(7);
  g.enterWorld('minotaur'); // the real module: only the engine's own freeze plumbing is under test
  g.dismissModal();
  const st = g.state;
  st.hero.pos = { x: 5, y: 1 };
  st.hero.rpos = { x: 4, y: 1 };
  st.path = [{ x: 6, y: 1 }];
  const m = mkMonster({ kind: 'patrol', pos: { x: 3, y: 1 } });
  m.patrolPath = [{ x: 3, y: 1 }, { x: 4, y: 1 }];
  m.patrolIndex = 0;
  m.patrolDir = 1;
  m.moveInterval = 10;
  st.level.monsters = [m];
  st.freeze = 500;
  const playBefore = st.stats.playMs;

  g.tick(100);

  assert.equal(st.freeze, 400);
  assert.equal(st.stats.playMs, playBefore + 100);
  assert.deepEqual(m.pos, { x: 3, y: 1 }, 'the monster never moved');
  assert.deepEqual(st.hero.pos, { x: 5, y: 1 }, 'the hero never stepped');
  assert.ok(st.hero.rpos.x > 4, 'but the hero glides toward where they already stand');
  assert.deepEqual(st.path, [{ x: 6, y: 1 }], 'the queued path is untouched');
});

test('ctx.rebuild bumps level.rev; nothing else reacts to it engine-side', () => {
  const g = Game.forTest(8);
  const level = mkWorldLevel('minotaur', 0, g.state.seed, null);
  g.state.level = level;
  const host: WorldHost = { enterWorldStage: () => {}, returnFromWorld: () => {} };
  const ctx = makeWorldCtx(host, g.state, level.world!, makeRng(1));

  assert.equal(level.rev ?? 0, 0);
  ctx.rebuild();
  assert.equal(level.rev, 1);
  ctx.rebuild();
  assert.equal(level.rev, 2, 'a second rebuild keeps counting; the renderer is the one that decides what to do with it');
});

test('a knockdown on a world floor is a game over, in the world\'s own words', () => {
  withFakeWorld(() => {
    const g = Game.forTest(9);
    g.enterWorld('minotaur');
    g.dismissModal();
    const st = g.state;
    const hero = st.hero;
    hero.hp = 1;
    hero.maxHp = 10;
    hero.def = 0;
    hero.pos = { x: 1, y: 1 };
    const m = mkMonster({ kind: 'lurker', pos: { x: 2, y: 1 } });
    m.atk = 999;
    st.level.monsters = [m];

    monsterAttack(st, m, makeRng(1));

    assert.equal(st.over, true);
    assert.equal(st.modal?.kind, 'gameOver');
    const modal = st.modal as Extract<Modal, { kind: 'gameOver' }>;
    assert.equal(modal.world, 'minotaur');
    assert.equal(modal.boss, 'minotaur');
    assert.equal(modal.cause, WORLDS.minotaur.defeat(0, 'knockdown'));
  });
});

test('retryBoss on a world floor regenerates the same stage, same data', () => {
  withFakeWorld(() => {
    const g = Game.forTest(10);
    g.enterWorld('minotaur');
    g.dismissModal();
    const st = g.state;
    (st.level.world!.data as Record<string, unknown>).marker = 'x';
    st.hero.gold = 100000;
    st.hero.pos = { x: 1, y: 1 };
    const m = mkMonster({ kind: 'lurker', pos: { x: 2, y: 1 } });
    m.atk = 999;
    m.def = 0;
    st.level.monsters = [m];
    st.hero.hp = 1;
    st.hero.maxHp = 10;

    monsterAttack(st, m, makeRng(1));
    assert.equal(st.modal?.kind, 'gameOver');
    const cost = (st.modal as Extract<Modal, { kind: 'gameOver' }>).retryCost;
    const goldBefore = st.hero.gold;

    g.retryBoss();

    assert.equal(st.over, false);
    assert.equal(st.hero.gold, goldBefore - cost);
    assert.equal(st.stats.bossRetries, 1);
    assert.equal(st.level.kind, 'world');
    assert.equal(st.level.world?.kind, 'minotaur');
    assert.equal(st.level.world?.stage, 0, 'the very same stage, not the next one');
    assert.equal((st.level.world?.data as Record<string, unknown>).marker, 'x', 'the same data regenerated it');
    assert.equal(st.modal?.kind, 'worldIntro');
    assert.deepEqual(st.hero.pos, st.level.start, 'a fresh shot, back at the stage\'s own start');
  });
});

test('a world monster kind is routed to the module\'s step (and fights)', () => {
  withFakeWorld(() => {
    let steps = 0;
    let fightsCalls = 0;
    hooks.step = (_ctx, m) => {
      steps += 1;
      return { x: m.pos.x + 1, y: m.pos.y };
    };
    hooks.fights = () => {
      fightsCalls += 1;
      return false;
    };
    const g = Game.forTest(11);
    g.enterWorld('minotaur');
    g.dismissModal();
    const st = g.state;
    const kind: WorldMonsterKind = 'medusa';
    const medusa = mkMonster({ kind, pos: { x: 5, y: 3 } });
    st.level.monsters = [medusa];

    g.tick(200);
    assert.ok(steps > 0, 'chooseStep routed the medusa to the module');
    assert.deepEqual(medusa.pos, { x: 6, y: 3 });

    // Stand the hero right next to it: `willFight` asks the module, which
    // here always says no, so no attack lands.
    st.hero.pos = { x: 5, y: 3 };
    st.hero.hp = st.hero.maxHp;
    const hpBefore = st.hero.hp;
    medusa.attackCooldown = 0;
    g.tick(200);
    assert.ok(fightsCalls > 0, 'willFight asked the module');
    assert.equal(st.hero.hp, hpBefore, 'and it refused, so nothing landed');
  });
});

function fakeHost(): WorldHost {
  return { enterWorldStage: () => {}, returnFromWorld: () => {} };
}

// ---------------------------------------------------------------------------
// Every real world, every stage: the things the hero must bump stand where a
// drag can reach them
// ---------------------------------------------------------------------------

test('every prop in every world stage stands on a floor tile with a floor tile beside it', () => {
  const stages: Record<WorldKind, number[]> = { minotaur: [0, 1, 2, 3], necromancer: [0], angels: [0, 1, 2, 3, 4, 5] };
  for (const kind of Object.keys(stages) as WorldKind[]) {
    const module = WORLDS[kind];
    for (const stage of stages[kind]) {
      for (const seed of [1, 7, 42]) {
        const hero = Game.forTest(seed).state.hero;
        const level = module.generate(stage, seed, hero, null);
        for (const p of level.props ?? []) {
          const where = `${kind} stage ${stage} seed ${seed}: ${p.id}`;
          assert.equal(level.tiles[p.pos.y][p.pos.x], Tile.Floor, `${where} stands on floor`);
          const beside = [
            { x: p.pos.x + 1, y: p.pos.y },
            { x: p.pos.x - 1, y: p.pos.y },
            { x: p.pos.x, y: p.pos.y + 1 },
            { x: p.pos.x, y: p.pos.y - 1 },
          ].some((q) => level.tiles[q.y]?.[q.x] === Tile.Floor);
          assert.ok(beside, `${where} can be stood next to`);
        }
      }
    }
  }
});
