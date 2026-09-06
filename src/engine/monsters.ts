/**
 * Monster AI: guards sit still, patrols walk a fixed route, lurkers chase the
 * hero within a leash of their home tile. All movement is one tile at a time
 * on the tile grid, gated by `moveCooldown`.
 */
import type { GameState, LevelData, Monster, Rng, Vec } from './types';
import { eq, key, manhattan } from './types';
import { bfsDistances, bfsPath } from './pathfind';
import { GREEN, chestAt, closedDoorAt, damageMonster, exitAt, keyAt, liveMonsterAt, monsterAttack } from './combat';
import type { ItemStats } from './items';
import { heroStats } from './items';
import { lurkerSightRange } from './balance';
import { hiddenAt, sameSide } from './lens';
import { altarAt, closedSealAt, pickupAt } from './puzzles';
import { timeBubble } from './shrines';

/** Render position catch-up speed, tiles per second. */
const RPOS_SPEED = 14;
/** One poison tick per second. */
const POISON_TICK_MS = 1000;

/** Advance every monster by `dt` ms. */
export function updateMonsters(state: GameState, dt: number, rng: Rng): void {
  const level = state.level;
  const stats = heroStats(state.hero);
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
    tickPoison(state, m, dt, rng);
    if (m.slowMs > 0) m.slowMs = Math.max(0, m.slowMs - dt);
    if (m.frozenMs > 0) m.frozenMs = Math.max(0, m.frozenMs - dt);
    if (m.giveUpMs && m.giveUpMs > 0) m.giveUpMs = Math.max(0, m.giveUpMs - dt);
    if (!m.alive) continue; // poison finished it off

    if (state.descending > 0) continue;
    // Frozen solid (a frost shrine's ice ball): no step, no swing, nothing.
    // Poison and the thaw clock above still run, so it can be finished off.
    if (m.frozenMs > 0) continue;

    // Angels do not run on dt here: they lay siege on their own slow clock
    // (angels.ts, driven by game.ts).
    if (m.kind === 'angel') continue;

    const heroPos = state.hero.pos;

    // Attack takes priority over movement. A sleeping hero is left alone.
    if (!state.hero.sleeping && manhattan(m.pos, heroPos) === 1) {
      if (m.attackCooldown <= 0 && willFight(state, m)) {
        const knocked = monsterAttack(state, m, rng);
        m.attackCooldown = cooldownFor(state, m, stats, m.attackInterval);
        // The hit just resolved a knockdown (potion, phoenix, sleep, or game
        // over): no other monster gets a free follow-up hit on the same tick.
        if (knocked) break;
      }
      continue;
    }

    if (m.moveCooldown > 0) continue;

    const step = chooseStep(state, m, stats);
    if (step) {
      m.pos = { x: step.x, y: step.y };
      m.moveCooldown = cooldownFor(state, m, stats, m.moveInterval);
    } else {
      // Blocked / waiting: re-check next cycle rather than every frame.
      m.moveCooldown = cooldownFor(state, m, stats, m.moveInterval);
    }
  }
}

/**
 * How long this monster must wait after acting. The frost blade doubles it;
 * the bane totem and a time-bubble shrine stretch it further while the hero is
 * close.
 */
function cooldownFor(state: GameState, m: Monster, stats: ItemStats, base: number): number {
  let ms = base;
  if (m.slowMs > 0) ms *= 2;
  if (stats.baneRadius > 0 && manhattan(m.pos, state.hero.pos) <= stats.baneRadius) {
    ms *= stats.baneSlowMult;
  }
  const bubble = timeBubble(state.hero);
  if (bubble && manhattan(m.pos, state.hero.pos) <= bubble.radius) ms *= bubble.mult;
  return ms;
}

/**
 * Guards are furniture until you poke them: they only swing at an adjacent
 * hero while the fight they were dragged into is still fresh. Patrols and
 * lurkers always attack whoever stands next to them.
 *
 * In a boss chamber: crystals and the necromancer never lift a finger.
 * Angels never reach this: they act from `angelsAct` (angels.ts) instead.
 */
