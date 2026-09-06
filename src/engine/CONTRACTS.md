# Module contracts

Layout: `src/engine/` (pure logic, no DOM), `src/render/` (canvas renderer + pointer input), `src/audio/` (Web Audio synthesis), `src/ui/` (React components and hooks), `src/styles/` (global CSS), `test/` (engine tests).

All shared types live in `src/types.ts`. Each module below must export exactly
the listed API (extra internal helpers are fine). Modules only import from
`./types` and from the modules listed under "depends on".

Rules for everyone:
- Vanilla TypeScript, no runtime dependencies, strict mode, must pass `tsc --noEmit`.
- No DOM access in `src/engine/` except `save.ts` (localStorage). DOM lives in `src/render/`, `src/audio/` and `src/ui/`.
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
export function levelDims(depth: number): { width: number; height: number }; // the MAZE's odd tile counts, portrait (height > width). depth 1 ≈ 21x31 (bigger than a phone screen; the renderer scrolls), grows to a cap ≈ 41x61. The level itself is this plus whatever ground the warrens are dug out of.
export function newHero(): Hero;                     // level 1 starting stats
export function spiritForLevel(level: number): number; // the hero's own spirit, before gear: 1 + floor(level/3)
export function xpForLevel(level: number): number;   // xp needed to go from `level` to `level+1`
export function applyLevelUp(hero: Hero): void;      // called when hero.xp >= hero.xpToNext; bumps stats, restores hp, sets new xpToNext (may loop if enough xp for multiple levels)
export function makeMonster(kind: MonsterKind, depth: number, rng: Rng, pos: Vec, id: string, opts?: MonsterOpts): Monster; // stats scale with depth; picks name/glyph from a themed table. `opts.gate` = the player has no way around this one: it sits at the floor's own level and takes neither the role lift nor the elite roll.
export function rollChestLoot(depth: number, rng: Rng): Loot; // item, if any, is a sword/shield/amulet/ring trinket or (one roll in five) a health potion (`LootItem.potionCapacity`)
export function trinketGold(depth: number): number;  // coins a duplicate chest trinket melts down for (a potion trinket is exempt: see openChest in game.ts)
export function xpShare(heroLevel: number, monsterLevel: number): number; // share of a kill's xp banked, from the level difference: >1 when the hero is behind (capped at 3), <1 when ahead (floored at 0.05). Gold is never scaled.
export function damage(attackerAtk: number, defenderDef: number, rng: Rng): number; // >= 1
export function bossRetryCost(depth: number, retriesSoFar: number): number; // gold to buy back into a lost boss fight
export function angelPlan(depth: number): AngelPlan; // the weeping angels' floor by depth: { cols, rows, width, height, minAngels, maxAngels, stepMs }
```
`angelPlan` is the angels' whole difficulty curve, and it scales by ground
rather than by speed. Grid tiers: 3x4 rooms to depth 9, 3x5 to 18, 4x5 to 27,
4x6 after that; a cell is 9x10 tiles, so `width = odd(cols·9 + 2)` and
`height = rows·10 + 1` (both odd, biggest 39x61 — no wider than a deep maze
floor). Statues are 0.35 to 0.5 per room (12 rooms -> 4-6, 24 rooms -> 8-12),
so a bigger floor is never a barer one. `stepMs` is `ANGEL_STEP_MS` less 30 per
tier (600 down to 510): it must stay several times the hero's own step, or the
siege turns back into a footrace.

## maze.ts
```ts
export function generateLevel(depth: number, runSeed: number): LevelData;
/** The guards the player has no way around: the cheapest start->exit route, counting one per guard walked through. */
export function gateGuards(level: LevelData): Monster[];
export const ROUTE_MONSTER_CAP: number;      // most monsters the route and its branches carry
export const WARREN_MONSTER_CAP: number;     // ...per warren, on top of that
export const WARREN_MONSTER_BUDGET: number;  // ...and across all of a floor's warrens
export const PASSAGE_MONSTER_CAP: number;    // ...and per hidden passage
/** Every tile of every hidden passage on the floor, flattened. */
export function passageTilesOf(level: LevelData): Vec[];
```
Requirements:
- Perfect maze (recursive backtracker or similar) on the tile grid from
  `levelDims(depth)`, then braid it: open ~15% of dead ends to create loops so
  lurkers can be baited and out-run.
- `start` near the top-left region, `exit` far from start (use BFS distance;
  pick among the farthest tiles) AND at a dead end. Stepping onto the stairs
  ends the floor, so the hero can never cross them: floor on the far side is
  ground nobody will ever stand on, and anything generated out there is wasted.
  Every floor tile must be reachable from `start` without passing through
  `exit`. A far dead end exists on every floor and costs under two tiles of
  distance on average, so this is close to free.
- Doors: 1 + floor(depth / 3) doors (cap 4) placed ON the start→exit path at
  corridor tiles (both side neighbours are walls). Each door needs a matching
  door key placed somewhere reachable WITHOUT passing through that door (or
  any later door). Verify with BFS using `blocked` = closed doors.
- Chests: 3 + floor(depth / 2) chests (cap 8) in dead ends / off-path branches,
  some may sit behind doors. One chest key per chest, placed reachable
  (respecting the door ordering above). Chest keys and door keys are distinct
  kinds.
- Monsters: count scales with depth (≈ 5 + 1.5·depth, cap 18). Mix:
  guards on chokepoints near chests/doors/exit, patrols along straight-ish
  corridor runs (give them a `patrolPath` of 4-10 tiles walked via BFS),
  lurkers on side branches next to the main path (their `sightRange` should
  cover the main path tile they guard). Never spawn a monster within 4 tiles of
  `start`. Never spawn two entities on the same tile. Keys/chests/doors never
  share tiles with monsters or each other. The level must be solvable: exit
  reachable from start once all doors are open, and every key reachable in
  order.
- Warrens are dug OUTSIDE the maze, not carved out of it. Lay the maze
  (`levelDims`) into a grid with a margin of solid rock on every side, pick
  start and exit inside the maze, then knock single tiles through the maze's
  outer wall and dig a chain of one or more corridor loops into the rock
  beyond each one, strung together by a spine down the middle. That tile is
  the warren's `mouth`, and the loops are why it always leads back to it. Dig nothing
  unless the whole shape and every tile it touches is rock: that is what
  guarantees the one way in, so a warren can never become a route past a gate
  guard. Trim the grid back to the ground actually used afterwards, so a floor
  is only as big as its maze plus the warrens it got — `LevelData.width/height`
  is therefore >= `levelDims(depth)` and <= that plus twice the margin, and no
  longer equal to `levelDims`. Record them in `LevelData.warrens`; blocking
  every warren tile must always leave the stairs reachable. Stock them with
  guards and patrols (and the odd lurker) on top of the route's own budget,
  never on the mouth itself, and keep the route's monsters out of them. The
  renderer draws the mouth as a hole knocked through the wall (broken blocks
  either side, rubble on the floor both sides of the threshold); nothing in the
  UI names them.
- Shrines: 4 per maze floor, all at least 4 tiles from `start`, sharing a tile
  with nothing else, and spread across three different kinds of detour so no
  two are worth the same walk:
    1. one **wayside** alcove — a dead end whose single floor neighbour is on
       the start->exit route, so it cannot be missed;
    2. up to 2 at the **back of the longer warrens** (>= 16 tiles), on the free
       warren tile with the largest `distFromStart` — a warren joins the maze at
       one tile, so that is also the tile furthest from its mouth. Never on the
       mouth itself;
    3. the rest **scattered**: greedily, the remaining dead end whose smallest
       manhattan distance to the shrines already placed is largest.
  A shrine is walkable floor, not furniture, so unlike a chest it never has to
  sit in a dead end — the warren ones stand mid-corridor. Shrines get first pick
  of the dead ends and chests take what is left; there are far more dead ends on
  a floor than either needs. Kinds come off a shuffle of `SHRINE_KINDS`, so a
  floor rarely rolls the same one twice. Never generated on boss or shop floors.
  Recorded in `LevelData.shrines`.
- Hidden passages are dug outside the maze too, in the same margin as the
  warrens and before them, but they hug it: a **shortcut** runs one course of
  brick behind the outer wall from one perimeter tile to another further along
  the same side, and a **vault** (third floor of a themed set only) runs a neck
  out to a small chamber with a chest in a niche at the back. Same `canDig`
  rule as a warren — the whole shape and everything it touches must be rock,
  except the one or two anchors it hangs off — so a passage touches the maze
  only at its mouths, never another passage, and never a warren. Recorded in
  `LevelData.passages`; every tile of one is `Tile.Floor` and every tile of one
  is hidden (see `lens.ts`).
  A shortcut is only dug when the walk it replaces is at least 10 tiles longer
  than the passage itself, so it is always worth the detour. Everything else on
  the floor is then planned as if the passages were still rock: the route, the
  doors, the keys, the shrines and the ordinary monsters all come off a BFS
  with the passage tiles blocked, and `gateGuards` blocks them too. Validation
  runs both worlds — with the passages sealed the stairs, every key and every
  shrine must still be reachable, and with them open every passage tile must
  be. A lens is a saving and never a requirement.
  Stock a passage with patrols and the odd guard, never a lurker and never on
  a mouth: a passage has no room to bait a hunter, and one following the hero
  out of a wall would give the whole thing away. Put one Lens of Truth in an
  ordinary (never hidden) chest on the first two floors of each set, and a
  magic item in each vault's chest — with a chest key of its own, like any
  other chest.
- No unwinnable gate. Guards never move and heal back to full between attempts,
  so a guard on the only way to the stairs must be beatable or the run is dead.
  After placing monsters, re-roll every guard `gateGuards` reports at the
  floor's own level (`makeMonster(..., { gate: true })`), and reject any level
  where one still sits above it. Floor 1 carries no lurkers.
- Must be deterministic for a given (depth, runSeed).

## lens.ts
```ts
export function floorSet(depth: number): number;    // floors 1-3 are set 0, 4-6 set 1, ...
export function floorOfSet(depth: number): 1 | 2 | 3;
export function lensFloor(depth: number): boolean;  // a chest here holds a lens
export function vaultFloor(depth: number): boolean; // a passage here ends in a vault
export function lensActive(hero: Hero, depth: number): boolean;
export const LENS_NAME: string;

