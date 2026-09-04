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
} from '../engine/types';
import { ITEM_ART, SLOT_ART, PEDESTAL_ART } from './itemArt';
import { themeById } from '../engine/themes';
import { MONSTER_CFGS, creatureRows, monsterSpriteKey } from './monsterArt';

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

// Shop pedestal / price tag.
const PEDESTAL_DIM_ALPHA = 0.35;
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

const HERO_ROWS = ['..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SSEESS.', '..SSSS..', '.AAAAAD.', 'CAAGGAAC', '.B....B.'];
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

// Chest key: a plain gold classic key (loop bow + toothed shaft), with a
// darker-gold shade on the lower arc and teeth for a little depth.
const CHEST_KEY_ROWS = ['........', '.GGG....', 'G...G...', 'G..GGGGG', '.GGD...D', '......D.', '........', '........'];
const CHEST_KEY_GOLD = '#f5c451';
const CHEST_KEY_GOLD_DARK = '#c9931e';
const CHEST_KEY_PALETTE: Record<string, string> = { G: CHEST_KEY_GOLD, D: CHEST_KEY_GOLD_DARK };

// Door key: the same classic bow-and-shaft silhouette, recolored purple/
// magenta and topped with two tiny devil horns rising off the bow — the
// "magic" counterpart to the plain gold chest key. Same rows/palette are
// reused for the HUD icon (icons.tsx) so the two read as a matched pair.
const DOOR_KEY_BODY = '#b56cff';
const DOOR_KEY_DARK = '#6d2fb0';
const DOOR_KEY_HORN = '#ff5c8a';
const DOOR_KEY_HILITE = '#ffffff';
const DOOR_KEY_ROWS = ['.H.H....', '.WPP....', 'P...P...', 'P..PPPPP', '.PPP...D', '......D.', '........', '........'];
const DOOR_KEY_PALETTE: Record<string, string> = {
  P: DOOR_KEY_BODY,
  D: DOOR_KEY_DARK,
  H: DOOR_KEY_HORN,
  W: DOOR_KEY_HILITE,
};

const CHEST_CLOSED_ROWS = ['........', '.WWWWWW.', 'WWWWWWWW', 'WGGGGGGW', 'WW.LL.WW', 'WWWWWWWW', 'WWWWWWWW', '........'];
const CHEST_CLOSED_PALETTE: Record<string, string> = { W: '#8b5a2b', G: '#f5c451', L: '#2a2016' };

const CHEST_OPEN_ROWS = ['.WWWWWW.', '........', 'WWWWWWWW', 'W......W', 'W.g....W', 'W......W', 'WWWWWWWW', '........'];
const CHEST_OPEN_PALETTE: Record<string, string> = { W: '#8b5a2b', g: '#f5c451' };

const EXIT_ROWS = ['WWWWWWWW', 'W......W', 'W.dddd.W', 'W.dddd.W', 'W.dddd.W', 'W.ssss.W', 'W......W', 'WWWWWWWW'];
const EXIT_PALETTE: Record<string, string> = { W: '#4a4863', d: '#08070d', s: '#3a3852' };

// Closed door: wood-plank frame with a small horned-ring emblem (matching the
// door key) set into the middle, poking up through the top beam.
const DOOR_CLOSED_ROWS = ['PPMPPMPP', 'PPMPPMPP', 'BBBBBBBB', 'PPPHPHPP', 'PPRRRRPP', 'PPRPPRPP', 'BBRRRRBB', 'PPMPPMPP'];
const DOOR_CLOSED_PALETTE: Record<string, string> = {
  P: '#8b5a2b',
  M: '#5a3a1c',
  B: '#4a2f18',
  H: DOOR_KEY_HORN,
  R: DOOR_KEY_BODY,
};
// Open door frame keeps the wood-brown hue but tints it slightly purple so it
// still reads as "that kind of door" even without the emblem visible.
const DOOR_OPEN_FRAME = 'rgba(160,108,200,0.55)';

/** Colors used by the door key's pulsing map-tile aura (see drawKeyAura). */
const KEY_AURA_COLOR = DOOR_KEY_BODY;
const KEY_AURA_SPARKLE_COLORS = [DOOR_KEY_HORN, DOOR_KEY_HILITE, DOOR_KEY_HORN] as const;

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

