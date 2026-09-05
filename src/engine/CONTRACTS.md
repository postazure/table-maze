# Module contracts

Layout: `src/engine/` (pure logic, no DOM), `src/render/` (canvas renderer + pointer input), `src/ui/` (React components and hooks), `src/styles/` (global CSS), `test/` (engine tests).

All shared types live in `src/types.ts`. Each module below must export exactly
the listed API (extra internal helpers are fine). Modules only import from
`./types` and from the modules listed under "depends on".

Rules for everyone:
- Vanilla TypeScript, no runtime dependencies, strict mode, must pass `tsc --noEmit`.
- No DOM access in `src/engine/` except `save.ts` (localStorage). DOM lives in `src/render/` and `src/ui/`.
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
export function levelDims(depth: number): { width: number; height: number }; // odd tile counts, portrait (height > width). depth 1 ≈ 21x31 (bigger than a phone screen; the renderer scrolls), grows to a cap ≈ 41x61.
export function newHero(): Hero;                     // level 1 starting stats
export function xpForLevel(level: number): number;   // xp needed to go from `level` to `level+1`
export function applyLevelUp(hero: Hero): void;      // called when hero.xp >= hero.xpToNext; bumps stats, restores hp, sets new xpToNext (may loop if enough xp for multiple levels)
export function makeMonster(kind: MonsterKind, depth: number, rng: Rng, pos: Vec, id: string, opts?: MonsterOpts): Monster; // stats scale with depth; picks name/glyph from a themed table. `opts.gate` = the player has no way around this one: it sits at the floor's own level and takes neither the role lift nor the elite roll.
export function rollChestLoot(depth: number, rng: Rng): Loot;
export function trinketGold(depth: number): number;  // coins a duplicate chest trinket melts down for
export function xpShare(heroLevel: number, monsterLevel: number): number; // share of a kill's xp banked, from the level difference: >1 when the hero is behind (capped at 3), <1 when ahead (floored at 0.05). Gold is never scaled.
export function damage(attackerAtk: number, defenderDef: number, rng: Rng): number; // >= 1
```

## maze.ts
```ts
export function generateLevel(depth: number, runSeed: number): LevelData;
/** The guards the player has no way around: the cheapest start->exit route, counting one per guard walked through. */
export function gateGuards(level: LevelData): Monster[];
export const ROUTE_MONSTER_CAP: number;      // most monsters the route and its branches carry
export const WARREN_MONSTER_CAP: number;     // ...per warren, on top of that
export const WARREN_MONSTER_BUDGET: number;  // ...and across all of a floor's warrens
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
- Warrens. After the route is known, flood-fill the floor with the route
  treated as a wall and braid the bigger pockets that fall out (>= 6 tiles) so
  they loop back on themselves. A pocket only becomes a warren if it touches
  the rest of the maze at exactly one point — that tile is its `mouth`. Only
  open a wall when every floor tile it touches is already inside that pocket,
  which is what stops a warren gaining a second junction and turning into a way
  past a gate guard. Record them in `LevelData.warrens`; blocking every warren
  tile must always leave the stairs reachable. Stock them with guards and
  patrols (and the odd lurker) on top of the route's own budget, and keep the
  route's monsters out of them. The renderer draws the mouth as a hole knocked
  through the wall (broken blocks either side, rubble on the floor both sides
  of the threshold); nothing in the UI names them.
- No unwinnable gate. Guards never move and heal back to full between attempts,
  so a guard on the only way to the stairs must be beatable or the run is dead.
  After placing monsters, re-roll every guard `gateGuards` reports at the
  floor's own level (`makeMonster(..., { gate: true })`), and reject any level
  where one still sits above it. Floor 1 carries no lurkers.
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
chests, the exit. Monsters heal 1 hp every ~1.5s once out of combat for 4s. They attack when 4-adjacent to the hero and attackCooldown <= 0.
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

## ui/Hud.tsx + ui/hudModel.ts (React; supersedes the old hud.ts class)
```ts
export class Hud {
  constructor(root: HTMLElement, actions: { onNewGame: () => void });
  update(state: GameState): void;   // cheap; called every frame, only touch DOM when values change
}
```
Shows: depth, hero level, HP bar, XP bar, ATK/DEF, gold, key counts (door/chest
with the two icons), kills/chests, last 3 log messages, a "New game" button
(with confirm). Compact, fits below the maze on a phone in portrait.

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
```
`ItemStats` is a flat bag: `{ atkBonus, defBonus, maxHpBonus, reach, fireIntervalMs, fireDmg, fireRange, chainChance, chainTargets, chainDmg, poisonMs, poisonDmg, slowMs, berserkAtk, shieldRechargeMs, moveMs, thornDmg, phoenixCooldownMs, regenMult, knockbackImmune, goldMult, xpMult, lifePulseMs, compass, vampKillHeal, vampHitChance, baneRadius, baneSlowMult, baneSightPenalty }` with zero/1/false for anything the item doesn't do.

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
export const PODIUM_NICHE: { x: number; y: number; size: number };               // where the emblem goes, as fractions of the block
```

# Boss encounters (added later)