export function passageTiles(level: LevelData): Set<string>;   // cached per level
export function passageMouths(level: LevelData): Set<string>;  // cached per level
export function hiddenAt(level: LevelData, p: Vec): boolean;
export function mouthAt(level: LevelData, p: Vec): boolean;
export function passageAt(level: LevelData, p: Vec): Passage | null;

export const LENS_CORE: number;    // tiles revealed at full strength
export const LENS_RADIUS: number;  // ...and where the reveal has faded to nothing
export const LENS_ALPHA: number;   // how see-through the brick ever gets (< 1)
export function lensRevealAt(dist: number): number;
export function lensLit(level: LevelData, hero: Hero, depth: number): boolean;
```
Requirements:
- The one place that answers "is this tile hidden?" and "can this hero see it?".
  `maze.ts`, `game.ts`, `monsters.ts`, `combat.ts` and the renderer all go
  through it; nothing else may decide either question for itself.
- Hidden ground is real floor in `LevelData.tiles`, so pathfinding, monster AI
  and level validation all work on it unchanged. What makes it hidden is that
  the renderer paints it as wall and `game.ts` refuses to walk the hero onto it
  (`isWalkable`, `isTarget` and `stepOnce` all re-ask, so a stale queued path
  cannot smuggle the hero through a wall).
- A lens is bound to the three-floor themed set it was found in
  (`Hero.lens.set`), works nowhere else, and is dropped by `dismissModal` when
  the `lensShatter` popup closes on the way out of that set's shop.
- `lensLit` is true only while the hero stands on hidden ground or one tile
  from a mouth. Walking a corridor that happens to run alongside a passage
  shows nothing; the mouth seams are the only thing visible from further off.
- `passageTiles`/`passageMouths` cache per `LevelData` in a `WeakMap`: they are
  asked once per BFS node while monsters path.

## combat.ts
```ts
/** Hero attacks monster. Applies damage, pushes fx/log, handles death (xp/gold/level-up). */
export function heroAttack(state: GameState, m: Monster, rng: Rng): void;
/** Monster attacks hero. Applies damage, knockback (hero pushed one tile away from the monster
 *  if that tile is free floor), and "knock down" when hp reaches 0 (see below). Returns true when
 *  the hit resolved a knockdown (phoenix/potion burst, sleep, or boss-chamber game over) — callers
 *  (updateMonsters, angels.ts's closeIn) stop feeding the hero more attacks this tick when it does,
 *  so a second monster can't burn another potion charge or finish off a hero a burst-back-up just saved. */