function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
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

  private cam = { x: 0, y: 0 };
  private camPx = { x: 0, y: 0 };
  private needSnap = true;

  private heroSprite: HTMLCanvasElement;
  private doorKeySprite: HTMLCanvasElement;
  private chestKeySprite: HTMLCanvasElement;
  private chestClosedSprite: HTMLCanvasElement;
  private chestOpenSprite: HTMLCanvasElement;
  private doorClosedSprite: HTMLCanvasElement;
  private exitSprite: HTMLCanvasElement;
  private shieldBadgeSprite: HTMLCanvasElement;
  private pedestalSprite: HTMLCanvasElement;
  /** Hero level captured at the start of each draw, used to color monster level badges. */
  private heroLevel = 1;
  private monsterSprites: Map<string, HTMLCanvasElement> = new Map();
  private itemSprites: Map<ItemKind, HTMLCanvasElement> = new Map();
  private slotSprites: Map<ItemSlot, HTMLCanvasElement> = new Map();
  private arrowSprites: Map<(typeof ARROW_ORDER)[number], HTMLCanvasElement> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Renderer: 2d context unavailable');
    this.ctx = ctx;

    this.heroSprite = buildIcon(HERO_ROWS, HERO_PALETTE);
    this.doorKeySprite = buildIcon(DOOR_KEY_ROWS, DOOR_KEY_PALETTE);
    this.chestKeySprite = buildIcon(CHEST_KEY_ROWS, CHEST_KEY_PALETTE);
    this.chestClosedSprite = buildIcon(CHEST_CLOSED_ROWS, CHEST_CLOSED_PALETTE);
    this.chestOpenSprite = buildIcon(CHEST_OPEN_ROWS, CHEST_OPEN_PALETTE);
    this.doorClosedSprite = buildIcon(DOOR_CLOSED_ROWS, DOOR_CLOSED_PALETTE);
    this.exitSprite = buildIcon(EXIT_ROWS, EXIT_PALETTE);
    this.shieldBadgeSprite = buildIcon(SHIELD_BADGE_ROWS, { S: '#9a97ad' });
    this.pedestalSprite = buildIcon(PEDESTAL_ART.rows, PEDESTAL_ART.palette);

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

  resize(level: LevelData): void {
    const parent = this.canvas.parentElement;
    const boxW = Math.max(1, parent ? parent.clientWidth : window.innerWidth);
    const boxH = Math.max(1, parent ? parent.clientHeight : window.innerHeight);

    const tile = Math.max(24, Math.min(48, Math.round(boxW / VIEW_TILES)));
    const dpr = Math.min(3, window.devicePixelRatio || 1);

    this.canvas.style.width = `${boxW}px`;
    this.canvas.style.height = `${boxH}px`;
    this.canvas.width = Math.round(boxW * dpr);
    this.canvas.height = Math.round(boxH * dpr);

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
  }

  tileAt(clientX: number, clientY: number): Vec | null {
    const rect = this.canvas.getBoundingClientRect();
    const t = this.tile;
    const x = Math.floor((clientX - rect.left + this.camPx.x) / t);
    const y = Math.floor((clientY - rect.top + this.camPx.y) / t);
    if (x < 0 || y < 0 || x >= this.levelW || y >= this.levelH) return null;
    return { x, y };
  }

  private buildStatic(level: LevelData): void {
    const w = level.width * SUB;
    const h = level.height * SUB;
    if (!this.staticCanvas) this.staticCanvas = document.createElement('canvas');
    this.staticCanvas.width = w;
    this.staticCanvas.height = h;
    const sctx = this.staticCanvas.getContext('2d');
    if (!sctx) return;
    const pal = themeById(level.theme).palette;
    const img = sctx.createImageData(w, h);
    for (let ty = 0; ty < level.height; ty++) {
      const row = level.tiles[ty];
      for (let tx = 0; tx < level.width; tx++) {
        const isWall = row[tx] === Tile.Wall;
        for (let ly = 0; ly < SUB; ly++) {
          const gy = ty * SUB + ly;
          for (let lx = 0; lx < SUB; lx++) {
            const gx = tx * SUB + lx;
            let hex: string;
            if (isWall) {
              const brickRow = Math.floor(ly / 4);
              const offset = (brickRow % 2) * 4;
              const withinBrickX = (lx + offset) % 8;
              const isMortarV = withinBrickX === 0;
              const isMortarH = ly % 4 === 0;
              if (isMortarV || isMortarH) hex = pal.mortar;
              else if (ly % 4 === 1) hex = pal.wallHi;
              else hex = (tx + brickRow) % 2 === 0 ? pal.wallA : pal.wallB;
            } else {
              const hv = hash2(tx, ty);
              const slx = (hv >> 3) % SUB;
              const sly = (hv >> 6) % SUB;
              if (hv % 5 === 0 && lx === slx && ly === sly) {
                hex = hv % 2 === 0 ? pal.speckLight : pal.speckDark;
              } else {
                hex = pal.floor;
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
  }

  private inRange(p: Vec, x0: number, x1: number, y0: number, y1: number): boolean {
    return p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1;
  }

  draw(state: GameState, dt: number): void {
    this.heroLevel = state.hero.level;
    // 1. Age & prune effects.
    for (const fx of state.fx) fx.t += dt;
    state.fx = state.fx.filter((fx) => fx.t < fx.ttl);

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

    // Trail highlight.
    ctx.fillStyle = themeById(state.level.theme).palette.trail;
    for (const k of state.trail) {
      const p = parseKey(k);
      if (!this.inRange(p, startX, endX, startY, endY)) continue;
      ctx.fillRect(p.x * t, p.y * t, t, t);
    }

    // Queued path: line from hero + square dots at tile centers.
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

    // Doors.
    for (const door of state.level.doors) {
      if (this.inRange(door.pos, startX, endX, startY, endY)) this.drawDoor(ctx, door, t);
    }

    // Keys (untaken only).
    for (const k of state.level.keys) {
      if (!k.taken && this.inRange(k.pos, startX, endX, startY, endY)) this.drawKey(ctx, k, t);
    }

    // Chests.
    for (const c of state.level.chests) {
      if (this.inRange(c.pos, startX, endX, startY, endY)) this.drawChest(ctx, c, t);
    }

    // Exit.
    if (this.inRange(state.level.exit, startX, endX, startY, endY)) {
      this.drawTileSprite(ctx, this.exitSprite, state.level.exit, t, 0.86);
    }

    // Shop pedestals.
    if (state.level.kind === 'shop' && state.level.shop) {
      const dimmed = state.level.shop.bought;
      for (const offer of state.level.shop.offers) {
        if (this.inRange(offer.pos, startX, endX, startY, endY)) this.drawShopOffer(ctx, offer, dimmed, t);
      }
    }

    // Monsters.
    for (const m of state.level.monsters) {
      if (m.alive && this.inRange(m.pos, startX, endX, startY, endY)) this.drawMonster(ctx, m, t);
    }

    // Hero (always near the viewport center).
    this.drawHero(ctx, state.hero, t);

    // keyCompass: arrow hovering over the hero, pointing at the tracked tile.
    if (state.compass) this.drawCompass(ctx, state.hero, state.compass, t);

    // Effects on top.
    for (const fx of state.fx) this.drawEffect(ctx, fx, t);

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

  private drawDoor(ctx: CanvasRenderingContext2D, door: Door, t: number): void {
    const x = Math.round(door.pos.x * t);
    const y = Math.round(door.pos.y * t);
    if (!door.open) {
      ctx.drawImage(this.doorClosedSprite, x, y, t, t);
    } else {
      const inset = Math.round(t * 0.12);
      ctx.strokeStyle = DOOR_OPEN_FRAME;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, t - inset * 2 - 1, t - inset * 2 - 1);
    }
  }

  private drawKey(ctx: CanvasRenderingContext2D, k: KeyItem, t: number): void {
    const isDoor = k.kind === 'door';
    const bsize = Math.round(t * 0.78);
    const bgx = Math.round(k.pos.x * t + (t - bsize) / 2);
    const bgy = Math.round(k.pos.y * t + (t - bsize) / 2);
    ctx.fillStyle = isDoor ? 'rgba(181,108,255,0.22)' : 'rgba(245,196,81,0.22)';
    ctx.fillRect(bgx, bgy, bsize, bsize);

    // Door keys are magical: a soft pulsing purple ring + orbiting sparkles.
    // Chest keys just get the plain disk above.
    if (isDoor) this.drawKeyAura(ctx, k.pos, t);

    const size = Math.round(t * 0.6);
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

    const ringAlpha = 0.6 + 0.3 * Math.sin((now / 1200) * Math.PI * 2);
    const ringSize = Math.round((t * 0.92) / sub) * sub;
    const rx = Math.round((cx - ringSize / 2) / sub) * sub;
    const ry = Math.round((cy - ringSize / 2) / sub) * sub;
    ctx.save();
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = KEY_AURA_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, ringSize - 1, ringSize - 1);
    ctx.restore();

    const orbitR = t * 0.55;
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
    this.drawTileSprite(ctx, c.opened ? this.chestOpenSprite : this.chestClosedSprite, c.pos, t, 0.8);
  }

  /** A shop pedestal: stone column, item icon hovering above, slot glyph top-left, price tag below-right. */
  private drawShopOffer(ctx: CanvasRenderingContext2D, offer: ShopOffer, dimmed: boolean, t: number): void {
    ctx.save();
    if (dimmed) ctx.globalAlpha = PEDESTAL_DIM_ALPHA;

    // Pedestal.
    this.drawTileSprite(ctx, this.pedestalSprite, offer.pos, t, 0.72);

    // Item icon, hovering above the pedestal.
    const itemSprite = this.itemSprites.get(offer.item.kind);
    if (itemSprite) {
      const size = Math.round(t * 0.5);
      const cx = offer.pos.x * t + t / 2;
      const cy = offer.pos.y * t + t / 2 - t * 0.35;
      const x = Math.round(cx - size / 2);
      const y = Math.round(cy - size / 2);
      ctx.drawImage(itemSprite, x, y, size, size);
    }

    // Slot glyph, small, top-left of the pedestal tile.
    const slotSprite = this.slotSprites.get(ITEM_SLOT[offer.item.kind]);
    if (slotSprite) {
      const size = Math.round(t * 0.24);
      const x = Math.round(offer.pos.x * t + t * 0.04);
      const y = Math.round(offer.pos.y * t + t * 0.04);
      ctx.drawImage(slotSprite, x, y, size, size);
    }
    ctx.restore();

    // Price tag: dark box + tiny coin + number, below-right of the pedestal.
    ctx.save();
    if (dimmed) ctx.globalAlpha = PEDESTAL_DIM_ALPHA;
    const fontPx = Math.max(6, Math.round(t * 0.24));
    const label = `${offer.price}`;
    ctx.font = `${fontPx}px "Press Start 2P", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const coinSize = Math.max(3, Math.round(t * 0.14));
    const textW = Math.round(fontPx * 0.72 * label.length);
    const boxW = coinSize + 3 + textW + 6;
    const boxH = Math.max(coinSize, fontPx) + 4;
    const bx = Math.round(offer.pos.x * t + t - boxW * 0.55);
    const by = Math.round(offer.pos.y * t + t - boxH * 0.35);
    ctx.fillStyle = PRICE_BG;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = PRICE_COIN;
    ctx.fillRect(bx + 2, by + Math.round((boxH - coinSize) / 2), coinSize, coinSize);
    ctx.fillStyle = PRICE_TEXT;
    ctx.fillText(label, bx + coinSize + 5, by + boxH / 2 + 1);
    ctx.restore();
  }

  private ringColorFor(m: Monster): { color: string; pulse: boolean } {
    if (m.state === 'chasing') return { color: RING_CHASING, pulse: true };
    if (m.state === 'returning') return { color: RING_RETURNING, pulse: false };
    if (m.kind === 'guard') return { color: RING_GUARD, pulse: false };
    if (m.kind === 'patrol') return { color: RING_PATROL, pulse: false };
    return { color: RING_LURKER, pulse: false };
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
    const size = Math.round(t * 0.82);
    const dx = Math.round(cx - size / 2);
    const dy = Math.round(cy - size / 2);

    const spriteKey = monsterSpriteKey(m.name);
    const sprite = this.monsterSprites.get(spriteKey) ?? this.monsterSprites.get('blob');

    const { color, pulse } = this.ringColorFor(m);
    const outlineSize = size + 4;
    const ox2 = Math.round(cx - outlineSize / 2);
    const oy2 = Math.round(cy - outlineSize / 2);
    ctx.save();
    ctx.globalAlpha = pulse ? 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / 130)) : 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox2 + 0.5, oy2 + 0.5, outlineSize - 1, outlineSize - 1);
    ctx.restore();

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

    if (m.kind === 'guard') {
      const bsize = Math.round(t * 0.32);
      const bx = Math.round(cx + size / 2 - bsize * 0.6);
      const by = Math.round(cy - size / 2 - bsize * 0.4);
      ctx.drawImage(this.shieldBadgeSprite, bx, by, bsize, bsize);
    }

    // Level badge: small dark tag at the bottom-right corner of the sprite.
    {
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
      ctx.translate(cx, cy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.heroSprite, -size / 2, -size / 2, size, size);
    } else {
      ctx.drawImage(this.heroSprite, dx, dy, size, size);
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
