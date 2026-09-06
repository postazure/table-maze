/**
 * Hidden wings: the dungeon behind the wall.
 *
 * A wing is a small crawl of its own dug into the rock outside the maze: a
 * grid of rooms (`WING_COLS(depth)` along the wall by `WING_ROWS` deep) joined
 * by short corridors, hung off one tile of the maze's outer wall. Every tile
 * of one is hidden ground — brick to look at and brick to walk into without a
 * Cracked Lens (see lens.ts) — and nothing on a floor ever needs one: the
 * stairs, the keys and the shrines all stay out in the maze.
 *
 * What a wing is for:
 *  - a **treasure room** at the far end of the room graph, a leaf, with a
 *    chest holding a magic item — the same thing the shop sells;
 *  - a **sealed door** on the one corridor into it, opened by a lock chosen
 *    per floor: runes stepped on in order, an orb carried from another room
 *    to the cradle before the door, or a keystone relic picked up in a wing
 *    on an earlier floor (see puzzles.ts);
 *  - the **hard end of the floor's monsters**: lurkers and elite guards a
 *    level over what the maze outside would roll, and now and then a mimic
 *    among the side chests;
 *  - **relics** for later floors' keystones and, from the second set on, the
 *    odd **altar** that takes a boss trophy for a boon (see boons.ts).
 *
 * The shape is planned in a local frame first — `along` the wall and `deep`
 * into the rock — and only then laid onto the level, so one plan serves all
 * four sides. `canDig` is the same rule a warren obeys: the whole shape and
 * everything it touches must be rock, bar the anchors it hangs off, which is
 * what keeps a wing touching the maze only at its mouths.
 */
import { Tile, key, eq } from './types';
import type {
  Altar,
  BossKind,
  Chest,
  LevelData,
  Monster,
  Orb,
  Passage,
  Rect,
  RelicKind,
  Rng,
  RosterKind,
  RuneHint,
  Rune,
  Seal,
  Vec,
} from './types';
import { ITEM_KINDS } from './types';
import { makeMonster, rollChestLoot } from './balance';
import type { MonsterOpts } from './balance';
import { bfsDistances, bfsPath, isFloor } from './pathfind';
import { RUNE_GLYPHS, relicOffered, relicsBefore } from './puzzles';
import { BOSS_EVERY, bossKindForDepth } from './boss';

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** A room cell is this many tiles along the wall: a room of 3 to 5 plus rock either side. */
export const WING_CELL_ALONG = 7;
/** ...and this many deep: a room of 3 or 4 plus the corridor gap to the next row. */
export const WING_CELL_DEEP = 6;
/** Rooms deep, always. Bigger floors get more rooms along the wall instead. */
export const WING_ROWS = 2;
/**
 * Rock left around the maze for the wings (and the warrens) to be dug out
 * of. A neck through the wall, `WING_ROWS` cells of rooms, a niche off the
 * back of the last row, and a ring of rock past that. Even, so the maze's
 * odd lattice carries on unbroken.
 */
export const WING_MARGIN = WING_ROWS * WING_CELL_DEEP + 4;
/** Never open a wing right on the hero's first steps. */
const WING_ANCHOR_MIN_DIST = 4;
/** How often a wing gets a second mouth back into the maze. */
const BACK_DOOR_CHANCE = 0.5;
/** How often a wing has a side chest at all, and how often that chest is a mimic. */
const SIDE_CHEST_CHANCE = 0.5;
const MIMIC_CHANCE = 0.45;
/** From this depth an altar may stand in a wing, and how often one does. */
const ALTAR_FROM_DEPTH = BOSS_EVERY + 1;
const ALTAR_CHANCE = 0.35;
/** Most monsters one wing carries... */
export const PASSAGE_MONSTER_CAP = 8;
/** ...and across all of a floor's wings. */
export const PASSAGE_MONSTER_BUDGET = 8;

/** Rooms along the wall for this depth: the wing grows with the floor. */
export function wingCols(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  return d <= 3 ? 2 : d <= 8 ? 3 : 4;
}

// ---------------------------------------------------------------------------
// The local frame
// ---------------------------------------------------------------------------

/** A tile in wing-local coordinates: `a` along the wall, `d` into the rock. */
interface LT {
  a: number;
  d: number;
}

/** A room in local coordinates, both ranges inclusive. */
interface LocalRoom {
  a0: number;
  a1: number;
  d0: number;
  d1: number;
}

/** A corridor between two rooms, tiles ordered from `from` to `to`. */
interface LocalEdge {
  from: number;
  to: number;
  tiles: LT[];
}

