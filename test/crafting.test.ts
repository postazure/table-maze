import test from 'node:test';
import assert from 'node:assert/strict';

import { Tile, eq, inRect, key } from '../src/engine/types';
import type { LevelData, Modal, Vec } from '../src/engine/types';
import { Game } from '../src/engine/game';
import { generateLevel, passageTilesOf } from '../src/engine/maze';
import { generateShopLevel } from '../src/engine/shop';
import { floorNeighbors, isFloor } from '../src/engine/pathfind';
import { floorSet, hiddenAt, lensActive, lensFloor } from '../src/engine/lens';
import { newHero } from '../src/engine/balance';
import { applyBoon, boonForTrophy } from '../src/engine/boons';
import { BRASS_DESCRIPTION, BRASS_NAME, brassFloor, canCraft, crystalName } from '../src/engine/crafting';
import { loadCrystals, loadHeirloom, saveHeirloom } from '../src/engine/save';

const SEEDS = [1, 2, 3, 42, 999];
const DEPTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// ---------------------------------------------------------------------------
// Test scaffolding shared with the other engine test files.
// ---------------------------------------------------------------------------

/** '#' wall, anything else floor. 'S' start, 'E' exit. */
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

/** Walk the hero one tile (they must be adjacent) and let the step land. */
function step(g: Game, to: Vec): void {
  g.pointerAt(to);
  g.tick(150);
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

function useMemStorage(): MemStorage {
  const mem = new MemStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
  return mem;
}

// ---------------------------------------------------------------------------
// Brass
// ---------------------------------------------------------------------------

test('brass turns up once per themed set, on its second or third floor, never the first', () => {
  for (const seed of SEEDS) {
    assert.equal(brassFloor(seed, 1), false, `seed ${seed}: never the run's first floor`);
    const bySet = new Map<number, number[]>();
    for (const depth of DEPTHS) {
      const set = floorSet(depth);
      if (!bySet.has(set)) bySet.set(set, []);
      if (brassFloor(seed, depth)) bySet.get(set)!.push(depth);
    }
    for (const [set, floors] of bySet) {
      assert.equal(floors.length, 1, `seed ${seed} set ${set}: ${floors.length} brass floors`);
      const floor = floors[0];
      assert.ok(floor === set * 3 + 2 || floor === set * 3 + 3, `seed ${seed} set ${set}: brass on floor ${floor}`);
    }
  }
});

test('a brass floor puts the lump in one ordinary chest; every other floor has none', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      const hidden = new Set(passageTilesOf(lv).map(key));
      const brassChests = lv.chests.filter((c) => c.loot.brass);
      if (brassFloor(seed, depth)) {
        assert.equal(brassChests.length, 1, `${where}: ${brassChests.length} brass chests`);
        assert.ok(!hidden.has(key(brassChests[0].pos)), `${where}: the lump is inside a wing`);
      } else {
        assert.equal(brassChests.length, 0, `${where}: an unexpected brass chest`);
      }
    }
  }
});

test('the brass lump has one name and one line, nowhere else', () => {
  assert.equal(BRASS_NAME, 'Brass Lump');
  assert.equal(BRASS_DESCRIPTION, 'Crafting material.');
});

// ---------------------------------------------------------------------------
// The lens: never floor one, noLens skips it
// ---------------------------------------------------------------------------

test('no chest on floor one ever holds a lens; the ordinary floors of a set still do', () => {
  const expected = [false, true, false, true, true, false, true, true, false, true, true, false];
  for (let depth = 1; depth <= 12; depth++) {
    assert.equal(lensFloor(depth), expected[depth - 1], `depth ${depth}`);
  }
  for (const seed of SEEDS) {
    for (let depth = 1; depth <= 12; depth++) {
      const lv = generateLevel(depth, seed, depth);
      const lenses = lv.chests.filter((c) => c.loot.lens);
      assert.equal(lenses.length, lensFloor(depth) ? 1 : 0, `depth ${depth} seed ${seed}: ${lenses.length} lenses`);
    }
  }
});

test('noLens skips every lens chest for the rest of the run', () => {
  for (const seed of SEEDS) {
    for (const depth of [2, 4, 5, 7, 8]) {
      const lv = generateLevel(depth, seed, depth, { noLens: true });
      assert.equal(lv.chests.filter((c) => c.loot.lens).length, 0, `depth ${depth} seed ${seed}: a lens got through`);
    }
  }
});

// ---------------------------------------------------------------------------
// The carving shrine
// ---------------------------------------------------------------------------

