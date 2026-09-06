/**
 * Combat resolution: hero <-> monster.
 *
 * Also hosts a handful of tiny shared helpers (fx/log pushing, entity lookup)
 * used by `monsters.ts` and `game.ts`. Import direction is strictly
 * game.ts -> monsters.ts -> combat.ts, so there are no cycles.
 */
import type {
  BossKind,
  Chest,
  Door,
  Effect,
  GameState,
  KeyItem,
  LevelData,
  Monster,
  Orb,
  Rng,
  RunStats,
  SfxId,
  Shrine,
  Vec,
} from './types';
import { BOSS_HIT_FRACTION, HEART, eq, key, manhattan, parseKey } from './types';
import { bossRetryCost, damage, xpShare } from './balance';
import { bfsDistances, floorNeighbors, isFloor } from './pathfind';
import { hiddenAt, sameSide } from './lens';
import { altarAt, closedSealAt, orbById } from './puzzles';
import type { ItemStats } from './items';
import { berserkActive, heroStats } from './items';
import { SHRINE_COLORS, buffAtk, buffDef } from './shrines';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export const WHITE = '#f4f1e8';
export const RED = '#ff5c5c';
export const GOLD = '#ffd166';
export const GREEN = '#8fd694';
export const BLUE = '#5aa9ff';
export const ORANGE = '#ff8c3a';
export const GREY = '#c9c6d6';
export const SPARK = '#bfe3ff';
export const ICE = '#bfe3ff';

/** Push a floating text effect at `pos`. */
export function pushText(
  state: GameState,
  pos: Vec,
  text: string,
  color: string,
  ttl = 900,
): void {
  const e: Effect = { kind: 'text', pos: { x: pos.x, y: pos.y }, text, color, t: 0, ttl };
  state.fx.push(e);
}

/** Push a screen shake effect. */
export function pushShake(state: GameState, strength: number, ttl = 200): void {
  state.fx.push({ kind: 'shake', t: 0, ttl, strength });
}

/**
 * Ask for a sound. The audio layer drains the queue every frame and clears it;
 * when the sound is off nobody drains it at all, so the queue is capped rather
 * than left to grow for the whole run.
 */
export function pushSfx(state: GameState, id: SfxId): void {
  if (!state.sfx) state.sfx = [];
  state.sfx.push(id);
  if (state.sfx.length > SFX_QUEUE_MAX) state.sfx.splice(0, state.sfx.length - SFX_QUEUE_MAX);
}

/** More than a couple of frames' worth of sounds is a backlog nobody wants to hear. */
const SFX_QUEUE_MAX = 24;

/**
 * How many log lines a run keeps. The log used to be three fading lines in the
 * corner of the HUD, so five was plenty; it now lives on a tab of the help
 * screen that the player opens after the fact, and a history that only went
 * back five lines would rarely still hold what they came to look up.
 */
export const LOG_MAX = 30;

/** Push a log message, trimming to the newest `LOG_MAX`. */
export function pushLog(state: GameState, text: string): void {
  const last = state.log[state.log.length - 1];
  // `t` still ages (see `ageLog`) purely to bound this de-duplication window:
  // one event that fires twice in a frame is one line, the same event a minute
  // later is two.
  if (last && last.text === text && last.t < 400) return;
  state.log.push({ text, t: 0 });
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
}

/** The live monster standing on `p`, if any. */
export function liveMonsterAt(level: LevelData, p: Vec): Monster | null {
  for (const m of level.monsters) if (m.alive && m.pos.x === p.x && m.pos.y === p.y) return m;
  return null;
}

export function doorAt(level: LevelData, p: Vec): Door | null {
  for (const d of level.doors) if (d.pos.x === p.x && d.pos.y === p.y) return d;
  return null;
}

/** A door on `p` that is still shut (blocks movement). */
export function closedDoorAt(level: LevelData, p: Vec): Door | null {
  const d = doorAt(level, p);
  return d && !d.open ? d : null;
}

/** Is `p` a stairs down — the floor's own, or the wing's? */
export function exitAt(level: LevelData, p: Vec): boolean {
  if (p.x === level.exit.x && p.y === level.exit.y) return true;
  const w = level.wingExit;
  return !!w && w.x === p.x && w.y === p.y;
}

