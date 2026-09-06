/**
 * The weeping angels: a siege, not a chase.
 *
 * An angel never races the hero. It walks on its own slow clock
 * (`ANGEL_STEP_MS`, game.ts drives it) and it does not need to see the hero
 * or retrace the hero's steps — it knows where they are and heads straight
 * there through the whole floor, so a shorter way round through another room
 * is fair game. What it is really doing is taking a door: while the hero can
 * still walk out of the room they are in, angels sit in the mouths of the
 * corridors and stay out of arm's reach (`ANGEL_REACH`), and any angel with
 * no door left to hold creeps up to `ANGEL_RING` tiles and waits there.
 *
 * The moment the hero cannot walk out of the space they are in — every way
 * out of that room (or that stretch of corridor) held by stone — every angel
 * switches to `closing` and moves in to touch them. They stay committed until
 * the hero breaks `ANGEL_BREAK` tiles clear of all of them, and then the siege
 * starts over.
 *
 * Angels only wake when the hero walks into their room (game.ts).
 */
import type { GameState, LevelData, Monster, Rect, Rng, Vec } from './types';
import {
  ANGEL_BREAK,
  ANGEL_REACH,
  ANGEL_RING,
  ANGEL_TRAP_AREA,
  eq,
  inRect,
  key,
  manhattan,
} from './types';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from './pathfind';
import { closedDoorAt, liveMonsterAt, monsterAttack } from './combat';
import { roomAt } from './boss';

/** Longest route an angel will work out: effectively the whole floor. */
const MAX_ROUTE = 4096;

/** Is this an angel that has opened its eyes? */
function awake(m: Monster): boolean {
  return m.alive && m.kind === 'angel' && m.state !== 'idle';
}

/**
 * One act for every awake angel: a step, a wait, or — once the hero is boxed
 * in — a touch. game.ts calls this once every `ANGEL_STEP_MS`.
 */
export function angelsAct(state: GameState, rng: Rng): void {
  if (state.over) return;
  const angels = state.level.monsters.filter(awake);
  if (angels.length === 0) return;

  const closing = shouldClose(state, angels);
  for (const m of angels) m.state = closing ? 'closing' : 'chasing';
  if (closing) closeIn(state, angels, rng);
  else besiege(state, angels);
}

// ---------------------------------------------------------------------------
// Nerve: hold the doors, or move in?
// ---------------------------------------------------------------------------

/**
 * Angels commit when the hero is cornered and only let go once the hero is
 * well clear of every one of them — without that hysteresis the first step of
 * the kill would open the ring and send them straight back to the doors.
 */
function shouldClose(state: GameState, angels: readonly Monster[]): boolean {
  const committed = angels.some((m) => m.state === 'closing');
  return committed ? !brokeAway(state, angels) : boxedIn(state, angels);
}

/** Is the hero further than `ANGEL_BREAK` from every angel that closed in? */
function brokeAway(state: GameState, angels: readonly Monster[]): boolean {
  const near = bfsDistances(state.level, state.hero.pos, { maxDist: ANGEL_BREAK });
  return !angels.some((m) => near.has(key(m.pos)));
}

/**
 * Nowhere left to run: with angels counting as walls, the hero cannot get out
 * of the space they are standing in — the room they are in, or the run of
 * corridor between two rooms — and it is stone holding them there, not just
 * stonework. Every other way out only has to be one tile wide: this is the
 * whole point of taking the doors.
 */
function boxedIn(state: GameState, angels: readonly Monster[]): boolean {
  const level = state.level;
  const rooms = level.boss?.kind === 'angels' ? level.boss.rooms : [];
  const here = roomAt(rooms, state.hero.pos);
  const stone = (p: Vec): boolean => angels.some((m) => eq(m.pos, p));

  const seen = new Set<string>([key(state.hero.pos)]);
  let queue: Vec[] = [state.hero.pos];
  let held = false; // is any of this pocket's edge an angel, rather than a wall?
  let size = 0;
  while (queue.length > 0) {
    const next: Vec[] = [];
    for (const p of queue) {
      size += 1;
      if (size > ANGEL_TRAP_AREA) return false;
      for (const q of floorNeighbors(level, p)) {
        if (seen.has(key(q))) continue;
        if (stone(q)) {
          held = true;
          continue;
        }
        if (closedDoorAt(level, q)) continue;
        if (roomAt(rooms, q) !== here) return false; // out of this room, and away
        seen.add(key(q));
        next.push(q);
      }
    }
    queue = next;
  }
  return held;
}

// ---------------------------------------------------------------------------
// The two moods
// ---------------------------------------------------------------------------

/** The ring has shut: straight at the hero, and touch whatever is in reach. */
function closeIn(state: GameState, angels: readonly Monster[], rng: Rng): void {
  for (const m of angels) {
    if (state.over) return;
    if (m.frozenMs > 0) continue;
    if (manhattan(m.pos, state.hero.pos) <= ANGEL_REACH) {
      monsterAttack(state, m, rng);
      continue;
    }
    const step = routeStep(state, m, state.hero.pos, blockedFor(state, m));
    if (step) m.pos = step;
  }
}

