/**
 * The Cemetery: the weeping angels' world.
 *
 * Stage 0 is the surface — a graveyard of grass paths, hedge mazes, iron
 * fences and five crypts around a central contraption, haunted by angels
 * that hold their distance until enough of them share the hero's screen.
 * Stages 1-5 are the crypts themselves: small shifting mazes of ghouls and
 * rooted skeletons, each hiding one of the four relic pieces the
 * contraption wants (one crypt is a decoy, holding a chest of gold instead).
 *
 * `WorldData.data` (see `CemeteryData` below) carries the one-time roll of
 * which crypt is the decoy, each crypt's door state, and how many pieces the
 * contraption has swallowed — the only things that have to survive a trip
 * back to the main floor and a save/load. Everything else (the maze shapes,
 * the decorations, the angels' starting positions) is rebuilt the same way
 * every time from `runSeed` alone, so the world never has to remember it.
 */
import type { Chest, Hero, LevelData, Monster, Prop, Rect, Rng, Tile as TileType, Vec, WorldData } from '../types';
import { Tile, eq, inRect, key, manhattan } from '../types';
import { hashSeed, makeRng } from '../rng';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from '../pathfind';
import { makeMonster, rollChestLoot } from '../balance';
import { themeById } from '../themes';
import { makeBossMonster } from '../boss';
import type { WorldCtx, WorldModule } from './world';

// ---------------------------------------------------------------------------
// State carried across stages (and into the save)
// ---------------------------------------------------------------------------

type PieceKind = 'gear' | 'lens' | 'bell' | 'key';
const PIECE_KINDS: readonly PieceKind[] = ['gear', 'lens', 'bell', 'key'];

/**
 * shut: an overgrown mound. open: bumped once, the door leads down. done: its
 * piece has been fed to the contraption (or its chest opened) — nothing left
 * below. A piece picked up but not yet delivered leaves the crypt 'open': set
 * down and left, or dropped on a knockdown, it is back at the far end the
 * next time the crypt is generated, unless the hero is carrying it.
 */
type CryptState = 'shut' | 'open' | 'done';

interface CemeteryData extends Record<string, unknown> {
  /** Which of the five crypts (0-4) is the decoy: a chest, not a piece. */
  decoyCrypt: number;
  /** One entry per crypt; null for the decoy. */
  pieceKind: (PieceKind | null)[];
  /** One entry per crypt. */
  cryptState: CryptState[];
  /** Pieces the contraption has been fed, 0-4. */
  pieces: number;
  /** Which crypts' pieces have been picked up at least once (for the one-time pickup line). */
  pieceTaken?: Record<number, boolean>;
  /** Set once, the moment the fourth piece lands — `ctx.finish()` is one-shot. */
  finished: boolean;
  /** Surface only: the angels' own step clock, ms banked toward the next step. */
  angelClockMs?: number;
  /** A crypt only: ms left before the walls next slide. */
  shiftMs?: number;
}

function isCemeteryData(d: WorldData['data'] | null): d is CemeteryData {
  return !!d && Array.isArray((d as Partial<CemeteryData>).cryptState) && (d as Partial<CemeteryData>).cryptState!.length === 5;
}

const CEMETERY_SALT = 7226;

/** The one-time roll: which crypt is empty, and which piece each other holds. */
function freshData(runSeed: number): CemeteryData {
  const rng = makeRng(hashSeed(runSeed, CEMETERY_SALT));
  const decoyCrypt = rng.int(0, 4);
  const pieceKind: (PieceKind | null)[] = [null, null, null, null, null];
  const shuffled = rng.shuffle([...PIECE_KINDS]);
  let n = 0;
  for (let i = 0; i < 5; i++) {
    if (i === decoyCrypt) continue;
    pieceKind[i] = shuffled[n++];
  }
  return {
    decoyCrypt,
    pieceKind,
    cryptState: ['shut', 'shut', 'shut', 'shut', 'shut'],
    pieces: 0,
    finished: false,
  };
}

function ensureData(runSeed: number, data: WorldData['data'] | null): CemeteryData {
  return isCemeteryData(data) ? data : freshData(runSeed);
}