interface LocalPlan {
  rooms: LocalRoom[];
  entry: number;
  treasure: number;
  edges: LocalEdge[];
  /** The neck from the mouth (d = 1) down to the entry room. */
  neck: LT[];
  /** A second neck to the maze, or null. */
  backNeck: LT[] | null;
  /** The corridor into the treasure room, ordered toward it. */
  treasureWay: LT[];
  /** Room tiles that touch a corridor: never stand anything solid on one. */
  doorways: Set<string>;
  /** Niches: one-tile dead ends hung off a room, by room index. */
  niches: { room: number; at: LT }[];
}

const lk = (t: LT): string => `${t.a},${t.d}`;

/**
 * Plan a wing of `cols` x `WING_ROWS` rooms whose mouth opens into cell
 * `entryCol` of the first row. Everything here is geometry in the local frame;
 * nothing is checked against the level yet.
 */
function planWing(cols: number, entryCol: number, rng: Rng): LocalPlan {
  const rows = WING_ROWS;
  // The mouth is at a = 0; the entry cell is centred on it, so its room —
  // whatever its width and offset — always covers the neck.
  const origin = -(WING_CELL_ALONG * entryCol + 3);
  const rooms: LocalRoom[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const w = rng.int(3, 5);
      const offA = rng.int(1, WING_CELL_ALONG - 1 - w);
      const h = rng.pick([3, 3, 4]);
      const offD = h === 4 ? 1 : rng.int(1, 2);
      const a0 = origin + WING_CELL_ALONG * c + offA;
      const d0 = 2 + WING_CELL_DEEP * r + offD;
      rooms.push({ a0, a1: a0 + w - 1, d0, d1: d0 + h - 1 });
    }
  }
  const idx = (c: number, r: number): number => r * cols + c;
  const entry = idx(entryCol, 0);

  // A spanning tree over the cells by randomised depth-first walk, so the
  // rooms are reached in a winding order rather than a grid.
  const n = rows * cols;
  const adj = (i: number): number[] => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const out: number[] = [];
    if (c > 0) out.push(idx(c - 1, r));
    if (c < cols - 1) out.push(idx(c + 1, r));
    if (r > 0) out.push(idx(c, r - 1));
    if (r < rows - 1) out.push(idx(c, r + 1));
    return out;
  };
  const treeEdges: [number, number][] = [];
  const visited = new Array<boolean>(n).fill(false);
  const depthOf = new Array<number>(n).fill(0);
  const stack = [entry];
  visited[entry] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const open = adj(cur).filter((j) => !visited[j]);
    if (!open.length) {
      stack.pop();
      continue;
    }
    const next = rng.pick(open);
    visited[next] = true;
    depthOf[next] = depthOf[cur] + 1;
    treeEdges.push([cur, next]);
    stack.push(next);
  }

  // The treasure room: the deepest leaf of the tree. A leaf has one way in,
  // which is where the seal goes.
  const degree = new Array<number>(n).fill(0);
  for (const [a, b] of treeEdges) {
    degree[a]++;
    degree[b]++;
  }
  let treasure = -1;
  let best = -1;
  const leaves: number[] = [];
  for (let i = 0; i < n; i++) if (i !== entry && degree[i] === 1) leaves.push(i);
  rng.shuffle(leaves);
  for (const i of leaves) {
    if (depthOf[i] > best) {
      best = depthOf[i];
      treasure = i;
    }
  }
  if (treasure < 0) treasure = leaves[0] ?? (entry === 0 ? 1 : 0);

  // A loop or two, never through the treasure room, so a hero can lead a
  // lurker round the rooms the way they would round a warren.
  const has = new Set(treeEdges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  const extras: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (i === treasure) continue;
    for (const j of adj(i)) {
      if (j <= i || j === treasure) continue;
      if (!has.has(`${i}-${j}`)) extras.push([i, j]);
    }
  }
  rng.shuffle(extras);
  const loops = n >= 6 ? 2 : 1;
  const allEdges = [...treeEdges, ...extras.slice(0, loops)];

  // Corridors: straight, through the overlap of the two rooms' spans.
  const edges: LocalEdge[] = [];
  const doorways = new Set<string>();
  for (const [from, to] of allEdges) {
    const A = rooms[from];
    const B = rooms[to];
    const tiles: LT[] = [];
    if (Math.floor(from / cols) === Math.floor(to / cols)) {
      // Same row: side by side.
      const [L, R] = A.a0 < B.a0 ? [A, B] : [B, A];
      const d = rng.int(Math.max(L.d0, R.d0), Math.min(L.d1, R.d1));
      const run: LT[] = [];
      for (let a = L.a1 + 1; a <= R.a0 - 1; a++) run.push({ a, d });
      if (L !== A) run.reverse();
      tiles.push(...run);
      doorways.add(lk({ a: L.a1, d }));
      doorways.add(lk({ a: R.a0, d }));
    } else {
      // Same column: one above the other.
      const [T, U] = A.d0 < B.d0 ? [A, B] : [B, A];
      const a = rng.int(Math.max(T.a0, U.a0), Math.min(T.a1, U.a1));
      const run: LT[] = [];
      for (let d = T.d1 + 1; d <= U.d0 - 1; d++) run.push({ a, d });
      if (T !== A) run.reverse();
      tiles.push(...run);
      doorways.add(lk({ a, d: T.d1 }));
      doorways.add(lk({ a, d: U.d0 }));
    }
    edges.push({ from, to, tiles });
  }

  // The neck: from the mouth in the wall (d = 1) to the entry room.
  const neck: LT[] = [];
  for (let d = 1; d < rooms[entry].d0; d++) neck.push({ a: 0, d });
  doorways.add(lk({ a: 0, d: rooms[entry].d0 }));

  // The way into the treasure room, pointing at it.
  const tEdge = edges.find((e) => e.from === treasure || e.to === treasure) as LocalEdge;
  const treasureWay = tEdge.to === treasure ? tEdge.tiles : tEdge.tiles.slice().reverse();

  const plan: LocalPlan = {
    rooms,
    entry,
    treasure,
    edges,
    neck,
    backNeck: null,
    treasureWay,
    doorways,
    niches: [],
  };

  // A back door: a second neck from a first-row room that is neither the
  // entry nor the treasure, straight up to the wall. Only a candidate here;
  // whether the maze has floor there is settled when the plan is laid down.
  if (rng.chance(BACK_DOOR_CHANCE)) {
    const cands: number[] = [];
    for (let c = 0; c < cols; c++) {
      const i = idx(c, 0);
      if (i !== entry && i !== treasure) cands.push(i);
    }
    if (cands.length) {
      const room = rng.pick(cands);
      const a = origin + WING_CELL_ALONG * (room % cols) + 3;
      const back: LT[] = [];
      for (let d = 1; d < rooms[room].d0; d++) back.push({ a, d });
      plan.backNeck = back;
      doorways.add(lk({ a, d: rooms[room].d0 }));
    }
  }

  planNiches(plan, rng);
  return plan;
}

