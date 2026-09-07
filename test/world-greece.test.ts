import test from 'node:test';
import assert from 'node:assert/strict';

import { Tile, eq, key } from '../src/engine/types';
import type { GameState, Hero, LevelData, Monster, Prop, Vec, WorldData } from '../src/engine/types';
import type { ItemStats } from '../src/engine/items';
import { newHero } from '../src/engine/balance';
import { bfsDistances, bfsPath } from '../src/engine/pathfind';
import { GREECE, __internal } from '../src/engine/worlds/greece';
import type { WorldCtx } from '../src/engine/worlds/world';

const SEEDS = [1, 2, 3, 42, 1234];

function hero(overrides: Partial<Hero> = {}): Hero {
  return { ...newHero(), ...overrides };
}

/** A fake WorldCtx: every method just records the call and does the minimal
 * bookkeeping a real engine would (moves props in/out of the hero's arms,
 * removes consumed props), so the module's own logic is what's under test. */
function fakeCtx(level: LevelData, h: Hero): { ctx: WorldCtx; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {
    goto: [],
    finish: [],
    returnHome: [],
    gameOver: [],
    freeze: [],
    rebuild: [],
    pickUp: [],
    setDown: [],
    consume: [],
    spawn: [],
    text: [],
    log: [],
    sfx: [],
    ring: [],
    flash: [],
    shake: [],
  };
  const ctx: WorldCtx = {
    state: { path: [] } as unknown as GameState,
    level,
    world: level.world as WorldData,
    hero: h,
    rng: { next: () => 0.5, int: (a) => a, pick: (arr) => arr[0], shuffle: (arr) => arr, chance: () => false },
    stats: {} as ItemStats,
    goto: (stage) => calls.goto.push(stage),
    finish: () => calls.finish.push(true),
    returnHome: () => calls.returnHome.push(true),
    gameOver: (cause) => calls.gameOver.push(cause),
    freeze: (ms, shake) => calls.freeze.push([ms, shake]),
    rebuild: () => calls.rebuild.push(true),
    pickUp: (prop: Prop) => {
      calls.pickUp.push(prop.id);
      prop.hidden = true;
      h.carrying = prop.id;
    },
    setDown: (at: Vec) => {
      const id = h.carrying;
      calls.setDown.push(id);
      if (!id) return null;
      const prop = (level.props ?? []).find((p) => p.id === id) ?? null;
      if (prop) {
        prop.hidden = false;
        prop.pos = { ...at };
      }
      h.carrying = null;
      return prop;
    },
    carried: () => (level.props ?? []).find((p) => p.id === h.carrying) ?? null,
    consume: (prop: Prop) => {
      calls.consume.push(prop.id);
      level.props = (level.props ?? []).filter((p) => p.id !== prop.id);
      if (h.carrying === prop.id) h.carrying = null;
    },
    spawn: (m: Monster) => {
      calls.spawn.push(m.id);
      level.monsters.push(m);
    },
    text: (pos, t, color, ttl) => calls.text.push([pos, t, color, ttl]),
    log: (t) => calls.log.push(t),
    sfx: (id) => calls.sfx.push(id),
    ring: (pos, r, color, ttl) => calls.ring.push([pos, r, color, ttl]),
    flash: (pos, color, ttl) => calls.flash.push([pos, color, ttl]),
    shake: (strength, ttl) => calls.shake.push([strength, ttl]),
  };
  return { ctx, calls };
}

