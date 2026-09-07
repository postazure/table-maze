import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameState, LevelData, Monster, Prop, SfxId, Vec, WorldData } from '../src/engine/types';
import { eq, key } from '../src/engine/types';
import { newHero } from '../src/engine/balance';
import { bfsDistances, isFloor } from '../src/engine/pathfind';
import { makeRng } from '../src/engine/rng';
import { ARKHAM } from '../src/engine/worlds/arkham';
import type { WorldCtx } from '../src/engine/worlds/world';
import type { ItemStats } from '../src/engine/items';

// The module's own data shape, mirrored here just for the test's reading
// convenience — the module never exports it, and never needs to.
interface HouseInfo {
  id: string;
  pos: Vec;
  doorTile: Vec;
  color: 'red' | 'blue' | 'green';
  corner: boolean;
  side: 'north' | 'south';
}
interface ArkhamData {
  houses: HouseInfo[];
  tabletHouseId: string;
  clueHouseIds: string[];
  clueTexts: string[];
  notesFound: string[];
  searchedHouseIds: string[];
  tabletFound: boolean;
  ritualMs: number;
  warned60: boolean;
  warned20: boolean;
  pulseAcc: number;
  lastAlive: number;
  churchPos: Vec;
  sawCircle: boolean;
}

function dataOf(level: LevelData): ArkhamData {
  return level.world!.data as unknown as ArkhamData;
}

function propAt(level: LevelData, id: string): Prop {
  const p = (level.props ?? []).find((x) => x.id === id);
  assert.ok(p, `expected a prop with id "${id}"`);
  return p!;
}

/** A fake WorldCtx: records every call the module makes, does the minimum
 *  real work (carrying/consuming a prop) so the module's own logic can be
 *  driven end to end without the real Game. */
function makeCtx(level: LevelData, hero = newHero()) {
  const calls = {
    logs: [] as string[],
    freezes: [] as Array<{ ms: number; shake?: number }>,
    sfx: [] as SfxId[],
    rings: [] as Array<{ pos: Vec; radius: number; color: string; ttl?: number }>,
    finished: false,
    gameOverCause: null as string | null,
    returnedHome: false,
    rebuilt: false,
    consumed: [] as string[],
  };
  let carried: Prop | null = null;
  const ctx: WorldCtx = {
    state: {} as GameState,
    level,
    world: level.world!,
    hero,
    rng: makeRng(1),
    stats: {} as ItemStats,
    goto() {},
    finish() {
      calls.finished = true;
    },
    returnHome() {
      calls.returnedHome = true;
    },
    gameOver(cause: string) {
      calls.gameOverCause = cause;
    },
    freeze(ms: number, shake?: number) {
      calls.freezes.push({ ms, shake });
    },
    rebuild() {
      calls.rebuilt = true;
    },
    pickUp(prop: Prop) {
      prop.hidden = true;
      carried = prop;
    },
    setDown(at: Vec) {
      const p = carried;
      if (p) {
        p.pos = { ...at };
        p.hidden = false;
        carried = null;
        return p;
      }
      return null;
    },
    carried() {
      return carried;
    },
    consume(prop: Prop) {
      calls.consumed.push(prop.id);
      if (level.props) level.props = level.props.filter((p) => p.id !== prop.id);
      if (carried?.id === prop.id) carried = null;
    },
    spawn(m: Monster) {
      level.monsters.push(m);
    },
    text() {},
    log(text: string) {
      calls.logs.push(text);
    },
    sfx(id: SfxId) {
      calls.sfx.push(id);
    },
    ring(pos: Vec, radius: number, color: string, ttl?: number) {
      calls.rings.push({ pos, radius, color, ttl });
    },
    flash() {},
    shake() {},
  };
  return { ctx, calls, carriedNow: () => carried };
}

function reachableFromStart(level: LevelData): Set<string> {
  const blocked = new Set<string>((level.props ?? []).filter((p) => p.solid).map((p) => key(p.pos)));
  const dist = bfsDistances(level, level.start, { blocked: (p) => blocked.has(key(p)) });
  return new Set(dist.keys());
}

// ---------------------------------------------------------------------------