export function monsterAttack(state: GameState, m: Monster, rng: Rng): boolean;
/** The unlit shrine on `p`, or null. Shrines are floor, so nothing else looks them up. */
export function shrineAt(level: LevelData, p: Vec): Shrine | null;
/** Append to `state.log`, trimming to the newest LOG_MAX. */
export function pushLog(state: GameState, text: string): void;
export const LOG_MAX: number;   // 30
```
`state.log` is a run history, not a set of toasts. It used to be three lines
fading out in the corner of the HUD, so five entries and a six-second TTL were
plenty; it is now read on the help screen's Log tab, after the fact, so lines
never expire and the newest `LOG_MAX` are kept. `Message.t` is still aged by
`Game.ageLog` — `pushLog` reads it to tell one event that fired twice in a
frame (one line) from the same event a minute later (two).
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
chests, the exit. Monsters heal 1 hp every ~1.5s once out of combat for 4s. They attack when 4-adjacent to the hero and attackCooldown <= 0.
Lerp each monster's `rpos` toward `pos` (fast, ~14 tiles/s), decrement hitFlash/lungeT.
A lurker that gives up the chase (`returning`) holds its give-up spot for
`LURKER_RETURN_DELAY_MS` (3000ms) — long enough that ducking out of sight and
straight back in still re-aggros it — then walks back to `chaseFrom` (where it
was standing when this chase began, set on the idle -> chasing transition and
kept through any returning -> chasing re-aggro). Arriving settles it to `idle`
and clears `chaseFrom`.

### Passages and monsters (monsters.ts)
A monster stays in the world it was spawned into: `moveBlocked` and
`sightBlocked` both refuse any tile whose hidden-ness differs from the
monster's own `home`. So a passage's patrols pace it and never come out, the
maze's own monsters never walk in, and no lurker can see or chase the hero
through a wall in either direction.

## angels.ts
```ts
/** One act for every awake angel: take a doorway, hold off, or close in and touch. */
export function angelsAct(state: GameState, rng: Rng): void;
/** The floor tiles just outside `room` that touch it: every way in or out of it. */
export function doorsOf(level: LevelData, room: Rect): Vec[];
```
The weeping angels' whole AI, driven by game.ts's step clock and by nothing
else (`updateMonsters` skips them). Depends on `types.ts`, `pathfind.ts`,
`combat.ts` and `boss.ts` (`roomAt`). The rules are under "Movement AI".

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
  /** Buy the shop offer the 'shopOffer' popup is showing. No-op if sold out or too dear. */
  buyOffer(offerId: string): void;
  /** Open the help screen (no-op while another popup is up). */
  openHelp(): void;
  /** Close whatever popup is up and let the simulation run again. */
  dismissModal(): void;
  /** Called after any state change worth persisting (hero moved, loot, etc). Set by main.ts. */
  onChange?: (state: GameState) => void;
}
```
Walking into a shop podium does not buy anything: it opens the `'shopOffer'`
popup (item, what it does, price, what it would replace) and freezes the game.
The UI calls `buyOffer` or `dismissModal`.
A knocked-down hero (`hero.sleeping`) freezes the world the same way a modal
does: `tick()` skips `updateMonsters` and `tickBoss` while sleeping, so no
monster steps or swings and no boss clock (spell timer, minion spawns) moves
while the hero's hearts refill. Only the hero's own drip-heal (`sleep()`) and
cosmetic timers keep running.
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

### Hidden passages (see engine/lens.ts)
The renderer paints the level **twice** on a floor with passages: once with
them as unbroken brick (`staticCanvas`) and once with them as corridor
(`revealCanvas`), plus a one-bit `hiddenMask` marking their tiles. The brick
pattern is a function of the tile coordinates alone, so the sealed picture has
no seam anywhere for a player to read. Per frame:
1. blit the sealed level;
2. if the lens is lit, blit the reveal, clipped to the mask and then to a
   radial gradient centred on the hero (`LENS_ALPHA` out to `LENS_CORE`, down
   to 0 at `LENS_RADIUS`), with a faint cold tint over what is left;
3. draw the trail, the drag line, the loot and the monsters as usual;
4. blit the sealed level **again**, clipped to the mask with the same gradient
   subtracted out of it, so the brick lands back in front of everything with a
   soft hole where the hero is looking;
5. draw the hero, effects and buff pips over the top, and the mouth seams last.
Doing the brick as one veil rather than per-sprite is what keeps a monster
standing in a passage exactly as visible as the floor under it, and stops the
trail or a queued drag from tracing out a corridor the hero has not walked.
Steps 2 and 4 are skipped entirely when no hidden tile is in view, which is
almost every frame. The reveal eases in and out (`lensGlow`) so stepping into
a passage is a light coming up, not a switch. A mouth seam is drawn only while
the hero holds a lens, and fades out as the reveal opens the same tile.

# Sound and music (added later)

Shared types: `SfxId`, `VARIED_SFX`, `GameState.sfx`. See types.ts.

The engine never makes a sound; it names moments. `pushSfx(state, id)`
(combat.ts, beside `pushText`/`pushLog`) appends an `SfxId` to `state.sfx`, and
the audio layer drains that queue once a frame and clears it. The queue is
transient like `fx`: cleared on a level change, rebuilt empty on load, and left
out of `SaveData`. `pushSfx` caps it at 24 so a muted run never banks a
backlog.

`SfxId` is split in two, and the split is the design:
- The ids in `VARIED_SFX` (`step`, `swing`, `hit`, `kill`, `hurt`, `rise`,
  `fireball`, `zap`) fire constantly, so every play is nudged a few cents up or
  down. Never give one of these a melody: a tune heard a thousand times a run
  is a tune the player turns off.
- Everything else means exactly one thing (`chestOpen`, `levelUp`, `stairs`,
  `crystal`, `lens`, `lensBreak`, `bossWin`...) and must sound identical every
  time, so it can be learnt by ear.

Nothing in `src/audio/` may import from `src/ui/`, and only `rng.ts` and
`types.ts` come the other way. All of it is synthesised at runtime: there are
no audio files, the same way there are no image files.

## audio/synth.ts
```ts
export function midiToHz(midi: number): number;
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer;  // one second of white noise, cached per context
export function tone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOpts): void;   // one pitched note; `release` makes it a held pad instead of a pluck
export function noise(ctx: BaseAudioContext, dest: AudioNode, o: NoiseOpts): void; // one filtered noise burst
export function arpeggio(ctx: BaseAudioContext, dest: AudioNode, notes: number[], o): void; // a run of notes
export function reverbImpulse(ctx: BaseAudioContext, seconds?, decay?): AudioBuffer; // a room for a ConvolverNode, cached per context
```
Square/triangle/sawtooth oscillators, filtered white noise, short envelopes:
the palette of a 1980s sound chip and nothing else. Every voice is
fire-and-forget — it schedules itself against the AudioContext clock and stops;
nothing needs cleaning up.

## audio/sfx.ts
```ts
export function playSfx(ctx: BaseAudioContext, dest: AudioNode, id: SfxId, v: number): void;
```
One recipe per `SfxId`. `v` is the variation in [-1, 1]; fixed sounds ignore it.

