/**
 * Olympus: the minotaur's boss world. Ancient Greece, a different world from
 * the maze — see engine/CONTRACTS.md ("The crafting chain and the boss
 * worlds") for the shape every world module keeps.
 *
 * Four stages, one hub and three realms:
 *  0. The Gate of Olympus — three statues, three archways, the portal home.
 *  1. The Sky Realm        — Medusa's gaze, the thunderbolt.
 *  2. The Wine-Dark Sea    — sirens' song, the ship, the trident.
 *  3. The Underworld       — the Styx, Cerberus, the helm.
 *
 * Progress rides in `WorldData.data` (see `GreeceData` below), which is why a
 * symbol the hero is carrying survives a trip back to the hub or a re-entry
 * into its own realm: `generate` always checks `hero.carrying` first and
 * re-creates that one prop hidden, wherever it is.
 */
import type { Dir, Hero, LevelData, Monster, Prop, Rect, Rng, Vec, WorldData } from '../types';
import { Tile, eq, key, manhattan } from '../types';
import { hashSeed, makeRng } from '../rng';
import { HERO_ATK_BASE, HERO_HP_BASE, levelCurve } from '../balance';
import { bfsDistances, bfsPath, isFloor } from '../pathfind';
import type { WorldCtx, WorldModule } from './world';

/** Keeps every level's own rng stream apart from the maze/boss/shop ones. */
const SALT = 0x0e1a5;

// ---------------------------------------------------------------------------
// The gods, their symbols, and the puzzle state that outlives every stage
// ---------------------------------------------------------------------------

type God = 'zeus' | 'poseidon' | 'hades';
const GODS: readonly God[] = ['zeus', 'poseidon', 'hades'];

/** Symbol prop id/kind per god (also its own art key). */
const SYMBOL_OF: Record<God, string> = { zeus: 'symbol:bolt', poseidon: 'symbol:trident', hades: 'symbol:helm' };
const GOD_OF_SYMBOL: Record<string, God> = { 'symbol:bolt': 'zeus', 'symbol:trident': 'poseidon', 'symbol:helm': 'hades' };
const GOD_NAME: Record<God, string> = { zeus: 'Zeus', poseidon: 'Poseidon', hades: 'Hades' };
const GOD_COLOR: Record<God, string> = { zeus: '#f5c451', poseidon: '#3a8fe0', hades: '#7b5cc9' };
const SYMBOL_NOUN: Record<string, string> = { 'symbol:bolt': 'thunderbolt', 'symbol:trident': 'trident', 'symbol:helm': 'helm' };
const GATE_OF: Record<God, string> = { zeus: 'gate:sky', poseidon: 'gate:sea', hades: 'gate:underworld' };

/**
 * Everything that rides from stage to stage (and into the save). Every field
 * is plain JSON — the engine never reads it, only carries it.
 */
interface GreeceData {
  /**
   * Which statues have their symbol. A symbol only ever leaves the world
   * through its statue: set down in its realm and left there, or dropped on
   * a knockdown, it is back where it lay the next time the realm is
   * generated (unless the hero is carrying it, see `carriedGhost`).
   */
  placed: Record<God, boolean>;
  /** Where the sea's ship currently sits (stage 2). */
  ship: 'pier' | 'island';
  /** Stage 3: has the brazier order already been solved (persists once true). */
  sealOpen: boolean;
  /** Stage 3: how many braziers of the sequence are lit right now, in order. */
  brazierProgress: number;
  /** Stage 3: has Cerberus already been fed the cake (persists once true). */
  cerberusAsleep: boolean;
  /** Stage 1 only, reset whenever the stage is (re)generated: continuous gaze ms. */
  gazeMs: number;
  /** Stage 2 only, reset whenever the stage is (re)generated: the song's beat clock. */
  songMs: number;
  /** Stage 2 only: a siren had the hero last tick (so the hold's cue fires once per catch). */
  songHeld?: boolean;
  /** Which alcove/gate slot each god landed in this run (varies the hub a little). */
  godOrder: God[];
}

function freshData(rng: Rng): GreeceData {
  return {
    placed: { zeus: false, poseidon: false, hades: false },
    ship: 'pier',
    sealOpen: false,
    brazierProgress: 0,
    cerberusAsleep: false,
    gazeMs: 0,
    songMs: 0,
    godOrder: rng.shuffle([...GODS]),
  };
}

/** Read `WorldData.data` back into a `GreeceData`, tolerating a missing/partial bag. */
function readData(raw: WorldData['data'] | null, rng: Rng): GreeceData {
  if (!raw) return freshData(rng);
  const d = raw as Partial<GreeceData>;
  const order = Array.isArray(d.godOrder) && d.godOrder.length === 3 ? (d.godOrder as God[]) : rng.shuffle([...GODS]);
  return {
    placed: {
      zeus: !!d.placed?.zeus,
      poseidon: !!d.placed?.poseidon,
      hades: !!d.placed?.hades,
    },
    ship: d.ship === 'island' ? 'island' : 'pier',
    sealOpen: !!d.sealOpen,
    brazierProgress: typeof d.brazierProgress === 'number' ? d.brazierProgress : 0,
    cerberusAsleep: !!d.cerberusAsleep,
    // Transient per-visit clocks: never carried in from a previous stage.
    gazeMs: 0,
    songMs: 0,
    godOrder: order,
  };
}

const allPlaced = (d: GreeceData): boolean => d.placed.zeus && d.placed.poseidon && d.placed.hades;

/** How many gods are already placed — all `intro` ever needs, so it never has to touch an `Rng`. */
function placedCount(raw: WorldData['data'] | null): number {
  const d = raw as Partial<GreeceData> | null;
  if (!d?.placed) return 0;
  return GODS.filter((g) => d.placed?.[g]).length;
}