// ---------------------------------------------------------------------------
// Small grid helpers (a local copy: this module may not import maze.ts/boss.ts
// generation helpers, only `makeBossMonster`)
// ---------------------------------------------------------------------------

const STEPS: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function solidGrid(width: number, height: number): TileType[][] {
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) tiles.push(new Array<TileType>(width).fill(Tile.Wall));
  return tiles;
}

function fillRect(tiles: TileType[][], r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles[y][x] = Tile.Floor;
}

function rectTiles(r: Rect): Vec[] {
  const out: Vec[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

/** Perfect maze on the odd-cell lattice, always starting at local cell (0,0). */
function carveMaze(width: number, height: number, rng: Rng): TileType[][] {
  const tiles = solidGrid(width, height);
  const cw = Math.floor((width - 1) / 2);
  const ch = Math.floor((height - 1) / 2);
  const visited = new Array<boolean>(cw * ch).fill(false);
  visited[0] = true;
  tiles[1][1] = Tile.Floor;
  const stack: Vec[] = [{ x: 0, y: 0 }];
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
    tiles[cur.y + nc.y + 1][cur.x + nc.x + 1] = Tile.Floor;
    stack.push(nc);
  }
  return tiles;
}

function isWallAt(tiles: TileType[][], width: number, height: number, p: Vec): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return true;
  return tiles[p.y][p.x] === Tile.Wall;
}

function floorNbCount(tiles: TileType[][], width: number, height: number, p: Vec): number {
  let n = 0;
  for (const d of STEPS) if (!isWallAt(tiles, width, height, { x: p.x + d.x, y: p.y + d.y })) n++;
  return n;
}

/** Open a share of the dead ends into a neighbour, for loops (and a shift to work with). */
function braid(tiles: TileType[][], width: number, height: number, rng: Rng, frac: number): void {
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
    for (const d of STEPS) {
      const w = { x: p.x + d.x, y: p.y + d.y };
      const o = { x: p.x + 2 * d.x, y: p.y + 2 * d.y };
      if (w.x < 1 || w.y < 1 || o.x < 1 || o.y < 1 || o.x >= width - 1 || o.y >= height - 1) continue;
      if (tiles[w.y][w.x] !== Tile.Wall || tiles[o.y][o.x] !== Tile.Floor) continue;
      cands.push(w);
    }
    if (!cands.length) continue;
    const w = rng.pick(cands);
    tiles[w.y][w.x] = Tile.Floor;
  }
}

// ---------------------------------------------------------------------------
// Blocking predicates shared by angels and ghouls
// ---------------------------------------------------------------------------

function solidPropAt(level: LevelData, p: Vec): Prop | null {
  for (const prop of level.props ?? []) if (prop.solid && !prop.hidden && eq(prop.pos, p)) return prop;
  return null;
}

function liveMonsterAt(level: LevelData, p: Vec, exclude: Monster): Monster | null {
  for (const m of level.monsters) if (m.alive && m !== exclude && eq(m.pos, p)) return m;
  return null;
}

/** Tiles neither an angel nor a ghoul will ever stand on. */
function monsterBlocked(level: LevelData, hero: Vec, m: Monster): (p: Vec) => boolean {
  return (p: Vec): boolean => solidPropAt(level, p) !== null || liveMonsterAt(level, p, m) !== null || eq(p, hero);
}

// ---------------------------------------------------------------------------
// Surface: fixed skeleton (deterministic reach), seed-rolled decoration
// ---------------------------------------------------------------------------

const SURF_W = 31;
const SURF_H = 41;

const PATCH_A: Rect = { x: 2, y: 3, w: 9, h: 9 };
const PATCH_B: Rect = { x: 19, y: 3, w: 9, h: 9 };
const PATCH_C: Rect = { x: 11, y: 27, w: 9, h: 9 };
const PATCHES: readonly Rect[] = [PATCH_A, PATCH_B, PATCH_C];

/**
 * The walled plaza around the contraption, a door on its south face and one
 * on its north: a yard with one way out is a yard an angel holding its
 * distance in the doorway would shut for good.
 */