/** Every tile of the plan, as a set of local keys. */
function planTiles(plan: LocalPlan, withBack: boolean): Map<string, LT> {
  const out = new Map<string, LT>();
  const add = (t: LT) => out.set(lk(t), t);
  for (const r of plan.rooms) {
    for (let d = r.d0; d <= r.d1; d++) for (let a = r.a0; a <= r.a1; a++) add({ a, d });
  }
  for (const e of plan.edges) for (const t of e.tiles) add(t);
  for (const t of plan.neck) add(t);
  if (withBack && plan.backNeck) for (const t of plan.backNeck) add(t);
  for (const nc of plan.niches) add(nc.at);
  return out;
}

/**
 * Niches: one-tile dead ends off the rooms, for the chests and altars, which
 * are solid and so may only stand where they block nothing. A niche has to
 * touch its room and nothing else in the plan, and stay two tiles clear of
 * the wall (`d >= 3`) so it never brushes the maze.
 */
function planNiches(plan: LocalPlan, rng: Rng): void {
  const shape = planTiles(plan, true);
  const around = (t: LT): LT[] => [
    { a: t.a + 1, d: t.d },
    { a: t.a - 1, d: t.d },
    { a: t.a, d: t.d + 1 },
    { a: t.a, d: t.d - 1 },
  ];
  plan.rooms.forEach((room, i) => {
    const cands: LT[] = [];
    for (let a = room.a0; a <= room.a1; a++) {
      cands.push({ a, d: room.d0 - 1 }, { a, d: room.d1 + 1 });
    }
    for (let d = room.d0; d <= room.d1; d++) {
      cands.push({ a: room.a0 - 1, d }, { a: room.a1 + 1, d });
    }
    rng.shuffle(cands);
    // Two per room at most, and the treasure room always gets first pick of
    // its own: it is the one that must have somewhere to put a chest.
    let made = 0;
    for (const c of cands) {
      if (made >= 2) break;
      if (c.d < 3 || shape.has(lk(c))) continue;
      let clear = true;
      for (const nb of around(c)) {
        if (!shape.has(lk(nb))) continue;
        // The one neighbour allowed is a tile of this room.
        const inRoom = nb.a >= room.a0 && nb.a <= room.a1 && nb.d >= room.d0 && nb.d <= room.d1;
        if (!inRoom || plan.doorways.has(lk(nb))) clear = false;
      }
      if (!clear) continue;
      shape.set(lk(c), c);
      plan.niches.push({ room: i, at: c });
      made++;
    }
  });
}