/** An un-picked-up key on `p`. */
export function keyAt(level: LevelData, p: Vec): KeyItem | null {
  for (const k of level.keys) if (!k.taken && k.pos.x === p.x && k.pos.y === p.y) return k;
  return null;
}

/** An unlit shrine on `p`. A spent one is scenery and never looked up. */
export function shrineAt(level: LevelData, p: Vec): Shrine | null {
  for (const sh of level.shrines ?? []) {
    if (!sh.used && sh.pos.x === p.x && sh.pos.y === p.y) return sh;
  }
  return null;
}

/** An unopened chest on `p`. */
/** Any chest on this tile, opened or not. Chests are solid: nobody walks on them. */
export function chestAt(level: LevelData, p: Vec): Chest | null {
  for (const c of level.chests) if (c.pos.x === p.x && c.pos.y === p.y) return c;
  return null;
}

/**
 * Can the hero stand on this tile right now? Keys are fine to stand on; chests
 * are not.
 *
 * `from` is where the hero is being moved out of, and it settles the one
 * question a tile alone cannot answer: hidden ground. Nothing may shove or
 * carry the hero through the wall of a passage in either direction — a hero
 * with no lens must never wake up inside one, and a hero standing in one is
 * not knocked back out through solid brick either.
 */
export function heroCanStand(level: LevelData, p: Vec, from?: Vec): boolean {
  if (!isFloor(level, p)) return false;
  if (closedDoorAt(level, p)) return false;
  if (closedSealAt(level, p)) return false;
  if (liveMonsterAt(level, p)) return false;
  if (chestAt(level, p)) return false;
  if (altarAt(level, p)) return false;
  if (hiddenAt(level, p) !== (from ? hiddenAt(level, from) : false)) return false;
  return true;
}

/** The orb the hero is carrying, or null. */
export function carriedOrb(state: GameState): Orb | null {
  const id = state.hero.carrying;
  return id ? orbById(state.level, id) : null;
}

/** The lens' own blue, which the orbs and runes share. */
export const ORB = '#8fe3ff';

/**
 * Set the carried orb down on `at`. Both hands are free again; the orb lies
 * where it was put and is picked up again by stepping onto it. Silent when
 * nothing is carried.
 */
export function dropOrb(state: GameState, at: Vec): Orb | null {
  const orb = carriedOrb(state);
  if (!orb) return null;
  orb.state = 'floor';
  orb.pos = { x: at.x, y: at.y };
  state.hero.carrying = null;
  pushText(state, at, 'Set down', ORB, 800);
  pushSfx(state, 'orbSet');
  return orb;
}

