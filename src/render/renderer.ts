import {
  Tile,
  parseKey,
  ITEM_KINDS,
  ITEM_SLOT,
  type GameState,
  type LevelData,
  type Vec,
  type TileMapper,
  type Monster,
  type Hero,
  type Effect,
  type Door,
  type Chest,
  type KeyItem,
  type ItemKind,
  type ItemSlot,
  type ShopOffer,
  type Shrine,
  type ShrineKind,
  type Seal,
  type Rune,
  type Relic,
  type RelicKind,
  type Altar,
  type BossKind,
  type ShopForge,
  type Prop,
  SHRINE_KINDS,
  RELIC_KINDS,
  BOSS_KINDS,
  key,
} from '../engine/types';
import {
  ITEM_ART,
  SLOT_ART,
  PODIUM_ART,
  PODIUM_NICHE,
  SHRINE_ART,
  ALCOVE_ART,
  ALCOVE_NICHE,
  ALTAR_ART,
  ALTAR_NICHE,
  FORGE_ART,
  ORB_ART,
  RELIC_ART,
  RUNE_COUNT,
  SEAL_ART,
  SEAL_NICHE,
  SEAL_OPEN_ART,
  SOCKET_ART,
  TROPHY_ART,
  runeArt,
} from './itemArt';
import { carriedOrb, carriedProp } from '../engine/combat';
import { BLINK_MS, SHRINE_COLORS, buffPhase } from '../engine/shrines';
import {
  LENS_ALPHA,
  LENS_CORE,
  LENS_RADIUS,
  hiddenAt,
  lensLit,
  lensRevealAt,
  passageTiles,
} from '../engine/lens';
import { themeById, type PaintStyle, type ThemePalette } from '../engine/themes';
import { MONSTER_CFGS, creatureRows, monsterSpriteKey } from './monsterArt';
import { propArt } from './worlds';

// ---------------------------------------------------------------------------
// Palette / constants
// ---------------------------------------------------------------------------

const PATH_LINE_COLOR = 'rgba(245, 196, 81, 0.5)';
const PATH_DOT_COLOR = 'rgba(245, 196, 81, 0.65)';
const POINTER_COLOR = '#f5c451';

const HP_BAR_COLOR = '#e53b3b';
const HERO_RING_COLOR = '#f5c451';
const HERO_RING_STUNNED = '#8f8ca8';
const RING_GUARD = '#9a97ad';
const RING_PATROL = '#5aa9ff';
const RING_LURKER = '#a97cff';
const RING_CHASING = '#ff5a5f';
const RING_RETURNING = '#f5d451';
// Boss-only rings/auras.
const RING_NECROMANCER = '#b56cff';
const RING_ANGEL_IDLE = '#5a5a66';
/** An awake angel that is still only taking doorways, not moving in. */
const RING_ANGEL_SIEGE = '#d08a2c';
const CRYSTAL_GLOW_COLOR = '#c13fe0';
const NECRO_SPARK_COLORS = ['#b56cff', '#ff8ce8', '#e8d9ff'] as const;
const SPELL_BAR_COLOR = '#b56cff';
const SPELL_BAR_URGENT_COLOR = '#e53b3b';
/** Below this many ms left, the spell bar tints red and pulses. */
const SPELL_URGENT_MS = 15000;

const LUNGE_MS = 120;
const SUB = 8; // pixel-art sub-resolution per tile (both for the level canvas and sprites)
const VIEW_TILES = 11; // ~ tiles visible across the short axis of the viewport

// Status-effect / gear visuals.
const POISON_TINT = '#3aa15a';
const POISON_BUBBLE = '#7be3a0';
const SLOW_TINT = '#5aa9ff';
const ICE_PIXEL = '#bfe3ff';
const SHIELD_BUBBLE_COLOR = '#5aa9ff';
const BERSERK_RING_COLOR = '#e53b3b';
const COMPASS_COLOR = '#f5c451';
/** A monster frozen by an ice ball: a hard ice tint over the whole sprite. */
const FROZEN_TINT = '#7fd3ff';
/** A spent shrine is scenery: drawn this faint, with no glow at all. */
const SHRINE_SPENT_ALPHA = 0.45;
/**
 * An alcove is drawn a little smaller than its tile, so a rim of floor shows
 * all the way round it. A shrine standing in a corridor (the back of a warren,
 * say) must never read as a wall plugging the passage: the hero walks straight
 * over one.
 */
const ALCOVE_SCALE = 0.88;

// Cracked Lens.
/** How fast the reveal opens and closes when the hero steps in or out, per second. */
const LENS_FADE_PER_S = 3.5;
/** Below this the reveal is not worth a full-viewport composite. */
const LENS_MIN = 0.02;
/**
 * How far around a sprite standing in a passage the clip reaches, in tiles.
 * One is enough for the sprite itself and its badges; two leaves room for a
 * monster caught mid-step between two tiles.
 */
const CLIP_SPAN = 2;
/**
 * A wash of the lens' own colour over the ground it opens. Without it a lit
 * passage is only a slightly darker patch of wall — every theme's floor is
 * close to its brick — and the player is left squinting. With it the light
 * reads as light: cold, glassy, and plainly not the way the rest of the map
 * looks. Kept faint: it is there to say "this is lens-light", not to stand in
 * for the brick the lens is busy clearing away.
 */
const LENS_TINT = 'rgba(143, 227, 255, 0.07)';

// The wings' locks.
/** Runes, seals and the orb all glow in the lens' own blue. */
const RUNE_GLOW = '#8fe3ff';
/** A lit rune's wash behind it, and a dim rune's. */
const RUNE_LIT_ALPHA = 0.28;
/** A spent altar and an open seal are scenery: drawn this faint. */
const SPENT_ALPHA = 0.45;
/**
 * The mimic's tell. Every few seconds an unsprung mimic shivers for a moment
 * — a sub-pixel or two, no more — which is exactly as much as a wary player
 * standing still and watching the chest deserves to be given.
 */
const MIMIC_TELL_EVERY_MS = 3400;
const MIMIC_TELL_MS = 180;

// Shop podium / price tag.
const PEDESTAL_DIM_ALPHA = 0.35;
/** A podium covers this many tiles each way (matches PEDESTAL_SIZE in shop.ts). */
const PODIUM_TILES = 2;
const PRICE_BG = 'rgba(5,5,9,0.85)';
const PRICE_COIN = '#f5c451';
const PRICE_TEXT = '#f0ecff';

// ---------------------------------------------------------------------------
// Tiny pixel-icon builder: a string grid ('.' = transparent) + a palette
// (char -> hex color) rendered once into an offscreen canvas at 1px/pixel.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function buildIcon(rows: string[], palette: Record<string, string>): HTMLCanvasElement {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cctx = c.getContext('2d');
  if (!cctx) return c;
  const img = cctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === undefined) continue;
      const hex = palette[ch];
      if (!hex) continue;
      const [r, g, b] = hexToRgb(hex);
      const idx = (y * w + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Hand-authored 8x8 icons.
// ---------------------------------------------------------------------------

// Four facing looks sharing one 8x8 grid and palette. S is the original
// front view; N is a back view (hood/hair only, no face, cloak seam down the
// spine); E is a right-facing profile (one eye, arm+sword reaching forward
// off the right edge); W reuses the E sprite mirrored via ctx.scale(-1,1)
// (see drawHero) rather than a fifth hand-drawn row set.
const HERO_ROWS_S = ['..HHHH..', '.HHHHHH.', '.HSSSSH.', '.HESSEH.', '..SSSS..', '.AAAAAD.', 'CAAGGAAC', '.B....B.'];
const HERO_ROWS_N = ['..HHHH..', '.HHHHHH.', '.HHHHHH.', '.HDDDDH.', '..AAAA..', '.AADDAA.', 'CAADDAAC', '.B....B.'];
const HERO_ROWS_E = ['.HHH....', '.HHHHH..', '.HSSSH..', '.SSSES..', '..SSS...', '.AAAAD..', 'CAAAADD.', '.B..BDD.'];
const HERO_PALETTE: Record<string, string> = {
  H: '#2f5d4f',
  S: '#e8b98c',
  E: '#141414',
  A: '#6b7a99',
  D: '#d8d8e8',
  C: '#b5502c',
  G: '#f5c451',
  B: '#3a2b1f',
};

// Chest key: a bold 16x16 classic key silhouette (round ring bow + straight
// shaft + two teeth), plain gold with a dark-gold outline and a white
// highlight on the ring — the "mundane" sibling of the horned door key
// below. Same size/shape skeleton as the door key so the two obviously
// belong to the same family.
const CHEST_KEY_GOLD = '#f5c451';
const CHEST_KEY_GOLD_DARK = '#8a5a10';
const CHEST_KEY_HILITE = '#ffffff';
// prettier-ignore
const CHEST_KEY_ROWS = [
  '................',
  '................',
  '......DDDD......',
  '.....DWPPPD.....',
  '....DWPPPPPD....',
  '...DPPDDDDPPD...',
  '...DPPD..DPPD...',
  '...DPPD..DPPD...',
  '...DPPDDDDPPD...',
  '....DPPPPPPD....',
  '.....DPPPPD.....',
  '......DPPDDDDD..',
  '......DPPPPPPPD.',
  '......DPPDDDPPD.',
  '......DPPD..DD..',
  '.......DD.......',
];
const CHEST_KEY_PALETTE: Record<string, string> = { P: CHEST_KEY_GOLD, D: CHEST_KEY_GOLD_DARK, W: CHEST_KEY_HILITE };

// Door key: the same bold 16x16 bow-and-shaft silhouette as the chest key,
// recolored purple/magenta, with the ring (bow) itself shaped into a
// watching eye — white sclera glint, pink iris, dark pupil — the "magic"
// counterpart to the plain gold chest key. Same rows/palette are reused for
// the HUD icon (icons.tsx) so the two read as a matched pair, just bigger
// and with the eye. The same iris/glint colors are reused on the door lock
// below so the door and its key read as the same eye.
const DOOR_KEY_BODY = '#b56cff';
const DOOR_KEY_DARK = '#5a2596';
const DOOR_KEY_IRIS = '#ff5c8a';
const DOOR_KEY_IRIS_GLINT = '#ffd0dc';
const DOOR_KEY_HILITE = '#ffffff';
// prettier-ignore
const DOOR_KEY_ROWS = [
  '................',
  '................',
  '......DDDD......',
  '.....DWHTHD.....',
  '....DWHHHHHD....',
  '...DHHDDDDHHD...',
  '...DHHDDDDHHD...',
  '...DHHDDDDHHD...',
  '...DHHDDDDHHD...',
  '....DPPPPPPD....',
  '.....DPPPPD.....',
  '......DPPDDDDD..',
  '......DPPPPPPPD.',
  '......DPPDDDPPD.',
  '......DPPD..DD..',
  '.......DD.......',
];
const DOOR_KEY_PALETTE: Record<string, string> = {
  P: DOOR_KEY_BODY,
  D: DOOR_KEY_DARK,
  H: DOOR_KEY_IRIS,
  T: DOOR_KEY_IRIS_GLINT,
  W: DOOR_KEY_HILITE,
};

const CHEST_CLOSED_ROWS = ['........', '.WWWWWW.', 'WWWWWWWW', 'WGGGGGGW', 'WW.LL.WW', 'WWWWWWWW', 'WWWWWWWW', '........'];
const CHEST_CLOSED_PALETTE: Record<string, string> = { W: '#8b5a2b', G: '#f5c451', L: '#2a2016' };

const CHEST_OPEN_ROWS = ['.WWWWWW.', '........', 'WWWWWWWW', 'W......W', 'W.g....W', 'W......W', 'WWWWWWWW', '........'];
const CHEST_OPEN_PALETTE: Record<string, string> = { W: '#8b5a2b', g: '#f5c451' };

const EXIT_ROWS = ['WWWWWWWW', 'W......W', 'W.dddd.W', 'W.dddd.W', 'W.dddd.W', 'W.ssss.W', 'W......W', 'WWWWWWWW'];
const EXIT_PALETTE: Record<string, string> = { W: '#4a4863', d: '#08070d', s: '#3a3852' };

// Closed door: 16 wide x 24 tall — a plain rounded plank arch (the top two
// rows stay blank; the extra half-tile of headroom just gives the arch some
// breathing room under the wall tile above) with a watching eye set into
// the middle of the planks: white sclera glint, pink iris, dark pupil — the
// same eye the door key's ring carries, so the two read as a matched pair.
// Planks/seams/outline are wood-brown; the eye reuses the door key's
// purple/pink/white so it's obviously the same magic. Rows/palette kept as
// a literal here since it's drawn once into an offscreen canvas.
// prettier-ignore
const DOOR_CLOSED_ROWS = [
  '................',
  '.......BB.......',
  '......BPPB......',
  '.....BPPPPB.....',
  '....BPPPPPPB....',
  '...BPPPPPPPPB...',
  '..BPPPPPPPPPPB..',
  '.BPPPPPPPPPPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPWWPMPPPB.',
  '.BPPMPWIIWMPPPB.',
  '.BPPMPIKKIMPPPB.',
  '.BPPMPWIIWMPPPB.',
  '.BPPMPPWWPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
  '.BPPMPPPPPMPPPB.',
];
const DOOR_PLANK = '#8b5a2b';
const DOOR_SEAM = '#5e3a18';
const DOOR_OUTLINE = '#2a1a0c';
const DOOR_CLOSED_PALETTE: Record<string, string> = {
  P: DOOR_PLANK,
  M: DOOR_SEAM,
  B: DOOR_OUTLINE,
  W: DOOR_KEY_HILITE,
  I: DOOR_KEY_IRIS,
  K: DOOR_KEY_DARK,
};

// Open door: just the arch frame outline (no planks, no eye) — a plain
// hollow arch, drawn at reduced alpha by drawDoor.
// prettier-ignore
const DOOR_OPEN_ROWS = [
  '................',
  '.......BB.......',
  '......B..B......',
  '.....B....B.....',
  '....B......B....',
  '...B........B...',
  '..B..........B..',
  '.BFFFFFFFFFFFFB.',
  '.BFBBBBBBBBBBFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFB........BFB.',
  '.BFBBBBBBBBBBFB.',
  '.BFFFFFFFFFFFFB.',
];
const DOOR_OPEN_PALETTE: Record<string, string> = {
  F: DOOR_PLANK,
  B: DOOR_OUTLINE,
};

/** Colors used by the door key's pulsing map-tile aura (see drawKeyAura). */
const KEY_AURA_COLOR = DOOR_KEY_BODY;
const KEY_AURA_SPARKLE_COLORS = [DOOR_KEY_IRIS, DOOR_KEY_HILITE, DOOR_KEY_IRIS] as const;

const SHIELD_BADGE_ROWS = ['.SSSS.', 'SSSSSS', 'SSSSSS', '.SSSS.', '..SS..', '..SS..'];

/**
 * keyCompass: an 5x5 gold arrow per compass direction, hovering over the
 * hero's head. `ARROW_ORDER` matches increasing atan2(dy,dx) angle in
 * y-down screen space (0 = E, PI/2 = S, PI = W, -PI/2 = N), so
 * `ARROW_ORDER[(round(angle/(PI/4))+8)%8]` picks the closest of 8.
 */
const ARROW_ORDER = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
const ARROW_ROWS: Record<(typeof ARROW_ORDER)[number], string[]> = {
  N: ['..A..', '.A.A.', 'A...A', '.....', '.....'],
  S: ['.....', '.....', 'A...A', '.A.A.', '..A..'],
  E: ['..A..', '...A.', '....A', '...A.', '..A..'],
  W: ['..A..', '.A...', 'A....', '.A...', '..A..'],
  NE: ['....A', '...AA', '..A..', '.A...', 'A....'],
  SE: ['A....', '.A...', '..A..', '...AA', '....A'],
  SW: ['....A', '...A.', '..A..', '.AA..', 'A....'],
  NW: ['AA...', 'A....', '..A..', '...A.', '....A'],
};

/**
 * How deep, in sub-pixels, the wall is chewed away at a warren mouth. Small on
 * purpose: enough to read as broken masonry, not enough to look walkable.
 */
const BREAK_DEPTH = 4;

/** Sub-pixels from (lx, ly) to the tile face pointing along `d`. */
function faceDepth(d: Vec, lx: number, ly: number): number {
  if (d.x > 0) return SUB - 1 - lx;
  if (d.x < 0) return lx;
  if (d.y > 0) return SUB - 1 - ly;
  return ly;
}

/**
 * The stonework around a warren mouth, worked out from the level.
 *
 * A warren has exactly one way in, and nothing tells the player which of the
 * openings off a corridor is the one that loops back on itself. So the mouth
 * is drawn as a hole knocked through the wall: the two blocks framing it are
 * chewed away on the faces that meet the gap, and the rubble is left lying on
 * the floor of the opening. Nothing says so anywhere in the UI — it is there
 * to be noticed, and then recognised.
 */
function mouthMasonry(level: LevelData): {
  /** Wall tile -> unit vector from that block toward the gap it frames. */
  broken: Map<string, Vec>;
  /** Floor tile -> unit vector from that tile toward the break it lies under. */
  rubble: Map<string, Vec>;
} {
  const broken = new Map<string, Vec>();
  const rubble = new Map<string, Vec>();
  const isWall = (p: Vec): boolean =>
    p.x >= 0 && p.y >= 0 && p.x < level.width && p.y < level.height && level.tiles[p.y][p.x] === Tile.Wall;

  for (const warren of level.warrens ?? []) {
    const inside = new Set(warren.tiles.map(key));
    const m = warren.mouth;
    // The passage runs from the corridor outside into the mouth tile; the
    // blocks that frame it are the two at right angles to that.
    const out = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]
      .map((d) => ({ x: m.x + d.x, y: m.y + d.y }))
      .find((p) => !isWall(p) && !inside.has(key(p)));
    if (!out) continue;
    const along = { x: out.x - m.x, y: out.y - m.y };
    const side = { x: along.y, y: along.x }; // turn ninety degrees
    for (const sign of [1, -1]) {
      const w = { x: m.x + side.x * sign, y: m.y + side.y * sign };
      if (!isWall(w)) continue;
      broken.set(key(w), { x: m.x - w.x, y: m.y - w.y });
    }
    // Rubble falls on both sides of the threshold, so the break still reads
    // when the hero is standing in the gap. It piles against the gap itself.
    rubble.set(key(m), { x: along.x, y: along.y });
    rubble.set(key(out), { x: -along.x, y: -along.y });
  }
  return { broken, rubble };
}