// ---------------------------------------------------------------------------
// Laying a plan onto the level
// ---------------------------------------------------------------------------

/** Where a plan sits on the level: the anchor tile, the way out, and the way along. */
interface Frame {
  at: Vec;
  out: Vec;
  along: Vec;
}

function world(f: Frame, t: LT): Vec {
  return { x: f.at.x + f.along.x * t.a + f.out.x * t.d, y: f.at.y + f.along.y * t.a + f.out.y * t.d };
}

function worldRect(f: Frame, r: LocalRoom): Rect {
  const p = world(f, { a: r.a0, d: r.d0 });
  const q = world(f, { a: r.a1, d: r.d1 });
  const x = Math.min(p.x, q.x);
  const y = Math.min(p.y, q.y);
  return { x, y, w: Math.abs(p.x - q.x) + 1, h: Math.abs(p.y - q.y) + 1 };
}

/**
 * Can this shape be dug? Every tile of it must be rock, and every tile it
 * touches must be rock too, or part of the shape, or one of the `anchors` it
 * hangs off. That last clause is what fixes how many ways in there are.
 * Shared with the warrens in maze.ts.
 */
export function canDig(level: LevelData, shape: Vec[], anchors: Vec[]): boolean {
  const inShape = new Set(shape.map(key));
  const isAnchor = new Set(anchors.map(key));
  for (const t of shape) {
    if (t.x < 1 || t.y < 1 || t.x >= level.width - 1 || t.y >= level.height - 1) return false;
    if (level.tiles[t.y][t.x] !== Tile.Wall) return false;
  }
  for (const t of shape) {
    for (const nb of [
      { x: t.x + 1, y: t.y },
      { x: t.x - 1, y: t.y },
      { x: t.x, y: t.y + 1 },
      { x: t.x, y: t.y - 1 },
    ]) {
      if (inShape.has(key(nb)) || isAnchor.has(key(nb))) continue;
      if (isFloor(level, nb)) return false; // it would open onto something already dug
    }
  }
  return true;
}

/** One side of the maze: which way it faces, and its perimeter tiles. */
interface Side {
  out: Vec;
  anchors: Vec[];
}

/**
 * The maze tiles that sit against its outer wall, grouped by which way that
 * wall faces, less the ones too close to the start. A wing can only be dug
 * from one of these: anywhere else there is more maze on the other side.
 */
function sidesOf(level: LevelData, core: Rect, dist: Map<string, number>): Side[] {
  const sides: Side[] = [
    { out: { x: 0, y: -1 }, anchors: [] },
    { out: { x: 0, y: 1 }, anchors: [] },
    { out: { x: -1, y: 0 }, anchors: [] },
    { out: { x: 1, y: 0 }, anchors: [] },
  ];
  const push = (i: number, at: Vec) => {
    if (!isFloor(level, at)) return;
    if (eq(at, level.start) || eq(at, level.exit)) return;
    if ((dist.get(key(at)) ?? 0) < WING_ANCHOR_MIN_DIST) return;
    sides[i].anchors.push(at);
  };
  for (let x = core.x + 1; x < core.x + core.w - 1; x += 2) {
    push(0, { x, y: core.y + 1 });
    push(1, { x, y: core.y + core.h - 2 });
  }
  for (let y = core.y + 1; y < core.y + core.h - 1; y += 2) {
    push(2, { x: core.x + 1, y });
    push(3, { x: core.x + core.w - 2, y });
  }
  return sides;
}

/** A wing as laid on the level, with everything `stockWing` needs to fill it. */
interface Laid {
  frame: Frame;
  plan: LocalPlan;
  passage: Passage;
  withBack: boolean;
}

/**
 * Try to lay `plan` off anchor `at` facing `out`; with its back door if the
 * maze has floor where that would come out, without it otherwise.
 */
