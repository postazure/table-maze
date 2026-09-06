import test from 'node:test';
import assert from 'node:assert/strict';

import { Tile, key } from '../src/engine/types';
import type { LevelData, Vec } from '../src/engine/types';
import { Game } from '../src/engine/game';
import {
  LENS_ALPHA,
  LENS_CORE,
  LENS_NAME,
  LENS_RADIUS,
  floorOfSet,
  floorSet,
  hiddenAt,
  lensActive,
  lensFloor,
  lensLit,
  lensRevealAt,
  mouthAt,
  vaultFloor,
} from '../src/engine/lens';
import { PASSAGE_MONSTER_CAP, gateGuards, generateLevel, passageTilesOf } from '../src/engine/maze';
import { bfsDistances, floorNeighbors, isFloor } from '../src/engine/pathfind';
import { generateShopLevel } from '../src/engine/shop';
import { newHero } from '../src/engine/balance';

const SEEDS = [1, 2, 3, 42, 999];
const DEPTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** '#' = wall, anything else = floor. 'S' marks start, 'E' the exit. */
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

/**
 * A corridor with a hidden passage bypassing its middle:
 *
 *   row 1: the corridor the hero walks
 *   row 3: the passage, joined to row 1 at x = 2 and x = 6
 */
function passageLevel(): LevelData {
  const level = mkLevel([
    '#########',
    '#S.....E#',
    '#.#####.#',
    '#.......#',
    '#########',
  ]);
  const tiles: Vec[] = [
    { x: 1, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 5, y: 3 },
    { x: 6, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 2 },
  ];
  level.passages = [
    { id: 'pg1', kind: 'shortcut', tiles, mouths: [{ x: 1, y: 2 }, { x: 7, y: 2 }] },
  ];
  return level;
}

// ---------------------------------------------------------------------------
// Which floors carry what
// ---------------------------------------------------------------------------

test('a lens belongs to the three-floor set it was found in', () => {
  assert.deepEqual([1, 2, 3].map(floorSet), [0, 0, 0]);
  assert.deepEqual([4, 5, 6].map(floorSet), [1, 1, 1]);
  assert.deepEqual([1, 2, 3, 4].map(floorOfSet), [1, 2, 3, 1]);
  // The first two floors of a set hold a lens; the third holds the vault.
  for (const d of DEPTHS) assert.equal(lensFloor(d), !vaultFloor(d), `depth ${d}`);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(lensFloor), [true, true, false, true, true, false]);
});

test('a lens works on its own set of floors and nowhere else', () => {
  const hero = newHero();
  assert.equal(lensActive(hero, 1), false, 'no lens, nothing to see');
  hero.lens = { depth: 4, set: floorSet(4) };
  for (const d of [4, 5, 6]) assert.equal(lensActive(hero, d), true, `depth ${d}`);
  for (const d of [1, 2, 3, 7, 8]) assert.equal(lensActive(hero, d), false, `depth ${d}`);
});

// ---------------------------------------------------------------------------
// The light
// ---------------------------------------------------------------------------

test('the reveal is full strength underfoot and gone by the edge', () => {
  assert.equal(lensRevealAt(0), LENS_ALPHA);
  assert.equal(lensRevealAt(LENS_CORE), LENS_ALPHA);
  assert.equal(lensRevealAt(LENS_RADIUS), 0);
  assert.equal(lensRevealAt(LENS_RADIUS + 5), 0);
  // Never fully transparent: a lit passage still reads as a passage.
  assert.ok(LENS_ALPHA < 1);
  // ...and it only ever falls off as you look further.
  let prev = Infinity;
  for (let d = 0; d <= LENS_RADIUS + 1; d += 0.25) {
    const here = lensRevealAt(d);
    assert.ok(here <= prev, `reveal grew again at ${d}`);
    prev = here;
  }
});

test('the light is lit inside a passage and on its doorstep, never down the corridor', () => {
  const level = passageLevel();
  const hero = newHero();
  hero.lens = { depth: 1, set: 0 };

  hero.pos = { x: 4, y: 3 };
  assert.equal(lensLit(level, hero, 1), true, 'standing in the passage');
  hero.pos = { x: 1, y: 1 };
  assert.equal(lensLit(level, hero, 1), true, 'standing on the mouth of one');
  hero.pos = { x: 4, y: 1 };
  assert.equal(lensLit(level, hero, 1), false, 'walking the corridor above it');

  // ...and never at all without the lens.
  hero.lens = null;
  hero.pos = { x: 4, y: 3 };
  assert.equal(lensLit(level, hero, 1), false);
});

