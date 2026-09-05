/**
 * Shrines: what each alcove hands out, and the running effects it leaves on
 * the hero.
 *
 * A shrine is a one-shot version of a magic item. Nothing here changes the
 * controls either: the hero walks over an alcove, the shrine lights, and the
 * gift runs on a clock of its own. Every number comes from `Shrine.level`,
 * which is the depth the floor was generated at, the same way `MagicItem`
 * numbers come from the depth an item was bought at.
 *
 * Five of the six are timers. The ward is not: it is a pool of temporary
 * hearts that soaks damage until it is empty, so it runs out by being used
 * rather than by waiting.
 */
import type { Buff, Hero, ShrineKind, TimedShrineKind } from './types';
import { HEART } from './types';

/** ms of effect for each timed shrine. Long enough to plan a fight around. */
const DURATION_MS: Record<TimedShrineKind, number> = {
  fury: 20000,
  stone: 20000,
  frost: 25000,
  mend: 15000,
  time: 18000,
};

const NAMES: Record<ShrineKind, string> = {
  ward: 'Ward',
  fury: 'Fury',
  stone: 'Stone Skin',
  frost: 'Frost',
  mend: 'Mending',
  time: 'Time Bubble',
};

/**
 * One colour per shrine, used everywhere it shows: the alcove glow, the
 * effects it throws, and the timer over the hero's head. Learn the colour once
 * and the pip above the hero needs no label.
 */
export const SHRINE_COLORS: Record<ShrineKind, string> = {
  ward: '#5aa9ff',
  fury: '#ff5c5c',
  stone: '#b9c4d8',
  frost: '#bfe3ff',
  mend: '#8fd694',
  time: '#b98cff',
};

export function shrineName(kind: ShrineKind): string {
  return NAMES[kind];
}

/** How long `kind` runs for. 0 for the ward, which is spent rather than timed. */
export function shrineDurationMs(kind: ShrineKind): number {
  return kind === 'ward' ? 0 : DURATION_MS[kind];
}

const lvl = (level: number): number => Math.max(1, Math.floor(level || 1));

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/** Ward: temporary quarter-hearts. One heart, plus another every third floor. */
export function wardTempHp(level: number): number {
  return HEART * (1 + Math.floor(lvl(level) / 3));
}

/** Fury: extra attack while it runs. */
export function furyAtk(level: number): number {
  return 2 + Math.floor(lvl(level) / 2);
}

/** Stone skin: extra defense while it runs. */
export function stoneDef(level: number): number {
  return 2 + Math.floor(lvl(level) / 2);
}

/** Frost: ms between ice balls. */
export function frostIntervalMs(level: number): number {
  return Math.max(1200, 2600 - 80 * lvl(level));
}

/** Frost: damage per ice ball. */
export function frostDmg(level: number): number {
  return 2 + Math.floor(lvl(level) / 2);
}

/** Frost: how far an ice ball reaches, in BFS tiles through open floor. */
export const FROST_RANGE = 6;
/** Frost: how long the monster it hits stands there doing nothing. */
export const FREEZE_MS = 2200;

/** Mending: ms between quarter hearts, in combat and out of it. */
export function mendPulseMs(level: number): number {
  return Math.max(250, 600 - 30 * lvl(level));
}

/** Time bubble: how far it reaches, in tiles. */
export const TIME_RADIUS = 6;
/** Time bubble: monsters inside it wait this many times as long between acts. */
export const TIME_SLOW_MULT = 2.5;

// ---------------------------------------------------------------------------
// Buffs on the hero
// ---------------------------------------------------------------------------

/** A fresh buff for `kind` at `level`. Never called for the ward. */
export function makeBuff(kind: TimedShrineKind, level: number): Buff {
  const ms = shrineDurationMs(kind);
  return { kind, ms, totalMs: ms, level: lvl(level), timer: 0 };
}

export function findBuff(hero: Hero, kind: TimedShrineKind): Buff | null {
  return hero.buffs?.find((b) => b.kind === kind) ?? null;
}

/**
 * Light a shrine on the hero. A second helping of the same buff refreshes it
 * to full rather than stacking a second copy — one alcove, one effect.
 */
export function addBuff(hero: Hero, kind: TimedShrineKind, level: number): Buff {
  if (!hero.buffs) hero.buffs = [];
  const fresh = makeBuff(kind, level);
  const live = findBuff(hero, kind);
  if (live) {
    live.ms = fresh.ms;
    live.totalMs = fresh.totalMs;
    live.level = fresh.level;
    return live;
  }
  hero.buffs.push(fresh);
  return fresh;
}