function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Paint styles (see engine/themes.ts's `PaintStyle`): 'brick' is the dungeon
// and is painted inline in `paintLevel` (it alone needs the warren-break /
// rubble treatment); everything else — the boss worlds' looks — is a pure
// function of the SUB-resolution pixel coordinates here, exactly like the
// brick pattern, so the sealed picture never grows a seam either.
// ---------------------------------------------------------------------------

/** One wall pixel for a non-brick style, at sub-pixel resolution `(gx, gy)`. */
function wallPixel(style: PaintStyle, pal: ThemePalette, gx: number, gy: number): string {
  switch (style) {
    case 'cloud': {
      // Sky: flat wallA with a scatter of lighter wallHi pixels.
      return hash2(gx, gy) % 23 === 0 ? pal.wallHi : pal.wallA;
    }
    case 'water': {
      // Sea: wallA/wallB in horizontal wave bands 2 sub-pixels tall, each
      // band's crest (a wallHi pixel) offset sideways by a hash of the band.
      const band = Math.floor(gy / 2);
      const crest = hash2(band, 0) % SUB;
      const hi = ((gx + hash2(0, band)) % SUB) === crest;
      if (hi) return pal.wallHi;
      return band % 2 === 0 ? pal.wallA : pal.wallB;
    }
    case 'street': {
      // Building: wallA with wallHi windows in a 3x3 grid (one lit corner of
      // every 6x6 block, checkerboarded), mortar lines every 4 rows.
      if (gy % 4 === 0) return pal.mortar;
      const wx = gx % 6;
      const wy = gy % 6;
      if (wx >= 1 && wx <= 3 && wy >= 1 && wy <= 3 && (wx + wy) % 2 === 0) return pal.wallHi;
      return pal.wallA;
    }
    case 'hedge': {
      // Hedge: a leafy speckle of wallA/wallB with the odd wallHi leaf catching light.
      const h = hash2(gx, gy);
      if (h % 11 === 0) return pal.wallHi;
      return h % 2 === 0 ? pal.wallA : pal.wallB;
    }
    case 'stone': {
      // Rough rock: irregular wallA/wallB blobs (hashed at half resolution, so
      // they read as chunks of stone rather than single pixels) with mortar cracks.
      const crack = hash2(gx, gy) % 17 === 0;
      if (crack) return pal.mortar;
      return hash2(gx >> 1, gy >> 1) % 2 === 0 ? pal.wallA : pal.wallB;
    }
    default:
      return pal.wallA;
  }
}

/** One floor pixel for a non-brick style. `nearWall` bit-flags which sides of the tile border a wall (N=1, E=2, S=4, W=8), for 'cloud''s rounded edge. */
function floorPixel(style: PaintStyle, pal: ThemePalette, gx: number, gy: number, lx: number, ly: number, nearWall: number): string {
  switch (style) {
    case 'cloud': {
      // Cloud: floor colour with speckLight bumps, and a soft, hash-broken
      // (never a hard line) darker edge where the cloud meets open sky.
      const h = hash2(gx, gy);
      const edge =
        ((nearWall & 1 && ly < 2) || (nearWall & 4 && ly >= SUB - 2) || (nearWall & 2 && lx >= SUB - 2) || (nearWall & 8 && lx < 2)) &&
        h % 3 !== 0;
      if (edge) return pal.speckDark;
      if (h % 7 === 0) return pal.speckLight;
      return pal.floor;
    }
    case 'water': {
      // Deck planks: a seam every 4 sub-pixels across the grain, plus speckLight wood grain.
      if (gx % 4 === 0) return pal.speckDark;
      return hash2(gx, gy) % 9 === 0 ? pal.speckLight : pal.floor;
    }
    case 'street': {
      // Cobbles: a 2x2 pattern, each cobble speckLight or speckDark, with a floor-coloured mortar seam between them.
      if (gx % 2 === 0 || gy % 2 === 0) return ((gx >> 1) + (gy >> 1)) % 2 === 0 ? pal.speckDark : pal.speckLight;
      return pal.floor;
    }
    case 'hedge': {
      // Grass: a scatter of speckLight blades.
      return hash2(gx, gy) % 6 === 0 ? pal.speckLight : pal.floor;
    }
    case 'stone': {
      // Flagstones: speckDark joints every 8 sub-pixels, offset a half-stone every other row.
      const rowOffset = (Math.floor(gy / 8) % 2) * 4;
      if ((gx + rowOffset) % 8 === 0 || gy % 8 === 0) return pal.speckDark;
      return pal.floor;
    }
    default:
      return pal.floor;
  }
}

// ---------------------------------------------------------------------------

export class Renderer implements TileMapper {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private tile = 32;
  private viewW = 320;
  private viewH = 568;
  private levelW = 1;
  private levelH = 1;
  private level: LevelData | null = null;
  private staticCanvas: HTMLCanvasElement | null = null;
  /**
   * The same level with its hidden passages painted as floor. Built only on
   * floors that have any, and blitted over `staticCanvas` through a soft round
   * hole at the hero's feet while a lens is lit. Two finished pictures and a
   * mask is far cheaper than deciding, per pixel and per frame, how solid a
   * given brick currently is.
   */
  private revealCanvas: HTMLCanvasElement | null = null;
  /**
   * White where the level hides a passage, transparent everywhere else. Both
   * lens composites are clipped through it, so neither can touch a pixel of
   * the maze the floor was always honest about.
   */
  private hiddenMask: HTMLCanvasElement | null = null;
  /** Scratch buffer both lens composites are assembled in. */
  private lensCanvas: HTMLCanvasElement | null = null;
  /**
   * How far open the reveal is, 0..1. Eased rather than switched, so stepping
   * into a passage opens the light instead of popping it on.
   */
  private lensGlow = 0;
  /**
   * `level.rev` as it stood the last time `buildStatic` painted it. A world
   * module that changes `tiles` after generation bumps `rev` (see
   * `WorldCtx.rebuild`); `draw` compares against this every frame and rebuilds
   * the static canvases when it moves, without waiting for `resize` to notice
   * a level object it already has.
   */
  private paintedRev = 0;
  /** This frame's shake offset in screen pixels, so the reveal buffer can match it. */
  private shake = { x: 0, y: 0 };

  private cam = { x: 0, y: 0 };
  private camPx = { x: 0, y: 0 };
  private needSnap = true;

  /** Facing sprites: N/S/E hand-drawn; W is drawn by mirroring E (see drawHero). */
  private heroSprites: Record<'N' | 'S' | 'E', HTMLCanvasElement>;
  private doorKeySprite: HTMLCanvasElement;
  private chestKeySprite: HTMLCanvasElement;
  private chestClosedSprite: HTMLCanvasElement;
  private chestOpenSprite: HTMLCanvasElement;
  private doorClosedSprite: HTMLCanvasElement;
  private doorOpenSprite: HTMLCanvasElement;
  private exitSprite: HTMLCanvasElement;
  private shieldBadgeSprite: HTMLCanvasElement;
  private podiumSprite: HTMLCanvasElement;
  /** Hero level captured at the start of each draw, used to color monster level badges. */
  private heroLevel = 1;
  /** necromancer boss level only: spellMs / spellTotalMs, 1 elsewhere. Speeds up his ring's pulse. */
  private necroSpellFrac = 1;
  private monsterSprites: Map<string, HTMLCanvasElement> = new Map();
  private itemSprites: Map<ItemKind, HTMLCanvasElement> = new Map();
  private slotSprites: Map<ItemSlot, HTMLCanvasElement> = new Map();
  private arrowSprites: Map<(typeof ARROW_ORDER)[number], HTMLCanvasElement> = new Map();
  private shrineSprites: Map<ShrineKind, HTMLCanvasElement> = new Map();
  private alcoveSprite: HTMLCanvasElement;
  /** The wings' furniture. Runes come in a dim and a lit sprite per shape. */
  private runeSprites: { dim: HTMLCanvasElement; lit: HTMLCanvasElement }[] = [];
  private sealSprite: HTMLCanvasElement;
  private sealOpenSprite: HTMLCanvasElement;
  private socketSprite: HTMLCanvasElement;
  private orbSprite: HTMLCanvasElement;
  private altarSprite: HTMLCanvasElement;
  private forgeSprite: HTMLCanvasElement;
  private relicSprites: Map<RelicKind, HTMLCanvasElement> = new Map();
  private trophySprites: Map<BossKind, HTMLCanvasElement> = new Map();
  /**
   * A boss world's own furniture (see engine/worlds): built lazily, one
   * sprite per distinct `Prop.art`/`Prop.art:state` key, the first time each
   * turns up — unlike the tables above, a prop's art is only known once a
   * world's level exists, not at construction time.
   */
  private propSprites: Map<string, HTMLCanvasElement> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Renderer: 2d context unavailable');
    this.ctx = ctx;

    this.heroSprites = {
      N: buildIcon(HERO_ROWS_N, HERO_PALETTE),
      S: buildIcon(HERO_ROWS_S, HERO_PALETTE),
      E: buildIcon(HERO_ROWS_E, HERO_PALETTE),
    };
    this.doorKeySprite = buildIcon(DOOR_KEY_ROWS, DOOR_KEY_PALETTE);
    this.chestKeySprite = buildIcon(CHEST_KEY_ROWS, CHEST_KEY_PALETTE);
    this.chestClosedSprite = buildIcon(CHEST_CLOSED_ROWS, CHEST_CLOSED_PALETTE);
    this.chestOpenSprite = buildIcon(CHEST_OPEN_ROWS, CHEST_OPEN_PALETTE);
    this.doorClosedSprite = buildIcon(DOOR_CLOSED_ROWS, DOOR_CLOSED_PALETTE);
    this.doorOpenSprite = buildIcon(DOOR_OPEN_ROWS, DOOR_OPEN_PALETTE);
    this.exitSprite = buildIcon(EXIT_ROWS, EXIT_PALETTE);
    this.shieldBadgeSprite = buildIcon(SHIELD_BADGE_ROWS, { S: '#9a97ad' });
    this.podiumSprite = buildIcon(PODIUM_ART.rows, PODIUM_ART.palette);
    this.alcoveSprite = buildIcon(ALCOVE_ART.rows, ALCOVE_ART.palette);
    for (const kind of SHRINE_KINDS) {
      const art = SHRINE_ART[kind];
      this.shrineSprites.set(kind, buildIcon(art.rows, art.palette));
    }
    for (let g = 0; g < RUNE_COUNT; g++) {
      const dim = runeArt(g, false);
      const lit = runeArt(g, true);
      this.runeSprites.push({ dim: buildIcon(dim.rows, dim.palette), lit: buildIcon(lit.rows, lit.palette) });
    }
    this.sealSprite = buildIcon(SEAL_ART.rows, SEAL_ART.palette);
    this.sealOpenSprite = buildIcon(SEAL_OPEN_ART.rows, SEAL_OPEN_ART.palette);
    this.socketSprite = buildIcon(SOCKET_ART.rows, SOCKET_ART.palette);
    this.orbSprite = buildIcon(ORB_ART.rows, ORB_ART.palette);
    this.altarSprite = buildIcon(ALTAR_ART.rows, ALTAR_ART.palette);
    this.forgeSprite = buildIcon(FORGE_ART.rows, FORGE_ART.palette);
    for (const kind of RELIC_KINDS) {
      const art = RELIC_ART[kind];
      this.relicSprites.set(kind, buildIcon(art.rows, art.palette));
    }
    for (const kind of BOSS_KINDS) {
      const art = TROPHY_ART[kind];
      this.trophySprites.set(kind, buildIcon(art.rows, art.palette));
    }

    for (const [kind, cfg] of Object.entries(MONSTER_CFGS)) {
      const { rows, palette } = creatureRows(cfg);
      this.monsterSprites.set(kind, buildIcon(rows, palette));
    }

    for (const kind of ITEM_KINDS) {
      const art = ITEM_ART[kind];
      this.itemSprites.set(kind, buildIcon(art.rows, art.palette));
    }
    for (const slot of ['offense', 'defense', 'spirit'] as ItemSlot[]) {
      const art = SLOT_ART[slot];
      this.slotSprites.set(slot, buildIcon(art.rows, art.palette));
    }
    for (const dir of ARROW_ORDER) {
      this.arrowSprites.set(dir, buildIcon(ARROW_ROWS[dir], { A: COMPASS_COLOR }));
    }
  }

  /**
   * Fit the canvas to its parent. Returns true when the backing bitmap was
   * re-created (it comes back blank, so the caller should redraw at once
   * rather than wait for the next animation frame: a blank frame on screen
   * reads as a flicker). Assigning `canvas.width` wipes the bitmap even when
   * the value is unchanged, so it is only touched when the size really moved.
   */
  resize(level: LevelData): boolean {
    const parent = this.canvas.parentElement;
    const boxW = Math.max(1, parent ? parent.clientWidth : window.innerWidth);
    const boxH = Math.max(1, parent ? parent.clientHeight : window.innerHeight);

    const tile = Math.max(24, Math.min(48, Math.round(boxW / VIEW_TILES)));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pxW = Math.round(boxW * dpr);
    const pxH = Math.round(boxH * dpr);

    let wiped = false;
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
      wiped = true;
    }
    if (this.viewW !== boxW || this.viewH !== boxH) {
      this.canvas.style.width = `${boxW}px`;
      this.canvas.style.height = `${boxH}px`;
    }

    this.tile = tile;
    this.dpr = dpr;
    this.viewW = boxW;
    this.viewH = boxH;

    if (level !== this.level) {
      this.level = level;
      this.levelW = level.width;
      this.levelH = level.height;
      this.buildStatic(level);
      this.needSnap = true;
    }

    this.ctx.imageSmoothingEnabled = false;
    return wiped;
  }

  tileAt(clientX: number, clientY: number): Vec | null {
    const rect = this.canvas.getBoundingClientRect();
    const t = this.tile;
    const x = Math.floor((clientX - rect.left + this.camPx.x) / t);
    const y = Math.floor((clientY - rect.top + this.camPx.y) / t);
    if (x < 0 || y < 0 || x >= this.levelW || y >= this.levelH) return null;
    return { x, y };
  }

  /**
   * Paint the whole level into an offscreen canvas at `SUB` pixels per tile.
   *
   * `revealHidden` picks which of the two pictures this is: false paints a
   * passage as unbroken brick, exactly as the floor pretends it is, and true
   * paints it as the corridor it really is. The brick pattern is a function of
   * the tile coordinates alone, so the sealed picture has no seam anywhere for
   * a player to read.
   */
  private paintLevel(level: LevelData, revealHidden: boolean): HTMLCanvasElement | null {
    const w = level.width * SUB;
    const h = level.height * SUB;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const sctx = canvas.getContext('2d');
    if (!sctx) return null;
    const pal = themeById(level.theme).palette;
    const style = pal.style ?? 'brick';
    const { broken, rubble } = mouthMasonry(level);
    const hidden = level.passages?.length ? passageTiles(level) : null;
    const isWallTile = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= level.width || y >= level.height) return true;
      if (level.tiles[y][x] === Tile.Wall) return true;
      return !revealHidden && hidden !== null && hidden.has(key({ x, y }));
    };
    const img = sctx.createImageData(w, h);
    for (let ty = 0; ty < level.height; ty++) {
      const row = level.tiles[ty];
      for (let tx = 0; tx < level.width; tx++) {
        const k = key({ x: tx, y: ty });
        const isWall = row[tx] === Tile.Wall || (!revealHidden && hidden !== null && hidden.has(k));
        const breakToward = broken.get(k);
        const rubbleToward = rubble.get(k);
        // Which sides of this floor tile touch a wall, for 'cloud''s soft
        // edge: bit 1 = north, 2 = east, 4 = south, 8 = west.
        const nearWall = isWall
          ? 0
          : (isWallTile(tx, ty - 1) ? 1 : 0) |
            (isWallTile(tx + 1, ty) ? 2 : 0) |
            (isWallTile(tx, ty + 1) ? 4 : 0) |
            (isWallTile(tx - 1, ty) ? 8 : 0);
        for (let ly = 0; ly < SUB; ly++) {
          const gy = ty * SUB + ly;
          for (let lx = 0; lx < SUB; lx++) {
            const gx = tx * SUB + lx;
            let hex: string;
            if (isWall) {
              if (style !== 'brick') {
                hex = wallPixel(style, pal, gx, gy);
              } else {
                const brickRow = Math.floor(ly / 4);
                const offset = (brickRow % 2) * 4;
                const withinBrickX = (lx + offset) % 8;
                const isMortarV = withinBrickX === 0;
                const isMortarH = ly % 4 === 0;
                if (isMortarV || isMortarH) hex = pal.mortar;
                else if (ly % 4 === 1) hex = pal.wallHi;
                else hex = (tx + brickRow) % 2 === 0 ? pal.wallA : pal.wallB;
                // A block framing a warren mouth is chewed away on the face
                // that meets the gap, in a ragged line so it reads as knocked
                // through rather than cut. Warrens are a dungeon notion, so
                // this never applies outside the 'brick' style.
                if (breakToward) {
                  const fromFace = faceDepth(breakToward, lx, ly);
                  // Band the randomness so the edge steps in chunks the size
                  // of a broken brick rather than flickering pixel by pixel.
                  const band = breakToward.x !== 0 ? ly >> 1 : lx >> 1;
                  const bite = 1 + (hash2(tx * 31 + band, ty * 17) % BREAK_DEPTH);
                  if (fromFace < bite) {
                    hex = fromFace === bite - 1 ? pal.wallHi : pal.mortar;
                  }
                }
              }
            } else if (style !== 'brick') {
              hex = floorPixel(style, pal, gx, gy, lx, ly, nearWall);
            } else {
              const hv = hash2(tx, ty);
              const slx = (hv >> 3) % SUB;
              const sly = (hv >> 6) % SUB;
              if (hv % 5 === 0 && lx === slx && ly === sly) {
                hex = hv % 2 === 0 ? pal.speckLight : pal.speckDark;
              } else {
                hex = pal.floor;
              }
              // Fallen masonry on the threshold of a warren: chips of the wall
              // lying on the floor, in the wall's own colours so they read as
              // rubble rather than as more of the floor. It piles up against
              // the gap and thins out across the tile, the way spill does.
              if (rubbleToward) {
                const spread = faceDepth(rubbleToward, lx, ly);
                const hr = hash2(gx * 31 + 5, gy * 17 + 3);
                if (hr % (2 + spread * 2) === 0) {
                  hex = hr % 5 === 0 ? pal.wallHi : pal.wallB;
                }
              }
            }
            const [r, g, b] = hexToRgb(hex);
            const idx = (gy * w + gx) * 4;
            img.data[idx] = r;
            img.data[idx + 1] = g;
            img.data[idx + 2] = b;
            img.data[idx + 3] = 255;
          }
        }
      }
    }
    sctx.putImageData(img, 0, 0);
    return canvas;
  }

  private buildStatic(level: LevelData): void {
    this.staticCanvas = this.paintLevel(level, false);
    // Only floors with something to hide pay for the second picture.
    const hides = !!level.passages?.length;
    this.revealCanvas = hides ? this.paintLevel(level, true) : null;
    this.hiddenMask = hides ? this.paintHiddenMask(level) : null;
    this.lensGlow = 0;
    this.paintedRev = level.rev ?? 0;
  }

  /** One solid block per hidden tile, at the same scale as the level canvases. */
  private paintHiddenMask(level: LevelData): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas');
    canvas.width = level.width * SUB;
    canvas.height = level.height * SUB;
    const mctx = canvas.getContext('2d');
    if (!mctx) return null;
    mctx.fillStyle = '#fff';
    for (const k of passageTiles(level)) {
      const p = parseKey(k);
      mctx.fillRect(p.x * SUB, p.y * SUB, SUB, SUB);
    }
    return canvas;
  }

  private inRange(p: Vec, x0: number, x1: number, y0: number, y1: number): boolean {
    return p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1;
  }

  /**
   * How much of this tile the lens is currently showing, 0..1. Ground the maze
   * admits to is always 1; hidden ground follows the same falloff the mask
   * gradient uses, so anything drawn against this number keeps step with the
   * brick beside it.
   */
  private tileReveal(state: GameState, p: Vec): number {
    if (!hiddenAt(state.level, p)) return 1;
    if (this.lensGlow <= 0) return 0;
    const hero = state.hero.rpos;
    const dist = Math.hypot(p.x - hero.x, p.y - hero.y);
    return (lensRevealAt(dist) / LENS_ALPHA) * this.lensGlow;
  }

  /**
   * The part of the view that has hidden ground in it, in tiles, or null when
   * there is none. Both lens composites are viewport-sized operations, so the
   * cheap answer — "the hero is nowhere near a passage, skip the whole thing"
   * — is the one worth asking first, every frame.
   */
  private hiddenViewBox(
    level: LevelData,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
  ): { x0: number; x1: number; y0: number; y1: number } | null {
    if (!level.passages?.length) return null;
    const hidden = passageTiles(level);
    let minX = x1;
    let minY = y1;
    let maxX = x0 - 1;
    let maxY = y0 - 1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!hidden.has(`${x},${y}`)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX) return null;
    return { x0: minX, x1: maxX + 1, y0: minY, y1: maxY + 1 };
  }

  /**
   * Set the scratch buffer up with the camera the main canvas is under, so the
   * two line up pixel for pixel and nothing shivers against the wall.
   */
  private lensScratch(): CanvasRenderingContext2D | null {
    if (!this.lensCanvas) this.lensCanvas = document.createElement('canvas');
    const scratch = this.lensCanvas;
    if (scratch.width !== this.canvas.width || scratch.height !== this.canvas.height) {
      scratch.width = this.canvas.width;
      scratch.height = this.canvas.height;
    }
    const sctx = scratch.getContext('2d');
    if (!sctx) return null;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    sctx.imageSmoothingEnabled = false;
    sctx.translate(-this.camPx.x + this.shake.x, -this.camPx.y + this.shake.y);
    return sctx;
  }

  /** Blit a slice of one of the level-sized canvases into `ctx`, in tile coords. */
  private blitSlice(
    ctx: CanvasRenderingContext2D,
    src: HTMLCanvasElement,
    box: { x0: number; x1: number; y0: number; y1: number },
  ): void {
    const t = this.tile;
    ctx.drawImage(
      src,
      box.x0 * SUB,
      box.y0 * SUB,
      (box.x1 - box.x0) * SUB,
      (box.y1 - box.y0) * SUB,
      box.x0 * t,
      box.y0 * t,
      (box.x1 - box.x0) * t,
      (box.y1 - box.y0) * t,
    );
  }

  /** The lens' disc of light, as a paintable gradient in camera space. */
  private lensDisc(state: GameState): { grad: CanvasGradient; x: number; y: number; r: number } {
    const t = this.tile;
    const cx = (state.hero.rpos.x + 0.5) * t;
    const cy = (state.hero.rpos.y + 0.5) * t;
    const r = LENS_RADIUS * t;
    const a = LENS_ALPHA * this.lensGlow;
    const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(0,0,0,${a})`);
    grad.addColorStop(LENS_CORE / LENS_RADIUS, `rgba(0,0,0,${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    return { grad, x: cx, y: cy, r };
  }

  /** Put the scratch buffer down over the main canvas, camera and all. */
  private blitScratch(ctx: CanvasRenderingContext2D): void {
    if (!this.lensCanvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.lensCanvas, 0, 0);
    ctx.restore();
  }

  /**
   * Draw something standing on hidden ground, clipped to the hidden ground
   * itself.
   *
   * Sprites overdraw their tile — the ring, the level tag, the guard's shield
   * badge, the hp bar all poke a few pixels past its edges — and a passage is
   * one tile wide, so those few pixels land on ordinary wall that the veil
   * never covers. Unclipped, a patrol pacing a passage shows as a thin bright
   * edge sliding along the brick, and the floor has given itself away.
   *
   * The clip is the hidden tiles around the entity, which is the shape of the
   * corridor it is standing in: what you get is a monster seen through a slot
   * in the wall. Anything at all outside the lens' reach is skipped before it
   * is drawn at all.
   */
  private drawBehindWall(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    at: Vec,
    t: number,
    paint: () => void,
  ): void {
    if (!hiddenAt(state.level, at)) {
      paint();
      return;
    }
    if (this.tileReveal(state, at) <= LENS_MIN) return;
    const hidden = passageTiles(state.level);
    ctx.save();
    ctx.beginPath();
    for (let y = at.y - CLIP_SPAN; y <= at.y + CLIP_SPAN; y++) {
      for (let x = at.x - CLIP_SPAN; x <= at.x + CLIP_SPAN; x++) {
        if (hidden.has(`${x},${y}`)) ctx.rect(x * t, y * t, t, t);
      }
    }
    ctx.clip();
    paint();
    ctx.restore();
  }

  /**
   * Ground the hero can see through the lens: the "passages are corridors"
   * picture, clipped to the hidden tiles and then to the disc of light. Drawn
   * straight after the sealed level, so the floor of a passage is under the
   * trail and the sprites like any other floor.
   */
  private drawReveal(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    box: { x0: number; x1: number; y0: number; y1: number },
  ): void {
    const reveal = this.revealCanvas;
    const mask = this.hiddenMask;
    if (!reveal || !mask || this.lensGlow <= LENS_MIN) return;
    const sctx = this.lensScratch();
    if (!sctx) return;
    this.blitSlice(sctx, reveal, box);
    sctx.globalCompositeOperation = 'destination-in';
    this.blitSlice(sctx, mask, box);
    const disc = this.lensDisc(state);
    sctx.fillStyle = disc.grad;
    sctx.fillRect(disc.x - disc.r, disc.y - disc.r, disc.r * 2, disc.r * 2);
    // `source-atop` tints what is left in proportion to how much of it is
    // left, so the wash fades out with the light rather than ending at a rim.
    sctx.globalCompositeOperation = 'source-atop';
    sctx.fillStyle = LENS_TINT;
    sctx.fillRect(disc.x - disc.r, disc.y - disc.r, disc.r * 2, disc.r * 2);
    this.blitScratch(ctx);
  }

  /**
   * The brick, put back in front of everything.
   *
   * The sealed picture again, clipped to the hidden tiles and with the lens'
   * disc subtracted out of it. Where the hero is not looking that is solid
   * wall over the top of whatever was drawn under it; where they are, it
   * thins to the sliver of brick that keeps a lit passage from reading like
   * the rest of the map.
   */
  private drawPassageVeil(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    box: { x0: number; x1: number; y0: number; y1: number },
  ): void {
    const sealed = this.staticCanvas;
    const mask = this.hiddenMask;
    if (!sealed || !mask) return;
    const sctx = this.lensScratch();
    if (!sctx) return;
    this.blitSlice(sctx, sealed, box);
    sctx.globalCompositeOperation = 'destination-in';
    this.blitSlice(sctx, mask, box);
    if (this.lensGlow > LENS_MIN) {
      const disc = this.lensDisc(state);
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = disc.grad;
      sctx.fillRect(disc.x - disc.r, disc.y - disc.r, disc.r * 2, disc.r * 2);
    }
    this.blitScratch(ctx);
  }

  draw(state: GameState, dt: number): void {
    this.heroLevel = state.hero.level;
    this.necroSpellFrac =
      state.level.kind === 'boss' && state.level.boss?.kind === 'necromancer'
        ? state.level.boss.spellMs / state.level.boss.spellTotalMs
        : 1;
    // A world module changed `tiles` after generation (`WorldCtx.rebuild`
    // bumps `rev`): repaint the static canvases in place, same level object
    // and all, rather than waiting for `resize` to notice a level it already
    // has.
    if (this.level === state.level && (state.level.rev ?? 0) !== this.paintedRev) {
      this.buildStatic(state.level);
    }
    // 1. Age & prune effects.
    for (const fx of state.fx) fx.t += dt;
    state.fx = state.fx.filter((fx) => fx.t < fx.ttl);

    // The lens' light, eased both ways so walking past a mouth is a passage
    // opening up rather than a switch being thrown. Nothing anywhere on screen
    // says where a passage is: the light coming up as the hero walks by is the
    // whole of how one is found, which is why the easing matters.
    const lensTarget = lensLit(state.level, state.hero, state.depth) ? 1 : 0;
    const lensStep = (LENS_FADE_PER_S * dt) / 1000;
    this.lensGlow =
      lensTarget > this.lensGlow
        ? Math.min(lensTarget, this.lensGlow + lensStep)
        : Math.max(lensTarget, this.lensGlow - lensStep);

    const ctx = this.ctx;
    const t = this.tile;
    const viewTilesW = this.viewW / t;
    const viewTilesH = this.viewH / t;

    // 2. Camera: target centers the hero, clamped to level bounds (or
    // centered on an axis where the level is smaller than the viewport).
    let targetX = state.hero.rpos.x + 0.5 - viewTilesW / 2;
    let targetY = state.hero.rpos.y + 0.5 - viewTilesH / 2;

    if (this.levelW <= viewTilesW) {
      targetX = (this.levelW - viewTilesW) / 2;
    } else {
      targetX = Math.max(0, Math.min(this.levelW - viewTilesW, targetX));
    }
    if (this.levelH <= viewTilesH) {
      targetY = (this.levelH - viewTilesH) / 2;
    } else {
      targetY = Math.max(0, Math.min(this.levelH - viewTilesH, targetY));
    }

    if (this.needSnap) {
      this.cam.x = targetX;
      this.cam.y = targetY;
      this.needSnap = false;
    } else {
      const f = Math.min(1, dt / 120);
      this.cam.x += (targetX - this.cam.x) * f;
      this.cam.y += (targetY - this.cam.y) * f;
    }

    const camPxX = Math.round(this.cam.x * t);
    const camPxY = Math.round(this.cam.y * t);
    this.camPx.x = camPxX;
    this.camPx.y = camPxY;

    // Shake offset (screen space, added on top of the camera scroll).
    let shakeX = 0;
    let shakeY = 0;
    for (const fx of state.fx) {
      if (fx.kind === 'shake') {
        const remain = Math.max(0, 1 - fx.t / fx.ttl);
        shakeX += (Math.random() * 2 - 1) * fx.strength * remain;
        shakeY += (Math.random() * 2 - 1) * fx.strength * remain;
      }
    }
    shakeX = Math.round(shakeX);
    shakeY = Math.round(shakeY);
    this.shake.x = shakeX;
    this.shake.y = shakeY;

    // 3. Clear (device pixels), then switch to CSS-pixel space translated
    // by the camera + shake.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.translate(-camPxX + shakeX, -camPxY + shakeY);

    // Visible tile range, +1 tile margin.
    const startX = Math.max(0, Math.floor(this.cam.x) - 1);
    const endX = Math.min(this.levelW, Math.ceil(this.cam.x + viewTilesW) + 1);
    const startY = Math.max(0, Math.floor(this.cam.y) - 1);
    const endY = Math.min(this.levelH, Math.ceil(this.cam.y + viewTilesH) + 1);

    // Blit the visible slice of the pre-rendered level canvas.
    if (this.staticCanvas && endX > startX && endY > startY) {
      const sx = startX * SUB;
      const sy = startY * SUB;
      const sw = (endX - startX) * SUB;
      const sh = (endY - startY) * SUB;
      ctx.drawImage(this.staticCanvas, sx, sy, sw, sh, startX * t, startY * t, (endX - startX) * t, (endY - startY) * t);
    }

    // The passages, seen through the lens: a soft disc of corridor punched
    // into the wall around the hero. `hiddenBox` is null on almost every
    // frame — most of a floor has no passage anywhere near the viewport — and
    // both lens composites cost nothing at all when it is.
    const hiddenBox = this.hiddenViewBox(state.level, startX, endX, startY, endY);
    if (hiddenBox) this.drawReveal(ctx, state, hiddenBox);

    // Trail highlight.
    ctx.fillStyle = themeById(state.level.theme).palette.trail;
    for (const k of state.trail) {
      const p = parseKey(k);
      if (!this.inRange(p, startX, endX, startY, endY)) continue;
      ctx.fillRect(p.x * t, p.y * t, t, t);
    }

    // Queued path: line from hero + square dots at tile centers. Drawn one
    // segment at a time so the part of it running through unlit passage fades
    // out with the brick — a drag into the dark is allowed, but it must not
    // trace out the shape of a corridor the hero has not walked yet.
    if (state.path.length > 0) {
      ctx.strokeStyle = PATH_LINE_COLOR;
      ctx.lineWidth = Math.max(1, Math.round(t * 0.06));
      ctx.beginPath();
      ctx.moveTo(state.hero.rpos.x * t + t / 2, state.hero.rpos.y * t + t / 2);
      for (const p of state.path) ctx.lineTo(p.x * t + t / 2, p.y * t + t / 2);
      ctx.stroke();

      ctx.fillStyle = PATH_DOT_COLOR;
      const dotSize = Math.max(2, Math.round(t * 0.16));
      for (const p of state.path) {
        const dx = Math.round(p.x * t + t / 2 - dotSize / 2);
        const dy = Math.round(p.y * t + t / 2 - dotSize / 2);
        ctx.fillRect(dx, dy, dotSize, dotSize);
      }
    }

    // Pointer: square outline.
    if (state.pointer) {
      const size = Math.round(t * 0.7);
      const px = Math.round(state.pointer.x * t + (t - size) / 2);
      const py = Math.round(state.pointer.y * t + (t - size) / 2);
      ctx.strokeStyle = POINTER_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
    }

    // Doors. Drawn 1 tile wide x 1.5 tiles tall, anchored to the bottom of
    // their tile, so the top half overlaps the wall tile above — extend the
    // range one extra tile upward so a door sitting on the margin's top row
    // still gets drawn (its overdraw would otherwise poke above the range
    // that was actually blitted from the static level canvas).
    const doorStartY = Math.max(0, startY - 1);
    for (const door of state.level.doors) {
      if (this.inRange(door.pos, startX, endX, doorStartY, endY)) this.drawDoor(ctx, door, t);
    }

    // Keys (untaken only).
    for (const k of state.level.keys) {
      if (!k.taken && this.inRange(k.pos, startX, endX, startY, endY)) this.drawKey(ctx, k, t);
    }

    // Shrine alcoves. Drawn before the chests and monsters because they are
    // ground, not furniture: the hero walks over one to light it.
    for (const sh of state.level.shrines ?? []) {
      if (this.inRange(sh.pos, startX, endX, startY, endY)) this.drawShrine(ctx, sh, t);
    }

    // The wings' floor furniture: runes, cradles, relics and orbs are ground
    // or pickups, drawn before anything solid. All of it is hidden ground, so
    // all of it goes through the slot the wing makes in the wall.
    for (const r of state.level.runes ?? []) {
      if (this.inRange(r.pos, startX, endX, startY, endY)) this.drawBehindWall(ctx, state, r.pos, t, () => this.drawRune(ctx, r, t));
    }
    for (const sl of state.level.seals ?? []) {
      if (sl.lock.kind !== 'orb') continue;
      const at = sl.lock.socket;
      if (this.inRange(at, startX, endX, startY, endY)) this.drawBehindWall(ctx, state, at, t, () => this.drawSocket(ctx, at, t));
    }
    for (const r of state.level.relics ?? []) {
      if (!r.taken && this.inRange(r.pos, startX, endX, startY, endY)) this.drawBehindWall(ctx, state, r.pos, t, () => this.drawRelic(ctx, r, t));
    }
    for (const o of state.level.orbs ?? []) {
      if (o.state === 'carried' || !this.inRange(o.pos, startX, endX, startY, endY)) continue;
      this.drawBehindWall(ctx, state, o.pos, t, () => this.drawOrb(ctx, o.pos, t, o.state === 'placed' ? 0.55 : 0.6, true));
    }

    // Seals and altars are solid, like chests, and drawn with them.
    for (const sl of state.level.seals ?? []) {
      if (this.inRange(sl.pos, startX, endX, startY, endY)) this.drawBehindWall(ctx, state, sl.pos, t, () => this.drawSeal(ctx, sl, t));
    }
    for (const a of state.level.altars ?? []) {
      if (this.inRange(a.pos, startX, endX, startY, endY)) this.drawBehindWall(ctx, state, a.pos, t, () => this.drawAltar(ctx, a, t));
    }

    // A boss world's own ground props (see engine/worlds): floor, not
    // furniture, so drawn before the chests and monsters exactly as a shrine
    // alcove is.
    for (const p of state.level.props ?? []) {
      if (p.hidden || p.solid) continue;
      if (this.inRange(p.pos, startX, endX, startY, endY)) this.drawProp(ctx, p, t, 0.7);
    }

    // Chests. A wing's chest stands on hidden ground, so it is drawn through
    // the slot the wing makes, like everything else in there.
    for (const c of state.level.chests) {
      if (!this.inRange(c.pos, startX, endX, startY, endY)) continue;
      this.drawBehindWall(ctx, state, c.pos, t, () => this.drawChest(ctx, c, t));
    }

    // A boss world's solid props, drawn in the same pass as the chests: a
    // statue, a symbol, a crypt door, the portal home.
    for (const p of state.level.props ?? []) {
      if (p.hidden || !p.solid) continue;
      if (this.inRange(p.pos, startX, endX, startY, endY)) this.drawProp(ctx, p, t, 0.8);
    }

    // Exit. Hidden while the necromancer still stands on it (his tile IS the
    // exit from the start; it only appears once he flees).
    const necroBlocksExit =
      state.level.kind === 'boss' && state.level.boss?.kind === 'necromancer' && !state.level.boss.defeated;
    if (!necroBlocksExit && this.inRange(state.level.exit, startX, endX, startY, endY)) {
      this.drawTileSprite(ctx, this.exitSprite, state.level.exit, t, 0.86);
    }
    // The wing's own stairs, in its treasure room: hidden ground like the rest.
    const wingExit = state.level.wingExit;
    if (wingExit && this.inRange(wingExit, startX, endX, startY, endY)) {
      this.drawBehindWall(ctx, state, wingExit, t, () => this.drawTileSprite(ctx, this.exitSprite, wingExit, t, 0.86));
    }

    // Shop podiums. Each covers a 2x2 block and draws taller than that (the
    // item floats above it, the price tag hangs below), so the range test is
    // deliberately generous.
    if (state.level.kind === 'shop' && state.level.shop) {
      const dimmed = state.level.shop.bought;
      for (const offer of state.level.shop.offers) {
        const near =
          offer.pos.x + PODIUM_TILES > startX - 1 &&
          offer.pos.x < endX + 1 &&
          offer.pos.y + PODIUM_TILES > startY - 2 &&
          offer.pos.y < endY + 2;
        if (near) this.drawShopOffer(ctx, offer, dimmed, t);
      }
      const forge = state.level.shop.forge;
      if (forge && this.inRange(forge.pos, startX - 2, endX + 2, startY - 2, endY + 2)) this.drawForge(ctx, forge, dimmed, t);
    }

    // Monsters.
    for (const m of state.level.monsters) {
      if (!m.alive || !this.inRange(m.pos, startX, endX, startY, endY)) continue;
      this.drawBehindWall(ctx, state, m.pos, t, () => this.drawMonster(ctx, m, t));
    }

    // The wall goes back on. Everything above has been drawn as if the floor
    // had nothing to hide; this paints the passages' brick over the top of it
    // again, with a soft hole at the hero's feet where the lens is looking.
    // Doing it here rather than per-sprite is what keeps a monster standing in
    // a passage exactly as visible as the floor it is standing on — and it
    // catches the trail, the drag line and the loot as well, none of which
    // should be traceable through a wall.
    if (hiddenBox) this.drawPassageVeil(ctx, state, hiddenBox);

    // Hero (always near the viewport center), and the orb in their arms.
    this.drawHero(ctx, state.hero, t);
    if (carriedOrb(state)) this.drawCarriedOrb(ctx, state.hero, t);
    const cprop = carriedProp(state);
    if (cprop) this.drawCarriedProp(ctx, state.hero, cprop, t);

    // keyCompass: arrow hovering over the hero, pointing at the tracked tile.
    if (state.compass) this.drawCompass(ctx, state.hero, state.compass, t);

    // Effects on top.
    for (const fx of state.fx) this.drawEffect(ctx, fx, t);

    // Shrine timers last of all: an alcove the hero is standing next to sits
    // in exactly the space these pips float in, so they go over everything.
    this.drawBuffs(ctx, state.hero, t);

    // Necromancer spell clock — screen space, top of the viewport, hidden
    // once he's beaten. Resets the transform itself (like the descend fade
    // below); nothing is drawn in camera space after this.
    if (state.level.kind === 'boss' && state.level.boss?.kind === 'necromancer' && !state.level.boss.defeated) {
      this.drawSpellClock(ctx, state.level.boss.spellMs, state.level.boss.spellTotalMs);
    }

    // 4. Descend fade — screen space, covers the whole viewport regardless
    // of camera position.
    if (state.descending > 0) {
      const alpha = Math.max(0, Math.min(1, 1 - state.descending / 700));
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
  }

  // -- drawing helpers -----------------------------------------------------

  private drawTileSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, pos: Vec, t: number, scale: number): void {
    const size = Math.round(t * scale);
    const x = Math.round(pos.x * t + (t - size) / 2);
    const y = Math.round(pos.y * t + (t - size) / 2);
    ctx.drawImage(sprite, x, y, size, size);
  }

  private drawHpBar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    w: number,
    h: number,
    frac: number,
    color: string,
  ): void {
    const x = Math.round(cx - w / 2);
    const y = Math.round(topY);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, h);
    const fw = Math.round(w * Math.max(0, Math.min(1, frac)));
    ctx.fillStyle = color;
    ctx.fillRect(x, y, fw, h);
  }

  /**
   * The door sprite is 16 wide x 24 tall (1 tile x 1.5 tiles), anchored to
   * the BOTTOM of the door's own tile so the tall arch sits on the doorway
   * floor rather than floating.
   */
  private drawDoor(ctx: CanvasRenderingContext2D, door: Door, t: number): void {
    const x = Math.round(door.pos.x * t);
    const h = Math.round(t * 1.5);
    const y = Math.round((door.pos.y + 1) * t) - h;
    if (!door.open) {
      this.drawDoorGlow(ctx, x, y, t, h);
      ctx.drawImage(this.doorClosedSprite, x, y, t, h);
    } else {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.drawImage(this.doorOpenSprite, x, y, t, h);
      ctx.restore();
    }
  }

  /** Faint pulsing purple outline around a closed door's whole sprite box. */
  private drawDoorGlow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const alpha = 0.5 + 0.25 * Math.sin((performance.now() / 1800) * Math.PI * 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = DOOR_KEY_BODY;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  private drawKey(ctx: CanvasRenderingContext2D, k: KeyItem, t: number): void {
    const isDoor = k.kind === 'door';
    // Door keys are drawn noticeably bigger than other pickups (including
    // the chest key) so their bold eye-ring silhouette reads at a glance.
    const bsize = Math.round(t * (isDoor ? 1.05 : 0.78));
    const bgx = Math.round(k.pos.x * t + (t - bsize) / 2);
    const bgy = Math.round(k.pos.y * t + (t - bsize) / 2);
    ctx.fillStyle = isDoor ? 'rgba(181,108,255,0.22)' : 'rgba(245,196,81,0.22)';
    ctx.fillRect(bgx, bgy, bsize, bsize);

    // Door keys are magical: a soft pulsing purple ring + orbiting sparkles.
    // Chest keys just get the plain disk above.
    if (isDoor) this.drawKeyAura(ctx, k.pos, t);

    const size = Math.round(t * (isDoor ? 0.95 : 0.6));
    const bx = Math.round(k.pos.x * t + (t - size) / 2);
    const by = Math.round(k.pos.y * t + (t - size) / 2);
    ctx.drawImage(isDoor ? this.doorKeySprite : this.chestKeySprite, bx, by, size, size);
  }

  /**
   * Animated aura for an untaken door key: a square ring pulsing 0.3-0.9
   * alpha over ~1.2s, plus three tiny sparkles orbiting the key at staggered
   * phases in pink/white. Everything snaps to the SUB sub-pixel grid, same
   * as the other drifting effects (drawZzz, poison bubbles, ...).
   */
  private drawKeyAura(ctx: CanvasRenderingContext2D, pos: Vec, t: number): void {
    const sub = Math.max(1, t / SUB);
    const now = performance.now();
    const cx = pos.x * t + t / 2;
    const cy = pos.y * t + t / 2;

    // Ring sits just outside the (bigger, 0.95-tile) key sprite.
    const ringAlpha = 0.6 + 0.3 * Math.sin((now / 1200) * Math.PI * 2);
    const ringSize = Math.round((t * 1.12) / sub) * sub;
    const rx = Math.round((cx - ringSize / 2) / sub) * sub;
    const ry = Math.round((cy - ringSize / 2) / sub) * sub;
    ctx.save();
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = KEY_AURA_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, ringSize - 1, ringSize - 1);
    ctx.restore();

    const orbitR = t * 0.65;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const phase = (((now / 1100 + i / 3) % 1) + 1) % 1;
      const ang = phase * Math.PI * 2;
      const sx = Math.round((cx + Math.cos(ang) * orbitR) / sub) * sub;
      const sy = Math.round((cy + Math.sin(ang) * orbitR) / sub) * sub;
      ctx.globalAlpha = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + i));
      ctx.fillStyle = KEY_AURA_SPARKLE_COLORS[i];
      ctx.fillRect(sx, sy, sub, sub);
    }
    ctx.restore();
  }

  private drawChest(ctx: CanvasRenderingContext2D, c: Chest, t: number): void {
    if (c.mimic && !c.opened) {
      // The tell: a shiver, now and then, of a sub-pixel or two. Phased off
      // the chest's own tile so two mimics never twitch in step.
      const sub = Math.max(1, t / SUB);
      const phase = (performance.now() + hash2(c.pos.x, c.pos.y) % MIMIC_TELL_EVERY_MS) % MIMIC_TELL_EVERY_MS;
      if (phase < MIMIC_TELL_MS) {
        const jog = Math.round(Math.sin((phase / MIMIC_TELL_MS) * Math.PI * 4) * sub);
        ctx.save();
        ctx.translate(jog, 0);
        this.drawTileSprite(ctx, this.chestClosedSprite, c.pos, t, 0.8);
        ctx.restore();
        return;
      }
    }
    this.drawTileSprite(ctx, c.opened ? this.chestOpenSprite : this.chestClosedSprite, c.pos, t, 0.8);
  }

  /**
   * A rune on the floor of a wing: its shape, dim until it is lit, and a soft
   * wash of the lens' blue behind it once it is, so the row of lit ones reads
   * as a row from across the room.
   */
  private drawRune(ctx: CanvasRenderingContext2D, r: Rune, t: number): void {
    const sprite = this.runeSprites[((r.glyph % RUNE_COUNT) + RUNE_COUNT) % RUNE_COUNT];
    if (!sprite) return;
    if (r.lit) {
      ctx.save();
      ctx.globalAlpha = RUNE_LIT_ALPHA + 0.08 * (0.5 + 0.5 * Math.sin(performance.now() / 500));
      ctx.fillStyle = RUNE_GLOW;
      ctx.fillRect(Math.round(r.pos.x * t), Math.round(r.pos.y * t), t, t);
      ctx.restore();
    }
    this.drawTileSprite(ctx, r.lit ? sprite.lit : sprite.dim, r.pos, t, 0.7);

    // A seal that tells its order on the runes themselves: this rune's place
    // in it, as a row of dots along the bottom of the tile.
    const place = this.runePlace(r);
    if (place > 0) {
      const sub = Math.max(1, t / SUB);
      const dot = Math.max(1, Math.round(sub));
      const gap = dot;
      const rowW = place * dot + (place - 1) * gap;
      let x = Math.round((r.pos.x * t + (t - rowW) / 2) / sub) * sub;
      const y = Math.round((r.pos.y * t + t - dot * 2) / sub) * sub;
      ctx.save();
      ctx.fillStyle = r.lit ? RUNE_GLOW : PRICE_TEXT;
      ctx.globalAlpha = r.lit ? 1 : 0.8;
      for (let i = 0; i < place; i++) {
        ctx.fillRect(x, y, dot, dot);
        x += dot + gap;
      }
      ctx.restore();
    }
  }

  /** This rune's place in its seal's order (1-based), when the seal shows it on the runes; 0 otherwise. */
  private runePlace(r: Rune): number {
    for (const s of this.level?.seals ?? []) {
      if (s.id !== r.sealId || s.lock.kind !== 'runes' || s.lock.hint !== 'pips') continue;
      return s.lock.order.indexOf(r.id) + 1;
    }
    return 0;
  }

  /** The cradle before an orb seal: a ring on the floor. */
  private drawSocket(ctx: CanvasRenderingContext2D, at: Vec, t: number): void {
    this.drawTileSprite(ctx, this.socketSprite, at, t, 1);
  }

  /** A relic lying where a wing left it: gold and a slow gold ring, so it is never walked past. */
  private drawRelic(ctx: CanvasRenderingContext2D, r: Relic, t: number): void {
    const sprite = this.relicSprites.get(r.kind);
    if (!sprite) return;
    const now = performance.now();
    const cx = r.pos.x * t + t / 2;
    const cy = r.pos.y * t + t / 2;
    const ringSize = Math.round(t * (0.8 + 0.2 * (0.5 + 0.5 * Math.sin(now / 800))));
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(now / 800));
    ctx.strokeStyle = PRICE_COIN;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(cx - ringSize / 2) + 0.5, Math.round(cy - ringSize / 2) + 0.5, ringSize - 1, ringSize - 1);
    ctx.restore();
    this.drawTileSprite(ctx, sprite, r.pos, t, 0.62);
  }

  /** The orb: a glass ball with a breathing blue halo, wherever it is. */
  private drawOrb(ctx: CanvasRenderingContext2D, at: Vec, t: number, scale: number, halo: boolean): void {
    const cx = at.x * t + t / 2;
    const cy = at.y * t + t / 2;
    if (halo) {
      const glow = Math.round(t * (0.9 + 0.15 * (0.5 + 0.5 * Math.sin(performance.now() / 600))));
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = RUNE_GLOW;
      ctx.fillRect(Math.round(cx - glow / 2), Math.round(cy - glow / 2), glow, glow);
      ctx.restore();
    }
    this.drawTileSprite(ctx, this.orbSprite, at, t, scale);
  }

  /** The orb in the hero's arms: held up and to the side, bobbing with the step. */
  private drawCarriedOrb(ctx: CanvasRenderingContext2D, hero: Hero, t: number): void {
    const sub = Math.max(1, t / SUB);
    const size = Math.round(t * 0.42);
    const bob = Math.round((Math.sin(performance.now() / 300) * sub) / sub) * sub;
    const x = Math.round((hero.rpos.x * t + t * 0.62) / sub) * sub;
    const y = Math.round((hero.rpos.y * t - t * 0.05 + bob) / sub) * sub;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = RUNE_GLOW;
    ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
    ctx.restore();
    ctx.drawImage(this.orbSprite, x, y, size, size);
  }

  /**
   * A boss world's prop art, built the first time this `art`/`state` pair is
   * drawn and cached after (see `propSprites`). Null when the module named an
   * art key nothing registered — drawn as nothing, the same as a monster
   * whose sprite key does not resolve.
   */
  private getPropSprite(art: string, state?: string): HTMLCanvasElement | null {
    const k = state ? `${art}:${state}` : art;
    const cached = this.propSprites.get(k);
    if (cached) return cached;
    const spec = propArt(art, state);
    if (!spec) return null;
    const sprite = buildIcon(spec.rows as string[], spec.palette as Record<string, string>);
    this.propSprites.set(k, sprite);
    return sprite;
  }

  /** A prop standing on the floor: solid ones a touch bigger than ground ones. */
  private drawProp(ctx: CanvasRenderingContext2D, p: Prop, t: number, scale: number): void {
    const sprite = this.getPropSprite(p.art, p.state);
    if (!sprite) return;
    this.drawTileSprite(ctx, sprite, p.pos, t, scale);
  }

  /** A carried prop in the hero's arms, held exactly where a carried orb is. */
  private drawCarriedProp(ctx: CanvasRenderingContext2D, hero: Hero, prop: Prop, t: number): void {
    const sprite = this.getPropSprite(prop.art, prop.state);
    if (!sprite) return;
    const sub = Math.max(1, t / SUB);
    const size = Math.round(t * 0.42);
    const bob = Math.round((Math.sin(performance.now() / 300) * sub) / sub) * sub;
    const x = Math.round((hero.rpos.x * t + t * 0.62) / sub) * sub;
    const y = Math.round((hero.rpos.y * t - t * 0.05 + bob) / sub) * sub;
    ctx.drawImage(sprite, x, y, size, size);
  }

  /**
   * A sealed door: a slab across its tile with the lock carved into it. A
   * rune seal that tells its order shows the shapes in a row; a keystone seal
   * shows the relic it wants; an orb seal an empty circle. Open, only the
   * frame is left, sunk into the floor.
   */
  private drawSeal(ctx: CanvasRenderingContext2D, sl: Seal, t: number): void {
    const bx = Math.round(sl.pos.x * t);
    const by = Math.round(sl.pos.y * t);
    if (sl.open) {
      ctx.save();
      ctx.globalAlpha = SPENT_ALPHA;
      ctx.drawImage(this.sealOpenSprite, bx, by, t, t);
      ctx.restore();
      return;
    }
    ctx.drawImage(this.sealSprite, bx, by, t, t);
    const nx = bx + t * SEAL_NICHE.x;
    const ny = by + t * SEAL_NICHE.y;
    const ns = t * SEAL_NICHE.size;
    const lock = sl.lock;
    ctx.save();
    ctx.globalAlpha = 0.85;
    if (lock.kind === 'runes' && lock.hint === 'seal') {
      // The order, reading left to right and then down, in glyphs small
      // enough to fit the panel: one row for three, two rows past that.
      const n = lock.order.length;
      const perRow = n > 3 ? Math.ceil(n / 2) : n;
      const rowsN = Math.ceil(n / perRow);
      const cell = ns / perRow;
      const rowH = ns / rowsN;
      const size = Math.max(3, Math.round(Math.min(cell, rowH) * 0.8));
      lock.order.forEach((id, i) => {
        const glyph = this.runeGlyphOf(id);
        const sprite = glyph === null ? null : this.runeSprites[glyph];
        if (!sprite) return;
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const x = Math.round(nx + cell * col + (cell - size) / 2);
        const y = Math.round(ny + rowH * row + (rowH - size) / 2);
        ctx.drawImage(sprite.lit, x, y, size, size);
      });
    } else if (lock.kind === 'keystone') {
      const sprite = this.relicSprites.get(lock.relic);
      const size = Math.round(ns * 0.8);
      if (sprite) ctx.drawImage(sprite, Math.round(nx + (ns - size) / 2), Math.round(ny + (ns - size) / 2), size, size);
    } else if (lock.kind === 'orb') {
      const size = Math.round(ns * 0.6);
      ctx.strokeStyle = RUNE_GLOW;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(nx + (ns - size) / 2) + 0.5, Math.round(ny + (ns - size) / 2) + 0.5, size - 1, size - 1);
    } else {
      // Runes hinted on the runes themselves, or not at all: a bare glow.
      ctx.globalAlpha = 0.25 + 0.15 * (0.5 + 0.5 * Math.sin(performance.now() / 700));
      ctx.fillStyle = RUNE_GLOW;
      ctx.fillRect(Math.round(nx), Math.round(ny), Math.round(ns), Math.round(ns));
    }
    ctx.restore();
  }

  /** The shape a rune id shows, looked up off the current level. */
  private runeGlyphOf(id: string): number | null {
    for (const r of this.level?.runes ?? []) if (r.id === id) return ((r.glyph % RUNE_COUNT) + RUNE_COUNT) % RUNE_COUNT;
    return null;
  }

  /**
   * An altar: a stone block with the trophy it wants carved into its face,
   * dim as stone. Spent, it is scenery.
   */
  private drawAltar(ctx: CanvasRenderingContext2D, a: Altar, t: number): void {
    const bx = Math.round(a.pos.x * t);
    const by = Math.round(a.pos.y * t);
    ctx.save();
    if (a.used) ctx.globalAlpha = SPENT_ALPHA;
    ctx.drawImage(this.altarSprite, bx, by, t, t);
    const sprite = this.trophySprites.get(a.trophy);
    if (sprite && !a.used) {
      const size = Math.round(t * ALTAR_NICHE.size);
      ctx.globalAlpha = 0.55 + 0.2 * (0.5 + 0.5 * Math.sin(performance.now() / 900));
      ctx.drawImage(sprite, Math.round(bx + t * ALTAR_NICHE.x), Math.round(by + t * ALTAR_NICHE.y), size, size);
    }
    ctx.restore();
  }

  /** The shop's forge: a 2x2 block like a podium, dimmed with the rest once anything is bought. */
  private drawForge(ctx: CanvasRenderingContext2D, forge: ShopForge, dimmed: boolean, t: number): void {
    const block = PODIUM_TILES * t;
    const bx = Math.round(forge.pos.x * t);
    const by = Math.round(forge.pos.y * t);
    ctx.save();
    if (dimmed) ctx.globalAlpha = PEDESTAL_DIM_ALPHA;
    // The coals breathe.
    ctx.drawImage(this.forgeSprite, bx, by, Math.round(block), Math.round(block));
    ctx.globalAlpha = (dimmed ? PEDESTAL_DIM_ALPHA : 1) * (0.1 + 0.1 * (0.5 + 0.5 * Math.sin(performance.now() / 450)));
    ctx.fillStyle = '#ff8c3a';
    ctx.fillRect(Math.round(bx + block * 0.3), Math.round(by), Math.round(block * 0.4), Math.round(block * 0.25));
    ctx.restore();
  }

  /**
   * A shrine alcove: a stone arch sunk into the tile with the shrine's glyph
   * glowing in the niche. An unlit one breathes — a slow ring around it and
   * the glyph brightening and dimming — so it reads as "worth a detour" from
   * across the room. A spent one is left as faint stonework with no glow, so
   * the player can see at a glance which alcoves they have already taken.
   */
  private drawShrine(ctx: CanvasRenderingContext2D, sh: Shrine, t: number): void {
    const color = SHRINE_COLORS[sh.kind];
    const cx = sh.pos.x * t + t / 2;
    const cy = sh.pos.y * t + t / 2;
    const now = performance.now();

    // The unlit glow sits behind the stone, so the arch reads as backlit.
    if (!sh.used) {
      const glow = 0.18 + 0.14 * (0.5 + 0.5 * Math.sin(now / 700));
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(sh.pos.x * t), Math.round(sh.pos.y * t), t, t);
      ctx.restore();
    }

    const box = Math.round(t * ALCOVE_SCALE);
    const bx = Math.round(sh.pos.x * t + (t - box) / 2);
    const by = Math.round(sh.pos.y * t + (t - box) / 2);

    ctx.save();
    if (sh.used) ctx.globalAlpha = SHRINE_SPENT_ALPHA;
    ctx.drawImage(this.alcoveSprite, bx, by, box, box);

    const sprite = this.shrineSprites.get(sh.kind);
    if (sprite) {
      const size = Math.round(box * ALCOVE_NICHE.size);
      const x = Math.round(bx + box * ALCOVE_NICHE.x);
      const y = Math.round(by + box * ALCOVE_NICHE.y);
      if (!sh.used) ctx.globalAlpha = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(now / 520));
      ctx.drawImage(sprite, x, y, size, size);
    }
    ctx.restore();

    if (sh.used) return;

    // A slow ring breathing outward, the same square outline every other aura
    // in the game uses.
    const ringSize = Math.round(t * (0.9 + 0.16 * (0.5 + 0.5 * Math.sin(now / 700))));
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(now / 700));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(cx - ringSize / 2) + 0.5, Math.round(cy - ringSize / 2) + 0.5, ringSize - 1, ringSize - 1);
    ctx.restore();
  }

  /**
   * A shop podium: a 2x2 stone block with the slot emblem sunk into its face
   * (sword = offense, shield = defense, star = spirit), the item floating
   * above it, and the price on a tag hanging underneath.
   */
  private drawShopOffer(ctx: CanvasRenderingContext2D, offer: ShopOffer, dimmed: boolean, t: number): void {
    const block = PODIUM_TILES * t;
    const bx = Math.round(offer.pos.x * t);
    const by = Math.round(offer.pos.y * t);
    const cx = bx + block / 2;

    ctx.save();
    if (dimmed) ctx.globalAlpha = PEDESTAL_DIM_ALPHA;

    // The block itself.
    ctx.drawImage(this.podiumSprite, bx, by, Math.round(block), Math.round(block));

    // Slot emblem, sunk into the niche in the middle of the face.
    const slotSprite = this.slotSprites.get(ITEM_SLOT[offer.item.kind]);
    if (slotSprite) {
      const size = Math.round(block * PODIUM_NICHE.size);
      const x = Math.round(bx + block * PODIUM_NICHE.x);
      const y = Math.round(by + block * PODIUM_NICHE.y);
      ctx.drawImage(slotSprite, x, y, size, size);
    }

    // The item on offer, floating just above the podium.
    const itemSprite = this.itemSprites.get(offer.item.kind);
    if (itemSprite) {
      const size = Math.round(t * 1.2);
      const iy = Math.round(by - size * 0.72);
      const ix = Math.round(cx - size / 2);
      ctx.drawImage(itemSprite, ix, iy, size, size);
    }
    ctx.restore();

    // Price tag: dark box + coin + number, hanging under the podium.
    ctx.save();
    if (dimmed) ctx.globalAlpha = PEDESTAL_DIM_ALPHA;
    const fontPx = Math.max(7, Math.round(t * 0.3));
    const label = `${offer.price}`;
    ctx.font = `${fontPx}px "Press Start 2P", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const coinSize = Math.max(4, Math.round(t * 0.22));
    const textW = Math.round(fontPx * 0.72 * label.length);
    const boxW = coinSize + 4 + textW + 8;
    const boxH = Math.max(coinSize, fontPx) + 6;
    const bxTag = Math.round(cx - boxW / 2);
    const byTag = Math.round(by + block - boxH * 0.4);
    ctx.fillStyle = PRICE_BG;
    ctx.fillRect(bxTag, byTag, boxW, boxH);
    ctx.fillStyle = PRICE_COIN;
    ctx.fillRect(bxTag + 3, byTag + Math.round((boxH - coinSize) / 2), coinSize, coinSize);
    ctx.fillStyle = PRICE_TEXT;
    ctx.fillText(label, bxTag + coinSize + 7, byTag + boxH / 2 + 1);
    ctx.restore();
  }

  /**
   * Ring color/pulse for every monster kind, including the boss ones, so
   * nothing new falls through to the generic lurker color by accident.
   * `crystal` deliberately isn't handled here — it draws no ring at all
   * (see drawMonster).
   */
  private ringColorFor(m: Monster): { color: string; pulse: boolean; pulseDivisor?: number } {
    if (m.kind === 'boss') {
      // Purple channelling ring; pulses faster as the spell nears completion.
      const frac = Math.max(0, Math.min(1, this.necroSpellFrac));
      return { color: RING_NECROMANCER, pulse: true, pulseDivisor: 30 + 100 * frac };
    }
    if (m.kind === 'minotaur') return { color: RING_CHASING, pulse: true }; // always hunting
    if (m.kind === 'angel') {
      // Weeping = dim grey. Awake and circling for the doors = amber. Red and
      // pulsing = the ring has shut and it is coming for you.
      if (m.state === 'idle') return { color: RING_ANGEL_IDLE, pulse: false };
      if (m.state === 'closing') return { color: RING_CHASING, pulse: true };
      return { color: RING_ANGEL_SIEGE, pulse: true, pulseDivisor: 220 };
    }
    if (m.state === 'chasing') return { color: RING_CHASING, pulse: true };
    if (m.state === 'returning') return { color: RING_RETURNING, pulse: false };
    if (m.kind === 'guard') return { color: RING_GUARD, pulse: false };
    if (m.kind === 'patrol') return { color: RING_PATROL, pulse: false };
    return { color: RING_LURKER, pulse: false };
  }

  /** Square outline ring shared by every monster and boss aura. */
  private drawRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    color: string,
    pulse: boolean,
    pulseDivisor = 130,
  ): void {
    const outlineSize = size + 4;
    const ox2 = Math.round(cx - outlineSize / 2);
    const oy2 = Math.round(cy - outlineSize / 2);
    ctx.save();
    ctx.globalAlpha = pulse ? 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / pulseDivisor)) : 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox2 + 0.5, oy2 + 0.5, outlineSize - 1, outlineSize - 1);
    ctx.restore();
  }

  /** crystal: a faint pulsing magenta glow square behind the sprite instead of a ring. */
  private drawCrystalGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const alpha = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin((performance.now() / 1400) * Math.PI * 2));
    const glowSize = Math.round(size * 1.35);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = CRYSTAL_GLOW_COLOR;
    ctx.fillRect(Math.round(cx - glowSize / 2), Math.round(cy - glowSize / 2), glowSize, glowSize);
    ctx.restore();
  }

  /** necromancer: 2-3 small purple sparks orbiting the channelling ring, like drawKeyAura. */
  private drawNecroSparks(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, t: number): void {
    const sub = Math.max(1, t / SUB);
    const now = performance.now();
    const orbitR = size * 0.62;
    ctx.save();
    for (let i = 0; i < NECRO_SPARK_COLORS.length; i++) {
      const phase = (((now / 900 + i / NECRO_SPARK_COLORS.length) % 1) + 1) % 1;
      const ang = phase * Math.PI * 2;
      const sx = Math.round((cx + Math.cos(ang) * orbitR) / sub) * sub;
      const sy = Math.round((cy + Math.sin(ang) * orbitR) / sub) * sub;
      ctx.globalAlpha = 0.5 + 0.4 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + i));
      ctx.fillStyle = NECRO_SPARK_COLORS[i];
      ctx.fillRect(sx, sy, sub, sub);
    }
    ctx.restore();
  }

  private drawMonster(ctx: CanvasRenderingContext2D, m: Monster, t: number): void {
    const sub = Math.max(1, t / SUB);
    let ox = 0;
    let oy = 0;
    if (m.lunge && m.lungeT > 0) {
      const f = (m.lungeT / LUNGE_MS) * t * 0.3;
      ox = Math.round((m.lunge.x * f) / sub) * sub;
      oy = Math.round((m.lunge.y * f) / sub) * sub;
    }
    const cx = m.rpos.x * t + t / 2 + ox;
    const cy = m.rpos.y * t + t / 2 + oy;
    // Bosses read as bigger threats than the maze roster; crystals sit a
    // touch smaller since they're furniture, not a hunter.
    const sizeScale = m.kind === 'crystal' ? 0.9 : m.kind === 'boss' ? 1.0 : m.kind === 'minotaur' ? 1.05 : 0.82;
    const size = Math.round(t * sizeScale);
    const dx = Math.round(cx - size / 2);
    const dy = Math.round(cy - size / 2);

    const spriteKey = monsterSpriteKey(m.name);
    const sprite = this.monsterSprites.get(spriteKey) ?? this.monsterSprites.get('blob');

    // Crystal gets a glow instead of a ring; everyone else gets ringColorFor's
    // ring, plus the necromancer's extra orbiting sparks.
    if (m.kind === 'crystal') {
      this.drawCrystalGlow(ctx, cx, cy, size);
    } else {
      const ring = this.ringColorFor(m);
      this.drawRing(ctx, cx, cy, size, ring.color, ring.pulse, ring.pulseDivisor);
      if (m.kind === 'boss') this.drawNecroSparks(ctx, cx, cy, size, t);
    }

    if (sprite) {
      ctx.save();
      if (spriteKey === 'wraith') ctx.globalAlpha = 0.72;
      else if (spriteKey === 'ghost') ctx.globalAlpha = 0.8;
      ctx.drawImage(sprite, dx, dy, size, size);
      ctx.restore();
    }

    // poisonDagger: green tint + one or two bubbles rising on a time cycle.
    if (m.poisonMs > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = POISON_TINT;
      ctx.fillRect(dx, dy, size, size);
      ctx.restore();

      const now = performance.now();
      const bubbleSize = Math.max(1, Math.round(sub));
      for (let i = 0; i < 2; i++) {
        const phase = (((now / 900 + i / 2) % 1) + 1) % 1;
        const bx = Math.round((dx + size * (0.3 + i * 0.4)) / sub) * sub;
        const by = Math.round((dy + size - phase * size) / sub) * sub;
        ctx.save();
        ctx.globalAlpha = 0.55 * (1 - phase);
        ctx.fillStyle = POISON_BUBBLE;
        ctx.fillRect(bx, by, bubbleSize, bubbleSize);
        ctx.restore();
      }
    }

    // frostBlade: light-blue tint + a small ice pixel at a corner.
    if (m.slowMs > 0) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = SLOW_TINT;
      ctx.fillRect(dx, dy, size, size);
      ctx.restore();

      const iceSize = Math.max(2, Math.round(t * 0.14));
      ctx.fillStyle = ICE_PIXEL;
      ctx.fillRect(dx + size - iceSize, dy, iceSize, iceSize);
    }

    // Frost shrine: frozen solid is a whole block of ice, not a tint — a
    // hard-edged pale box over the sprite with a bright rim, so "this one is
    // not moving" reads instantly across a crowded corridor.
    if (m.frozenMs > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = FROZEN_TINT;
      ctx.fillRect(dx, dy, size, size);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ICE_PIXEL;
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 0.5, dy + 0.5, size - 1, size - 1);
      // Two glints on the block, drifting on a slow cycle.
      const now = performance.now();
      const glint = Math.max(1, Math.round(sub));
      for (let i = 0; i < 2; i++) {
        const phase = (((now / 1300 + i / 2) % 1) + 1) % 1;
        const gx = Math.round((dx + size * (0.2 + i * 0.5)) / sub) * sub;
        const gy = Math.round((dy + size * phase) / sub) * sub;
        ctx.globalAlpha = 0.8 * (1 - phase);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(gx, gy, glint, glint);
      }
      ctx.restore();
    }

    if (m.kind === 'guard') {
      const bsize = Math.round(t * 0.32);
      const bx = Math.round(cx + size / 2 - bsize * 0.6);
      const by = Math.round(cy - size / 2 - bsize * 0.4);
      ctx.drawImage(this.shieldBadgeSprite, bx, by, bsize, bsize);
    }

    // Level badge: small dark tag at the bottom-right corner of the sprite.
    // Crystals are furniture (no threat level to compare) and the
    // necromancer already has his own spell-clock UI, so both skip it.
    if (m.kind !== 'crystal' && m.kind !== 'boss') {
      const fontPx = Math.max(6, Math.round(t * 0.26));
      const label = `${m.level}`;
      ctx.save();
      ctx.font = `${fontPx}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = Math.round(fontPx * 0.9 * label.length + 4);
      const h = fontPx + 3;
      const bx = Math.round(cx + size / 2 - w * 0.7);
      const by = Math.round(cy + size / 2 - h * 0.55);
      ctx.fillStyle = 'rgba(5,5,9,0.9)';
      ctx.fillRect(bx, by, w, h);
      ctx.strokeStyle = m.level > this.heroLevel ? '#e53b3b' : m.level < this.heroLevel ? '#43d17c' : '#8f8ca8';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
      ctx.fillStyle = '#f0ecff';
      ctx.fillText(label, bx + w / 2, by + h / 2 + 1);
      ctx.restore();
    }

    if (m.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(dx, dy, size, size);
      ctx.restore();
    }

    if (m.hp < m.maxHp) {
      this.drawHpBar(ctx, cx, dy - Math.max(2, Math.round(t * 0.14)), size, Math.max(1, Math.round(t / SUB)), m.hp / m.maxHp, HP_BAR_COLOR);
    }
  }

  private drawHero(ctx: CanvasRenderingContext2D, hero: Hero, t: number): void {
    const sub = Math.max(1, t / SUB);
    let ox = 0;
    let oy = 0;
    if (hero.lunge && hero.lungeT > 0) {
      const f = (hero.lungeT / LUNGE_MS) * t * 0.3;
      ox = Math.round((hero.lunge.x * f) / sub) * sub;
      oy = Math.round((hero.lunge.y * f) / sub) * sub;
    }
    const cx = hero.rpos.x * t + t / 2 + ox;
    const cy = hero.rpos.y * t + t / 2 + oy;
    const size = Math.round(t * 0.86);
    const dx = Math.round(cx - size / 2);
    const dy = Math.round(cy - size / 2);
    const stunned = hero.stun > 0 || hero.sleeping;

    const outlineSize = size + 4;
    const ox2 = Math.round(cx - outlineSize / 2);
    const oy2 = Math.round(cy - outlineSize / 2);
    ctx.strokeStyle = stunned ? HERO_RING_STUNNED : HERO_RING_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox2 + 0.5, oy2 + 0.5, outlineSize - 1, outlineSize - 1);

    // shieldAmulet: a pulsing blue bubble ring just outside the gold ring.
    if (hero.shieldReady) {
      const bubbleSize = outlineSize + 4;
      const bx2 = Math.round(cx - bubbleSize / 2);
      const by2 = Math.round(cy - bubbleSize / 2);
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() / 160));
      ctx.strokeStyle = SHIELD_BUBBLE_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx2 + 0.5, by2 + 0.5, bubbleSize - 1, bubbleSize - 1);
      ctx.restore();
    }

    // berserkerAxe: a pulsing red ring while at or below half hearts.
    if (hero.gear.offense?.kind === 'berserkerAxe' && hero.hp * 2 <= hero.maxHp) {
      const ringSize = outlineSize + (hero.shieldReady ? 8 : 4);
      const rx = Math.round(cx - ringSize / 2);
      const ry = Math.round(cy - ringSize / 2);
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / 110));
      ctx.strokeStyle = BERSERK_RING_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(rx + 0.5, ry + 0.5, ringSize - 1, ringSize - 1);
      ctx.restore();
    }

    ctx.save();
    if (hero.facing === 'W') {
      // No separate W art: mirror the E (right-facing) profile sprite.
      ctx.translate(cx, cy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.heroSprites.E, -size / 2, -size / 2, size, size);
    } else {
      ctx.drawImage(this.heroSprites[hero.facing], dx, dy, size, size);
    }
    ctx.restore();

    if (hero.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = HP_BAR_COLOR;
      ctx.fillRect(dx, dy, size, size);
      ctx.restore();
    }

    if (hero.hp < hero.maxHp) {
      this.drawHpBar(ctx, cx, dy - Math.max(2, Math.round(t * 0.16)), size, Math.max(1, Math.round(t / SUB)), hero.hp / hero.maxHp, HP_BAR_COLOR);
    }

    if (hero.sleeping) this.drawZzz(ctx, cx, dy, t);
  }

  /** Three little "z"s drifting up from a sleeping hero, staggered in time. */
  private drawZzz(ctx: CanvasRenderingContext2D, cx: number, top: number, t: number): void {
    const sub = Math.max(1, t / SUB);
    const now = performance.now();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const phase = ((now / 1400 + i / 3) % 1 + 1) % 1;
      const px = Math.round((cx + t * 0.25 + phase * t * 0.35) / sub) * sub;
      const py = Math.round((top - t * 0.15 - phase * t * 0.9) / sub) * sub;
      const fontPx = Math.max(6, Math.round(t * (0.22 + phase * 0.14)));
      ctx.font = `${fontPx}px "Press Start 2P", monospace`;
      ctx.globalAlpha = phase < 0.15 ? phase / 0.15 : 1 - (phase - 0.15) / 0.85;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#050509';
      ctx.strokeText('z', px, py);
      ctx.fillStyle = '#bfe3ff';
      ctx.fillText('z', px, py);
    }
    ctx.restore();
  }

  /** keyCompass: a small gold arrow bobbing above the hero's head, pointing at `target`. */
  private drawCompass(ctx: CanvasRenderingContext2D, hero: Hero, target: Vec, t: number): void {
    const dx = target.x - hero.rpos.x;
    const dy = target.y - hero.rpos.y;
    if (dx === 0 && dy === 0) return;
    const angle = Math.atan2(dy, dx);
    const idx = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
    const sprite = this.arrowSprites.get(ARROW_ORDER[idx]);
    if (!sprite) return;

    const sub = Math.max(1, t / SUB);
    const cx = hero.rpos.x * t + t / 2;
    const topY = hero.rpos.y * t + t / 2 - t * 0.7;
    const bob = Math.sin(performance.now() / 260) * sub;
    const size = Math.round(t * 0.32);
    const x = Math.round((cx - size / 2) / sub) * sub;
    const y = Math.round((topY - size + bob) / sub) * sub;
    ctx.drawImage(sprite, x, y, size, size);
  }

  /**
   * The shrine timer: one pip per running effect, in a row floating over the
   * hero's head, above the compass arrow so the two never collide.
   *
   * There is no number anywhere. A pip is solid while the effect has time on
   * it, blinks for the last ten seconds, and blinks twice as fast for the last
   * five — so "it is about to go" is something you see out of the corner of
   * your eye mid-fight rather than something you read.
   *
   * The ward's temporary hearts have no clock (they are spent, not timed), so
   * their pip sits at the front of the row and never blinks.
   */
  private drawBuffs(ctx: CanvasRenderingContext2D, hero: Hero, t: number): void {
    const buffs = hero.buffs ?? [];
    const ward = (hero.tempHp ?? 0) > 0;
    if (buffs.length === 0 && !ward) return;

    const sub = Math.max(1, t / SUB);
    const now = performance.now();
    const size = Math.max(6, Math.round(t * 0.34));
    const gap = Math.max(1, Math.round(sub));
    const pips: { kind: ShrineKind; alpha: number }[] = [];
    if (ward) pips.push({ kind: 'ward', alpha: 1 });
    for (const b of buffs) {
      const period = BLINK_MS[buffPhase(b.ms)];
      // A blink never fades all the way out: a pip you cannot see is a pip you
      // cannot count.
      const alpha = period > 0 ? 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((now / period) * Math.PI * 2)) : 1;
      pips.push({ kind: b.kind, alpha });
    }

    const cx = hero.rpos.x * t + t / 2;
    const rowW = pips.length * size + (pips.length - 1) * gap;
    const bottom = hero.rpos.y * t + t / 2 - t * 1.32;
    const y = Math.round((bottom - size) / sub) * sub;
    let x = Math.round((cx - rowW / 2) / sub) * sub;

    for (const pip of pips) {
      const sprite = this.shrineSprites.get(pip.kind);
      ctx.save();
      // The dark plate stays nearly solid through the blink: a pip has to read
      // as HUD floating over the floor, never as something lying on it.
      ctx.globalAlpha = 0.6 + 0.4 * pip.alpha;
      ctx.fillStyle = '#050509';
      ctx.fillRect(x - 1, y - 1, size + 2, size + 2);
      ctx.globalAlpha = pip.alpha;
      ctx.strokeStyle = SHRINE_COLORS[pip.kind];
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, size + 1, size + 1);
      if (sprite) ctx.drawImage(sprite, x, y, size, size);
      ctx.restore();
      x += size + gap;
    }
  }

  /**
   * Necromancer boss level: a screen-space bar across the top of the
   * viewport showing the spell clock. Resets the transform to device pixels
   * itself (like the descend fade) since it must ignore the camera. Caller
   * is responsible for not drawing anything else in camera space after this.
   */
  private drawSpellClock(ctx: CanvasRenderingContext2D, spellMs: number, spellTotalMs: number): void {
    const frac = Math.max(0, Math.min(1, spellMs / spellTotalMs));
    const urgent = spellMs < SPELL_URGENT_MS;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const margin = 8;
    const x = margin;
    const y = margin;
    const w = Math.max(0, this.viewW - margin * 2);
    const h = 16;

    ctx.save();
    ctx.fillStyle = 'rgba(5,5,9,0.75)';
    ctx.fillRect(x, y, w, h);

    ctx.globalAlpha = urgent ? 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / 140)) : 1;
    ctx.fillStyle = urgent ? SPELL_BAR_URGENT_COLOR : SPELL_BAR_COLOR;
    ctx.fillRect(x, y, Math.round(w * frac), h);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(240,236,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0ecff';
    ctx.textAlign = 'left';
    ctx.fillText('SPELL', x + 4, y + h / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(spellMs / 1000)}s`, x + w - 4, y + h / 2 + 1);
    ctx.restore();
  }

  private drawEffect(ctx: CanvasRenderingContext2D, fx: Effect, t: number): void {
    // The game may delay an effect by pushing it with a negative `t`; the
    // renderer ages it (draw() already advanced fx.t by dt) but draws
    // nothing until it crosses 0.
    if (fx.t < 0) return;

    if (fx.kind === 'text') {
      const progress = Math.max(0, Math.min(1, fx.t / fx.ttl));
      const cx = fx.pos.x * t + t / 2;
      const cy = fx.pos.y * t + t / 2 - progress * t * 0.8;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.font = `${Math.max(6, Math.round(t * 0.32))}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, Math.round(t * 0.1));
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(fx.text, Math.round(cx), Math.round(cy));
      ctx.fillStyle = fx.color;
      ctx.fillText(fx.text, Math.round(cx), Math.round(cy));
      ctx.restore();
    } else if (fx.kind === 'flash') {
      const alpha = Math.max(0, 1 - fx.t / fx.ttl);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fx.color;
      ctx.fillRect(Math.round(fx.pos.x * t), Math.round(fx.pos.y * t), t, t);
      ctx.restore();
    } else if (fx.kind === 'bolt') {
      // lightningWand: a jagged line through `points`, jittering a little each frame.
      const progress = Math.max(0, Math.min(1, fx.t / fx.ttl));
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const jitter = t * 0.06;
      for (let i = 0; i < fx.points.length; i++) {
        const p = fx.points[i];
        const jx = i === 0 || i === fx.points.length - 1 ? 0 : (Math.random() * 2 - 1) * jitter;
        const jy = i === 0 || i === fx.points.length - 1 ? 0 : (Math.random() * 2 - 1) * jitter;
        const px = Math.round(p.x * t + t / 2 + jx);
        const py = Math.round(p.y * t + t / 2 + jy);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    } else if (fx.kind === 'projectile') {
      // fireStaff: a small square flying from `from` to `to`, with a short fading trail.
      const progress = Math.max(0, Math.min(1, fx.t / fx.ttl));
      const size = Math.max(2, Math.round(t * 0.2));
      const at = (p: number) => {
        const lx = fx.from.x + (fx.to.x - fx.from.x) * p;
        const ly = fx.from.y + (fx.to.y - fx.from.y) * p;
        return { x: Math.round(lx * t + t / 2 - size / 2), y: Math.round(ly * t + t / 2 - size / 2) };
      };
      ctx.save();
      ctx.fillStyle = fx.color;
      for (let i = 2; i >= 1; i--) {
        const tp = Math.max(0, progress - i * 0.07);
        const pos = at(tp);
        ctx.globalAlpha = 0.22 * (1 - i / 3);
        ctx.fillRect(pos.x, pos.y, size, size);
      }
      const head = at(progress);
      ctx.globalAlpha = 1;
      ctx.fillRect(head.x, head.y, size, size);
      ctx.restore();
    } else if (fx.kind === 'ring') {
      // shieldAmulet / bubble pop: a square outline expanding from 0 to `radius` tiles.
      const progress = Math.max(0, Math.min(1, fx.t / fx.ttl));
      const cx = fx.pos.x * t + t / 2;
      const cy = fx.pos.y * t + t / 2;
      const size = Math.max(1, Math.round(fx.radius * progress * t * 2));
      const x = Math.round(cx - size / 2);
      const y = Math.round(cy - size / 2);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = Math.max(1, Math.round(t * 0.05));
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      ctx.restore();
    } else if (fx.kind === 'slash') {
      // longSword: a straight, fading line from `from` to `to` with a dark outline.
      const progress = Math.max(0, Math.min(1, fx.t / fx.ttl));
      const x1 = Math.round(fx.from.x * t + t / 2);
      const y1 = Math.round(fx.from.y * t + t / 2);
      const x2 = Math.round(fx.to.x * t + t / 2);
      const y2 = Math.round(fx.to.y * t + t / 2);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.lineCap = 'square';
      ctx.strokeStyle = '#050509';
      ctx.lineWidth = Math.max(3, Math.round(t * 0.16));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = Math.max(1, Math.round(t * 0.08));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
    // 'shake' has no direct visual draw — it's folded into the camera translate.
  }
}
