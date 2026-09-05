/**
 * Level generation.
 *
 * 1. Perfect maze via an iterative recursive backtracker on odd cells.
 * 2. Braid ~15% of the dead ends so the level contains loops (lurkers can be
 *    baited away from a corridor and out-run around the loop).
 * 3. start in the top-left region, exit among the BFS-farthest tiles.
 * 4. Doors on corridor tiles of the start->exit path, each with a key that is
 *    reachable before that door (and before every later door) is opened.
 * 5. Chests in dead ends, one chest key each.
 * 6. Monsters: guards on chokepoints, patrols on corridor runs, lurkers on
 *    side branches next to the main path.
 * 7. Validate solvability; retry with a re-mixed seed, relax as a last resort.
 */
import { Tile, key, parseKey, eq } from './types';
import type { Chest, Door, KeyItem, LevelData, Monster, RosterKind, Rng, Vec, Warren } from './types';
import { hashSeed, makeRng } from './rng';
import { levelDims, makeMonster, rollChestLoot } from './balance';
import { themeForDepth } from './themes';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from './pathfind';

const MAX_ATTEMPTS = 20;
/** Minimum BFS distance from `start` at which a monster may spawn. */
const MONSTER_MIN_DIST = 5;
/** First depth that carries lurkers. Floor one is patrols and guards only. */
const LURKERS_FROM_DEPTH = 2;
/** Most monsters a floor's own route and side branches carry, warrens aside. */
export const ROUTE_MONSTER_CAP = 18;

interface GenOpts {
  doors: boolean;
  chests: boolean;
}

export function generateLevel(depth: number, runSeed: number): LevelData {
  const d = Math.max(1, Math.floor(depth));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = attempt === 0 ? hashSeed(runSeed, d) : hashSeed(runSeed, d, attempt);
    const level = build(d, seed, { doors: true, chests: true });
    if (validate(level)) return level;
  }
  // Relax: drop the doors (and their keys), keep the rest.
  for (let attempt = MAX_ATTEMPTS; attempt < MAX_ATTEMPTS + 8; attempt++) {
    const seed = hashSeed(runSeed, d, attempt);
    const level = build(d, seed, { doors: false, chests: true });
    if (validate(level)) return level;
  }
  // Never throw: a bare maze with monsters is always solvable.
  return build(d, hashSeed(runSeed, d, 9999), { doors: false, chests: false });
}

// ---------------------------------------------------------------------------
// Maze carving
// ---------------------------------------------------------------------------

function carveMaze(width: number, height: number, rng: Rng): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = new Array(width).fill(Tile.Wall);
    tiles.push(row);
  }
  const cw = (width - 1) / 2;
  const ch = (height - 1) / 2;
  const visited: boolean[] = new Array(cw * ch).fill(false);
  const cellDirs: Vec[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  const startCx = rng.int(0, cw - 1);
  const startCy = rng.int(0, ch - 1);
  visited[startCy * cw + startCx] = true;
  tiles[2 * startCy + 1][2 * startCx + 1] = Tile.Floor;
  const stack: Vec[] = [{ x: startCx, y: startCy }];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const open: Vec[] = [];
    for (const dir of cellDirs) {
      const nx = cur.x + dir.x;
      const ny = cur.y + dir.y;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      if (visited[ny * cw + nx]) continue;
      open.push({ x: nx, y: ny });
    }
    if (!open.length) {
      stack.pop();
      continue;
    }
    const nc = rng.pick(open);
    visited[nc.y * cw + nc.x] = true;
    tiles[2 * nc.y + 1][2 * nc.x + 1] = Tile.Floor;
    // knock out the wall between the two cells
    tiles[cur.y + nc.y + 1][cur.x + nc.x + 1] = Tile.Floor;
    stack.push(nc);
  }
  return tiles;
}

function countFloorNb(tiles: Tile[][], width: number, height: number, x: number, y: number): number {
  let n = 0;
  if (y > 0 && tiles[y - 1][x] === Tile.Floor) n++;
  if (x < width - 1 && tiles[y][x + 1] === Tile.Floor) n++;
  if (y < height - 1 && tiles[y + 1][x] === Tile.Floor) n++;
  if (x > 0 && tiles[y][x - 1] === Tile.Floor) n++;
  return n;
}

