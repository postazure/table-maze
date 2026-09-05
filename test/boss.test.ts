import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_KINDS, Tile, eq, inRect, key, manhattan } from '../src/engine/types';
import type { BossKind, LevelData, Rect, Vec } from '../src/engine/types';
import {
  BOSS_EVERY,
  BOSS_SALT,
  bossKindForDepth,
  bossName,
  generateBossLevel,
  makeBossMonster,
  roomAt,
} from '../src/engine/boss';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from '../src/engine/pathfind';
import { themeForDepth } from '../src/engine/themes';

const SEEDS = [1, 2, 3, 42, 999];
const DEPTHS = [3, 6, 9, 12, 15, 18, 21, 30];

/** Every (seed, depth) pair whose boss is `kind`, as generated levels. */
function levelsOf(kind: BossKind): { level: LevelData; where: string }[] {
  const out: { level: LevelData; where: string }[] = [];
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      if (bossKindForDepth(depth, seed) !== kind) continue;
      out.push({ level: generateBossLevel(depth, seed), where: `${kind} depth ${depth} seed ${seed}` });
    }
  }
  return out;
}

test('BOSS_EVERY and BOSS_SALT', () => {
  assert.equal(BOSS_EVERY, 3);
  assert.equal(typeof BOSS_SALT, 'number');
  for (const kind of BOSS_KINDS) assert.ok(bossName(kind).startsWith('The '), kind);
});

test('bossKindForDepth: all three kinds in every block of three bosses', () => {
  for (const seed of [1, 2, 3, 7, 42, 999, 12345]) {
    for (const block of [0, 1, 2]) {
      const depths = [3, 6, 9].map((d) => d + block * 9);
      const kinds = depths.map((d) => bossKindForDepth(d, seed));
      assert.deepEqual(
        [...kinds].sort(),
        [...BOSS_KINDS].sort(),
        `seed ${seed} block ${block}: ${kinds.join(',')}`,
      );
      for (const d of depths) {
        assert.equal(bossKindForDepth(d, seed), bossKindForDepth(d, seed), 'stable');
      }
    }
  }
});

test('roomAt: index of the room holding a tile, or -1', () => {
  const rooms: Rect[] = [
    { x: 2, y: 2, w: 4, h: 4 },
    { x: 10, y: 3, w: 5, h: 6 },
  ];
  assert.equal(roomAt(rooms, { x: 2, y: 2 }), 0);
  assert.equal(roomAt(rooms, { x: 5, y: 5 }), 0);
  assert.equal(roomAt(rooms, { x: 6, y: 5 }), -1); // just outside room 0
  assert.equal(roomAt(rooms, { x: 5, y: 6 }), -1);
  assert.equal(roomAt(rooms, { x: 14, y: 8 }), 1);
  assert.equal(roomAt(rooms, { x: 15, y: 8 }), -1);
  assert.equal(roomAt([], { x: 1, y: 1 }), -1);
});

test('makeBossMonster: rooted furniture, unkillable bosses, live minions', () => {
  const crystal = makeBossMonster('crystal', 6, { x: 3, y: 4 }, 'crystal1');
  assert.equal(crystal.id, 'crystal1');
  assert.deepEqual(crystal.pos, { x: 3, y: 4 });
  assert.notEqual(crystal.pos, crystal.rpos); // distinct objects, not aliases
  assert.notEqual(crystal.pos, crystal.home);
  assert.ok(crystal.hp > 0 && crystal.hp === crystal.maxHp);
  assert.ok(crystal.xp > 0);
  assert.ok(crystal.moveInterval > 1e6 && crystal.attackInterval > 1e6, 'never moves or swings');
  assert.ok(!crystal.invulnerable);

  for (const kind of ['boss', 'minotaur', 'angel'] as const) {
    assert.equal(makeBossMonster(kind, 6, { x: 1, y: 1 }, 'x').invulnerable, true, kind);
  }
  const necro = makeBossMonster('boss', 6, { x: 1, y: 1 }, 'necro');
  assert.ok(necro.moveInterval > 1e6, 'the necromancer is rooted');
  const minion = makeBossMonster('minion', 6, { x: 1, y: 1 }, 'm1');
  assert.equal(minion.state, 'chasing');
  assert.ok(minion.atk > 0 && minion.moveInterval < 1000);
  const minotaur = makeBossMonster('minotaur', 6, { x: 1, y: 1 }, 'minotaur');
  const angel = makeBossMonster('angel', 6, { x: 1, y: 1 }, 'angel1');
  assert.equal(minotaur.state, 'chasing');
  assert.equal(angel.state, 'idle', 'angels wait until the hero enters their room');
  assert.ok(angel.moveInterval < minotaur.moveInterval, 'angels are the faster hunter');
  const deep = makeBossMonster('crystal', 20, { x: 1, y: 1 }, 'c');
  assert.ok(deep.hp > crystal.hp, 'stats scale with depth');
});