function willFight(state: GameState, m: Monster): boolean {
  // A mouth tile is inside the passage and next to the maze at the same time,
  // so a monster standing on one really is adjacent to a hero out in the
  // corridor. It is still behind a wall: neither of them can touch the other.
  if (!sameSide(state.level, m.pos, state.hero.pos)) return false;
  switch (m.kind) {
    case 'guard':
      return m.sinceCombat < GUARD_ENGAGE_MS;
    case 'crystal':
    case 'boss':
    case 'angel':
      return false;
    default:
      return true;
  }
}

/** How long a struck guard keeps fighting back. */
const GUARD_ENGAGE_MS = 5000;

/**
 * How far this monster can see: its own range, cut back for a lurker that
 * out-levels the hero (see `lurkerSightRange`), then the bane totem's
 * blinding subtracted on top.
 */
function sightOf(state: GameState, m: Monster, stats: ItemStats): number {
  const base =
    m.kind === 'lurker'
      ? lurkerSightRange(m.sightRange, m.level, state.hero.level)
      : m.sightRange;
  if (stats.baneSightPenalty <= 0) return base;
  return Math.max(1, base - stats.baneSightPenalty);
}

/** Poison dagger: one hit per second of the remaining poison. */
function tickPoison(state: GameState, m: Monster, dt: number, rng: Rng): void {
  if (m.poisonMs <= 0) {
    m.poisonMs = 0;
    m.poisonDmg = 0;
    return;
  }
  const before = m.poisonMs;
  const after = Math.max(0, before - dt);
  const ticks = Math.ceil(before / POISON_TICK_MS) - Math.ceil(after / POISON_TICK_MS);
  m.poisonMs = after;
  const dmg = m.poisonDmg;
  if (after === 0) m.poisonDmg = 0;
  if (ticks > 0 && dmg > 0) {
    damageMonster(state, m, dmg * ticks, rng, { source: 'poison', color: GREEN });
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

/**
 * The wall between the maze and its hidden passages, from a monster's side.
 *
 * A monster stays in the world it was spawned into: the ones stocking a
 * passage pace it and never come out, and nothing in the maze proper walks
 * into one. That is what keeps a passage a place rather than a corridor the
 * floor's own traffic uses — and it means a lurker can never follow the hero
 * into the wall, or come out of it.
 */
function crossesPassageWall(level: LevelData, m: Monster, p: Vec): boolean {
  if (!level.passages?.length) return false;
  return hiddenAt(level, p) !== hiddenAt(level, m.home);
}

/** Tiles a monster refuses to step on (walls handled by the BFS itself). */
function moveBlocked(state: GameState, m: Monster): (p: Vec) => boolean {
  const level = state.level;
  return (p: Vec): boolean => {
    if (crossesPassageWall(level, m, p)) return true;
    if (closedDoorAt(level, p)) return true;
    if (closedSealAt(level, p)) return true;
    if (occupiedByOther(level, m, p)) return true;
    if (eq(p, state.hero.pos)) return true;
    if (keyAt(level, p)) return true;
    if (chestAt(level, p)) return true;
    if (altarAt(level, p)) return true;
    if (pickupAt(level, p)) return true;
    if (exitAt(level, p)) return true;
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

/**
 * Line-of-sight blocking: closed doors and seals, other monsters, and the
 * brick between the maze and a hidden passage — a lurker cannot see the hero through a wall
 * it does not know is hollow, and one stationed inside cannot see out.
 */
function sightBlocked(state: GameState, m: Monster): (p: Vec) => boolean {
  const level = state.level;
  return (p: Vec): boolean => {
    if (crossesPassageWall(level, m, p)) return true;
    if (closedDoorAt(level, p)) return true;
    if (closedSealAt(level, p)) return true;
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

function chooseStep(state: GameState, m: Monster, stats: ItemStats): Vec | null {
  switch (m.kind) {
    case 'guard':
      return null;
    case 'patrol':
      return patrolStep(state, m, stats);
    case 'lurker':
    case 'mimic': // sprung, it hunts like a lurker leashed to its chest
      return lurkerStep(state, m, stats);
    case 'minion':
    case 'minotaur':
      return hunterStep(state, m);
    case 'angel': // sieges on its own clock, see angels.ts
    case 'crystal':
    case 'boss':
      return null;
    default:
      return null;
  }
}

/**
 * Longest route a boss-chamber hunter will work out. Effectively "no limit":
 * they know where the hero is anywhere on the floor and never give up. Capped
 * only so a pathological level cannot make the BFS run away with itself.
 */
const HUNT_MAX_LEN = 4096;

/**
 * Minions and the minotaur: straight at the hero, forever, at their own pace.
 * No sight range, no leash, no idling — the only thing that stops them is a
 * blocked corridor, and then they try again next cycle.
 */
function hunterStep(state: GameState, m: Monster): Vec | null {
  m.state = 'chasing';
  return stepToward(state, m, state.hero.pos, HUNT_MAX_LEN);
}

/**
 * Patrols never chase: they walk their beat and hit whatever is next to them
 * when they get there. They are solid, so the hero fights through or waits.
 */
function patrolStep(state: GameState, m: Monster, stats: ItemStats): Vec | null {
  const path = m.patrolPath;
  if (!path || path.length === 0) return null;

  const sight = sightOf(state, m, stats);

  // Off the route (shoved aside, say): find the way back onto it.
  const idx = path.findIndex((p) => eq(p, m.pos));
  if (idx < 0) {
    m.state = 'returning';
    let best: Vec | null = null;
    let bestLen = Infinity;
    for (const t of path) {
      const route = bfsPath(state.level, m.pos, t, {
        blocked: moveBlockedTo(state, m, t),
        maxLen: bestLen === Infinity ? sight + path.length + 8 : bestLen,
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

/** How long a `returning` lurker holds its give-up spot before it actually
 *  starts walking back to `chaseFrom` — a last window to bait it again. */
const LURKER_RETURN_DELAY_MS = 3000;

function lurkerStep(state: GameState, m: Monster, stats: ItemStats): Vec | null {
  const sight = sightOf(state, m, stats);
  if (m.state === 'idle') {
    const d = distToHero(state, m, m.pos, sight);
    if (d !== null) {
      m.state = 'chasing';
      m.chaseFrom = { x: m.pos.x, y: m.pos.y };
    }
  } else if (m.state === 'returning') {
    // Slightly tighter re-aggro so baiting still works, but not trivially.
    const d = distToHero(state, m, m.pos, Math.max(0, sight - 1));
    if (d !== null) m.state = 'chasing'; // chaseFrom is untouched: same chase
  }

  if (m.state === 'chasing') {
    // Lose the hero (a little hysteresis so it does not flicker), or run out
    // of leash, and the lurker gives up and holds its ground for a while.
    const toHero = distToHero(state, m, m.pos, sight + 1);
    const fromHome = toHero === null ? null : distToHero(state, m, m.home, m.leash);
    if (fromHome === null) {
      m.state = 'returning';
      m.giveUpMs = LURKER_RETURN_DELAY_MS;
    } else {
      const step = stepToward(state, m, state.hero.pos, m.leash * 2 + 4);
      if (step) return step;
      const reachable = distToHero(state, m, m.pos, m.leash * 2 + 4);
      if (reachable === null) {
        m.state = 'returning';
        m.giveUpMs = LURKER_RETURN_DELAY_MS;
      }
      return null;
    }
  }

  if (m.state === 'returning') {
    const origin = m.chaseFrom;
    if (!origin || eq(m.pos, origin)) {
      // Home (or wherever the chase started) already: settle down, ready for
      // a fresh chase (and a fresh chaseFrom) next time.
      m.state = 'idle';
      m.chaseFrom = undefined;
      m.giveUpMs = 0;
      return null;
    }
    if ((m.giveUpMs ?? 0) > 0) return null; // still in the bait window
    return stepToward(state, m, origin, m.leash * 2 + 4);
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