function dummyMonster(kind: Monster['kind'], pos: Vec, id = kind): Monster {
  return {
    id,
    kind,
    name: kind,
    glyph: '?',
    pos: { ...pos },
    rpos: { ...pos },
    home: { ...pos },
    hp: 10,
    maxHp: 10,
    atk: 0,
    def: 0,
    level: 1,
    xp: 0,
    gold: 0,
    moveInterval: 100000,
    moveCooldown: 0,
    attackInterval: 800,
    attackCooldown: 0,
    state: 'idle',
    sightRange: 6,
    leash: 999,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    frozenMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
}

/** A tiny hand-built world-floor level from an ASCII map ('#' wall, '.' floor). */
function customLevel(rows: string[], stage: number, data: Record<string, unknown>): LevelData {
  const tiles = rows.map((r) => [...r].map((c) => (c === '#' ? Tile.Wall : Tile.Floor)));
  return {
    depth: 1,
    seed: 1,
    kind: 'world',
    theme: 'olympus',
    world: { kind: 'minotaur', stage, data, won: false },
    props: [],
    width: rows[0].length,
    height: rows.length,
    tiles,
    start: { x: 1, y: 1 },
    exit: { x: 1, y: 1 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
  };
}

function freshGreeceData(): Record<string, unknown> {
  return __internal.freshData({ next: () => 0.1, int: (a) => a, pick: (arr) => arr[0], shuffle: (arr) => arr, chance: () => false }) as unknown as Record<
    string,
    unknown
  >;
}

/** Every floor tile is reachable from `start`, except a tile sitting under a
 * solid, un-hidden prop (which blocks like a wall, same as a chest) — or one
 * of the tiles named in `except`, for a stage's documented exceptions (the
 * island before the ship has sailed, a seal's niche before it opens). */
function assertFullyReachable(level: LevelData, except: Set<string> = new Set()): void {
  const solid = new Set((level.props ?? []).filter((p) => p.solid && !p.hidden).map((p) => key(p.pos)));
  const dist = bfsDistances(level, level.start, { blocked: (p) => solid.has(key(p)) });
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      if (level.tiles[y][x] !== Tile.Floor) continue;
      const k = key({ x, y });
      if (solid.has(k) || except.has(k)) continue;
      assert.ok(dist.has(k), `tile ${k} is not reachable from start`);
    }
  }
}

// ---------------------------------------------------------------------------
// Generation: every stage, every seed
// ---------------------------------------------------------------------------

test('every stage generates an odd-dimensioned, solid-ringed level with the props it promises', () => {
  for (const seed of SEEDS) {
    for (let stage = 0; stage <= 3; stage++) {
      const lv = GREECE.generate(stage, seed, hero(), null);
      const where = `stage ${stage} seed ${seed}`;
      assert.equal(lv.width % 2, 1, where);
      assert.equal(lv.height % 2, 1, where);
      assert.equal(lv.kind, 'world', where);
      assert.equal(lv.world?.kind, 'minotaur', where);
      assert.equal(lv.world?.stage, stage, where);
      for (let x = 0; x < lv.width; x++) {
        assert.equal(lv.tiles[0][x], Tile.Wall, where);
        assert.equal(lv.tiles[lv.height - 1][x], Tile.Wall, where);
      }
      for (let y = 0; y < lv.height; y++) {
        assert.equal(lv.tiles[y][0], Tile.Wall, where);
        assert.equal(lv.tiles[y][lv.width - 1], Tile.Wall, where);
      }
      assert.equal(lv.tiles[lv.start.y][lv.start.x], Tile.Floor, where);

      if (stage === 0) {
        const kinds = new Set((lv.props ?? []).map((p) => p.kind));
        assert.ok(kinds.has('portal-home'), where);
        assert.ok(kinds.has('statue:zeus') && kinds.has('statue:poseidon') && kinds.has('statue:hades'), where);
        assert.ok(kinds.has('gate:sky') && kinds.has('gate:sea') && kinds.has('gate:underworld'), where);
        assertFullyReachable(lv);
      } else if (stage === 1) {
        const kinds = new Set((lv.props ?? []).map((p) => p.kind));
        assert.ok(kinds.has('gate:hub'), where);
        assert.ok(kinds.has('symbol:bolt'), where);
        assert.equal(lv.monsters.filter((m) => m.kind === 'medusa').length, 1, where);
        assertFullyReachable(lv);
      } else if (stage === 2) {
        const kinds = new Set((lv.props ?? []).map((p) => p.kind));
        assert.ok(kinds.has('gate:hub') && kinds.has('helm'), where);
        assert.ok(kinds.has('symbol:trident'), where);
        assert.equal(lv.monsters.filter((m) => m.kind === 'siren').length, 3, where);
        // The island is not meant to be reachable until the ship sails there.
        const island = new Set<string>();
        for (let y = 8; y < 8 + 15; y++) for (let x = 19; x < 19 + 5; x++) island.add(key({ x, y }));
        assertFullyReachable(lv, island);
      } else {
        const kinds = new Set((lv.props ?? []).map((p) => p.kind));
        assert.ok(kinds.has('gate:hub') && kinds.has('ferry:near') && kinds.has('ferry:far'), where);
        assert.ok(kinds.has('obol') && kinds.has('cake') && kinds.has('symbol:helm'), where);
        assert.equal(lv.monsters.filter((m) => m.kind === 'shade').length, 1, where);
        assert.equal(lv.monsters.filter((m) => m.kind === 'cerberus').length, 1, where);
        // The far bank, and the sealed niche, aren't reachable from the near
        // bank's start without the ferry/the brazier order — both documented
        // exceptions to "every tile reachable".
        const seal = (lv.props ?? []).find((p) => p.kind === 'seal');
        const exceptTiles = new Set<string>();
        for (let y = 0; y < lv.height; y++) {
          for (let x = 0; x < lv.width; x++) {
            if (y >= 14) exceptTiles.add(key({ x, y })); // far bank, behind the river
          }
        }
        if (seal) exceptTiles.delete(key(seal.pos));
        assertFullyReachable(lv, exceptTiles);
      }
    }
  }
});

