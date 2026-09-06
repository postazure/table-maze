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
 * 6. Shrines in dead-end alcoves, the ones hanging off the route first.
 * 7. Monsters: guards on chokepoints, patrols on corridor runs, lurkers on
 *    side branches next to the main path.
 * 8. A hidden wing behind the outer wall: a small dungeon of rooms with a
 *    sealed treasure room at the far end (see wings.ts). Only a hero with a
 *    lens can walk it.
 * 9. Validate solvability; retry with a re-mixed seed, relax as a last resort.
 */
import { Tile, inRect, key, parseKey, eq, manhattan } from './types';
import type {
  Chest,
  Door,
  KeyItem,
  LevelData,
  Monster,
  Rect,
  RosterKind,
  Rng,
  Shrine,
  ShrineKind,
  Vec,
  Warren,
} from './types';
import { SHRINE_KINDS } from './types';
import { hashSeed, makeRng } from './rng';
import { levelDims, makeMonster, rollChestLoot } from './balance';
import type { MonsterOpts } from './balance';
import { lensFloor } from './lens';
import { themeForDepth } from './themes';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from './pathfind';
import { WING_MARGIN, canDig, digWings, pocketBeat, shiftWingContent, stockWings } from './wings';

export { PASSAGE_MONSTER_CAP, PASSAGE_MONSTER_BUDGET } from './wings';

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
  /** The hero's level as they take the stairs down. See `monsterLevelCap`. */
  heroLevel?: number;
  /** The run's own seed: the wings read earlier floors of the run off it. */
  runSeed: number;
}

/**
 * One maze floor. `heroLevel` is the hero's level at the moment they step onto
 * it: it caps how far above them the floor's monsters may be rolled (see
 * `monsterLevelCap`). The level is generated once and then saved with the run,
 * so the cap is a snapshot of the hero on arrival, not a moving target.
 */
export function generateLevel(depth: number, runSeed: number, heroLevel?: number): LevelData {
  const d = Math.max(1, Math.floor(depth));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = attempt === 0 ? hashSeed(runSeed, d) : hashSeed(runSeed, d, attempt);
    const level = build(d, seed, { doors: true, chests: true, heroLevel, runSeed });
    if (validate(level)) return level;
  }
  // Relax: drop the doors (and their keys), keep the rest.
  for (let attempt = MAX_ATTEMPTS; attempt < MAX_ATTEMPTS + 8; attempt++) {
    const seed = hashSeed(runSeed, d, attempt);
    const level = build(d, seed, { doors: false, chests: true, heroLevel, runSeed });
    if (validate(level)) return level;
  }
  // Never throw: a bare maze with monsters is always solvable.
  return build(d, hashSeed(runSeed, d, 9999), { doors: false, chests: false, heroLevel, runSeed });
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
  // The maze proper is `levelDims`, unchanged. The grid it sits in is bigger:
  // the margin is solid rock that the warrens are dug out of, so a warren is
  // extra ground rather than a bite out of the floor plan. Whatever rock is
  // left over gets trimmed off at the end.
  const core = levelDims(depth);
  const carved = carveMaze(core.width, core.height, rng);
  braid(carved, core.width, core.height, rng, 0.15);

  const width = core.width + 2 * WARREN_MARGIN;
  const height = core.height + 2 * WARREN_MARGIN;
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) tiles.push(new Array<Tile>(width).fill(Tile.Wall));
  for (let y = 0; y < core.height; y++) {
    for (let x = 0; x < core.width; x++) {
      tiles[y + WARREN_MARGIN][x + WARREN_MARGIN] = carved[y][x];
    }
  }
  const coreRect: Rect = { x: WARREN_MARGIN, y: WARREN_MARGIN, w: core.width, h: core.height };

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

  level.start = pickStart(level, coreRect, rng);
  level.exit = pickExit(level, bfsDistances(level, level.start), rng);

  // The wing goes in first: it wants a wide, deep pocket of the margin, where
  // a warren can make do with what is left. Warrens are dug after and simply
  // skip any ground the wing has already claimed. The wing is furnished as it
  // is dug — its chest, seal, runes and the rest are geometry — and only its
  // monsters wait until the floor is trimmed and measured.
  level.passages = digWings(level, coreRect, depth, opts.runSeed, rng, opts.chests);

  // Warrens are dug into the margin before anything is placed on the floor.
  // They hang off the maze at one tile each and lead nowhere, so the route to
  // the stairs is exactly what it was before they existed.
  const warrens = digWarrens(level, coreRect, depth, rng);
  level.warrens = warrens;
  trimToUsed(level);

  // Everything below plans the floor the way a hero without a lens sees it:
  // the passages are floor in `tiles`, but the route, the doors, the shrines
  // and the ordinary monsters are all laid out as if they were still rock.
  // That is what keeps a passage a shortcut rather than a requirement.
  const hidden = new Set(passageTilesOf(level).map(key));
  const inPassage = (p: Vec): boolean => hidden.has(key(p));
  const distFromStart = bfsDistances(level, level.start, { blocked: inPassage });
  // ...and this is the floor as a hero *with* one sees it, which is what the
  // passages' own contents are placed against.
  const distWithLens = hidden.size ? bfsDistances(level, level.start) : distFromStart;
  const mainPath = bfsPath(level, level.start, level.exit, { blocked: inPassage }) ?? [];
  const fullPath: Vec[] = [level.start, ...mainPath];
  const onMain = new Set(fullPath.map(key));

  const used = new Set<string>([key(level.start), key(level.exit), ...hidden]);
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

  // Shrines get first pick of the dead ends: an alcove nobody walks past is an
  // alcove nobody chooses to skip. Chests are happier tucked further away, and
  // there are far more dead ends on a floor than either wants.
  level.shrines = placeShrines(level, depth, warrens, onMain, used, distFromStart, rng);
  for (const sh of level.shrines) used.add(key(sh.pos));

  if (opts.chests) {
    // The wing's chests are already in `level.chests`, so if the floor runs
    // out of room for chest keys it is an ordinary chest that gets dropped
    // and never the one thing worth walking a wing for.
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
    // Vault chests are counted here too: a gold key opens any chest, and a
    // vault would be a cruel place to learn otherwise.
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
    placeLens(level, depth, hidden, rng);
  }

  placeMonsters(level, depth, fullPath, onMain, used, distFromStart, warrens, rng, spawnOpts(opts));
  stockWarrens(level, depth, warrens, used, distFromStart, rng, spawnOpts(opts));
  stockWings(level, depth, used, distWithLens, rng, spawnOpts(opts), MONSTER_MIN_DIST);
  easeGates(level, depth, rng);
  return level;
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