/** Open ~`frac` of the dead ends into a neighbouring corridor, creating loops. */
function braid(tiles: Tile[][], width: number, height: number, rng: Rng, frac: number): void {
  const ends: Vec[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y][x] !== Tile.Floor) continue;
      if (countFloorNb(tiles, width, height, x, y) === 1) ends.push({ x, y });
    }
  }
  rng.shuffle(ends);
  const target = Math.floor(ends.length * frac);
  const dirs: Vec[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  for (let i = 0; i < target; i++) {
    const p = ends[i];
    const cands: Vec[] = [];
    for (const dir of dirs) {
      const wx = p.x + dir.x;
      const wy = p.y + dir.y;
      const ox = p.x + 2 * dir.x;
      const oy = p.y + 2 * dir.y;
      if (wx <= 0 || wy <= 0 || wx >= width - 1 || wy >= height - 1) continue;
      if (ox < 0 || oy < 0 || ox >= width || oy >= height) continue;
      if (tiles[wy][wx] !== Tile.Wall) continue;
      if (tiles[oy][ox] !== Tile.Floor) continue;
      cands.push({ x: wx, y: wy });
    }
    if (!cands.length) continue;
    const w = rng.pick(cands);
    tiles[w.y][w.x] = Tile.Floor;
  }
}

// ---------------------------------------------------------------------------
// Build one candidate level
// ---------------------------------------------------------------------------