test('generate is deterministic for (stage, runSeed, data)', () => {
  const hero = newHero();
  const a = ARKHAM.generate(0, 20260906, hero, null);
  const b = ARKHAM.generate(0, 20260906, hero, null);
  assert.deepStrictEqual(a, b);
  const c = ARKHAM.generate(0, 999, hero, null);
  assert.notDeepStrictEqual(a, c);
});

test('the level is a valid maze floor: odd dims, a solid ring, every street connected', () => {
  for (const seed of [1, 2, 3, 42, 20260906]) {
    const level = ARKHAM.generate(0, seed, newHero(), null);
    assert.equal(level.width % 2, 1);
    assert.equal(level.height % 2, 1);
    for (let x = 0; x < level.width; x++) {
      assert.equal(level.tiles[0][x], 0, `top row wall at x=${x}`);
      assert.equal(level.tiles[level.height - 1][x], 0, `bottom row wall at x=${x}`);
    }
    for (let y = 0; y < level.height; y++) {
      assert.equal(level.tiles[y][0], 0, `left column wall at y=${y}`);
      assert.equal(level.tiles[y][level.width - 1], 0, `right column wall at y=${y}`);
    }
    assert.ok(isFloor(level, level.start));
  }
});

test('nine to twelve houses, exactly one holding the tablet, every door tile floor and reachable', () => {
  for (const seed of [1, 2, 3, 42, 20260906, 7777]) {
    const level = ARKHAM.generate(0, seed, newHero(), null);
    const data = dataOf(level);
    assert.ok(data.houses.length >= 9 && data.houses.length <= 12, `house count ${data.houses.length}`);

    const houseProps = (level.props ?? []).filter((p) => p.kind === 'house');
    assert.equal(houseProps.length, data.houses.length);

    const tabletHouses = data.houses.filter((h) => h.id === data.tabletHouseId);
    assert.equal(tabletHouses.length, 1);

    const reach = reachableFromStart(level);
    for (const h of data.houses) {
      assert.ok(isFloor(level, h.doorTile), `door tile of ${h.id} is floor`);
      assert.ok(reach.has(key(h.doorTile)), `door tile of ${h.id} reachable from start`);
    }
    // The tablet sits on its house's door tile until it's found.
    const tablet = propAt(level, 'tablet');
    const tabletHouse = data.houses.find((h) => h.id === data.tabletHouseId)!;
    assert.deepEqual(tablet.pos, tabletHouse.doorTile);
    assert.equal(tablet.hidden, true);
  }
});

test('the three clues, together, narrow every house down to the tablet\'s', () => {
  for (const seed of [1, 2, 3, 42, 20260906, 7777, 55555]) {
    const level = ARKHAM.generate(0, seed, newHero(), null);
    const data = dataOf(level);
    const truth = data.houses.find((h) => h.id === data.tabletHouseId)!;
    assert.equal(data.clueHouseIds.length, 3);
    assert.equal(data.clueTexts.length, 3);
    assert.ok(!data.clueHouseIds.includes(data.tabletHouseId), 'the tablet house never carries its own note');

    // Every house the true attributes could describe is the true house alone.
    const candidates = data.houses.filter((h) => h.side === truth.side && h.corner === truth.corner && h.color === truth.color);
    assert.deepEqual(candidates.map((h) => h.id), [truth.id]);
  }
});

test('searching the tablet house puts the tablet in the hero\'s arms', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const data = dataOf(level);
  const { ctx, carriedNow } = makeCtx(level);
  const house = propAt(level, data.tabletHouseId);

  ARKHAM.onBump!(ctx, house);

  assert.equal(house.state, 'searched');
  assert.equal(dataOf(level).tabletFound, true);
  assert.equal(carriedNow()?.kind, 'tablet');
});

test('a wrong house gives a note before the tablet is found, and costs nothing once it is', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const data = dataOf(level);
  const clueHouse = propAt(level, data.clueHouseIds[0]);
  const { ctx, calls } = makeCtx(level);

  ARKHAM.onBump!(ctx, clueHouse);
  assert.equal(clueHouse.state, 'searched');
  assert.ok(calls.logs.includes(data.clueTexts[0]));

  // Searching it again is harmless.
  calls.logs.length = 0;
  ARKHAM.onBump!(ctx, clueHouse);
  assert.ok(calls.logs.some((l) => l.toLowerCase().includes('already searched')));
});

