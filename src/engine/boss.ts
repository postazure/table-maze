/**
 * Boss chambers: the level that follows every third maze floor, right before
 * the shop. Three encounters rotate (see `bossKindForDepth`):
 *
 *  - necromancer: smash five crystals before the spell completes.
 *  - minotaur:    find the stairs while an unkillable hunter follows.
 *  - angels:      find the stairs through rooms haunted by weeping angels
 *                 that only move while the hero's back is turned.
 *
 * This module is generation + the monster factory + tiny pure helpers. The
 * per-tick rules (spell clock, skeleton spawns, angel wake-ups, win / lose)
 * live in game.ts; the movement AI lives in monsters.ts.
 *
 * Generation follows the same shape as maze.ts: draw a seed from
 * `hashSeed(runSeed, depth, BOSS_SALT[, attempt])`, build one candidate,
 * validate it, and re-roll with the next attempt seed when a layout cannot
 * satisfy its rules (a corridor that dead-ends too early, a room grid that
 * cannot be wired up). After MAX_ATTEMPTS we fall back to a hand-built layout
 * that is valid by construction, so generation never throws.
 */
import { BOSS_KINDS, Tile, eq, inRect, key, manhattan, parseKey } from './types';
import type { BossKind, BossMonsterKind, LevelData, Monster, Rect, Rng, Vec } from './types';
import { hashSeed, makeRng } from './rng';
import { levelDims } from './balance';
import { themeForDepth } from './themes';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from './pathfind';

/** Salt so boss rolls never share a stream with the maze or shop generators. */
export const BOSS_SALT = 6161;

/** A boss chamber follows every maze floor whose depth is a multiple of this. */
export const BOSS_EVERY = 3;

/** How many candidate layouts we try before falling back to a fixed one. */
const MAX_ATTEMPTS = 20;

/** No monster ever starts this close (manhattan) to the hero. */
const MONSTER_MIN_MANHATTAN = 3;

/** Display names, "The ..." form. */
export function bossName(kind: BossKind): string {
  switch (kind) {
    case 'necromancer':
      return 'The Necromancer';
    case 'minotaur':
      return 'The Minotaur';
    case 'angels':
      return 'The Weeping Angels';
  }
}

/**
 * Which boss guards the floor `depth` (a multiple of BOSS_EVERY). Every run
 * of three bosses contains each kind once, in a seed-shuffled order, so a
 * player meets all three before any repeats.
 */
export function bossKindForDepth(depth: number, runSeed: number): BossKind {
  const round = Math.max(1, Math.floor(depth / BOSS_EVERY)); // 1 for depth 3, 2 for 6, ...
  const block = Math.floor((round - 1) / BOSS_KINDS.length);
  const order = makeRng(hashSeed(runSeed, block, BOSS_SALT)).shuffle([...BOSS_KINDS]);
  return order[(round - 1) % BOSS_KINDS.length];
}

/** Index of the room in `rooms` containing `p`, or -1. */
export function roomAt(rooms: readonly Rect[], p: Vec): number {
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h) return i;
  }
  return -1;
}

/**
 * A fully formed boss-chamber monster on `pos`, scaled to `depth`.
 * Deterministic (no rng): the caller decides where and when.
 */
export function makeBossMonster(kind: BossMonsterKind, depth: number, pos: Vec, id: string): Monster {
  const d = Math.max(1, Math.floor(depth));
  const NEVER = 1e9;
  const base: Monster = {
    id,
    kind,
    name: 'Skeleton',
    glyph: '💀',
    pos: { x: pos.x, y: pos.y },
    rpos: { x: pos.x, y: pos.y },
    home: { x: pos.x, y: pos.y },
    hp: 1,
    maxHp: 1,
    atk: 0,
    def: 0,
    level: d,
    xp: 0,
    gold: 0,
    moveInterval: NEVER,
    moveCooldown: 0,
    attackInterval: NEVER,
    attackCooldown: 0,
    state: 'idle',
    sightRange: 0,
    leash: 0,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
  switch (kind) {
    case 'minion':
      // Trash: two or three swings, a quarter-heart nip, but it shoves.
      base.name = 'Skeleton';
      base.glyph = '💀';
      base.hp = base.maxHp = 3 + 2 * d;
      base.atk = 1;
      base.moveInterval = 420;
      base.attackInterval = 800;
      base.sightRange = 999;
      base.state = 'chasing';
      base.xp = 2 + d;
      base.gold = 1;
      break;
    case 'crystal':
      // Furniture with hit points: about five swings for a hero at depth.
      base.name = 'Crystal';
      base.glyph = '🔮';
      base.hp = base.maxHp = 8 + 4 * d;
      base.xp = 5 + 2 * d;
      break;
    case 'boss':
      base.name = 'Necromancer';
      base.glyph = '🧙';
      base.level = d + 3;
      base.invulnerable = true;
      break;
    case 'minotaur':
      // Slow, relentless, unkillable. Hits take a third of max hp (combat.ts).
      base.name = 'Minotaur';
      base.glyph = '🐂';
      base.level = d + 3;
      base.invulnerable = true;
      base.moveInterval = 380;
      base.attackInterval = 900;
      base.sightRange = 999;
      base.state = 'chasing';
      break;
    case 'angel':
      // Fast while unwatched, frozen while watched. Touch = a third of max hp.
      base.name = 'Angel';
      base.glyph = '🗿';
      base.level = d + 3;
      base.invulnerable = true;
      base.moveInterval = 170;
      base.attackInterval = 500;
      base.sightRange = 999;
      base.state = 'idle';
      break;
  }
  return base;
}

/**
 * The boss chamber that follows maze floor `depth`. Deterministic for a
 * (depth, runSeed) pair. `kind: 'boss'`, `boss` set, no keys/doors/chests.
 */
export function generateBossLevel(depth: number, runSeed: number): LevelData {
  const d = Math.max(1, Math.floor(depth));
  const kind = bossKindForDepth(d, runSeed);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed =
      attempt === 0 ? hashSeed(runSeed, d, BOSS_SALT) : hashSeed(runSeed, d, BOSS_SALT, attempt);
    const level = buildBossLevel(kind, d, seed);
    if (level && validateBossLevel(level)) return level;
  }
  // Never throw: these layouts are valid by construction.
  const seed = hashSeed(runSeed, d, BOSS_SALT, 9999);
  switch (kind) {
    case 'necromancer':
      return fixedNecromancer(d, seed);
    case 'minotaur':
      return fixedMinotaur(d, seed);
    case 'angels':
      return fixedAngels(d, seed);
  }
}

