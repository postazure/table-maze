/**
 * The simulation. Owns `GameState` and advances it from rAF ticks.
 *
 * No DOM access here: `main.ts` drives `tick`, `input.ts` drives `pointerAt`/
 * `pointerEnd`, and `onChange` is the "worth persisting" signal for save.ts.
 */
import type { Chest, Dir, GameState, Hero, Monster, Rng, Vec } from './types';
import { SAVE_VERSION, eq, key, manhattan } from './types';
import { hashSeed, makeRng } from './rng';
import { bfsPath } from './pathfind';
import { generateLevel } from './maze';
import { newHero, applyLevelUp } from './balance';
import { updateMonsters } from './monsters';
import {
  GOLD,
  GREEN,
  chestAt,
  closedDoorAt,
  heroAttack,
  keyAt,
  liveMonsterAt,
  pushLog,
  pushShake,
  pushText,
  unitToward,
} from './combat';
import { isFloor } from './pathfind';

/** ms between hero steps (~7 tiles/s). */
const MOVE_MS = 140;
/** ms between swings while the finger is held on an adjacent monster. */
const HOLD_ATTACK_MS = 300;
/** hero render position catch-up speed, tiles/s. */
const RPOS_SPEED = 12;
/** how long the descend animation lasts before the next level is generated. */
const DESCEND_MS = 700;
/** longest queued path we keep. */
const MAX_PATH = 40;
/** how far a single drag jump may be auto-pathed. */
const DRAG_PATH_MAX = 8;
const LOG_TTL = 6000;
const REGEN_DELAY = 3000;
const REGEN_MS = 600;
/** salt so the per-level rng differs from the generator's stream. */
const RNG_SALT = 7919;

export class Game {
  state!: GameState;
  /** Called after any state change worth persisting. Set by main.ts. */
  onChange?: (state: GameState) => void;

  private rng!: Rng;
  private moveTimer = 0;
  private holdTimer = 0;
  private regenTimer = 0;
  private dirty = false;

  constructor(saved?: GameState | null) {
    if (saved) {
      this.state = reviveState(saved);
      this.rng = makeRng(hashSeed(this.state.seed, this.state.depth, RNG_SALT));
    } else {
      this.newGame();
    }
  }

  /** Fresh run with a deterministic seed. Handy for tests. */
  static forTest(seed: number): Game {
    const g = new Game(null);
    g.startRun(seed >>> 0);
    return g;
  }

