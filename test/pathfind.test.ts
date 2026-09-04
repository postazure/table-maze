import test from 'node:test';
import assert from 'node:assert/strict';
import { Tile, key } from '../src/engine/types';
import type { LevelData, Vec } from '../src/engine/types';
import { bfsDistances, bfsPath, floorNeighbors, inBounds, isFloor } from '../src/engine/pathfind';

/** Build a tiny level from an ASCII map ('#' wall, '.' floor). */
function lvl(rows: string[]): LevelData {
  const tiles = rows.map((r) => [...r].map((c) => (c === '#' ? Tile.Wall : Tile.Floor)));
  return {
    depth: 1,
    seed: 0,
    kind: 'maze',
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

const OPEN = lvl([
  '#####',
  '#...#',
  '#.#.#',
  '#...#',
  '#####',
]);

test('inBounds / isFloor', () => {
  assert.equal(inBounds(OPEN, { x: 0, y: 0 }), true);
  assert.equal(inBounds(OPEN, { x: 5, y: 0 }), false);
  assert.equal(inBounds(OPEN, { x: -1, y: 2 }), false);
  assert.equal(isFloor(OPEN, { x: 0, y: 0 }), false);
  assert.equal(isFloor(OPEN, { x: 1, y: 1 }), true);
  assert.equal(isFloor(OPEN, { x: 2, y: 2 }), false);
  assert.equal(isFloor(OPEN, { x: 99, y: 99 }), false);
});

test('floorNeighbors returns only 4-adjacent floors', () => {
  const nb = floorNeighbors(OPEN, { x: 1, y: 2 });
  assert.deepEqual(
    nb.map(key).sort(),
    ['1,1', '1,3'].sort(),
  );
  assert.equal(floorNeighbors(OPEN, { x: 2, y: 1 }).length, 2);
});

test('bfsPath excludes from and includes to', () => {
  const p = bfsPath(OPEN, { x: 1, y: 1 }, { x: 3, y: 1 });
  assert.ok(p);
  assert.deepEqual(p, [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ]);
});

test('bfsPath from === to is an empty path', () => {
  assert.deepEqual(bfsPath(OPEN, { x: 1, y: 1 }, { x: 1, y: 1 }), []);
});

test('bfsPath returns null for unreachable / non-floor endpoints', () => {
  const split = lvl(['#####', '#.#.#', '#####']);
  assert.equal(bfsPath(split, { x: 1, y: 1 }, { x: 3, y: 1 }), null);
  assert.equal(bfsPath(OPEN, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
  assert.equal(bfsPath(OPEN, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
});

test('bfsPath honours blocked and maxLen', () => {
  // Blocking the top corridor forces the long way round the pillar.
  const blocked = bfsPath(OPEN, { x: 1, y: 1 }, { x: 3, y: 1 }, {
    blocked: (p: Vec) => p.x === 2 && p.y === 1,
  });
  assert.ok(blocked);
  assert.equal(blocked.length, 6);
  assert.deepEqual(blocked[blocked.length - 1], { x: 3, y: 1 });

  assert.equal(bfsPath(OPEN, { x: 1, y: 1 }, { x: 3, y: 3 }, { maxLen: 3 }), null);
  assert.ok(bfsPath(OPEN, { x: 1, y: 1 }, { x: 3, y: 3 }, { maxLen: 4 }));
  assert.equal(
    bfsPath(OPEN, { x: 1, y: 1 }, { x: 3, y: 1 }, { blocked: (p) => p.x === 3 && p.y === 1 }),
    null,
  );
});

test('bfsPath result is a chain of adjacent tiles', () => {
  const p = bfsPath(OPEN, { x: 1, y: 1 }, { x: 3, y: 3 })!;
  let prev = { x: 1, y: 1 };
  for (const step of p) {
    assert.equal(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y), 1);
    prev = step;
  }
});

test('bfsDistances covers reachable tiles only, respects maxDist', () => {
  const d = bfsDistances(OPEN, { x: 1, y: 1 });
  assert.equal(d.get('1,1'), 0);
  assert.equal(d.get('3,1'), 2);
  assert.equal(d.get('3,3'), 4);
  assert.equal(d.has('2,2'), false);
  assert.equal(d.size, 8);

  const near = bfsDistances(OPEN, { x: 1, y: 1 }, { maxDist: 2 });
  assert.equal(near.has('3,1'), true);
  assert.equal(near.has('3,3'), false);

  const split = lvl(['#####', '#.#.#', '#####']);
  assert.equal(bfsDistances(split, { x: 1, y: 1 }).size, 1);
  assert.equal(bfsDistances(split, { x: 0, y: 0 }).size, 0);
});
