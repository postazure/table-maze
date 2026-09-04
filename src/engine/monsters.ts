/**
 * Monster AI: guards sit still, patrols walk a fixed route, lurkers chase the
 * hero within a leash of their home tile. All movement is one tile at a time
 * on the tile grid, gated by `moveCooldown`.
 */
import type { GameState, LevelData, Monster, Rng, Vec } from './types';
import { eq, key, manhattan } from './types';
import { bfsDistances, bfsPath } from './pathfind';
import { chestAt, closedDoorAt, keyAt, liveMonsterAt, monsterAttack } from './combat';

/** Render position catch-up speed, tiles per second. */
const RPOS_SPEED = 14;

/** Advance every monster by `dt` ms. */
export function updateMonsters(state: GameState, dt: number, rng: Rng): void {
  const level = state.level;
  for (const m of level.monsters) {
    if (!m.alive) continue;

    if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
    if (m.lungeT > 0) {
      m.lungeT = Math.max(0, m.lungeT - dt);
      if (m.lungeT === 0) m.lunge = undefined;
    }
    if (m.attackCooldown > 0) m.attackCooldown = Math.max(0, m.attackCooldown - dt);
    if (m.moveCooldown > 0) m.moveCooldown = Math.max(0, m.moveCooldown - dt);
    lerpRpos(m, dt);
    regen(m, dt);

    if (state.descending > 0) continue;

    const heroPos = state.hero.pos;

    // Attack takes priority over movement. A sleeping hero is left alone.
    if (!state.hero.sleeping && manhattan(m.pos, heroPos) === 1) {
      if (m.attackCooldown <= 0) {
        monsterAttack(state, m, rng);
        m.attackCooldown = m.attackInterval;
      }
      continue;
    }

    if (m.moveCooldown > 0) continue;

    const step = chooseStep(state, m);
    if (step) {
      m.pos = { x: step.x, y: step.y };
      m.moveCooldown = m.moveInterval;
    } else {
      // Blocked / waiting: re-check next cycle rather than every frame.
      m.moveCooldown = m.moveInterval;
    }
  }
}

function lerpRpos(m: Monster, dt: number): void {
  const step = (RPOS_SPEED * dt) / 1000;
  const dx = m.pos.x - m.rpos.x;
  const dy = m.pos.y - m.rpos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= step || dist < 0.001) {
    m.rpos = { x: m.pos.x, y: m.pos.y };
  } else {
    m.rpos = { x: m.rpos.x + (dx / dist) * step, y: m.rpos.y + (dy / dist) * step };
  }
}

// ---------------------------------------------------------------------------
// Blocking predicates
// ---------------------------------------------------------------------------

/** Tiles a monster refuses to step on (walls handled by the BFS itself). */
function moveBlocked(state: GameState, m: Monster): (p: Vec) => boolean {
  const level = state.level;
  return (p: Vec): boolean => {
    if (closedDoorAt(level, p)) return true;
    if (occupiedByOther(level, m, p)) return true;
    if (eq(p, state.hero.pos)) return true;
    if (keyAt(level, p)) return true;
    if (chestAt(level, p)) return true;
    if (eq(p, level.exit)) return true;
    return false;
  };
}

/**
 * Same as `moveBlocked` but never blocks `target`, so BFS can reach a hero who
 * happens to stand on a chest / the exit.
 */
function moveBlockedTo(state: GameState, m: Monster, target: Vec): (p: Vec) => boolean {
  const base = moveBlocked(state, m);
  return (p: Vec): boolean => (eq(p, target) ? false : base(p));
}

/** Line-of-sight blocking: closed doors and other monsters only. */
function sightBlocked(state: GameState, m: Monster): (p: Vec) => boolean {
  const level = state.level;
  return (p: Vec): boolean => {
    if (closedDoorAt(level, p)) return true;
    if (occupiedByOther(level, m, p)) return true;
    return false;
  };
}

function occupiedByOther(level: LevelData, m: Monster, p: Vec): boolean {
  const o = liveMonsterAt(level, p);
  return o !== null && o !== m;
}

/** BFS distance from `from` to the hero, or null if further than `maxDist`. */
function distToHero(state: GameState, m: Monster, from: Vec, maxDist: number): number | null {
  if (maxDist < 0) return null;
  if (state.hero.sleeping) return null; // monsters lose interest in a sleeping hero
  const heroPos = state.hero.pos;
  if (manhattan(from, heroPos) > maxDist) return null;
  const dists = bfsDistances(state.level, from, { blocked: sightBlocked(state, m), maxDist });
  const d = dists.get(key(heroPos));
  return d === undefined ? null : d;
}