function build(depth: number, seed: number, opts: GenOpts): LevelData {
  const rng = makeRng(seed);
  const { width, height } = levelDims(depth);
  const tiles = carveMaze(width, height, rng);
  braid(tiles, width, height, rng, 0.15);

  const level: LevelData = {
    depth,
    seed,
    kind: 'maze',
    theme: themeForDepth(depth).id,
    width,
    height,
    tiles,
    start: { x: 1, y: 1 },
    exit: { x: 1, y: 1 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
  };

  level.start = pickStart(level, rng);
  level.exit = pickExit(level, bfsDistances(level, level.start), rng);

  // Warrens are carved before anything is placed on the floor, and they open
  // new tiles, so the route to the stairs is measured afterwards.
  const warrens = carveWarrens(level, bfsPath(level, level.start, level.exit) ?? [], rng);
  level.warrens = warrens;

  const distFromStart = bfsDistances(level, level.start);
  const mainPath = bfsPath(level, level.start, level.exit) ?? [];
  const fullPath: Vec[] = [level.start, ...mainPath];
  const onMain = new Set(fullPath.map(key));

  const used = new Set<string>([key(level.start), key(level.exit)]);
  let keyCount = 0;

  if (opts.doors) {
    const doors = pickDoors(level, fullPath, depth, rng);
    // Assign a key to each door; drop doors we cannot key.
    let i = 0;
    while (i < doors.length) {
      const blockedKeys = new Set(doors.slice(i).map((p) => key(p)));
      const reach = bfsDistances(level, level.start, { blocked: (p) => blockedKeys.has(key(p)) });
      const spot = pickKeySpot(level, reach, used, onMain, rng);
      if (!spot) {
        doors.splice(i, 1); // unkeyable door: drop it and retry this index
        continue;
      }
      const doorPos = doors[i];
      level.doors.push({ id: `d${level.doors.length + 1}`, pos: doorPos, open: false });
      used.add(key(doorPos));
      level.keys.push({ id: `k${++keyCount}`, pos: spot, kind: 'door', taken: false });
      used.add(key(spot));
      i++;
    }
  }

  if (opts.chests) {
    const chestCount = Math.min(8, 3 + Math.floor(depth / 2));
    const chestSpots = pickChestSpots(level, used, onMain, chestCount, rng);
    for (const pos of chestSpots) {
      const chest: Chest = {
        id: `c${level.chests.length + 1}`,
        pos,
        opened: false,
        loot: rollChestLoot(depth, rng),
      };
      level.chests.push(chest);
      used.add(key(pos));
    }
    // One chest key per chest, anywhere free (all doors eventually open).
    for (let n = 0; n < level.chests.length; n++) {
      const spot = pickFreeTile(level, used, distFromStart, 2, rng);
      if (!spot) break;
      level.keys.push({ id: `k${++keyCount}`, pos: spot, kind: 'chest', taken: false });
      used.add(key(spot));
    }
    // Keep key counts consistent if we ran out of room.
    while (level.chests.length > level.keys.filter((k) => k.kind === 'chest').length) {
      const dropped = level.chests.pop();
      if (dropped) used.delete(key(dropped.pos));
    }
  }

  placeMonsters(level, depth, fullPath, onMain, used, distFromStart, warrens, rng);
  stockWarrens(level, depth, warrens, used, distFromStart, rng);
  easeGates(level, depth, rng);
  return level;
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

function pickStart(level: LevelData, rng: Rng): Vec {
  const cw = (level.width - 1) / 2;
  const ch = (level.height - 1) / 2;
  const qx = Math.max(1, Math.floor(cw / 3));
  const qy = Math.max(1, Math.floor(ch / 3));
  const cands: Vec[] = [];
  for (let cy = 0; cy < qy; cy++) {
    for (let cx = 0; cx < qx; cx++) {
      const p = { x: 2 * cx + 1, y: 2 * cy + 1 };
      if (isFloor(level, p)) cands.push(p);
    }
  }
  return cands.length ? rng.pick(cands) : { x: 1, y: 1 };
}

function pickExit(level: LevelData, dist: Map<string, number>, rng: Rng): Vec {
  const all: { p: Vec; d: number }[] = [];
  for (const [k, d] of dist) all.push({ p: parseKey(k), d });
  all.sort((a, b) => b.d - a.d || a.p.y - b.p.y || a.p.x - b.p.x);
  if (!all.length) return level.start;
  const top = all.slice(0, Math.min(5, all.length));
  const chosen = rng.pick(top);
  return eq(chosen.p, level.start) ? all[0].p : chosen.p;
}

/** A floor tile with exactly two floor neighbours that face each other. */
function isCorridor(level: LevelData, p: Vec): boolean {
  const nb = floorNeighbors(level, p);
  if (nb.length !== 2) return false;
  return nb[0].x === nb[1].x || nb[0].y === nb[1].y;
}

/** Removing `p` disconnects start from exit. */
function isChoke(level: LevelData, p: Vec): boolean {
  return bfsPath(level, level.start, level.exit, { blocked: (q) => eq(q, p) }) === null;
}

/** Evenly spread corridor tiles along the main path, preferring chokepoints. */
function pickDoors(level: LevelData, fullPath: Vec[], depth: number, rng: Rng): Vec[] {
  const count = Math.min(4, 1 + Math.floor(depth / 3));
  const len = fullPath.length;
  const cands: number[] = [];
  for (let i = 3; i <= len - 4; i++) {
    if (isCorridor(level, fullPath[i])) cands.push(i);
  }
  const chosen: number[] = [];
  for (let n = 0; n < count; n++) {
    const target = Math.round(((n + 1) / (count + 1)) * (len - 1)) + rng.int(-2, 2);
    const pool = cands.filter(
      (i) => !chosen.includes(i) && chosen.every((c) => Math.abs(c - i) >= 3),
    );
    if (!pool.length) break;
    pool.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    const near = pool.slice(0, 6);
    const chokes = near.filter((i) => isChoke(level, fullPath[i]));
    chosen.push(chokes.length ? chokes[0] : near[0]);
  }
  chosen.sort((a, b) => a - b);
  return chosen.map((i) => fullPath[i]);
}

/** Best spot for a door key inside `reach`: dead ends first, then off-path tiles. */
function pickKeySpot(
  level: LevelData,
  reach: Map<string, number>,
  used: Set<string>,
  onMain: Set<string>,
  rng: Rng,
): Vec | null {
  const deadEnds: Vec[] = [];
  const offPath: Vec[] = [];
  const rest: Vec[] = [];
  const near: Vec[] = [];
  for (const [k, d] of reach) {
    if (used.has(k)) continue;
    const p = parseKey(k);
    if (d < 3) {
      if (d >= 1) near.push(p);
      continue;
    }
    if (floorNeighbors(level, p).length === 1) deadEnds.push(p);
    else if (!onMain.has(k)) offPath.push(p);
    else rest.push(p);
  }
  for (const tier of [deadEnds, offPath, rest, near]) {
    if (tier.length) return rng.pick(tier);
  }
  return null;
}

function pickChestSpots(
  level: LevelData,
  used: Set<string>,
  onMain: Set<string>,
  count: number,
  rng: Rng,
): Vec[] {
  const deadEnds: Vec[] = [];
  const offPath: Vec[] = [];
  for (let y = 1; y < level.height - 1; y++) {
    for (let x = 1; x < level.width - 1; x++) {
      const p = { x, y };
      const k = key(p);
      if (!isFloor(level, p) || used.has(k)) continue;
      const nb = floorNeighbors(level, p).length;
      if (nb === 1) deadEnds.push(p);
      else if (nb === 2 && !onMain.has(k)) offPath.push(p);
    }
  }
  // Chests are solid tiles, so they may only sit in dead ends: anywhere else
  // they would wall off part of the maze.
  void offPath;
  rng.shuffle(deadEnds);
  const pool = deadEnds;
  const out: Vec[] = [];
  const taken = new Set<string>();
  for (const p of pool) {
    if (out.length >= count) break;
    const k = key(p);
    if (taken.has(k)) continue;
    taken.add(k);
    out.push(p);
  }
  return out;
}

function pickFreeTile(
  level: LevelData,
  used: Set<string>,
  dist: Map<string, number>,
  minDist: number,
  rng: Rng,
): Vec | null {
  const cands: Vec[] = [];
  for (const [k, d] of dist) {
    if (d < minDist || used.has(k)) continue;
    cands.push(parseKey(k));
  }
  if (!cands.length) return null;
  return rng.pick(cands);
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

function placeMonsters(
  level: LevelData,
  depth: number,
  fullPath: Vec[],
  onMain: Set<string>,
  used: Set<string>,
  dist: Map<string, number>,
  warrens: Warren[],
  rng: Rng,
): void {
  // The warrens get their own monsters afterwards. Keeping the route's budget
  // out of them leaves each warren a self-contained pocket rather than a place
  // the floor quietly hides half its guards.
  const inWarren = new Set(warrens.flatMap((w) => w.tiles).map(key));
  const count = Math.min(ROUTE_MONSTER_CAP, 5 + Math.floor(depth * 1.5));
  // The first floor teaches the controls: patrols to swing at and guards to
  // decide about, but no lurker, which a level-one hero cannot beat head-on.
  const lurkers = depth >= LURKERS_FROM_DEPTH;
  const kinds: RosterKind[] = [];
  if (count >= 3) kinds.push('guard', 'patrol', lurkers ? 'lurker' : 'patrol');
  while (kinds.length < count) {
    const r = rng.next();
    kinds.push(r < 0.35 ? 'guard' : r < 0.65 || !lurkers ? 'patrol' : 'lurker');
  }
  rng.shuffle(kinds);

  // Every tile a monster is allowed to stand on, in a stable shuffled order.
  const openTiles: Vec[] = [];
  for (const [k, d] of dist) {
    if (d < MONSTER_MIN_DIST || inWarren.has(k)) continue;
    openTiles.push(parseKey(k));
  }
  rng.shuffle(openTiles);
  const freeAt = (p: Vec): boolean => {
    const k = key(p);
    const d = dist.get(k);
    return d !== undefined && d >= MONSTER_MIN_DIST && !used.has(k) && !inWarren.has(k);
  };

  // Chokepoint anchors for guards: tiles beside chests, doors and the exit,
  // plus the stretch of main path leading up to the exit.
  const guardSpots: Vec[] = [];
  const anchors: Vec[] = [level.exit, ...level.doors.map((d) => d.pos), ...level.chests.map((c) => c.pos)];
  for (const a of anchors) {
    for (const n of floorNeighbors(level, a)) guardSpots.push(n);
  }
  for (let i = Math.floor(fullPath.length * 0.6); i < fullPath.length - 1; i++) {
    guardSpots.push(fullPath[i]);
  }
  rng.shuffle(guardSpots);

  // Main-path tiles far enough from start to hide a lurker beside.
  const lurkerAnchors = fullPath.slice(8).filter((p) => (dist.get(key(p)) ?? 0) >= 8);
  rng.shuffle(lurkerAnchors);

  let n = 0;
  for (const kind of kinds) {
    const id = `m${n + 1}`;
    let monster: Monster | null = null;
    if (kind === 'guard') monster = spawnGuard(level, depth, rng, id, guardSpots, freeAt);
    else if (kind === 'patrol') {
      monster = spawnPatrol(level, depth, rng, id, openTiles, onMain, fullPath, dist, freeAt);
    } else {
      monster = spawnLurker(level, depth, rng, id, lurkerAnchors, onMain, freeAt);
    }
    if (!monster) {
      const spot = openTiles.find(freeAt);
      if (!spot) break;
      monster = makeMonster(kind, depth, rng, spot, id);
    }
    used.add(key(monster.pos));
    level.monsters.push(monster);
    n++;
  }
}

function spawnGuard(
  level: LevelData,
  depth: number,
  rng: Rng,
  id: string,
  guardSpots: Vec[],
  freeAt: (p: Vec) => boolean,
): Monster | null {
  const spot = guardSpots.find(freeAt);
  return spot ? makeMonster('guard', depth, rng, spot, id) : null;
}

function spawnPatrol(
  level: LevelData,
  depth: number,
  rng: Rng,
  id: string,
  openTiles: Vec[],
  onMain: Set<string>,
  fullPath: Vec[],
  dist: Map<string, number>,
  freeAt: (p: Vec) => boolean,
): Monster | null {
  const nearStartMain = new Set(fullPath.slice(0, 7).map(key));
  let tried = 0;
  for (const p of openTiles) {
    if (!freeAt(p) || nearStartMain.has(key(p))) continue;
    if (tried++ > 14) break;
    const local = bfsDistances(level, p, { maxDist: 9 });
    const ends: Vec[] = [];
    for (const [k, d] of local) {
      if (d < 4 || d > 9) continue;
      if ((dist.get(k) ?? 0) < 4) continue;
      ends.push(parseKey(k));
    }
    if (!ends.length) continue;
    // Prefer longer runs, but keep some variety.
    ends.sort((a, b) => (local.get(key(b)) ?? 0) - (local.get(key(a)) ?? 0));
    const q = rng.pick(ends.slice(0, Math.min(8, ends.length)));
    const tail = bfsPath(level, p, q);
    if (!tail || !tail.length) continue;
    const path = [p, ...tail];
    if (path.some((t) => (dist.get(key(t)) ?? 0) < 4)) continue;
    const m = makeMonster('patrol', depth, rng, p, id);
    m.patrolPath = path;
    m.patrolIndex = 0;
    m.patrolDir = 1;
    return m;
  }
  return null;
}

function spawnLurker(
  level: LevelData,
  depth: number,
  rng: Rng,
  id: string,
  anchors: Vec[],
  onMain: Set<string>,
  freeAt: (p: Vec) => boolean,
): Monster | null {
  for (const anchor of anchors) {
    const local = bfsDistances(level, anchor, { maxDist: 3 });
    const spots: { p: Vec; d: number }[] = [];
    for (const [k, d] of local) {
      if (d < 1 || d > 3) continue;
      if (onMain.has(k)) continue;
      const p = parseKey(k);
      if (!freeAt(p)) continue;
      spots.push({ p, d });
    }
    if (!spots.length) continue;
    const chosen = rng.pick(spots);
    const m = makeMonster('lurker', depth, rng, chosen.p, id);
    m.sightRange = Math.max(3, chosen.d + 1);
    m.leash = rng.int(6, 8);
    return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Warrens
// ---------------------------------------------------------------------------

/** Every tile of every warren on the floor, flattened. */
export function warrenTilesOf(level: LevelData): Vec[] {
  return (level.warrens ?? []).flatMap((w) => w.tiles);
}

/** Smallest pocket off the main path worth braiding into a warren. */
const WARREN_MIN_TILES = 6;
/** Fraction of a warren's dead ends opened into a loop. */
const WARREN_BRAID = 0.7;
/** One extra monster per this many warren tiles. */
const WARREN_TILES_PER_MONSTER = 5;
/** Never more than this many extra monsters in one warren. */
export const WARREN_MONSTER_CAP = 4;
/** ...nor more than this many across all of a floor's warrens. */
export const WARREN_MONSTER_BUDGET = 14;

/**
 * The pockets of floor hanging off the main path, as lists of tiles. Found by
 * flood-filling the maze with the route to the stairs treated as a wall, so
 * every pocket is somewhere you go out of your way to visit.
 */
function offPathPockets(level: LevelData, onMain: Set<string>): Vec[][] {
  const seen = new Set<string>(onMain);
  const out: Vec[][] = [];
  for (let y = 1; y < level.height - 1; y++) {
    for (let x = 1; x < level.width - 1; x++) {
      const p = { x, y };
      const k = key(p);
      if (seen.has(k) || !isFloor(level, p)) continue;
      const pocket: Vec[] = [];
      const stack: Vec[] = [p];
      seen.add(k);
      while (stack.length) {
        const cur = stack.pop() as Vec;
        pocket.push(cur);
        for (const nb of floorNeighbors(level, cur)) {
          const nk = key(nb);
          if (seen.has(nk)) continue;
          seen.add(nk);
          stack.push(nb);
        }
      }
      out.push(pocket);
    }
  }
  return out;
}

/**
 * Braid the bigger off-path pockets hard, so a side branch stops being a dead
 * end you get cornered in and becomes a loop you can circle: somewhere to
 * fight, back off, and come round again when the way down is guarded by
 * something you cannot beat yet.
 *
 * A wall is only opened when every floor tile it touches belongs to the same
 * pocket. That is what keeps a warren off the critical path: it cannot gain a
 * second junction onto the route, so it never becomes a way around the guard
 * standing on it.
 */
function carveWarrens(level: LevelData, mainPath: Vec[], rng: Rng): Warren[] {
  const onMain = new Set([key(level.start), ...mainPath.map(key)]);
  const warrens: Warren[] = [];
  for (const pocket of offPathPockets(level, onMain)) {
    if (pocket.length < WARREN_MIN_TILES) continue;
    const inPocket = new Set(pocket.map(key));
    // One way in, or it is not a warren: a pocket that touches the route twice
    // is a loop through the level rather than a loop off it, and walking it
    // would advance the player instead of costing them the detour.
    const mouth = soleMouth(level, pocket, inPocket);
    if (!mouth) continue;
    const ends = pocket.filter((p) => floorNeighbors(level, p).length === 1);
    rng.shuffle(ends);
    const opened: Vec[] = [];
    for (const p of ends.slice(0, Math.ceil(ends.length * WARREN_BRAID))) {
      const w = loopWall(level, p, inPocket, rng);
      if (!w) continue;
      level.tiles[w.y][w.x] = Tile.Floor;
      inPocket.add(key(w));
      opened.push(w);
    }
    if (!opened.length) continue; // still a plain dead end: not a warren
    warrens.push({ mouth, tiles: [...pocket, ...opened] });
  }
  return warrens;
}

/**
 * The one tile of `pocket` that touches the rest of the maze, or null if it
 * touches at more than one place (or none). This is the tile the renderer
 * breaks the wall open around, so the player can learn the shape without
 * being told.
 */
function soleMouth(level: LevelData, pocket: Vec[], inPocket: Set<string>): Vec | null {
  let mouth: Vec | null = null;
  let ways = 0;
  for (const p of pocket) {
    for (const nb of floorNeighbors(level, p)) {
      if (inPocket.has(key(nb))) continue;
      if (++ways > 1) return null; // a second way in
      mouth = p;
    }
  }
  return ways === 1 ? mouth : null;
}

/**
 * A wall next to `p` that can be opened without letting the pocket touch
 * anything new: the tile beyond it is already in the pocket, and every other
 * floor tile the wall touches is too.
 */
function loopWall(level: LevelData, p: Vec, inPocket: Set<string>, rng: Rng): Vec | null {
  const dirs: Vec[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  const cands: Vec[] = [];
  for (const dir of dirs) {
    const w = { x: p.x + dir.x, y: p.y + dir.y };
    const o = { x: p.x + 2 * dir.x, y: p.y + 2 * dir.y };
    if (w.x <= 0 || w.y <= 0 || w.x >= level.width - 1 || w.y >= level.height - 1) continue;
    if (level.tiles[w.y][w.x] !== Tile.Wall) continue;
    if (!isFloor(level, o) || !inPocket.has(key(o))) continue;
    // Opening `w` joins it to every floor tile it touches. All of them must
    // already be inside this pocket, or the warren gains a new junction.
    let safe = true;
    for (const nb of floorNeighbors(level, w)) {
      if (!inPocket.has(key(nb))) {
        safe = false;
        break;
      }
    }
    if (safe) cands.push(w);
  }
  return cands.length ? rng.pick(cands) : null;
}

/** A patrol beat that stays inside the warren, so the loop is what it walks. */
function warrenBeat(level: LevelData, from: Vec, inWarren: Set<string>, rng: Rng): Vec[] | null {
  const blocked = (p: Vec) => !inWarren.has(key(p));
  const local = bfsDistances(level, from, { blocked, maxDist: 9 });
  const ends: Vec[] = [];
  for (const [k, d] of local) if (d >= 3) ends.push(parseKey(k));
  if (!ends.length) return null;
  ends.sort((a, b) => (local.get(key(b)) ?? 0) - (local.get(key(a)) ?? 0));
  const to = rng.pick(ends.slice(0, Math.min(5, ends.length)));
  const tail = bfsPath(level, from, to, { blocked });
  return tail && tail.length ? [from, ...tail] : null;
}

/**
 * Extra monsters for the warrens: the fights you pick rather than the ones
 * that pick you.
 *
 * Mostly guards, because a guard is the best-paid fight a hero can actually
 * win at their level, and the loop is what makes fighting one here different
 * from meeting it in a corridor — back off round the bend, let the hearts come
 * back, come at it again. A lurker turns up now and then so a warren is never
 * free money; the loop is also the room you need to bait one and slip past.
 * None of them can be a gate: no warren tile is on the way to the stairs, so
 * every one of these keeps its full strength.
 */
function stockWarrens(
  level: LevelData,
  depth: number,
  warrens: Warren[],
  used: Set<string>,
  dist: Map<string, number>,
  rng: Rng,
): void {
  const lurkers = depth >= LURKERS_FROM_DEPTH;
  let n = level.monsters.length;
  let budget = WARREN_MONSTER_BUDGET;
  for (const { tiles } of warrens) {
    const want = Math.min(budget, WARREN_MONSTER_CAP, Math.floor(tiles.length / WARREN_TILES_PER_MONSTER));
    if (want <= 0) continue;
    const spots = tiles.filter((p) => {
      const k = key(p);
      return !used.has(k) && (dist.get(k) ?? 0) >= MONSTER_MIN_DIST;
    });
    rng.shuffle(spots);
    const inWarren = new Set(tiles.map(key));
    for (let i = 0; i < want && i < spots.length; i++) {
      const spot = spots[i];
      const roll = rng.next();
      const kind: RosterKind = roll < 0.45 ? 'guard' : roll < 0.85 || !lurkers ? 'patrol' : 'lurker';
      const m = makeMonster(kind, depth, rng, spot, `w${++n}`);
      if (kind === 'patrol') {
        const beat = warrenBeat(level, spot, inWarren, rng);
        if (!beat) continue; // nowhere to walk: leave the tile empty
        m.patrolPath = beat;
        m.patrolIndex = 0;
        m.patrolDir = 1;
      }
      used.add(key(spot));
      level.monsters.push(m);
      budget--;
    }
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * The guards the player has no choice but to beat: the cheapest route from the
 * start to the stairs, counting one for every guard it has to walk through.
 * Doors are treated as open (`canProgress` guarantees their keys); chests are
 * solid but only ever sit in dead ends.
 */
export function gateGuards(level: LevelData): Monster[] {
  const guards = new Map<string, Monster>();
  for (const m of level.monsters) if (m.alive && m.kind === 'guard') guards.set(key(m.pos), m);
  const solid = new Set(level.chests.map((c) => key(c.pos)));

  // 0-1 BFS: stepping onto a guard costs one, every other floor tile is free.
  const cost = new Map<string, number>();
  const from = new Map<string, string>();
  const deque: string[] = [key(level.start)];
  cost.set(key(level.start), 0);
  while (deque.length) {
    const k = deque.shift() as string;
    const c = cost.get(k) as number;
    if (k === key(level.exit)) break;
    for (const nb of floorNeighbors(level, parseKey(k))) {
      const nk = key(nb);
      if (solid.has(nk)) continue;
      const nc = c + (guards.has(nk) ? 1 : 0);
      if (nc >= (cost.get(nk) ?? Infinity)) continue;
      cost.set(nk, nc);
      from.set(nk, k);
      if (nc === c) deque.unshift(nk);
      else deque.push(nk);
    }
  }

  const out: Monster[] = [];
  let cur: string | undefined = key(level.exit);
  if (!cost.has(cur)) return out; // no route at all: validate() rejects the level
  while (cur !== undefined) {
    const g = guards.get(cur);
    if (g) out.push(g);
    cur = from.get(cur);
  }
  return out;
}

/**
 * Re-roll every gate guard at the floor's own level. A guard never moves, and
 * a knockdown heals it back to full, so a gate the hero cannot out-fight is a
 * softlock: no way down, and nothing left to grind for the levels that would
 * win the fight. Guards anywhere else — beside a chest, off a loop, on the
 * doorstep of the stairs — keep their full strength.
 */
function easeGates(level: LevelData, depth: number, rng: Rng): void {
  for (const gate of gateGuards(level)) {
    const eased = makeMonster('guard', depth, rng, gate.pos, gate.id, { gate: true });
    eased.name = gate.name; // the look was already rolled from this floor's theme
    eased.glyph = gate.glyph;
    level.monsters[level.monsters.indexOf(gate)] = eased;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(level: LevelData): boolean {
  const { start, exit } = level;
  if (level.width % 2 === 0 || level.height % 2 === 0) return false;
  if (!isFloor(level, start) || !isFloor(level, exit) || eq(start, exit)) return false;

  // Unique floor tiles for every entity.
  const seen = new Set<string>();
  const claim = (p: Vec): boolean => {
    if (!isFloor(level, p)) return false;
    const k = key(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  if (!claim(start) || !claim(exit)) return false;
  for (const d of level.doors) if (!claim(d.pos) || d.open) return false;
  for (const k of level.keys) if (!claim(k.pos) || k.taken) return false;
  for (const c of level.chests) if (!claim(c.pos) || c.opened) return false;
  for (const m of level.monsters) if (!claim(m.pos)) return false;

  // Key bookkeeping.
  if (level.keys.filter((k) => k.kind === 'door').length !== level.doors.length) return false;
  if (level.keys.filter((k) => k.kind === 'chest').length !== level.chests.length) return false;

  // Doors sit in corridors.
  for (const d of level.doors) if (!isCorridor(level, d.pos)) return false;

  // Reachability with all doors open. Chests are solid, so they count as
  // walls here; each must still be reachable via a neighbouring tile.
  const chestTiles = new Set(level.chests.map((c) => key(c.pos)));
  const open = bfsDistances(level, start, { blocked: (p) => chestTiles.has(key(p)) });
  if (!open.has(key(exit))) return false;
  for (const c of level.chests) {
    if (floorNeighbors(level, c.pos).length !== 1) return false; // dead end only
    if (!floorNeighbors(level, c.pos).some((nb) => open.has(key(nb)))) return false;
  }
  for (const k of level.keys) if (!open.has(key(k.pos))) return false;

  // Warrens are detours, never the route: wall every one of them off and the
  // stairs must still be reachable, or a warren has become a way past a gate.
  const warrenTiles = new Set(warrenTilesOf(level).map(key));
  if (warrenTiles.size) {
    const without = bfsDistances(level, start, {
      blocked: (p) => warrenTiles.has(key(p)) || chestTiles.has(key(p)),
    });
    if (!without.has(key(exit))) return false;
  }

  // Every guard the player cannot walk around sits at the floor's own level,
  // so the way down is never barred by a fight the hero cannot win.
  for (const g of gateGuards(level)) if (g.level > level.depth) return false;

  // Monsters: enough of them, none lurking on the doorstep.
  if (level.monsters.length < 3) return false;
  for (const m of level.monsters) {
    const d = open.get(key(m.pos));
    if (d === undefined || d < MONSTER_MIN_DIST) return false;
    if (m.kind === 'patrol' && m.patrolPath) {
      for (const t of m.patrolPath) if (!isFloor(level, t)) return false;
    }
  }

  return canProgress(level);
}

/**
 * Simulate the player: repeatedly grab every key reachable with the currently
 * closed doors treated as walls, then spend one key on the first closed door
 * we can stand next to. Every door must eventually open.
 */
function canProgress(level: LevelData): boolean {
  const closed = new Set(level.doors.map((d) => key(d.pos)));
  const solid = new Set(level.chests.map((c) => key(c.pos)));
  const taken = new Set<string>();
  let held = 0;
  for (let iter = 0; iter <= level.doors.length + 1 && closed.size > 0; iter++) {
    const reach = bfsDistances(level, level.start, { blocked: (p) => closed.has(key(p)) || solid.has(key(p)) });
    for (const k of level.keys) {
      if (k.kind !== 'door' || taken.has(k.id)) continue;
      if (reach.has(key(k.pos))) {
        taken.add(k.id);
        held++;
      }
    }
    if (held <= 0) break;
    let opened = false;
    for (const d of level.doors) {
      const dk = key(d.pos);
      if (!closed.has(dk)) continue;
      if (!floorNeighbors(level, d.pos).some((nb) => reach.has(key(nb)))) continue;
      closed.delete(dk);
      held--;
      opened = true;
      break;
    }
    if (!opened) break;
  }
  return closed.size === 0;
}