function buildBossLevel(kind: BossKind, depth: number, seed: number): LevelData | null {
  switch (kind) {
    case 'necromancer':
      return buildNecromancer(depth, seed);
    case 'minotaur':
      return buildMinotaur(depth, seed);
    case 'angels':
      return buildAngels(depth, seed);
  }
}

// ---------------------------------------------------------------------------
// Grid helpers (a boss level is carved out of solid rock, unlike a maze)
// ---------------------------------------------------------------------------

/** N, E, S, W — the same order pathfind uses, so every walk is reproducible. */
const STEPS: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const step = (p: Vec, dir: number, n = 1): Vec => ({
  x: p.x + STEPS[dir].x * n,
  y: p.y + STEPS[dir].y * n,
});

function solidGrid(width: number, height: number): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) tiles.push(new Array<Tile>(width).fill(Tile.Wall));
  return tiles;
}

function fillRect(tiles: Tile[][], r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) tiles[y][x] = Tile.Floor;
  }
}

/** Inside the solid outer wall. */
function inInner(width: number, height: number, p: Vec): boolean {
  return p.x >= 1 && p.y >= 1 && p.x < width - 1 && p.y < height - 1;
}

function isWall(tiles: Tile[][], width: number, height: number, p: Vec): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return true;
  return tiles[p.y][p.x] === Tile.Wall;
}

function rectTiles(r: Rect): Vec[] {
  const out: Vec[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  }
  return out;
}

