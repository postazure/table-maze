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
import type { Chest, Door, KeyItem, LevelData, Monster, MonsterKind, Rng, Vec } from './types';
import { hashSeed, makeRng } from './rng';
import { levelDims, makeMonster, rollChestLoot } from './balance';
import { themeForDepth } from './themes';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from './pathfind';

const MAX_ATTEMPTS = 20;
/** Minimum BFS distance from `start` at which a monster may spawn. */
const MONSTER_MIN_DIST = 5;

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
  const distFromStart = bfsDistances(level, level.start);
  level.exit = pickExit(level, distFromStart, rng);

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

  placeMonsters(level, depth, fullPath, onMain, used, distFromStart, rng);
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
  rng: Rng,
): void {
  const count = Math.min(18, 5 + Math.floor(depth * 1.5));
  const kinds: MonsterKind[] = [];
  if (count >= 3) kinds.push('guard', 'patrol', 'lurker');
  while (kinds.length < count) {
    const r = rng.next();
    kinds.push(r < 0.35 ? 'guard' : r < 0.65 ? 'patrol' : 'lurker');
  }
  rng.shuffle(kinds);

  // Every tile a monster is allowed to stand on, in a stable shuffled order.
  const openTiles: Vec[] = [];
  for (const [k, d] of dist) {
    if (d < MONSTER_MIN_DIST) continue;
    openTiles.push(parseKey(k));
  }
  rng.shuffle(openTiles);
  const freeAt = (p: Vec): boolean => {
    const k = key(p);
    const d = dist.get(k);
    return d !== undefined && d >= MONSTER_MIN_DIST && !used.has(k);
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
