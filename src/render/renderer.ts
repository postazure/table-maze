import {
  Tile,
  parseKey,
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
} from '../engine/types';

// ---------------------------------------------------------------------------
// Palette / constants
// ---------------------------------------------------------------------------

const WALL_A = '#34324a';
const WALL_B = '#2b2a3d';
const WALL_HI = '#403e5c';
const WALL_MORTAR = '#18172a';
const FLOOR_COLOR = '#100f1c';
const FLOOR_SPECK_LIGHT = '#241f38';
const FLOOR_SPECK_DARK = '#0a0912';

const TRAIL_COLOR = 'rgba(245, 196, 81, 0.14)';
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
// Procedural creature sprites: a symmetric "blob" half-width profile (or an
// explicit pixel list for irregular shapes like the snake) plus accent/eye
// overrides. Produces the same row/palette shape buildIcon expects.
// ---------------------------------------------------------------------------

interface CreatureCfg {
  widths?: number[]; // length 8, half-width (0-4) per row; ignored if bodyPositions is set
  bodyPositions?: Array<[number, number]>;
  body: string;
  accent?: string;
  accentPositions?: Array<[number, number]>;
  eye?: string;
  eyePositions?: Array<[number, number]>;
}

function creatureRows(cfg: CreatureCfg): { rows: string[]; palette: Record<string, string> } {
  const size = 8;
  const grid: string[][] = Array.from({ length: size }, () => Array<string>(size).fill('.'));

  if (cfg.bodyPositions) {
    for (const [x, y] of cfg.bodyPositions) grid[y][x] = 'X';
  } else {
    const widths = cfg.widths ?? [];
    for (let y = 0; y < size; y++) {
      const wgt = widths[y] ?? 0;
      for (let x = 0; x < size; x++) {
        const dist = Math.abs(x - 3.5) - 0.5;
        if (dist <= wgt - 1) grid[y][x] = 'X';
      }
    }
  }
  for (const [x, y] of cfg.accentPositions ?? []) grid[y][x] = 'Y';
  for (const [x, y] of cfg.eyePositions ?? []) grid[y][x] = 'E';

  const palette: Record<string, string> = { X: cfg.body };
  if (cfg.accent) palette.Y = cfg.accent;
  if (cfg.eye) palette.E = cfg.eye;
  return { rows: grid.map((r) => r.join('')), palette };
}