  newGame(): void {
    const seed = (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0;
    this.startRun(seed);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /** Finger is over `tile` (or null when off the maze). Extends the path. */
  pointerAt(tile: Vec | null): void {
    if (this.state.modal) return;
    const st = this.state;
    st.pointer = tile ? { x: tile.x, y: tile.y } : null;
    if (!tile) return;
    if (st.descending > 0) return;

    const hero = st.hero;
    if (eq(tile, hero.pos)) {
      st.path.length = 0;
      return;
    }

    // Backtracking: dragging back over a queued tile trims the queue.
    const idx = st.path.findIndex((p) => eq(p, tile));
    if (idx >= 0) {
      st.path.length = idx + 1;
      return;
    }

    if (!this.isTarget(tile)) return;

    const tail = st.path.length > 0 ? st.path[st.path.length - 1] : hero.pos;
    if (manhattan(tail, tile) === 1) {
      st.path.push({ x: tile.x, y: tile.y });
    } else {
      const route = bfsPath(st.level, tail, tile, {
        blocked: (p) => !eq(p, tile) && !this.isWalkable(p),
        maxLen: DRAG_PATH_MAX,
      });
      if (!route) return;
      for (const p of route) st.path.push({ x: p.x, y: p.y });
    }
    if (st.path.length > MAX_PATH) st.path.length = MAX_PATH;
  }

  pointerEnd(): void {
    // Keep the queued path: the hero walks it out on its own.
    this.state.pointer = null;
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  tick(dt: number): void {
    if (!(dt > 0)) dt = 0;
    const st = this.state;
    const hero = st.hero;
    this.dirty = false;
    // A popup is up: the whole world waits.
    if (st.modal) return;

    st.stats.playMs += dt;
    hero.sinceCombat += dt;
    if (hero.hitFlash > 0) hero.hitFlash = Math.max(0, hero.hitFlash - dt);
    if (hero.stun > 0) hero.stun = Math.max(0, hero.stun - dt);
    if (hero.lungeT > 0) {
      hero.lungeT = Math.max(0, hero.lungeT - dt);
      if (hero.lungeT === 0) hero.lunge = undefined;
    }
    this.ageLog(dt);

    if (st.descending > 0) {
      st.descending -= dt;
      this.lerpHero(dt);
      if (st.descending <= 0) {
        st.descending = 0;
        this.advanceLevel();
        return;
      }
      if (this.dirty) this.emit();
      return;
    }

    // --- hero movement -----------------------------------------------------
    this.moveTimer += dt;
    if (hero.stun > 0) {
      this.moveTimer = Math.min(this.moveTimer, MOVE_MS);
    } else {
      let guard = 0;
      while (st.path.length > 0 && this.moveTimer >= MOVE_MS && guard < 8) {
        guard += 1;
        this.moveTimer -= MOVE_MS;
        this.stepOnce();
        if (st.descending > 0) break;
      }
      if (st.path.length === 0) this.moveTimer = Math.min(this.moveTimer, MOVE_MS);
      if (st.descending === 0) this.holdAttack(dt);
    }

    this.checkLevelUp();
    this.lerpHero(dt);

    // --- monsters ----------------------------------------------------------
    const hpBefore = hero.hp;
    const posBefore = hero.pos;
    updateMonsters(st, dt, this.rng);
    if (hero.hp !== hpBefore || hero.pos !== posBefore) this.dirty = true;

    this.checkLevelUp();

    // --- out of combat regen ------------------------------------------------
    if (hero.sinceCombat > REGEN_DELAY && hero.hp < hero.maxHp) {
      this.regenTimer += dt;
      while (this.regenTimer >= REGEN_MS && hero.hp < hero.maxHp) {
        this.regenTimer -= REGEN_MS;
        hero.hp += 1;
        this.dirty = true;
      }
    } else {
      this.regenTimer = 0;
    }

    if (this.dirty) this.emit();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private startRun(seed: number): void {
    const depth = 1;
    const level = generateLevel(depth, seed);
    const hero = newHero();
    hero.pos = { x: level.start.x, y: level.start.y };
    hero.rpos = { x: level.start.x, y: level.start.y };
    this.state = {
      version: SAVE_VERSION,
      depth,
      seed,
      hero,
      level,
      trail: new Set<string>([key(level.start)]),
      path: [],
      pointer: null,
      fx: [],
      log: [],
      stats: { kills: 0, deepest: depth, playMs: 0 },
      descending: 0,
      modal: null,
    };
    this.rng = makeRng(hashSeed(seed, depth, RNG_SALT));
    this.moveTimer = 0;
    this.holdTimer = 0;
    this.regenTimer = 0;
    pushLog(this.state, 'Drag your finger to guide the hero');
    this.emit();
  }

  private advanceLevel(): void {
    const st = this.state;
    const hero = st.hero;
    st.depth += 1;
    st.stats.deepest = Math.max(st.stats.deepest, st.depth);
    st.level = generateLevel(st.depth, st.seed);
    hero.pos = { x: st.level.start.x, y: st.level.start.y };
    hero.rpos = { x: st.level.start.x, y: st.level.start.y };
    hero.keys = { door: 0, chest: 0 };
    hero.hp = Math.min(hero.maxHp, hero.hp + Math.floor((hero.maxHp - hero.hp) / 2));
    hero.stun = 0;
    hero.hitFlash = 0;
    hero.lungeT = 0;
    hero.lunge = undefined;
    st.trail = new Set<string>([key(st.level.start)]);
    st.path = [];
    st.fx = [];
    st.pointer = null;
    st.descending = 0;
    this.rng = makeRng(hashSeed(st.seed, st.depth, RNG_SALT));
    this.moveTimer = 0;
    this.holdTimer = 0;
    this.regenTimer = 0;
    pushLog(st, `Depth ${st.depth}`);
    this.dirty = true;
    this.emit();
  }

  /** Tiles the hero may walk *through* while path-finding a drag. */
  private isWalkable(p: Vec): boolean {
    const st = this.state;
    if (!isFloor(st.level, p)) return false;
    if (liveMonsterAt(st.level, p)) return false;
    if (chestAt(st.level, p)) return false;
    if (closedDoorAt(st.level, p) && st.hero.keys.door <= 0) return false;
    return true;
  }

  /**
   * Tiles a drag may *end* on: monsters (walking in = attack) and chests
   * (walking in = open) are legal targets even though they can't be crossed.
   */
  private isTarget(p: Vec): boolean {
    const st = this.state;
    if (!isFloor(st.level, p)) return false;
    if (closedDoorAt(st.level, p) && st.hero.keys.door <= 0) return false;
    const chest = chestAt(st.level, p);
    if (chest && chest.opened) return false;
    return true;
  }

  private stepOnce(): void {
    const st = this.state;
    const hero = st.hero;
    const next = st.path[0];
    if (!next) return;
    if (manhattan(next, hero.pos) !== 1) {
      // Path desynced (knockback etc): drop it, the player can re-drag.
      st.path.length = 0;
      return;
    }

    const m = liveMonsterAt(st.level, next);
    if (m) {
      this.swingAt(m);
      return;
    }

    const chest = chestAt(st.level, next);
    if (chest) {
      this.bumpChest(chest);
      return;
    }

    const door = closedDoorAt(st.level, next);
    if (door) {
      if (hero.keys.door > 0) {
        hero.keys.door -= 1;
        door.open = true;
        pushText(st, next, 'Unlocked!', GOLD, 1000);
        pushLog(st, 'Unlocked the door');
        this.dirty = true;
      } else {
        // Wordless cue: the door blinks red.
        st.fx.push({ kind: 'flash', pos: { x: next.x, y: next.y }, color: '#e53b3b', t: 0, ttl: 320 });
        st.path.length = 0;
        return;
      }
    }

    st.path.shift();
    const d = dirFromVec(unitToward(hero.pos, next));
    if (d) hero.facing = d;
    hero.pos = { x: next.x, y: next.y };
    st.trail.add(key(hero.pos));
    this.dirty = true;
    this.onEnter(hero.pos);
  }

  /**
   * The hero walked into a chest. Chests are solid, so the hero stays put.
   * A closed chest opens if the hero carries a chest key: the loot is applied
   * at once and a modal freezes the game until the player taps it away.
   */
  private bumpChest(chest: Chest): void {
    const st = this.state;
    const hero = st.hero;
    st.path.length = 0;
    this.holdTimer = 0;
    if (chest.opened) return;
    if (hero.keys.chest <= 0) {
      // No words: a red blink on the chest says "locked".
      st.fx.push({ kind: 'flash', pos: { x: chest.pos.x, y: chest.pos.y }, color: '#e53b3b', t: 0, ttl: 320 });
      return;
    }
    hero.keys.chest -= 1;
    chest.opened = true;
    hero.gold += chest.loot.gold;
    hero.xp += chest.loot.xp;
    const item = chest.loot.item;
    if (item) {
      if (item.atk) hero.atk += item.atk;
      if (item.def) hero.def += item.def;
      if (item.maxHp) {
        hero.maxHp += item.maxHp;
        hero.hp += item.maxHp;
      }
      hero.items.push(item);
    }
    const face = dirFromVec(unitToward(hero.pos, chest.pos));
    if (face) hero.facing = face;
    st.modal = { kind: 'chest', loot: chest.loot };
    this.dirty = true;
  }

  /** Close the current popup and let the simulation run again. */
  dismissModal(): void {
    const st = this.state;
    if (!st.modal) return;
    st.modal = null;
    st.path.length = 0;
    st.pointer = null;
    this.holdTimer = 0;
    this.moveTimer = 0;
    this.checkLevelUp();
    this.emit();
  }

  private swingAt(m: Monster): void {
    const st = this.state;
    const hero = st.hero;
    const u = unitToward(hero.pos, m.pos);
    hero.lunge = u;
    hero.lungeT = 120;
    const d = dirFromVec(u);
    if (d) hero.facing = d;
    heroAttack(st, m, this.rng);
    // Each swing needs a fresh drag (or a held finger) — clears the queue.
    st.path.length = 0;
    this.holdTimer = HOLD_ATTACK_MS;
    this.dirty = true;
  }

  /** Holding the finger on an adjacent monster keeps swinging. */
  private holdAttack(dt: number): void {
    const st = this.state;
    const p = st.pointer;
    if (!p || st.path.length > 0) {
      this.holdTimer = 0;
      return;
    }
    const m = liveMonsterAt(st.level, p);
    if (!m || manhattan(m.pos, st.hero.pos) !== 1) {
      this.holdTimer = 0;
      return;
    }
    this.holdTimer -= dt;
    if (this.holdTimer <= 0) this.swingAt(m);
  }

  private onEnter(tile: Vec): void {
    const st = this.state;
    const hero = st.hero;
    const level = st.level;

    const k = keyAt(level, tile);
    if (k) {
      k.taken = true;
      hero.keys[k.kind] += 1;
      pushText(st, tile, k.kind === 'door' ? 'DOOR KEY' : 'CHEST KEY', GOLD, 1000);
      pushLog(st, k.kind === 'door' ? 'Picked up a door key' : 'Picked up a chest key');
      this.dirty = true;
    }

    if (eq(tile, level.exit)) {
      st.descending = DESCEND_MS;
      st.path.length = 0;
      pushText(st, tile, 'Descending...', GREEN, 1200);
      pushLog(st, 'Stairs down!');
      this.dirty = true;
    }
  }

  private checkLevelUp(): void {
    const st = this.state;
    const hero = st.hero;
    let guard = 0;
    while (hero.xp >= hero.xpToNext && guard < 20) {
      guard += 1;
      const before = hero.level;
      applyLevelUp(hero);
      pushText(st, hero.pos, 'LEVEL UP!', GOLD, 1300);
      pushShake(st, 6, 260);
      pushLog(st, `Level ${hero.level}!`);
      this.dirty = true;
      if (hero.level === before) break; // defensive: no progress
    }
  }

  private lerpHero(dt: number): void {
    const hero = this.state.hero;
    const step = (RPOS_SPEED * dt) / 1000;
    const dx = hero.pos.x - hero.rpos.x;
    const dy = hero.pos.y - hero.rpos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step || dist < 0.001) {
      hero.rpos = { x: hero.pos.x, y: hero.pos.y };
    } else {
      hero.rpos = { x: hero.rpos.x + (dx / dist) * step, y: hero.rpos.y + (dy / dist) * step };
    }
  }

  private ageLog(dt: number): void {
    const log = this.state.log;
    for (const msg of log) msg.t += dt;
    let i = 0;
    while (i < log.length) {
      if (log[i].t > LOG_TTL) log.splice(i, 1);
      else i += 1;
    }
    if (log.length > 5) log.splice(0, log.length - 5);
  }

  private emit(): void {
    this.onChange?.(this.state);
  }
}

function dirFromVec(v: Vec): Dir | null {
  if (v.x > 0) return 'E';
  if (v.x < 0) return 'W';
  if (v.y > 0) return 'S';
  if (v.y < 0) return 'N';
  return null;
}

/** Make a loaded/foreign state safe to run: transient fields rebuilt. */
function reviveState(saved: GameState): GameState {
  const s = saved as GameState & { trail: unknown };
  const raw: unknown = s.trail;
  s.trail = raw instanceof Set ? raw : new Set<string>(Array.isArray(raw) ? (raw as string[]) : []);
  s.fx = [];
  s.path = [];
  s.pointer = null;
  s.log = Array.isArray(s.log) ? s.log : [];
  s.descending = 0;
  s.modal = null;
  if (!s.stats) s.stats = { kills: 0, deepest: s.depth || 1, playMs: 0 };
  const hero = s.hero as Hero;
  if (!hero.keys) hero.keys = { door: 0, chest: 0 };
  if (!Array.isArray(hero.items)) hero.items = [];
  if (!hero.rpos) hero.rpos = { x: hero.pos.x, y: hero.pos.y };
  hero.stun = 0;
  hero.hitFlash = 0;
  hero.lungeT = 0;
  hero.lunge = undefined;
  (s.trail as Set<string>).add(key(hero.pos));
  return s as GameState;
}