/**
 * The patient half: each angel walks to the door it is closest to, and any
 * angel left over closes to `ANGEL_RING` and waits. Nobody touches anybody.
 */
function besiege(state: GameState, angels: readonly Monster[]): void {
  const doors = claimDoors(state, angels);
  for (const m of angels) {
    if (m.frozenMs > 0) continue;
    const door = doors.get(m.id);
    if (door && eq(m.pos, door)) continue; // holding it
    const step = (door && doorStep(state, m, door)) ?? ringStep(state, m);
    if (step) m.pos = step;
  }
}

/**
 * Hand out the mouths of the hero's room, closest pair first, so no two
 * angels cross the floor for the same door. An angel already standing in one
 * is zero steps away and keeps it. A hero out in the corridors is in no room
 * to seal, so nobody is handed a door and they all fall back on `ringStep`.
 */
function claimDoors(state: GameState, angels: readonly Monster[]): Map<string, Vec> {
  const out = new Map<string, Vec>();
  const boss = state.level.boss;
  if (!boss || boss.kind !== 'angels') return out;
  const ri = roomAt(boss.rooms, state.hero.pos);
  if (ri < 0) return out;
  const doors = doorsOf(state.level, boss.rooms[ri]);
  if (doors.length === 0) return out;

  const walk = new Map<string, Map<string, number>>();
  for (const m of angels) {
    walk.set(m.id, bfsDistances(state.level, m.pos, { blocked: blockedFor(state, m) }));
  }

  const taken = new Set<string>();
  for (;;) {
    let bestAngel: Monster | null = null;
    let bestDoor: Vec | null = null;
    let bestDist = Infinity;
    for (const m of angels) {
      if (out.has(m.id)) continue;
      const dists = walk.get(m.id);
      if (!dists) continue;
      for (const d of doors) {
        if (taken.has(key(d))) continue;
        const steps = dists.get(key(d));
        if (steps === undefined || steps >= bestDist) continue;
        bestAngel = m;
        bestDoor = d;
        bestDist = steps;
      }
    }
    if (!bestAngel || !bestDoor) return out;
    out.set(bestAngel.id, bestDoor);
    taken.add(key(bestDoor));
  }
}

/**
 * The tiles a hero has to walk through to leave `room`: every floor tile just
 * outside it that touches it. Stone standing on all of them is a sealed room.
 */
export function doorsOf(level: LevelData, room: Rect): Vec[] {
  const out: Vec[] = [];
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      const p = { x, y };
      if (inRect(room, p) || !isFloor(level, p)) continue;
      if (floorNeighbors(level, p).some((q) => inRect(room, q))) out.push(p);
    }
  }
  return out;
}

/** One step toward a door, never through the hero's reach. */
function doorStep(state: GameState, m: Monster, door: Vec): Vec | null {
  if (withinReach(state, door)) return null; // the hero is standing in it
  const base = blockedFor(state, m);
  return routeStep(state, m, door, (p) => base(p) || withinReach(state, p));
}

/** Close to `ANGEL_RING` of the hero and hold there, out of arm's reach. */
function ringStep(state: GameState, m: Monster): Vec | null {
  const base = blockedFor(state, m);
  const route = bfsPath(state.level, m.pos, state.hero.pos, {
    blocked: (p) => (eq(p, state.hero.pos) ? false : base(p)),
    maxLen: MAX_ROUTE,
  });
  if (!route || route.length <= ANGEL_RING) return null; // near enough: wait
  const next = route[0];
  if (base(next) || withinReach(state, next)) return null;
  return next;
}

// ---------------------------------------------------------------------------
// Steps and blocking
// ---------------------------------------------------------------------------

function withinReach(state: GameState, p: Vec): boolean {
  return manhattan(p, state.hero.pos) <= ANGEL_REACH;
}

/** Tiles an angel will not stand on. Walls are the BFS's own business. */
function blockedFor(state: GameState, m: Monster): (p: Vec) => boolean {
  const level = state.level;
  return (p: Vec): boolean => {
    if (closedDoorAt(level, p)) return true;
    const other = liveMonsterAt(level, p);
    if (other !== null && other !== m) return true;
    if (eq(p, state.hero.pos)) return true;
    if (eq(p, level.exit)) return true; // stone never squats on the stairs
    return false;
  };
}

/** First tile of the route from `m` to `goal`, or null when there is none. */
function routeStep(
  state: GameState,
  m: Monster,
  goal: Vec,
  blocked: (p: Vec) => boolean,
): Vec | null {
  if (eq(m.pos, goal)) return null;
  const route = bfsPath(state.level, m.pos, goal, {
    blocked: (p) => (eq(p, goal) ? false : blocked(p)),
    maxLen: MAX_ROUTE,
  });
  if (!route || route.length === 0) return null;
  const next = route[0];
  return blocked(next) ? null : next;
}