const PLAZA_RING: Rect = { x: 12, y: 17, w: 7, h: 7 };
const PLAZA_DOORS: readonly Vec[] = [
  { x: 15, y: 23 },
  { x: 15, y: 17 },
];
const CONTRAPTION_POS: Vec = { x: 15, y: 20 };

const CRYPT_POS: readonly Vec[] = [
  { x: 5, y: 20 },
  { x: 25, y: 20 },
  { x: 5, y: 36 },
  { x: 25, y: 36 },
  { x: 15, y: 8 },
];

const START_POS: Vec = { x: 15, y: 38 };
const PORTAL_POS: Vec = { x: 15, y: 39 };

/** Hand-placed, always clear of the plaza, the patches and every path between them. */
const FENCE_POS: readonly Vec[] = [
  { x: 13, y: 38 },
  { x: 17, y: 38 },
  { x: 13, y: 24 },
  { x: 17, y: 24 },
  { x: 13, y: 2 },
  { x: 14, y: 2 },
  { x: 15, y: 2 },
  { x: 16, y: 2 },
  { x: 17, y: 2 },
];

const GRAVE_COUNT = 16;
const GRAVE_NAMES = ['Eleanor Vance', 'Jebediah Cross', 'Old Tom Whitlock', 'Sister Agnes', 'Corporal Reyes', 'A Stranger'];

const ANGEL_MIN = 6;
const ANGEL_MAX = 10;
/** No angel starts closer than this to the gate: no one wakes at the doorstep. */
const ANGEL_SPAWN_CLEAR = 6;

/** Carve the two or three hedge-maze patches into an otherwise open field. */
function carvePatches(tiles: TileType[][], rng: Rng): void {
  for (const patch of PATCHES) {
    const local = carveMaze(patch.w, patch.h, rng);
    braid(local, patch.w, patch.h, rng, 0.25);
    for (let y = 0; y < patch.h; y++) {
      for (let x = 0; x < patch.w; x++) tiles[patch.y + y][patch.x + x] = local[y][x];
    }
  }
}

function carvePlaza(tiles: TileType[][]): void {
  for (const p of rectTiles(PLAZA_RING)) tiles[p.y][p.x] = Tile.Wall;
  const inner: Rect = { x: PLAZA_RING.x + 1, y: PLAZA_RING.y + 1, w: PLAZA_RING.w - 2, h: PLAZA_RING.h - 2 };
  fillRect(tiles, inner);
  for (const d of PLAZA_DOORS) tiles[d.y][d.x] = Tile.Floor;
}

/** Every tile a decoration must stay clear of: the patches, the plaza ring,
 *  and a one-tile margin around every fixed single-point feature. */
function decorationExcluded(p: Vec): boolean {
  if (PATCHES.some((r) => inRect(r, p))) return true;
  if (inRect(PLAZA_RING, p)) return true;
  const points = [...CRYPT_POS, ...PLAZA_DOORS, CONTRAPTION_POS, PORTAL_POS, START_POS];
  return points.some((q) => manhattan(q, p) <= 1);
}

/**
 * The prop a carried piece becomes when a stage is generated under it:
 * hidden, in the hero's arms, so `ctx.carried()` still finds it on the
 * surface and in every other crypt. Without this a piece would vanish on
 * the stairs up.
 */
function carriedPiece(hero: Hero, data: CemeteryData): Prop | null {
  const id = hero.carrying;
  if (!id) return null;
  const idx = PIECE_IDS.indexOf(id);
  if (idx < 0) return null;
  const kind = data.pieceKind[idx];
  if (!kind) return null;
  return { id, pos: { ...hero.pos }, kind: `piece:${kind}`, solid: false, art: `piece:${kind}`, carriable: true, hidden: true };
}

