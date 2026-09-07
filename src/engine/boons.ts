/**
 * Boons: what a boss trophy buys at an altar.
 *
 * A trophy is one run's proof of a boss beaten. Drop it on the altar carved
 * for it and it becomes a boon: something the hero gets now, and something
 * the next `BOON_RUNS - 1` runs start with, until it breaks. That is the one
 * piece of the game that crosses from one run into the next, so it is kept
 * out of the save proper (see `loadBoons` / `saveBoons` in save.ts) and only
 * ever read when a run begins.
 *
 * Every boon is applied to a hero by `applyBoon`, whether at an altar mid-run
 * or at the start of a fresh one; the numbers are deliberately those of an
 * early floor, so a boon is a good start rather than a levelled item.
 */
import type { Boon, BoonKind, BossKind, Hero } from './types';
import { HEART } from './types';

/** How many runs a fresh boon lasts, the one it is earned in included. */
export const BOON_RUNS = 3;

const TROPHY_NAMES: Record<BossKind, string> = {
  necromancer: "Necromancer's Skull",
  minotaur: "Minotaur's Horn",
  angels: "Angel's Tear",
};

export function trophyName(boss: BossKind): string {
  return TROPHY_NAMES[boss];
}

/** Each boss's trophy buys one particular boon. */
const BOON_FOR_TROPHY: Record<BossKind, BoonKind> = {
  necromancer: 'deathless',
  minotaur: 'vigor',
  angels: 'grace',
};

export function boonForTrophy(boss: BossKind): BoonKind {
  return BOON_FOR_TROPHY[boss];
}

const BOON_NAMES: Record<BoonKind, string> = {
  deathless: 'Deathless Pact',
  vigor: "Bull's Vigor",
  grace: "Angel's Grace",
};

export function boonName(kind: BoonKind): string {
  return BOON_NAMES[kind];
}

/** Hearts the Deathless Pact adds. */
export const DEATHLESS_HEARTS = 2;
/** Attack and defense Bull's Vigor adds. */
export const VIGOR_ATK = 1;
export const VIGOR_DEF = 1;
/** Spirit Angel's Grace adds. */
export const GRACE_SPIRIT = 2;
/** Potion capacity (and potions in hand) Angel's Grace adds. */
export const GRACE_POTIONS = 1;

export function boonDescription(kind: BoonKind): string {
  switch (kind) {
    case 'deathless':
      return `+${DEATHLESS_HEARTS} hearts, from the first floor.`;
    case 'vigor':
      return `+${VIGOR_ATK} attack and +${VIGOR_DEF} defense, from the first floor.`;
    case 'grace':
      return `+${GRACE_SPIRIT} spirit, and a health potion from the first floor.`;
  }
}

/**
 * Hand the boon to this hero, right now, at `depth`. Idempotent per run in
 * the sense that the caller only ever calls it once per boon per run: at the
 * altar, or at the start of the run.
 */
export function applyBoon(hero: Hero, kind: BoonKind, depth: number): void {
  switch (kind) {
    case 'deathless':
      hero.maxHp += DEATHLESS_HEARTS * HEART;
      hero.hp += DEATHLESS_HEARTS * HEART;
      break;
    case 'vigor':
      hero.atk += VIGOR_ATK;
      hero.def += VIGOR_DEF;
      break;
    case 'grace':
      hero.spirit += GRACE_SPIRIT;
      hero.potionCapacity += GRACE_POTIONS;
      hero.potions += GRACE_POTIONS;
      break;
  }
}

/**
 * A run is starting: apply every boon that still has runs on it, count this
 * run off each, and split them into the ones this run carries (for the help
 * screen, with `runsLeft` already decremented) and the ones worth writing
 * back to storage (those with runs still to come).
 */
export function spendBoons(stored: Boon[], hero: Hero): { active: Boon[]; keep: Boon[] } {
  const active: Boon[] = [];
  const seen = new Set<BoonKind>();
  for (const b of stored) {
    if (!b || typeof b.runsLeft !== 'number' || b.runsLeft <= 0 || seen.has(b.kind)) continue;
    seen.add(b.kind);
    applyBoon(hero, b.kind, 1);
    active.push({ kind: b.kind, runsLeft: b.runsLeft - 1 });
  }
  return { active, keep: active.filter((b) => b.runsLeft > 0) };
}

/**
 * A boon just earned at an altar: replace any older one of the same kind
 * (a fresh one is never worse) in `stored`, and return the new list.
 */
export function addBoon(stored: Boon[], kind: BoonKind, runsLeft: number): Boon[] {
  const rest = stored.filter((b) => b && b.kind !== kind);
  return [...rest, { kind, runsLeft }];
}
