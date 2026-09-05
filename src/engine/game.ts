/**
 * The simulation. Owns `GameState` and advances it from rAF ticks.
 *
 * No DOM access here: `main.ts` drives `tick`, `input.ts` drives `pointerAt`/
 * `pointerEnd`, and `onChange` is the "worth persisting" signal for save.ts.
 */
import type { BossData, Chest, Dir, GameState, Hero, Monster, Rng, ShopOffer, Vec } from './types';
import { HEART, ITEM_SLOT, SAVE_VERSION, eq, key, manhattan } from './types';
import { hashSeed, makeRng } from './rng';
import { bfsDistances, bfsPath } from './pathfind';
import { generateLevel } from './maze';
import { themeForDepth } from './themes';
import { newHero, applyLevelUp } from './balance';
import { angelsFollow, updateMonsters } from './monsters';
import {
  GOLD,
  GREEN,
  GREY,
  ORANGE,
  RED,
  chestAt,
  closedDoorAt,
  damageMonster,
  gameOver,
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
  upgradeRandomItem,
} from './items';
import { generateShopLevel, offerAt, offerCenter } from './shop';
import { BOSS_EVERY, bossName, generateBossLevel, makeBossMonster, roomAt } from './boss';

/** The two boss kinds with per-tick rules, narrowed out of the union. */
type NecroData = Extract<BossData, { kind: 'necromancer' }>;
type AngelsData = Extract<BossData, { kind: 'angels' }>;

/** ms between hero steps (~7 tiles/s) without speed boots. */
const MOVE_MS = DEFAULT_MOVE_MS;
/** A knocked-down hero sleeps back to full health over about this long. */
const SLEEP_MS = 3500;
/** ms between swings while the hero is engaged with (or the finger is on) a monster. */
const HOLD_ATTACK_MS = 300;
/** An engaged monster further away than this (manhattan) is forgotten. */
const ENGAGE_LEASH = 3;
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
/** Red blink for "you cannot do that" (locked door / chest). */
const BLINK_RED = '#e53b3b';
/** Speed-boots dust colour. */
const DUST = '#8f8ca8';
/** ms between berserker aura pulses. */
const BERSERK_PULSE_MS = 600;
/** ms between bane totem pulses. */
const BANE_PULSE_MS = 2000;
/** How often the compass re-runs its BFS when the hero stands still. */
const COMPASS_MS = 500;
/** The necromancer's colour: his channelling ring and his exit. */
const PURPLE = '#b98cff';

export class Game {
  state!: GameState;
  /** Called after any state change worth persisting. Set by main.ts. */
  onChange?: (state: GameState) => void;

  private rng!: Rng;
  private moveTimer = 0;
  private holdTimer = 0;
  /** Monster the hero last swung at; auto-attacked while it stays in reach. */
  private engagedId: string | null = null;
  private regenTimer = 0;
  private sleepTimer = 0;
  private berserkTimer = 0;
  private compassTimer = COMPASS_MS;
  private dirty = false;
  /**
   * Next skeleton number on this boss floor. Seeded from the monster list so
   * ids stay unique across a save/reload (dead minions stay in the list).
   */
  private minionSeq = 0;

