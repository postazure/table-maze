/**
 * The locks and keys of the hidden wings: seals, runes, orbs, relics and
 * altars. Names, lookups and the small pure rules that game.ts, monsters.ts,
 * maze.ts and the renderer all share.
 *
 * Depends only on `types.ts` and `rng.ts`, so anything may import it.
 */
import type { Altar, BossKind, LevelData, Orb, RelicKind, Relic, Rune, Seal, Vec } from './types';
import { RELIC_KINDS } from './types';
import { hashSeed, makeRng } from './rng';

// ---------------------------------------------------------------------------
// Relics
// ---------------------------------------------------------------------------

const RELIC_NAMES: Record<RelicKind, string> = {
  sun: 'Sun Stone',
  moon: 'Moon Stone',
  star: 'Star Stone',
};

export function relicName(kind: RelicKind): string {
  return RELIC_NAMES[kind];
}

/** Salt so the relic roll never shares a stream with anything else on the floor. */
const RELIC_SALT = 5151;
/** How often a floor's wing has a relic lying in it. */
const RELIC_CHANCE = 0.45;

/**
 * The relic floor `depth` of run `runSeed` puts in its wing, or null. A pure
 * function of the run, so a keystone seal on a later floor can ask for a
 * relic knowing the run really did lay it out somewhere behind the hero.
 */
export function relicOffered(runSeed: number, depth: number): RelicKind | null {
  const d = Math.max(1, Math.floor(depth));
  const rng = makeRng(hashSeed(runSeed, d, RELIC_SALT));
  if (!rng.chance(RELIC_CHANCE)) return null;
  return rng.pick(RELIC_KINDS);
}

/** Every relic kind some floor shallower than `depth` offered, in floor order. */
export function relicsBefore(runSeed: number, depth: number): RelicKind[] {
  const out: RelicKind[] = [];
  for (let d = 1; d < depth; d++) {
    const r = relicOffered(runSeed, d);
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runes
// ---------------------------------------------------------------------------

/** How many rune shapes the art table carries; `Rune.glyph` indexes it. */
export const RUNE_GLYPHS = 4;

// ---------------------------------------------------------------------------
// Altars
// ---------------------------------------------------------------------------

/** What is carved on an altar, in the words the log uses. */
const CARVINGS: Record<BossKind, string> = {
  necromancer: 'a skull',
  minotaur: 'a pair of horns',
  angels: 'a single tear',
};

export function altarCarving(trophy: BossKind): string {
  return CARVINGS[trophy];
}

// ---------------------------------------------------------------------------
// Lookups. Same shape as chestAt / keyAt in combat.ts.
// ---------------------------------------------------------------------------

export function sealAt(level: LevelData, p: Vec): Seal | null {
  for (const s of level.seals ?? []) if (s.pos.x === p.x && s.pos.y === p.y) return s;
  return null;
}

/** A seal on `p` that is still shut: solid to everyone. */
export function closedSealAt(level: LevelData, p: Vec): Seal | null {
  const s = sealAt(level, p);
  return s && !s.open ? s : null;
}

export function sealById(level: LevelData, id: string): Seal | null {
  for (const s of level.seals ?? []) if (s.id === id) return s;
  return null;
}

/** A rune on `p`, lit or not. Runes are floor: the hero walks over them. */
export function runeAt(level: LevelData, p: Vec): Rune | null {
  for (const r of level.runes ?? []) if (r.pos.x === p.x && r.pos.y === p.y) return r;
  return null;
}

/** An orb lying on `p` (not one carried or already set in its cradle). */
export function orbAt(level: LevelData, p: Vec): Orb | null {
  for (const o of level.orbs ?? []) if (o.state === 'floor' && o.pos.x === p.x && o.pos.y === p.y) return o;
  return null;
}

export function orbById(level: LevelData, id: string): Orb | null {
  for (const o of level.orbs ?? []) if (o.id === id) return o;
  return null;
}

/** The orb seal whose cradle is on `p`, still waiting for its orb. */
export function socketAt(level: LevelData, p: Vec): Seal | null {
  for (const s of level.seals ?? []) {
    if (s.lock.kind !== 'orb' || s.lock.placed) continue;
    if (s.lock.socket.x === p.x && s.lock.socket.y === p.y) return s;
  }
  return null;
}

/** A relic still lying on `p`. */
export function relicAt(level: LevelData, p: Vec): Relic | null {
  for (const r of level.relics ?? []) if (!r.taken && r.pos.x === p.x && r.pos.y === p.y) return r;
  return null;
}

/** Any altar on `p`, spent or not. Altars are solid: nobody stands on one. */
export function altarAt(level: LevelData, p: Vec): Altar | null {
  for (const a of level.altars ?? []) if (a.pos.x === p.x && a.pos.y === p.y) return a;
  return null;
}

/**
 * Is `p` something a monster must walk around rather than over: an orb lying
 * on the floor or a relic? (Chests, altars and seals are asked separately,
 * since they block the hero too.)
 */
export function pickupAt(level: LevelData, p: Vec): boolean {
  return orbAt(level, p) !== null || relicAt(level, p) !== null;
}
