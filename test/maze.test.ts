import test from 'node:test';
import assert from 'node:assert/strict';
import { HEART, Tile, key } from '../src/engine/types';
import type { Hero, LevelData, Monster, Rng, Vec } from '../src/engine/types';
import { gateGuards, generateLevel } from '../src/engine/maze';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from '../src/engine/pathfind';
import {
  applyLevelUp,
  damage,
  levelDims,
  makeMonster,
  newHero,
  rollChestLoot,
  xpForLevel,
} from '../src/engine/balance';
import { hashSeed, makeRng } from '../src/engine/rng';

const DEPTHS = Array.from({ length: 20 }, (_, i) => i + 1);
const SEEDS = [1, 2, 3, 42, 999];

/** Every tile occupied by something. */
function entityTiles(level: LevelData): Vec[] {
  return [
    level.start,
    level.exit,
    ...level.doors.map((d) => d.pos),
    ...level.keys.map((k) => k.pos),
    ...level.chests.map((c) => c.pos),
    ...level.monsters.map((m) => m.pos),
  ];
}

/**
 * Independent solvability check: grab every key reachable with the closed doors
 * treated as walls, spend one on the first closed door we can reach, repeat.
 */
function canProgress(level: LevelData): boolean {
  const closed = new Set(level.doors.map((d) => key(d.pos)));
  const taken = new Set<string>();
  let held = 0;
  for (let i = 0; i <= level.doors.length + 1 && closed.size > 0; i++) {
    const reach = bfsDistances(level, level.start, { blocked: (p) => closed.has(key(p)) });
    for (const k of level.keys) {
      if (k.kind === 'door' && !taken.has(k.id) && reach.has(key(k.pos))) {
        taken.add(k.id);
        held++;
      }
    }
    if (held <= 0) return false;
    const next = level.doors.find(
      (d) =>
        closed.has(key(d.pos)) &&
        floorNeighbors(level, d.pos).some((nb) => reach.has(key(nb))),
    );
    if (!next) return false;
    closed.delete(key(next.pos));
    held--;
  }
  return closed.size === 0;
}

test('levelDims: odd, portrait, capped', () => {
  for (let d = 1; d <= 60; d++) {
    const { width, height } = levelDims(d);
    assert.equal(width % 2, 1);
    assert.equal(height % 2, 1);
    assert.ok(height > width, `depth ${d} should be portrait`);
    assert.ok(width <= 41 && height <= 61);
    assert.ok(width >= 21 && height >= 31);
  }
  assert.deepEqual(levelDims(1), { width: 21, height: 31 });
  assert.deepEqual(levelDims(50), { width: 41, height: 61 });
});