// ---------------------------------------------------------------------------
// Small grid helpers shared by every stage (odd-lattice carving, solid rings)
// ---------------------------------------------------------------------------

const CARDINALS: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

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

function inRectLocal(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

function rectCenter(r: Rect): Vec {
  return { x: r.x + Math.floor((r.w - 1) / 2), y: r.y + Math.floor((r.h - 1) / 2) };
}

function rectTiles(r: Rect): Vec[] {
  const out: Vec[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

/** Perfect maze on the odd lattice (iterative recursive backtracker). */
function carveMaze(width: number, height: number, rng: Rng): Tile[][] {
  const tiles = solidGrid(width, height);
  const cw = (width - 1) / 2;
  const ch = (height - 1) / 2;
  const visited = new Array<boolean>(cw * ch).fill(false);
  visited[0] = true;
  tiles[1][1] = Tile.Floor;
  const stack: Vec[] = [{ x: 0, y: 0 }];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const open: Vec[] = [];
    for (const d of CARDINALS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || visited[ny * cw + nx]) continue;
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

/** Only ever adds floor (never removes it), so it can never disconnect anything already carved. */
function pasteFloor(big: Tile[][], sub: Tile[][], ox: number, oy: number): void {
  for (let y = 0; y < sub.length; y++) {
    for (let x = 0; x < sub[0].length; x++) {
      if (sub[y][x] === Tile.Floor) big[y + oy][x + ox] = Tile.Floor;
    }
  }
}

function minimalLevel(
  stage: number,
  runSeed: number,
  width: number,
  height: number,
  tiles: Tile[][],
  theme: string,
  start: Vec,
  data: GreeceData,
): LevelData {
  return {
    depth: Math.max(1, stage),
    seed: hashSeed(runSeed, stage, SALT),
    kind: 'world',
    theme,
    world: { kind: 'minotaur', stage, data: data as unknown as WorldData['data'], won: allPlaced(data) },
    props: [],
    width,
    height,
    tiles,
    start,
    exit: start, // unused on world floors; the module's own gates and goto() are the way out
    keys: [],
    doors: [],
    chests: [],
    goldPiles: [],
    monsters: [],
  };
}

/** The prop a carried symbol/tool becomes when its stage is regenerated: hidden, in the hero's arms. */
function carriedGhost(hero: Hero, id: string): Prop | null {
  if (hero.carrying !== id) return null;
  return { id, pos: { ...hero.pos }, kind: id, solid: false, art: id, carriable: true, hidden: true };
}

// ---------------------------------------------------------------------------
// Stage 0: The Gate of Olympus
// ---------------------------------------------------------------------------

const HUB_W = 21;
const HUB_H = 31;

function buildHub(rng: Rng, runSeed: number, hero: Hero, data: GreeceData): LevelData {
  const tiles = solidGrid(HUB_W, HUB_H);
  const cx = Math.floor(HUB_W / 2); // 10
  const cy = Math.floor(HUB_H / 2); // 15
  // Wide enough that all three alcove/gate columns (cx-4, cx, cx+4) touch its
  // top and bottom walls directly — a branch that misses the plaza's own
  // width is a branch nothing can ever walk into.
  const plaza: Rect = { x: cx - 4, y: cy - 3, w: 9, h: 7 };
  fillRect(tiles, plaza);

  const start: Vec = { x: cx, y: cy };
  const home: Vec = { x: cx - 1, y: cy };

  const props: Prop[] = [
    { id: 'portal-home', pos: home, kind: 'portal-home', solid: true, art: 'portal-home' },
  ];

  // Three alcove branches off the plaza's north wall, one statue apiece —
  // which god lands in which alcove is shuffled per run (godOrder).
  const slotsX = [cx - 4, cx, cx + 4];
  const alcoveTopY = plaza.y - 5; // 4 tiles of corridor, then the statue's own tile
  data.godOrder.forEach((god, i) => {
    const x = slotsX[i];
    for (let y = plaza.y - 1; y >= alcoveTopY; y--) tiles[y][x] = Tile.Floor;
    const pos = { x, y: alcoveTopY };
    props.push({
      id: `statue:${god}`,
      pos,
      kind: `statue:${god}`,
      solid: true,
      art: `statue:${god}`,
      state: data.placed[god] ? 'lit' : undefined,
    });
  });

  // Three archway branches off the plaza's south wall, shuffled independently.
  const gateGods = rng.shuffle([...GODS]);
  const gateBottomY = plaza.y + plaza.h + 4;
  gateGods.forEach((god, i) => {
    const x = slotsX[i];
    // The gate's own tile is floor too: a solid prop on a wall tile is one a
    // drag can never aim at, and so never bump.
    for (let y = plaza.y + plaza.h; y <= gateBottomY; y++) tiles[y][x] = Tile.Floor;
    const pos = { x, y: gateBottomY };
    const kind = GATE_OF[god];
    props.push({ id: kind, pos, kind, solid: true, art: kind });
  });

  // Anything the hero is carrying survives the trip home, wherever it lands —
  // a symbol above all (so the statues can still see it), but also a realm's
  // own tools, so passing through the hub with one in hand never makes it
  // vanish from `ctx.carried()`.
  for (const id of [...Object.values(SYMBOL_OF), 'wax:beach', 'wax:island', 'obol', 'cake']) {
    const ghost = carriedGhost(hero, id);
    if (ghost) props.push(ghost);
  }

  const level = minimalLevel(0, runSeed, HUB_W, HUB_H, tiles, 'olympus', start, data);
  level.props = props;
  return level;
}

// ---------------------------------------------------------------------------
// Stage 1: The Sky Realm
// ---------------------------------------------------------------------------

const SKY_W = 21;
const SKY_H = 31;
/** Local maze lattice, pasted with a small vestibule above it for the gate. */
const SKY_MAZE_W = 19;
const SKY_MAZE_H = 27;
const SKY_OX = 1;
const SKY_OY = 2;
const SKY_MEADOWS = 4;

function buildSky(rng: Rng, runSeed: number, hero: Hero, data: GreeceData): LevelData {
  const tiles = solidGrid(SKY_W, SKY_H);
  const maze = carveMaze(SKY_MAZE_W, SKY_MAZE_H, rng);

  // A few open cloud meadows (3x3..5x5): only ever adds floor, so carving
  // these into the maze's own tiles first can never disconnect anything.
  const meadowCenters: Vec[] = [];
  let tries = 0;
  while (meadowCenters.length < SKY_MEADOWS && tries < 200) {
    tries++;
    const size = rng.int(3, 5);
    const x = rng.int(2, SKY_MAZE_W - 3 - size);
    const y = rng.int(2, SKY_MAZE_H - 3 - size);
    const rect: Rect = { x, y, w: size, h: size };
    if (meadowCenters.some((c) => Math.abs(c.x - (x + size / 2)) < 6 && Math.abs(c.y - (y + size / 2)) < 6)) continue;
    fillRect(maze, rect);
    meadowCenters.push(rectCenter(rect));
  }

  pasteFloor(tiles, maze, SKY_OX, SKY_OY);

  // The vestibule: a short stub straight up from the maze's own start cell,
  // dedicated to the gate so it never competes with the maze for start's
  // only way out.
  const start: Vec = { x: SKY_OX + 1, y: SKY_OY + 1 };
  const connector: Vec = { x: start.x, y: start.y - 1 };
  const gatePos: Vec = { x: start.x, y: start.y - 2 };
  tiles[connector.y][connector.x] = Tile.Floor;
  tiles[gatePos.y][gatePos.x] = Tile.Floor;

  const level = minimalLevel(1, runSeed, SKY_W, SKY_H, tiles, 'olympus', start, data);
  const props: Prop[] = [{ id: 'gate:hub', pos: gatePos, kind: 'gate:hub', solid: true, art: 'gate:hub' }];

  const ghost = carriedGhost(hero, 'symbol:bolt');
  if (ghost) {
    props.push(ghost);
  } else if (!data.placed.zeus) {
    const dist = bfsDistances(level, start);
    let far = start;
    let best = -1;
    for (const [k, d] of dist) {
      if (d > best) {
        best = d;
        const [x, y] = k.split(',').map(Number);
        far = { x, y };
      }
    }
    props.push({ id: 'symbol:bolt', pos: far, kind: 'symbol:bolt', solid: false, art: 'symbol:bolt', carriable: true });
  }

  // Medusa patrols a fixed route between the two farthest-apart meadows.
  let patrolPath: Vec[] = [start, connector];
  if (meadowCenters.length >= 2) {
    let a = meadowCenters[0];
    let b = meadowCenters[1];
    let bestLen = -1;
    for (let i = 0; i < meadowCenters.length; i++) {
      for (let j = i + 1; j < meadowCenters.length; j++) {
        const p = bfsPath(level, meadowCenters[i], meadowCenters[j]);
        if (p && p.length > bestLen) {
          bestLen = p.length;
          a = meadowCenters[i];
          b = meadowCenters[j];
        }
      }
    }
    const full = bfsPath(level, a, b);
    if (full && full.length) patrolPath = [a, ...full];
  }
  level.monsters.push(makeMedusa(hero.level, patrolPath));

  level.props = props;
  return level;
}

// ---------------------------------------------------------------------------
// Stage 2: The Wine-Dark Sea
// ---------------------------------------------------------------------------

const SEA_W = 25;
const SEA_H = 31;
const BEACH: Rect = { x: 2, y: 5, w: 7, h: 21 };
const PIER_DECK: Rect = { x: 9, y: 13, w: 4, h: 4 };
const ISLAND: Rect = { x: 19, y: 8, w: 5, h: 15 };
const ISLAND_DECK: Rect = { x: 15, y: 13, w: 4, h: 4 };
const SHIFT: Vec = { x: ISLAND_DECK.x - PIER_DECK.x, y: ISLAND_DECK.y - PIER_DECK.y };
const SIREN_ROWS = [7, 11, 20];
const SIREN_SPIT_LEN = 5; // tiles of "shallows" from the beach's edge to the rock
/**
 * The southern siren's rock also has shallows running east to the island,
 * so the trident's row is one long line of song from beach to island: the
 * trident cannot be reached, or carried off, without either the wax or
 * Poseidon's own goodwill (see `songImmune`).
 */
const TRIDENT_ROW = SIREN_ROWS[2];

function buildSea(rng: Rng, runSeed: number, hero: Hero, data: GreeceData): LevelData {
  const tiles = solidGrid(SEA_W, SEA_H);
  fillRect(tiles, BEACH);
  fillRect(tiles, data.ship === 'pier' ? PIER_DECK : ISLAND_DECK);
  fillRect(tiles, ISLAND);
  for (const row of SIREN_ROWS) {
    for (let x = BEACH.x + BEACH.w; x <= BEACH.x + BEACH.w + SIREN_SPIT_LEN; x++) tiles[row][x] = Tile.Floor;
  }
  for (let x = BEACH.x + BEACH.w + SIREN_SPIT_LEN + 1; x < ISLAND.x; x++) tiles[TRIDENT_ROW][x] = Tile.Floor;

  const start: Vec = { x: BEACH.x + 2, y: BEACH.y + BEACH.h - 3 };
  const gatePos: Vec = { x: BEACH.x + 2, y: BEACH.y + BEACH.h - 5 };
  const level = minimalLevel(2, runSeed, SEA_W, SEA_H, tiles, 'aegean', start, data);

  const props: Prop[] = [{ id: 'gate:hub', pos: gatePos, kind: 'gate:hub', solid: true, art: 'gate:hub' }];

  const helmPos = rectCenter(data.ship === 'pier' ? PIER_DECK : ISLAND_DECK);
  props.push({ id: 'helm', pos: helmPos, kind: 'helm', solid: true, art: 'helm' });

  const beachWaxPos = { x: BEACH.x + 1, y: BEACH.y + 2 };
  const beachWaxGhost = carriedGhost(hero, 'wax:beach');
  props.push(beachWaxGhost ?? { id: 'wax:beach', pos: beachWaxPos, kind: 'wax', solid: false, art: 'wax', carriable: true });

  const islandWaxPos = { x: ISLAND.x + 2, y: ISLAND.y + 2 };
  const islandWaxGhost = carriedGhost(hero, 'wax:island');
  props.push(islandWaxGhost ?? { id: 'wax:island', pos: islandWaxPos, kind: 'wax', solid: false, art: 'wax', carriable: true });

  const tridentPos = { x: ISLAND.x + 2, y: TRIDENT_ROW };
  const tridentGhost = carriedGhost(hero, 'symbol:trident');
  if (tridentGhost) props.push(tridentGhost);
  else if (!data.placed.poseidon) {
    props.push({ id: 'symbol:trident', pos: tridentPos, kind: 'symbol:trident', solid: false, art: 'symbol:trident', carriable: true });
  }

  for (const row of SIREN_ROWS) {
    const pos = { x: BEACH.x + BEACH.w + SIREN_SPIT_LEN, y: row };
    level.monsters.push(makeSiren(hero.level, pos, `siren:${row}`));
  }

  level.props = props;
  return level;
}

/** Moves the ship: old deck back to sea, new deck carved in, hero + deck cargo shifted with it. */
function sail(ctx: WorldCtx, data: GreeceData): void {
  const fromPier = data.ship === 'pier';
  const shift = fromPier ? SHIFT : { x: -SHIFT.x, y: -SHIFT.y };
  const oldRect = fromPier ? PIER_DECK : ISLAND_DECK;
  const newRect = fromPier ? ISLAND_DECK : PIER_DECK;

  ctx.freeze(900, 6);
  ctx.sfx('rumble');
  ctx.log(fromPier ? 'The ship sails out for the island.' : 'The ship sails back for the mainland.');

  for (const p of ctx.level.props ?? []) {
    if (p.hidden) continue;
    if (inRectLocal(oldRect, p.pos)) p.pos = { x: p.pos.x + shift.x, y: p.pos.y + shift.y };
  }
  ctx.hero.pos = { x: ctx.hero.pos.x + shift.x, y: ctx.hero.pos.y + shift.y };
  ctx.hero.rpos = { ...ctx.hero.pos };

  for (let y = oldRect.y; y < oldRect.y + oldRect.h; y++) {
    for (let x = oldRect.x; x < oldRect.x + oldRect.w; x++) ctx.level.tiles[y][x] = Tile.Wall;
  }
  for (let y = newRect.y; y < newRect.y + newRect.h; y++) {
    for (let x = newRect.x; x < newRect.x + newRect.w; x++) ctx.level.tiles[y][x] = Tile.Floor;
  }
  data.ship = fromPier ? 'island' : 'pier';
  ctx.rebuild();
}

// ---------------------------------------------------------------------------
// Stage 3: The Underworld
// ---------------------------------------------------------------------------

const HADES_W = 21;
const HADES_H = 39;
const NEAR: Rect = { x: 2, y: 2, w: 17, h: 8 };
const OBOL_ALCOVE: Rect = { x: 14, y: 4, w: 4, h: 4 };
const RIVER_Y0 = 11;
const RIVER_Y1 = 13;
// Runs down to meet the corridor's own row 24 directly (no gap tile needed).
const FAR: Rect = { x: 2, y: 14, w: 17, h: 10 };
// Both landings sit on ground that is already part of its own bank (never a
// pocket the ferry prop alone would seal off): the far one is just inside
// FAR's own top row, the near one is beside — not behind — the near ferry.
const NEAR_LANDING: Vec = { x: 11, y: NEAR.y + NEAR.h - 1 };
const FAR_LANDING: Vec = { x: 10, y: FAR.y };
const BRAZIER_ROOM: Rect = { x: 13, y: 16, w: 5, h: 6 };
// The niche hangs off the far bank's bottom edge by a single tile of neck,
// and the seal stands in that neck: nothing reaches the cake around it.
const NICHE: Rect = { x: 13, y: 25, w: 5, h: 3 };
const SEAL_POS: Vec = { x: 15, y: 24 };
const CORRIDOR_X = [9, 10];
const CORRIDOR_Y0 = 24;
const CORRIDOR_Y1 = 33;
const HELM_ROOM: Rect = { x: 8, y: 34, w: 5, h: 3 };
const CERBERUS_Y = 29;
const CERBERUS_LANE = CORRIDOR_X[0];
const OPEN_LANE = CORRIDOR_X[1];
const FEED_TILE: Vec = { x: CERBERUS_LANE, y: CERBERUS_Y - 1 };

function buildUnderworld(rng: Rng, runSeed: number, hero: Hero, data: GreeceData): LevelData {
  const tiles = solidGrid(HADES_W, HADES_H);
  fillRect(tiles, NEAR);
  fillRect(tiles, OBOL_ALCOVE);
  fillRect(tiles, FAR);
  fillRect(tiles, BRAZIER_ROOM);
  fillRect(tiles, NICHE);
  for (const x of CORRIDOR_X) for (let y = CORRIDOR_Y0; y <= CORRIDOR_Y1; y++) tiles[y][x] = Tile.Floor;
  fillRect(tiles, HELM_ROOM);
  // The one corridor tile between the brazier room and its niche: the seal.
  // Left solid (blocking) until the braziers are lit in order; the tile
  // itself stays floor, so hidden-when-open is exactly "walk through".
  tiles[SEAL_POS.y][SEAL_POS.x] = Tile.Floor;
  tiles[NEAR_LANDING.y][NEAR_LANDING.x] = Tile.Floor;
  tiles[FAR_LANDING.y][FAR_LANDING.x] = Tile.Floor;

  const start: Vec = { x: 4, y: 4 };
  const gatePos: Vec = { x: 4, y: 6 };
  const level = minimalLevel(3, runSeed, HADES_W, HADES_H, tiles, 'styx', start, data);
  const props: Prop[] = [{ id: 'gate:hub', pos: gatePos, kind: 'gate:hub', solid: true, art: 'gate:hub' }];

  props.push({ id: 'ferry:near', pos: { x: 10, y: NEAR.y + NEAR.h - 1 }, kind: 'ferry:near', solid: true, art: 'ferry' });
  props.push({ id: 'ferry:far', pos: { x: 10, y: FAR.y }, kind: 'ferry:far', solid: true, art: 'ferry' });

  const obolGhost = carriedGhost(hero, 'obol');
  if (obolGhost) props.push(obolGhost);
  else props.push({ id: 'obol', pos: { x: OBOL_ALCOVE.x + 1, y: OBOL_ALCOVE.y + 1 }, kind: 'obol', solid: false, art: 'obol', carriable: true });
  level.monsters.push(makeShade(hero.level, { x: OBOL_ALCOVE.x + 2, y: OBOL_ALCOVE.y + 2 }));

  // Three braziers, carved 1/2/3, the order shuffled onto the three fixed
  // spots each run — the pips on each are what tell the order, not memory.
  const brazierSpots: Vec[] = [
    { x: BRAZIER_ROOM.x + 1, y: BRAZIER_ROOM.y + 1 },
    { x: BRAZIER_ROOM.x + 3, y: BRAZIER_ROOM.y + 1 },
    { x: BRAZIER_ROOM.x + 2, y: BRAZIER_ROOM.y + 4 },
  ];
  const orders = rng.shuffle([1, 2, 3]);
  brazierSpots.forEach((pos, i) => {
    props.push({
      id: `brazier:${i}`,
      pos,
      kind: 'brazier',
      solid: false,
      // The order is carved on the rim: the art carries its own pips.
      art: `brazier:${orders[i]}`,
      state: data.sealOpen ? 'lit' : undefined,
      data: { order: orders[i] },
    });
  });
  props.push({ id: 'seal', pos: SEAL_POS, kind: 'seal', solid: true, art: 'seal', hidden: data.sealOpen });

  const cakeGhost = carriedGhost(hero, 'cake');
  if (cakeGhost) props.push(cakeGhost);
  else if (!data.cerberusAsleep) {
    props.push({ id: 'cake', pos: { x: NICHE.x + 2, y: NICHE.y + 1 }, kind: 'cake', solid: false, art: 'cake', carriable: true });
  }

  const helmGhost = carriedGhost(hero, 'symbol:helm');
  if (helmGhost) props.push(helmGhost);
  else if (!data.placed.hades) {
    props.push({
      id: 'symbol:helm',
      pos: { x: HELM_ROOM.x + 2, y: HELM_ROOM.y + 1 },
      kind: 'symbol:helm',
      solid: false,
      art: 'symbol:helm',
      carriable: true,
    });
  }

  level.monsters.push(makeCerberus(hero.level, { x: CERBERUS_LANE, y: CERBERUS_Y }, data.cerberusAsleep));

  level.props = props;
  return level;
}

// ---------------------------------------------------------------------------
// The world's own monsters
// ---------------------------------------------------------------------------

function baseMonster(kind: Monster['kind'], name: string, glyph: string, level: number, pos: Vec, id: string): Monster {
  return {
    id,
    kind,
    name,
    glyph,
    pos: { ...pos },
    rpos: { ...pos },
    home: { ...pos },
    hp: 1,
    maxHp: 1,
    atk: 0,
    def: 0,
    level,
    xp: 0,
    gold: 0,
    moveInterval: 100000,
    moveCooldown: 0,
    attackInterval: 800,
    attackCooldown: 0,
    state: 'idle',
    sightRange: 6,
    leash: 999,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    frozenMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
}

function makeMedusa(heroLevel: number, patrolPath: Vec[]): Monster {
  const m = baseMonster('medusa', 'Medusa', '🐍', heroLevel, patrolPath[0], 'medusa');
  m.hp = m.maxHp = Math.round(levelCurve(HERO_HP_BASE, heroLevel) * 1.1);
  m.atk = 0; // her weapon is the gaze, not the hand — see `fights`
  m.def = 0;
  m.moveInterval = 700;
  // A hazard, not a kill: the hero never auto-engages her (which would mean
  // turning to face her), and a swing at her says "Immune".
  m.invulnerable = true;
  m.xp = 0;
  m.gold = 0;
  m.patrolPath = patrolPath;
  m.patrolIndex = 0;
  m.patrolDir = 1;
  return m;
}

function makeSiren(heroLevel: number, pos: Vec, id: string): Monster {
  const m = baseMonster('siren', 'Siren', '🧜', heroLevel, pos, id);
  m.hp = m.maxHp = Math.round(levelCurve(HERO_HP_BASE, heroLevel) * 0.8);
  m.atk = 0;
  m.invulnerable = true; // her rock is the only place she can be reached, and the song rules there
  m.xp = 0;
  return m;
}

function makeShade(heroLevel: number, pos: Vec): Monster {
  const m = baseMonster('shade', 'Shade', '👻', heroLevel, pos, 'shade');
  m.hp = m.maxHp = Math.round(levelCurve(HERO_HP_BASE, heroLevel) * 1.0);
  m.atk = Math.round(levelCurve(HERO_ATK_BASE, heroLevel) * 1.1);
  m.def = 0;
  m.moveInterval = 400;
  m.sightRange = 7;
  m.xp = 14 + 4 * heroLevel;
  m.gold = 5 + heroLevel;
  return m;
}

function makeCerberus(heroLevel: number, pos: Vec, asleep: boolean): Monster {
  const m = baseMonster('cerberus', 'Cerberus', '🐕', heroLevel, pos, 'cerberus');
  m.hp = m.maxHp = Math.round(levelCurve(HERO_HP_BASE, heroLevel) * 1.6);
  m.atk = Math.round(levelCurve(HERO_ATK_BASE, heroLevel) * 2.5);
  m.def = Math.round(levelCurve(HERO_ATK_BASE, heroLevel) * 0.3);
  m.invulnerable = true; // a gate, not a kill: the cake is the only way past
  m.xp = 0;
  return m;
}

// ---------------------------------------------------------------------------
// Line-of-sight / facing helpers (Medusa's gaze)
// ---------------------------------------------------------------------------

/** Same row or column, with every tile strictly between them open floor. */
function lineClear(level: LevelData, a: Vec, b: Vec): boolean {
  if (a.x === b.x) {
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    for (let y = lo; y <= hi; y++) if (!isFloor(level, { x: a.x, y })) return false;
    return true;
  }
  if (a.y === b.y) {
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    for (let x = lo; x <= hi; x++) if (!isFloor(level, { x, y: a.y })) return false;
    return true;
  }
  return false;
}

function facingToward(hero: Hero, target: Vec): boolean {
  const dir: Dir | null =
    hero.pos.x === target.x
      ? target.y < hero.pos.y
        ? 'N'
        : target.y > hero.pos.y
          ? 'S'
          : null
      : hero.pos.y === target.y
        ? target.x > hero.pos.x
          ? 'E'
          : target.x < hero.pos.x
            ? 'W'
            : null
        : null;
  return dir !== null && hero.facing === dir;
}

const MEDUSA_RANGE = 6;
const MEDUSA_GAZE_MS = 900;
/** Halfway to stone, the hero gets a word of warning over their head. */
const MEDUSA_WARN_MS = 450;
const SIREN_RANGE = 8;
/** The song's beat: a hero standing in a line is caught on the next one. */
const SIREN_BEAT_MS = 1500;
/** Once caught, the pulls come quicker: the rock is a few seconds off, not a slow crawl. */
const SIREN_CAUGHT_BEAT_MS = 700;
/** While a siren has the hero, their feet are not their own: renewed every tick. */
const SIREN_HOLD_MS = 250;

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function stageData(ctx: WorldCtx): GreeceData {
  return ctx.world.data as unknown as GreeceData;
}

export const GREECE: WorldModule = {
  kind: 'minotaur',
  name: 'Olympus',

  collectible: {
    id: 'olive-crown',
    name: 'The Olive Crown',
    description: 'A crown of gold olive leaves, from the table of the gods.',
  },

  generate(stage, runSeed, hero, dataIn) {
    const rng = makeRng(hashSeed(runSeed, stage, SALT));
    const data = readData(dataIn, rng);
    switch (stage) {
      case 1:
        return buildSky(rng, runSeed, hero, data);
      case 2:
        return buildSea(rng, runSeed, hero, data);
      case 3:
        return buildUnderworld(rng, runSeed, hero, data);
      default:
        return buildHub(rng, runSeed, hero, data);
    }
  },

  intro(stage, dataIn) {
    switch (stage) {
      case 1:
        return {
          title: 'The Sky Realm',
          lines: [
            'Winding paths of cloud, over open sky.',
            "Medusa walks a beat through the meadows. Never look at her: turn your back or break the line.",
            'Cloud walls block her gaze as well as your feet.',
            "Zeus's thunderbolt waits at the far end.",
            'The archway behind you always leads back to the gate.',
          ],
        };
      case 2:
        return {
          title: 'The Wine-Dark Sea',
          lines: [
            'A beach, a ship at its pier, and open sea beyond.',
            'The sirens sing down straight lines. Linger in one and the song takes hold and drags you to the rocks.',
            'Beeswax in your ears stops it cold, but it fills both hands.',
            'Bump the helm to sail.',
            'The gate on the beach always leads back to the gate.',
          ],
        };
      case 3:
        return {
          title: 'The Underworld',
          lines: [
            'Flagstone caverns, and the black water of the Styx.',
            'Charon poles the ferry across the Styx — but he wants payment first.',
            'Cerberus guards the corridor beyond, wide awake and very strong.',
            'Three braziers stand behind a sealed door, rims carved with something.',
            'Charon poles you back across for nothing; nobody stays on that shore.',
          ],
        };
      default: {
        const done = placedCount(dataIn);
        return {
          title: 'The Gate of Olympus',
          lines: [
            'Three gods keep this gate: Zeus, Poseidon, Hades.',
            "Each realm holds one god's symbol of power. Carry it home to the matching statue.",
            'The wrong statue wants nothing to do with a stranger\'s offering.',
            done > 0 ? `${done} of 3 statues stand lit.` : 'Step through an archway to begin.',
            'The portal home is always open.',
          ],
        };
      }
    }
  },

  defeat(stage, cause) {
    if (cause === 'petrified') return "Medusa's gaze found you. You stand in the clouds still, a statue of a hero.";
    if (cause === 'sirens') return 'The song took you onto the rocks.';
    switch (stage) {
      case 1:
        return 'The clouds gave way beneath you.';
      case 2:
        return 'The sea took you under.';
      case 3:
        return 'Cerberus was not asleep.';
      default:
        return 'The gods turned their backs on you.';
    }
  },

  tick(ctx, dt) {
    const data = stageData(ctx);
    const stage = ctx.world.stage;
    if (stage === 1) tickMedusa(ctx, dt, data);
    if (stage === 2) tickSirens(ctx, dt, data);
  },

  onEnter(ctx, tile) {
    const data = stageData(ctx);
    const stage = ctx.world.stage;

    if (stage === 2) {
      const trident = (ctx.level.props ?? []).find((p) => p.kind === 'symbol:trident' && !p.hidden && eq(p.pos, tile));
      const held = ctx.carried();
      if (trident && held && held.kind === 'wax') {
        ctx.setDown(tile);
        ctx.pickUp(trident);
        ctx.log('You set the wax down to take the trident.');
      }
    }

    if (stage === 3) {
      const brazier = (ctx.level.props ?? []).find((p) => p.kind === 'brazier' && eq(p.pos, tile));
      if (brazier && !data.sealOpen) handleBrazier(ctx, data, brazier);

      if (eq(tile, FEED_TILE)) {
        const held = ctx.carried();
        if (held && held.kind === 'cake' && !data.cerberusAsleep) {
          ctx.setDown(tile);
          data.cerberusAsleep = true;
          const cerberus = ctx.level.monsters.find((m) => m.kind === 'cerberus');
          if (cerberus) ctx.flash(cerberus.pos, '#ffdd88');
          ctx.log('Cerberus noses the honey-cake, sighs, and sleeps.');
        }
      }
    }
  },

  onBump(ctx, prop) {
    const data = stageData(ctx);

    if (prop.kind === 'portal-home') {
      ctx.returnHome();
      return;
    }
    if (prop.kind === 'gate:hub') {
      ctx.goto(0);
      return;
    }
    if (prop.kind === 'gate:sky') {
      ctx.goto(1);
      return;
    }
    if (prop.kind === 'gate:sea') {
      ctx.goto(2);
      return;
    }
    if (prop.kind === 'gate:underworld') {
      ctx.goto(3);
      return;
    }
    if (prop.kind.startsWith('statue:')) {
      bumpStatue(ctx, data, prop);
      return;
    }
    if (prop.kind === 'helm') {
      sail(ctx, data);
      return;
    }
    if (prop.kind === 'ferry:near') {
      const held = ctx.carried();
      if (held && held.kind === 'obol') {
        ctx.consume(held);
        ctx.freeze(700, 4);
        ctx.hero.pos = { ...FAR_LANDING };
        ctx.hero.rpos = { ...FAR_LANDING };
        ctx.sfx('rumble');
        ctx.log('Charon poles you across the Styx.');
      } else {
        ctx.log('Charon wants his coin. You have no obol.');
      }
      return;
    }
    if (prop.kind === 'ferry:far') {
      ctx.freeze(700, 4);
      ctx.hero.pos = { ...NEAR_LANDING };
      ctx.hero.rpos = { ...NEAR_LANDING };
      ctx.sfx('rumble');
      ctx.log('Charon takes you back for nothing; nobody stays.');
      return;
    }
  },

  step(ctx, m) {
    if (m.kind === 'medusa') return stepPatrol(m);
    if (m.kind === 'shade') return stepShade(ctx, m);
    return null; // siren and cerberus never move
  },

  fights(ctx, m) {
    if (m.kind === 'medusa' || m.kind === 'siren') return false;
    if (m.kind === 'cerberus') return !stageData(ctx).cerberusAsleep;
    return true; // shade, and anything else, fights normally
  },
};

function bumpStatue(ctx: WorldCtx, data: GreeceData, prop: Prop): void {
  const god = prop.kind.slice('statue:'.length) as God;
  const held = ctx.carried();
  if (held && held.kind === SYMBOL_OF[god]) {
    ctx.consume(held);
    prop.state = 'lit';
    data.placed[god] = true;
    ctx.ring(prop.pos, 2, GOD_COLOR[god], 500);
    ctx.flash(prop.pos, GOD_COLOR[god]);
    ctx.sfx('altar');
    ctx.log(`${GOD_NAME[god]} accepts the ${SYMBOL_NOUN[held.kind]}. The statue burns bright.`);
    if (allPlaced(data)) ctx.finish();
  } else if (held) {
    const noun = SYMBOL_NOUN[held.kind] ?? 'trinket';
    ctx.log(`${GOD_NAME[god]} has no use for a ${noun}.`);
  } else {
    ctx.log(`${GOD_NAME[god]} waits for an offering.`);
  }
}

function handleBrazier(ctx: WorldCtx, data: GreeceData, brazier: Prop): void {
  if (brazier.state === 'lit') return; // already lit; a harmless revisit
  const order = (brazier.data as { order: number } | undefined)?.order ?? 0;
  const expected = data.brazierProgress + 1;
  if (order === expected) {
    brazier.state = 'lit';
    data.brazierProgress = expected;
    ctx.sfx('rune');
    ctx.log(`Brazier ${expected} catches light.`);
    if (expected === 3) {
      data.sealOpen = true;
      const seal = (ctx.level.props ?? []).find((p) => p.kind === 'seal');
      if (seal) seal.hidden = true;
      ctx.flash(seal?.pos ?? brazier.pos, '#ffd700');
      ctx.sfx('seal');
      ctx.log('The seal slides open.');
    }
  } else {
    data.brazierProgress = 0;
    for (const p of ctx.level.props ?? []) if (p.kind === 'brazier') p.state = undefined;
    ctx.flash(brazier.pos, '#ff4444');
    ctx.sfx('runeFail');
    ctx.log('The braziers gutter out. Wrong order.');
  }
}

function tickMedusa(ctx: WorldCtx, dt: number, data: GreeceData): void {
  const medusa = ctx.level.monsters.find((m) => m.kind === 'medusa');
  if (!medusa) return;
  const inLine = manhattan(ctx.hero.pos, medusa.pos) <= MEDUSA_RANGE && lineClear(ctx.level, ctx.hero.pos, medusa.pos);
  const gazing = inLine && facingToward(ctx.hero, medusa.pos);
  if (gazing) {
    const wasZero = data.gazeMs <= 0;
    data.gazeMs += dt;
    if (wasZero) {
      ctx.ring(ctx.hero.pos, 3, '#e5484d', 500);
      ctx.sfx('gaze');
    }
    if (data.gazeMs - dt < MEDUSA_WARN_MS && data.gazeMs >= MEDUSA_WARN_MS) {
      ctx.text(ctx.hero.pos, 'Look away!', '#e5484d', 600);
      ctx.flash(ctx.hero.pos, '#9a9aa4', 400);
    }
    if (data.gazeMs >= MEDUSA_GAZE_MS) ctx.gameOver('petrified');
  } else {
    data.gazeMs = 0;
  }
}

/** Wax in the ears, or the sea-god's own trident in hand: the song is nothing. */
function songImmune(ctx: WorldCtx): boolean {
  const held = ctx.carried();
  return !!held && (held.kind === 'wax' || held.kind === 'symbol:trident');
}

/** The sirens whose song reaches the hero: same row or column, open water or shallows all the way, in range. */
function singingAt(ctx: WorldCtx): Monster[] {
  return ctx.level.monsters.filter((s) => {
    if (s.kind !== 'siren') return false;
    const d = manhattan(ctx.hero.pos, s.pos);
    return d > 0 && d <= SIREN_RANGE && lineClear(ctx.level, ctx.hero.pos, s.pos);
  });
}

function tickSirens(ctx: WorldCtx, dt: number, data: GreeceData): void {
  const sirens = songImmune(ctx) ? [] : singingAt(ctx);
  if (!sirens.length) data.songHeld = false;
  // Caught: while a siren has the hero, they cannot walk out of the line
  // themselves. The pull is the only thing that moves them, and it only
  // ever moves them toward the rock. A hero merely crossing a line between
  // beats is not caught; one who lingers is caught on the next beat.
  if (data.songHeld) {
    ctx.hero.stun = Math.max(ctx.hero.stun, SIREN_HOLD_MS);
    if (ctx.state.path) ctx.state.path.length = 0;
  }

  data.songMs += dt;
  const beat = data.songHeld ? SIREN_CAUGHT_BEAT_MS : SIREN_BEAT_MS;
  if (data.songMs < beat) return;
  data.songMs -= beat;
  if (sirens.length && !data.songHeld) {
    data.songHeld = true;
    ctx.ring(ctx.hero.pos, 2, '#8fd8ff', 500);
    ctx.text(ctx.hero.pos, 'the song...', '#8fd8ff', 900);
    ctx.hero.stun = Math.max(ctx.hero.stun, SIREN_HOLD_MS);
    if (ctx.state.path) ctx.state.path.length = 0;
  }
  for (const s of sirens) {
    const dx = Math.sign(s.pos.x - ctx.hero.pos.x);
    const dy = Math.sign(s.pos.y - ctx.hero.pos.y);
    const next = { x: ctx.hero.pos.x + dx, y: ctx.hero.pos.y + dy };
    if (!isFloor(ctx.level, next)) continue;
    ctx.hero.pos = next;
    ctx.hero.rpos = { ...next };
    ctx.sfx('song');
    ctx.log('The song pulls you a step toward the rocks.');
    if (manhattan(next, s.pos) <= 1) {
      ctx.gameOver('sirens');
      return;
    }
  }
}

function stepPatrol(m: Monster): Vec | null {
  const path = m.patrolPath;
  if (!path || path.length < 2) return null;
  let idx = m.patrolIndex ?? 0;
  let dir: 1 | -1 = m.patrolDir ?? 1;
  let next = idx + dir;
  if (next < 0 || next >= path.length) {
    dir = (-dir) as 1 | -1;
    next = idx + dir;
  }
  if (next < 0 || next >= path.length) return null;
  m.patrolIndex = next;
  m.patrolDir = dir;
  return path[next];
}

function stepShade(ctx: WorldCtx, m: Monster): Vec | null {
  const dist = manhattan(ctx.hero.pos, m.pos);
  if (dist > m.sightRange) return null;
  const path = bfsPath(ctx.level, m.pos, ctx.hero.pos, { maxLen: m.sightRange + 1 });
  if (!path || !path.length) return null;
  const next = path[0];
  if (eq(next, ctx.hero.pos)) return null; // adjacent already: fight, don't step onto the hero
  return next;
}

// Re-exported for the test file, which builds hand-picked stage data directly
// rather than driving the whole generate() pipeline every time.
export const __internal = {
  readData,
  freshData,
  allPlaced,
  lineClear,
  facingToward,
  MEDUSA_RANGE,
  MEDUSA_GAZE_MS,
  SIREN_RANGE,
  SIREN_BEAT_MS,
  PIER_DECK,
  ISLAND_DECK,
  SHIFT,
  FEED_TILE,
};