/** Top-left region of the maze proper — never out in the margin. */
function pickStart(level: LevelData, core: Rect, rng: Rng): Vec {
  const cw = (core.w - 1) / 2;
  const ch = (core.h - 1) / 2;
  const qx = Math.max(1, Math.floor(cw / 3));
  const qy = Math.max(1, Math.floor(ch / 3));
  const cands: Vec[] = [];
  for (let cy = 0; cy < qy; cy++) {
    for (let cx = 0; cx < qx; cx++) {
      const p = { x: core.x + 2 * cx + 1, y: core.y + 2 * cy + 1 };
      if (isFloor(level, p)) cands.push(p);
    }
  }
  return cands.length ? rng.pick(cands) : { x: core.x + 1, y: core.y + 1 };
}

/**
 * The stairs go as far from the start as possible, and at a dead end.
 *
 * The hero descends the moment they step on the stairs, so they can never walk
 * through them: any floor on the far side is ground nobody will ever stand on,
 * and any key, chest, monster or warren out there may as well not have been
 * generated. A dead end has no far side. It costs almost nothing — there is
 * one within a couple of tiles of the farthest tile on every floor.
 */
function pickExit(level: LevelData, dist: Map<string, number>, rng: Rng): Vec {
  const all: { p: Vec; d: number }[] = [];
  for (const [k, d] of dist) all.push({ p: parseKey(k), d });
  all.sort((a, b) => b.d - a.d || a.p.y - b.p.y || a.p.x - b.p.x);
  if (!all.length) return level.start;
  const ends = all.filter((c) => floorNeighbors(level, c.p).length === 1);
  const pool = ends.length ? ends : all;
  const top = pool.slice(0, Math.min(5, pool.length));
  const chosen = rng.pick(top);
  return eq(chosen.p, level.start) ? pool[0].p : chosen.p;
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
// Shrines
// ---------------------------------------------------------------------------

/** How many alcoves a floor carries. */
const SHRINE_COUNT = 4;
/** Never light one right on top of the hero's first few steps. */
const SHRINE_MIN_DIST = 4;
/** A warren shorter than this is not enough of a walk to hide a shrine at the back of. */
const WARREN_SHRINE_MIN_TILES = 16;
/** At most this many of a floor's shrines are buried in warrens. */
const WARREN_SHRINE_MAX = 2;

/**
 * Where a floor's shrine alcoves go.
 *
 * A shrine is walkable floor, not furniture: the hero steps onto the tile to
 * light it and straight off again, so an alcove can never block anything
 * wherever it stands. That frees the placement to be about the *walk* instead,
 * and a floor's shrines are deliberately spread across three different kinds of
 * walk so no two are worth the same detour:
 *
 *  1. One **wayside** alcove: a dead end hanging straight off the route to the
 *     stairs. You cannot miss it, and taking it costs two steps — this is the
 *     one that teaches the player what an alcove is.
 *  2. Up to `WARREN_SHRINE_MAX` at the **back of the longer warrens**, on the
 *     tile furthest from the mouth. A warren is already a detour that leads
 *     nowhere and holds monsters of its own; this gives clearing one a reason
 *     beyond the xp.
 *  3. The rest **scattered**, each placed as far from the shrines already down
 *     as the floor allows, so what is left is spread over the map rather than
 *     bunched along the route.
 *
 * Kinds come off a shuffle of `SHRINE_KINDS`, so a floor rarely rolls the same
 * one twice.
 */
function placeShrines(
  level: LevelData,
  depth: number,
  warrens: Warren[],
  onMain: Set<string>,
  used: Set<string>,
  dist: Map<string, number>,
  rng: Rng,
): Shrine[] {
  const taken = new Set<string>(used);
  const spots: Vec[] = [];
  const free = (p: Vec): boolean => {
    const k = key(p);
    if (taken.has(k)) return false;
    const d = dist.get(k);
    return d !== undefined && d >= SHRINE_MIN_DIST;
  };
  const claim = (p: Vec): void => {
    taken.add(key(p));
    spots.push(p);
  };

  // Every dead end worth standing an alcove in, split by whether its one way
  // out lands back on the route to the stairs.
  const wayside: Vec[] = [];
  const offRoute: Vec[] = [];
  for (const [k, d] of dist) {
    if (taken.has(k) || d < SHRINE_MIN_DIST) continue;
    const p = parseKey(k);
    const nb = floorNeighbors(level, p);
    if (nb.length !== 1) continue;
    (onMain.has(key(nb[0])) ? wayside : offRoute).push(p);
  }
  rng.shuffle(wayside);
  rng.shuffle(offRoute);

  // 1. The one you walk past.
  const first = wayside.pop();
  if (first) claim(first);

  // 2. The back of the longer warrens, biggest first. `dist` grows with the
  //    walk in, so the furthest tile from the start inside a warren is the
  //    furthest from its mouth too — a warren only joins the maze at one tile.
  const longest = warrens
    .filter((w) => w.tiles.length >= WARREN_SHRINE_MIN_TILES)
    .slice()
    .sort((a, b) => b.tiles.length - a.tiles.length)
    .slice(0, WARREN_SHRINE_MAX);
  for (const w of longest) {
    if (spots.length >= SHRINE_COUNT) break;
    let best: Vec | null = null;
    let bestD = -1;
    for (const p of w.tiles) {
      if (eq(p, w.mouth) || !free(p)) continue; // never on the threshold itself
      const d = dist.get(key(p)) ?? -1;
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) claim(best);
  }

  // 3. Whatever is left, spread out: each pick is the dead end furthest from
  //    every alcove already down.
  const pool = [...wayside, ...offRoute].filter(free);
  while (spots.length < SHRINE_COUNT && pool.length > 0) {
    let bestI = 0;
    let bestD = -1;
    for (let i = 0; i < pool.length; i++) {
      let d = Infinity;
      for (const s of spots) d = Math.min(d, manhattan(s, pool[i]));
      if (d === Infinity) d = 0;
      if (d > bestD) {
        bestD = d;
        bestI = i;
      }
    }
    claim(pool.splice(bestI, 1)[0]);
  }

  const kinds: ShrineKind[] = rng.shuffle([...SHRINE_KINDS]);
  return spots.map((pos, i) => ({
    id: `sh${i + 1}`,
    pos,
    kind: kinds[i % kinds.length],
    used: false,
    level: depth,
  }));
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

/** What every `makeMonster` call on this floor carries. */
function spawnOpts(opts: GenOpts): MonsterOpts {
  return { heroLevel: opts.heroLevel };
}

function placeMonsters(
  level: LevelData,
  depth: number,
  fullPath: Vec[],
  onMain: Set<string>,
  used: Set<string>,
  dist: Map<string, number>,
  warrens: Warren[],
  rng: Rng,
  spawn: MonsterOpts,
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
    kinds.push(r < 0.35 ? 'guard' : r < 0.85 || !lurkers ? 'patrol' : 'lurker');
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
    if (kind === 'guard') monster = spawnGuard(level, depth, rng, id, guardSpots, freeAt, spawn);
    else if (kind === 'patrol') {
      monster = spawnPatrol(level, depth, rng, id, openTiles, onMain, fullPath, dist, freeAt, spawn);
    } else {
      monster = spawnLurker(level, depth, rng, id, lurkerAnchors, onMain, freeAt, spawn);
    }
    if (!monster) {
      const spot = openTiles.find(freeAt);
      if (!spot) break;
      monster = makeMonster(kind, depth, rng, spot, id, spawn);
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
  spawn: MonsterOpts,
): Monster | null {
  const spot = guardSpots.find(freeAt);
  return spot ? makeMonster('guard', depth, rng, spot, id, spawn) : null;
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
  spawn: MonsterOpts,
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
    const m = makeMonster('patrol', depth, rng, p, id, spawn);
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
  spawn: MonsterOpts,
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
    const m = makeMonster('lurker', depth, rng, chosen.p, id, spawn);
    m.sightRange = Math.max(3, chosen.d + 1);
    m.leash = rng.int(10, 14);
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

/**
 * Rock left around the maze for the wing and the warrens to be dug out of.
 * Even, so the maze's odd tile lattice carries on unbroken into the margin.
 * Whatever is not dug gets trimmed off again by `trimToUsed`. The wing is the
 * deeper of the two (see `WING_MARGIN`); the deepest warren `warrenShape`
 * can dig (`WARREN_MAX_ROWS` lobes) fits well inside it.
 */
export const WARREN_MARGIN = WING_MARGIN;
/** Most warrens one floor can carry. */
const WARREN_MAX = 6;
/** A warren's ring is this many cells across, chosen per warren (odd). */
const WARREN_MIN_WIDE = 3;
const WARREN_MAX_WIDE = 7;
/** A warren strings this many loops end to end, chosen per warren. */
const WARREN_MIN_ROWS = 2;
const WARREN_MAX_ROWS = 4;
/** One extra monster per this many warren tiles. */
const WARREN_TILES_PER_MONSTER = 7;
/** Never more than this many extra monsters in one warren. */
export const WARREN_MONSTER_CAP = 3;
/** ...nor more than this many across all of a floor's warrens. */
export const WARREN_MONSTER_BUDGET = 16;

/**
 * Dig this floor's warrens out of the rock around the maze.
 *
 * Each one hangs off a single tile of the maze's outer wall, knocked through
 * into the margin, and opens into a chain of corridor loops that comes back to
 * that same tile. The maze itself is untouched: a warren is ground that was
 * not there before, not floor taken away from the floor plan.
 *
 * Nothing is dug unless the whole shape, and every tile around it, is solid
 * rock. That is what guarantees the one way in — a warren cannot brush against
 * the maze a second time, or against another warren, so it can never become a
 * way around the guard standing on the route.
 */
function digWarrens(level: LevelData, core: Rect, depth: number, rng: Rng): Warren[] {
  const want = Math.min(WARREN_MAX, 2 + Math.floor(depth / 4));
  const warrens: Warren[] = [];
  for (const { at, out } of perimeterAnchors(level, core, rng)) {
    if (warrens.length >= want) break;
    const wide = rng.int(WARREN_MIN_WIDE, WARREN_MAX_WIDE) | 1;
    const rows = rng.int(WARREN_MIN_ROWS, WARREN_MAX_ROWS);
    const shape = warrenShape(at, out, wide, rows);
    if (!canDig(level, shape, [at])) continue;
    for (const t of shape) level.tiles[t.y][t.x] = Tile.Floor;
    warrens.push({ mouth: { x: at.x + out.x, y: at.y + out.y }, tiles: shape });
  }
  return warrens;
}

/**
 * Every tile of the maze that sits against its outer wall, with the direction
 * that wall faces, shuffled. These are the only places a warren can be dug
 * from: anywhere else there is more maze on the other side, not rock.
 */
function perimeterAnchors(level: LevelData, core: Rect, rng: Rng): { at: Vec; out: Vec }[] {
  const out: { at: Vec; out: Vec }[] = [];
  const push = (at: Vec, dir: Vec) => {
    if (!isFloor(level, at)) return;
    if (eq(at, level.start) || eq(at, level.exit)) return;
    out.push({ at, out: dir });
  };
  for (let x = core.x + 1; x < core.x + core.w - 1; x += 2) {
    push({ x, y: core.y + 1 }, { x: 0, y: -1 });
    push({ x, y: core.y + core.h - 2 }, { x: 0, y: 1 });
  }
  for (let y = core.y + 1; y < core.y + core.h - 1; y += 2) {
    push({ x: core.x + 1, y }, { x: -1, y: 0 });
    push({ x: core.x + core.w - 2, y }, { x: 1, y: 0 });
  }
  return rng.shuffle(out);
}

/**
 * The tiles a warren `wide` cells across and `rows` loops deep would occupy: a
 * neck through the maze wall, then `rows` runs of full-width corridor strung
 * together by a spine down the middle and a pair of side runs between each
 * consecutive pair — so each pair of rows rings a block of rock, and the whole
 * chain still comes back to the one tile it started from. `rows` of 2 is a
 * single loop; more rows string more loops end to end for a bigger den.
 */
function warrenShape(at: Vec, out: Vec, wide: number, rows: number): Vec[] {
  const side = { x: out.y, y: out.x }; // ninety degrees to the way in
  const half = wide - 1; // in tiles: cells sit two apart
  const lastAlong = rows * 2;
  const tile = (along: number, across: number): Vec => ({
    x: at.x + out.x * along + side.x * across,
    y: at.y + out.y * along + side.y * across,
  });
  const tiles: Vec[] = [];
  // The spine: the neck and every odd step through the middle, tying each
  // row's centre to the next.
  for (let along = 1; along <= lastAlong - 1; along += 2) tiles.push(tile(along, 0));
  // The rows themselves: full-width runs of corridor, closed at both ends.
  for (let along = 2; along <= lastAlong; along += 2) {
    for (let a = -half; a <= half; a++) tiles.push(tile(along, a));
  }
  // The side runs between consecutive rows, at their outer edges only — the
  // spine already carries the middle — so each gap rings a block of rock.
  for (let along = 3; along <= lastAlong - 1; along += 2) {
    for (const a of [-half, half]) tiles.push(tile(along, a));
  }
  return tiles;
}
/**
 * Shrink the grid back onto the ground actually used, leaving a single ring of
 * wall. The margin is sized for a warren on every side; most floors do not get
 * one everywhere, and nobody wants to scroll across the rock where it would
 * have gone.
 */
function trimToUsed(level: LevelData): void {
  let minX = level.width;
  let minY = level.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      if (level.tiles[y][x] !== Tile.Floor) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return;
  const offX = minX - 1;
  const offY = minY - 1;
  // One ring of wall around the used ground, and both sides odd the way the
  // rest of the generator expects.
  const width = oddAtLeast(maxX - minX + 3);
  const height = oddAtLeast(maxY - minY + 3);
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array<Tile>(width).fill(Tile.Wall);
    if (y > 0 && y < height - 1) {
      for (let x = 1; x < width - 1; x++) {
        const sx = x + offX;
        const sy = y + offY;
        if (sx > minX - 1 && sx < maxX + 1 && sy > minY - 1 && sy < maxY + 1) {
          row[x] = level.tiles[sy][sx];
        }
      }
    }
    tiles.push(row);
  }
  const shift = (p: Vec) => {
    p.x -= offX;
    p.y -= offY;
  };
  level.tiles = tiles;
  level.width = width;
  level.height = height;
  shift(level.start);
  shift(level.exit);
  for (const warren of level.warrens ?? []) {
    shift(warren.mouth);
    for (const t of warren.tiles) shift(t);
  }
  for (const passage of level.passages ?? []) {
    for (const t of passage.tiles) shift(t);
    for (const m of passage.mouths) shift(m);
  }
  shiftWingContent(level, shift);
}

/** Every tile of every passage on the floor, flattened. */
export function passageTilesOf(level: LevelData): Vec[] {
  return (level.passages ?? []).flatMap((p) => p.tiles);
}

/**
 * Put a lens in one of this floor's ordinary chests.
 *
 * Only the first two floors of a themed set carry one, and only a chest out in
 * the open — a lens locked behind a wing would be a lens nobody can reach.
 * Which chest is never marked: finding it is the point, and there are always
 * several to open.
 */
function placeLens(level: LevelData, depth: number, hidden: Set<string>, rng: Rng): void {
  if (!lensFloor(depth)) return;
  const open = level.chests.filter((c) => !hidden.has(key(c.pos)));
  if (!open.length) return;
  rng.pick(open).loot.lens = true;
}

function oddAtLeast(n: number): number {
  return n % 2 === 1 ? n : n + 1;
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
  spawn: MonsterOpts,
): void {
  const lurkers = depth >= LURKERS_FROM_DEPTH;
  let n = level.monsters.length;
  let budget = WARREN_MONSTER_BUDGET;
  for (const { mouth, tiles } of warrens) {
    const want = Math.min(budget, WARREN_MONSTER_CAP, Math.floor(tiles.length / WARREN_TILES_PER_MONSTER));
    if (want <= 0) continue;
    // Never the mouth: a guard is rooted, and one standing in the only way in
    // would seal the warren off from the hero who came here to grind it.
    const spots = tiles.filter((p) => {
      const k = key(p);
      return !eq(p, mouth) && !used.has(k) && (dist.get(k) ?? 0) >= MONSTER_MIN_DIST;
    });
    rng.shuffle(spots);
    const inWarren = new Set(tiles.map(key));
    for (let i = 0; i < want && i < spots.length; i++) {
      const spot = spots[i];
      const roll = rng.next();
      const kind: RosterKind = roll < 0.45 ? 'guard' : roll < 0.9 || !lurkers ? 'patrol' : 'lurker';
      const m = makeMonster(kind, depth, rng, spot, `w${++n}`, spawn);
      if (kind === 'patrol') {
        const beat = pocketBeat(level, spot, inWarren, rng);
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
  // Hidden passages count as rock here. A gate is the guard a hero with no
  // lens cannot walk around, and a wing never leads anywhere but back out of
  // its own mouths in any case.
  const solid = new Set([...level.chests.map((c) => key(c.pos)), ...passageTilesOf(level).map(key)]);

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
  for (const sh of level.shrines ?? []) if (!claim(sh.pos) || sh.used) return false;
  for (const m of level.monsters) if (!claim(m.pos)) return false;

  // Key bookkeeping.
  if (level.keys.filter((k) => k.kind === 'door').length !== level.doors.length) return false;
  if (level.keys.filter((k) => k.kind === 'chest').length !== level.chests.length) return false;

  // Doors sit in corridors.
  for (const d of level.doors) if (!isCorridor(level, d.pos)) return false;

  // Reachability with all doors open, twice over: `open` is the floor as a
  // hero with no lens walks it (every passage is rock), `lensed` is the same
  // floor with the passages open and every seal already worked. Chests and
  // altars are solid in both, so they count as walls; each must still be
  // reachable via a neighbouring tile.
  const solidTiles = new Set([...level.chests.map((c) => key(c.pos)), ...(level.altars ?? []).map((a) => key(a.pos))]);
  const chestTiles = new Set(level.chests.map((c) => key(c.pos)));
  const hidden = new Set(passageTilesOf(level).map(key));
  const lensed = bfsDistances(level, start, { blocked: (p) => solidTiles.has(key(p)) });
  const open = hidden.size
    ? bfsDistances(level, start, { blocked: (p) => solidTiles.has(key(p)) || hidden.has(key(p)) })
    : lensed;
  // The stairs are reachable without setting foot in a passage: a lens is
  // always a saving and never a requirement.
  if (!open.has(key(exit))) return false;
  for (const c of level.chests) {
    // Out in the maze a chest may only sit in a dead end, or it walls part of
    // the floor off. In a wing it may stand in a room, where it blocks nothing.
    if (!hidden.has(key(c.pos)) && floorNeighbors(level, c.pos).length !== 1) return false;
    if (!floorNeighbors(level, c.pos).some((nb) => lensed.has(key(nb)))) return false;
  }
  for (const a of level.altars ?? []) {
    if (!claim(a.pos) || a.used || !hidden.has(key(a.pos))) return false;
    if (!floorNeighbors(level, a.pos).some((nb) => lensed.has(key(nb)))) return false;
  }
  // Keys and shrines never hide in a passage: everything a floor *needs* is
  // out in the maze where a hero with no lens can reach it.
  for (const k of level.keys) if (!open.has(key(k.pos))) return false;
  // Shrines are floor, not furniture: the hero has to be able to stand on one.
  for (const sh of level.shrines ?? []) if (!open.has(key(sh.pos))) return false;

  // Nothing past the stairs. Walking onto them ends the floor, so every tile
  // has to be reachable without crossing them, or it is ground the hero can
  // see on the way down and never stand on.
  const beyondStairs = bfsDistances(level, start, {
    blocked: (p) => solidTiles.has(key(p)) || eq(p, exit),
  });
  for (let y = 1; y < level.height - 1; y++) {
    for (let x = 1; x < level.width - 1; x++) {
      const p = { x, y };
      if (!isFloor(level, p) || eq(p, exit) || solidTiles.has(key(p))) continue;
      if (!beyondStairs.has(key(p))) return false;
    }
  }

  // Wings: every tile of one is hidden ground, every one of them is walkable
  // once the hero has a lens, and each touches the maze exactly at its mouths
  // — no wing brushes a warren, and none of them opens a third way in behind
  // the renderer's back.
  for (const passage of level.passages ?? []) {
    const inside = new Set(passage.tiles.map(key));
    if (passage.mouths.length < 1 || passage.mouths.length > 2) return false;
    for (const m of passage.mouths) if (!inside.has(key(m))) return false;
    if (!passage.rooms.length || !passage.rooms[passage.treasure] || !passage.rooms[passage.entry]) return false;
    for (const t of passage.tiles) {
      if (!isFloor(level, t)) return false;
      if (!lensed.has(key(t)) && !solidTiles.has(key(t))) return false;
      const outside = floorNeighbors(level, t).filter((nb) => !inside.has(key(nb)));
      if (outside.length && !passage.mouths.some((m) => eq(m, t))) return false;
    }
  }

  // The locks. Everything a puzzle is made of stands on hidden ground, on a
  // tile of its own, and on the near side of its seal; and the seal is a real
  // lock — with it shut, the treasure room is out of reach.
  const sealTiles = new Set((level.seals ?? []).map((s) => key(s.pos)));
  const sealedOff = sealTiles.size
    ? bfsDistances(level, start, { blocked: (p) => solidTiles.has(key(p)) || sealTiles.has(key(p)) })
    : lensed;
  for (const s of level.seals ?? []) {
    if (!claim(s.pos) || s.open || !hidden.has(key(s.pos))) return false;
    if (!isCorridor(level, s.pos)) return false;
    if (s.lock.kind === 'orb') {
      if (!sealedOff.has(key(s.lock.socket)) || !hidden.has(key(s.lock.socket))) return false;
      if (!(level.orbs ?? []).some((o) => o.sealId === s.id)) return false;
    }
    if (s.lock.kind === 'runes') {
      if (s.lock.order.length < 3 || s.lock.lit !== 0) return false;
      for (const id of s.lock.order) if (!(level.runes ?? []).some((r) => r.id === id && r.sealId === s.id)) return false;
    }
  }
  for (const r of level.runes ?? []) if (!claim(r.pos) || r.lit || !sealedOff.has(key(r.pos))) return false;
  for (const o of level.orbs ?? []) if (!claim(o.pos) || o.state !== 'floor' || !sealedOff.has(key(o.pos))) return false;
  for (const r of level.relics ?? []) if (!claim(r.pos) || r.taken || !sealedOff.has(key(r.pos))) return false;
  for (const passage of level.passages ?? []) {
    const room = passage.rooms[passage.treasure];
    const way = (level.seals ?? []).some((s) => floorNeighbors(level, s.pos).some((nb) => inRect(room, nb)));
    if (!way) return false; // a treasure room with no seal on its door
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (sealedOff.has(key({ x, y }))) return false; // the seal is not a lock
      }
    }
  }

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

  // Monsters: enough of them, none lurking on the doorstep. A passage's own
  // monsters are only reachable through it, so they are measured with the
  // lens on.
  if (level.monsters.length < 3) return false;
  for (const m of level.monsters) {
    const d = lensed.get(key(m.pos));
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
  const solid = new Set([...level.chests.map((c) => key(c.pos)), ...(level.altars ?? []).map((a) => key(a.pos))]);
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