test('generateLevel: structure, entities and solvability', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed);
      const where = `depth ${depth} seed ${seed}`;

      // dims
      assert.equal(lv.depth, depth, where);
      assert.equal(lv.width % 2, 1, where);
      assert.equal(lv.height % 2, 1, where);
      assert.ok(lv.width <= 41 && lv.height <= 61, where);
      assert.equal(lv.tiles.length, lv.height, where);
      for (const row of lv.tiles) assert.equal(row.length, lv.width, where);
      // outer ring is solid wall
      for (let x = 0; x < lv.width; x++) {
        assert.equal(lv.tiles[0][x], Tile.Wall, where);
        assert.equal(lv.tiles[lv.height - 1][x], Tile.Wall, where);
      }

      // start / exit
      assert.ok(isFloor(lv, lv.start), `${where}: start is floor`);
      assert.ok(isFloor(lv, lv.exit), `${where}: exit is floor`);
      assert.notDeepEqual(lv.start, lv.exit, where);

      // every entity on a unique floor tile
      const tiles = entityTiles(lv);
      const seen = new Set<string>();
      for (const p of tiles) {
        assert.ok(isFloor(lv, p), `${where}: entity off floor at ${key(p)}`);
        assert.ok(!seen.has(key(p)), `${where}: two entities on ${key(p)}`);
        seen.add(key(p));
      }

      // doors
      assert.ok(lv.doors.length <= 4, where);
      for (const d of lv.doors) {
        assert.equal(d.open, false, `${where}: doors start closed`);
        const nb = floorNeighbors(lv, d.pos);
        assert.equal(nb.length, 2, `${where}: door ${d.id} is a corridor tile`);
        assert.ok(
          nb[0].x === nb[1].x || nb[0].y === nb[1].y,
          `${where}: door ${d.id} neighbours in a line`,
        );
      }

      // keys
      const doorKeys = lv.keys.filter((k) => k.kind === 'door');
      const chestKeys = lv.keys.filter((k) => k.kind === 'chest');
      assert.equal(doorKeys.length, lv.doors.length, `${where}: one key per door`);
      assert.equal(chestKeys.length, lv.chests.length, `${where}: one key per chest`);
      for (const k of lv.keys) assert.equal(k.taken, false, where);

      // chests: solid tiles, so only ever in dead ends
      assert.ok(lv.chests.length <= 8, where);
      for (const c of lv.chests) {
        assert.equal(c.opened, false, where);
        assert.ok(c.loot.gold > 0 && c.loot.xp > 0, where);
        assert.equal(floorNeighbors(lv, c.pos).length, 1, `${where}: chest ${c.id} must be in a dead end`);
      }

      // monsters
      assert.ok(lv.monsters.length >= 3, `${where}: at least 3 monsters`);
      assert.ok(lv.monsters.length <= 18, where);
      const open = bfsDistances(lv, lv.start);
      for (const m of lv.monsters) {
        const d = open.get(key(m.pos));
        assert.ok(d !== undefined && d >= 4, `${where}: ${m.id} too close to start (${d})`);
        assert.ok(m.alive && m.hp > 0 && m.hp === m.maxHp, where);
        assert.equal(m.state, 'idle', where);
        assert.deepEqual(m.home, m.pos, where);
        assert.deepEqual(m.rpos, m.pos, where);
        assert.ok(m.glyph.length > 0 && m.name.length > 0, where);
        if (m.kind === 'patrol' && m.patrolPath) {
          assert.ok(m.patrolPath.length >= 2 && m.patrolPath.length <= 10, where);
          assert.deepEqual(m.patrolPath[0], m.pos, where);
          for (let i = 1; i < m.patrolPath.length; i++) {
            const a: Vec = m.patrolPath[i - 1];
            const b: Vec = m.patrolPath[i];
            assert.ok(isFloor(lv, b), where);
            assert.equal(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 1, where);
          }
        }
        if (m.kind === 'lurker') {
          assert.ok(m.sightRange >= 3, where);
          assert.ok(m.leash >= 6, where);
        }
      }
      // ids unique
      const ids = new Set(
        [...lv.doors, ...lv.keys, ...lv.chests, ...lv.monsters].map((e) => e.id),
      );
      assert.equal(
        ids.size,
        lv.doors.length + lv.keys.length + lv.chests.length + lv.monsters.length,
        `${where}: entity ids unique per collection`,
      );

      // exit reachable once all doors are open
      assert.ok(bfsPath(lv, lv.start, lv.exit), `${where}: exit unreachable`);
      for (const c of lv.chests) assert.ok(open.has(key(c.pos)), `${where}: chest unreachable`);
      for (const k of lv.keys) assert.ok(open.has(key(k.pos)), `${where}: key unreachable`);

      // keys obtainable in order
      assert.ok(canProgress(lv), `${where}: progression blocked`);
    }
  }
});

test('generateLevel is deterministic', () => {
  for (const seed of [1, 7, 42]) {
    for (const depth of [1, 4, 9, 17, 50]) {
      const a = generateLevel(depth, seed);
      const b = generateLevel(depth, seed);
      assert.deepEqual(a, b, `depth ${depth} seed ${seed}`);
    }
  }
  assert.notDeepEqual(generateLevel(3, 1), generateLevel(3, 2));
  assert.notDeepEqual(generateLevel(3, 1), generateLevel(4, 1));
});

test('generateLevel never throws for depth 1..50', () => {
  for (let depth = 1; depth <= 50; depth++) {
    const lv = generateLevel(depth, 12345);
    assert.ok(lv.monsters.length >= 3, `depth ${depth}`);
    assert.ok(bfsPath(lv, lv.start, lv.exit), `depth ${depth}`);
  }
});