/** Extra attack from a running fury buff, or 0. */
export function buffAtk(hero: Hero): number {
  const b = findBuff(hero, 'fury');
  return b ? furyAtk(b.level) : 0;
}

/** Extra defense from a running stone skin buff, or 0. */
export function buffDef(hero: Hero): number {
  const b = findBuff(hero, 'stone');
  return b ? stoneDef(b.level) : 0;
}

/** The time bubble around the hero right now, or null. */
export function timeBubble(hero: Hero): { radius: number; mult: number } | null {
  return findBuff(hero, 'time') ? { radius: TIME_RADIUS, mult: TIME_SLOW_MULT } : null;
}

// ---------------------------------------------------------------------------
// The on-screen timer
// ---------------------------------------------------------------------------

/** Under this much left the timer blinks... */
export const BUFF_WARN_MS = 10000;
/** ...and under this it blinks twice as fast. */
export const BUFF_URGENT_MS = 5000;

/**
 * How a running buff should read on screen. No numbers anywhere: solid while
 * there is time, blinking for the last ten seconds, blinking fast for the last
 * five.
 */
export type BuffPhase = 'solid' | 'warn' | 'urgent';

export function buffPhase(ms: number): BuffPhase {
  if (ms <= BUFF_URGENT_MS) return 'urgent';
  if (ms <= BUFF_WARN_MS) return 'warn';
  return 'solid';
}

/** ms per blink for each phase. `solid` never blinks. */
export const BLINK_MS: Record<BuffPhase, number> = {
  solid: 0,
  warn: 560,
  urgent: 240,
};

// ---------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------

/** Fill in the shrine fields a hero from an older or hand-made save is missing. */
export function reviveBuffs(hero: Hero): void {
  if (typeof hero.tempHp !== 'number' || !(hero.tempHp > 0)) hero.tempHp = 0;
  if (typeof hero.tempHpMax !== 'number' || hero.tempHpMax < hero.tempHp) hero.tempHpMax = hero.tempHp;
  const raw: unknown = hero.buffs;
  if (!Array.isArray(raw)) {
    hero.buffs = [];
    return;
  }
  hero.buffs = (raw as Buff[]).filter(
    (b) => b && typeof b.kind === 'string' && typeof b.ms === 'number' && b.ms > 0,
  );
  for (const b of hero.buffs) {
    if (typeof b.totalMs !== 'number' || b.totalMs <= 0) b.totalMs = shrineDurationMs(b.kind) || b.ms;
    if (typeof b.level !== 'number') b.level = 1;
    if (typeof b.timer !== 'number') b.timer = 0;
  }
}

// ---------------------------------------------------------------------------
// Words (help screen, log lines)
// ---------------------------------------------------------------------------

const sec = (ms: number): string => `${Math.round(ms / 100) / 10}s`;
const hearts = (hp: number): string => {
  const h = hp / HEART;
  return `${Number.isInteger(h) ? h : h.toFixed(2)} heart${h === 1 ? '' : 's'}`;
};

/** Plain-words explanation of one shrine at `level`, with its real numbers. */
export function shrineDescription(kind: ShrineKind, level: number): string {
  switch (kind) {
    case 'ward':
      return `${hearts(wardTempHp(level))} of extra, temporary hearts. Hits eat those first, and nothing ever refills them.`;
    case 'fury':
      return `+${furyAtk(level)} attack for ${sec(shrineDurationMs('fury'))}.`;
    case 'stone':
      return `+${stoneDef(level)} defense for ${sec(shrineDurationMs('stone'))}.`;
    case 'frost':
      return `For ${sec(shrineDurationMs('frost'))}, an ice ball flies at the nearest monster within ${FROST_RANGE} tiles every ${sec(frostIntervalMs(level))} for ${frostDmg(level)} damage and freezes it solid for ${sec(FREEZE_MS)}.`;
    case 'mend':
      return `A quarter heart every ${sec(mendPulseMs(level))} for ${sec(shrineDurationMs('mend'))}, even while fighting.`;
    case 'time':
      return `For ${sec(shrineDurationMs('time'))}, every monster within ${TIME_RADIUS} tiles moves and attacks at a crawl.`;
  }
}