function makeLevel(depth: number, seed: number, width: number, height: number, tiles: Tile[][]): LevelData {
  return {
    depth,
    seed,
    kind: 'boss',
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
}

// ---------------------------------------------------------------------------
// Necromancer: an open chamber with five winding corridors hung off it
// ---------------------------------------------------------------------------

const NECRO_CRYSTALS = 5;
const NECRO_SPELL_BASE_MS = 90000;
const NECRO_SPELL_PER_DEPTH_MS = 3000;
const NECRO_SPAWN_EVERY_MS = 5000;
const NECRO_FIRST_SPAWN_MS = 4000;
const NECRO_MAX_MINIONS = 8;
/** Corridor length in lattice cells; every cell is two tiles (wall + cell). */
const NECRO_MIN_CELLS = 5; // 10 tiles
const NECRO_MAX_CELLS = 12; // 24 tiles
const NECRO_MIN_TURNS = 3;
/** How often the random walk tries a turn before going straight on. */
const TURN_BIAS = 0.72;
/** Fresh draws for one corridor before the whole chamber is re-rolled. */
const CORRIDOR_TRIES = 10;
/** Minimum manhattan gap between two corridor mouths on the chamber edge. */
const MOUTH_GAP = 4;

interface Mouth {
  /** Chamber edge tile the corridor hangs off. */
  door: Vec;
  /** Outward direction (index into STEPS). */
  dir: number;
}

/**
 * May we punch a 1-wide passage two tiles along `dir` from the floor tile
 * `from`? Both new tiles must be solid rock and must touch no floor other than
 * each other and `from`. That single rule is what keeps the five corridors
 * apart from each other, from the chamber and from their own tail, so every
 * crystal really does sit at the end of its own trip.
 */
function canStep(tiles: Tile[][], width: number, height: number, from: Vec, dir: number): boolean {
  const mid = step(from, dir);
  const to = step(from, dir, 2);
  if (!inInner(width, height, mid) || !inInner(width, height, to)) return false;
  if (!isWall(tiles, width, height, mid) || !isWall(tiles, width, height, to)) return false;
  for (let i = 0; i < STEPS.length; i++) {
    const a = step(mid, i);
    if (!eq(a, from) && !eq(a, to) && !isWall(tiles, width, height, a)) return false;
    const b = step(to, i);
    if (!eq(b, mid) && !isWall(tiles, width, height, b)) return false;
  }
  return true;
}

/** Directions to try from a cell entered heading `from`: turns first, mostly. */
function orderDirs(from: number, rng: Rng): number[] {
  const perp = rng.shuffle([(from + 1) % 4, (from + 3) % 4]);
  return rng.chance(TURN_BIAS) ? [...perp, from] : [from, ...perp];
}

interface Carve {
  cell: Vec;
  wall: Vec;
  from: number;
  order: number[];
  next: number;
}

/**
 * Carve one winding corridor out of the chamber edge tile `mouth.door`.
 * A recursive backtracker on the odd-cell lattice: walk while `canStep`
 * allows it, un-carve and back up when it does not, stop at a target length.
 * Returns the corridor's floor tiles (mouth first, dead end last), or null
 * when it could not reach `NECRO_MIN_CELLS` cells / `NECRO_MIN_TURNS` turns —
 * the caller then re-rolls the whole layout.
 */
function carveCorridor(
  tiles: Tile[][],
  width: number,
  height: number,
  mouth: Mouth,
  rng: Rng,
): Vec[] | null {
  if (!canStep(tiles, width, height, mouth.door, mouth.dir)) return null;
  const target = rng.int(NECRO_MIN_CELLS, NECRO_MAX_CELLS);
  const first = step(mouth.door, mouth.dir, 2);
  const gap = step(mouth.door, mouth.dir);
  tiles[gap.y][gap.x] = Tile.Floor;
  tiles[first.y][first.x] = Tile.Floor;
  const stack: Carve[] = [
    { cell: first, wall: gap, from: mouth.dir, order: orderDirs(mouth.dir, rng), next: 0 },
  ];

  while (stack.length < target) {
    const top = stack[stack.length - 1];
    let moved = false;
    while (top.next < top.order.length) {
      const dir = top.order[top.next++];
      if (!canStep(tiles, width, height, top.cell, dir)) continue;
      const wall = step(top.cell, dir);
      const cell = step(top.cell, dir, 2);
      tiles[wall.y][wall.x] = Tile.Floor;
      tiles[cell.y][cell.x] = Tile.Floor;
      stack.push({ cell, wall, from: dir, order: orderDirs(dir, rng), next: 0 });
      moved = true;
      break;
    }
    if (moved) continue;
    if (stack.length <= 1) break; // the mouth itself is boxed in
    const dead = stack.pop() as Carve;
    tiles[dead.cell.y][dead.cell.x] = Tile.Wall;
    tiles[dead.wall.y][dead.wall.x] = Tile.Wall;
  }

  let turns = 0;
  for (let i = 1; i < stack.length; i++) if (stack[i].from !== stack[i - 1].from) turns++;
  if (stack.length < NECRO_MIN_CELLS || turns < NECRO_MIN_TURNS) {
    for (const c of stack) {
      tiles[c.cell.y][c.cell.x] = Tile.Wall;
      tiles[c.wall.y][c.wall.x] = Tile.Wall;
    }
    return null;
  }
  const out: Vec[] = [];
  for (const c of stack) out.push(c.wall, c.cell);
  return out;
}

/** Odd top-left for a chamber of `size` centred in `len`, so it lands on the lattice. */
function oddOrigin(len: number, size: number): number {
  const raw = Math.floor((len - size) / 2);
  return Math.max(1, raw % 2 === 1 ? raw : raw - 1);
}

/** Odd-coordinate tiles along one side of the chamber, corners included. */
function sideTiles(chamber: Rect, dir: number): Vec[] {
  const x1 = chamber.x + chamber.w - 1;
  const y1 = chamber.y + chamber.h - 1;
  const out: Vec[] = [];
  if (dir === 0 || dir === 2) {
    const y = dir === 0 ? chamber.y : y1;
    for (let x = chamber.x; x <= x1; x += 2) out.push({ x, y });
  } else {
    const x = dir === 1 ? x1 : chamber.x;
    for (let y = chamber.y; y <= y1; y += 2) out.push({ x, y });
  }
  return out;
}

/**
 * Five spread-out mouths: every side of the chamber used at least once (so one
 * side ends up with two), no two within `MOUTH_GAP` tiles of each other.
 */
function pickMouths(chamber: Rect, rng: Rng): Mouth[] | null {
  const sides = rng.shuffle([0, 1, 2, 3]);
  const wanted = [...sides, rng.pick(sides)];
  const out: Mouth[] = [];
  for (const dir of wanted) {
    const cands = rng
      .shuffle(sideTiles(chamber, dir))
      .filter((p) => out.every((m) => manhattan(m.door, p) >= MOUTH_GAP));
    if (!cands.length) return null;
    out.push({ door: cands[0], dir });
  }
  return out;
}

/** A chamber edge tile away from the necromancer that is not a corridor mouth. */
function pickChamberStart(level: LevelData, chamber: Rect, centre: Vec, rng: Rng): Vec | null {
  const cands: Vec[] = [];
  for (const p of rectTiles(chamber)) {
    const edge =
      p.x === chamber.x ||
      p.y === chamber.y ||
      p.x === chamber.x + chamber.w - 1 ||
      p.y === chamber.y + chamber.h - 1;
    if (!edge || manhattan(p, centre) < 2) continue;
    let mouth = false;
    for (let i = 0; i < STEPS.length; i++) {
      const q = step(p, i);
      if (!inRect(chamber, q) && isFloor(level, q)) mouth = true;
    }
    if (!mouth) cands.push(p);
  }
  return cands.length ? rng.pick(cands) : null;
}

function necroBoss(depth: number): LevelData['boss'] {
  const total = NECRO_SPELL_BASE_MS + NECRO_SPELL_PER_DEPTH_MS * depth;
  return {
    kind: 'necromancer',
    defeated: false,
    spellMs: total,
    spellTotalMs: total,
    spawnMs: NECRO_FIRST_SPAWN_MS,
    spawnEveryMs: NECRO_SPAWN_EVERY_MS,
    maxMinions: NECRO_MAX_MINIONS,
    crystalsTotal: NECRO_CRYSTALS,
  };
}

function buildNecromancer(depth: number, seed: number): LevelData | null {
  const rng = makeRng(seed);
  const size = 31 + 2 * rng.int(0, 2); // 31 / 33 / 35, square
  const span = rng.pick([7, 9]);
  const chamber: Rect = { x: oddOrigin(size, span), y: oddOrigin(size, span), w: span, h: span };
  const tiles = solidGrid(size, size);
  fillRect(tiles, chamber);
  const centre = { x: chamber.x + (span - 1) / 2, y: chamber.y + (span - 1) / 2 };

  const mouths = pickMouths(chamber, rng);
  if (!mouths) return null;
  const ends: Vec[] = [];
  for (const mouth of mouths) {
    // A corridor that boxes itself in leaves no trace, so a fresh draw (new
    // length target, new turns) is worth a few tries before the whole chamber
    // is thrown away.
    let corridor: Vec[] | null = null;
    for (let t = 0; t < CORRIDOR_TRIES && !corridor; t++) {
      corridor = carveCorridor(tiles, size, size, mouth, rng);
    }
    if (!corridor) return null;
    ends.push(corridor[corridor.length - 1]);
  }

  const level = makeLevel(depth, seed, size, size, tiles);
  level.exit = centre; // hidden under the necromancer until he flees
  const start = pickChamberStart(level, chamber, centre, rng);
  if (!start) return null;
  level.start = start;
  level.monsters.push(makeBossMonster('boss', depth, centre, 'necro'));
  ends.forEach((p, i) => level.monsters.push(makeBossMonster('crystal', depth, p, `crystal${i + 1}`)));
  level.boss = necroBoss(depth);
  return level;
}

// ---------------------------------------------------------------------------
// Minotaur: a heavily braided maze with a few open halls
// ---------------------------------------------------------------------------

const MINO_MAX_W = 31;
const MINO_MAX_H = 41;
/** Open this share of the dead ends: many loops, so the hunter can be out-run. */
const MINO_BRAID = 0.35;
/** BFS tiles the minotaur keeps away from the hero's spawn. */
const MINO_MIN_DIST = 12;

/**
 * Perfect maze on the odd-cell lattice (iterative recursive backtracker).
 * A local copy of the maze.ts carver: boss levels want their own rock, and
 * maze.ts keeps its helper private.
 */
function carveMaze(width: number, height: number, rng: Rng): Tile[][] {
  const tiles = solidGrid(width, height);
  const cw = (width - 1) / 2;
  const ch = (height - 1) / 2;
  const visited: boolean[] = new Array(cw * ch).fill(false);
  const startCx = rng.int(0, cw - 1);
  const startCy = rng.int(0, ch - 1);
  visited[startCy * cw + startCx] = true;
  tiles[2 * startCy + 1][2 * startCx + 1] = Tile.Floor;
  const stack: Vec[] = [{ x: startCx, y: startCy }];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const open: Vec[] = [];
    for (const d of STEPS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
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
    tiles[cur.y + nc.y + 1][cur.x + nc.x + 1] = Tile.Floor; // wall between the cells
    stack.push(nc);
  }
  return tiles;
}

function floorNbCount(tiles: Tile[][], width: number, height: number, p: Vec): number {
  let n = 0;
  for (let i = 0; i < STEPS.length; i++) if (!isWall(tiles, width, height, step(p, i))) n++;
  return n;
}

/** Open `frac` of the dead ends into a neighbouring corridor, creating loops. */
function braid(tiles: Tile[][], width: number, height: number, rng: Rng, frac: number): void {
  const ends: Vec[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = { x, y };
      if (tiles[y][x] !== Tile.Floor) continue;
      if (floorNbCount(tiles, width, height, p) === 1) ends.push(p);
    }
  }
  rng.shuffle(ends);
  const target = Math.floor(ends.length * frac);
  for (let i = 0; i < target; i++) {
    const p = ends[i];
    const cands: Vec[] = [];
    for (let d = 0; d < STEPS.length; d++) {
      const w = step(p, d);
      const o = step(p, d, 2);
      if (!inInner(width, height, w) || !inInner(width, height, o)) continue;
      if (tiles[w.y][w.x] !== Tile.Wall || tiles[o.y][o.x] !== Tile.Floor) continue;
      cands.push(w);
    }
    if (!cands.length) continue;
    const w = rng.pick(cands);
    tiles[w.y][w.x] = Tile.Floor;
  }
}