function buildSurface(runSeed: number, hero: Hero, data: CemeteryData): LevelData {
  const tiles = solidGrid(SURF_W, SURF_H);
  fillRect(tiles, { x: 1, y: 1, w: SURF_W - 2, h: SURF_H - 2 });
  const rng = makeRng(hashSeed(runSeed, 0, CEMETERY_SALT));
  carvePatches(tiles, rng);
  carvePlaza(tiles);

  const props: Prop[] = [];
  for (let i = 0; i < 5; i++) {
    props.push({
      id: `crypt-${i}`,
      pos: { ...CRYPT_POS[i] },
      kind: 'crypt',
      solid: true,
      art: 'crypt',
      state: data.cryptState[i],
      data: { index: i },
    });
  }
  props.push({
    id: 'contraption',
    pos: { ...CONTRAPTION_POS },
    kind: 'contraption',
    solid: true,
    art: 'contraption',
    state: contraptionState(data.pieces),
  });
  props.push({
    id: 'home',
    pos: { ...PORTAL_POS },
    kind: 'portal-home',
    solid: true,
    art: 'portal-home',
    hidden: !data.finished,
  });
  const carried = carriedPiece(hero, data);
  if (carried) props.push(carried);
  for (let i = 0; i < FENCE_POS.length; i++) {
    props.push({ id: `fence-${i}`, pos: { ...FENCE_POS[i] }, kind: 'fence', solid: true, art: 'fence' });
  }

  const fenceSet = new Set(FENCE_POS.map(key));
  const candidates: Vec[] = [];
  for (let y = 1; y < SURF_H - 1; y++) {
    for (let x = 1; x < SURF_W - 1; x++) {
      const p = { x, y };
      if (tiles[y][x] !== Tile.Floor) continue;
      if (fenceSet.has(key(p))) continue;
      if (decorationExcluded(p)) continue;
      candidates.push(p);
    }
  }
  rng.shuffle(candidates);
  const graveSpots = candidates.slice(0, GRAVE_COUNT);
  const graveSet = new Set(graveSpots.map(key));
  graveSpots.forEach((p, i) => {
    const named = rng.chance(0.4);
    props.push({
      id: `grave-${i}`,
      pos: { ...p },
      kind: 'grave',
      solid: false,
      art: 'grave',
      data: named ? { name: rng.pick(GRAVE_NAMES) } : undefined,
    });
  });

  const angelPool = candidates.filter((p) => !graveSet.has(key(p)) && manhattan(p, START_POS) >= ANGEL_SPAWN_CLEAR);
  rng.shuffle(angelPool);
  const angelCount = rng.int(ANGEL_MIN, ANGEL_MAX);
  const monsters: Monster[] = [];
  angelPool.slice(0, angelCount).forEach((p, i) => {
    const a = makeBossMonster('angel', hero.level, p, `angel${i + 1}`);
    monsters.push(a);
  });

  return {
    depth: 1,
    seed: hashSeed(runSeed, 0, CEMETERY_SALT),
    kind: 'world',
    theme: 'cemetery',
    world: { kind: 'angels', stage: 0, data, won: data.finished },
    width: SURF_W,
    height: SURF_H,
    tiles,
    start: { ...START_POS },
    exit: { ...START_POS },
    keys: [],
    doors: [],
    chests: [],
    goldPiles: [],
    monsters,
    props,
  };
}

function contraptionState(pieces: number): string {
  switch (pieces) {
    case 0:
      return 'empty';
    case 1:
      return 'one';
    case 2:
      return 'two';
    case 3:
      return 'three';
    default:
      return 'complete';
  }
}

// ---------------------------------------------------------------------------
// A crypt: a small shifting maze, one relic piece (or the decoy's chest) at
// the far end, stairs up where the hero came in.
// ---------------------------------------------------------------------------

const CRYPT_W = 21;
const CRYPT_H = 21;
const CRYPT_BRAID = 0.3;
export const SHIFT_INTERVAL_MS = 25000;
const GHOUL_CHASE_RANGE = 6;

function pieceId(idx: number): string {
  return `piece-${idx}`;
}
const PIECE_IDS: readonly string[] = [0, 1, 2, 3, 4].map(pieceId);