test('generation is deterministic for a given (stage, seed, data)', () => {
  for (const seed of SEEDS) {
    for (let stage = 0; stage <= 3; stage++) {
      const h = hero();
      const a = GREECE.generate(stage, seed, h, null);
      const b = GREECE.generate(stage, seed, h, null);
      assert.deepEqual(a, b, `stage ${stage} seed ${seed}`);
    }
  }
});

test('intro and defeat never throw and always return the promised shape', () => {
  for (let stage = 0; stage <= 3; stage++) {
    const intro = GREECE.intro(stage, {});
    assert.ok(intro.title.length > 0);
    assert.ok(intro.lines.length >= 3 && intro.lines.length <= 5);
    assert.ok(GREECE.defeat(stage, 'knockdown').length > 0);
  }
  assert.match(GREECE.defeat(1, 'petrified'), /Medusa/);
  assert.match(GREECE.defeat(2, 'sirens'), /rocks/);
  assert.match(GREECE.defeat(3, 'knockdown'), /Cerberus/);
});

// ---------------------------------------------------------------------------
// The hub: the statue puzzle
// ---------------------------------------------------------------------------

test('the wrong statue refuses the offering and nothing happens', () => {
  const lv = GREECE.generate(0, 1, hero(), null);
  const { ctx, calls } = fakeCtx(lv, ctx_hero(lv));
  const trident: Prop = { id: 'symbol:trident', pos: ctx.hero.pos, kind: 'symbol:trident', solid: false, art: 'symbol:trident', carriable: true };
  lv.props = [...(lv.props ?? []), trident];
  ctx.hero.carrying = 'symbol:trident';

  const zeus = (lv.props ?? []).find((p) => p.kind === 'statue:zeus') as Prop;
  GREECE.onBump?.(ctx, zeus);

  assert.equal(calls.consume.length, 0);
  assert.equal(calls.finish.length, 0);
  assert.equal(ctx.hero.carrying, 'symbol:trident');
  assert.equal(zeus.state, undefined);
  assert.equal(calls.log.length, 1);
  assert.match(String(calls.log[0]), /Zeus has no use for a trident/);
});

test('the right statue lit, and the third one finishes the world', () => {
  const lv = GREECE.generate(0, 7, hero(), null);
  const { ctx, calls } = fakeCtx(lv, ctx_hero(lv));
  const data = lv.world!.data as { placed: Record<string, boolean> };
  data.placed.poseidon = true;
  data.placed.hades = true;

  const bolt: Prop = { id: 'symbol:bolt', pos: ctx.hero.pos, kind: 'symbol:bolt', solid: false, art: 'symbol:bolt', carriable: true };
  lv.props = [...(lv.props ?? []), bolt];
  ctx.hero.carrying = 'symbol:bolt';

  const zeus = (lv.props ?? []).find((p) => p.kind === 'statue:zeus') as Prop;
  GREECE.onBump?.(ctx, zeus);

  assert.deepEqual(calls.consume, ['symbol:bolt']);
  assert.equal(zeus.state, 'lit');
  assert.equal(data.placed.zeus, true);
  assert.equal(ctx.hero.carrying, null);
  assert.equal(calls.finish.length, 1, 'all three placed: the world is won');
});