test('the maze is braided (contains loops) and still has dead ends', () => {
  const lv = generateLevel(5, 42);
  let floors = 0;
  let deadEnds = 0;
  for (let y = 0; y < lv.height; y++) {
    for (let x = 0; x < lv.width; x++) {
      if (lv.tiles[y][x] !== Tile.Floor) continue;
      floors++;
      if (floorNeighbors(lv, { x, y }).length === 1) deadEnds++;
    }
  }
  // A perfect maze on this grid has exactly (cells + walls-carved) floors; a
  // braided one has more, so an extra loop shows up as an extra floor tile.
  const cells = ((lv.width - 1) / 2) * ((lv.height - 1) / 2);
  assert.ok(floors > cells * 2 - 1, 'braiding added at least one loop');
  assert.ok(deadEnds > 0, 'some dead ends survive for chests');
});

test('generates 100 levels quickly', () => {
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) generateLevel((i % 25) + 1, 1000 + i);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `100 levels took ${ms}ms`);
});

// ---------------------------------------------------------------------------
// rng / balance
// ---------------------------------------------------------------------------

test('rng is deterministic and in range', () => {
  const a = makeRng(hashSeed(1, 2));
  const b = makeRng(hashSeed(1, 2));
  for (let i = 0; i < 200; i++) {
    const v = a.next();
    assert.equal(v, b.next());
    assert.ok(v >= 0 && v < 1);
  }
  const r = makeRng(7);
  for (let i = 0; i < 500; i++) {
    const n = r.int(-1, 1);
    assert.ok(n >= -1 && n <= 1 && Number.isInteger(n));
  }
  assert.equal(makeRng(3).int(5, 5), 5);
  const arr = [1, 2, 3, 4, 5];
  const shuffled = makeRng(9).shuffle([...arr]);
  assert.deepEqual([...shuffled].sort(), arr);
  assert.notEqual(hashSeed(1, 2), hashSeed(2, 1));
  assert.equal(hashSeed(4, 9), hashSeed(4, 9));
  assert.ok(hashSeed(0) >>> 0 === hashSeed(0));
});

test('hero progression', () => {
  const h = newHero();
  assert.equal(h.hp, 3 * HEART, 'starts with three hearts');
  assert.equal(h.maxHp, 3 * HEART);
  assert.equal(h.atk, 2);
  assert.equal(h.def, 0);
  assert.equal(h.level, 1);
  assert.equal(h.xpToNext, xpForLevel(1));
  assert.deepEqual(h.keys, { door: 0, chest: 0 });

  h.xp = xpForLevel(1) + xpForLevel(2);
  applyLevelUp(h);
  assert.equal(h.level, 3);
  assert.equal(h.maxHp, 5 * HEART, 'one heart per level');
  assert.equal(h.hp, 5 * HEART);
  assert.equal(h.atk, 4);
  assert.equal(h.def, 1); // gained at level 2 only
  assert.ok(h.xp < h.xpToNext);

  const noop = newHero();
  applyLevelUp(noop);
  assert.equal(noop.level, 1);
});

test('damage is never below 1', () => {
  const rng = makeRng(5);
  for (let i = 0; i < 200; i++) {
    assert.ok(damage(1, 99, rng) >= 1);
    const d = damage(10, 3, rng);
    assert.ok(d >= 7 && d <= 8, 'flat damage plus an occasional crit');
  }
});