/** One of the BFS-farthest floor tiles from `from`, ties broken by seed. */
function pickFarTile(level: LevelData, dist: Map<string, number>, rng: Rng): Vec {
  let best = -1;
  const far: Vec[] = [];
  for (const [k, d] of dist) {
    if (d > best) {
      best = d;
      far.length = 0;
    }
    if (d === best) {
      const [x, y] = k.split(',').map(Number);
      far.push({ x, y });
    }
  }
  return far.length ? rng.pick(far) : level.start;
}

function buildCrypt(stage: number, runSeed: number, hero: Hero, data: CemeteryData): LevelData {
  const idx = stage - 1;
  const seed = hashSeed(runSeed, stage, CEMETERY_SALT);
  const rng = makeRng(seed);
  const tiles = carveMaze(CRYPT_W, CRYPT_H, rng);
  braid(tiles, CRYPT_W, CRYPT_H, rng, CRYPT_BRAID);

  const level: LevelData = {
    depth: 1,
    seed,
    kind: 'world',
    theme: 'crypts',
    world: { kind: 'angels', stage, data, won: data.finished },
    width: CRYPT_W,
    height: CRYPT_H,
    tiles,
    start: { x: 1, y: 1 },
    exit: { x: 1, y: 1 },
    keys: [],
    doors: [],
    chests: [],
    goldPiles: [],
    monsters: [],
    props: [{ id: 'stairs-up', pos: { x: 1, y: 1 }, kind: 'stairs-up', solid: true, art: 'stairs-up' }],
  };

  const dist = bfsDistances(level, level.start);
  const far = pickFarTile(level, dist, rng);
  level.exit = { ...far };

  // Whatever the hero walked in with rides along, hidden in their arms.
  const carried = carriedPiece(hero, data);
  if (carried) level.props!.push(carried);

  const reachable: Vec[] = [];
  for (const [k, d] of dist) {
    if (d < 4) continue;
    const [x, y] = k.split(',').map(Number);
    if (eq({ x, y }, far)) continue;
    reachable.push({ x, y });
  }
  rng.shuffle(reachable);
  let next = 0;

  if (data.cryptState[idx] !== 'done') {
    const kind = data.pieceKind[idx];
    if (kind) {
      // This crypt's own piece, unless it is the one in the hero's arms.
      if (hero.carrying !== pieceId(idx)) {
        level.props!.push({
          id: pieceId(idx),
          pos: { ...far },
          kind: `piece:${kind}`,
          solid: false,
          art: `piece:${kind}`,
          carriable: true,
        });
      }
    } else {
      // The decoy: a chest of gold at the far end, and the key that opens it
      // somewhere on the way, since nothing else down here hands one out.
      const chest: Chest = { id: `chest-${idx}`, pos: { ...far }, opened: false, loot: rollChestLoot(hero.level, rng) };
      level.chests.push(chest);
      const keyPos = reachable[next++] ?? level.start;
      level.keys.push({ id: `key-${idx}`, pos: { ...keyPos }, kind: 'chest', taken: false });
    }
  }
  const ghoulCount = rng.int(3, 5);
  for (let i = 0; i < ghoulCount && next < reachable.length; i++) {
    const pos = reachable[next++];
    const m = makeMonster('patrol', hero.level, rng, pos, `ghoul-${idx}-${i}`);
    m.kind = 'ghoul';
    m.name = 'Ghoul';
    m.glyph = '🧟';
    m.moveInterval = 500;
    level.monsters.push(m);
  }
  const guardCount = rng.int(2, 4);
  const crypts = themeById('crypts');
  for (let i = 0; i < guardCount && next < reachable.length; i++) {
    const pos = reachable[next++];
    const m = makeMonster('guard', hero.level, rng, pos, `skeleton-${idx}-${i}`);
    const look = rng.pick(crypts.roster.guard);
    m.name = look.name;
    m.glyph = look.glyph;
    level.monsters.push(m);
  }

  return level;
}

/** The tiles a shift must never cut the hero off from: the piece, the chest
 *  and the key that opens it, whichever are still lying about. */
function cryptTargets(level: LevelData): Vec[] {
  const out: Vec[] = [];
  const piece = (level.props ?? []).find((p) => p.kind.startsWith('piece:') && !p.hidden);
  if (piece) out.push(piece.pos);
  const chest = level.chests.find((c) => !c.opened);
  if (chest) out.push(chest.pos);
  for (const k of level.keys) if (!k.taken) out.push(k.pos);
  return out;
}