test('a symbol the hero carries home is recreated hidden in their arms', () => {
  const h = hero({ carrying: 'symbol:trident' });
  const lv = GREECE.generate(0, 3, h, null);
  const ghost = (lv.props ?? []).find((p) => p.id === 'symbol:trident');
  assert.ok(ghost, 'the hub regenerates the carried symbol as a prop');
  assert.equal(ghost?.hidden, true);
  assert.equal(ghost?.carriable, true);

  // And the same holds re-entering the symbol's own realm while still carrying it.
  const sea = GREECE.generate(2, 3, h, null);
  const seaGhost = (sea.props ?? []).find((p) => p.id === 'symbol:trident');
  assert.ok(seaGhost);
  assert.equal(seaGhost?.hidden, true);
  // ...and the realm never spawns a second, fresh one on the ground.
  assert.equal((sea.props ?? []).filter((p) => p.id === 'symbol:trident').length, 1);
});

function ctx_hero(lv: LevelData): Hero {
  return hero({ pos: { ...lv.start }, rpos: { ...lv.start } });
}

// ---------------------------------------------------------------------------
// Medusa's gaze
// ---------------------------------------------------------------------------

test("Medusa's gaze builds only while faced and in the clear, and petrifies at 900ms", () => {
  const rows = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
  const data = freshGreeceData();
  const lv = customLevel(rows, 1, data);
  lv.monsters.push(dummyMonster('medusa', { x: 4, y: 2 }));
  const h = hero({ pos: { x: 1, y: 2 }, rpos: { x: 1, y: 2 }, facing: 'E' });
  const { ctx, calls } = fakeCtx(lv, h);

  // Facing away: no gaze at all, tick after tick.
  h.facing = 'W';
  for (let i = 0; i < 5; i++) GREECE.tick?.(ctx, 200);
  assert.equal((lv.world!.data as { gazeMs: number }).gazeMs, 0);
  assert.equal(calls.gameOver.length, 0);

  // Facing her, in the clear: gaze builds, warns once, and petrifies at 900ms.
  h.facing = 'E';
  GREECE.tick?.(ctx, 400);
  assert.equal(calls.sfx.includes('gaze'), true);
  assert.equal(calls.gameOver.length, 0);
  GREECE.tick?.(ctx, 400);
  assert.equal(calls.gameOver.length, 0);
  GREECE.tick?.(ctx, 200); // 400+400+200 = 1000ms >= 900
  assert.deepEqual(calls.gameOver, ['petrified']);
});

test('facing away resets the gaze, and a wall between breaks it entirely', () => {
  const rows = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
  const data = freshGreeceData();
  const lv = customLevel(rows, 1, data);
  lv.monsters.push(dummyMonster('medusa', { x: 4, y: 2 }));
  const h = hero({ pos: { x: 1, y: 2 }, rpos: { x: 1, y: 2 }, facing: 'E' });
  const { ctx, calls } = fakeCtx(lv, h);

  GREECE.tick?.(ctx, 700);
  assert.ok((lv.world!.data as { gazeMs: number }).gazeMs > 0);
  h.facing = 'N';
  GREECE.tick?.(ctx, 16);
  assert.equal((lv.world!.data as { gazeMs: number }).gazeMs, 0);

  // Now break the line with a wall between hero and Medusa.
  lv.tiles[2][3] = Tile.Wall;
  h.facing = 'E';
  GREECE.tick?.(ctx, 950);
  assert.equal((lv.world!.data as { gazeMs: number }).gazeMs, 0);
  assert.equal(calls.gameOver.length, 0);
});