test('the carving shrine turns up from depth 4 on, about half the time, in a free dead end', () => {
  let seen = 0;
  let eligible = 0;
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      if (depth < 4) {
        assert.equal(lv.carver, undefined, `${where}: too early for a carving shrine`);
        continue;
      }
      eligible++;
      if (!lv.carver) continue;
      seen++;
      const hidden = new Set(passageTilesOf(lv).map(key));
      assert.ok(!hidden.has(key(lv.carver.pos)), `${where}: a carving shrine inside a wing`);
      assert.equal(lv.carver.used, false, where);
      assert.ok(isFloor(lv, lv.carver.pos), where);
      assert.equal(floorNeighbors(lv, lv.carver.pos).length, 1, `${where}: not a dead end`);
      assert.ok(!lv.chests.some((c) => eq(c.pos, lv.carver!.pos)), `${where}: shares a tile with a chest`);
      assert.ok(!lv.monsters.some((m) => eq(m.pos, lv.carver!.pos)), `${where}: shares a tile with a monster`);
      assert.ok(!(lv.shrines ?? []).some((s) => eq(s.pos, lv.carver!.pos)), `${where}: shares a tile with a shrine`);
    }
  }
  assert.ok(seen > 0, 'a carving shrine turns up sometimes');
  assert.ok(seen < eligible, 'and not always');
});

test('the carving shrine never blocks: the hero walks straight onto it, and off with a trophy in hand it opens the popup', () => {
  useMemStorage();
  const g = Game.forTest(1);
  const st = g.state;
  install(g, mkLevel(['#####', '#S..#', '#####'], { carver: { pos: { x: 2, y: 1 }, used: false } }), { x: 1, y: 1 });

  step(g, { x: 2, y: 1 });
  assert.deepEqual(st.hero.pos, { x: 2, y: 1 }, 'a carving shrine is walkable, like a shrine');
  assert.equal(st.modal === null, true);
  assert.ok(st.log.some((l) => l.text === 'A carving shrine. It wants a trophy.'));

  step(g, { x: 1, y: 1 });
  st.hero.trophies = ['minotaur'];
  step(g, { x: 2, y: 1 });
  assert.equal(st.modal?.kind, 'carve');
  assert.deepEqual((st.modal as Extract<Modal, { kind: 'carve' }>).trophies, ['minotaur']);
});

test('carveTrophy spends the trophy for a crystal, marks the shrine used, and the crystal is written to storage', () => {
  useMemStorage();
  const g = Game.forTest(1);
  const st = g.state;
  install(g, mkLevel(['#####', '#S..#', '#####'], { carver: { pos: { x: 2, y: 1 }, used: false } }), { x: 1, y: 1 });
  st.hero.trophies = ['minotaur'];
  step(g, { x: 2, y: 1 });
  assert.equal(st.modal?.kind, 'carve');

  g.carveTrophy('minotaur');
  assert.deepEqual(st.hero.trophies, []);
  assert.deepEqual(st.hero.crystals, ['minotaur']);
  assert.equal(st.level.carver?.used, true);
  assert.ok(st.sfx.includes('carve'));
  assert.ok(st.log.some((l) => l.text.includes(crystalName('minotaur'))));
  assert.equal(st.modal, null);
  assert.deepEqual(loadCrystals(), ['minotaur']);

  // Spent: stepping on it again with another trophy in hand does nothing.
  step(g, { x: 1, y: 1 });
  st.hero.trophies = ['angels'];
  step(g, { x: 2, y: 1 });
  assert.equal(st.modal, null, 'a spent carving shrine is scenery');
});

// ---------------------------------------------------------------------------
// The portal
// ---------------------------------------------------------------------------

test('the portal is floor one\'s wing only, never the treasure room, and no monster ever stands on it', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      if (depth !== 1) {
        assert.equal(lv.portal, undefined, `${where}: a portal past floor one`);
        continue;
      }
      if (!lv.portal) continue; // the rare last-resort level furnishes nothing
      const wing = (lv.passages ?? [])[0];
      assert.ok(wing, where);
      const inside = new Set(wing.tiles.map(key));
      assert.ok(inside.has(key(lv.portal.pos)), `${where}: the portal is not in the wing`);
      assert.ok(!inRect(wing.rooms[wing.treasure], lv.portal.pos), `${where}: the portal is in the treasure room`);
      assert.ok(!lv.monsters.some((m) => eq(m.pos, lv.portal!.pos)), `${where}: a monster stands on the portal`);
      assert.ok(!lv.chests.some((c) => eq(c.pos, lv.portal!.pos)), `${where}: a chest shares the portal's tile`);
    }
  }
});

