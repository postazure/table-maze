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
  Rng,
  RunStats,
  SfxId,
  Vec,
} from './types';
import { BOSS_HIT_FRACTION, HEART, eq, key, manhattan, parseKey } from './types';
import { damage, xpShare } from './balance';
import { bfsDistances, floorNeighbors, isFloor } from './pathfind';
import type { ItemStats } from './items';
import { berserkActive, heroStats } from './items';

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

/** Push a log message, trimming to the newest 5. */
export function pushLog(state: GameState, text: string): void {
  const last = state.log[state.log.length - 1];
  if (last && last.text === text && last.t < 400) return;
  state.log.push({ text, t: 0 });
  if (state.log.length > 5) state.log.splice(0, state.log.length - 5);
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

/** An un-picked-up key on `p`. */
export function keyAt(level: LevelData, p: Vec): KeyItem | null {
  for (const k of level.keys) if (!k.taken && k.pos.x === p.x && k.pos.y === p.y) return k;
  return null;
}

/** An unopened chest on `p`. */
/** Any chest on this tile, opened or not. Chests are solid: nobody walks on them. */
export function chestAt(level: LevelData, p: Vec): Chest | null {
  for (const c of level.chests) if (c.pos.x === p.x && c.pos.y === p.y) return c;
  return null;
}

/** Can the hero stand on this tile right now? Keys are fine to stand on; chests are not. */
export function heroCanStand(level: LevelData, p: Vec): boolean {
  if (!isFloor(level, p)) return false;
  if (closedDoorAt(level, p)) return false;
  if (liveMonsterAt(level, p)) return false;
  if (chestAt(level, p)) return false;
  return true;
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
    .filter((o) => o.alive && !o.invulnerable && o !== m && manhattan(o.pos, m.pos) <= CHAIN_RADIUS)
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

/** The hero's attack right now: base plus the berserker axe while wounded. */
export function heroAttackValue(state: GameState): number {
  const hero = state.hero;
  const stats = heroStats(hero);
  return hero.atk + (berserkActive(hero, stats) ? stats.berserkAtk : 0);
}

/** Hero attacks monster. Applies damage, pushes fx/log, handles death. */
export function heroAttack(state: GameState, m: Monster, rng: Rng): void {
  if (!m.alive) return;
  const dmg = damage(heroAttackValue(state), m.def, rng);
  damageMonster(state, m, dmg, rng, { source: 'hero' });
}

/**
 * Monster attacks hero: damage, lunge, knockback one tile, and a "knock down"
 * (never a death) when hp would reach 0.
 */
export function monsterAttack(state: GameState, m: Monster, rng: Rng): void {
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
    return;
  }

  // A minotaur's horns and an angel's touch always take the same bite out of
  // the hero, whatever their armour: a third of their hearts.
  const bossHit = m.kind === 'minotaur' || m.kind === 'angel';
  const dmg = bossHit
    ? Math.max(1, Math.ceil(hero.maxHp * BOSS_HIT_FRACTION))
    : damage(m.atk, hero.def, rng);
  hero.hp -= dmg;
  hero.hitFlash = 150;

  pushText(state, hero.pos, `-${dmg}`, RED);
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
    if (heroCanStand(level, back)) {
      hero.pos = back;
      state.path.length = 0;
      state.trail.add(key(back));
    }
  }

  // Thorn mail bites back.
  if (stats.thornDmg > 0 && m.alive) {
    damageMonster(state, m, stats.thornDmg, rng, { source: 'thorn', color: GREY });
  }

  if (hero.hp <= 0) knockDown(state, m);
}

/** How hard the screen jolts when a boss connects. */
const BOSS_SHAKE = 14;

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
  state.modal = { kind: 'gameOver', cause, boss, stats };
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
function knockDown(state: GameState, attacker: Monster | null = null): void {
  const hero = state.hero;
  const stats = heroStats(hero);

  // Phoenix feather: burst back up instead of sleeping (once per cooldown).
  if (stats.phoenixCooldownMs > 0 && hero.timers.phoenix <= 0) {
    const half = Math.ceil(hero.maxHp / 2);
    hero.hp = Math.min(hero.maxHp, Math.ceil(half / HEART) * HEART);
    hero.timers.phoenix = stats.phoenixCooldownMs;
    hero.stun = 0;
    hero.sleeping = false;
    state.path.length = 0;
    state.fx.push({
      kind: 'ring',
      pos: { x: hero.pos.x, y: hero.pos.y },
      radius: 1.5,
      color: ORANGE,
      t: 0,
      ttl: 500,
    });
    pushShake(state, 10, 420);
    pushSfx(state, 'phoenix');
    const spot = retreatTile(state);
    if (spot) hero.pos = spot;
    state.trail.add(key(hero.pos));
    pushLog(state, 'The feather burns!');
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
    const hurt = m.hp < m.maxHp || m.poisonMs > 0 || m.slowMs > 0;
    m.hp = m.maxHp;
    m.poisonMs = 0;
    m.poisonDmg = 0;
    m.slowMs = 0;
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
  if (!heroCanStand(state.level, p)) return false;
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
  return heroCanStand(level, level.start) ? { x: level.start.x, y: level.start.y } : null;
}
