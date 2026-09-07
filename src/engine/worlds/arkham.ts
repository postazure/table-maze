/**
 * Boston, after dark: the necromancer's world.
 *
 * A grid of streets between city blocks. Nine to twelve houses stand at the
 * blocks' edges; a tablet is hidden in exactly one of them, and notes found
 * in the others narrow down which one before a ritual clock runs out.
 * Cultists patrol the avenues; killing one buys the hero more time. Bring
 * the tablet to the chalk circle in the square by the church to win.
 *
 * One stage: the design is dense and readable rather than a sprawl of
 * floors (see world.ts — a world need not have more than one).
 *
 * The street grid itself (which tiles are block or avenue) is fixed: only
 * what fills it — house colours, the tablet's house, the cultists' beats —
 * comes from `runSeed`. `generate` is a pure function of its four
 * arguments, so the same run always sees the same downtown.
 */
import type { Hero, LevelData, Monster, Prop, Vec, WorldData } from '../types';
import { Tile, eq, key } from '../types';
import { hashSeed, makeRng } from '../rng';
import { bfsPath, isFloor } from '../pathfind';
import { HERO_ATK_BASE, HERO_HP_BASE, levelCurve } from '../balance';
import type { WorldCtx, WorldModule } from './world';

/** Salts this module's rng away from every other seeded stream in the run. */
const SALT = 7391;

type DoorColor = 'red' | 'blue' | 'green';
const DOOR_COLORS: readonly DoorColor[] = ['red', 'blue', 'green'];

interface HouseInfo {
  id: string;
  pos: Vec; // the solid tile the house's prop sits on
  doorTile: Vec; // the free tile in front of it, one step further into the avenue
  color: DoorColor;
  corner: boolean; // at the end of its block's edge, near a crossing, vs centred on it
  side: 'north' | 'south'; // of the church
}

/**
 * Everything this module keeps between calls, JSON-serialisable and carried
 * in `WorldData.data`. The index signature is what lets it stand in for
 * `WorldData['data']` (`Record<string, unknown>`) without a cast at every
 * read; the named fields below are what the module itself actually uses.
 */
interface ArkhamData {
  [key: string]: unknown;
  houses: HouseInfo[];
  tabletHouseId: string;
  /**
   * The three clues, in the order the notes hand them out: one per wrong
   * house searched, until all three are out. Any wrong house will do — the
   * puzzle is "three notes name the house", not "find the three houses that
   * happen to hold a note".
   */
  clueTexts: string[];
  /** The same three, short enough to float over the house for a moment. */
  clueShorts: string[];
  /** How many of `clueTexts` the hero has read so far. */
  cluesGiven: number;
  /** Every house searched so far, tablet's or not (drives "already searched"). */
  searchedHouseIds: string[];
  tabletFound: boolean;
  ritualMs: number;
  warned60: boolean;
  warned20: boolean;
  /** Milliseconds since the church last pulsed; wraps at 10s. */
  pulseAcc: number;
  /** Live cultist count as of the last tick, so a kill between ticks is caught. */
  lastAlive: number;
  churchPos: Vec;
  /** The chalk circle has been visited once without the tablet; flavour only. */
  sawCircle: boolean;
}

// ---------------------------------------------------------------------------
// The street grid: fixed rectangles, never randomised. Three block columns,
// five block rows — the middle row is the church's square, rows 0-1 are
// "north" of it, rows 3-4 "south". Blocks touch the outer wall directly;
// the gaps between them are 2-wide avenues, so the whole floor is one
// connected mesh of streets by construction (see `buildTiles`).
// ---------------------------------------------------------------------------

const BLOCK_X: ReadonlyArray<readonly [number, number]> = [
  [1, 7],
  [10, 16],
  [19, 25],
];
const BLOCK_Y: ReadonlyArray<readonly [number, number]> = [
  [1, 5],
  [8, 12],
  [15, 19],
  [22, 26],
  [29, 33],
];
const WIDTH = 27;
const HEIGHT = 35;
const CHURCH_COL = 1;
const CHURCH_ROW = 2;
const NORTH_ROWS = [0, 1] as const;
const SOUTH_ROWS = [3, 4] as const;