test('generateBossLevel is deterministic for (depth, runSeed)', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const a = generateBossLevel(depth, seed);
      const b = generateBossLevel(depth, seed);
      assert.deepEqual(a, b, `depth ${depth} seed ${seed}`);
    }
  }
});

test('generateBossLevel: every chamber is a solvable boss level', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateBossLevel(depth, seed);
      const where = `depth ${depth} seed ${seed}`;

      assert.equal(lv.kind, 'boss', where);
      assert.equal(lv.depth, depth, where);
      assert.equal(lv.theme, themeForDepth(depth).id, where);
      assert.ok(lv.boss, `${where}: boss data`);
      assert.equal(lv.boss?.kind, bossKindForDepth(depth, seed), where);
      assert.equal(lv.boss?.defeated, false, where);

      // shape: odd dims, a solid ring of wall, rows the right length
      assert.equal(lv.width % 2, 1, where);
      assert.equal(lv.height % 2, 1, where);
      assert.equal(lv.tiles.length, lv.height, where);
      for (const row of lv.tiles) assert.equal(row.length, lv.width, where);
      for (let x = 0; x < lv.width; x++) {
        assert.equal(lv.tiles[0][x], Tile.Wall, where);
        assert.equal(lv.tiles[lv.height - 1][x], Tile.Wall, where);
      }
      for (let y = 0; y < lv.height; y++) {
        assert.equal(lv.tiles[y][0], Tile.Wall, where);
        assert.equal(lv.tiles[y][lv.width - 1], Tile.Wall, where);
      }

      // no maze furniture in a boss chamber
      assert.deepEqual(lv.keys, [], where);
      assert.deepEqual(lv.doors, [], where);
      assert.deepEqual(lv.chests, [], where);

      // start / exit
      assert.ok(isFloor(lv, lv.start), `${where}: start is floor`);
      assert.ok(isFloor(lv, lv.exit), `${where}: exit is floor`);
      assert.notDeepEqual(lv.start, lv.exit, where);
      assert.ok(bfsPath(lv, lv.start, lv.exit), `${where}: exit unreachable`);

      // monsters: unique floor tiles, never on the doorstep, ids unique
      const seen = new Set<string>([key(lv.start)]);
      const ids = new Set<string>();
      assert.ok(lv.monsters.length > 0, where);
      for (const m of lv.monsters) {
        assert.ok(isFloor(lv, m.pos), `${where}: monster ${m.id} off floor`);
        assert.ok(!seen.has(key(m.pos)), `${where}: ${m.id} shares a tile`);
        seen.add(key(m.pos));
        assert.ok(!ids.has(m.id), `${where}: duplicate id ${m.id}`);
        ids.add(m.id);
        assert.ok(
          manhattan(m.pos, lv.start) > 2,
          `${where}: ${m.id} within 2 tiles of start`,
        );
        // Only the necromancer stands on the (hidden) stairs.
        if (eq(m.pos, lv.exit)) {
          assert.equal(lv.boss?.kind, 'necromancer', `${where}: ${m.id} on the exit`);
          assert.equal(m.kind, 'boss', where);
        }
        assert.equal(m.alive, true, where);
      }
    }
  }
});