/** 3-5 open halls (3x3 to 5x5) so the chase has somewhere to circle. */
function carveHalls(tiles: Tile[][], width: number, height: number, rng: Rng): void {
  const count = rng.int(3, 5);
  for (let i = 0; i < count; i++) {
    const w = rng.int(3, 5);
    const h = rng.int(3, 5);
    const x = 1 + 2 * rng.int(0, Math.floor((width - 1 - w) / 2) - 1);
    const y = 1 + 2 * rng.int(0, Math.floor((height - 1 - h) / 2) - 1);
    fillRect(tiles, { x, y, w, h });
  }
}

/** An odd cell in one of the four corner thirds of the maze. */
function pickCornerStart(level: LevelData, rng: Rng): Vec {
  const cw = (level.width - 1) / 2;
  const ch = (level.height - 1) / 2;
  const bx = Math.max(1, Math.floor(cw / 3));
  const by = Math.max(1, Math.floor(ch / 3));
  const far = rng.chance(0.5);
  const fry = rng.chance(0.5);
  const cands: Vec[] = [];
  for (let cy = 0; cy < by; cy++) {
    for (let cx = 0; cx < bx; cx++) {
      const gx = far ? cw - 1 - cx : cx;
      const gy = fry ? ch - 1 - cy : cy;
      const p = { x: 2 * gx + 1, y: 2 * gy + 1 };
      if (isFloor(level, p)) cands.push(p);
    }
  }
  return cands.length ? rng.pick(cands) : { x: 1, y: 1 };
}