test('bumping the portal with no crystal says so and blinks; with one it opens the popup', () => {
  useMemStorage();
  const g = Game.forTest(1);
  const st = g.state;
  install(g, mkLevel(['#####', '#S..#', '#####'], { portal: { pos: { x: 2, y: 1 } } }), { x: 1, y: 1 });

  step(g, { x: 2, y: 1 });
  assert.deepEqual(st.hero.pos, { x: 1, y: 1 }, 'the portal is solid');
  assert.equal(st.modal === null, true);
  assert.ok(st.log.some((l) => l.text === 'A portal, dark. It wants a carved crystal.'));
  assert.ok(st.sfx.includes('locked'));

  st.hero.crystals = ['minotaur'];
  step(g, { x: 2, y: 1 });
  assert.equal(st.modal?.kind, 'portal');
  assert.deepEqual((st.modal as Extract<Modal, { kind: 'portal' }>).crystals, ['minotaur']);
});

test('usePortal spends the crystal, persists it, and calls into the world runtime placeholder', () => {
  useMemStorage();
  const g = Game.forTest(1);
  const st = g.state;
  install(g, mkLevel(['#####', '#S..#', '#####'], { portal: { pos: { x: 2, y: 1 } } }), { x: 1, y: 1 });
  st.hero.crystals = ['minotaur'];
  step(g, { x: 2, y: 1 });
  assert.equal(st.modal?.kind, 'portal');

  g.usePortal('minotaur');
  assert.deepEqual(st.hero.crystals, []);
  assert.deepEqual(loadCrystals(), []);
  assert.ok(st.sfx.includes('portal'));
  assert.equal(st.modal, null);
  // enterWorld is a placeholder until the world runtime lands; this is the
  // one thing it does, and usePortal must still be the one calling it.
  assert.ok(st.log.some((l) => l.text === 'The portal opens'), 'usePortal called into enterWorld');
});

// ---------------------------------------------------------------------------
// The shop's bench alcove
// ---------------------------------------------------------------------------

test('the shop hides a two-tile alcove: both tiles hidden, the mouth touches the room, the bench needs a lens', () => {
  const hero = newHero();
  const level = generateShopLevel(6, 1234, hero);
  const wing = (level.passages ?? [])[0];
  assert.ok(wing, 'the bench alcove is a passage like any wing');
  assert.equal(wing.tiles.length, 2);
  assert.equal(wing.mouths.length, 1);

  const benchPos = level.bench!.pos;
  const mouthPos = wing.mouths[0];
  assert.ok(hiddenAt(level, benchPos), 'the bench sits on hidden ground');
  assert.ok(hiddenAt(level, mouthPos), 'the mouth is hidden too');

  const roomNeighbor = floorNeighbors(level, mouthPos).find((p) => !hiddenAt(level, p));
  assert.ok(roomNeighbor, 'the mouth touches an ordinary room tile');

  // Without a lens the alcove might as well be wall: no route reaches it.
  useMemStorage();
  const g = Game.forTest(1);
  const st = g.state;
  st.depth = 6;
  st.hero.lens = null;
  install(g, level, roomNeighbor!);
  g.pointerAt(benchPos);
  assert.equal(st.path.length, 0, 'no lens, no route to the bench');
  g.pointerAt(mouthPos);
  assert.equal(st.path.length, 0, 'no lens, not even to the mouth');

  // With one active on this depth, the same drag reaches all the way in.
  st.hero.lens = { depth: 6, set: floorSet(6) };
  g.pointerAt(benchPos);
  assert.ok(st.path.length > 0, 'a lens opens the way to the bench');
});

// ---------------------------------------------------------------------------
// Crafting the lens whole
// ---------------------------------------------------------------------------

test('canCraft refuses with no active lens, an already-whole one, or no brass — and only then says yes', () => {
  const hero = newHero();
  assert.equal(canCraft(hero, 2).ok, false, 'no lens at all');

  hero.lens = { depth: 2, set: floorSet(2) };
  assert.equal(canCraft(hero, 2).ok, false, 'no brass yet');
  assert.equal(canCraft(hero, 5).ok, false, 'the lens does not work on a different set');

  hero.brass = 1;
  assert.equal(canCraft(hero, 2).ok, true);

  hero.lens.unbreakable = true;
  assert.equal(canCraft(hero, 2).ok, false, 'already whole');
});

function benchGame(seed = 1): Game {
  // A fresh Game reads storage (crystals, the heirloom flag) at startup; a
  // clean slate keeps this test isolated from whatever another test wrote.
  useMemStorage();
  const g = Game.forTest(seed);
  const st = g.state;
  st.depth = 3;
  const level = generateShopLevel(3, st.seed, st.hero);
  const wing = (level.passages ?? [])[0];
  install(g, level, wing.mouths[0]);
  return g;
}

