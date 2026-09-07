/**
 * The crafting chain: brass, the jeweller's bench, the carving shrine and the
 * portal to the boss worlds. Pure helpers and lookups shared by maze.ts,
 * wings.ts, shop.ts, game.ts, combat.ts, the renderer and the UI — the same
 * shape puzzles.ts gives the wings' locks.
 *
 * Depends only on `types.ts`, `rng.ts` and `lens.ts`, so anything may import
 * it.
 */
import type { BossKind, Hero, LevelData, Vec } from './types';
import { hashSeed, makeRng } from './rng';
import { floorOfSet, floorSet, lensActive } from './lens';

// ---------------------------------------------------------------------------
// Brass
// ---------------------------------------------------------------------------

/** The only name this trinket ever goes by. */
export const BRASS_NAME = 'Brass Lump';
/** The only thing ever said about it — a chest popup, the help screen, nowhere else. */
export const BRASS_DESCRIPTION = 'Crafting material.';

/** Salt so the brass roll never shares a stream with the lens or the relic rolls. */
const BRASS_SALT = 8123;

/**
 * Which floor of the set — second or third — gets the lump this run. Rolled
 * once per set (not per floor), so a set never offers it twice.
 */
function brassPickFloor(runSeed: number, set: number): 2 | 3 {
  const rng = makeRng(hashSeed(runSeed, set, BRASS_SALT));
  return rng.chance(0.5) ? 2 : 3;
}

/**
 * Does this floor's ordinary chests carry a brass lump? One per themed set,
 * on its second or third floor, and never on the run's first floor (floor
 * one of set zero is always its first floor, so this is mostly belt and
 * braces for the rule above).
 */
export function brassFloor(runSeed: number, depth: number): boolean {
  const d = Math.max(1, Math.floor(depth));
  if (d === 1) return false;
  const fos = floorOfSet(d);
  if (fos === 1) return false;
  return fos === brassPickFloor(runSeed, floorSet(d));
}

// ---------------------------------------------------------------------------
// The carving shrine
// ---------------------------------------------------------------------------

/** Salt for the carving shrine roll. */
const CARVER_SALT = 8124;
/** From this depth a maze floor may carry a carving shrine. */
const CARVER_FROM_DEPTH = 4;
/** Roughly one floor in two, from `CARVER_FROM_DEPTH` on. */
const CARVER_CHANCE = 0.5;

/** Does this maze floor carry a carving shrine? */
export function carverFloor(runSeed: number, depth: number): boolean {
  const d = Math.max(1, Math.floor(depth));
  if (d < CARVER_FROM_DEPTH) return false;
  const rng = makeRng(hashSeed(runSeed, d, CARVER_SALT));
  return rng.chance(CARVER_CHANCE);
}

// ---------------------------------------------------------------------------
// Crystals
// ---------------------------------------------------------------------------

const CRYSTAL_NAMES: Record<BossKind, string> = {
  necromancer: 'Necromancer Crystal',
  minotaur: 'Minotaur Crystal',
  angels: 'Angel Crystal',
};

/** A carved crystal, unique to the boss it was cut for. */
export function crystalName(boss: BossKind): string {
  return CRYSTAL_NAMES[boss];
}

// ---------------------------------------------------------------------------
// Crafting the lens whole
// ---------------------------------------------------------------------------

/**
 * Can the hero fill the housing right now, at the jeweller's bench? An
 * active lens on this depth, not already unbreakable, and at least one
 * brass lump to spend. `reason` is what the bench popup shows when it
 * cannot — greyed out, but told why.
 */
export function canCraft(hero: Hero, depth: number): { ok: boolean; reason: string } {
  if (!hero.lens || !lensActive(hero, depth)) {
    return { ok: false, reason: 'No lens to work on down here.' };
  }
  if (hero.lens.unbreakable) {
    return { ok: false, reason: 'The lens is already whole.' };
  }
  if ((hero.brass ?? 0) < 1) {
    return { ok: false, reason: 'No brass to fill the housing.' };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Lookups. Same shape as chestAt (combat.ts) / altarAt (puzzles.ts).
// ---------------------------------------------------------------------------

/** The jeweller's bench on `p`, if any. Solid, like a podium. */
export function benchAt(level: LevelData, p: Vec): { pos: Vec } | null {
  const b = level.bench;
  return b && b.pos.x === p.x && b.pos.y === p.y ? b : null;
}

/** The carving shrine on `p`, if any — spent or not. Walkable, like a shrine. */
export function carverAt(level: LevelData, p: Vec): { pos: Vec; used: boolean } | null {
  const c = level.carver;
  return c && c.pos.x === p.x && c.pos.y === p.y ? c : null;
}

/** The portal on `p`, if any. Solid, like an altar. */
export function portalAt(level: LevelData, p: Vec): { pos: Vec } | null {
  const pt = level.portal;
  return pt && pt.pos.x === p.x && pt.pos.y === p.y ? pt : null;
}