/** One of the BFS-farthest tiles from start. */
function pickFarExit(level: LevelData, dist: Map<string, number>, rng: Rng): Vec {
  const all: { p: Vec; d: number }[] = [];
  for (const [k, d] of dist) all.push({ p: parseKey(k), d });
  if (!all.length) return level.start;
  all.sort((a, b) => b.d - a.d || a.p.y - b.p.y || a.p.x - b.p.x);
  const chosen = rng.pick(all.slice(0, Math.min(5, all.length)));
  return eq(chosen.p, level.start) ? all[0].p : chosen.p;
}

/** Far from the hero, roughly between the hero and the stairs. */
function pickMinotaurSpot(
  level: LevelData,
  dist: Map<string, number>,
  exitDist: number,
  rng: Rng,
): Vec | null {
  const lo = exitDist * 0.4;
  const hi = exitDist * 0.7;
  const between: Vec[] = [];
  const rest: { p: Vec; d: number }[] = [];
  for (const [k, d] of dist) {
    if (d < MINO_MIN_DIST) continue;
    const p = parseKey(k);
    if (eq(p, level.start) || eq(p, level.exit)) continue;
    if (manhattan(p, level.start) < MONSTER_MIN_MANHATTAN) continue;
    if (d >= lo && d <= hi) between.push(p);
    else rest.push({ p, d });
  }
  if (between.length) return rng.pick(between);
  if (!rest.length) return null;
  const want = exitDist * 0.55;
  rest.sort((a, b) => Math.abs(a.d - want) - Math.abs(b.d - want) || a.p.y - b.p.y || a.p.x - b.p.x);
  return rest[0].p;
}

function buildMinotaur(depth: number, seed: number): LevelData | null {
  const rng = makeRng(seed);
  const dims = levelDims(depth);
  const width = Math.min(MINO_MAX_W, dims.width);
  const height = Math.min(MINO_MAX_H, dims.height);
  const tiles = carveMaze(width, height, rng);
  braid(tiles, width, height, rng, MINO_BRAID);
  carveHalls(tiles, width, height, rng);

  const level = makeLevel(depth, seed, width, height, tiles);
  level.start = pickCornerStart(level, rng);
  const dist = bfsDistances(level, level.start);
  level.exit = pickFarExit(level, dist, rng);
  if (eq(level.exit, level.start)) return null;
  const spot = pickMinotaurSpot(level, dist, dist.get(key(level.exit)) ?? 0, rng);
  if (!spot) return null;
  level.monsters.push(makeBossMonster('minotaur', depth, spot, 'minotaur'));
  level.boss = { kind: 'minotaur', defeated: false };
  return level;
}

// ---------------------------------------------------------------------------
// Angels: a 3x4 grid of rooms wired together with winding corridors
// ---------------------------------------------------------------------------

const ANGEL_W = 29;
const ANGEL_H = 41;
const ANGEL_COLS = 3;
const ANGEL_ROWS = 4;
/** BFS tiles an angel keeps away from the hero's spawn. */
const ANGEL_MIN_DIST = 8;
/** Door pairs tried per corridor before giving up on that room pair. */
const DOOR_TRIES = 16;
/** Chance an already well-connected room pair gets an extra corridor anyway. */
const EXTRA_EDGE_CHANCE = 0.3;