/** The 25s rumble: open a few wall segments, close an equal number of
 *  corridor tiles, and only keep the change if the hero can still reach the
 *  stairs and whatever this crypt still holds. */
function shiftMaze(ctx: WorldCtx): void {
  const level = ctx.level;
  const w = level.width;
  const h = level.height;
  const reserved = new Set<string>([key(ctx.hero.pos)]);
  for (const m of level.monsters) if (m.alive) reserved.add(key(m.pos));
  for (const p of level.props ?? []) if (!p.hidden) reserved.add(key(p.pos));
  for (const c of level.chests) reserved.add(key(c.pos));
  for (const k of level.keys) if (!k.taken) reserved.add(key(k.pos));

  const openCands: Vec[] = [];
  const closeCands: Vec[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = { x, y };
      if (level.tiles[y][x] === Tile.Wall) {
        if (floorNeighbors(level, p).length >= 1) openCands.push(p);
      } else if (!reserved.has(key(p))) {
        closeCands.push(p);
      }
    }
  }
  ctx.rng.shuffle(openCands);
  ctx.rng.shuffle(closeCands);
  const n = Math.min(ctx.rng.int(3, 5), openCands.length, closeCands.length);
  if (n <= 0) return;
  const toOpen = openCands.slice(0, n);
  const toClose = closeCands.slice(0, n);
  const before = [...toOpen, ...toClose].map((p) => level.tiles[p.y][p.x]);
  for (const p of toOpen) level.tiles[p.y][p.x] = Tile.Floor;
  for (const p of toClose) level.tiles[p.y][p.x] = Tile.Wall;

  const okStairs = bfsPath(level, ctx.hero.pos, level.start) !== null;
  const okTargets = cryptTargets(level).every((target) => bfsPath(level, ctx.hero.pos, target) !== null);
  if (!okStairs || !okTargets) {
    const changed = [...toOpen, ...toClose];
    changed.forEach((p, i) => {
      level.tiles[p.y][p.x] = before[i];
    });
  }
}

// ---------------------------------------------------------------------------
// Angels: idle statues, driven entirely by `tick` on a 650ms clock
// ---------------------------------------------------------------------------

/** How often awake angels take a step. */
const ANGEL_TICK_MS = 650;
/** Wake up: within this raw distance, and this close by an actual walk. */
const ANGEL_WAKE_MANHATTAN = 8;
const ANGEL_WAKE_BFS = 10;
/** Lose interest: further than this by an actual walk. */
const ANGEL_LOSE_BFS = 12;
/** Hold this many tiles off, unless the ring has closed. */
const ANGEL_HOLD = 3;
/**
 * Holding is holding in both directions: a hero who walks up to an angel
 * inside this distance pushes it a step back, so one standing in a doorway
 * or a hedge corridor is never a wall the hero cannot get past.
 */
const ANGEL_BACK_OFF = 2;
/** "On screen" for the headcount that decides whether they close in. */
const ANGEL_SCREEN = 7;
/** That many awake angels on screen at once, and every one of them commits. */
const ANGEL_CLOSE_COUNT = 5;

function angelsAwake(level: LevelData): Monster[] {
  return level.monsters.filter((m) => m.alive && m.kind === 'angel' && m.state !== 'idle');
}

function tickAngels(ctx: WorldCtx, dt: number, data: CemeteryData): void {
  data.angelClockMs = (data.angelClockMs ?? 0) + dt;
  let guard = 0;
  while (data.angelClockMs >= ANGEL_TICK_MS && guard++ < 8) {
    data.angelClockMs -= ANGEL_TICK_MS;
    angelStep(ctx);
    if (ctx.state.over) return;
  }
}