test('bumping the bench opens the craft popup, greyed out with the refusal when canCraft is false', () => {
  const g = benchGame();
  const st = g.state;
  const benchPos = st.level.bench!.pos;

  // No lens yet: the popup still opens (the bench is reachable, we are
  // standing at its mouth already), but it cannot be worked.
  st.hero.lens = { depth: 3, set: floorSet(3) };
  step(g, benchPos);
  assert.equal(st.modal?.kind, 'craft');
  let modal = st.modal as Extract<Modal, { kind: 'craft' }>;
  assert.equal(modal.canCraft, false);
  assert.ok(modal.reason.length > 0);
  g.craftLens();
  assert.equal(st.hero.lens?.unbreakable, undefined, 'nothing to craft with no brass');

  g.dismissModal();
  st.hero.brass = 1;
  step(g, benchPos);
  modal = st.modal as Extract<Modal, { kind: 'craft' }>;
  assert.equal(modal.canCraft, true);
});

test('craftLens fills the housing: unbreakable, brass spent, the heirloom flag set, the modal closes', () => {
  useMemStorage();
  const g = benchGame();
  const st = g.state;
  st.hero.lens = { depth: 3, set: floorSet(3) };
  st.hero.brass = 1;
  const benchPos = st.level.bench!.pos;
  step(g, benchPos);
  assert.equal(st.modal?.kind, 'craft');

  g.craftLens();
  assert.equal(st.hero.lens?.unbreakable, true);
  assert.equal(st.hero.brass, 0);
  assert.ok(st.sfx.includes('craft'));
  assert.ok(st.log.some((l) => l.text === 'The lens is whole'));
  assert.equal(st.modal, null);
  assert.equal(loadHeirloom(), true);
});

// ---------------------------------------------------------------------------
// The unbreakable lens
// ---------------------------------------------------------------------------

test('an unbreakable lens works on every depth and survives the shop\'s stairs', () => {
  const hero = newHero();
  hero.lens = { depth: 2, set: 0, unbreakable: true };
  for (const d of [1, 2, 3, 5, 9, 100]) assert.equal(lensActive(hero, d), true, `depth ${d}`);

  useMemStorage();
  const g = Game.forTest(2024);
  const st = g.state;
  st.depth = 3;
  st.hero.lens = { depth: 2, set: 0, unbreakable: true };
  const level = generateShopLevel(3, st.seed, st.hero);
  install(g, level, { x: level.exit.x, y: level.exit.y - 1 });

  g.pointerAt(level.exit);
  g.tick(200);
  assert.equal(st.modal, null, 'no lensShatter for an unbreakable lens');
  assert.ok(st.descending > 0);
  g.tick(1000);
  assert.equal(st.hero.lens?.unbreakable, true, 'it rides the stairs down with the hero');
});

// ---------------------------------------------------------------------------
// The heirloom
// ---------------------------------------------------------------------------

test('the heirloom flag starts the next run with an ordinary lens for the first set, then clears itself', () => {
  useMemStorage();
  saveHeirloom(true);
  const g = new Game(null);
  assert.equal(loadHeirloom(), false, 'read once, then cleared');
  assert.deepEqual(g.state.hero.lens, { depth: 1, set: 0, heirloom: true });
  assert.ok(g.state.log.some((l) => l.text.includes("brass housing has cracked")));

  // It shatters at the first shop exactly like any other lens.
  const st = g.state;
  st.depth = 3;
  const level = generateShopLevel(3, st.seed, st.hero);
  install(g, level, { x: level.exit.x, y: level.exit.y - 1 });
  g.pointerAt(level.exit);
  g.tick(200);
  assert.equal(st.modal?.kind, 'lensShatter');
  g.dismissModal();
  assert.equal(st.hero.lens, null);
});

// ---------------------------------------------------------------------------
// The boon rename: sight -> grace
// ---------------------------------------------------------------------------

test('the angels boon is Angel\'s Grace: spirit and a potion, never a lens', () => {
  assert.equal(boonForTrophy('angels'), 'grace');
  const hero = newHero();
  const before = { spirit: hero.spirit, potionCapacity: hero.potionCapacity, potions: hero.potions };
  applyBoon(hero, 'grace', 4);
  assert.equal(hero.spirit, before.spirit + 2);
  assert.equal(hero.potionCapacity, before.potionCapacity + 1);
  assert.equal(hero.potions, before.potions + 1);
  assert.equal(hero.lens, null, "grace never hands over a lens");
});
