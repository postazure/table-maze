/**
 * The engine's half of a boss world: builds the `WorldCtx` a module acts
 * through, and the handful of things every entry point into a world needs
 * (a salt for the per-stage rng, and the collectible payout).
 *
 * `game.ts` stays thin by implementing `WorldHost` — the two things a `WorldCtx`
 * cannot do on its own because they touch Game's own private bookkeeping
 * (the move/attack timers, the tick rng) — and handing that, along with the
 * live `GameState` and `Rng`, to `makeWorldCtx` fresh on every call. Nothing
 * here reaches into `Game`; nothing in `Game` re-implements what a `WorldCtx`
 * already does.
 */
import type { GameState, LevelData, Monster, Prop, Rng, WorldData, WorldKind } from './types';
import type { WorldCtx } from './worlds/world';
import { WORLDS } from './worlds';
import { hashSeed } from './rng';
import { heroStats } from './items';
import { carriedProp, gameOver, pushLog, pushSfx, pushShake, pushText } from './combat';
import { saveCollection } from './save';

/** A boss kind (== WorldKind) turned into a small, stable, non-zero integer for `worldSalt`. */
const WORLD_KIND_SALT: Record<WorldKind, number> = { necromancer: 1, minotaur: 2, angels: 3 };

/**
 * The rng salt for one stage of one world, folding in the retry count so a
 * paid retry never replays the exact random events of the attempt it is
 * repeating (the same reasoning `retryBoss` already uses for a boss chamber).
 * Kept well clear of the plain maze/boss/shop salts in game.ts.
 */
export function worldSalt(kind: WorldKind, stage: number, retries = 0): number {
  return hashSeed(0x574f524c /* 'WORL' */, WORLD_KIND_SALT[kind], stage, retries);
}

/**
 * What a `WorldCtx` cannot do by itself: enter a freshly generated stage (an
 * ordinary fresh-floor arrival — position, keys, potions, trail reset, the
 * tick rng reseeded — is `Game`'s own private `resetToLevel`) and restore the
 * stashed main floor. Everything else a module can do to the game — freeze
 * it, push fx/log/sfx, hand over the collectible, carry a prop — is plain
 * `GameState` mutation and lives entirely in this file.
 */
export interface WorldHost {
  /** Enter `level` as stage `stage` of `kind`'s world and show `worldIntro` for it. */
  enterWorldStage(kind: WorldKind, stage: number, level: LevelData): void;
  /** Restore the stashed main floor, hero standing by its portal. */
  returnFromWorld(): void;
}

/**
 * The world is won: the collectible is the hero's for good (deduped, and
 * written to the storage slot that survives the run ending), the floor
 * remembers it, the popup says so, and the way home — hidden until now, so a
 * hero can't stumble home before the world is done — opens.
 */
function finish(state: GameState): void {
  const world = state.level.world;
  if (!world) return;
  const module = WORLDS[world.kind];
  if (!state.collection.includes(module.collectible.id)) {
    state.collection = [...state.collection, module.collectible.id];
    saveCollection(state.collection);
  }
  world.won = true;
  const home = (state.level.props ?? []).find((p) => p.kind === 'portal-home');
  if (home) home.hidden = false;
  pushLog(state, `Won ${module.collectible.name}`);
  pushSfx(state, 'collect');
  state.modal = { kind: 'worldWon', world: world.kind, collectible: module.collectible.name };
}

/** Build a `WorldCtx` for the current tick's call into a world module. */
export function makeWorldCtx(host: WorldHost, state: GameState, world: WorldData, rng: Rng): WorldCtx {
  const level = state.level;
  const hero = state.hero;
  return {
    state,
    level,
    world,
    hero,
    rng,
    stats: heroStats(hero),

    goto(stage) {
      const module = WORLDS[world.kind];
      const next = module.generate(stage, state.seed, hero, world.data);
      host.enterWorldStage(world.kind, stage, next);
    },
    finish() {
      finish(state);
    },
    returnHome() {
      host.returnFromWorld();
    },
    gameOver(cause) {
      // combat.ts's `gameOver` already special-cases a world floor (it reads
      // `level.world.kind`/`stage` off `state` itself), so the module only
      // ever hands over the cause token.
      gameOver(state, cause);
    },
    freeze(ms, shake = 0) {
      state.freeze = Math.max(state.freeze, ms);
      if (shake > 0) pushShake(state, shake, ms);
    },
    rebuild() {
      level.rev = (level.rev ?? 0) + 1;
    },

    pickUp(prop: Prop) {
      hero.carrying = prop.id;
      prop.hidden = true;
    },
    setDown(at) {
      const prop = carriedProp(state);
      if (!prop) return null;
      prop.hidden = false;
      prop.pos = { x: at.x, y: at.y };
      hero.carrying = null;
      return prop;
    },
    carried() {
      return carriedProp(state);
    },
    consume(prop: Prop) {
      if (hero.carrying === prop.id) hero.carrying = null;
      const list = level.props;
      if (!list) return;
      const idx = list.indexOf(prop);
      if (idx >= 0) list.splice(idx, 1);
    },
    spawn(m: Monster) {
      level.monsters.push(m);
    },

    text(pos, text, color, ttl) {
      pushText(state, pos, text, color, ttl);
    },
    log(text) {
      pushLog(state, text);
    },
    sfx(id) {
      pushSfx(state, id);
    },
    ring(pos, radius, color, ttl = 600) {
      state.fx.push({ kind: 'ring', pos: { x: pos.x, y: pos.y }, radius, color, t: 0, ttl });
    },
    flash(pos, color, ttl = 320) {
      state.fx.push({ kind: 'flash', pos: { x: pos.x, y: pos.y }, color, t: 0, ttl });
    },
    shake(strength, ttl) {
      pushShake(state, strength, ttl);
    },
  };
}