## audio/music.ts
```ts
export type TrackId = 'nocturne' | 'undertow' | 'ember' | 'frost' | 'descent' | 'market' | 'dread';
export function trackForLevel(kind: 'maze' | 'shop' | 'boss', theme: string): TrackId;
export class MusicPlayer {
  constructor(ctx: AudioContext, dest: AudioNode);
  get current(): TrackId | null;
  play(id: TrackId | null): void;   // crossfades; null fades to silence
  dispose(): void;
}
```
**This is ambience, not a tune, and it must stay that way.** A crawl is played
in long stretches, so anything with a hook becomes an earworm and then the
reason someone mutes the game. Every track is a low drone, a chord that changes
every fifteen to twenty seconds, and at most a couple of long single notes a
bar — with about a third of bars holding none at all. Most of the signal goes
through a convolution reverb (`reverbImpulse`), so it reads as a large stone
room rather than a sound chip. Nothing runs faster than 64 bpm, nothing plays
anything shorter than a beat, and only `dread` and `ember` carry a pulse (one
low thud a bar, a heartbeat, never a drum kit). Adding sixteenth-note
arpeggios, a drum pattern, or a memorable melody line would undo the point.

No loops and no files: a track is a description (key, scale, tempo, chord
progression, how many notes a bar may hold) and the player fills it in bar by
bar. Chords cycle so the music has a shape; which notes land, and whether any
land, is decided as it goes, stepping between chord tones rather than leaping.
A whole bar is scheduled ~1.2s ahead on a 200ms interval, so a dropped frame
never stutters the music; a throttled background tab is detected by the
schedule falling behind and skipped forward rather than caught up. Boss floors
get `dread`, shops `market`, and each dungeon theme maps to one of the five
maze tracks (neighbouring themes never share one).

## audio/audio.ts
```ts
export class GameAudio {
  get enabled(): boolean;
  get sfxVolume(): number;           // the player's own trim on the effects bus, 0..1
  get musicVolume(): number;         // the player's own trim on the music bus, 0..1
  attach(): void;                    // listen for the first gesture and for the tab hiding
  setEnabled(on: boolean): void;     // persisted in localStorage, key "table-maze:sound"
  setSfxVolume(level: number): void;   // persisted in localStorage, key "table-maze:volume:sfx"
  setMusicVolume(level: number): void; // persisted in localStorage, key "table-maze:volume:music"
  update(state: GameState): void;    // drain state.sfx, keep the music on the right track
  dispose(): void;
}
```
`attach` tries to start the AudioContext right away, since some browsers allow
that with no gesture at all; where they don't, it is built on the first
pointer/key event instead, and suspended while the page is hidden. `update` runs once
a frame from `MazeCanvas`, right after `Game.tick`, and always clears the queue
— even with the sound off. It plays at most 5 sounds a frame, at most 2 of any
one kind, and enforces a minimum gap per sound, so chain lightning hitting four
monsters is one zap. Everything meets at a compressor before the destination.

The mix lives in one `MIX` const at the top of the file, and the numbers in it
were measured, not guessed. Two rules hold it together, and both are easy to
break by nudging a gain:
- **Everything is quiet.** The loudest sound in the game peaks around -24 dBFS,
  so a player's own volume control has somewhere useful to sit. This is a phone
  game played in long sittings, often near other people.
- **Music sits level with the effects**, comparing each one's level while it is
  actually sounding (a continuous bed against a 100ms blip is what an ear
  compares — not their averages over time). The ambience is meant to be heard
  rather than merely detected, and it is sparse enough that it never competes
  with an effect for attention.

Both busses are also set to stay under the compressor's threshold (0.126 at its
input). Effects reach it only when several pile up or a long jingle plays, which
is what it is for; the music must never reach it at all, or it ducks the effects
every time it swells. Its worst peak currently lands around 0.09, so there is
about 3 dB of room — raising `music` much past 0.18 would spend it.