function buildTiles(): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < HEIGHT; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < WIDTH; x++) {
      let wall = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
      if (!wall) {
        const inBlockX = BLOCK_X.some(([x0, x1]) => x >= x0 && x <= x1);
        const inBlockY = BLOCK_Y.some(([y0, y1]) => y >= y0 && y <= y1);
        wall = inBlockX && inBlockY;
      }
      row.push(wall ? Tile.Wall : Tile.Floor);
    }
    tiles.push(row);
  }
  // The church's block is a plaza, not a building: carve it back to floor.
  const [cx0, cx1] = BLOCK_X[CHURCH_COL];
  const [cy0, cy1] = BLOCK_Y[CHURCH_ROW];
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) tiles[y][x] = Tile.Floor;
  return tiles;
}

/** A minimal object `bfsPath`/`isFloor` (pathfind.ts) can read: they only touch these three fields. */
function gridOnly(tiles: Tile[][]): LevelData {
  return { width: WIDTH, height: HEIGHT, tiles } as LevelData;
}

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------

/**
 * Every (side, color, corner) triple is assigned to at most one house: per
 * side there are exactly six slots (two rows times three columns) and six
 * combinations (three colours times corner/not), so slicing a shuffled list
 * of each down to the side's house count and pairing them off never repeats
 * a combination. That is the whole puzzle guarantee — the three attributes
 * together always narrow every house down to one, not just usually.
 */
function placeHouses(rng: ReturnType<typeof makeRng>, tiles: Tile[][], props: Prop[]): HouseInfo[] {
  const houses: HouseInfo[] = [];
  let seq = 0;

  const combosOf = (): Array<{ color: DoorColor; corner: boolean }> => {
    const out: Array<{ color: DoorColor; corner: boolean }> = [];
    for (const color of DOOR_COLORS) for (const corner of [true, false]) out.push({ color, corner });
    return out;
  };

  const place = (side: 'north' | 'south', row: number, col: number, color: DoorColor, corner: boolean): void => {
    const [bx0] = BLOCK_X[col];
    const [by0, by1] = BLOCK_Y[row];
    const xOff = corner ? rng.pick([1, 5]) : 3;
    const x = bx0 + xOff;
    const y = side === 'north' ? by1 + 1 : by0 - 1;
    const doorY = side === 'north' ? by1 + 2 : by0 - 2;
    const id = `house-${seq++}`;
    const info: HouseInfo = { id, pos: { x, y }, doorTile: { x, y: doorY }, color, corner, side };
    houses.push(info);
    // Half the un-searched houses start with a lit window, purely for
    // variety at night — `state` 'lit' has no art of its own (propArt falls
    // back to the base 'house-<color>' entry), only 'searched' changes how
    // a house is drawn.
    props.push({ id, pos: info.pos, kind: 'house', solid: true, art: `house-${color}`, state: rng.chance(0.5) ? 'lit' : 'dark' });
  };

  const buildSide = (side: 'north' | 'south', rows: readonly number[], count: number): void => {
    const slots: Array<{ row: number; col: number }> = [];
    for (const row of rows) for (let col = 0; col < 3; col++) slots.push({ row, col });
    rng.shuffle(slots);
    const combos = rng.shuffle(combosOf()).slice(0, count);
    for (let i = 0; i < count; i++) place(side, slots[i].row, slots[i].col, combos[i].color, combos[i].corner);
  };

  // Total in [9, 12]; split so neither side ever needs more than its six
  // available (slot, combo) pairs.
  const total = rng.int(9, 12);
  const north = rng.int(Math.max(3, total - 6), Math.min(6, total - 3));
  const south = total - north;
  buildSide('north', NORTH_ROWS, north);
  buildSide('south', SOUTH_ROWS, south);
  return houses;
}

/** The plain, deducible sentence for each of the tablet house's three attributes, with a short form for the screen. */
function clueSentences(house: HouseInfo): Array<{ text: string; short: string }> {
  return [
    {
      text: house.side === 'north' ? 'The tablet is north of the church.' : 'The tablet is south of the church.',
      short: house.side === 'north' ? 'North of the church' : 'South of the church',
    },
    {
      text: house.corner ? 'It is on a corner.' : 'It is not on a corner: a mid-block house.',
      short: house.corner ? 'A corner house' : 'A mid-block house',
    },
    { text: `Look for a ${house.color} door.`, short: `A ${house.color} door` },
  ];
}

// ---------------------------------------------------------------------------
// Cultists
// ---------------------------------------------------------------------------

