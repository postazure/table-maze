# Module contracts

All shared types live in `src/types.ts`. Each module below must export exactly
the listed API (extra internal helpers are fine). Modules only import from
`./types` and from the modules listed under "depends on".

Rules for everyone:
- Vanilla TypeScript, no runtime dependencies, strict mode, must pass `tsc --noEmit`.
- No DOM access except in `render.ts`, `hud.ts`, `input.ts`, `save.ts`, `main.ts`.
- Pure functions where possible; never mutate `LevelData.tiles` after generation.
- Deterministic: all randomness goes through an `Rng` (see `rng.ts`).

## rng.ts
```ts
export function makeRng(seed: number): Rng;      // mulberry32 or similar, deterministic
export function hashSeed(...parts: number[]): number; // combine numbers into a 32-bit seed
```

## pathfind.ts
```ts
export function inBounds(level: LevelData, p: Vec): boolean;
export function isFloor(level: LevelData, p: Vec): boolean;
/** 4-neighbour floor tiles. */
export function floorNeighbors(level: LevelData, p: Vec): Vec[];
/**
 * BFS shortest path from `from` to `to` through Floor tiles.
 * Returns the list of tiles EXCLUDING `from` and INCLUDING `to`, or null.
 * `blocked(p)` lets callers treat closed doors / monsters as walls.
 * `maxLen` (optional) aborts early and returns null if the path would be longer.
 */
export function bfsPath(level: LevelData, from: Vec, to: Vec, opts?: { blocked?: (p: Vec) => boolean; maxLen?: number }): Vec[] | null;
/** BFS distances from `from` to every reachable floor tile (Map of key -> distance). */
export function bfsDistances(level: LevelData, from: Vec, opts?: { blocked?: (p: Vec) => boolean; maxDist?: number }): Map<string, number>;
```

## balance.ts
```ts
export function levelDims(depth: number): { width: number; height: number }; // odd tile counts, portrait (height > width). depth 1 ≈ 11x17, grows to a cap ≈ 21x31.
export function newHero(): Hero;                     // level 1 starting stats
export function xpForLevel(level: number): number;   // xp needed to go from `level` to `level+1`
export function applyLevelUp(hero: Hero): void;      // called when hero.xp >= hero.xpToNext; bumps stats, restores hp, sets new xpToNext (may loop if enough xp for multiple levels)
export function makeMonster(kind: MonsterKind, depth: number, rng: Rng, pos: Vec, id: string): Monster; // stats scale with depth; picks name/glyph from a themed table
export function rollChestLoot(depth: number, rng: Rng): Loot;
export function damage(attackerAtk: number, defenderDef: number, rng: Rng): number; // >= 1
```

## maze.ts
```ts
export function generateLevel(depth: number, runSeed: number): LevelData;
```
Requirements:
- Perfect maze (recursive backtracker or similar) on the tile grid from
  `levelDims(depth)`, then braid it: open ~15% of dead ends to create loops so
  lurkers can be baited and out-run.
- `start` near the top-left region, `exit` far from start (use BFS distance;
  pick among the farthest tiles).
- Doors: 1 + floor(depth / 3) doors (cap 4) placed ON the start→exit path at
  corridor tiles (both side neighbours are walls). Each door needs a matching
  door key placed somewhere reachable WITHOUT passing through that door (or
  any later door). Verify with BFS using `blocked` = closed doors.
- Chests: 2 + floor(depth / 2) chests (cap 6) in dead ends / off-path branches,
  some may sit behind doors. One chest key per chest, placed reachable
  (respecting the door ordering above). Chest keys and door keys are distinct
  kinds.
- Monsters: count scales with depth (≈ 3 + depth, cap 12). Mix:
  guards on chokepoints near chests/doors/exit, patrols along straight-ish
  corridor runs (give them a `patrolPath` of 4-10 tiles walked via BFS),
  lurkers on side branches next to the main path (their `sightRange` should
  cover the main path tile they guard). Never spawn a monster within 4 tiles of
  `start`. Never spawn two entities on the same tile. Keys/chests/doors never
  share tiles with monsters or each other. The level must be solvable: exit
  reachable from start once all doors are open, and every key reachable in
  order.
- Must be deterministic for a given (depth, runSeed).