`sfxVolume`/`musicVolume` are the player's own trim on each bus (`MIX.sfx *
sfxVolume`, `MIX.music * musicVolume`), 0..1 each, defaulting to 1 — they only
ever scale their bus down, never past the tuned mix, and move independently so
one can be turned down (or off) without touching the other. `setSfxVolume`/
`setMusicVolume` glide their bus's gain to the new value over 50ms so dragging
a slider never clicks. Both are independent of `enabled`/`setEnabled`: muting
via the speaker button still stops the band outright (see `setEnabled`'s
comment), while dragging either volume to 0 just leaves that bus silent
without touching the on/off preference. A legacy single `table-maze:volume`
key (from before the two sliders split apart) is read once as the starting
value for both if their own keys aren't set yet. `ui/VolumeModal.tsx` is the
one UI for this, opened by a long press on the speaker button (`ui/Hud.tsx`);
a plain tap on that button still toggles `enabled`, unaffected by the volume
UI.

## ui/Hud.tsx + ui/hudModel.ts (React; supersedes the old hud.ts class)
```ts
export class Hud {
  constructor(root: HTMLElement, actions: { onNewGame: () => void });
  update(state: GameState): void;   // cheap; called every frame, only touch DOM when values change
}
```
Shows: depth, hero level, hearts (with the ward's temporary ones on the end)
sharing their row with health potion pips (hearts get 2/3 of the row,
potions the other 1/3, right-justified — each wraps onto its own line rather
than crowding the other out; hidden entirely until `potionCapacity > 0`), XP
bar, seven stat readouts (attack, defense, spirit, gold, door keys, chest
keys, kills), the three gear slots, and the sound / help / new-game buttons.
Compact, fits below the maze on a phone in portrait.

Two rules hold this panel together:
- **Only controls look like controls.** The raised bevel
  (`inset 1px 1px 0 light, inset -2px -2px 0 dark` over a 3px border) belongs
  to the three buttons and nothing else. Badges and stat readouts are flat text
  on the panel; the XP track and the gear slots get a single hairline border
  and no bevel. A player should be able to see what is tappable without
  tapping it.
- **Nothing here is a second copy of something the maze already shows.** The
  running-shrine chips and the combat log both came out for that reason: the
  pips over the hero's head are the at-a-glance read on what is running, and
  the log lives on the help screen's Log tab, where it can keep a real history
  instead of three lines fading out. A conditional row also made the panel
  change height mid-run, which resizes the canvas above it and costs a frame.
  Every row in here is now unconditional.

# Magic items and shops (added later)

Shared types: `ItemSlot`, `ItemKind`, `ITEM_KINDS`, `ITEM_SLOT`, `MagicItem`,
`ShopOffer`, `Shop`, `LevelData.kind/shop`, `Hero.gear/shieldReady/timers`,
`Monster.poisonMs/poisonDmg/slowMs`, new `Effect` kinds (`bolt`, `projectile`,
`ring`, `slash`), `Modal` kind `'item'`, `GameState.compass`. See types.ts.

Rules:
- Three slots: offense, defense, spirit. One item per slot. Buying into a
  filled slot replaces the old item (its constant bonuses are removed first).
- Everything is passive. Controls never change.
- Every third maze floor is followed by a **shop level** (`kind: 'shop'`):
  after depth 3, 6, 9, ... The shop is generated with the depth just finished
  and its items have `level = that depth`. Leaving the shop by its stairs goes
  to the next maze depth. `state.depth` counts maze floors only.
- A shop has three podiums, one item per slot, prices scaling with depth. Each
  podium is a 2x2 block of solid tiles (like a chest) with its slot emblem on
  its face, the item floating above it and the price on a tag beneath.
- Walking into any tile of a podium opens `modal = {kind:'shopOffer', ...}`,
  which freezes the game and tells the player what the item is, what it does,
  what it costs and what it would replace. `Game.buyOffer(offerId)` spends the
  gold, equips the item and swaps the popup for `{kind:'item', ...}`;
  `Game.dismissModal()` walks away. Buying is refused (and the popup's buy
  button greys out) when the hero is short of gold or `shop.bought` is already
  true. After one purchase `shop.bought = true` and the other podiums go dark.
- No monsters, keys, doors or chests in a shop.

## engine/items.ts
```ts
export function itemName(kind: ItemKind): string;                          // "Long Sword"
export function itemStats(item: MagicItem): ItemStats;                     // every number an item needs, derived from kind + level
export function itemPrice(kind: ItemKind, level: number): number;          // gold
export function rollShopOffers(depth: number, rng: Rng, owned: Hero['gear']): MagicItem[]; // one per slot, avoid kinds already owned when possible
export function equip(hero: Hero, item: MagicItem): MagicItem | null;       // applies constant bonuses, removes the old item's, returns the replaced item
export function hasItem(hero: Hero, kind: ItemKind): MagicItem | null;
export function spiritSlotBonus(level: number): number;                    // spirit every spirit-slot item carries: 1 + floor(level/3)
```
`ItemStats` is a flat bag: `{ atkBonus, defBonus, spiritBonus, maxHpBonus, reach, fireIntervalMs, fireDmg, fireRange, chainChance, chainTargets, chainDmg, poisonMs, poisonDmg, slowMs, berserkAtk, shieldRechargeMs, moveMs, thornDmg, phoenixCooldownMs, regenMult, knockbackImmune, goldMult, xpMult, lifePulseMs, compass, vampKillHeal, vampHitChance, baneRadius, baneSlowMult, baneSightPenalty }` with zero/1/false for anything the item doesn't do.

`spiritBonus` is the one field not set per kind: EVERY spirit-slot item carries
`spiritSlotBonus(level)`, whatever else it does, so the slot always means
"shrines go further" and the choice of item only decides what else you get.
`equip` and `upgradeRandomItem` move `hero.spirit` by it exactly as they move
`atk` and `def`, and `reviveGear` rebuilds the stat from
`spiritForLevel(hero.level) + itemStats(worn).spiritBonus` when a save predates
it — the stat is fully re-derivable, so no `SAVE_VERSION` bump was needed.

## engine/shrines.ts
```ts
export const SHRINE_COLORS: Record<ShrineKind, string>;      // one colour per kind, used by map, pips and HUD alike
export function shrineName(kind: ShrineKind): string;        // "Stone Skin"
export function shrineDurationMs(kind: ShrineKind, spirit?: number): number;  // 0 for 'ward' (spent, not timed)
export function shrineDescription(kind: ShrineKind, level: number): string;   // what it does, with the real numbers — never how long
export function heartsLabel(hp: number): string;             // quarter-hearts as words, for the help screen
export function spiritMult(spirit: number): number;          // 1 + SPIRIT_PER_POINT * spirit, capped at SPIRIT_MAX_MULT
export const SPIRIT_PER_POINT: number;  // 0.1
export const SPIRIT_MAX_MULT: number;   // 2
export function makeBuff(kind: TimedShrineKind, level: number, spirit?: number): Buff;
export function addBuff(hero: Hero, kind: TimedShrineKind, level: number): Buff; // refreshes rather than stacking
export function findBuff(hero: Hero, kind: TimedShrineKind): Buff | null;
export function buffAtk(hero: Hero): number;                 // fury
export function buffDef(hero: Hero): number;                 // stone skin
export function timeBubble(hero: Hero): { radius: number; mult: number } | null;
export function buffPhase(ms: number): 'solid' | 'warn' | 'urgent';
export const BLINK_MS: Record<BuffPhase, number>;            // 0 / 560 / 240
export const BUFF_WARN_MS: number;   // 10000
export const BUFF_URGENT_MS: number; // 5000
export const FROST_RANGE: number;    // 6 BFS tiles
export const FREEZE_MS: number;      // 2200
export const TIME_RADIUS: number;    // 6 tiles
export const TIME_SLOW_MULT: number; // 2.5
export function wardTempHp(level: number, spirit?: number): number;
export function furyAtk(level: number): number;
export function stoneDef(level: number): number;
export function frostIntervalMs(level: number): number;
export function frostDmg(level: number): number;
export function mendPulseMs(level: number): number;
export function reviveBuffs(hero: Hero): void;   // fills in tempHp/tempHpMax/buffs on a loaded hero
```
A shrine is a one-shot magic item that lives on the floor instead of in a
slot. Every number is derived from `Shrine.level` (the depth the floor was
generated at), exactly as an item's numbers come from the depth it was bought
at. Depends only on `types.ts`, so `combat.ts`, `monsters.ts` and `game.ts` can
all import it without a cycle.

`Hero.spirit` stretches every gift, and takes its cut in whichever currency
that shrine has: the five timed kinds last `spiritMult(spirit)` times longer,
and the ward, which has no clock, hands out that many more hearts. Never both
for one shrine, so nothing is made longer *and* stronger at once. Spirit is
baked into `Buff.totalMs` when the shrine is lit, not read each tick, so
levelling up mid-effect never moves the bar the player is watching.

Five of the six kinds are `Buff`s on `hero.buffs` that count `ms` down to zero
and are then dropped. The sixth, `ward`, is not timed: it is `hero.tempHp` (with
`hero.tempHpMax` for the HUD bar), a pool of temporary quarter-hearts that every
hit spends before the hero's own, and which nothing ever refills. Lighting the
same shrine kind twice refreshes rather than stacking.

## engine/shop.ts
```ts
export const SHOP_WIDTH: number;   // 16
export const SHOP_HEIGHT: number;  // 15
export const PEDESTAL_SIZE: number;             // 2 — podiums are 2x2 tiles
export const PEDESTAL_TILES: readonly Vec[];    // top-left tile of each podium
export function generateShopLevel(depth: number, runSeed: number, hero: Hero): LevelData;  // kind 'shop', one room, 3 podiums, start at the bottom, exit at the top
export function offerCovers(offer: ShopOffer, p: Vec): boolean;  // is `p` one of the podium's four tiles?
export function offerTiles(offer: ShopOffer): Vec[];             // the four tiles it stands on
export function offerCenter(offer: ShopOffer): Vec;              // middle of the block, fractional tiles
export function offerAt(level: LevelData, p: Vec): ShopOffer | null;
```
Layout: 16 wide x 15 tall tiles, walls around a 14x13 room, start bottom-centre
(7, 13), exit top-centre (7, 1). Podiums are 2x2 blocks with their top-left at
(3, 5), (7, 5), (11, 5) — offense / defense / spirit left to right, two clear
tiles between neighbours so the hero can walk between them. All four tiles of a
podium are solid; walking into any of them opens the offer popup.

## render/itemArt.ts (shared pixel art; both canvas and DOM use it)
```ts
export const ITEM_ART: Record<ItemKind, { rows: string[]; palette: Record<string, string> }>; // 8x8 each
export const SLOT_ART: Record<ItemSlot, { rows: string[]; palette: Record<string, string> }>; // small slot glyphs (sword / shield / star)
export const PEDESTAL_ART: { rows: string[]; palette: Record<string, string> };  // 8x8 column, used by the purchase popup
export const PODIUM_ART: { rows: string[]; palette: Record<string, string> };    // 16x16 map podium, 2x2 tiles, with a niche for the slot emblem
export const SHRINE_ART: Record<ShrineKind, { rows: string[]; palette: Record<string, string> }>; // 8x8 each
export const ALCOVE_ART: { rows: string[]; palette: Record<string, string> };   // 16x16 stone arch, one tile, with a niche for the shrine glyph
export const ALCOVE_NICHE: { x: number; y: number; size: number };              // where the glyph goes inside ALCOVE_ART
export const PODIUM_NICHE: { x: number; y: number; size: number };               // where the emblem goes, as fractions of the block
```

# Boss encounters (added later)

Shared types: `RosterKind` (the three maze roles) vs `BossMonsterKind`
(`minion | crystal | boss | minotaur | angel`); `MonsterKind` is the union.
`MonsterState` is `idle | chasing | returning | closing`; `closing` is the
angels' own (the ring has shut, see angels.ts).
`Monster.invulnerable`, `Monster.roomId`, `LevelData.kind: 'boss'`,
`LevelData.boss: BossData` (a union keyed on `BossKind`), `Rect`, `inRect`,
`BOSS_HIT_FRACTION`, `Modal` kinds `bossIntro | bossWon | gameOver`,
`RunStats`, `GameState.over`, `stats.bosses`, `stats.bossRetries`,
`bossRetryCost` (balance.ts), `Game.retryBoss()`. See types.ts.

## Level flow
Maze depth 1, 2, 3 -> **boss (depth 3)** -> shop (depth 3) -> maze 4, 5, 6 ->
boss (6) -> shop (6) -> ... `state.depth` still counts maze floors only. The
boss for a depth comes from `bossKindForDepth(depth, runSeed)`: every block of
three bosses contains each kind once, seed-shuffled.

Those three maze floors plus their boss and shop are one **themed set**
(`floorSet` in lens.ts, the same grouping `themeForDepth` uses), and the Lens
of Truth is scoped to it: found in a chest on the first or second floor, useful
on all three, and shattered on the way out of the set's shop. Stepping onto the
shop's stairs with a lens in hand sets `modal = { kind:'lensShatter' }` next to
the usual descend timer — the popup freezes the world, so the stairs wait —
and `dismissModal` drops the lens and lets the descent finish. It is the one
popup with no button: the UI closes it when the animation ends.

## engine/boss.ts (generation + factory; the per-tick rules live in game.ts)
```ts
export const BOSS_SALT: number;
export const BOSS_EVERY: number; // 3
export function bossName(kind: BossKind): string;                       // "The Necromancer"
export function bossKindForDepth(depth: number, runSeed: number): BossKind;
export function roomAt(rooms: readonly Rect[], p: Vec): number;        // index or -1
export function makeBossMonster(kind: BossMonsterKind, depth: number, pos: Vec, id: string): Monster; // no rng
export function generateBossLevel(depth: number, runSeed: number): LevelData; // kind 'boss', boss set
```
Layout requirements (odd dims, solid outer wall, portrait or square, no keys /
doors / chests, deterministic for (depth, runSeed)):
- **necromancer**: a large central chamber (about 7x7 to 9x9 of open floor)
  with the `boss` monster ("Necromancer", invulnerable) on the exact centre
  tile, which is also `level.exit` (hidden and blocked by him until he flees).
  Five winding 1-wide corridors leave the chamber from five different points
  on its edge and each ends in a dead end holding one `crystal` monster.
  Corridors never touch each other or the chamber except at their own mouth
  (so every crystal is a real trip). Each corridor is 20-40 tiles long with
  several turns (the slab is about 39-43 tiles square to fit them). `start` is a chamber-edge tile, at least 2 tiles from the
  necromancer. `boss = { kind:'necromancer', defeated:false, spellMs, spellTotalMs,
  spawnMs, spawnEveryMs, maxMinions, crystalsTotal: 5 }`. Suggested numbers:
  spellTotalMs = 120000 + 3000·depth, spawnEveryMs = 3000, first spawnMs = 2500,
  maxMinions = 5. Monster ids: `necro`, `crystal1..5`.
- **minotaur**: a braided maze (open ~35% of dead ends so there are many
  loops) of roughly levelDims(depth) capped around 31x41, with 3-5 open
  chambers (3x3 to 5x5) carved into it. `start` in one corner region, `exit`
  among the BFS-farthest tiles from start, the single `minotaur` monster
  (id `minotaur`) placed at least 12 BFS tiles from start, roughly between
  start and exit. `boss = { kind:'minotaur', defeated:false }`.
- **angels**: a grid of rooms sized by `angelPlan(depth)` (balance.ts) — its
  `cols` x `rows`, in a level of exactly its `width` x `height`, each room 4x4
  to 7x6 of floor — joined by winding 1-wide corridors between neighbouring
  rooms so the whole level is connected with loops (every room has at least
  two corridors where possible). `boss.rooms` lists every room rectangle
  (floor only). `start` in a room in the top row, `exit` in a room in the
  bottom row far from start. `plan.minAngels`..`plan.maxAngels` `angel`
  monsters (ids `angel1..n`), each inside a room with `roomId` set to that
  room's index, never in the start room, never in the exit room, at most one
  per room, at least 8 BFS tiles from start. Rooms are filled in this order:
  the ones the shortest start->exit walk passes through first (a bigger floor
  has to be a busier walk, and the grid's loops are the way round), then the
  rest one row at a time, top to bottom, before any row takes a second statue.
  `boss = { kind:'angels', defeated:false, rooms }`.
- Every level: `bfsPath(start, exit)` exists once the blocking monsters are
  ignored, every monster on a unique floor tile, no monster within 2 tiles of
  start, `level.theme = themeForDepth(depth).id`.

## Per-tick rules (game.ts)
- Entering a boss level sets `modal = { kind:'bossIntro', boss }`; nothing
  runs until it is dismissed. Reloading a save mid-boss shows it again.
- **necromancer**: while not defeated, `spellMs -= dt`; at 0 -> game over
  ("The Necromancer finished his spell."). `spawnMs -= dt`; at 0 and fewer
  than `maxMinions` live minions, a `minion` rises on a free floor tile next
  to the necromancer (4-neighbours first, then diagonals; skip if none free),
  `spawnMs = spawnEveryMs`. When every `crystal` is dead: `defeated = true`,
  the necromancer's `alive = false` (he flees: ring + text), every live minion
  crumbles (`alive = false`), `level.exit` = his tile, reward + `bossWon` modal.
- **minotaur / angels**: stepping on `exit` while not defeated -> `defeated =
  true`, reward + `bossWon` modal, then the normal descent.
- **angels**: each tick, `roomAt(rooms, hero.pos)`; every idle angel whose
  `roomId` equals it wakes (`state = 'chasing'`, never goes back to idle).
  Angels have no lock-step with the hero at all: while at least one is awake,
  a step clock (`angelTimer += dt`, in `tickBoss`) calls `angelsAct(state,
  rng)` (angels.ts) once every `angelPlan(level.depth).stepMs` (600 on the
  first angel floors, 510 on the deepest), and every awake angel acts in that
  one call. Hero steps neither hurry the clock nor reset it; it
  resets to 0 while every angel is idle. At most 4 steps per tick, then the
  remainder is dropped (a hidden tab is not a massacre). `updateMonsters`
  itself does nothing for angels.
- Reward: `upgradeRandomItem(hero, rng)` (items.ts): pick one of the filled
  gear slots at random, bump `level` by one and re-apply its constant bonuses
  (same maths as `equip`, timers untouched). Returns the item, or null when
  the hero wears nothing, in which case the hero gains one heart (`maxHp +=
  HEART`, `hp += HEART`). On any boss win the hero is healed to full and
  `stats.bosses += 1`.
- Game over: `gameOver(state, cause)` in combat.ts sets `state.over = true`,
  clears the path, and sets
  `modal = { kind:'gameOver', cause, boss, stats, retryCost }` with a
  `RunStats` snapshot (`stats.retries` = `state.stats.bossRetries` at that
  moment). In a boss level a knockdown (hp <= 0 after the phoenix feather has
  had its chance) is a game over instead of a sleep: minotaur -> "The
  Minotaur caught you.", angel -> "You were turned to stone.", anything else
  -> "The skeletons wore you down." `Game.dismissModal()` on a `gameOver`
  modal starts a new run. `saveGame` clears the save instead of writing when
  `state.over`; `loadGame` returns null for an `over` save.
- Boss retry: `retryCost = bossRetryCost(state.depth, state.stats.bossRetries)`
  (balance.ts) — pricier the deeper the run, and pricier again for every
  retry already bought this run, anywhere, so it never becomes a free
  checkpoint. `Game.retryBoss()` is the only way to spend it: no-ops off any
  modal but `gameOver`, or when `hero.gold < retryCost` (the modal's own
  button is already greyed out then, this is belt and braces). On success:
  gold spent, `stats.bossRetries += 1`, `state.over = false`, the same
  `depth`'s boss chamber is regenerated from scratch via `generateBossLevel`
  (fresh crystals/necromancer/minotaur/angels — never the stale, partly-dead
  monsters from the lost attempt) and entered exactly like arriving at a
  fresh level: hero moved to its start, healed to full (unlike the half-heal
  an ordinary floor transition gives), keys/potions/trail/fx/path/pointer/
  compass reset, this tick's rng reseeded off a salt that folds in the new
  retry count (so it does not replay the same random events as the attempt
  it is repeating), and `modal = { kind:'bossIntro', boss }` — the player
  reads the briefing again before anything runs, same as any other arrival.
  `advanceLevel` and `retryBoss` share this reset via a private
  `resetToLevel(level, salt, healFraction)` on `Game`.
- Boss hits: a `minotaur` or `angel` attack takes
  `ceil(hero.maxHp * BOSS_HIT_FRACTION)` hp, ignoring defense. The shield
  amulet still eats it. Knockback as for any non-patrol monster.
- `damageMonster` on an `invulnerable` monster does nothing but a grey
  "Immune" text; no on-hit procs, no combat clocks.
- Crystals grant their xp on death but never attack or move.

## Shrines (game.ts, combat.ts, monsters.ts)
- `onEnter` calls `shrineAt(level, tile)`; an unlit shrine there is lit at
  once: `used = true`, the gift is applied, a ring + flash + name text in the
  shrine's colour, a log line and the `shrine` sound. Shrines are floor, never
  solid: `isWalkable` and `heroCanStand` ignore them entirely.
- `tickBuffs(dt)` runs beside `passives(dt)` — so never under a modal and never
  mid-descent. Every buff's `ms` drops by `dt` and buffs at 0 are dropped at the
  end of the tick. Nothing fires while the hero sleeps.
  - **frost**: `timer += dt`; at `frostIntervalMs(level)` cast an ice ball at
    the nearest live, non-invulnerable monster within `FROST_RANGE` BFS tiles
    (closed doors block, same reach test as the fire staff): a projectile, a
    delayed flash + ring, `frostDmg(level)` damage, and
    `frozenMs = max(frozenMs, FREEZE_MS)`. With nothing in range the charge is
    held rather than spent.
  - **mend**: a quarter heart every `mendPulseMs(level)`, in combat and out.
  - **time**: a `TIME_RADIUS` ring pulse every 900ms; the slow itself lives in
    `cooldownFor` (monsters.ts), which multiplies a monster's cooldown by
    `TIME_SLOW_MULT` while it is within `TIME_RADIUS` of the hero.
  - **fury / stone**: no clock of their own. `heroAttackValue` adds
    `buffAtk(hero)`; `monsterAttack` rolls damage against
    `hero.def + buffDef(hero)`.
- `Monster.frozenMs` is a full stop, not the frost blade's half speed: while it
  is above 0 the monster takes no step and makes no swing (`updateMonsters`
  `continue`s past it, `angelsAct` skips its act). Its thaw clock, poison and
  regen all keep running, so a frozen monster can still be finished off.
- Ward: `monsterAttack` spends `hero.tempHp` before `hero.hp`, with a blue ring
  per hit and a bigger ring + the `wardBreak` sound on the one that empties it
  (`tempHpMax` is zeroed with it). The floating damage number turns ward-blue
  whenever the ward soaked any of it.
- A knockdown clears `hero.buffs` and both `tempHp` fields, alongside healing
  every monster. The phoenix feather's burst-back-up keeps them, and so does a
  health potion.
- Health potions (`Hero.potions`/`potionCapacity`): found in chests only (see
  `rollChestLoot`), never bought. `knockDown` (combat.ts) checks the phoenix
  feather first (a free, cooldown-gated save); only when that is unworn or
  still cooling down does it spend one potion charge for the same
  burst-back-up (shared by `burstBackUp`: half max hp rounded up to a whole
  heart, a gold ring, a floating "Potion!" over the hero's head, the `potion`
  sound, a retreat to a safe tile, hero stays awake — the feather's own burst
  skips the floating text). Works in a boss chamber exactly like the feather
  does. `advanceLevel`
  refills `potions` to `potionCapacity` at the start of every level (maze,
  boss or shop) but never raises the cap — only a chest does that.
- Buffs and temporary hearts survive the stairs: `advanceLevel` does not touch
  them, so a shrine taken near the way down carries into the next floor (or a
  boss chamber). Shrines themselves only exist on maze floors.

## Movement AI (monsters.ts)
- `minion`: `chasing` from birth; BFS toward the hero with no distance limit
  (normal `moveBlocked`), attack when adjacent. Never returns/idles.
- `minotaur`: same as minion, never stops. Attack when adjacent.
- `angel`: skipped entirely by `updateMonsters` (no cooldowns of its own).
  The siege lives in **angels.ts** (`angelsAct`, one call per step clock,
  all awake angels acting together, `idle` ones never). Every call first asks
  whether the hero is boxed in and sets every awake angel's `state` to
  `closing` or back to `chasing`:
  - **boxed in** (`boxedIn`): flood-fill from the hero over floor, awake
    angels counting as walls, stopping at `ANGEL_TRAP_AREA` (200) tiles.
    Reaching any tile outside the hero's own space — the room from
    `roomAt(rooms, hero.pos)`, or the whole run of corridor when that is -1 —
    means there is still a way out. Sealed only counts when at least one
    angel (not just wall) is on the pocket's edge.
  - **hysteresis**: once `closing`, they stay `closing` until the hero is
    more than `ANGEL_BREAK` (7) tiles from every one of them (`brokeAway`),
    so the first step of the kill re-opening a doorway does not send them
    straight back to it.
  - `closing`: attack when within `ANGEL_REACH` (1), else one BFS step toward
    the hero, no distance limit.
  - `chasing` (siege): the mouths of the hero's room (`doorsOf`: floor tiles
    just outside the rect that touch it) are handed out closest-pair-first,
    one angel per door, over BFS distances that treat other monsters, the
    hero and the stairs as blocked. An angel on its door holds it. Otherwise
    it steps toward it, never onto a tile within `ANGEL_REACH` of the hero
    (so a hero standing in a doorway keeps it open). Angels with no door left
    — and every angel while the hero is out in the corridors — close to
    `ANGEL_RING` (3) tiles and wait there. Nobody attacks in this state at
    all. Stops early once `state.over`; frozen angels skip their act but
    still count as walls.
- `crystal`, `boss`: never move, never attack.
- Nothing about sleeping heroes matters here (no sleeping in boss levels).

## Renderer
- Hero has four facing sprites (N back view, S front, E side, W = E flipped),
  chosen from `hero.facing`, which only changes when the hero steps or swings.
- Boss monsters have their own 8x8 sprites keyed by name: `necromancer`,
  `crystal`, `minotaur`, `angel` (plus the existing `skeleton`). Crystals draw
  with no ring and no level badge, just an hp bar when hurt. The necromancer
  gets a pulsing purple channelling ring. Angels: idle = weeping pose with a
  dim grey ring, chasing = red pulsing ring. Minotaur: red pulsing ring, slightly bigger sprite.
- Shrine alcoves: `ALCOVE_ART` at `ALCOVE_SCALE` of a tile — deliberately under
  full size, so a rim of floor shows all round and a shrine standing in a
  corridor never reads as a wall plugging it — with the kind's `SHRINE_ART`
  glyph in the niche. Unlit = a breathing colour wash behind the stone, a
  brightening glyph and a slow square aura. Spent = the same stonework at
  `SHRINE_SPENT_ALPHA` with no glow at all, so "already taken" reads from
  across the room. Drawn before chests and monsters: an alcove is ground.
- Shrine timers: a row of pips over the hero's head (above the compass arrow),
  one per running buff plus one for the ward's temporary hearts, drawn last of
  everything in camera space so an alcove the hero is standing beside never
  covers them. Each pip is the kind's glyph on a dark plate with a coloured
  border. No numbers: solid while `buffPhase` is `solid`, blinking on
  `BLINK_MS[phase]` otherwise, and the plate stays near-opaque through the
  blink so a pip is always countable.
- Frozen monsters (`frozenMs > 0`): a hard pale ice box over the sprite with a
  bright rim and two drifting glints — deliberately unlike the frost blade's
  soft blue tint, because one means "slowed" and the other means "stopped".
- Necromancer spell clock: a screen-space bar across the top of the viewport
  (purple, shrinking with `spellMs / spellTotalMs`, seconds left as text),
  hidden once defeated. The exit is not drawn while the necromancer stands on it.

## UI
- The heart row carries the ward's temporary hearts in blue on the end
  (`Hearts` takes `tempHp` / `tempHpMax`); they empty as hits land and the row
  is shorter again once they are gone.
- Nothing about a running effect reaches the HUD. The pips over the hero are
  the at-a-glance read; the detail is a tab away.
- `HudModel.atk` / `def` include the shrine bonus, and `atkBuffed` / `defBuffed`
  light that stat tile gold so the player can see why the number moved. Spirit
  is a seventh stat tile, beside attack and defense, using the spirit slot's
  own star glyph.
- The help screen is three tabs: **Hero** (gear slots, then the effects
  running), **Log** (the run history, newest first), **How to play**. The tabs
  themselves are flat with an underline on the active one — the same rule as
  the HUD, so the raised X and OK are the only things on screen that look
  pressable.
- Its "Running now" section lists ONLY the effects the hero has
  going, each with its time left in words (`HudBuff.secondsLeft`), or for the
  ward the hearts it has left (`heartsLabel`). It is the one surface that puts
  a shrine clock into numbers: the game is paused behind it and the player has
  come looking for detail, where the HUD chip and the pip over the hero are
  read mid-fight and stay wordless. For the same reason `shrineDescription`
  says what an effect does but never how long it lasts — that would be two
  clocks for one effect. With nothing running the section explains what
  alcoves are and names the hero's spirit.
- `bossIntro`, `bossWon`, `gameOver` are button-dismissed modals (the backdrop
  never closes them). `gameOver` shows the cause and `RunStats`, a "Retry
  this fight" button priced at `retryCost` gold (greyed out and a "Not enough
  gold" line when the purse is short — calls `Game.retryBoss()`) above the
  "New Game" button (`Game.dismissModal()`, always enabled: no confirm, there
  is nothing left to lose by starting over). HUD depth badge reads BOSS on
  boss levels.