/** Unit step from `a` toward the 4-adjacent `b`. */
export function unitToward(a: Vec, b: Vec): Vec {
  return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

/** Where a hit came from. Only the hero's own swing procs on-hit magic items. */
export type DamageSource = 'hero' | 'fire' | 'chain' | 'poison' | 'thorn';

export interface DamageOpts {
  source?: DamageSource;
  /** Floating text colour (default white). */
  color?: string;
  /** Floating text override (default "-dmg"). */
  text?: string;
}

/**
 * The single door every point of monster damage goes through: hero swings,
 * fireballs, chain lightning, poison ticks and thorn mail. Applies the damage,
 * the hit flash and the combat clocks, then the death rewards (with the
 * hero's gold/xp multipliers and the vampire fang's kill heal).
 */
export function damageMonster(
  state: GameState,
  m: Monster,
  dmg: number,
  rng: Rng,
  opts: DamageOpts = {},
): void {
  if (!m.alive) return;
  const amount = Math.max(0, Math.round(dmg));
  if (amount <= 0) return;
  // Bosses, angels and the necromancer cannot be hurt at all: no hit flash, no
  // combat clocks, no on-hit procs. Just a word so the player stops trying.
  if (m.invulnerable) {
    pushText(state, m.pos, 'Immune', GREY);
    pushSfx(state, 'immune');
    return;
  }
  const hero = state.hero;
  const source = opts.source ?? 'hero';
  const stats = heroStats(hero);

  m.hp -= amount;
  m.hitFlash = 150;
  m.sinceCombat = 0;
  // Poison keeps ticking after the hero has walked away: it must not hold the
  // hero's out-of-combat regen hostage.
  if (source !== 'poison') hero.sinceCombat = 0;
  pushText(state, m.pos, opts.text ?? `-${amount}`, opts.color ?? WHITE);
  // The hero's own swing is the one that gets a "connected" sound; fireballs,
  // lightning, poison and thorns already announce themselves.
  if (source === 'hero') pushSfx(state, 'hit');

  const killed = m.hp <= 0;
  if (killed) {
    m.hp = 0;
    m.alive = false;
    const xp = Math.round(m.xp * stats.xpMult * xpShare(hero.level, m.level));
    const gold = Math.round(m.gold * stats.goldMult);
    hero.xp += xp;
    hero.gold += gold;
    state.stats.kills += 1;
    pushText(state, m.pos, `+${xp} xp`, GOLD, 1100);
    pushLog(state, `Slew the ${m.name}`);
    // A crystal is an objective, not a kill: it gets its own shatter.
    pushSfx(state, m.kind === 'crystal' ? 'crystal' : 'kill');
    if (stats.vampKillHeal > 0) healHero(state, stats.vampKillHeal);
  }

  if (source === 'hero') onHeroHit(state, m, rng, stats, killed);
}

/** Heal the hero, clamped to maxHp. Pushes a small green cue. */
function healHero(state: GameState, amount: number): void {
  const hero = state.hero;
  if (amount <= 0 || hero.hp >= hero.maxHp) return;
  hero.hp = Math.min(hero.maxHp, hero.hp + amount);
  state.fx.push({ kind: 'flash', pos: { x: hero.pos.x, y: hero.pos.y }, color: GREEN, t: 0, ttl: 240 });
}

/** Poison / frost / lightning / vampire procs that ride on the hero's swing. */
function onHeroHit(
  state: GameState,
  m: Monster,
  rng: Rng,
  stats: ItemStats,
  killed: boolean,
): void {
  if (!killed) {
    if (stats.poisonMs > 0) {
      m.poisonMs = Math.max(m.poisonMs, stats.poisonMs);
      m.poisonDmg = stats.poisonDmg;
    }
    if (stats.slowMs > 0) m.slowMs = Math.max(m.slowMs, stats.slowMs);
  }
  if (stats.vampHitChance > 0 && rng.chance(stats.vampHitChance)) healHero(state, 1);
  if (stats.chainChance > 0 && rng.chance(stats.chainChance)) chainFrom(state, m, rng, stats);
}

/** Lightning wand: hop from the struck monster to its nearest live neighbours. */
function chainFrom(state: GameState, m: Monster, rng: Rng, stats: ItemStats): void {
  const targets = state.level.monsters
    .filter(
      (o) =>
        o.alive &&
        !o.invulnerable &&
        o !== m &&
        manhattan(o.pos, m.pos) <= CHAIN_RADIUS &&
        // Lightning hops between monsters, not through the wall of a passage.
        sameSide(state.level, o.pos, m.pos),
    )
    .sort((a, b) => manhattan(a.pos, m.pos) - manhattan(b.pos, m.pos))
    .slice(0, Math.max(0, stats.chainTargets));
  if (targets.length === 0) return;
  const points: Vec[] = [
    { x: state.hero.pos.x, y: state.hero.pos.y },
    { x: m.pos.x, y: m.pos.y },
  ];
  for (const t of targets) points.push({ x: t.pos.x, y: t.pos.y });
  state.fx.push({ kind: 'bolt', points, color: SPARK, t: 0, ttl: 220 });
  pushSfx(state, 'zap');
  for (const t of targets) {
    damageMonster(state, t, stats.chainDmg, rng, { source: 'chain', color: SPARK });
  }
}

/** How far chain lightning hops (manhattan tiles). */
const CHAIN_RADIUS = 3;

/**
 * The hero's attack right now: base, plus the berserker axe while wounded,
 * plus a fury shrine while it burns.
 */
export function heroAttackValue(state: GameState): number {
  const hero = state.hero;
  const stats = heroStats(hero);
  return hero.atk + (berserkActive(hero, stats) ? stats.berserkAtk : 0) + buffAtk(hero);
}

/** Hero attacks monster. Applies damage, pushes fx/log, handles death. */
export function heroAttack(state: GameState, m: Monster, rng: Rng): void {
  if (!m.alive) return;
  const dmg = damage(heroAttackValue(state), m.def, rng);
  damageMonster(state, m, dmg, rng, { source: 'hero' });
}

/**
 * Monster attacks hero: damage, lunge, knockback one tile, and a "knock down"
 * (never a death) when hp would reach 0. Returns true when the hit resolved a
 * knockdown (phoenix burst, potion burst, sleep, or boss-chamber game over) —
 * callers use this to stop feeding the hero more hits from other monsters in
 * the same tick, which would otherwise burn a second potion/phoenix charge or
 * kill a hero a burst-back-up just saved.
 */
export function monsterAttack(state: GameState, m: Monster, rng: Rng): boolean {
  const hero = state.hero;
  const level = state.level;
  const stats = heroStats(hero);

  const away = unitToward(m.pos, hero.pos);
  m.lunge = { x: away.x, y: away.y };
  m.lungeT = 120;
  m.sinceCombat = 0;
  hero.sinceCombat = 0;

  // Shield amulet: the bubble eats the whole hit (no damage, no knockback)
  // and starts recharging. Wordless: just the bubble popping.
  if (hero.shieldReady) {
    hero.shieldReady = false;
    hero.timers.shield = 0;
    state.fx.push({
      kind: 'ring',
      pos: { x: hero.pos.x, y: hero.pos.y },
      radius: 1,
      color: BLUE,
      t: 0,
      ttl: 300,
    });
    pushSfx(state, 'shieldPop');
    return false;
  }

  // A minotaur's horns and an angel's touch always take the same bite out of
  // the hero, whatever their armour: a third of their hearts.
  const bossHit = m.kind === 'minotaur' || m.kind === 'angel';
  const dmg = bossHit
    ? Math.max(1, Math.ceil(hero.maxHp * BOSS_HIT_FRACTION))
    : damage(m.atk, hero.def + buffDef(hero), rng);
  // Ward shrine: temporary hearts take the blow before the hero's own do, and
  // whatever they soak is gone for good.
  const soaked = absorbWithWard(state, dmg);
  hero.hp -= dmg - soaked;
  hero.hitFlash = 150;

  pushText(state, hero.pos, `-${dmg}`, soaked > 0 ? WARD : RED);
  pushShake(state, bossHit ? BOSS_SHAKE : 4, bossHit ? 380 : 180);
  pushSfx(state, 'hurt');
  if (m.kind === 'angel') {
    // Stone drains the colour out of the tile it grabs you on.
    state.fx.push({ kind: 'flash', pos: { x: hero.pos.x, y: hero.pos.y }, color: GREY, t: 0, ttl: 320 });
  }

  // Knockback: shove the hero one tile directly away from the monster.
  // Patrols are the "slow you down" mob: their hits never shove.
  if (!stats.knockbackImmune && m.kind !== 'patrol' && (away.x !== 0 || away.y !== 0)) {
    const back = { x: hero.pos.x + away.x, y: hero.pos.y + away.y };
    if (heroCanStand(level, back, hero.pos)) {
      hero.pos = back;
      state.path.length = 0;
      state.trail.add(key(back));
    }
  }

  // Thorn mail bites back.
  if (stats.thornDmg > 0 && m.alive) {
    damageMonster(state, m, stats.thornDmg, rng, { source: 'thorn', color: GREY });
  }

  if (hero.hp <= 0) {
    knockDown(state, m);
    return true;
  }
  return false;
}

/** How hard the screen jolts when a boss connects. */
const BOSS_SHAKE = 14;

/** Ward shrine blue: the temporary hearts, and the last one popping. */
export const WARD = SHRINE_COLORS.ward;

/**
 * Spend the ward's temporary hearts on `dmg` and return how much they took.
 * The last one popping is worth a ring and a sound: it is the moment the hero
 * is back on their own hearts.
 */
function absorbWithWard(state: GameState, dmg: number): number {
  const hero = state.hero;
  const pool = Math.max(0, hero.tempHp ?? 0);
  if (pool <= 0 || dmg <= 0) return 0;
  const soaked = Math.min(pool, dmg);
  hero.tempHp = pool - soaked;
  if (hero.tempHp === 0) hero.tempHpMax = 0;
  state.fx.push({
    kind: 'ring',
    pos: { x: hero.pos.x, y: hero.pos.y },
    radius: 0.9,
    color: WARD,
    t: 0,
    ttl: 260,
  });
  if (hero.tempHp === 0) {
    state.fx.push({
      kind: 'ring',
      pos: { x: hero.pos.x, y: hero.pos.y },
      radius: 1.6,
      color: WARD,
      t: 0,
      ttl: 420,
    });
    pushLog(state, 'The ward is spent');
    pushSfx(state, 'wardBreak');
  }
  return soaked;
}

/**
 * The run is over: only ever called from a boss chamber. Freezes the world
 * behind the game-over popup with a snapshot of the run for it to show. The
 * hero is left standing where they fell, on 0 hp.
 */
export function gameOver(state: GameState, cause: string): void {
  const hero = state.hero;
  const stats: RunStats = {
    deepest: state.stats.deepest,
    heroLevel: hero.level,
    kills: state.stats.kills,
    bosses: state.stats.bosses,
    gold: hero.gold,
    playMs: state.stats.playMs,
    retries: state.stats.bossRetries,
  };
  state.over = true;
  hero.hp = Math.max(0, hero.hp);
  hero.sleeping = false;
  hero.stun = 0;
  state.path.length = 0;
  state.pointer = null;
  pushLog(state, cause);
  pushSfx(state, 'gameOver');
  const boss: BossKind = state.level.boss?.kind ?? 'necromancer';
  const retryCost = bossRetryCost(state.depth, state.stats.bossRetries);
  state.modal = { kind: 'gameOver', cause, boss, stats, retryCost };
}

/** What finished the hero off, in one sentence, keyed on who landed the blow. */
function causeOfDeath(m: Monster | null): string {
  switch (m?.kind) {
    case 'minotaur':
      return 'The Minotaur caught you.';
    case 'angel':
      return 'You were turned to stone.';
    default:
      return 'The skeletons wore you down.';
  }
}

/**
 * Heroes never die. At 0 hp they are carried back to a nearby tile they walked
 * over recently and fall asleep there; the game hands control back once they
 * have slept themselves back to full health.
 */
/**
 * Heal to half max hp (rounded up to a whole heart), hop to a nearby safe
 * tile and stay on your feet instead of napping. The shared shape of a
 * phoenix feather's burst and a health potion's swig — only the cause, the
 * colour, the sound, the log line and (optionally) the word floating up over
 * the hero's head differ.
 */
function burstBackUp(state: GameState, color: string, sfx: SfxId, log: string, floatText?: string): void {
  const hero = state.hero;
  const half = Math.ceil(hero.maxHp / 2);
  hero.hp = Math.min(hero.maxHp, Math.ceil(half / HEART) * HEART);
  hero.stun = 0;
  hero.sleeping = false;
  state.path.length = 0;
  state.fx.push({ kind: 'ring', pos: { x: hero.pos.x, y: hero.pos.y }, radius: 1.5, color, t: 0, ttl: 500 });
  if (floatText) pushText(state, hero.pos, floatText, color, 1100);
  pushShake(state, 10, 420);
  pushSfx(state, sfx);
  const spot = retreatTile(state);
  if (spot) hero.pos = spot;
  state.trail.add(key(hero.pos));
  pushLog(state, log);
}

function knockDown(state: GameState, attacker: Monster | null = null): void {
  const hero = state.hero;
  const stats = heroStats(hero);

  // Phoenix feather: burst back up instead of sleeping (once per cooldown).
  if (stats.phoenixCooldownMs > 0 && hero.timers.phoenix <= 0) {
    hero.timers.phoenix = stats.phoenixCooldownMs;
    burstBackUp(state, ORANGE, 'phoenix', 'The feather burns!');
    return;
  }

  // Health potion: the same burst back up, spending one charge instead of
  // waiting on a cooldown. Checked after the feather so a hero wearing both
  // spends the free one first and saves the potion for when it is on cooldown.
  if (hero.potions > 0) {
    hero.potions -= 1;
    burstBackUp(state, GOLD, 'potion', 'A health potion saves you!', 'Potion!');
    return;
  }

  // In a boss chamber there is no lying down and no waking up: this is the end
  // of the run. `hero.hp` may be negative here; gameOver settles it at 0.
  if (state.level.kind === 'boss') {
    gameOver(state, causeOfDeath(attacker));
    return;
  }

  hero.hp = 1;
  hero.stun = 0;
  hero.sleeping = true;
  // Whatever was in the hero's arms lands where they fell.
  dropOrb(state, hero.pos);
  // A nap ends every shrine the hero was running on. They lit those alcoves to
  // win a fight they have just lost; the floor's other alcoves are still there.
  hero.buffs = [];
  hero.tempHp = 0;
  hero.tempHpMax = 0;
  state.path.length = 0;
  const dest = retreatTile(state);
  if (dest) hero.pos = dest;
  state.trail.add(key(hero.pos));
  pushShake(state, 12, 450);
  pushLog(state, 'Knocked down!');
  pushSfx(state, 'knockDown');
  healAllMonsters(state);
}

/**
 * A knockdown resets the board: every monster still standing is back to full
 * health, poison and frost included. Chipping a lurker down over several
 * naps is not a strategy; you beat it in one go or you go around it.
 */
function healAllMonsters(state: GameState): void {
  for (const m of state.level.monsters) {
    if (!m.alive) continue;
    const hurt = m.hp < m.maxHp || m.poisonMs > 0 || m.slowMs > 0 || m.frozenMs > 0;
    m.hp = m.maxHp;
    m.poisonMs = 0;
    m.poisonDmg = 0;
    m.slowMs = 0;
    m.frozenMs = 0;
    if (hurt) {
      state.fx.push({ kind: 'flash', pos: { x: m.pos.x, y: m.pos.y }, color: GREEN, t: 0, ttl: 320 });
    }
  }
}

/** A resting spot must be at least this far from every monster... */
const SAFE_MONSTER_DIST = 4;
/** ...and outside its sight by this margin. */
const SAFE_SIGHT_MARGIN = 2;
/** Don't carry the hero further than this (BFS tiles) from where they fell. */
const RETREAT_MAX_DIST = 16;

/**
 * Somewhere the hero can nap: out of reach and out of sight of every live
 * monster, and off every patrol route (a beat walker would trip over them).
 */
function isSafeSpot(state: GameState, p: Vec): boolean {
  if (!heroCanStand(state.level, p, state.hero.pos)) return false;
  for (const m of state.level.monsters) {
    if (!m.alive) continue;
    const need = Math.max(SAFE_MONSTER_DIST, m.sightRange + SAFE_SIGHT_MARGIN);
    if (manhattan(m.pos, p) < need) return false;
    if (m.kind === 'patrol' && m.patrolPath?.some((t) => eq(t, p))) return false;
  }
  return true;
}

/**
 * Pick the most recently walked tile that is safe (free floor, no live
 * monster within 3 tiles) and close by (within 10 BFS tiles). Recently walked
 * means the player already got there once, so it is a known-safe spot. Falls
 * back to any safe trail tile, then any safe neighbour, then the level start.
 */
function retreatTile(state: GameState): Vec | null {
  const hero = state.hero;
  const level = state.level;
  const trail = Array.from(state.trail);
  const near = bfsDistances(level, hero.pos, { maxDist: RETREAT_MAX_DIST });
  let fallback: Vec | null = null;
  for (let i = trail.length - 1; i >= 0; i--) {
    const p = parseKey(trail[i]);
    if (eq(p, hero.pos)) continue;
    if (!isSafeSpot(state, p)) continue;
    if (near.has(trail[i])) return p;
    if (!fallback) fallback = p;
  }
  if (fallback) return fallback;
  for (const n of floorNeighbors(level, hero.pos)) {
    if (isSafeSpot(state, n)) return n;
  }
  return heroCanStand(level, level.start, hero.pos) ? { x: level.start.x, y: level.start.y } : null;
}