test('necromancer: five crystals down five private corridors', () => {
  const levels = levelsOf('necromancer');
  assert.ok(levels.length >= 5, 'the matrix should contain necromancer levels');
  for (const { level: lv, where } of levels) {
    const boss = lv.boss;
    assert.ok(boss && boss.kind === 'necromancer', where);
    if (!boss || boss.kind !== 'necromancer') continue;

    // the spell clock and the skeleton mill
    assert.equal(boss.spellTotalMs, 90000 + 3000 * lv.depth, where);
    assert.equal(boss.spellMs, boss.spellTotalMs, where);
    assert.equal(boss.spawnEveryMs, 5000, where);
    assert.equal(boss.spawnMs, 4000, where);
    assert.equal(boss.maxMinions, 8, where);
    assert.equal(boss.crystalsTotal, 5, where);

    const necros = lv.monsters.filter((m) => m.kind === 'boss');
    const crystals = lv.monsters.filter((m) => m.kind === 'crystal');
    assert.equal(necros.length, 1, `${where}: one necromancer`);
    assert.equal(crystals.length, 5, `${where}: five crystals`);
    assert.equal(lv.monsters.length, 6, `${where}: nothing else on the floor`);
    assert.deepEqual(necros[0].pos, lv.exit, `${where}: the stairs are under him`);
    assert.equal(necros[0].id, 'necro', where);
    assert.deepEqual(
      crystals.map((c) => c.id),
      ['crystal1', 'crystal2', 'crystal3', 'crystal4', 'crystal5'],
      where,
    );

    // the hero starts on the chamber edge, a couple of tiles clear of him
    assert.ok(manhattan(lv.start, necros[0].pos) >= 2, `${where}: start too close`);

    // a big open chamber around him: at least 7x7 of floor
    for (let y = necros[0].pos.y - 3; y <= necros[0].pos.y + 3; y++) {
      for (let x = necros[0].pos.x - 3; x <= necros[0].pos.x + 3; x++) {
        assert.ok(isFloor(lv, { x, y }), `${where}: chamber hole at ${x},${y}`);
      }
    }

    // every crystal is the end of its own corridor and can be reached while
    // the necromancer still blocks the middle of the room
    const reach = bfsDistances(lv, lv.start, { blocked: (p) => eq(p, necros[0].pos) });
    for (const c of crystals) {
      assert.equal(
        floorNeighbors(lv, c.pos).length,
        1,
        `${where}: ${c.id} is not in a dead end`,
      );
      const d = reach.get(key(c.pos));
      assert.ok(d !== undefined, `${where}: ${c.id} unreachable past the necromancer`);
      assert.ok((d ?? 0) >= 10, `${where}: ${c.id} only ${d} tiles away`);
    }
  }
});