test('hiddenAt and mouthAt read the passage, not the tiles', () => {
  const level = passageLevel();
  assert.equal(hiddenAt(level, { x: 4, y: 3 }), true);
  assert.equal(hiddenAt(level, { x: 4, y: 1 }), false, 'the open corridor is not hidden');
  assert.equal(mouthAt(level, { x: 1, y: 2 }), true);
  assert.equal(mouthAt(level, { x: 4, y: 3 }), false, 'the middle of a passage is not its mouth');
  // A floor with nothing to hide answers no to everything, and cheaply.
  const plain = mkLevel(['#####', '#S.E#', '#####']);
  assert.equal(hiddenAt(plain, { x: 2, y: 1 }), false);
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

test('every maze floor hides passages, and they only ever open at their mouths', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      const passages = lv.passages ?? [];
      assert.ok(passages.length > 0, `${where}: no passages at all`);

      const hidden = new Set(passageTilesOf(lv).map(key));
      for (const pg of passages) {
        assert.ok(pg.tiles.length >= 4, `${where}: ${pg.id} is too short to be a passage`);
        assert.equal(pg.mouths.length, pg.kind === 'shortcut' ? 2 : 1, `${where}: ${pg.id} mouths`);
        const inside = new Set(pg.tiles.map(key));
        for (const t of pg.tiles) {
          assert.ok(isFloor(lv, t), `${where}: ${pg.id} has a tile that is not floor`);
          // The only tiles of a passage that touch anything else are its
          // mouths: that is what makes the passage a passage.
          const outside = floorNeighbors(lv, t).filter((nb) => !inside.has(key(nb)));
          const isMouth = pg.mouths.some((m) => m.x === t.x && m.y === t.y);
          if (!isMouth) assert.equal(outside.length, 0, `${where}: ${pg.id} leaks at ${key(t)}`);
          else assert.ok(outside.length > 0, `${where}: ${pg.id}'s mouth opens onto nothing`);
        }
      }

      // No two passages share a tile, and none of them swallows the stairs,
      // the start, or a door.
      assert.equal(hidden.size, passageTilesOf(lv).length, `${where}: passages overlap`);
      assert.ok(!hidden.has(key(lv.start)), where);
      assert.ok(!hidden.has(key(lv.exit)), where);
      for (const d of lv.doors) assert.ok(!hidden.has(key(d.pos)), `${where}: a door in a passage`);
      for (const k of lv.keys) assert.ok(!hidden.has(key(k.pos)), `${where}: a key in a passage`);
      for (const sh of lv.shrines ?? []) assert.ok(!hidden.has(key(sh.pos)), `${where}: a shrine in a passage`);
    }
  }
});

test('a passage is always a saving and never a requirement', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      const hidden = new Set(passageTilesOf(lv).map(key));
      const chests = new Set(lv.chests.map((c) => key(c.pos)));

      // Wall every passage off: the stairs, the keys and the shrines are all
      // still there for a hero who never found a lens.
      const sealed = bfsDistances(lv, lv.start, {
        blocked: (p) => hidden.has(key(p)) || chests.has(key(p)),
      });
      assert.ok(sealed.has(key(lv.exit)), `${where}: the stairs need a lens`);
      for (const k of lv.keys) assert.ok(sealed.has(key(k.pos)), `${where}: key ${k.id} needs a lens`);
      for (const sh of lv.shrines ?? []) assert.ok(sealed.has(key(sh.pos)), `${where}: ${sh.id} needs a lens`);

      // A shortcut earns its name: with every passage sealed, the walk between
      // its two ends is longer than walking the passage itself.
      for (const pg of lv.passages ?? []) {
        if (pg.kind !== 'shortcut') continue;
        const ends = pg.mouths.map((m) => floorNeighbors(lv, m).find((nb) => !hidden.has(key(nb))));
        const [a, b] = ends;
        assert.ok(a && b, `${where}: ${pg.id} has a mouth onto nothing`);
        const round = bfsDistances(lv, a as Vec, {
          blocked: (p) => hidden.has(key(p)) || chests.has(key(p)),
        }).get(key(b as Vec));
        assert.ok(round !== undefined, `${where}: ${pg.id}'s two ends are not joined at all`);
        assert.ok(
          (round as number) > pg.tiles.length,
          `${where}: ${pg.id} saves nothing (${round} tiles the long way, ${pg.tiles.length} through)`,
        );
      }
    }
  }
});