## combat.ts
```ts
/** Hero attacks monster. Applies damage, pushes fx/log, handles death (xp/gold/level-up). */
export function heroAttack(state: GameState, m: Monster, rng: Rng): void;
/** Monster attacks hero. Applies damage, knockback (hero pushed one tile away from the monster
 *  if that tile is free floor), and "knock down" when hp reaches 0 (see below). */
export function monsterAttack(state: GameState, m: Monster, rng: Rng): void;
```
Heroes never die. When hp would drop to 0: hp is set to ~40% of max, the hero is
`stun`ned for ~900ms, and moved back along the trail ~4 tiles (walk back through
the most recently visited trail tiles that are free floor; fall back to any free
adjacent tile). Push a "Knocked down!" message and a shake effect.
Out of combat (sinceCombat > 3000ms) hero regains 1 hp every ~600ms.

## monsters.ts
```ts
/** Advance every monster by dt ms: movement, state changes, attacks (calls monsterAttack). */
export function updateMonsters(state: GameState, dt: number, rng: Rng): void;
```
Monsters never walk onto: walls, closed doors, other monsters, the hero, keys,
chests, the exit. They attack when 4-adjacent to the hero and attackCooldown <= 0.
Lerp each monster's `rpos` toward `pos` (fast, ~14 tiles/s), decrement hitFlash/lungeT.

## input.ts
```ts
export function attachInput(canvas: HTMLElement, mapper: TileMapper, game: Game): () => void; // returns detach fn
```
Pointer/touch drag only. On pointerdown/pointermove call `game.pointerAt(tile)`;
on pointerup/cancel call `game.pointerEnd()`. Must `preventDefault` touch
scrolling on the canvas (`touch-action: none` in CSS too). Use pointer capture.

## save.ts
```ts
export function saveGame(state: GameState): void;   // localStorage, key "table-maze:save"
export function loadGame(): GameState | null;       // null if none / corrupt / version mismatch
export function clearSave(): void;
```

## game.ts
```ts
export class Game {
  state: GameState;
  constructor(saved?: GameState | null);   // starts a fresh run if null
  newGame(): void;
  /** Advance simulation by dt ms (called from rAF). */
  tick(dt: number): void;
  /** Finger is over `tile` (or null when off the maze). Extends the walking path. */
  pointerAt(tile: Vec | null): void;
  pointerEnd(): void;
  /** Called after any state change worth persisting (hero moved, loot, etc). Set by main.ts. */
  onChange?: (state: GameState) => void;
}
```
Path building rule (in `pointerAt`): let `tail` = last tile of `state.path`
(or hero.pos if empty). If `tile` is 4-adjacent to `tail` and is walkable, push
it. Else if it is walkable and within `bfsPath(level, tail, tile, {maxLen: 8})`,
push that path. Else ignore. If `tile` is already in the path, truncate the path
back to it (lets the player backtrack). Walkable = Floor, not a closed door
(unless the hero has a door key — then walking into it opens it and consumes a
key), not a monster (walking into a live monster = attack, and the path is
cleared).
Hero walks the path at ~7 tiles/s (moveInterval ≈ 140ms), lerping `rpos`.
Stepping on a key picks it up; on a chest with a chest key opens it (consumes
the key, applies loot, item bonuses); on the exit starts the descend: after
~700ms generate `depth+1`, reset trail/path, place hero at start, keep hero
stats but NOT keys (keys are per-level), heal 50% of missing hp.
`trail` gets every tile the hero stands on.

## render.ts
```ts
export class Renderer implements TileMapper {
  constructor(canvas: HTMLCanvasElement);
  /** Recompute tile size from the canvas' CSS size and the level dims. Call on resize and level change. */
  resize(level: LevelData): void;
  draw(state: GameState, dt: number): void;   // also ages/prunes state.fx
  tileAt(clientX: number, clientY: number): Vec | null;
}
```
Visual spec: dark dungeon palette. Walls solid, floors darker. Trail = light
translucent highlight on visited tiles. Queued path = faint dotted line. Pointer
tile = soft ring. Hero = emoji "🧝" (or a drawn circle) with a colored ring, keys
"🗝️" (door, gold tint) / "🔑" (chest, blue tint), doors "🚪" drawn as a solid bar
when closed, chests "📦" / opened "📭", exit "🪜". Monsters use `glyph`.
Lurker chasing = red ring; returning = yellow ring; guard = small shield mark.
HP bars above damaged monsters and the hero. `hitFlash` = white overlay.
`lunge` = offset draw. Effects: floating text rising and fading, flash, screen shake.
Respect devicePixelRatio. Never scroll the page.

## hud.ts
```ts
export class Hud {
  constructor(root: HTMLElement, actions: { onNewGame: () => void });
  update(state: GameState): void;   // cheap; called every frame, only touch DOM when values change
}
```
Shows: depth, hero level, HP bar, XP bar, ATK/DEF, gold, key counts (door/chest
with the two icons), kills/chests, last 3 log messages, a "New game" button
(with confirm). Compact, fits below the maze on a phone in portrait.
