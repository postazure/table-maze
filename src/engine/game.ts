/**
 * The simulation. Owns `GameState` and advances it from rAF ticks.
 *
 * No DOM access here: `main.ts` drives `tick`, `input.ts` drives `pointerAt`/
 * `pointerEnd`, and `onChange` is the "worth persisting" signal for save.ts.
 */
import type { Chest, Dir, GameState, Hero, Monster, Rng, ShopOffer, Vec } from './types';
import { SAVE_VERSION, eq, key, manhattan } from './types';
import { hashSeed, makeRng } from './rng';
import { bfsDistances, bfsPath } from './pathfind';
import { generateLevel } from './maze';
import { newHero, applyLevelUp } from './balance';
import { updateMonsters } from './monsters';
import {
  GOLD,
  GREEN,
  GREY,
  ORANGE,
  RED,
  chestAt,
  closedDoorAt,
  damageMonster,
  heroAttack,
  keyAt,
  liveMonsterAt,
  pushLog,
  pushShake,
  pushText,
  unitToward,
} from './combat';
import { isFloor } from './pathfind';
import type { ItemStats } from './items';
import {
  DEFAULT_MOVE_MS,
  berserkActive,
  equip,
  heroMoveMs,
  heroStats,
  itemName,
  reviveGear,
} from './items';
import { generateShopLevel, offerAt } from './shop';

/** ms between hero steps (~7 tiles/s) without speed boots. */
const MOVE_MS = DEFAULT_MOVE_MS;
/** A knocked-down hero sleeps back to full health over about this long. */
const SLEEP_MS = 3500;
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
/** Red blink for "you cannot do that" (locked door / chest / pedestal). */
const BLINK_RED = '#e53b3b';
/** Speed-boots dust colour. */
const DUST = '#8f8ca8';
/** ms between berserker aura pulses. */
const BERSERK_PULSE_MS = 600;
/** ms between bane totem pulses. */
const BANE_PULSE_MS = 2000;
/** How often the compass re-runs its BFS when the hero stands still. */
const COMPASS_MS = 500;
/** A shop appears after every third maze floor. */
const SHOP_EVERY = 3;
/** ms the hero loses shoving past a patrol. */
const SHOVE_STUN = 350;

export class Game {
  state!: GameState;
  /** Called after any state change worth persisting. Set by main.ts. */
  onChange?: (state: GameState) => void;

  private rng!: Rng;
  private moveTimer = 0;
  private holdTimer = 0;
  private regenTimer = 0;
  private sleepTimer = 0;
  private berserkTimer = 0;
  private compassTimer = COMPASS_MS;
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
    if (this.state.modal || this.state.hero.sleeping) return;
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

    // --- magic items -------------------------------------------------------
    const stats = heroStats(hero);
    const posBeforeStep = hero.pos;
    this.passives(dt, stats);

    // --- hero movement -----------------------------------------------------
    const moveMs = heroMoveMs(hero);
    this.moveTimer += dt;
    if (hero.sleeping) {
      st.path.length = 0;
      this.holdTimer = 0;
      this.moveTimer = Math.min(this.moveTimer, moveMs);
      this.sleep(dt, stats);
    } else if (hero.stun > 0) {
      this.moveTimer = Math.min(this.moveTimer, moveMs);
    } else {
      let guard = 0;
      while (st.path.length > 0 && this.moveTimer >= moveMs && guard < 8) {
        guard += 1;
        this.moveTimer -= moveMs;
        this.stepOnce(stats);
        if (st.descending > 0 || st.modal || hero.stun > 0) break;
      }
      if (st.path.length === 0) this.moveTimer = Math.min(this.moveTimer, moveMs);
      if (st.descending === 0 && !st.modal) this.holdAttack(dt, stats);
    }

    this.checkLevelUp();
    this.lerpHero(dt);
    this.updateCompass(stats, dt, !eq(hero.pos, posBeforeStep));

    // --- monsters ----------------------------------------------------------
    const hpBefore = hero.hp;
    const posBefore = hero.pos;
    updateMonsters(st, dt, this.rng);
    if (hero.hp !== hpBefore || hero.pos !== posBefore) this.dirty = true;

    this.checkLevelUp();