/** The slab of the level room (c, r) lives in, outer wall excluded. */
function cellRect(c: number, r: number): Rect {
  const x0 = 1 + Math.floor((c * (ANGEL_W - 2)) / ANGEL_COLS);
  const x1 = 1 + Math.floor(((c + 1) * (ANGEL_W - 2)) / ANGEL_COLS);
  const y0 = 1 + Math.floor((r * (ANGEL_H - 2)) / ANGEL_ROWS);
  const y1 = 1 + Math.floor(((r + 1) * (ANGEL_H - 2)) / ANGEL_ROWS);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A room inside its cell with at least one tile of wall margin all round. */
function pickRoom(cell: Rect, rng: Rng): Rect {
  const w = rng.int(4, Math.min(7, cell.w - 2));
  const h = rng.int(4, Math.min(6, cell.h - 2));
  const x = rng.int(cell.x + 1, cell.x + cell.w - 1 - w);
  const y = rng.int(cell.y + 1, cell.y + cell.h - 1 - h);
  return { x, y, w, h };
}

/** Door tiles facing each other, aligned pairs first (narrow gaps need them). */
function doorPairs(a: Rect, b: Rect, horizontal: boolean, rng: Rng): { from: Vec; to: Vec }[] {
  const aFace = horizontal ? a.x + a.w - 1 : a.y + a.h - 1;
  const bFace = horizontal ? b.x : b.y;
  const aLo = horizontal ? a.y : a.x;
  const aHi = aLo + (horizontal ? a.h : a.w) - 1;
  const bLo = horizontal ? b.y : b.x;
  const bHi = bLo + (horizontal ? b.h : b.w) - 1;
  const at = (face: number, along: number): Vec =>
    horizontal ? { x: face, y: along } : { x: along, y: face };

  const aligned: { from: Vec; to: Vec }[] = [];
  for (let v = Math.max(aLo, bLo); v <= Math.min(aHi, bHi); v++) {
    aligned.push({ from: at(aFace, v), to: at(bFace, v) });
  }
  const jogged: { from: Vec; to: Vec }[] = [];
  for (let va = aLo; va <= aHi; va++) {
    for (let vb = bLo; vb <= bHi; vb++) {
      if (va !== vb) jogged.push({ from: at(aFace, va), to: at(bFace, vb) });
    }
  }
  return [...rng.shuffle(aligned), ...rng.shuffle(jogged)];
}

/**
 * Shortest route from `from` to `to` over tiles the corridor may use, with the
 * neighbour order shuffled so equal-length routes jog differently every time.
 */
function corridorRoute(
  from: Vec,
  to: Vec,
  usable: (p: Vec) => boolean,
  rng: Rng,
): Vec[] | null {
  if (!usable(from) || !usable(to)) return null;
  if (eq(from, to)) return [from];
  const prev = new Map<string, Vec>();
  const seen = new Set<string>([key(from)]);
  let frontier: Vec[] = [from];
  while (frontier.length) {
    const next: Vec[] = [];
    for (const p of frontier) {
      for (const d of rng.shuffle([0, 1, 2, 3])) {
        const q = step(p, d);
        const k = key(q);
        if (seen.has(k) || !usable(q)) continue;
        seen.add(k);
        prev.set(k, p);
        if (eq(q, to)) {
          const path: Vec[] = [q];
          let cur = q;
          while (!eq(cur, from)) {
            cur = prev.get(key(cur)) as Vec;
            path.push(cur);
          }
          path.reverse();
          return path;
        }
        next.push(q);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Would carving `route` leave a 2x2 patch of floor anywhere along it? That is
 * the one way a corridor stops being 1-wide: running alongside a corridor laid
 * earlier, or arriving beside a door another corridor already uses.
 */
function widensAnything(tiles: Tile[][], route: readonly Vec[]): boolean {
  const added = new Set(route.map(key));
  const floor = (p: Vec): boolean =>
    added.has(key(p)) ||
    (p.x >= 0 && p.y >= 0 && p.x < ANGEL_W && p.y < ANGEL_H && tiles[p.y][p.x] === Tile.Floor);
  for (const p of route) {
    for (const dx of [-1, 0]) {
      for (const dy of [-1, 0]) {
        const c = { x: p.x + dx, y: p.y + dy };
        if (
          floor(c) &&
          floor({ x: c.x + 1, y: c.y }) &&
          floor({ x: c.x, y: c.y + 1 }) &&
          floor({ x: c.x + 1, y: c.y + 1 })
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Wire two neighbouring rooms together: pick facing door tiles, then wind
 * through the rock between them. Corridor tiles never touch a room other than
 * at the two doors, so a corridor can never eat into a room it passes.
 */
function connectRooms(
  tiles: Tile[][],
  rooms: readonly Rect[],
  a: number,
  b: number,
  horizontal: boolean,
  rng: Rng,
): boolean {
  const dir = horizontal ? 1 : 2; // E or S
  const pairs = doorPairs(rooms[a], rooms[b], horizontal, rng).slice(0, DOOR_TRIES);
  for (const pair of pairs) {
    const head = step(pair.from, dir);
    const tail = step(pair.to, dir, -1);
    const usable = (p: Vec): boolean => {
      if (!inInner(ANGEL_W, ANGEL_H, p)) return false;
      if (roomAt(rooms, p) >= 0) return false;
      if (eq(p, head) || eq(p, tail)) return true;
      for (let i = 0; i < STEPS.length; i++) if (roomAt(rooms, step(p, i)) >= 0) return false;
      return true;
    };
    const route = corridorRoute(head, tail, usable, rng);
    if (!route || widensAnything(tiles, route)) continue;
    for (const p of route) tiles[p.y][p.x] = Tile.Floor;
    return true;
  }
  return false;
}

interface RoomEdge {
  a: number;
  b: number;
  horizontal: boolean;
}

function gridEdges(): RoomEdge[] {
  const out: RoomEdge[] = [];
  for (let r = 0; r < ANGEL_ROWS; r++) {
    for (let c = 0; c < ANGEL_COLS; c++) {
      const i = r * ANGEL_COLS + c;
      if (c + 1 < ANGEL_COLS) out.push({ a: i, b: i + 1, horizontal: true });
      if (r + 1 < ANGEL_ROWS) out.push({ a: i, b: i + ANGEL_COLS, horizontal: false });
    }
  }
  return out;
}

function buildAngels(depth: number, seed: number): LevelData | null {
  const rng = makeRng(seed);
  const tiles = solidGrid(ANGEL_W, ANGEL_H);
  const rooms: Rect[] = [];
  for (let r = 0; r < ANGEL_ROWS; r++) {
    for (let c = 0; c < ANGEL_COLS; c++) rooms.push(pickRoom(cellRect(c, r), rng));
  }
  for (const room of rooms) fillRect(tiles, room);

  // A random spanning tree first, then extra edges for loops: every room ends
  // up with two ways out wherever the rock allows it.
  const edges = rng.shuffle(gridEdges());
  const parent = rooms.map((_, i) => i);
  const find = (i: number): number => {
    let n = i;
    while (parent[n] !== n) n = parent[n];
    return n;
  };
  const degree = new Array<number>(rooms.length).fill(0);
  const wired = new Array<boolean>(edges.length).fill(false);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (find(e.a) === find(e.b)) continue;
    if (!connectRooms(tiles, rooms, e.a, e.b, e.horizontal, rng)) continue;
    parent[find(e.a)] = find(e.b);
    degree[e.a]++;
    degree[e.b]++;
    wired[i] = true;
  }
  if (rooms.some((_, i) => find(i) !== find(0))) return null;
  for (let i = 0; i < edges.length; i++) {
    if (wired[i]) continue;
    const e = edges[i];
    if (degree[e.a] >= 2 && degree[e.b] >= 2 && !rng.chance(EXTRA_EDGE_CHANCE)) continue;
    if (!connectRooms(tiles, rooms, e.a, e.b, e.horizontal, rng)) continue;
    degree[e.a]++;
    degree[e.b]++;
  }

  const level = makeLevel(depth, seed, ANGEL_W, ANGEL_H, tiles);
  const startRoom = rng.int(0, ANGEL_COLS - 1);
  level.start = rng.pick(rectTiles(rooms[startRoom]));
  const dist = bfsDistances(level, level.start);

  // The stairs go in whichever bottom-row room is the longest walk away.
  let exitRoom = -1;
  let exit: Vec | null = null;
  let best = -1;
  for (let i = rooms.length - ANGEL_COLS; i < rooms.length; i++) {
    for (const p of rectTiles(rooms[i])) {
      const d = dist.get(key(p));
      if (d === undefined || d <= best) continue;
      best = d;
      exit = p;
      exitRoom = i;
    }
  }
  if (!exit || exitRoom < 0) return null;
  level.exit = exit;

  const count = rng.int(4, 6);
  const pool = rng.shuffle(rooms.map((_, i) => i).filter((i) => i !== startRoom && i !== exitRoom));
  for (const ri of pool) {
    if (level.monsters.length >= count) break;
    // Never in a doorway: a statue wedged in the only gap would be a wall the
    // hero cannot break, since angels are invulnerable.
    const spots = rectTiles(rooms[ri]).filter(
      (p) =>
        (dist.get(key(p)) ?? -1) >= ANGEL_MIN_DIST &&
        !STEPS.some((_, i) => {
          const q = step(p, i);
          return !inRect(rooms[ri], q) && isFloor(level, q);
        }),
    );
    if (!spots.length) continue;
    const angel = makeBossMonster('angel', depth, rng.pick(spots), `angel${level.monsters.length + 1}`);
    angel.roomId = ri;
    level.monsters.push(angel);
  }
  if (level.monsters.length < 4) return null;
  level.boss = { kind: 'angels', defeated: false, rooms };
  return level;
}

// ---------------------------------------------------------------------------
// Fallbacks: plain layouts that are valid by construction, in case every
// randomised roll above was thrown away
// ---------------------------------------------------------------------------

/** Chamber at 11..19 of a 31x31 slab, five zig-zag corridors written out. */
const FIXED_NECRO_SIZE = 31;
const FIXED_NECRO_CHAMBER: Rect = { x: 11, y: 11, w: 9, h: 9 };
const FIXED_NECRO_CORRIDORS: { mouth: Mouth; steps: number[] }[] = [
  { mouth: { door: { x: 11, y: 11 }, dir: 0 }, steps: [0, 3, 0, 3, 0] },
  { mouth: { door: { x: 19, y: 11 }, dir: 0 }, steps: [0, 1, 0, 1, 0] },
  { mouth: { door: { x: 19, y: 15 }, dir: 1 }, steps: [1, 0, 1, 0, 1] },
  { mouth: { door: { x: 11, y: 19 }, dir: 2 }, steps: [2, 3, 2, 3, 2] },
  { mouth: { door: { x: 19, y: 19 }, dir: 2 }, steps: [2, 1, 2, 1, 2] },
];

function fixedNecromancer(depth: number, seed: number): LevelData {
  const size = FIXED_NECRO_SIZE;
  const tiles = solidGrid(size, size);
  fillRect(tiles, FIXED_NECRO_CHAMBER);
  const centre = { x: 15, y: 15 };
  const ends: Vec[] = [];
  for (const script of FIXED_NECRO_CORRIDORS) {
    if (!canStep(tiles, size, size, script.mouth.door, script.mouth.dir)) continue;
    let cell = step(script.mouth.door, script.mouth.dir, 2);
    const gap = step(script.mouth.door, script.mouth.dir);
    tiles[gap.y][gap.x] = Tile.Floor;
    tiles[cell.y][cell.x] = Tile.Floor;
    for (const dir of script.steps) {
      if (!canStep(tiles, size, size, cell, dir)) break;
      const wall = step(cell, dir);
      cell = step(cell, dir, 2);
      tiles[wall.y][wall.x] = Tile.Floor;
      tiles[cell.y][cell.x] = Tile.Floor;
    }
    ends.push(cell);
  }
  const level = makeLevel(depth, seed, size, size, tiles);
  level.exit = centre;
  level.start = { x: FIXED_NECRO_CHAMBER.x, y: centre.y }; // west edge, no mouth there
  level.monsters.push(makeBossMonster('boss', depth, centre, 'necro'));
  ends.forEach((p, i) => level.monsters.push(makeBossMonster('crystal', depth, p, `crystal${i + 1}`)));
  level.boss = necroBoss(depth);
  return level;
}

/** A braided maze is always solvable; only the minotaur's spot needs care. */
function fixedMinotaur(depth: number, seed: number): LevelData {
  const rng = makeRng(seed);
  const width = 21;
  const height = 31;
  const tiles = carveMaze(width, height, rng);
  braid(tiles, width, height, rng, MINO_BRAID);
  const level = makeLevel(depth, seed, width, height, tiles);
  level.start = { x: 1, y: 1 };
  const dist = bfsDistances(level, level.start);
  level.exit = pickFarExit(level, dist, rng);
  const spot = pickMinotaurSpot(level, dist, dist.get(key(level.exit)) ?? 0, rng);
  if (spot) level.monsters.push(makeBossMonster('minotaur', depth, spot, 'minotaur'));
  level.boss = { kind: 'minotaur', defeated: false };
  return level;
}

/** Same room grid, but every room a 5x4 block wired to its neighbours straight. */
function fixedAngels(depth: number, seed: number): LevelData {
  const tiles = solidGrid(ANGEL_W, ANGEL_H);
  const rooms: Rect[] = [];
  for (let r = 0; r < ANGEL_ROWS; r++) {
    for (let c = 0; c < ANGEL_COLS; c++) {
      const cell = cellRect(c, r);
      rooms.push({
        x: cell.x + Math.floor((cell.w - 5) / 2),
        y: cell.y + Math.floor((cell.h - 4) / 2),
        w: 5,
        h: 4,
      });
    }
  }
  for (const room of rooms) fillRect(tiles, room);
  // Straight corridors out of the middle of each facing wall; the fixed room
  // sizes keep those middles aligned, and the gaps are four tiles or more.
  for (const e of gridEdges()) {
    const a = rooms[e.a];
    const b = rooms[e.b];
    if (e.horizontal) {
      const y = a.y + 1;
      for (let x = a.x + a.w; x < b.x; x++) tiles[y][x] = Tile.Floor;
    } else {
      const x = a.x + 2;
      for (let y = a.y + a.h; y < b.y; y++) tiles[y][x] = Tile.Floor;
    }
  }
  const level = makeLevel(depth, seed, ANGEL_W, ANGEL_H, tiles);
  level.start = { x: rooms[0].x + 1, y: rooms[0].y + 1 };
  const last = rooms[rooms.length - 1];
  level.exit = { x: last.x + 3, y: last.y + 2 };
  [3, 5, 7, 8].forEach((ri, i) => {
    const angel = makeBossMonster('angel', depth, { x: rooms[ri].x + 2, y: rooms[ri].y + 2 }, `angel${i + 1}`);
    angel.roomId = ri;
    level.monsters.push(angel);
  });
  level.boss = { kind: 'angels', defeated: false, rooms };
  return level;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBossLevel(level: LevelData): boolean {
  const { width, height, start, exit, boss } = level;
  if (!boss || level.kind !== 'boss') return false;
  if (width % 2 === 0 || height % 2 === 0) return false;
  if (level.keys.length || level.doors.length || level.chests.length) return false;
  for (let x = 0; x < width; x++) {
    if (level.tiles[0][x] !== Tile.Wall || level.tiles[height - 1][x] !== Tile.Wall) return false;
  }
  for (let y = 0; y < height; y++) {
    if (level.tiles[y][0] !== Tile.Wall || level.tiles[y][width - 1] !== Tile.Wall) return false;
  }
  if (!isFloor(level, start) || !isFloor(level, exit) || eq(start, exit)) return false;
  if (!bfsPath(level, start, exit)) return false;

  const seen = new Set<string>([key(start)]);
  for (const m of level.monsters) {
    if (!isFloor(level, m.pos)) return false;
    const k = key(m.pos);
    if (seen.has(k)) return false;
    seen.add(k);
    if (manhattan(m.pos, start) < MONSTER_MIN_MANHATTAN) return false;
    // Only the necromancer is allowed to stand on the (hidden) stairs.
    if (eq(m.pos, exit) && !(boss.kind === 'necromancer' && m.kind === 'boss')) return false;
  }

  switch (boss.kind) {
    case 'necromancer':
      return validateNecromancer(level);
    case 'minotaur':
      return validateMinotaur(level);
    case 'angels':
      return validateAngels(level, boss.rooms);
  }
}

function validateNecromancer(level: LevelData): boolean {
  const bosses = level.monsters.filter((m) => m.kind === 'boss');
  const crystals = level.monsters.filter((m) => m.kind === 'crystal');
  if (bosses.length !== 1 || !eq(bosses[0].pos, level.exit)) return false;
  if (crystals.length !== NECRO_CRYSTALS) return false;
  // Every crystal sits at the end of its own corridor, reachable while the
  // necromancer still blocks the middle of his chamber.
  const blocked = (p: Vec): boolean => eq(p, bosses[0].pos);
  const reach = bfsDistances(level, level.start, { blocked });
  for (const c of crystals) {
    if (floorNeighbors(level, c.pos).length !== 1) return false;
    if (!reach.has(key(c.pos))) return false;
  }
  return true;
}

function validateMinotaur(level: LevelData): boolean {
  const hunters = level.monsters.filter((m) => m.kind === 'minotaur');
  if (hunters.length !== 1 || level.monsters.length !== 1) return false;
  const dist = bfsDistances(level, level.start);
  return (dist.get(key(hunters[0].pos)) ?? -1) >= MINO_MIN_DIST;
}

function validateAngels(level: LevelData, rooms: readonly Rect[]): boolean {
  if (rooms.length !== ANGEL_COLS * ANGEL_ROWS) return false;
  const claimed = new Set<string>();
  for (const r of rooms) {
    if (r.w < 4 || r.h < 4 || r.w > 7 || r.h > 6) return false;
    for (const p of rectTiles(r)) {
      const k = key(p);
      if (claimed.has(k) || !isFloor(level, p)) return false;
      claimed.add(k);
    }
  }
  const startRoom = roomAt(rooms, level.start);
  const exitRoom = roomAt(rooms, level.exit);
  if (startRoom < 0 || exitRoom < 0 || startRoom === exitRoom) return false;
  if (startRoom >= ANGEL_COLS) return false; // top row
  if (exitRoom < rooms.length - ANGEL_COLS) return false; // bottom row

  const angels = level.monsters.filter((m) => m.kind === 'angel');
  if (angels.length !== level.monsters.length) return false;
  if (angels.length < 4 || angels.length > 6) return false;
  const dist = bfsDistances(level, level.start);
  const used = new Set<number>();
  for (const a of angels) {
    const ri = a.roomId;
    if (ri === undefined || ri < 0 || ri >= rooms.length) return false;
    if (ri === startRoom || ri === exitRoom || used.has(ri)) return false;
    used.add(ri);
    if (!inRect(rooms[ri], a.pos)) return false;
    if ((dist.get(key(a.pos)) ?? -1) < ANGEL_MIN_DIST) return false;
  }
  return true;
}
