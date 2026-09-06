/**
 * The boss worlds: what a world module is, and what the engine hands it.
 *
 * A world is a place a carved crystal opens the floor-one portal onto (see
 * crafting.ts): one or more floors of `kind: 'world'`, themed for the boss
 * whose trophy made the crystal, puzzle-heavy, with a permanent collectible
 * at the end and a way back to the main floor. The engine knows nothing
 * about any one world. It knows this interface, and a registry of three
 * modules that implement it (`WORLDS` in ./index.ts).
 *
 * The split:
 *  - The module owns its floors (`generate`), everything that happens on
 *    them (`tick`, `onEnter`, `onBump`, `step`, `fights`) and the words for
 *    them (`intro`, `defeat`, `collectible`). It keeps whatever state it
 *    needs in `WorldData.data`, which rides from stage to stage and into the
 *    save; the engine never reads it.
 *  - The engine owns the hero, the clock, movement, fighting, pickups,
 *    saving, the popups and the stairs home. It calls the module through a
 *    `WorldCtx` that offers exactly the things a module may do to the game,
 *    so a module never reaches into `Game`.
 *
 * What a module may put on a floor: ordinary monsters (`makeMonster` with
 * the theme's roster, or its own `WorldMonsterKind`s, which it must also
 * drive through `step`), keys, doors and chests as any maze floor, and
 * `Prop`s — its own interactive things, keyed by `Prop.kind`, solid or
 * ground, some of them carriable. The renderer draws a prop with the art the
 * module registered under `Prop.art` (render/worlds).
 *
 * Rules every module keeps:
 *  - `generate` is deterministic for (stage, runSeed, data) and never
 *    throws; its level has odd width and height, a solid outer ring, and
 *    every floor tile reachable from `start` (doors open, chests and solid
 *    props as walls) — or at least every tile the module means the hero to
 *    reach. `level.exit` is set (the engine needs a tile), but a world floor
 *    is left by the module's own means: `ctx.goto` and `ctx.returnHome`,
 *    never by walking onto `exit` (the engine ignores it on world floors).
 *  - Monster stats scale from `hero.level`, not depth: a crystal can be spent
 *    on floor one of a fresh run by a level-one hero. Worlds are puzzles
 *    with hazards, not gauntlets.
 *  - A module that changes `level.tiles` after generation calls
 *    `ctx.rebuild()` so the renderer repaints, and usually `ctx.freeze()`
 *    first so the change is a cutscene rather than a surprise mid-step.
 *  - A knockdown on a world floor is a game over, as in a boss chamber;
 *    `defeat(cause)` turns the engine's or the module's cause token into the
 *    world's own sentence. The player may pay to retry the stage, exactly as
 *    a boss fight.
 */
import type { GameState, Hero, LevelData, Monster, Prop, Rng, SfxId, Vec, WorldData, WorldKind } from '../types';
import type { ItemStats } from '../items';

/** What the engine gives a module to act with. Built fresh per call by game.ts. */
export interface WorldCtx {
  state: GameState;
  level: LevelData;
  world: WorldData;
  hero: Hero;
  rng: Rng;
  /** The hero's gear, for `step`. */
  stats: ItemStats;

  /** Go to another floor of this world (the module decides the graph). `data` rides along. */
  goto(stage: number): void;
  /** The world is won: award `collectible` for good, show `worldWon`, and open the way home. */
  finish(): void;
  /** Back to the main floor the hero came from, at the portal. Whether the world was won or not. */
  returnHome(): void;
  /** The run ends here. `cause` is passed to `defeat` for the words. */
  gameOver(cause: string): void;
  /** Hold the whole world still for `ms` while effects play; `shake` in pixels. */
  freeze(ms: number, shake?: number): void;
  /** Repaint: the module changed `level.tiles`. Bumps `level.rev`. */
  rebuild(): void;

  /** Put a prop in the hero's arms (it goes `hidden`); take it out again onto `at`. */
  pickUp(prop: Prop): void;
  setDown(at: Vec): Prop | null;
  /** The prop the hero is carrying, or null. */
  carried(): Prop | null;
  /** Remove a prop from the floor for good (consumed, delivered). */
  consume(prop: Prop): void;
  /** Add a monster to the floor. */
  spawn(m: Monster): void;

  text(pos: Vec, text: string, color: string, ttl?: number): void;
  log(text: string): void;
  sfx(id: SfxId): void;
  ring(pos: Vec, radius: number, color: string, ttl?: number): void;
  flash(pos: Vec, color: string, ttl?: number): void;
  shake(strength: number, ttl: number): void;
}

export interface WorldModule {
  kind: WorldKind;
  /** The world's name, for the HUD badge and the intro. Short. */
  name: string;
  /** What this stage is and what to do there. `lines` are short sentences. */
  intro(stage: number, data: WorldData['data']): { title: string; lines: string[] };
  /** The one thing the world gives, for good. */
  collectible: { id: string; name: string; description: string };
  /**
   * The words for a run ending here. `cause` is the engine's token
   * ('knockdown') or one the module passed to `ctx.gameOver`.
   */
  defeat(stage: number, cause: string): string;

  /**
   * Build stage `stage` of the world. `data` is the world's state so far, or
   * null on first entry; the returned level's `world.data` is what rides on.
   */
  generate(stage: number, runSeed: number, hero: Hero, data: WorldData['data'] | null): LevelData;

  /** Once a tick, after the monsters have moved. */
  tick?(ctx: WorldCtx, dt: number): void;
  /** The hero stepped onto `tile` (keys, shrines and carriable props already handled). */
  onEnter?(ctx: WorldCtx, tile: Vec): void;
  /** The hero walked into a solid prop. */
  onBump?(ctx: WorldCtx, prop: Prop): void;
  /** One step for one of the module's own monsters (a `WorldMonsterKind`); null to stay put. */
  step?(ctx: WorldCtx, m: Monster): Vec | null;
  /** May this monster swing at an adjacent hero? Default true. */
  fights?(ctx: WorldCtx, m: Monster): boolean;
}