function layPlan(level: LevelData, at: Vec, out: Vec, plan: LocalPlan, id: string): Laid | null {
  const frame: Frame = { at, out, along: { x: out.y, y: out.x } };
  const options: boolean[] = [];
  if (plan.backNeck) {
    const back = plan.backNeck[0];
    const anchor = world(frame, { a: back.a, d: 0 });
    if (isFloor(level, anchor) && !eq(anchor, level.start) && !eq(anchor, level.exit)) options.push(true);
  }
  options.push(false);
  for (const withBack of options) {
    const local = Array.from(planTiles(plan, withBack).values());
    const tiles = local.map((t) => world(frame, t));
    const anchors = [at];
    const mouths = [world(frame, plan.neck[0])];
    if (withBack && plan.backNeck) {
      anchors.push(world(frame, { a: plan.backNeck[0].a, d: 0 }));
      mouths.push(world(frame, plan.backNeck[0]));
    }
    if (!canDig(level, tiles, anchors)) continue;
    const passage: Passage = {
      id,
      kind: 'wing',
      tiles,
      mouths,
      rooms: plan.rooms.map((r) => worldRect(frame, r)),
      entry: plan.entry,
      treasure: plan.treasure,
    };
    return { frame, plan, passage, withBack };
  }
  return null;
}

/**
 * Dig this floor's wing(s) and furnish them with everything that is geometry:
 * the treasure chest and its seal, the lock's runes or orb, a side chest that
 * may be a mimic, a relic if this floor offers one, and an altar now and then.
 * Monsters come later (`stockWings`), once the floor has been trimmed and the
 * distances from the start are known.
 *
 * `runSeed` is the whole run's, not this floor's: keystone seals ask for a
 * relic some earlier floor of this run laid out, which only the run seed
 * can answer.
 */