Shared types: `RosterKind` (the three maze roles) vs `BossMonsterKind`
(`minion | crystal | boss | minotaur | angel`); `MonsterKind` is the union.
`Monster.invulnerable`, `Monster.roomId`, `LevelData.kind: 'boss'`,
`LevelData.boss: BossData` (a union keyed on `BossKind`), `Rect`, `inRect`,
`BOSS_HIT_FRACTION`, `Modal` kinds `bossIntro | bossWon | gameOver`,
`RunStats`, `GameState.over`, `stats.bosses`. See types.ts.

## Level flow
Maze depth 1, 2, 3 -> **boss (depth 3)** -> shop (depth 3) -> maze 4, 5, 6 ->
boss (6) -> shop (6) -> ... `state.depth` still counts maze floors only. The
boss for a depth comes from `bossKindForDepth(depth, runSeed)`: every block of
three bosses contains each kind once, seed-shuffled.

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
  maxMinions = 12. Monster ids: `necro`, `crystal1..5`.
- **minotaur**: a braided maze (open ~35% of dead ends so there are many
  loops) of roughly levelDims(depth) capped around 31x41, with 3-5 open
  chambers (3x3 to 5x5) carved into it. `start` in one corner region, `exit`
  among the BFS-farthest tiles from start, the single `minotaur` monster
  (id `minotaur`) placed at least 12 BFS tiles from start, roughly between
  start and exit. `boss = { kind:'minotaur', defeated:false }`.
- **angels**: a grid of rooms (3 columns x 4 rows, each room 4x4 to 7x6 of
  floor, in a level around 29x41) joined by winding 1-wide corridors between
  neighbouring rooms so the whole level is connected with loops (every room
  has at least two corridors where possible). `boss.rooms` lists every room
  rectangle (floor only). `start` in a room in the top row, `exit` in a room
  in the bottom row far from start. 4-6 `angel` monsters (ids `angel1..n`),
  each inside a room with `roomId` set to that room's index, never in the
  start room, never in the exit room, at most one per room, at least 8 BFS
  tiles from start. `boss = { kind:'angels', defeated:false, rooms }`.
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
  Angels move in lock-step with the hero: right after every step the hero
  actually takes (a real tile change from `stepOnce`, not a knockback shove)
  `angelsFollow(state, rng)` runs once, before the wake check, so an angel
  woken by that step does not move until the next one. On top of that, while
  any angel is `chasing`, a creep clock (`creepTimer += dt`, in `tickBoss`)
  calls `angelsFollow` once every `ANGEL_CREEP_MS` (2200) whether or not the
  hero moved; hero steps do not reset it, and it resets to 0 while every
  angel is idle. At most 4 creep steps per tick, then the remainder is
  dropped (a hidden tab is not a massacre). `updateMonsters` itself does
  nothing for angels.
- Reward: `upgradeRandomItem(hero, rng)` (items.ts): pick one of the filled
  gear slots at random, bump `level` by one and re-apply its constant bonuses
  (same maths as `equip`, timers untouched). Returns the item, or null when
  the hero wears nothing, in which case the hero gains one heart (`maxHp +=
  HEART`, `hp += HEART`). On any boss win the hero is healed to full and
  `stats.bosses += 1`.
- Game over: `gameOver(state, cause)` in combat.ts sets `state.over = true`,
  clears the path, and sets `modal = { kind:'gameOver', cause, boss, stats }`
  with a `RunStats` snapshot. In a boss level a knockdown (hp <= 0 after the
  phoenix feather has had its chance) is a game over instead of a sleep:
  minotaur -> "The Minotaur caught you.", angel -> "You were turned to stone.",
  anything else -> "The skeletons wore you down." `Game.dismissModal()` on a
  `gameOver` modal starts a new run. `saveGame` clears the save instead of
  writing when `state.over`; `loadGame` returns null for an `over` save.
- Boss hits: a `minotaur` or `angel` attack takes
  `ceil(hero.maxHp * BOSS_HIT_FRACTION)` hp, ignoring defense. The shield
  amulet still eats it. Knockback as for any non-patrol monster.
- `damageMonster` on an `invulnerable` monster does nothing but a grey
  "Immune" text; no on-hit procs, no combat clocks.
- Crystals grant their xp on death but never attack or move.

## Movement AI (monsters.ts)
- `minion`: `chasing` from birth; BFS toward the hero with no distance limit
  (normal `moveBlocked`), attack when adjacent. Never returns/idles.
- `minotaur`: same as minion, never stops. Attack when adjacent.
- `angel`: skipped entirely by `updateMonsters` (no cooldowns of its own).
  `angelsFollow`, once per hero step and once per creep tick: idle =
  nothing. `chasing`: if adjacent
  to the hero (manhattan 1) it attacks; otherwise one BFS step toward the
  hero with no limit (normal `moveBlocked`). So an adjacent angel only lands
  a touch when the hero's step keeps them within reach, or when the hero
  lingers beside it until the next creep; stepping away means it merely
  follows. Stops early once `state.over`.
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
- Necromancer spell clock: a screen-space bar across the top of the viewport
  (purple, shrinking with `spellMs / spellTotalMs`, seconds left as text),
  hidden once defeated. The exit is not drawn while the necromancer stands on it.

## UI
- `bossIntro`, `bossWon`, `gameOver` are button-dismissed modals (the backdrop
  never closes them). `gameOver` shows the cause and `RunStats`, button
  "New Game". HUD depth badge reads BOSS on boss levels.