const MONSTER_CFGS: Record<string, CreatureCfg> = {
  rat: {
    widths: [0, 0, 2, 3, 3, 2, 1, 0],
    body: '#8a7256',
    accent: '#c98a8a',
    accentPositions: [
      [1, 2],
      [7, 4],
    ],
    eye: '#141414',
    eyePositions: [[3, 3]],
  },
  bat: {
    widths: [3, 4, 2, 1, 0, 0, 0, 0],
    body: '#4a4763',
    accent: '#2c2a3d',
    accentPositions: [
      [0, 0],
      [7, 0],
    ],
    eye: '#e5484d',
    eyePositions: [
      [2, 1],
      [5, 1],
    ],
  },
  spider: {
    widths: [0, 1, 3, 3, 1, 0, 0, 0],
    body: '#2f2a3d',
    accent: '#7b6cff',
    accentPositions: [
      [0, 3],
      [7, 3],
      [0, 4],
      [7, 4],
      [1, 5],
      [6, 5],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  snake: {
    bodyPositions: [
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
      [5, 3],
      [4, 3],
      [3, 4],
      [2, 4],
      [2, 5],
      [3, 5],
      [4, 6],
      [5, 6],
      [5, 7],
      [4, 7],
    ],
    body: '#3aa15a',
    eye: '#141414',
    eyePositions: [[1, 0]],
  },
  zombie: {
    widths: [0, 2, 2, 3, 3, 3, 3, 2],
    body: '#5c7a52',
    accent: '#2e3b2a',
    accentPositions: [
      [3, 4],
      [4, 4],
      [3, 5],
      [4, 5],
    ],
    eye: '#c9c9c9',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  skeleton: {
    widths: [0, 2, 2, 3, 2, 3, 2, 3],
    body: '#e8e6f0',
    accent: '#8f8ca8',
    accentPositions: [
      [3, 4],
      [4, 5],
    ],
    eye: '#141414',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  ogre: {
    widths: [0, 3, 4, 4, 4, 4, 3, 2],
    body: '#7a8f5a',
    accent: '#4a3b2a',
    accentPositions: [
      [1, 0],
      [6, 0],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ],
    eye: '#e5484d',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  goblin: {
    widths: [0, 1, 2, 3, 2, 3, 2, 2],
    body: '#6fae52',
    accent: '#3a2b1f',
    accentPositions: [
      [1, 1],
      [6, 1],
    ],
    eye: '#f5c451',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  drake: {
    widths: [1, 2, 3, 4, 3, 2, 1, 1],
    body: '#3a6ea8',
    accent: '#f5c451',
    accentPositions: [
      [0, 2],
      [7, 2],
      [3, 0],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  wraith: {
    widths: [1, 2, 3, 3, 3, 2, 2, 1],
    body: '#7b6cff',
    eye: '#e8e6f0',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  vampire: {
    widths: [0, 2, 2, 3, 3, 2, 3, 2],
    body: '#8b1e2b',
    accent: '#e8e6f0',
    accentPositions: [
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 2],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  scorpion: {
    widths: [0, 0, 2, 3, 3, 2, 0, 0],
    body: '#b8443a',
    accent: '#5e1f1a',
    accentPositions: [
      [6, 1],
      [7, 0],
      [0, 3],
    ],
    eye: '#141414',
    eyePositions: [
      [3, 3],
      [4, 3],
    ],
  },
  blob: {
    widths: [0, 2, 3, 4, 4, 3, 2, 0],
    body: '#8f8ca8',
    eye: '#141414',
    eyePositions: [
      [3, 3],
      [4, 3],
    ],
  },
};

const MONSTER_KEYWORDS = [
  'rat',
  'bat',
  'spider',
  'snake',
  'zombie',
  'skeleton',
  'ogre',
  'goblin',
  'drake',
  'wraith',
  'vampire',
  'scorpion',
] as const;

function monsterSpriteKey(name: string): string {
  const n = name.toLowerCase();
  for (const k of MONSTER_KEYWORDS) if (n.includes(k)) return k;
  return 'blob';
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

const KEY_ROWS = ['........', '.GGG....', 'G...G...', 'G..GGGGG', '.GGG...G', '......G.', '........', '........'];

const CHEST_CLOSED_ROWS = ['........', '.WWWWWW.', 'WWWWWWWW', 'WGGGGGGW', 'WW.LL.WW', 'WWWWWWWW', 'WWWWWWWW', '........'];
const CHEST_CLOSED_PALETTE: Record<string, string> = { W: '#8b5a2b', G: '#f5c451', L: '#2a2016' };

const CHEST_OPEN_ROWS = ['.WWWWWW.', '........', 'WWWWWWWW', 'W......W', 'W.g....W', 'W......W', 'WWWWWWWW', '........'];
const CHEST_OPEN_PALETTE: Record<string, string> = { W: '#8b5a2b', g: '#f5c451' };

const EXIT_ROWS = ['WWWWWWWW', 'W......W', 'W.dddd.W', 'W.dddd.W', 'W.dddd.W', 'W.ssss.W', 'W......W', 'WWWWWWWW'];
const EXIT_PALETTE: Record<string, string> = { W: '#4a4863', d: '#08070d', s: '#3a3852' };

const DOOR_CLOSED_ROWS = ['PPMPPMPP', 'PPMPPMPP', 'BBBBBBBB', 'PPMPPMPP', 'PPMGGMPP', 'PPMPPMPP', 'BBBBBBBB', 'PPMPPMPP'];
const DOOR_CLOSED_PALETTE: Record<string, string> = { P: '#8b5a2b', M: '#5a3a1c', B: '#4a2f18', G: '#f5c451' };

const SHIELD_BADGE_ROWS = ['.SSSS.', 'SSSSSS', 'SSSSSS', '.SSSS.', '..SS..', '..SS..'];

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
  /** Hero level captured at the start of each draw, used to color monster level badges. */
  private heroLevel = 1;
  private monsterSprites: Map<string, HTMLCanvasElement> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Renderer: 2d context unavailable');
    this.ctx = ctx;

    this.heroSprite = buildIcon(HERO_ROWS, HERO_PALETTE);
    this.doorKeySprite = buildIcon(KEY_ROWS, { G: '#f5c451' });
    this.chestKeySprite = buildIcon(KEY_ROWS, { G: '#5aa9ff' });
    this.chestClosedSprite = buildIcon(CHEST_CLOSED_ROWS, CHEST_CLOSED_PALETTE);
    this.chestOpenSprite = buildIcon(CHEST_OPEN_ROWS, CHEST_OPEN_PALETTE);
    this.doorClosedSprite = buildIcon(DOOR_CLOSED_ROWS, DOOR_CLOSED_PALETTE);
    this.exitSprite = buildIcon(EXIT_ROWS, EXIT_PALETTE);
    this.shieldBadgeSprite = buildIcon(SHIELD_BADGE_ROWS, { S: '#9a97ad' });

    for (const [kind, cfg] of Object.entries(MONSTER_CFGS)) {
      const { rows, palette } = creatureRows(cfg);
      this.monsterSprites.set(kind, buildIcon(rows, palette));
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
              if (isMortarV || isMortarH) hex = WALL_MORTAR;
              else if (ly % 4 === 1) hex = WALL_HI;
              else hex = (tx + brickRow) % 2 === 0 ? WALL_A : WALL_B;
            } else {
              const hv = hash2(tx, ty);
              const slx = (hv >> 3) % SUB;
              const sly = (hv >> 6) % SUB;
              if (hv % 5 === 0 && lx === slx && ly === sly) {
                hex = hv % 2 === 0 ? FLOOR_SPECK_LIGHT : FLOOR_SPECK_DARK;
              } else {
                hex = FLOOR_COLOR;
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
    ctx.fillStyle = TRAIL_COLOR;
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

    // Monsters.
    for (const m of state.level.monsters) {
      if (m.alive && this.inRange(m.pos, startX, endX, startY, endY)) this.drawMonster(ctx, m, t);
    }

    // Hero (always near the viewport center).
    this.drawHero(ctx, state.hero, t);

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
      ctx.strokeStyle = 'rgba(139,90,43,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, t - inset * 2 - 1, t - inset * 2 - 1);
    }
  }

  private drawKey(ctx: CanvasRenderingContext2D, k: KeyItem, t: number): void {
    const isDoor = k.kind === 'door';
    const bsize = Math.round(t * 0.78);
    const bgx = Math.round(k.pos.x * t + (t - bsize) / 2);
    const bgy = Math.round(k.pos.y * t + (t - bsize) / 2);
    ctx.fillStyle = isDoor ? 'rgba(245,196,81,0.22)' : 'rgba(90,169,255,0.22)';
    ctx.fillRect(bgx, bgy, bsize, bsize);

    const size = Math.round(t * 0.6);
    const bx = Math.round(k.pos.x * t + (t - size) / 2);
    const by = Math.round(k.pos.y * t + (t - size) / 2);
    ctx.drawImage(isDoor ? this.doorKeySprite : this.chestKeySprite, bx, by, size, size);
  }

  private drawChest(ctx: CanvasRenderingContext2D, c: Chest, t: number): void {
    this.drawTileSprite(ctx, c.opened ? this.chestOpenSprite : this.chestClosedSprite, c.pos, t, 0.8);
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
      ctx.drawImage(sprite, dx, dy, size, size);
      ctx.restore();
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
    const stunned = hero.stun > 0;

    const outlineSize = size + 4;
    const ox2 = Math.round(cx - outlineSize / 2);
    const oy2 = Math.round(cy - outlineSize / 2);
    ctx.strokeStyle = stunned ? HERO_RING_STUNNED : HERO_RING_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox2 + 0.5, oy2 + 0.5, outlineSize - 1, outlineSize - 1);

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
  }

  private drawEffect(ctx: CanvasRenderingContext2D, fx: Effect, t: number): void {
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
    }
    // 'shake' has no direct visual draw — it's folded into the camera translate.
  }
}