export function digWings(
  level: LevelData,
  core: Rect,
  depth: number,
  runSeed: number,
  rng: Rng,
  furnish: boolean,
): Passage[] {
  const dist = bfsDistances(level, level.start);
  const sides = rng.shuffle(sidesOf(level, core, dist));
  const out: Passage[] = [];
  let cols = wingCols(depth);
  // Widest first, narrowing only when nothing on any side will take it: a
  // floor that could hold a six-room wing should not settle for four.
  for (; cols >= 2 && out.length === 0; cols--) {
    for (const side of sides) {
      if (out.length) break;
      for (const at of rng.shuffle(side.anchors.slice())) {
        const plan = planWing(cols, rng.int(0, cols - 1), rng);
        const laid = layPlan(level, at, side.out, plan, `pg${out.length + 1}`);
        if (!laid) continue;
        for (const t of laid.passage.tiles) level.tiles[t.y][t.x] = Tile.Floor;
        out.push(laid.passage);
        if (furnish) furnishWing(level, laid, depth, runSeed, rng);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Furnishing
// ---------------------------------------------------------------------------

/** The interior tiles of a room that are not a doorway, shuffled. */
function roomFloor(laid: Laid, room: number, rng: Rng): Vec[] {
  const r = laid.plan.rooms[room];
  const out: Vec[] = [];
  for (let d = r.d0; d <= r.d1; d++) {
    for (let a = r.a0; a <= r.a1; a++) {
      if (laid.plan.doorways.has(lk({ a, d }))) continue;
      out.push(world(laid.frame, { a, d }));
    }
  }
  return rng.shuffle(out);
}

/** Graph distance from `from` to every room, over the corridors. */
function roomDistances(plan: LocalPlan, from: number): number[] {
  const n = plan.rooms.length;
  const dist = new Array<number>(n).fill(Infinity);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift() as number;
    for (const e of plan.edges) {
      const other = e.from === cur ? e.to : e.to === cur ? e.from : -1;
      if (other < 0 || dist[other] !== Infinity) continue;
      dist[other] = dist[cur] + 1;
      queue.push(other);
    }
  }
  return dist;
}

/**
 * Which lock this floor's seal gets. The first floor teaches with something
 * obvious; after that the mix leans obvious with a cryptic one now and then,
 * and a keystone only where an earlier floor of this run put a relic down.
 */
function rollLock(depth: number, runSeed: number, rng: Rng): { kind: 'runes'; hint: RuneHint } | { kind: 'orb' } | { kind: 'keystone'; relic: RelicKind } {
  const relics = depth > BOSS_EVERY ? relicsBefore(runSeed, depth) : [];
  if (depth <= 1) return rng.chance(0.5) ? { kind: 'orb' } : { kind: 'runes', hint: 'pips' };
  const r = rng.next();
  if (r < 0.3) return { kind: 'orb' };
  if (r < 0.55) return { kind: 'runes', hint: 'pips' };
  if (r < 0.75) return { kind: 'runes', hint: 'seal' };
  if (r < 0.85) return { kind: 'runes', hint: 'none' };
  if (relics.length) return { kind: 'keystone', relic: rng.pick(relics) };
  return { kind: 'runes', hint: 'seal' };
}

function furnishWing(level: LevelData, laid: Laid, depth: number, runSeed: number, rng: Rng): void {
  const { plan, frame } = laid;
  const taken = new Set<string>();
  const claim = (p: Vec): Vec => {
    taken.add(key(p));
    return { x: p.x, y: p.y };
  };
  const free = (p: Vec): boolean => !taken.has(key(p));
  const freeIn = (room: number): Vec | null => roomFloor(laid, room, rng).find(free) ?? null;
  const nicheOf = (room: number): Vec | null => {
    const nc = plan.niches.find((n) => n.room === room && free(world(frame, n.at)));
    return nc ? world(frame, nc.at) : null;
  };
  const fromTreasure = roomDistances(plan, plan.treasure);
  const side = plan.rooms.map((_, i) => i).filter((i) => i !== plan.treasure);
  // Rooms furthest from the treasure first: that is where a lock's key wants
  // to be, so the walk to the door is the length of the wing.
  const farFirst = side.slice().sort((a, b) => fromTreasure[b] - fromTreasure[a]);

  level.seals = level.seals ?? [];
  level.runes = level.runes ?? [];
  level.orbs = level.orbs ?? [];
  level.relics = level.relics ?? [];
  level.altars = level.altars ?? [];

  // 1. The treasure: a magic item of this floor's level, in the niche off the
  //    treasure room, or on its floor if the room has no niche.
  const chestSpot = nicheOf(plan.treasure) ?? freeIn(plan.treasure);
  if (chestSpot) {
    const magic = { kind: rng.pick(ITEM_KINDS), level: depth };
    const chest: Chest = {
      id: `v${level.chests.length + 1}`,
      pos: claim(chestSpot),
      opened: false,
      loot: { gold: rng.int(10, 20) * depth, xp: 5 * depth, magic },
    };
    level.chests.push(chest);
  }

  // 2. The seal on the way in, and its lock.
  const way = plan.treasureWay.map((t) => world(frame, t));
  const sealPos = claim(way[way.length - 1]);
  const sealId = `seal${level.seals.length + 1}`;
  const lock = rollLock(depth, runSeed, rng);
  let seal: Seal;
  if (lock.kind === 'runes') {
    const count = lock.hint === 'none' ? 3 : depth >= 8 ? 4 : 3;
    const glyphs = rng.shuffle(Array.from({ length: RUNE_GLYPHS }, (_, i) => i)).slice(0, count);
    const ids: string[] = [];
    // One rune per room, furthest rooms first, then double up if the wing is
    // small. The entry room takes one last: a rune by the door is no puzzle.
    const order = [...farFirst.filter((i) => i !== plan.entry), plan.entry];
    let n = 0;
    while (ids.length < count && n < count * 3) {
      const room = order[n % order.length];
      n++;
      const spot = freeIn(room);
      if (!spot) continue;
      const rune: Rune = { id: `rune${level.runes.length + 1}`, pos: claim(spot), glyph: glyphs[ids.length], sealId, lit: false };
      level.runes.push(rune);
      ids.push(rune.id);
    }
    seal = { id: sealId, pos: sealPos, open: false, lock: { kind: 'runes', hint: lock.hint, order: rng.shuffle(ids.slice()), lit: 0 } };
  } else if (lock.kind === 'orb') {
    const socket = claim(way[way.length - 2] ?? way[0]);
    // The orb lies as far from its cradle as the wing allows, and not in the
    // entry room unless that is all there is.
    const rooms = farFirst.filter((i) => i !== plan.entry);
    const orbRoom = rooms.length ? rooms[0] : plan.entry;
    const spot = freeIn(orbRoom) ?? freeIn(plan.entry);
    if (spot) {
      const pos = claim(spot);
      level.orbs.push({ id: `orb${level.orbs.length + 1}`, pos, home: { x: pos.x, y: pos.y }, sealId, state: 'floor' });
    }
    seal = { id: sealId, pos: sealPos, open: false, lock: { kind: 'orb', socket, placed: false } };
  } else {
    seal = { id: sealId, pos: sealPos, open: false, lock: { kind: 'keystone', relic: lock.relic } };
  }
  level.seals.push(seal);

  // 3. A relic for some later floor's keystone.
  const relic = relicOffered(runSeed, depth);
  if (relic) {
    const rooms = farFirst.filter((i) => i !== plan.entry);
    const spot = (rooms.length ? freeIn(rooms[rooms.length - 1]) : null) ?? freeIn(plan.entry);
    if (spot) level.relics.push({ id: `relic${level.relics.length + 1}`, pos: claim(spot), kind: relic, taken: false });
  }

  // 4. An altar, carved for a boss this run has already fought.
  if (depth >= ALTAR_FROM_DEPTH && rng.chance(ALTAR_CHANCE)) {
    const fought: BossKind[] = [];
    for (let d = BOSS_EVERY; d < depth; d += BOSS_EVERY) fought.push(bossKindForDepth(d, runSeed));
    const rooms = side.filter((i) => i !== plan.entry);
    const room = rooms.length ? rng.pick(rooms) : plan.entry;
    const spot = nicheOf(room) ?? freeIn(room);
    if (spot && fought.length) {
      const altar: Altar = { id: `altar${level.altars.length + 1}`, pos: claim(spot), trophy: rng.pick(fought), used: false };
      level.altars.push(altar);
    }
  }

  // 5. A side chest, which is a mimic often enough that no chest in a wing is
  //    quite safe to walk up to.
  if (rng.chance(SIDE_CHEST_CHANCE)) {
    const rooms = rng.shuffle(side.filter((i) => i !== plan.entry));
    for (const room of rooms) {
      const spot = nicheOf(room);
      if (!spot) continue;
      const mimic = rng.chance(MIMIC_CHANCE);
      const chest: Chest = {
        id: `v${level.chests.length + 1}`,
        pos: claim(spot),
        opened: false,
        loot: mimic ? { gold: 0, xp: 0 } : rollChestLoot(depth, rng),
      };
      if (mimic) chest.mimic = true;
      level.chests.push(chest);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

/**
 * A patrol beat that never leaves the pocket it starts in — a warren's loop or
 * a wing's rooms — so the monster paces what the player came to walk rather
 * than wandering out into the maze.
 */
export function pocketBeat(level: LevelData, from: Vec, pocket: Set<string>, rng: Rng): Vec[] | null {
  const blocked = (p: Vec) => !pocket.has(key(p));
  const local = bfsDistances(level, from, { blocked, maxDist: 9 });
  const ends: Vec[] = [];
  for (const [k, d] of local) if (d >= 3) ends.push({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) });
  if (!ends.length) return null;
  ends.sort((a, b) => (local.get(key(b)) ?? 0) - (local.get(key(a)) ?? 0));
  const to = rng.pick(ends.slice(0, Math.min(5, ends.length)));
  const tail = bfsPath(level, from, to, { blocked });
  return tail && tail.length ? [from, ...tail] : null;
}

/** Every tile inside `r`. */
function rectTiles(r: Rect): Vec[] {
  const out: Vec[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

/**
 * Monsters for the wings: the hard end of the floor.
 *
 * One per room but the entry room, which is left clear so the doorstep is
 * never a fight you cannot back out of: a lurker, more often than not, with
 * the whole wing to hunt in and the room loops to be baited round; else a
 * guard, and now and then a patrol pacing the rooms. The treasure room gets
 * a guard, standing over the chest. Every one of them takes the wing lift
 * (see `MonsterOpts.wing`). Never on a mouth, never on the seal's doorstep,
 * and a patrol never paces through the seal.
 */
export function stockWings(
  level: LevelData,
  depth: number,
  used: Set<string>,
  dist: Map<string, number>,
  rng: Rng,
  spawn: MonsterOpts,
  minDist: number,
): void {
  let n = level.monsters.length;
  let budget = PASSAGE_MONSTER_BUDGET;
  const wingSpawn: MonsterOpts = { ...spawn, wing: true };
  // `used` holds every hidden tile (so nothing from the maze is ever placed in
  // a wing); what matters here is what the wing itself already stands on.
  const occupied = new Set<string>([
    ...level.chests.map((c) => key(c.pos)),
    ...level.monsters.map((m) => key(m.pos)),
    ...(level.altars ?? []).map((a) => key(a.pos)),
    ...(level.runes ?? []).map((r) => key(r.pos)),
    ...(level.orbs ?? []).map((o) => key(o.pos)),
    ...(level.relics ?? []).map((r) => key(r.pos)),
    ...(level.seals ?? []).flatMap((s) => (s.lock.kind === 'orb' ? [key(s.pos), key(s.lock.socket)] : [key(s.pos)])),
  ]);
  for (const wing of level.passages ?? []) {
    let made = 0;
    const inside = new Set(wing.tiles.map(key));
    const treasureTiles = new Set(rectTiles(wing.rooms[wing.treasure]).map(key));
    const sealTiles = new Set((level.seals ?? []).map((s) => key(s.pos)));
    const beatPocket = new Set([...inside].filter((k) => !treasureTiles.has(k) && !sealTiles.has(k)));
    const okSpot = (p: Vec): boolean => {
      const k = key(p);
      if (occupied.has(k) || (dist.get(k) ?? 0) < minDist) return false;
      if (wing.mouths.some((m) => eq(m, p))) return false;
      // Not on a seal's doorstep either side: a guard there is a lock with no key.
      for (const s of level.seals ?? []) {
        if (Math.abs(s.pos.x - p.x) + Math.abs(s.pos.y - p.y) <= 1) return false;
      }
      return true;
    };
    const place = (m: Monster): void => {
      used.add(key(m.pos));
      occupied.add(key(m.pos));
      level.monsters.push(m);
      budget--;
      made++;
    };

    // The treasure room's guard first: it is the fight the chest is behind.
    const spots = rng.shuffle(rectTiles(wing.rooms[wing.treasure]).filter(okSpot));
    if (spots.length && budget > 0) {
      const chest = level.chests.find((c) => treasureTiles.has(key(c.pos)) || rectNear(wing.rooms[wing.treasure], c.pos));
      // Beside the chest's niche if it has one, so the guard stands over the loot.
      const byChest = chest ? spots.find((p) => Math.abs(p.x - chest.pos.x) + Math.abs(p.y - chest.pos.y) === 1) : null;
      place(makeMonster('guard', depth, rng, byChest ?? spots[0], `pm${++n}`, wingSpawn));
    }

    // Then the rest of the rooms, the far ones first.
    const rooms = wing.rooms.map((_, i) => i).filter((i) => i !== wing.entry && i !== wing.treasure);
    rng.shuffle(rooms);
    for (const i of rooms) {
      if (budget <= 0 || made >= PASSAGE_MONSTER_CAP) break;
      const roomSpots = rng.shuffle(rectTiles(wing.rooms[i]).filter(okSpot));
      if (!roomSpots.length) continue;
      const roll = rng.next();
      const kind: RosterKind = roll < 0.45 ? 'lurker' : roll < 0.8 ? 'guard' : 'patrol';
      const spot = roomSpots[0];
      const m = makeMonster(kind, depth, rng, spot, `pm${++n}`, wingSpawn);
      if (kind === 'lurker') {
        m.sightRange = 4;
        m.leash = 10;
      } else if (kind === 'patrol') {
        const beat = pocketBeat(level, spot, beatPocket, rng);
        if (!beat) continue;
        m.patrolPath = beat;
        m.patrolIndex = 0;
        m.patrolDir = 1;
      }
      place(m);
    }
  }
}

/** Is `p` one tile outside `r` (a niche off it)? */
function rectNear(r: Rect, p: Vec): boolean {
  const inX = p.x >= r.x && p.x < r.x + r.w;
  const inY = p.y >= r.y && p.y < r.y + r.h;
  if (inX && (p.y === r.y - 1 || p.y === r.y + r.h)) return true;
  if (inY && (p.x === r.x - 1 || p.x === r.x + r.w)) return true;
  return false;
}

/**
 * Move everything a wing put on the floor when the level is trimmed
 * (`trimToUsed` in maze.ts). The passages' own tiles are shifted there; this
 * is the furniture that was laid before the trim.
 */
export function shiftWingContent(level: LevelData, shift: (p: Vec) => void): void {
  for (const wing of level.passages ?? []) {
    for (const r of wing.rooms) {
      const p = { x: r.x, y: r.y };
      shift(p);
      r.x = p.x;
      r.y = p.y;
    }
  }
  for (const s of level.seals ?? []) {
    shift(s.pos);
    if (s.lock.kind === 'orb') shift(s.lock.socket);
  }
  for (const r of level.runes ?? []) shift(r.pos);
  for (const o of level.orbs ?? []) {
    shift(o.pos);
    shift(o.home);
  }
  for (const r of level.relics ?? []) shift(r.pos);
  for (const a of level.altars ?? []) shift(a.pos);
  for (const c of level.chests) shift(c.pos);
}