test('vaults are the third floor of a set, and the lens the first two', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      const hidden = new Set(passageTilesOf(lv).map(key));
      const vaults = (lv.passages ?? []).filter((p) => p.kind === 'vault');
      const magic = lv.chests.filter((c) => c.loot.magic);

      if (vaultFloor(depth)) {
        assert.ok(vaults.length > 0, `${where}: the last floor of a set has no vault`);
      } else {
        assert.equal(vaults.length, 0, `${where}: a vault outside the last floor of a set`);
      }
      assert.equal(magic.length, vaults.length, `${where}: one magic chest per vault`);
      for (const c of magic) {
        assert.ok(hidden.has(key(c.pos)), `${where}: a magic chest out in the open`);
        assert.equal(c.loot.magic?.level, depth, where);
        // Still a chest: solid, in a dead end, and opened with a gold key.
        assert.equal(floorNeighbors(lv, c.pos).length, 1, `${where}: a vault chest not in a dead end`);
      }
      assert.equal(
        lv.keys.filter((k) => k.kind === 'chest').length,
        lv.chests.length,
        `${where}: a chest without a key`,
      );

      const lenses = lv.chests.filter((c) => c.loot.lens);
      assert.equal(lenses.length, lensFloor(depth) ? 1 : 0, `${where}: ${lenses.length} lenses`);
      // A lens is never locked behind the thing it opens.
      for (const c of lenses) assert.ok(!hidden.has(key(c.pos)), `${where}: the lens is inside a passage`);
    }
  }
});

test('passages hold trash, never a hunter, and never in the doorway', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      for (const pg of lv.passages ?? []) {
        const inside = new Set(pg.tiles.map(key));
        const mine = lv.monsters.filter((m) => inside.has(key(m.pos)));
        assert.ok(mine.length <= PASSAGE_MONSTER_CAP, `${where}: ${pg.id} is overstocked`);
        for (const m of mine) {
          assert.notEqual(m.kind, 'lurker', `${where}: a hunter in ${pg.id}`);
          assert.ok(!pg.mouths.some((t) => key(t) === key(m.pos)), `${where}: ${m.id} blocks ${pg.id}`);
          // A patrol paces the passage and never wanders out of it.
          for (const t of m.patrolPath ?? []) {
            assert.ok(inside.has(key(t)), `${where}: ${m.id} paces out of ${pg.id}`);
          }
        }
      }
    }
  }
});