  constructor(saved?: GameState | null) {
    // A dead run is not resumable: start over rather than reviving a corpse.
    if (saved && !saved.over) {
      this.state = reviveState(saved);
      this.rng = makeRng(hashSeed(this.state.seed, this.state.depth, RNG_SALT));
      this.minionSeq = this.state.level.monsters.length;
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

    // Dragging anywhere but onto the engaged monster is a new intent.
    if (this.engagedId) {
      const em = st.level.monsters.find((x) => x.id === this.engagedId);
      if (!em || !eq(em.pos, tile)) this.engagedId = null;
    }
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
      this.engagedId = null;
      this.moveTimer = Math.min(this.moveTimer, moveMs);
      this.sleep(dt, stats);
    } else if (hero.stun > 0) {
      this.moveTimer = Math.min(this.moveTimer, moveMs);
    } else {
      let guard = 0;
      while (st.path.length > 0 && this.moveTimer >= moveMs && guard < 8) {
        guard += 1;
        this.moveTimer -= moveMs;
        const from = hero.pos;
        this.stepOnce(stats);
        if (st.descending > 0 || st.modal) break;
        // Every real step the hero takes, the angels take one back.
        if (!eq(hero.pos, from)) this.angelsFollow();
        if (st.descending > 0 || st.modal || hero.stun > 0) break;
      }
      if (st.path.length === 0) this.moveTimer = Math.min(this.moveTimer, moveMs);
      if (st.descending === 0 && !st.modal) this.autoAttack(dt, stats);
    }

    this.checkLevelUp();
    this.lerpHero(dt);
    this.updateCompass(stats, dt, !eq(hero.pos, posBeforeStep));

    // --- monsters ----------------------------------------------------------
    const hpBefore = hero.hp;
    const posBefore = hero.pos;
    updateMonsters(st, dt, this.rng);
    if (hero.hp !== hpBefore || hero.pos !== posBefore) this.dirty = true;

    // --- boss chamber -------------------------------------------------------
    this.tickBoss(dt);
    this.checkLevelUp();
    // A boss popup (won, or the run ending) freezes everything else at once.
    if (st.modal) {
      this.emit();
      return;
    }

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
      stats: { kills: 0, deepest: depth, playMs: 0, bosses: 0 },
      descending: 0,
      modal: null,
      compass: null,
      over: false,
    };
    this.rng = makeRng(hashSeed(seed, depth, RNG_SALT));
    this.minionSeq = 0;
    this.moveTimer = 0;
    this.holdTimer = 0;
    this.engagedId = null;
    this.regenTimer = 0;
    pushLog(this.state, 'Drag your finger to guide the hero');
    this.emit();
  }

  /**
   * Stairs taken. A maze floor whose depth is a multiple of three leads into
   * the boss chamber, the boss chamber into the shop (both at that same
   * depth), and the shop on to the next maze floor. `state.depth` only ever
   * counts maze floors.
   */
  private advanceLevel(): void {
    const st = this.state;
    const hero = st.hero;
    const from = st.level.kind;
    let salt = RNG_SALT;
    if (from === 'boss') {
      st.level = generateShopLevel(st.depth, st.seed, hero);
      salt = RNG_SALT + 1;
    } else if (from === 'maze' && st.depth % BOSS_EVERY === 0) {
      st.level = generateBossLevel(st.depth, st.seed);
      salt = RNG_SALT + 2;
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
    this.engagedId = null;
    this.regenTimer = 0;
    this.compassTimer = COMPASS_MS;
    this.minionSeq = st.level.monsters.length;
    const boss = st.level.boss;
    if (st.level.kind === 'boss' && boss) {
      // Nothing runs — the spell clock included — until the player has read
      // who is down here and what to do about them.
      st.modal = { kind: 'bossIntro', boss: boss.kind };
      pushLog(st, bossName(boss.kind));
    } else {
      pushLog(st, st.level.kind === 'shop' ? 'Shop' : `Depth ${st.depth}`);
    }
    this.dirty = true;
    this.emit();
  }

  /** Tiles the hero may walk *through* while path-finding a drag. */
  private isWalkable(p: Vec): boolean {
    const st = this.state;
    if (!isFloor(st.level, p)) return false;
    // Monsters are solid: a drag never routes through one. Walking into a
    // monster is how you start a fight (see stepOnce).
    if (liveMonsterAt(st.level, p)) return false;
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

    // Nobody walks through a monster. Trying to is how a fight starts: the
    // hero swings at whatever is in the way and stays engaged with it.
    const m = liveMonsterAt(st.level, next);
    if (m) {
      this.swingAt(m);
      return;
    }

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
        st.fx.push({ kind: 'flash', pos: { x: next.x, y: next.y }, color: BLINK_RED, t: 0, ttl: 320 });
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
      st.fx.push({ kind: 'flash', pos: { x: chest.pos.x, y: chest.pos.y }, color: BLINK_RED, t: 0, ttl: 320 });
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
   * stays put and the offer popup opens instead: what the item is, what it
   * does, what it costs. Buying happens from there, via `buyOffer`.
   */
  private bumpOffer(offer: ShopOffer): void {
    const st = this.state;
    const hero = st.hero;
    st.path.length = 0;
    this.holdTimer = 0;
    const face = dirFromVec(unitToward(hero.pos, offerCenter(offer)));
    if (face) hero.facing = face;

    st.modal = {
      kind: 'shopOffer',
      offerId: offer.id,
      item: offer.item,
      price: offer.price,
      gold: hero.gold,
      replaces: hero.gear?.[ITEM_SLOT[offer.item.kind]] ?? null,
      soldOut: st.level.shop?.bought ?? false,
    };
    this.dirty = true;
  }

  /**
   * Buy the offer the popup is showing. Silently does nothing when the shop
   * has already sold its one item or the hero cannot pay — the popup greys
   * its own buy button out in those cases, so this is only belt and braces.
   * On success the offer popup gives way to the "you got it" popup.
   */
  buyOffer(offerId: string): void {
    const st = this.state;
    const hero = st.hero;
    const shop = st.level.shop;
    if (!shop || shop.bought) return;
    const offer = shop.offers.find((o) => o.id === offerId);
    if (!offer || hero.gold < offer.price) return;

    hero.gold -= offer.price;
    const replaced = equip(hero, offer.item);
    shop.bought = true;
    const c = offerCenter(offer);
    st.fx.push({ kind: 'ring', pos: c, radius: 1.8, color: GOLD, t: 0, ttl: 420 });
    st.modal = { kind: 'item', item: offer.item, replaced };
    pushLog(st, `Bought the ${itemName(offer.item.kind)}`);
    this.dirty = true;
    this.emit();
  }

  /** Pause the game behind the help screen (no-op if another popup is up). */
  openHelp(): void {
    const st = this.state;
    if (st.modal) return;
    st.modal = { kind: 'help' };
    st.path.length = 0;
    st.pointer = null;
  }

  /** Close the current popup and let the simulation run again. */
  dismissModal(): void {
    const st = this.state;
    if (!st.modal) return;
    // The game-over screen has one button and it starts a fresh run: the state
    // behind it is dead and must not be touched afterwards.
    if (st.modal.kind === 'gameOver') {
      this.newGame();
      return;
    }
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
    // The swing clears the queue; from here on the hero keeps attacking on
    // their own while the monster stays in reach (see autoAttack).
    st.path.length = 0;
    // Nothing to gain from hammering on something that cannot be hurt: one
    // swing says "Immune" and the hero lets it go.
    this.engagedId = m.alive && !m.invulnerable ? m.id : null;
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

  /**
   * Keep fighting without further input. The target is the monster under the
   * finger if it is in reach, otherwise the monster the hero last swung at,
   * otherwise any monster the hero is standing within reach of (adjacent, or
   * two tiles down a line with the long sword). Engagement ends when the
   * target dies, wanders more than a few tiles off, the player drags the hero
   * away, or the hero is knocked out.
   */
  private autoAttack(dt: number, stats: ItemStats = heroStats(this.state.hero)): void {
    const st = this.state;
    if (st.path.length > 0) {
      this.holdTimer = 0;
      return;
    }
    const engaged = this.engagedId ? st.level.monsters.find((x) => x.id === this.engagedId) ?? null : null;
    if (engaged && (!engaged.alive || manhattan(engaged.pos, st.hero.pos) > ENGAGE_LEASH)) this.engagedId = null;

    const pointed = st.pointer ? liveMonsterAt(st.level, st.pointer) : null;
    let target = pointed && this.inReach(pointed, stats) ? pointed : null;
    if (!target && engaged && engaged.alive && this.engagedId) target = engaged;
    if (!target) {
      // Standing still within reach of a monster means fighting it: the hero
      // walked up to it, or it walked up to the hero. Either way, swing.
      target = this.nearestInReach(stats);
      if (target) {
        this.engagedId = target.id;
        this.holdTimer = Math.min(this.holdTimer, HOLD_ATTACK_MS);
      }
    }
    if (!target) {
      this.holdTimer = 0;
      return;
    }
    const reach = this.inReach(target, stats);
    if (reach === 0) {
      // Knocked back or the monster moved: close the gap one tile at a time.
      this.holdTimer = Math.min(this.holdTimer, HOLD_ATTACK_MS);
      if (target === engaged) this.closeIn(target);
      return;
    }
    this.holdTimer -= dt;
    if (this.holdTimer <= 0) {
      if (reach === 2) this.reachSwing(target);
      else this.swingAt(target);
    }
  }

  /** Queue one step toward an engaged monster that slipped out of reach. */
  private closeIn(m: Monster): void {
    const st = this.state;
    if (st.hero.stun > 0) return;
    const route = bfsPath(st.level, st.hero.pos, m.pos, {
      blocked: (p) => !eq(p, m.pos) && !this.isWalkable(p),
      maxLen: ENGAGE_LEASH + 1,
    });
    if (!route || route.length < 2) return; // adjacent already, or no way through
    st.path.push({ x: route[0].x, y: route[0].y });
  }

  /**
   * The live monster the hero can hit from where they stand: an adjacent one
   * first, else one at long-sword reach. Ties go to level order, which keeps
   * the choice deterministic.
   */
  private nearestInReach(stats: ItemStats): Monster | null {
    let far: Monster | null = null;
    for (const m of this.state.level.monsters) {
      if (!m.alive || m.invulnerable) continue;
      const r = this.inReach(m, stats);
      if (r === 1) return m;
      if (r === 2 && !far) far = m;
    }
    return far;
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
      // The stairs of a minotaur / angel chamber ARE the objective: claim the
      // reward first, then descend once the player dismisses the popup.
      if (level.kind === 'boss' && level.boss && !level.boss.defeated) this.winBoss();
      st.descending = DESCEND_MS;
      st.path.length = 0;
      pushText(st, tile, 'Descending...', GREEN, 1200);
      pushLog(st, 'Stairs down!');
      this.dirty = true;
    }
  }

  // -------------------------------------------------------------------------
  // Boss chambers
  // -------------------------------------------------------------------------

  /**
   * Everything the boss of this floor does on its own clock. Called once per
   * tick, never under a popup and never mid-descent (tick returns earlier), so
   * the intro modal really does hold the necromancer's spell back.
   */
  private tickBoss(dt: number): void {
    const st = this.state;
    const boss = st.level.boss;
    if (st.level.kind !== 'boss' || !boss || boss.defeated) return;
    if (boss.kind === 'necromancer') this.tickNecromancer(dt, boss);
    else if (boss.kind === 'angels') this.wakeAngels(boss);
    // The minotaur has no clock at all: he just follows you (monsters.ts).
  }

  /** Spell clock, skeleton spawns, and the crystals that end all three. */
  private tickNecromancer(dt: number, boss: NecroData): void {
    const st = this.state;
    const level = st.level;

    // Crystals first, so the last one smashed on the very tick the spell would
    // land still wins the floor.
    const crystals = level.monsters.filter((m) => m.kind === 'crystal');
    if (crystals.length > 0 && crystals.every((m) => !m.alive)) {
      this.necromancerFlees();
      return;
    }

    boss.spellMs -= dt;
    if (boss.spellMs <= 0) {
      boss.spellMs = 0;
      gameOver(st, 'The Necromancer finished his spell.');
      return;
    }

    boss.spawnMs -= dt;
    if (boss.spawnMs <= 0) {
      boss.spawnMs = boss.spawnEveryMs;
      this.raiseMinion(boss);
    }
  }

  /** A skeleton claws its way up beside its master, if there is room for it. */
  private raiseMinion(boss: NecroData): void {
    const st = this.state;
    const level = st.level;
    const live = level.monsters.reduce((n, m) => n + (m.alive && m.kind === 'minion' ? 1 : 0), 0);
    if (live >= boss.maxMinions) return;
    const necro = level.monsters.find((m) => m.kind === 'boss');
    if (!necro) return;
    const tile = this.freeTileNear(necro.pos);
    if (!tile) return;

    const minion = makeBossMonster('minion', level.depth, tile, `minion${this.minionSeq}`);
    this.minionSeq += 1;
    level.monsters.push(minion);
    st.fx.push({ kind: 'flash', pos: { x: tile.x, y: tile.y }, color: PURPLE, t: 0, ttl: 360 });
    pushText(st, tile, 'rises', PURPLE, 900);
    this.dirty = true;
  }

  /** A free floor tile beside `p`: the four sides first, then the corners. */
  private freeTileNear(p: Vec): Vec | null {
    const st = this.state;
    const around: Vec[] = [
      { x: p.x, y: p.y - 1 },
      { x: p.x + 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x - 1, y: p.y },
      { x: p.x + 1, y: p.y - 1 },
      { x: p.x + 1, y: p.y + 1 },
      { x: p.x - 1, y: p.y + 1 },
      { x: p.x - 1, y: p.y - 1 },
    ];
    for (const t of around) {
      if (!isFloor(st.level, t)) continue;
      if (liveMonsterAt(st.level, t)) continue;
      if (eq(t, st.hero.pos)) continue;
      return t;
    }
    return null;
  }

  /**
   * The last crystal is dust: the necromancer abandons the spell and vanishes,
   * his skeletons crumble, and the stairs he was standing on are finally free.
   */
  private necromancerFlees(): void {
    const st = this.state;
    const level = st.level;
    const necro = level.monsters.find((m) => m.kind === 'boss');
    if (necro) {
      necro.alive = false;
      st.fx.push({
        kind: 'ring',
        pos: { x: necro.pos.x, y: necro.pos.y },
        radius: 2.4,
        color: PURPLE,
        t: 0,
        ttl: 700,
      });
      pushText(st, necro.pos, 'The Necromancer flees!', PURPLE, 1600);
      level.exit = { x: necro.pos.x, y: necro.pos.y };
    }
    for (const m of level.monsters) {
      if (!m.alive || m.kind !== 'minion') continue;
      m.alive = false;
      st.fx.push({ kind: 'flash', pos: { x: m.pos.x, y: m.pos.y }, color: GREY, t: 0, ttl: 320 });
    }
    this.winBoss();
  }

  /**
   * Angels move only when the hero does: one hero step, one angel step (or a
   * touch, if the angel is already at the hero's side). Called right after
   * each step, before `wakeAngels`, so an angel woken by this very step
   * stirs but does not move until the next one.
   */
  private angelsFollow(): void {
    const st = this.state;
    const boss = st.level.boss;
    if (st.level.kind !== 'boss' || !boss || boss.kind !== 'angels' || boss.defeated) return;
    const hpBefore = st.hero.hp;
    angelsFollow(st, this.rng);
    if (st.hero.hp !== hpBefore) this.dirty = true;
  }

  /** Every idle angel in the room the hero just walked into opens its eyes. */
  private wakeAngels(boss: AngelsData): void {
    const st = this.state;
    const room = roomAt(boss.rooms, st.hero.pos);
    if (room < 0) return;
    let woke = false;
    for (const m of st.level.monsters) {
      if (!m.alive || m.kind !== 'angel' || m.state !== 'idle') continue;
      if (m.roomId !== room) continue;
      m.state = 'chasing';
      pushText(st, m.pos, '!', RED, 900);
      woke = true;
    }
    if (woke) {
      pushLog(st, 'An angel stirs...');
      pushShake(st, 6, 260);
      this.dirty = true;
    }
  }

  /**
   * The floor is won. One worn item gains a level (a hero wearing nothing gets
   * a heart instead), the hero is patched up, and the popup holds everything
   * still until the player taps it away — the descent, when there is one,
   * happens after that.
   */
  private winBoss(): void {
    const st = this.state;
    const hero = st.hero;
    const boss = st.level.boss;
    if (!boss || boss.defeated) return;
    boss.defeated = true;
    st.stats.bosses += 1;

    const upgraded = upgradeRandomItem(hero, this.rng);
    const heart = upgraded === null;
    if (heart) {
      hero.maxHp += HEART;
      hero.hp += HEART;
    }
    hero.hp = hero.maxHp;
    hero.sleeping = false;
    hero.stun = 0;
    st.path.length = 0;
    st.fx.push({
      kind: 'ring',
      pos: { x: hero.pos.x, y: hero.pos.y },
      radius: 2,
      color: GOLD,
      t: 0,
      ttl: 600,
    });
    st.modal = { kind: 'bossWon', boss: boss.kind, upgraded, heart };
    pushLog(st, `${bossName(boss.kind)} is beaten!`);
    this.dirty = true;
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
      if (!m.alive || m.invulnerable) continue; // no point setting a boss on fire
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
  s.over = false;
  if (typeof s.level.theme !== 'string') s.level.theme = themeForDepth(s.depth).id;
  if (!s.stats) s.stats = { kills: 0, deepest: s.depth || 1, playMs: 0, bosses: 0 };
  if (typeof s.stats.bosses !== 'number') s.stats.bosses = 0;
  // Dropped back into an unfinished boss chamber: show the briefing again, so
  // the spell clock is not running while the player works out where they are.
  if (s.level.kind === 'boss' && s.level.boss && !s.level.boss.defeated) {
    s.modal = { kind: 'bossIntro', boss: s.level.boss.kind };
  }
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