test('patrols are trash, guards are a fight, lurkers are the thing you lure', () => {
  const rng = makeRng(9);
  const hero = newHero();
  assert.equal(hero.def, 0);
  // A plain (non-crit) hit from a level-1 patrol is exactly one quarter heart.
  const hits = new Set<number>();
  for (let i = 0; i < 50; i++) hits.add(damage(1, hero.def, rng));
  assert.ok(hits.has(1) && !hits.has(3), 'quarter-heart baseline, crit at most a half');

  for (const depth of [1, 2, 3, 5, 8, 12]) {
    for (let i = 0; i < 10; i++) {
      const patrol = makeMonster('patrol', depth, rng, { x: 1, y: 1 }, 'p');
      const guard = makeMonster('guard', depth, rng, { x: 1, y: 1 }, 'g');
      const lurker = makeMonster('lurker', depth, rng, { x: 1, y: 1 }, 'l');
      const where = `depth ${depth}`;
      // Level tags climb with the role: patrol at depth, guard above, lurker higher still.
      assert.ok(patrol.level >= depth && patrol.level <= depth + 1, where);
      assert.ok(guard.level >= depth + 1 && guard.level <= depth + 2, where);
      assert.ok(lurker.level >= depth + 2 && lurker.level <= depth + 3, where);
      // Patrols stay a speed bump: a quarter heart at depth 1, never more than a few swings to kill.
      if (depth === 1) assert.equal(patrol.atk, 1, where);
      assert.ok(patrol.hp <= 4 + 2 * (depth + 1), where);
      // Each role is strictly tougher, harder hitting and better paid than the last.
      assert.ok(patrol.hp < guard.hp && guard.hp < lurker.hp, `${where}: hp ${patrol.hp} ${guard.hp} ${lurker.hp}`);
      assert.ok(patrol.atk < guard.atk && guard.atk < lurker.atk, `${where}: atk ${patrol.atk} ${guard.atk} ${lurker.atk}`);
      assert.ok(patrol.xp < guard.xp && guard.xp < lurker.xp, `${where}: xp ${patrol.xp} ${guard.xp} ${lurker.xp}`);
      // A lurker at depth hits for a whole heart or more: not a monster to trade blows with.
      assert.ok(lurker.atk >= HEART, `${where}: lurker atk ${lurker.atk}`);
    }
  }
});

test('monster stats scale with depth', () => {
  const rng = makeRng(11);
  const shallow = makeMonster('guard', 1, rng, { x: 3, y: 3 }, 'm1');
  const deep = makeMonster('guard', 10, rng, { x: 3, y: 3 }, 'm2');
  assert.ok(deep.hp > shallow.hp && deep.atk > shallow.atk);
  assert.notEqual(shallow.pos, shallow.rpos); // distinct objects, not aliases
  assert.notEqual(shallow.pos, shallow.home);
  const lurker = makeMonster('lurker', 3, rng, { x: 1, y: 1 }, 'm3');
  const patrol = makeMonster('patrol', 3, rng, { x: 1, y: 1 }, 'm4');
  assert.ok(lurker.moveInterval > 140, 'lurker slower than the hero');
  assert.ok(lurker.moveInterval < patrol.moveInterval, 'lurker faster than a patrol');
  assert.equal(lurker.alive, true);
  assert.equal(lurker.moveCooldown, 0);
  assert.equal(lurker.attackCooldown, 0);
  assert.equal(lurker.lungeT, 0);
  assert.equal(lurker.hitFlash, 0);
});

// ---------------------------------------------------------------------------
// Gates: the way down is never barred by a fight the hero cannot win
// ---------------------------------------------------------------------------

test('every guard you cannot walk around sits at the floor\'s own level', () => {
  for (const depth of DEPTHS) {
    for (const seed of SEEDS) {
      const level = generateLevel(depth, seed);
      for (const g of gateGuards(level)) {
        assert.ok(
          g.level <= depth,
          `depth ${depth} seed ${seed}: gate ${g.id} is level ${g.level}`,
        );
      }
    }
  }
});

test('blocking every guard that is not a gate still leaves the stairs reachable', () => {
  for (const depth of DEPTHS) {
    for (const seed of SEEDS) {
      const level = generateLevel(depth, seed);
      const gates = new Set(gateGuards(level).map((g) => g.id));
      const solid = new Set([
        ...level.chests.map((c) => key(c.pos)),
        ...level.monsters.filter((m) => m.kind === 'guard' && !gates.has(m.id)).map((m) => key(m.pos)),
      ]);
      const reach = bfsDistances(level, level.start, { blocked: (p) => solid.has(key(p)) });
      assert.ok(reach.has(key(level.exit)), `depth ${depth} seed ${seed}: only non-gate guards bar the way`);
    }
  }
});

test('the first floor has no lurkers and no fight a brand-new hero can lose', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const level = generateLevel(1, seed);
    assert.equal(
      level.monsters.filter((m) => m.kind === 'lurker').length,
      0,
      `seed ${seed}: floor one is patrols and guards only`,
    );
    for (const m of level.monsters) {
      const r = headOn(newHero(), m, makeRng(seed * 31 + 7));
      assert.ok(r.win, `seed ${seed}: a level-one hero loses to the ${m.kind} (level ${m.level})`);
    }
  }
});