// ---------------------------------------------------------------------------
// Sirens' song and the wax
// ---------------------------------------------------------------------------

test("a siren's song pulls the hero a tile closer every beat, unless they carry wax", () => {
  const rows = ['#########', '#.......#', '#.......#', '#.......#', '#########'];
  const data = freshGreeceData();
  const lv = customLevel(rows, 2, data);
  lv.monsters.push(dummyMonster('siren', { x: 7, y: 2 }));
  const h = hero({ pos: { x: 1, y: 2 }, rpos: { x: 1, y: 2 } });
  const { ctx, calls } = fakeCtx(lv, h);

  GREECE.tick?.(ctx, 1500);
  assert.deepEqual(h.pos, { x: 2, y: 2 }, 'pulled one tile toward the siren');
  assert.ok(calls.sfx.includes('song'));

  // Now with wax in hand: no pull at all.
  const wax: Prop = { id: 'wax:test', pos: h.pos, kind: 'wax', solid: false, art: 'wax', carriable: true, hidden: true };
  lv.props = [wax];
  h.carrying = 'wax:test';
  const before = { ...h.pos };
  GREECE.tick?.(ctx, 1500);
  assert.deepEqual(h.pos, before, 'wax stops the pull cold');
});

test('being pulled onto a rock beside a siren is a game over', () => {
  const rows = ['#########', '#.......#', '#.......#', '#.......#', '#########'];
  const data = freshGreeceData();
  const lv = customLevel(rows, 2, data);
  lv.monsters.push(dummyMonster('siren', { x: 4, y: 2 }));
  const h = hero({ pos: { x: 1, y: 2 }, rpos: { x: 1, y: 2 } });
  const { ctx, calls } = fakeCtx(lv, h);

  GREECE.tick?.(ctx, 1500); // -> (2,2): two tiles from the siren at (4,2), not yet
  assert.equal(calls.gameOver.length, 0);
  GREECE.tick?.(ctx, 1500); // -> (3,2): adjacent to the siren now
  assert.deepEqual(calls.gameOver, ['sirens']);
});

// ---------------------------------------------------------------------------
// The ship
// ---------------------------------------------------------------------------

test('the helm sails the ship: tiles re-carved, hero and cargo moved, freeze + rebuild called', () => {
  const h = hero();
  const lv = GREECE.generate(2, 5, h, null);
  h.pos = { ...(lv.props ?? []).find((p) => p.kind === 'helm')!.pos };
  const { ctx, calls } = fakeCtx(lv, h);
  const helm = (lv.props ?? []).find((p) => p.kind === 'helm') as Prop;
  const oldHelmPos = { ...helm.pos };
  const oldHeroPos = { ...h.pos };
  const oldShipTile = { ...oldHelmPos };

  GREECE.onBump?.(ctx, helm);

  assert.equal(calls.freeze.length, 1);
  assert.equal(calls.rebuild.length, 1);
  assert.equal((lv.world!.data as { ship: string }).ship, 'island');
  assert.notDeepEqual(helm.pos, oldHelmPos, 'the helm moved with the deck');
  assert.notDeepEqual(h.pos, oldHeroPos, 'the hero moved with the deck');
  assert.equal(lv.tiles[oldShipTile.y][oldShipTile.x], Tile.Wall, 'the old berth is sea again');
  assert.equal(lv.tiles[helm.pos.y][helm.pos.x], Tile.Floor, 'the new berth is floor');

  // Sailing back reverses it.
  GREECE.onBump?.(ctx, helm);
  assert.equal((lv.world!.data as { ship: string }).ship, 'pier');
  assert.deepEqual(helm.pos, oldHelmPos);
  assert.deepEqual(h.pos, oldHeroPos);
});