test('minotaur: a braided maze with one distant hunter', () => {
  const levels = levelsOf('minotaur');
  assert.ok(levels.length >= 5, 'the matrix should contain minotaur levels');
  for (const { level: lv, where } of levels) {
    assert.equal(lv.boss?.kind, 'minotaur', where);
    assert.ok(lv.width <= 31 && lv.height <= 41, `${where}: ${lv.width}x${lv.height}`);
    assert.equal(lv.monsters.length, 1, where);
    const bull = lv.monsters[0];
    assert.equal(bull.kind, 'minotaur', where);
    assert.equal(bull.id, 'minotaur', where);
    assert.ok(bull.invulnerable, where);
    assert.ok(!eq(bull.pos, lv.start) && !eq(bull.pos, lv.exit), where);

    const dist = bfsDistances(lv, lv.start);
    const bullDist = dist.get(key(bull.pos)) ?? -1;
    assert.ok(bullDist >= 12, `${where}: minotaur only ${bullDist} tiles from start`);
    const exitDist = dist.get(key(lv.exit)) ?? -1;
    assert.ok(exitDist > bullDist, `${where}: the stairs are the far end`);

    // the exit is one of the farthest tiles: no other tile is much farther
    let max = 0;
    for (const d of dist.values()) max = Math.max(max, d);
    assert.ok(exitDist >= max - 4, `${where}: exit ${exitDist} vs farthest ${max}`);

    // braided: a perfect maze of this size would have far more dead ends
    let deadEnds = 0;
    let floors = 0;
    for (let y = 1; y < lv.height - 1; y++) {
      for (let x = 1; x < lv.width - 1; x++) {
        const p = { x, y };
        if (!isFloor(lv, p)) continue;
        floors++;
        if (floorNeighbors(lv, p).length === 1) deadEnds++;
      }
    }
    assert.ok(deadEnds / floors < 0.12, `${where}: ${deadEnds} dead ends of ${floors} tiles`);
  }
});

test('angels: a grid of rooms with statues in the side rooms', () => {
  const levels = levelsOf('angels');
  assert.ok(levels.length >= 5, 'the matrix should contain angel levels');
  for (const { level: lv, where } of levels) {
    const boss = lv.boss;
    assert.ok(boss && boss.kind === 'angels', where);
    if (!boss || boss.kind !== 'angels') continue;
    const rooms = boss.rooms;
    assert.equal(rooms.length, 12, `${where}: 3 columns x 4 rows`);

    // rooms: floor all through, the right size, never overlapping
    const claimed = new Set<string>();
    for (const [i, r] of rooms.entries()) {
      assert.ok(r.w >= 4 && r.w <= 7 && r.h >= 4 && r.h <= 6, `${where}: room ${i} ${r.w}x${r.h}`);
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const p: Vec = { x, y };
          assert.ok(isFloor(lv, p), `${where}: room ${i} has rock at ${key(p)}`);
          assert.ok(!claimed.has(key(p)), `${where}: rooms overlap at ${key(p)}`);
          claimed.add(key(p));
        }
      }
    }

    const startRoom = roomAt(rooms, lv.start);
    const exitRoom = roomAt(rooms, lv.exit);
    assert.ok(startRoom >= 0 && startRoom < 3, `${where}: start room ${startRoom} not top row`);
    assert.ok(exitRoom >= 9 && exitRoom < 12, `${where}: exit room ${exitRoom} not bottom row`);

    // every room is part of the level, not walled off
    const dist = bfsDistances(lv, lv.start);
    for (const [i, r] of rooms.entries()) {
      assert.ok(dist.has(key({ x: r.x, y: r.y })), `${where}: room ${i} is walled off`);
    }

    const angels = lv.monsters;
    assert.ok(angels.length >= 4 && angels.length <= 6, `${where}: ${angels.length} angels`);
    const used = new Set<number>();
    for (const [i, a] of angels.entries()) {
      assert.equal(a.kind, 'angel', where);
      assert.equal(a.id, `angel${i + 1}`, where);
      const ri = a.roomId;
      assert.ok(ri !== undefined, `${where}: ${a.id} has no roomId`);
      if (ri === undefined) continue;
      assert.ok(inRect(rooms[ri], a.pos), `${where}: ${a.id} outside rooms[${ri}]`);
      assert.equal(roomAt(rooms, a.pos), ri, `${where}: ${a.id} roomId disagrees with roomAt`);
      assert.notEqual(ri, startRoom, `${where}: ${a.id} in the start room`);
      assert.notEqual(ri, exitRoom, `${where}: ${a.id} in the exit room`);
      assert.ok(!used.has(ri), `${where}: two angels in room ${ri}`);
      used.add(ri);
      const d = dist.get(key(a.pos)) ?? -1;
      assert.ok(d >= 8, `${where}: ${a.id} only ${d} tiles from start`);
    }
  }
});