test('bringing the tablet to the circle finishes the world', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const { ctx, calls } = makeCtx(level);
  const house = propAt(level, dataOf(level).tabletHouseId);
  ARKHAM.onBump!(ctx, house); // picks up the tablet

  const circle = propAt(level, 'circle');
  ARKHAM.onEnter!(ctx, circle.pos);

  assert.equal(calls.finished, true);
  assert.ok(calls.consumed.includes('tablet'));
  assert.equal(circle.state, 'broken');
  assert.ok(calls.freezes.length > 0);
});

test('walking onto the circle without the tablet does nothing but flavour', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const { ctx, calls } = makeCtx(level);
  const circle = propAt(level, 'circle');
  ARKHAM.onEnter!(ctx, circle.pos);
  assert.equal(calls.finished, false);
  assert.equal(calls.consumed.length, 0);
});

test('the ritual clock ends the run at zero', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const data = dataOf(level);
  const { ctx, calls } = makeCtx(level);
  data.ritualMs = 500;
  ARKHAM.tick!(ctx, 1000);
  assert.equal(calls.gameOverCause, 'ritual');
  assert.equal(dataOf(level).ritualMs, 0);
});

test('a killed cultist adds fifteen seconds to the ritual clock', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const data = dataOf(level);
  data.ritualMs = 200000;
  const { ctx } = makeCtx(level);
  ARKHAM.tick!(ctx, 0); // settle lastAlive against the fresh spawn

  const before = dataOf(level).ritualMs;
  const cultist = level.monsters.find((m) => m.kind === 'cultist' && m.id !== 'cultist-priest')!;
  cultist.alive = false;
  ARKHAM.tick!(ctx, 0);
  assert.equal(dataOf(level).ritualMs, before + 15000);
});

test('a cultist walks its patrol path back and forth', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const cultist = level.monsters.find((m) => m.kind === 'cultist' && (m.patrolPath?.length ?? 0) >= 3)!;
  assert.ok(cultist, 'expected at least one cultist with a real patrol route');
  // Isolated from the rest of the roster: this drives one cultist's own
  // step logic, not the separate (and untested-here) rule that it waits
  // rather than walk onto a tile another monster already occupies.
  level.monsters = [cultist];
  const { ctx } = makeCtx(level);
  const path = cultist.patrolPath!;

  const visited: Vec[] = [{ ...cultist.pos }];
  for (let i = 0; i < path.length * 3; i++) {
    const next = ARKHAM.step!(ctx, cultist);
    assert.ok(next, `step ${i} should move`);
    assert.equal(Math.abs(next!.x - cultist.pos.x) + Math.abs(next!.y - cultist.pos.y), 1, 'moves one tile at a time');
    cultist.pos = { x: next!.x, y: next!.y };
    visited.push({ ...cultist.pos });
  }
  // It reversed direction at least once (a true back-and-forth, not a lap
  // around a loop) and never left its own route.
  const onPath = (p: Vec) => path.some((q) => eq(q, p));
  assert.ok(visited.every(onPath));
  const atEnd = visited.some((p) => eq(p, path[0]));
  assert.ok(atEnd, 'walked all the way back to its start at least once');
});

test('the high priest never leaves the church square', () => {
  const level = ARKHAM.generate(0, 20260906, newHero(), null);
  const priest = level.monsters.find((m) => m.id === 'cultist-priest')!;
  level.monsters = [priest];
  const { ctx } = makeCtx(level);
  const church = propAt(level, 'church');
  // The square is the church's own block; every patrol tile (and every step
  // the cultist can reach) sits inside it.
  const squareX = [church.pos.x - 3, church.pos.x + 3];
  const squareY = [church.pos.y - 2, church.pos.y + 2];
  const inSquare = (p: Vec) => p.x >= squareX[0] && p.x <= squareX[1] && p.y >= squareY[0] && p.y <= squareY[1];
  for (const p of priest.patrolPath ?? []) assert.ok(inSquare(p), `${JSON.stringify(p)} inside the square`);
  for (let i = 0; i < 10; i++) {
    const next = ARKHAM.step!(ctx, priest);
    if (next) {
      assert.ok(inSquare(next));
      priest.pos = { x: next.x, y: next.y };
    }
  }
});