const CULTIST_HP_MULT = 0.5; // a little under a maze patrol's 0.6
const CULTIST_ATK_MULT = 0.45; // a little under a maze patrol's 0.55
const PRIEST_HP_MULT = 0.75;
const PRIEST_ATK_MULT = 0.65;
const PRIEST_LEVELS_OVER = 2;

function makeCultist(id: string, path: Vec[], heroLevel: number, priest: boolean): Monster {
  const level = Math.max(1, Math.floor(heroLevel)) + (priest ? PRIEST_LEVELS_OVER : 0);
  const hp = Math.max(1, Math.round(levelCurve(HERO_HP_BASE, level) * (priest ? PRIEST_HP_MULT : CULTIST_HP_MULT)));
  const atk = Math.max(1, Math.round(levelCurve(HERO_ATK_BASE, level) * (priest ? PRIEST_ATK_MULT : CULTIST_ATK_MULT)));
  const pos = path[0];
  return {
    id,
    kind: 'cultist',
    name: 'Cultist',
    glyph: '🕯️',
    pos: { ...pos },
    rpos: { ...pos },
    home: { ...pos },
    hp,
    maxHp: hp,
    atk,
    def: 0,
    level,
    xp: 4 + 2 * level,
    gold: 0, // knives, nothing worth taking
    moveInterval: priest ? 600 : 450,
    moveCooldown: 0,
    attackInterval: 800,
    attackCooldown: 0,
    state: 'idle',
    patrolPath: path,
    patrolIndex: 0,
    patrolDir: 1,
    sightRange: 3,
    leash: 0,
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

/** A back-and-forth beat from `from` to some other avenue tile, avoiding solid props. */
function patrolFrom(
  rng: ReturnType<typeof makeRng>,
  grid: LevelData,
  from: Vec,
  avenueTiles: readonly Vec[],
  blocked: ReadonlySet<string>,
  minLen: number,
): Vec[] {
  for (let attempt = 0; attempt < 8; attempt++) {
    const to = rng.pick(avenueTiles);
    if (eq(to, from)) continue;
    const path = bfsPath(grid, from, to, { blocked: (p) => blocked.has(key(p)) });
    if (path && path.length >= minLen) return [from, ...path];
  }
  return [from]; // pathological fallback: stands still rather than generate() ever throwing
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

function generate(stage: number, runSeed: number, hero: Hero, data: WorldData['data'] | null): LevelData {
  const rng = makeRng(hashSeed(runSeed, stage, SALT));
  const tiles = buildTiles();
  const props: Prop[] = [];
  const monsters: Monster[] = [];

  const [cx0, cx1] = BLOCK_X[CHURCH_COL];
  const [cy0] = BLOCK_Y[CHURCH_ROW];
  const churchPos: Vec = { x: cx0 + 3, y: cy0 + 2 };
  const circlePos: Vec = { x: cx0 + 3, y: cy0 };
  props.push({ id: 'church', pos: churchPos, kind: 'church', solid: true, art: 'church' });
  props.push({ id: 'circle', pos: circlePos, kind: 'circle', solid: false, art: 'circle', state: 'chalk' });

  const houses = placeHouses(rng, tiles, props);
  const tabletHouse = rng.pick(houses);
  const tabletPos = { ...tabletHouse.doorTile };
  const clues = rng.shuffle(clueSentences(tabletHouse));

  const startPos: Vec = { x: 9, y: 1 };
  const portalPos: Vec = { x: 8, y: 1 };
  props.push({ id: 'home', pos: portalPos, kind: 'portal-home', solid: true, art: 'portal-home' });

  const AVENUE_X = [8, 9, 17, 18];
  const AVENUE_Y = [6, 7, 13, 14, 20, 21, 27, 28];
  const lampSpots: Vec[] = [];
  for (const x of AVENUE_X) for (const y of AVENUE_Y) lampSpots.push({ x, y });
  rng.shuffle(lampSpots);
  const LAMP_COUNT = 6;
  for (let i = 0; i < LAMP_COUNT && i < lampSpots.length; i++) {
    props.push({ id: `lamp-${i}`, pos: lampSpots[i], kind: 'lamp', solid: false, art: 'lamp' });
  }

  // Restore a house's searched look and the tablet's whereabouts across a
  // regenerate of the same (runSeed, stage): the layout above always comes
  // out identical, so restoring by id is safe. A tablet already found is
  // either in the hero's arms (hidden, as a carried prop is) or lying on its
  // house's doorstep, where a knockdown dropped it; it is never lost.
  const prev = data && typeof data === 'object' ? (data as Partial<ArkhamData>) : null;
  const prevSearched = Array.isArray(prev?.searchedHouseIds) ? (prev!.searchedHouseIds as string[]) : [];
  for (const p of props) if (p.kind === 'house' && prevSearched.includes(p.id)) p.state = 'searched';
  const tabletFound = prev?.tabletFound === true;
  const tabletCarried = hero.carrying === 'tablet';
  props.push({
    id: 'tablet',
    pos: tabletPos,
    kind: 'tablet',
    solid: false,
    art: 'tablet',
    carriable: true,
    hidden: !tabletFound || tabletCarried,
  });

  const grid = gridOnly(tiles);
  const blockedTiles = new Set<string>(props.filter((p) => p.solid).map((p) => key(p.pos)));
  const avenueTiles: Vec[] = [];
  for (let y = 1; y < HEIGHT - 1; y++) {
    for (let x = 1; x < WIDTH - 1; x++) {
      const p = { x, y };
      if (isFloor(grid, p) && !blockedTiles.has(key(p))) avenueTiles.push(p);
    }
  }

  const cultistCount = rng.int(5, 8);
  for (let i = 0; i < cultistCount; i++) {
    const from = rng.pick(avenueTiles);
    const path = patrolFrom(rng, grid, from, avenueTiles, blockedTiles, 6);
    monsters.push(makeCultist(`cultist-${i}`, path, hero.level, false));
  }
  // The high priest: a short beat inside the church square, never past it.
  const priestPath: Vec[] = [
    { x: cx0 + 1, y: cy0 + 1 },
    { x: cx0 + 5, y: cy0 + 1 },
  ];
  monsters.push(makeCultist('cultist-priest', priestPath, hero.level, true));

  const ritualMs = typeof prev?.ritualMs === 'number' ? (prev!.ritualMs as number) : 240000 + 20000 * Math.max(1, Math.floor(hero.level));
  const worldData: ArkhamData = {
    houses,
    tabletHouseId: tabletHouse.id,
    clueTexts: clues.map((c) => c.text),
    clueShorts: clues.map((c) => c.short),
    cluesGiven: typeof prev?.cluesGiven === 'number' ? (prev!.cluesGiven as number) : 0,
    searchedHouseIds: prevSearched,
    tabletFound,
    // Cultists always respawn at full strength on a regenerate, so the kill
    // clock starts counting fresh kills from that count too — nothing here
    // grants time twice for one death.
    lastAlive: monsters.length,
    ritualMs,
    warned60: prev?.warned60 === true,
    warned20: prev?.warned20 === true,
    pulseAcc: 0,
    churchPos,
    sawCircle: prev?.sawCircle === true,
  };

  return {
    depth: 1,
    seed: runSeed ^ stage,
    kind: 'world',
    theme: 'arkham',
    world: { kind: 'necromancer', stage, data: worldData, won: false, clockMs: ritualMs },
    width: WIDTH,
    height: HEIGHT,
    tiles,
    start: startPos,
    exit: startPos, // ignored on world floors (world.ts); the way out is the portal prop
    keys: [],
    doors: [],
    chests: [],
    monsters,
    props,
  };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export const ARKHAM: WorldModule = {
  kind: 'necromancer',
  name: 'Boston',
  collectible: {
    id: 'silver-key',
    name: 'The Silver Key',
    description: 'A key of tarnished silver, to a gate that is not in this world.',
  },

  intro: () => ({
    title: 'Boston, after dark',
    lines: [
      'Somewhere below, the cultists chant toward a ritual, and the clock is already running.',
      'The tablet that stops it is hidden in one house on these streets.',
      'Force a wrong door and you find a note. Three notes name the house.',
      'Bring the tablet to the chalk circle, in the square by the church. Every cultist killed buys time.',
    ],
  }),

  defeat: (_stage, cause) => {
    if (cause === 'ritual') return 'The chant reached its end. Something answered.';
    if (cause === 'knockdown') return "The cultists' knives found you in the fog.";
    return 'The run ends here.';
  },

  generate,

  tick(ctx: WorldCtx, dt: number) {
    const data = ctx.world.data as unknown as ArkhamData;

    // Every cultist killed is one fewer voice in the chant.
    const alive = ctx.level.monsters.filter((m) => m.kind === 'cultist' && m.alive).length;
    if (alive < data.lastAlive) {
      const killed = data.lastAlive - alive;
      data.ritualMs += killed * 15000;
      ctx.log(
        killed > 1
          ? `${killed} fewer voices in the chant — the circle answers, buying time.`
          : 'One fewer voice in the chant — the circle answers, buying time.',
      );
    }
    data.lastAlive = alive;

    data.ritualMs -= dt;
    ctx.world.clockMs = Math.max(0, data.ritualMs);
    if (!data.warned60 && data.ritualMs <= 60000) {
      data.warned60 = true;
      ctx.log('Sixty seconds. The chant is rising.');
    }
    if (!data.warned20 && data.ritualMs <= 20000) {
      data.warned20 = true;
      ctx.log('Twenty seconds. It is almost done.');
    }
    if (data.ritualMs <= 0) {
      data.ritualMs = 0;
      ctx.world.clockMs = 0;
      ctx.gameOver('ritual');
      return;
    }

    data.pulseAcc += dt;
    while (data.pulseAcc >= 10000) {
      data.pulseAcc -= 10000;
      ctx.ring(data.churchPos, 3, '#7a3ad1', 700);
    }
  },

  onEnter(ctx: WorldCtx, tile: Vec) {
    const data = ctx.world.data as unknown as ArkhamData;
    const circle = (ctx.level.props ?? []).find((p) => p.kind === 'circle');
    if (!circle || !eq(circle.pos, tile)) return;
    const carried = ctx.carried();
    if (carried && carried.kind === 'tablet') {
      ctx.consume(carried);
      circle.state = 'broken';
      ctx.freeze(1200, 10);
      ctx.sfx('rumble');
      ctx.finish();
    } else if (!data.sawCircle) {
      data.sawCircle = true;
      ctx.log('Chalk lines cross the cobbles here, still faintly warm.');
    }
  },

  onBump(ctx: WorldCtx, prop: Prop) {
    if (prop.kind === 'portal-home') {
      ctx.returnHome();
      return;
    }
    if (prop.kind !== 'house') return;
    const data = ctx.world.data as unknown as ArkhamData;

    if (prop.state === 'searched') {
      ctx.log('Already searched. Nothing more to find here.');
      return;
    }
    ctx.freeze(600, 6);
    ctx.sfx('doorOpen');
    ctx.log('You force the door.');
    prop.state = 'searched';
    if (!data.searchedHouseIds.includes(prop.id)) data.searchedHouseIds.push(prop.id);

    if (prop.id === data.tabletHouseId) {
      data.tabletFound = true;
      const tablet = (ctx.level.props ?? []).find((p) => p.kind === 'tablet');
      if (tablet) ctx.pickUp(tablet);
      ctx.sfx('relic');
      ctx.text(prop.pos, 'The tablet!', '#3aff8f', 1400);
      ctx.log('Beneath the floorboards: the tablet.');
      return;
    }
    // A wrong house after the tablet is already known costs nothing but the
    // time just spent forcing its door.
    if (data.tabletFound) {
      ctx.log('Nothing here but dust. The tablet is already found.');
      return;
    }
    if (data.cluesGiven < data.clueTexts.length) {
      const i = data.cluesGiven++;
      ctx.text(prop.pos, data.clueShorts[i], '#f2c14e', 2200);
      ctx.log(`A note: "${data.clueTexts[i]}"`);
    } else {
      ctx.text(prop.pos, 'Dust', '#8f8ca8', 900);
      ctx.log('Nothing here but dust and old newspaper.');
    }
  },

  step(ctx: WorldCtx, m: Monster): Vec | null {
    const path = m.patrolPath;
    if (!path || path.length < 2) return null;
    const idx = path.findIndex((p) => eq(p, m.pos));
    if (idx < 0) return null; // shoved off its beat; nothing in this world does that, but never crash for it
    let dir: 1 | -1 = m.patrolDir === -1 ? -1 : 1;
    let next = idx + dir;
    if (next < 0 || next >= path.length) {
      dir = dir === 1 ? -1 : 1;
      next = idx + dir;
    }
    m.patrolDir = dir;
    if (next < 0 || next >= path.length) return null;
    const target = path[next];
    if (!isFloor(ctx.level, target)) return null;
    if (eq(target, ctx.hero.pos)) return null;
    for (const other of ctx.level.monsters) {
      if (other !== m && other.alive && eq(other.pos, target)) return null;
    }
    m.patrolIndex = next;
    return target;
  },
};
