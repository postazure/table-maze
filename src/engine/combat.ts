/**
 * Combat resolution: hero <-> monster.
 *
 * Also hosts a handful of tiny shared helpers (fx/log pushing, entity lookup)
 * used by `monsters.ts` and `game.ts`. Import direction is strictly
 * game.ts -> monsters.ts -> combat.ts, so there are no cycles.
 */
import type {
  Chest,
  Door,
  Effect,
  GameState,
  KeyItem,
  LevelData,
  Monster,
  Rng,
  Vec,
} from './types';
import { eq, key, manhattan, parseKey } from './types';
import { damage } from './balance';
import { bfsDistances, floorNeighbors, isFloor } from './pathfind';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export const WHITE = '#f4f1e8';
export const RED = '#ff5c5c';
export const GOLD = '#ffd166';
export const GREEN = '#8fd694';

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

/** Hero attacks monster. Applies damage, pushes fx/log, handles death. */
export function heroAttack(state: GameState, m: Monster, rng: Rng): void {
  if (!m.alive) return;
  const hero = state.hero;
  const dmg = damage(hero.atk, m.def, rng);
  m.hp -= dmg;
  m.hitFlash = 150;
  m.sinceCombat = 0;
  hero.sinceCombat = 0;
  pushText(state, m.pos, `-${dmg}`, WHITE);
  if (m.hp <= 0) {
    m.hp = 0;
    m.alive = false;
    hero.xp += m.xp;
    hero.gold += m.gold;
    state.stats.kills += 1;
    pushText(state, m.pos, `+${m.xp} xp`, GOLD, 1100);
    pushLog(state, `Slew the ${m.name}`);
  }
}

/**
 * Monster attacks hero: damage, lunge, knockback one tile, and a "knock down"
 * (never a death) when hp would reach 0.
 */
export function monsterAttack(state: GameState, m: Monster, rng: Rng): void {
  const hero = state.hero;
  const level = state.level;
  const dmg = damage(m.atk, hero.def, rng);
  hero.hp -= dmg;
  hero.hitFlash = 150;
  hero.sinceCombat = 0;
  m.sinceCombat = 0;

  const away = unitToward(m.pos, hero.pos);
  m.lunge = { x: away.x, y: away.y };
  m.lungeT = 120;

  pushText(state, hero.pos, `-${dmg}`, RED);
  pushShake(state, 4, 180);

  // Knockback: shove the hero one tile directly away from the monster.
  if (away.x !== 0 || away.y !== 0) {
    const back = { x: hero.pos.x + away.x, y: hero.pos.y + away.y };
    if (heroCanStand(level, back)) {
      hero.pos = back;
      state.path.length = 0;
      state.trail.add(key(back));
    }
  }

  if (hero.hp <= 0) knockDown(state);
}

/**
 * Heroes never die. At 0 hp they are carried back to a nearby tile they walked
 * over recently and fall asleep there; the game hands control back once they
 * have slept themselves back to full health.
 */
function knockDown(state: GameState): void {
  const hero = state.hero;
  hero.hp = 1;
  hero.stun = 0;
  hero.sleeping = true;
  state.path.length = 0;
  const dest = retreatTile(state);
  if (dest) hero.pos = dest;
  state.trail.add(key(hero.pos));
  pushShake(state, 12, 450);
  pushLog(state, 'Knocked down!');
}

/** How far a monster must be for a tile to count as a safe resting spot. */
const SAFE_MONSTER_DIST = 3;
/** Don't carry the hero further than this (BFS tiles) from where they fell. */
const RETREAT_MAX_DIST = 10;

function isSafeSpot(state: GameState, p: Vec): boolean {
  if (!heroCanStand(state.level, p)) return false;
  for (const m of state.level.monsters) {
    if (m.alive && manhattan(m.pos, p) < SAFE_MONSTER_DIST) return false;
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