function angelStep(ctx: WorldCtx): void {
  const level = ctx.level;
  const hero = ctx.hero.pos;

  // Wake / lose interest, each by its own BFS line (walls only: what a monster
  // could in principle walk, not what happens to be in its way this instant).
  for (const m of level.monsters) {
    if (!m.alive || m.kind !== 'angel') continue;
    if (m.state === 'idle') {
      if (manhattan(m.pos, hero) > ANGEL_WAKE_MANHATTAN) continue;
      const path = bfsPath(level, m.pos, hero, { maxLen: ANGEL_WAKE_BFS - 1 });
      if (path) m.state = 'chasing';
    } else {
      const path = bfsPath(level, m.pos, hero, { maxLen: ANGEL_LOSE_BFS });
      if (!path) m.state = 'idle';
    }
  }

  const awake = angelsAwake(level);
  if (awake.length === 0) return;
  const onScreen = awake.filter((m) => manhattan(m.pos, hero) <= ANGEL_SCREEN).length;
  const closing = onScreen >= ANGEL_CLOSE_COUNT;
  for (const m of awake) m.state = closing ? 'closing' : 'chasing';

  for (const m of awake) {
    const blocked = monsterBlocked(level, hero, m);
    const path = bfsPath(level, m.pos, hero, { blocked: (p) => (eq(p, hero) ? false : blocked(p)) });
    if (!path) continue; // boxed in by its own kind; hold still rather than fight through
    if (closing) {
      if (path.length > 1) {
        const next = path[0];
        if (!blocked(next)) {
          m.pos = { ...next };
          m.rpos = { ...next };
        }
      }
    } else if (path.length > ANGEL_HOLD) {
      const next = path[0];
      if (!blocked(next)) {
        m.pos = { ...next };
        m.rpos = { ...next };
      }
    } else if (path.length <= ANGEL_BACK_OFF) {
      const back = stepAway(level, m, hero, blocked);
      if (back) {
        m.pos = { ...back };
        m.rpos = { ...back };
      }
    }
  }

  if (awake.some((m) => manhattan(m.pos, hero) <= 1)) ctx.gameOver('stone');
}

