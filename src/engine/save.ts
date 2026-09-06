/**
 * localStorage persistence. Everything is best-effort: private-mode failures,
 * quota errors and corrupt payloads all degrade to "no save".
 */
import type { Boon, GameState, Hero, LevelData, SaveData } from './types';
import { BOON_KINDS, SAVE_VERSION, key } from './types';
import { reviveGear } from './items';
import { reviveBuffs } from './shrines';

const STORAGE_KEY = 'table-maze:save';
/**
 * The boons live beside the save, not in it: a save is wiped when a run
 * ends, and a boon is the one thing meant to outlive that.
 */
const BOONS_KEY = 'table-maze:boons';

/** localStorage if it exists and is usable (guarded so tests can import this). */
function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): void {
  const ls = store();
  if (!ls) return;
  // A finished run is never written back: reloading must not resurrect a hero
  // who died in a boss chamber. Wiping it here also frees the next New Game.
  if (state.over) {
    clearSave();
    return;
  }
  try {
    const data: SaveData = {
      version: SAVE_VERSION,
      depth: state.depth,
      seed: state.seed,
      hero: state.hero,
      level: state.level,
      trail: Array.from(state.trail),
      stats: state.stats,
      descending: 0,
      over: false,
      boons: state.boons ?? [],
    };
    ls.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode: skip this save */
  }
}

export function loadGame(): GameState | null {
  const ls = store();
  if (!ls) return null;
  let parsed: unknown;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  try {
    const d = parsed as Partial<SaveData> | null;
    if (!d || typeof d !== 'object') return null;
    if (d.version !== SAVE_VERSION) return null;
    if (typeof d.depth !== 'number' || typeof d.seed !== 'number') return null;
    if (d.over) return null; // the run ended; there is nothing to go back to

    const hero = d.hero as Hero | undefined;
    if (!hero || typeof hero !== 'object') return null;
    if (!hero.pos || typeof hero.pos.x !== 'number' || typeof hero.pos.y !== 'number') return null;
    if (typeof hero.hp !== 'number' || typeof hero.maxHp !== 'number') return null;

    const level = d.level as LevelData | undefined;
    if (!level || typeof level !== 'object') return null;
    if (typeof level.width !== 'number' || typeof level.height !== 'number') return null;
    if (!Array.isArray(level.tiles) || level.tiles.length !== level.height) return null;
    if (!Array.isArray(level.tiles[0]) || level.tiles[0].length !== level.width) return null;
    if (!level.start || !level.exit) return null;
    if (!Array.isArray(level.monsters)) return null;
    if (!Array.isArray(level.keys) || !Array.isArray(level.doors) || !Array.isArray(level.chests)) {
      return null;
    }

    if (!hero.rpos) hero.rpos = { x: hero.pos.x, y: hero.pos.y };
    if (!hero.keys) hero.keys = { door: 0, chest: 0 };
    if (!Array.isArray(hero.items)) hero.items = [];
    if (typeof hero.potionCapacity !== 'number') hero.potionCapacity = 0;
    if (typeof hero.potions !== 'number') hero.potions = 0;
    // A lens that came back without a set (or with something that is not one)
    // is not a lens: better no passages than passages that never open.
    if (!hero.lens || typeof hero.lens.set !== 'number') hero.lens = null;
    if (typeof hero.carrying !== 'string') hero.carrying = null;
    if (!Array.isArray(hero.relics)) hero.relics = [];
    if (!Array.isArray(hero.trophies)) hero.trophies = [];
    hero.stun = 0;
    if (typeof hero.sleeping !== 'boolean') hero.sleeping = false;
    hero.hitFlash = 0;
    hero.lungeT = 0;
    hero.lunge = undefined;
    reviveGear(hero);
    reviveBuffs(hero);
    for (const m of level.monsters) {
      if (typeof m.poisonMs !== 'number') m.poisonMs = 0;
      if (typeof m.poisonDmg !== 'number') m.poisonDmg = 0;
      if (typeof m.slowMs !== 'number') m.slowMs = 0;
      if (typeof m.frozenMs !== 'number') m.frozenMs = 0;
    }

    const trail = new Set<string>(Array.isArray(d.trail) ? d.trail : []);
    trail.add(key(hero.pos));

    const state: GameState = {
      version: SAVE_VERSION,
      depth: d.depth,
      seed: d.seed,
      hero,
      level,
      trail,
      path: [],
      pointer: null,
      fx: [],
      sfx: [],
      log: [],
      stats: {
        kills: d.stats?.kills ?? 0,
        deepest: d.stats?.deepest ?? d.depth,
        playMs: d.stats?.playMs ?? 0,
        bosses: d.stats?.bosses ?? 0,
        bossRetries: d.stats?.bossRetries ?? 0,
      },
      descending: 0,
      modal: null,
      compass: null,
      over: false,
      boons: Array.isArray(d.boons) ? d.boons.filter(validBoon) : [],
    };
    return state;
  } catch {
    return null;
  }
}

function validBoon(b: unknown): b is Boon {
  if (!b || typeof b !== 'object') return false;
  const x = b as Partial<Boon>;
  return typeof x.kind === 'string' && BOON_KINDS.includes(x.kind) && typeof x.runsLeft === 'number';
}

/** The boons waiting for the next run. Empty when there are none or storage is unusable. */
export function loadBoons(): Boon[] {
  const ls = store();
  if (!ls) return [];
  try {
    const raw = ls.getItem(BOONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(validBoon) : [];
  } catch {
    return [];
  }
}

export function saveBoons(boons: Boon[]): void {
  const ls = store();
  if (!ls) return;
  try {
    if (boons.length === 0) ls.removeItem(BOONS_KEY);
    else ls.setItem(BOONS_KEY, JSON.stringify(boons));
  } catch {
    /* quota / private mode: skip */
  }
}

export function clearSave(): void {
  const ls = store();
  if (!ls) return;
  try {
    ls.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