    // --- out of combat regen ------------------------------------------------
    // The regen ring shortens both the wait and the gap between hearts.
    const regenMult = Math.max(1, stats.regenMult);
    const regenDelay = REGEN_DELAY / regenMult;
    const regenMs = REGEN_MS / regenMult;
    if (!hero.sleeping && hero.sinceCombat > regenDelay && hero.hp < hero.maxHp) {
      this.regenTimer += dt;
      while (this.regenTimer >= regenMs && hero.hp < hero.maxHp) {
        this.regenTimer -= regenMs;
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
      compass: null,
    };
    this.rng = makeRng(hashSeed(seed, depth, RNG_SALT));
    this.moveTimer = 0;
    this.holdTimer = 0;
    this.regenTimer = 0;
    pushLog(this.state, 'Drag your finger to guide the hero');
    this.emit();
  }

  /**
   * Stairs taken. A maze floor whose depth is a multiple of three leads into a
   * shop (same depth, items priced at that depth); leaving a shop goes on to
   * the next maze floor. `state.depth` only ever counts maze floors.
   */
  private advanceLevel(): void {
    const st = this.state;
    const hero = st.hero;
    const leftShop = st.level.kind === 'shop';
    let salt = RNG_SALT;
    if (!leftShop && st.depth % SHOP_EVERY === 0) {
      st.level = generateShopLevel(st.depth, st.seed, hero);
      salt = RNG_SALT + 1;
    } else {
      st.depth += 1;
      st.stats.deepest = Math.max(st.stats.deepest, st.depth);
      st.level = generateLevel(st.depth, st.seed);
    }
    hero.pos = { x: st.level.start.x, y: st.level.start.y };
    hero.rpos = { x: st.level.start.x, y: st.level.start.y };
    hero.keys = { door: 0, chest: 0 };
    hero.hp = Math.min(hero.maxHp, hero.hp + Math.floor((hero.maxHp - hero.hp) / 2));
    hero.stun = 0;
    hero.sleeping = false;
    hero.hitFlash = 0;
    hero.lungeT = 0;
    hero.lunge = undefined;
    st.trail = new Set<string>([key(st.level.start)]);
    st.path = [];
    st.fx = [];
    st.pointer = null;
    st.descending = 0;
    st.compass = null;
    this.rng = makeRng(hashSeed(st.seed, st.depth, salt));
    this.moveTimer = 0;
    this.holdTimer = 0;
    this.regenTimer = 0;
    this.compassTimer = COMPASS_MS;
    pushLog(st, st.level.kind === 'shop' ? 'Shop' : `Depth ${st.depth}`);
    this.dirty = true;
    this.emit();
  }

  /** Tiles the hero may walk *through* while path-finding a drag. */
  private isWalkable(p: Vec): boolean {
    const st = this.state;
    if (!isFloor(st.level, p)) return false;
    // Patrols are shoved aside rather than fought, so a drag routes right
    // through them; guards and lurkers are walls you have to deal with.
    const m = liveMonsterAt(st.level, p);
    if (m && m.kind !== 'patrol') return false;
    if (chestAt(st.level, p)) return false;
    if (offerAt(st.level, p)) return false; // pedestals are solid
    if (closedDoorAt(st.level, p) && st.hero.keys.door <= 0) return false;
    return true;
  }

  /**
   * Tiles a drag may *end* on: monsters (walking in = attack), chests
   * (walking in = open) and shop pedestals (walking in = buy, or a red blink
   * when the hero cannot) are legal targets even though they can't be crossed.
   */
  private isTarget(p: Vec): boolean {
    const st = this.state;
    if (!isFloor(st.level, p)) return false;
    if (closedDoorAt(st.level, p) && st.hero.keys.door <= 0) return false;
    const chest = chestAt(st.level, p);
    if (chest && chest.opened) return false;
    return true;
  }