test('a passage is never a way around the guard on the stairs', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const hidden = new Set(passageTilesOf(lv).map(key));
      for (const g of gateGuards(lv)) {
        assert.ok(!hidden.has(key(g.pos)), `depth ${depth} seed ${seed}: a gate inside a passage`);
        // A gate is measured with the passages sealed, so it is still a fight
        // the floor's own level can win.
        assert.ok(g.level <= lv.depth, `depth ${depth} seed ${seed}: gate ${g.id} is over the floor`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Walking one
// ---------------------------------------------------------------------------

function passageGame(lens: boolean): Game {
  const g = Game.forTest(1234);
  const st = g.state;
  st.level = passageLevel();
  st.depth = 1;
  st.hero.pos = { x: 1, y: 1 };
  st.hero.rpos = { x: 1, y: 1 };
  st.hero.lens = lens ? { depth: 1, set: 0 } : null;
  st.trail = new Set<string>([key(st.hero.pos)]);
  st.path = [];
  st.fx = [];
  st.sfx = [];
  st.descending = 0;
  return g;
}

test('hidden ground is wall without a lens and corridor with one', () => {
  const without = passageGame(false);
  without.pointerAt({ x: 1, y: 2 });
  assert.equal(without.state.path.length, 0, 'a drag never routes into a passage');
  without.state.path = [{ x: 1, y: 2 }];
  without.tick(200);
  assert.deepEqual(without.state.hero.pos, { x: 1, y: 1 }, 'and the hero never walks into one');

  const with_ = passageGame(true);
  with_.pointerAt({ x: 1, y: 2 });
  assert.equal(with_.state.path.length, 1);
  with_.tick(200);
  assert.deepEqual(with_.state.hero.pos, { x: 1, y: 2 });
});

test('a lens opens the shortcut: the far side is a shorter drag than the corridor', () => {
  const g = passageGame(true);
  // The passage runs under the wall between x=2 and x=6, so the far mouth is
  // reached through it rather than the long way round.
  g.pointerAt({ x: 7, y: 2 });
  assert.ok(g.state.path.length > 0, 'the far mouth is reachable');
  for (const p of g.state.path) {
    assert.ok(hiddenAt(g.state.level, p) || p.y === 1, `stepped somewhere odd: ${key(p)}`);
  }
});

// ---------------------------------------------------------------------------
// Finding one, and losing it
// ---------------------------------------------------------------------------

function chestGame(loot: { lens?: boolean; gold?: number }): Game {
  const g = Game.forTest(1234);
  const st = g.state;
  st.level = mkLevel(['#####', '#S..#', '#####'], {
    chests: [{ id: 'c1', pos: { x: 3, y: 1 }, opened: false, loot: { gold: loot.gold ?? 10, xp: 1, lens: loot.lens } }],
  });
  st.depth = 1;
  st.hero.pos = { x: 2, y: 1 };
  st.hero.rpos = { x: 2, y: 1 };
  st.hero.keys.chest = 1;
  st.trail = new Set<string>([key(st.hero.pos)]);
  st.path = [];
  st.descending = 0;
  return g;
}

test('a chest with a lens in it hands it over; a second one melts down for coins', () => {
  const g = chestGame({ lens: true });
  g.pointerAt({ x: 3, y: 1 });
  g.tick(200);
  assert.deepEqual(g.state.hero.lens, { depth: 1, set: 0 });
  assert.equal(g.state.modal?.kind, 'chest');
  assert.ok(g.state.log.some((m) => m.text.includes(LENS_NAME)));

  // Already holding one for this set: the chest pays gold instead.
  const again = chestGame({ lens: true, gold: 10 });
  again.state.hero.lens = { depth: 1, set: 0 };
  again.pointerAt({ x: 3, y: 1 });
  again.tick(200);
  const modal = again.state.modal;
  assert.equal(modal?.kind, 'chest');
  if (modal?.kind === 'chest') {
    assert.equal(modal.loot.lens, false, 'the duplicate is not handed over');
    assert.ok(modal.loot.gold > 10, 'it is melted down instead');
  }
});

test('leaving the shop shatters the lens, and the stairs wait until it has', () => {
  const g = Game.forTest(2024);
  const st = g.state;
  st.depth = 3;
  st.level = generateShopLevel(3, st.seed, st.hero);
  st.hero.lens = { depth: 2, set: 0 };
  const exit = st.level.exit;
  st.hero.pos = { x: exit.x, y: exit.y - 1 };
  st.hero.rpos = { ...st.hero.pos };
  st.trail = new Set<string>([key(st.hero.pos)]);
  st.path = [];
  st.descending = 0;

  g.pointerAt(exit);
  g.tick(200);
  assert.equal(st.modal?.kind, 'lensShatter', 'the world stops for it');
  assert.ok(st.hero.lens, 'the lens is still in hand while it breaks');
  assert.ok(st.sfx.includes('lensBreak'));

  // Frozen: the descent does not run under the popup.
  const left = st.descending;
  g.tick(500);
  assert.equal(st.descending, left);

  g.dismissModal();
  assert.equal(st.hero.lens, null, 'and then it is gone');
  g.tick(1000);
  assert.equal(st.depth, 4, 'the stairs carry on by themselves');
});

test('a hero with no lens walks out of the shop without stopping', () => {
  const g = Game.forTest(2024);
  const st = g.state;
  st.depth = 3;
  st.level = generateShopLevel(3, st.seed, st.hero);
  const exit = st.level.exit;
  st.hero.pos = { x: exit.x, y: exit.y - 1 };
  st.hero.rpos = { ...st.hero.pos };
  st.trail = new Set<string>([key(st.hero.pos)]);
  st.path = [];
  st.descending = 0;

  g.pointerAt(exit);
  g.tick(200);
  assert.equal(st.modal, null);
  assert.ok(st.descending > 0);
});
