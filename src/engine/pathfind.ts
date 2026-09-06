/**
 * Grid helpers and BFS over the tile grid.
 *
 * All searches walk 4-connected through `Tile.Floor` tiles. Callers pass a
 * `blocked` predicate to treat closed doors / monsters as walls.
 */
import { Tile, key } from './types';
import type { LevelData, Vec } from './types';

/** N, E, S, W offsets — fixed order keeps every search deterministic. */
const OFFS: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function inBounds(level: LevelData, p: Vec): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < level.width && p.y < level.height;
}

export function isFloor(level: LevelData, p: Vec): boolean {
  return inBounds(level, p) && level.tiles[p.y][p.x] === Tile.Floor;
}

/** 4-neighbour floor tiles, in N/E/S/W order. */
export function floorNeighbors(level: LevelData, p: Vec): Vec[] {
  const out: Vec[] = [];
  for (const d of OFFS) {
    const q = { x: p.x + d.x, y: p.y + d.y };
    if (isFloor(level, q)) out.push(q);
  }
  return out;
}

/**
 * BFS shortest path from `from` to `to` through Floor tiles.
 * Returns the tiles EXCLUDING `from` and INCLUDING `to`, or null when there is
 * no route (or the route would be longer than `maxLen`).
 */
export function bfsPath(
  level: LevelData,
  from: Vec,
  to: Vec,
  opts?: { blocked?: (p: Vec) => boolean; maxLen?: number },
): Vec[] | null {
  if (!isFloor(level, from) || !isFloor(level, to)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const blocked = opts?.blocked;
  const maxLen = opts?.maxLen ?? Infinity;
  if (maxLen < 1) return null;
  if (blocked && blocked(to)) return null;

  const w = level.width;
  const h = level.height;
  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  const depth = new Int32Array(w * h);

  const startIdx = from.y * w + from.x;
  const goalIdx = to.y * w + to.x;
  seen[startIdx] = 1;
  let queue: number[] = [startIdx];

  while (queue.length) {
    const nextQ: number[] = [];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const d = depth[cur];
      if (d >= maxLen) continue;
      for (const off of OFFS) {
        const nx = cx + off.x;
        const ny = cy + off.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        if (level.tiles[ny][nx] !== Tile.Floor) continue;
        if (blocked && blocked({ x: nx, y: ny })) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        depth[ni] = d + 1;
        if (ni === goalIdx) {
          const path: Vec[] = [];
          let step = ni;
          while (step !== startIdx) {
            path.push({ x: step % w, y: (step - (step % w)) / w });
            step = prev[step];
          }
          path.reverse();
          return path;
        }
        nextQ.push(ni);
      }
    }
    queue = nextQ;
  }
  return null;
}

/**
 * Every floor tile whose removal would cut `to` off from `from`: the
 * articulation points of the floor graph that separate the two, as `key(p)`
 * strings. Neither endpoint is ever included. One depth-first walk (Tarjan's
 * low-link, iterative so a long corridor cannot blow the stack) answers for
 * every tile at once what a blocked BFS per tile would answer one at a time.
 * Empty when `to` is not reachable from `from` at all.
 */
export function cutTiles(level: LevelData, from: Vec, to: Vec): Set<string> {
  const out = new Set<string>();
  if (!isFloor(level, from) || !isFloor(level, to)) return out;
  const w = level.width;
  const h = level.height;
  const n = w * h;
  const tin = new Int32Array(n).fill(-1);
  const tout = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const dirAt = new Uint8Array(n);
  const root = from.y * w + from.x;
  const goal = to.y * w + to.x;
  let timer = 0;
  const stack: number[] = [root];
  tin[root] = low[root] = timer++;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    if (dirAt[cur] < 4) {
      const off = OFFS[dirAt[cur]++];
      const nx = (cur % w) + off.x;
      const ny = (cur - (cur % w)) / w + off.y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (level.tiles[ny][nx] !== Tile.Floor) continue;
      const ni = ny * w + nx;
      if (tin[ni] === -1) {
        parent[ni] = cur;
        tin[ni] = low[ni] = timer++;
        stack.push(ni);
      } else if (ni !== parent[cur] && tin[ni] < low[cur]) {
        low[cur] = tin[ni];
      }
      continue;
    }
    stack.pop();
    tout[cur] = timer++;
    const p = parent[cur];
    if (p < 0) continue;
    if (low[cur] < low[p]) low[p] = low[cur];
    // `p` cuts the goal off when this child's subtree has no way round it
    // and the goal is in that subtree. The root never counts: it is `from`.
    if (p !== root && low[cur] >= tin[p] && tin[goal] >= tin[cur] && tin[goal] <= tout[cur]) {
      out.add(`${p % w},${(p - (p % w)) / w}`);
    }
  }
  if (tin[goal] === -1) return new Set<string>();
  out.delete(key(to));
  return out;
}

/** BFS distances from `from` to every reachable floor tile (`key(p)` -> steps). */
export function bfsDistances(
  level: LevelData,
  from: Vec,
  opts?: { blocked?: (p: Vec) => boolean; maxDist?: number },
): Map<string, number> {
  const out = new Map<string, number>();
  if (!isFloor(level, from)) return out;
  const blocked = opts?.blocked;
  const maxDist = opts?.maxDist ?? Infinity;

  const w = level.width;
  const h = level.height;
  const seen = new Uint8Array(w * h);
  seen[from.y * w + from.x] = 1;
  out.set(key(from), 0);
  let queue: number[] = [from.y * w + from.x];
  let d = 0;

  while (queue.length && d < maxDist) {
    const nextQ: number[] = [];
    d++;
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (const off of OFFS) {
        const nx = cx + off.x;
        const ny = cy + off.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        if (level.tiles[ny][nx] !== Tile.Floor) continue;
        if (blocked && blocked({ x: nx, y: ny })) continue;
        seen[ni] = 1;
        out.set(`${nx},${ny}`, d);
        nextQ.push(ni);
      }
    }
    queue = nextQ;
  }
  return out;
}