test('carrying wax onto the trident sets the wax down and takes the trident instead', () => {
  const h = hero();
  const lv = GREECE.generate(2, 5, h, null);
  const trident = (lv.props ?? []).find((p) => p.kind === 'symbol:trident') as Prop;
  // A fresh id (never a duplicate of the real wax:island the sea already
  // spawned) so the fake ctx's id lookups land on this one, not that one.
  const wax: Prop = { id: 'wax:carried', pos: trident.pos, kind: 'wax', solid: false, art: 'wax', carriable: true, hidden: true };
  lv.props = [...(lv.props ?? []), wax];
  h.carrying = 'wax:carried';
  h.pos = { ...trident.pos };
  const { ctx } = fakeCtx(lv, h);

  GREECE.onEnter?.(ctx, trident.pos);

  assert.equal(h.carrying, 'symbol:trident');
  assert.equal(wax.hidden, false);
  assert.deepEqual(wax.pos, trident.pos);
});

// ---------------------------------------------------------------------------
// The Underworld: the ferry, the braziers, Cerberus
// ---------------------------------------------------------------------------

test('the ferry needs an obol to cross, and nothing on the way there without one', () => {
  const h = hero();
  const lv = GREECE.generate(3, 9, h, null);
  const ferry = (lv.props ?? []).find((p) => p.kind === 'ferry:near') as Prop;
  h.pos = { ...ferry.pos };
  const { ctx, calls } = fakeCtx(lv, h);

  GREECE.onBump?.(ctx, ferry);
  assert.equal(calls.freeze.length, 0);
  assert.equal(calls.consume.length, 0);
  assert.match(String(calls.log[0]), /no obol/);

  const obol = (lv.props ?? []).find((p) => p.kind === 'obol') as Prop;
  h.carrying = obol.id;
  GREECE.onBump?.(ctx, ferry);
  assert.equal(calls.freeze.length, 1);
  assert.deepEqual(calls.consume, [obol.id]);
  assert.equal(h.carrying, null);
  assert.ok(h.pos.y > ferry.pos.y, 'moved across, to the far bank');

  // The way back costs nothing.
  const ferryFar = (lv.props ?? []).find((p) => p.kind === 'ferry:far') as Prop;
  h.pos = { ...ferryFar.pos };
  GREECE.onBump?.(ctx, ferryFar);
  assert.equal(calls.freeze.length, 2);
  assert.ok(h.pos.y < ferryFar.pos.y, 'moved back, to the near bank');
});

test('the braziers open the seal in order, and a wrong step resets them all', () => {
  const h = hero();
  const lv = GREECE.generate(3, 11, h, null);
  const { ctx, calls } = fakeCtx(lv, h);
  const braziers = (lv.props ?? []).filter((p) => p.kind === 'brazier');
  assert.equal(braziers.length, 3);
  const byOrder = (n: number) => braziers.find((b) => (b.data as { order: number }).order === n)!;
  const seal = (lv.props ?? []).find((p) => p.kind === 'seal') as Prop;
  assert.equal(seal.hidden, false);

  // Step the wrong one first (anything but #1): resets, no partial credit.
  const second = byOrder(2);
  GREECE.onEnter?.(ctx, second.pos);
  assert.equal(second.state, undefined);
  assert.equal((lv.world!.data as { brazierProgress: number }).brazierProgress, 0);
  assert.ok(calls.sfx.includes('runeFail'));

  // Now the real sequence.
  GREECE.onEnter?.(ctx, byOrder(1).pos);
  assert.equal(byOrder(1).state, 'lit');
  GREECE.onEnter?.(ctx, byOrder(2).pos);
  assert.equal(byOrder(2).state, 'lit');
  assert.equal(seal.hidden, false, 'not yet: only two of three');
  GREECE.onEnter?.(ctx, byOrder(3).pos);
  assert.equal(byOrder(3).state, 'lit');
  assert.equal(seal.hidden, true, 'all three lit in order: the seal opens');
  assert.equal((lv.world!.data as { sealOpen: boolean }).sealOpen, true);
});

test('the honey-cake set down before Cerberus puts him to sleep, and only then is he safe to pass', () => {
  const h = hero();
  const lv = GREECE.generate(3, 13, h, null);
  const cerberus = lv.monsters.find((m) => m.kind === 'cerberus') as Monster;
  const cake = (lv.props ?? []).find((p) => p.kind === 'cake') as Prop;
  const feedTile = __internal.FEED_TILE;
  const { ctx } = fakeCtx(lv, h);

  assert.equal(GREECE.fights?.(ctx, cerberus), true, 'awake: he fights');

  h.carrying = cake.id;
  h.pos = { ...feedTile };
  GREECE.onEnter?.(ctx, feedTile);

  assert.equal(h.carrying, null, 'the cake is set down, hands free');
  assert.equal((lv.world!.data as { cerberusAsleep: boolean }).cerberusAsleep, true);
  assert.equal(GREECE.fights?.(ctx, cerberus), false, 'asleep: he leaves you be');
});