  private stepOnce(stats: ItemStats = heroStats(this.state.hero)): void {
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
    if (m && m.kind !== 'patrol') {
      this.swingAt(m);
      return;
    }

    if (m) {
      // A patrol in the way is shoved past: the two swap tiles and the hero
      // loses a moment doing it. No swing (hold the finger on it for that).
      m.pos = { x: hero.pos.x, y: hero.pos.y };
      hero.stun = SHOVE_STUN;
      st.fx.push({ kind: 'flash', pos: { x: next.x, y: next.y }, color: GREY, t: 0, ttl: 240 });
      st.fx.push({ kind: 'flash', pos: { x: hero.pos.x, y: hero.pos.y }, color: GREY, t: 0, ttl: 240 });
    } else {
      const offer = offerAt(st.level, next);
      if (offer) {
        this.bumpOffer(offer);
        return;
      }

      const chest = chestAt(st.level, next);
      if (chest) {
        this.bumpChest(chest);
        return;
      }

      // Long sword: the blade reaches over the empty tile in front of the hero.
      if (stats.reach >= 2 && !closedDoorAt(st.level, next)) {
        const far = { x: next.x + (next.x - hero.pos.x), y: next.y + (next.y - hero.pos.y) };
        const beyond = isFloor(st.level, far) ? liveMonsterAt(st.level, far) : null;
        if (beyond) {
          this.reachSwing(beyond);
          return;
        }
      }
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
    // Speed boots kick up a little dust on the tile just left behind.
    if (stats.moveMs > 0) {
      st.fx.push({ kind: 'flash', pos: { x: hero.pos.x, y: hero.pos.y }, color: DUST, t: 0, ttl: 220 });
    }
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
    // Gold charm / xp tome swell the loot itself, so the popup shows what the
    // hero really pockets.
    const stats = heroStats(hero);
    chest.loot.gold = Math.round(chest.loot.gold * stats.goldMult);
    chest.loot.xp = Math.round(chest.loot.xp * stats.xpMult);
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

  /**
   * The hero walked into a shop pedestal. Pedestals are solid, so the hero
   * stays put: with enough gold (and nothing bought yet) the item is paid for
   * and equipped at once, otherwise the pedestal just blinks red.
   */
  private bumpOffer(offer: ShopOffer): void {
    const st = this.state;
    const hero = st.hero;
    st.path.length = 0;
    this.holdTimer = 0;
    const face = dirFromVec(unitToward(hero.pos, offer.pos));
    if (face) hero.facing = face;

    const shop = st.level.shop;
    if (!shop || shop.bought || hero.gold < offer.price) {
      // Wordless cue: sold out / too dear.
      st.fx.push({ kind: 'flash', pos: { x: offer.pos.x, y: offer.pos.y }, color: BLINK_RED, t: 0, ttl: 320 });
      return;
    }

    hero.gold -= offer.price;
    const replaced = equip(hero, offer.item);
    shop.bought = true;
    st.fx.push({
      kind: 'ring',
      pos: { x: offer.pos.x, y: offer.pos.y },
      radius: 1.2,
      color: GOLD,
      t: 0,
      ttl: 420,
    });
    st.modal = { kind: 'item', item: offer.item, replaced };
    pushLog(st, `Bought the ${itemName(offer.item.kind)}`);
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

  /** A long sword swing over the empty tile in between. */
  private reachSwing(m: Monster): void {
    const st = this.state;
    const hero = st.hero;
    st.fx.push({
      kind: 'slash',
      from: { x: hero.pos.x, y: hero.pos.y },
      to: { x: m.pos.x, y: m.pos.y },
      color: '#f4f1e8',
      t: 0,
      ttl: 160,
    });
    this.swingAt(m);
  }

  /**
   * Is `m` within swinging distance? Adjacent always; with the long sword also
   * two tiles away in a straight line, as long as the tile between is clear.
   */
  private inReach(m: Monster, stats: ItemStats): 1 | 2 | 0 {
    const st = this.state;
    const hero = st.hero;
    const d = manhattan(m.pos, hero.pos);
    if (d === 1) return 1;
    if (d !== 2 || stats.reach < 2) return 0;
    if (m.pos.x !== hero.pos.x && m.pos.y !== hero.pos.y) return 0; // diagonal
    const mid = { x: (m.pos.x + hero.pos.x) / 2, y: (m.pos.y + hero.pos.y) / 2 };
    if (!isFloor(st.level, mid)) return 0;
    if (liveMonsterAt(st.level, mid)) return 0;
    if (chestAt(st.level, mid) || offerAt(st.level, mid) || closedDoorAt(st.level, mid)) return 0;
    return 2;
  }

  /** Holding the finger on a monster within reach keeps swinging. */
  private holdAttack(dt: number, stats: ItemStats = heroStats(this.state.hero)): void {
    const st = this.state;
    const p = st.pointer;
    if (!p || st.path.length > 0) {
      this.holdTimer = 0;
      return;
    }
    const m = liveMonsterAt(st.level, p);
    const reach = m ? this.inReach(m, stats) : 0;
    if (!m || reach === 0) {
      this.holdTimer = 0;
      return;
    }
    this.holdTimer -= dt;
    if (this.holdTimer <= 0) {
      if (reach === 2) this.reachSwing(m);
      else this.swingAt(m);
    }
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

  // -------------------------------------------------------------------------
  // Passive magic items
  // -------------------------------------------------------------------------

  /**
   * Everything the equipped items do on their own clock. Called once per tick
   * (never under a modal or mid-descend, which return earlier). Most of it
   * pauses while the hero sleeps; the life amulet keeps pulsing.
   */
  private passives(dt: number, stats: ItemStats): void {
    const st = this.state;
    const hero = st.hero;
    if (!hero.timers) hero.timers = { shield: 0, fire: 0, life: 0, phoenix: 0, bane: 0 };

    // Phoenix cooldown burns down even while sleeping.
    if (hero.timers.phoenix > 0) hero.timers.phoenix = Math.max(0, hero.timers.phoenix - dt);

    // Life amulet: a quarter heart on a fixed beat, in combat and in sleep.
    if (stats.lifePulseMs > 0) {
      hero.timers.life += dt;
      let guard = 0;
      while (hero.timers.life >= stats.lifePulseMs && guard < 8) {
        guard += 1;
        hero.timers.life -= stats.lifePulseMs;
        if (hero.hp < hero.maxHp) {
          hero.hp += 1;
          st.fx.push({ kind: 'flash', pos: { x: hero.pos.x, y: hero.pos.y }, color: GOLD, t: 0, ttl: 240 });
          this.dirty = true;
        }
      }
    } else {
      hero.timers.life = 0;
    }

    if (hero.sleeping) return;

    // Shield amulet: the bubble comes back after a while.
    if (stats.shieldRechargeMs > 0) {
      if (!hero.shieldReady) {
        hero.timers.shield += dt;
        if (hero.timers.shield >= stats.shieldRechargeMs) {
          hero.timers.shield = 0;
          hero.shieldReady = true;
          st.fx.push({
            kind: 'ring',
            pos: { x: hero.pos.x, y: hero.pos.y },
            radius: 0.8,
            color: '#5aa9ff',
            t: 0,
            ttl: 350,
          });
          this.dirty = true;
        }
      }
    } else if (hero.shieldReady || hero.timers.shield !== 0) {
      hero.shieldReady = false;
      hero.timers.shield = 0;
    }

    // Fire staff: a fireball whenever the staff is charged and something is in
    // range. With nothing to shoot the charge simply waits.
    if (stats.fireIntervalMs > 0) {
      hero.timers.fire += dt;
      if (hero.timers.fire >= stats.fireIntervalMs) {
        if (this.castFireball(stats)) hero.timers.fire = 0;
        else hero.timers.fire = stats.fireIntervalMs;
      }
    } else {
      hero.timers.fire = 0;
    }

    // Berserker axe: a red pulse while the bonus is live.
    if (berserkActive(hero, stats)) {
      this.berserkTimer += dt;
      if (this.berserkTimer >= BERSERK_PULSE_MS) {
        this.berserkTimer = 0;
        st.fx.push({ kind: 'flash', pos: { x: hero.pos.x, y: hero.pos.y }, color: RED, t: 0, ttl: 300 });
      }
    } else {
      this.berserkTimer = 0;
    }

    // Bane totem: a slow purple pulse showing the cowed area.
    if (stats.baneRadius > 0) {
      hero.timers.bane += dt;
      let guard = 0;
      while (hero.timers.bane >= BANE_PULSE_MS && guard < 4) {
        guard += 1;
        hero.timers.bane -= BANE_PULSE_MS;
        st.fx.push({
          kind: 'ring',
          pos: { x: hero.pos.x, y: hero.pos.y },
          radius: stats.baneRadius,
          color: '#b98cff',
          t: 0,
          ttl: 600,
        });
      }
    } else {
      hero.timers.bane = 0;
    }
  }

  /**
   * Fire staff: hurl a fireball at the nearest monster within `fireRange` BFS
   * tiles. Its four neighbours catch half. Returns false when there is nothing
   * to shoot at (the staff stays charged).
   */
  private castFireball(stats: ItemStats): boolean {
    const st = this.state;
    const hero = st.hero;
    const dists = bfsDistances(st.level, hero.pos, {
      maxDist: stats.fireRange,
      blocked: (p) => closedDoorAt(st.level, p) !== null,
    });
    let target: Monster | null = null;
    let best = Infinity;
    for (const m of st.level.monsters) {
      if (!m.alive) continue;
      const d = dists.get(key(m.pos));
      if (d === undefined || d > stats.fireRange) continue;
      if (d < best) {
        best = d;
        target = m;
      }
    }
    if (!target) return false;

    const to = { x: target.pos.x, y: target.pos.y };
    st.fx.push({
      kind: 'projectile',
      from: { x: hero.pos.x, y: hero.pos.y },
      to: { x: to.x, y: to.y },
      color: ORANGE,
      t: 0,
      ttl: 260,
    });
    // Both land when the fireball arrives (negative t = delayed).
    st.fx.push({ kind: 'flash', pos: { x: to.x, y: to.y }, color: ORANGE, t: -260, ttl: 260 });
    st.fx.push({ kind: 'ring', pos: { x: to.x, y: to.y }, radius: 1.2, color: ORANGE, t: -260, ttl: 300 });

    const splash = Math.floor(stats.fireDmg / 2);
    const around = [
      { x: to.x, y: to.y - 1 },
      { x: to.x + 1, y: to.y },
      { x: to.x, y: to.y + 1 },
      { x: to.x - 1, y: to.y },
    ];
    damageMonster(st, target, stats.fireDmg, this.rng, { source: 'fire', color: ORANGE });
    if (splash > 0) {
      for (const p of around) {
        const m = liveMonsterAt(st.level, p);
        if (m) damageMonster(st, m, splash, this.rng, { source: 'fire', color: ORANGE });
      }
    }
    this.dirty = true;
    return true;
  }

  /**
   * Key compass: point at the nearest key still lying about, or at the stairs
   * once they are all collected. Only re-run when the hero moved, or twice a
   * second, so the BFS never shows up in a frame budget.
   */
  private updateCompass(stats: ItemStats, dt: number, moved: boolean): void {
    const st = this.state;
    if (!stats.compass) {
      st.compass = null;
      return;
    }
    this.compassTimer += dt;
    if (!moved && this.compassTimer < COMPASS_MS && st.compass) return;
    this.compassTimer = 0;

    const dists = bfsDistances(st.level, st.hero.pos);
    let best: Vec | null = null;
    let bestD = Infinity;
    for (const k of st.level.keys) {
      if (k.taken) continue;
      const d = dists.get(key(k.pos));
      if (d === undefined || d >= bestD) continue;
      bestD = d;
      best = k.pos;
    }
    const to = best ?? st.level.exit;
    st.compass = { x: to.x, y: to.y };
  }

  /** Heal a sleeping hero; wake them (and hand control back) at full health. */
  private sleep(dt: number, stats: ItemStats = heroStats(this.state.hero)): void {
    const hero = this.state.hero;
    this.sleepTimer += dt;
    // The regen ring halves the nap.
    const sleepMs = stats.regenMult > 1 ? SLEEP_MS / 2 : SLEEP_MS;
    const per = sleepMs / Math.max(1, hero.maxHp);
    while (this.sleepTimer >= per && hero.hp < hero.maxHp) {
      this.sleepTimer -= per;
      hero.hp += 1;
      this.dirty = true;
    }
    if (hero.hp >= hero.maxHp) {
      hero.hp = hero.maxHp;
      hero.sleeping = false;
      hero.sinceCombat = 0;
      this.sleepTimer = 0;
      this.state.fx.push({ kind: 'flash', pos: { x: hero.pos.x, y: hero.pos.y }, color: '#f5c451', t: 0, ttl: 260 });
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
  s.compass = null;
  if (!s.stats) s.stats = { kills: 0, deepest: s.depth || 1, playMs: 0 };
  const hero = s.hero as Hero;
  if (!hero.keys) hero.keys = { door: 0, chest: 0 };
  if (!Array.isArray(hero.items)) hero.items = [];
  if (!hero.rpos) hero.rpos = { x: hero.pos.x, y: hero.pos.y };
  hero.stun = 0;
  if (typeof hero.sleeping !== 'boolean') hero.sleeping = false;
  hero.hitFlash = 0;
  hero.lungeT = 0;
  hero.lunge = undefined;
  reviveGear(hero);
  for (const m of s.level?.monsters ?? []) {
    if (typeof m.poisonMs !== 'number') m.poisonMs = 0;
    if (typeof m.poisonDmg !== 'number') m.poisonDmg = 0;
    if (typeof m.slowMs !== 'number') m.slowMs = 0;
  }
  (s.trail as Set<string>).add(key(hero.pos));
  return s as GameState;
}