/** First tile of a BFS route from the monster to `to`, or null. */
function stepToward(state: GameState, m: Monster, to: Vec, maxLen: number): Vec | null {
  if (eq(m.pos, to)) return null;
  const route = bfsPath(state.level, m.pos, to, {
    blocked: moveBlockedTo(state, m, to),
    maxLen,
  });
  if (!route || route.length === 0) return null;
  const next = route[0];
  // Never step onto the target itself if it is something we must not occupy.
  if (moveBlocked(state, m)(next)) return null;
  return next;
}

// ---------------------------------------------------------------------------
// Per-kind behaviour
// ---------------------------------------------------------------------------

function chooseStep(state: GameState, m: Monster): Vec | null {
  switch (m.kind) {
    case 'guard':
      return null;
    case 'patrol':
      return patrolStep(state, m);
    case 'lurker':
      return lurkerStep(state, m);
    default:
      return null;
  }
}

function patrolStep(state: GameState, m: Monster): Vec | null {
  const path = m.patrolPath;
  if (!path || path.length === 0) return null;

  const seen = distToHero(state, m, m.pos, m.sightRange);
  const heroOnRoute = seen !== null && path.some((p) => eq(p, state.hero.pos));

  if (heroOnRoute) {
    m.state = 'chasing';
    return stepToward(state, m, state.hero.pos, m.sightRange + 4);
  }

  // Not chasing (any more): get back on the route, then walk it.
  const idx = path.findIndex((p) => eq(p, m.pos));
  if (idx < 0) {
    m.state = 'returning';
    let best: Vec | null = null;
    let bestLen = Infinity;
    for (const t of path) {
      const route = bfsPath(state.level, m.pos, t, {
        blocked: moveBlockedTo(state, m, t),
        maxLen: bestLen === Infinity ? m.sightRange + path.length + 8 : bestLen,
      });
      if (route && route.length > 0 && route.length < bestLen) {
        bestLen = route.length;
        best = route[0];
      }
    }
    if (best && !moveBlocked(state, m)(best)) return best;
    return null;
  }

  m.state = 'idle';
  m.patrolIndex = idx;
  let dir: 1 | -1 = m.patrolDir === -1 ? -1 : 1;
  let next = idx + dir;
  if (next < 0 || next >= path.length) {
    dir = dir === 1 ? -1 : 1;
    next = idx + dir;
  }
  m.patrolDir = dir;
  if (next < 0 || next >= path.length) return null; // single-tile route
  const target = path[next];
  if (manhattan(target, m.pos) !== 1) return null; // malformed route: stay put
  if (moveBlocked(state, m)(target)) return null; // wait for the way to clear
  m.patrolIndex = next;
  return target;
}

function lurkerStep(state: GameState, m: Monster): Vec | null {
  if (m.state === 'idle') {
    const d = distToHero(state, m, m.pos, m.sightRange);
    if (d !== null) m.state = 'chasing';
  } else if (m.state === 'returning') {
    // Slightly tighter re-aggro so baiting still works, but not trivially.
    const d = distToHero(state, m, m.pos, Math.max(0, m.sightRange - 1));
    if (d !== null) m.state = 'chasing';
  }

  if (m.state === 'chasing') {
    const fromHome = distToHero(state, m, m.home, m.leash);
    if (fromHome === null) {
      m.state = 'returning';
    } else {
      const step = stepToward(state, m, state.hero.pos, m.leash * 2 + 4);
      if (step) return step;
      const reachable = distToHero(state, m, m.pos, m.leash * 2 + 4);
      if (reachable === null) m.state = 'returning';
      return null;
    }
  }

  if (m.state === 'returning') {
    if (eq(m.pos, m.home)) {
      m.state = 'idle';
      return null;
    }
    return stepToward(state, m, m.home, m.leash * 3 + 8);
  }

  return null;
}

const MONSTER_REGEN_DELAY = 4000;
const MONSTER_REGEN_MS = 1500;

/** Monsters slowly heal once they have been out of combat for a while. */
function regen(m: Monster, dt: number): void {
  const before = m.sinceCombat;
  m.sinceCombat = Math.min(1e9, before + dt);
  if (m.hp >= m.maxHp || m.sinceCombat < MONSTER_REGEN_DELAY) return;
  const ticksBefore = Math.floor(Math.max(0, before - MONSTER_REGEN_DELAY) / MONSTER_REGEN_MS);
  const ticksAfter = Math.floor((m.sinceCombat - MONSTER_REGEN_DELAY) / MONSTER_REGEN_MS);
  if (ticksAfter > ticksBefore) m.hp = Math.min(m.maxHp, m.hp + (ticksAfter - ticksBefore));
}