test('a shade guards the obol and hunts the hero within its sight, otherwise holds still', () => {
  const rows = ['#########', '#.......#', '#.......#', '#.......#', '#########'];
  const data = freshGreeceData();
  const lv = customLevel(rows, 3, data);
  const shade = dummyMonster('shade', { x: 6, y: 2 });
  shade.sightRange = 7;
  lv.monsters.push(shade);
  const h = hero({ pos: { x: 1, y: 2 }, rpos: { x: 1, y: 2 } });
  const { ctx } = fakeCtx(lv, h);

  const next = GREECE.step?.(ctx, shade);
  assert.ok(next, 'within sight: it moves toward the hero');
  assert.ok(next!.x < shade.pos.x, 'a step toward the hero');

  shade.sightRange = 1;
  assert.equal(GREECE.step?.(ctx, shade), null, 'out of its (now short) sight: holds still');
});

// ---------------------------------------------------------------------------
// The quality pass: what the first cut got wrong
// ---------------------------------------------------------------------------

test('the underworld niche is only ever reached through the seal', () => {
  for (const seed of SEEDS) {
    const lv = GREECE.generate(3, seed, hero(), null);
    const seal = (lv.props ?? []).find((p) => p.kind === 'seal') as Prop;
    const cake = (lv.props ?? []).find((p) => p.kind === 'cake') as Prop;
    const farBank = { x: 10, y: 14 };
    const solid = new Set((lv.props ?? []).filter((p) => p.solid && !p.hidden).map((p) => key(p.pos)));
    const blocked = (p: Vec): boolean => solid.has(key(p));
    assert.equal(bfsPath(lv, farBank, cake.pos, { blocked }), null, `seed ${seed}: the cake is behind the seal`);
    solid.delete(key(seal.pos));
    assert.ok(bfsPath(lv, farBank, cake.pos, { blocked }) !== null, `seed ${seed}: and reachable once it opens`);
  }
});

test('braziers wear their order as pips in their art, lit or not', () => {
  const lv = GREECE.generate(3, 7, hero(), null);
  const braziers = (lv.props ?? []).filter((p) => p.kind === 'brazier');
  assert.equal(braziers.length, 3);
  const orders = braziers.map((b) => (b.data as { order: number }).order).sort();
  assert.deepEqual(orders, [1, 2, 3]);
  for (const b of braziers) assert.equal(b.art, `brazier:${(b.data as { order: number }).order}`);
});

test('the hazards are immune, so the hero never auto-turns to face them', () => {
  const sky = GREECE.generate(1, 3, hero(), null);
  const sea = GREECE.generate(2, 3, hero(), null);
  const under = GREECE.generate(3, 3, hero(), null);
  assert.ok(sky.monsters.find((m) => m.kind === 'medusa')!.invulnerable);
  assert.ok(sea.monsters.filter((m) => m.kind === 'siren').every((m) => m.invulnerable));
  assert.ok(under.monsters.find((m) => m.kind === 'cerberus')!.invulnerable);
  assert.ok(!under.monsters.find((m) => m.kind === 'shade')!.invulnerable, 'the shade is an ordinary fight');
});