/**
 * A head-on fight to the death: the hero swings every HOLD_ATTACK_MS, the
 * monster on its own clock, nobody runs away and nobody heals. Enough to say
 * whether a fight is winnable at all, which is what the gate rules promise.
 */
function headOn(hero: Hero, m: Monster, rng: Rng): { win: boolean; heartsLeft: number } {
  const HOLD_ATTACK_MS = 300;
  let hp = hero.hp;
  let mhp = m.hp;
  let heroCd = HOLD_ATTACK_MS;
  let monsterCd = m.attackInterval;
  for (let t = 0; t < 300000; ) {
    const dt = Math.min(heroCd, monsterCd);
    t += dt;
    heroCd -= dt;
    monsterCd -= dt;
    if (heroCd <= 0) {
      mhp -= damage(hero.atk, m.def, rng);
      heroCd = HOLD_ATTACK_MS;
      if (mhp <= 0) return { win: true, heartsLeft: hp / hero.maxHp };
    }
    if (monsterCd <= 0) {
      hp -= damage(m.atk, hero.def, rng);
      monsterCd = m.attackInterval;
      if (hp <= 0) return { win: false, heartsLeft: 0 };
    }
  }
  return { win: false, heartsLeft: 0 };
}

test('the three roles still read the same against a hero who keeps pace', () => {
  const rng = makeRng(4242);
  for (const depth of [2, 5, 10, 16, 22]) {
    // A hero one level over the floor: what clearing each floor actually gives.
    const hero = newHero();
    while (hero.level <= depth) {
      hero.xp = hero.xpToNext;
      applyLevelUp(hero);
    }
    const cost = (kind: 'patrol' | 'guard' | 'lurker') => {
      let spent = 0;
      let wins = 0;
      const N = 60;
      for (let i = 0; i < N; i++) {
        const r = headOn(hero, makeMonster(kind, depth, rng, { x: 1, y: 1 }, 'm'), rng);
        spent += 1 - r.heartsLeft;
        if (r.win) wins++;
      }
      return { spent: spent / N, winRate: wins / N };
    };
    const where = `depth ${depth}`;
    assert.ok(cost('patrol').spent < 0.15, `${where}: a patrol is a speed bump`);
    const guard = cost('guard');
    assert.ok(guard.winRate > 0.9, `${where}: a guard is won at level`);
    assert.ok(guard.spent > 0.15, `${where}: but a guard costs real hearts (${guard.spent.toFixed(2)})`);
    assert.ok(cost('lurker').winRate < 0.5, `${where}: a lurker is not a fight to pick`);
  }
});

test('clearing a floor is worth about one level, not five', () => {
  // The hero must track the depth: too fast and every floor after the first is
  // free, too slow and the gate guards become walls.
  const hero = newHero();
  const owned = new Set<string>();
  for (let depth = 1; depth <= 20; depth++) {
    const level = generateLevel(depth, 1234);
    // A thorough player: every patrol and guard, every chest, no lurkers.
    for (const m of level.monsters) if (m.kind !== 'lurker') hero.xp += m.xp;
    for (const c of level.chests) {
      hero.xp += c.loot.xp;
      const item = c.loot.item;
      if (item) owned.add(item.name);
    }
    applyLevelUp(hero);
    const gap = hero.level - depth;
    assert.ok(gap >= 0 && gap <= 2, `depth ${depth}: hero is level ${hero.level}`);
  }
});

test('chest loot is sane', () => {
  const rng = makeRng(21);
  let withItem = 0;
  for (let i = 0; i < 400; i++) {
    const loot = rollChestLoot(4, rng);
    assert.ok(loot.gold > 0);
    assert.equal(loot.xp, 12);
    if (loot.item) {
      withItem++;
      assert.ok(loot.item.name.length > 0);
      const bonus = (loot.item.atk ?? 0) + (loot.item.def ?? 0) + (loot.item.maxHp ?? 0);
      assert.ok(bonus > 0);
    }
  }
  assert.ok(withItem > 100 && withItem < 300, `item rate ${withItem / 400}`);
});