/** The neighbouring tile that puts the most walk between `m` and the hero, if any does. */
function stepAway(level: LevelData, m: Monster, hero: Vec, blocked: (p: Vec) => boolean): Vec | null {
  const here = bfsPath(level, m.pos, hero)?.length ?? 0;
  let best: Vec | null = null;
  let bestLen = here;
  for (const n of floorNeighbors(level, m.pos)) {
    if (blocked(n)) continue;
    const len = bfsPath(level, n, hero)?.length ?? Number.POSITIVE_INFINITY;
    if (len > bestLen) {
      bestLen = len;
      best = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ghouls: driven per-move by `step`, engine-scheduled on their own moveInterval
// ---------------------------------------------------------------------------

function ghoulStep(ctx: WorldCtx, m: Monster): Vec | null {
  const level = ctx.level;
  const hero = ctx.hero.pos;
  const blocked = monsterBlocked(level, hero, m);
  const path = bfsPath(level, m.pos, hero, {
    blocked: (p) => (eq(p, hero) ? false : blocked(p)),
    maxLen: GHOUL_CHASE_RANGE,
  });
  if (!path || path.length === 0) return null;
  const next = path[0];
  return blocked(next) ? null : next;
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function graveAt(level: LevelData, p: Vec): Prop | null {
  for (const prop of level.props ?? []) if (prop.kind === 'grave' && eq(prop.pos, p)) return prop;
  return null;
}

export const CEMETERY: WorldModule = {
  kind: 'angels',
  name: 'The Cemetery',

  intro(stage) {
    if (stage === 0) {
      return {
        title: 'The Cemetery',
        lines: [
          'Weeping angels stand watch over these grounds. Never blink first.',
          'They keep their distance until five of them share your screen — then they close in, and a touch turns you to stone.',
          'Five crypts wait in these grounds. Bump a shut one to open it, and the open door leads down.',
          'Four of them hold a piece of the contraption in the yard. It wants all four before it will open the way.',
          'Lose them in the hedges: one left far enough behind goes back to sleep where it stands.',
        ],
      };
    }
    return {
      title: 'A crypt',
      lines: [
        'Whatever this crypt holds waits at the far end.',
        'The walls shift down here. When the ground rumbles, hold still and get your bearings.',
        'The stairs up are wherever you first stood.',
      ],
    };
  },

  collectible: { id: 'angel-tear-glass', name: 'The Tear in Glass', description: 'A single tear, set in glass, that never falls.' },

  defeat(_stage, cause) {
    if (cause === 'stone') return 'The angels closed in. You are one of them now.';
    if (cause === 'knockdown') return 'The crypt kept you.';
    return 'The Cemetery kept you.';
  },

  generate(stage, runSeed, hero, data) {
    const cemData = ensureData(runSeed, data);
    return stage === 0 ? buildSurface(runSeed, hero, cemData) : buildCrypt(stage, runSeed, hero, cemData);
  },

  tick(ctx, dt) {
    const data = ctx.world.data as CemeteryData;
    if (ctx.world.stage === 0) {
      tickAngels(ctx, dt, data);
      return;
    }
    const idx = ctx.world.stage - 1;
    if (data.cryptState[idx] !== 'done' && data.pieceKind[idx] === null) {
      const chest = ctx.level.chests[0];
      if (chest?.opened) {
        data.cryptState[idx] = 'done';
        ctx.log('The crypt is emptied.');
      }
    }
    data.shiftMs = (data.shiftMs ?? SHIFT_INTERVAL_MS) - dt;
    if (data.shiftMs > 0) return;
    data.shiftMs += SHIFT_INTERVAL_MS;
    ctx.log('The walls slide.');
    ctx.sfx('rumble');
    ctx.freeze(1400, 8);
    shiftMaze(ctx);
    ctx.rebuild();
  },

  onEnter(ctx, tile) {
    if (ctx.world.stage === 0) {
      const g = graveAt(ctx.level, tile);
      const name = (g?.data as { name?: string } | undefined)?.name;
      if (name) ctx.log(`"Here lies ${name}."`);
      return;
    }
    const idx = ctx.world.stage - 1;
    const data = ctx.world.data as CemeteryData;
    if (data.cryptState[idx] === 'done') return;
    const carried = ctx.carried();
    if (carried && carried.id === pieceId(idx) && !data.pieceTaken?.[idx]) {
      // Said once per piece; the crypt itself stays 'open' until the
      // contraption has the piece, so a dropped one is never lost.
      data.pieceTaken = { ...(data.pieceTaken ?? {}), [idx]: true };
      ctx.log('You take the relic piece. The contraption in the yard wants it.');
      ctx.text(carried.pos, 'A relic piece', '#f5d76e', 1200);
    }
  },

  onBump(ctx, prop) {
    if (prop.kind === 'portal-home') {
      ctx.returnHome();
      return;
    }
    if (prop.kind === 'stairs-up') {
      ctx.goto(0);
      return;
    }
    if (prop.kind === 'crypt') {
      const data = ctx.world.data as CemeteryData;
      const idx = (prop.data as { index: number }).index;
      if (data.cryptState[idx] === 'shut') {
        data.cryptState[idx] = 'open';
        prop.state = 'open';
        ctx.log('The crypt door grinds open.');
        ctx.sfx('doorOpen');
      } else {
        ctx.goto(1 + idx);
      }
      return;
    }
    if (prop.kind === 'contraption') {
      const data = ctx.world.data as CemeteryData;
      const carried = ctx.carried();
      if (carried && carried.kind.startsWith('piece:')) {
        ctx.consume(carried);
        data.pieces++;
        const idx = PIECE_IDS.indexOf(carried.id);
        if (idx >= 0) data.cryptState[idx] = 'done';
        prop.state = contraptionState(data.pieces);
        ctx.ring(prop.pos, 1, '#f5d76e', 500);
        ctx.log('The contraption takes the piece.');
        ctx.sfx('seal');
        if (data.pieces >= 4 && !data.finished) {
          data.finished = true;
          ctx.finish();
        }
      } else {
        ctx.log(data.pieces >= 4 ? 'The contraption is complete.' : 'The contraption needs its pieces.');
      }
    }
  },

  step(ctx, m) {
    if (m.kind === 'ghoul') return ghoulStep(ctx, m);
    return null;
  },
};