test('a symbol set down and left behind is back where it lay next time; only a statue takes it for good', () => {
  const h = hero();
  const sky = GREECE.generate(1, 5, h, null);
  const bolt = (sky.props ?? []).find((p) => p.kind === 'symbol:bolt') as Prop;
  const { ctx } = fakeCtx(sky, h);
  ctx.pickUp(bolt);
  GREECE.tick?.(ctx, 100);
  // Dropped (a knockdown), then the stage regenerated with the same data: the bolt is back.
  ctx.setDown(h.pos);
  const again = GREECE.generate(1, 5, h, sky.world!.data);
  const back = (again.props ?? []).find((p) => p.kind === 'symbol:bolt');
  assert.ok(back && !back.hidden, 'the bolt is on the floor of the sky again');

  // Carried into the hub and placed on Zeus: gone from the sky for good.
  const hub = GREECE.generate(0, 5, h, sky.world!.data);
  const hubBolt: Prop = { id: 'symbol:bolt', pos: h.pos, kind: 'symbol:bolt', solid: false, art: 'symbol:bolt', carriable: true, hidden: true };
  hub.props = [...(hub.props ?? []), hubBolt];
  h.carrying = 'symbol:bolt';
  const hubCtx = fakeCtx(hub, h).ctx;
  GREECE.onBump?.(hubCtx, (hub.props ?? []).find((p) => p.kind === 'statue:zeus') as Prop);
  const after = GREECE.generate(1, 5, h, hub.world!.data);
  assert.equal((after.props ?? []).find((p) => p.kind === 'symbol:bolt'), undefined, 'placed: never regenerated');
});

test("the song holds the hero's feet, and the trident quiets it as the wax does", () => {
  const rows = ['#########', '#.......#', '#.......#', '#.......#', '#########'];
  const data = freshGreeceData();
  const lv = customLevel(rows, 2, data);
  lv.monsters.push(dummyMonster('siren', { x: 7, y: 2 }));
  const h = hero({ pos: { x: 1, y: 2 }, rpos: { x: 1, y: 2 } });
  const { ctx, calls } = fakeCtx(lv, h);
  ctx.state.path.push({ x: 1, y: 1 });

  GREECE.tick?.(ctx, 100);
  assert.equal(h.stun, 0, 'crossing a line between beats: not caught');
  assert.equal(ctx.state.path.length, 1, 'and still walking');
  GREECE.tick?.(ctx, 1400);
  assert.ok(h.stun > 0, 'lingering to the beat: caught');
  assert.equal(ctx.state.path.length, 0, 'the queued walk is dropped');
  assert.ok(calls.ring.length > 0 && calls.sfx.includes('song'), 'the catch is announced');
  const stunMid = h.stun;
  GREECE.tick?.(ctx, 100);
  assert.ok(h.stun >= stunMid - 100 && h.stun > 0, 'and renewed while the line holds');

  const trident: Prop = { id: 'symbol:trident', pos: h.pos, kind: 'symbol:trident', solid: false, art: 'symbol:trident', carriable: true, hidden: true };
  lv.props = [trident];
  h.carrying = 'symbol:trident';
  h.stun = 0;
  const before = { ...h.pos };
  GREECE.tick?.(ctx, 1500);
  assert.equal(h.stun, 0, 'the trident: no hold');
  assert.deepEqual(h.pos, before, 'and no pull');
});

test('a siren across open water does not reach the hero', () => {
  const rows = ['#########', '#..###..#', '#..###..#', '#..###..#', '#########'];
  const data = freshGreeceData();
  const lv = customLevel(rows, 2, data);
  lv.monsters.push(dummyMonster('siren', { x: 7, y: 2 }));
  const h = hero({ pos: { x: 1, y: 2 }, rpos: { x: 1, y: 2 } });
  const { ctx } = fakeCtx(lv, h);
  GREECE.tick?.(ctx, 1500);
  assert.equal(h.stun, 0);
  assert.deepEqual(h.pos, { x: 1, y: 2 });
});

test("the trident lies at the island end of a siren's line, on shallows that reach the rock", () => {
  const lv = GREECE.generate(2, 9, hero(), null);
  const trident = (lv.props ?? []).find((p) => p.kind === 'symbol:trident') as Prop;
  const siren = lv.monsters.find((m) => m.kind === 'siren' && m.pos.y === trident.pos.y);
  assert.ok(siren, 'a siren sings down the trident\'s row');
  for (let x = siren!.pos.x; x <= trident.pos.x; x++) assert.equal(lv.tiles[trident.pos.y][x], Tile.Floor, `open line at x=${x}`);
});
