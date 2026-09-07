import test from 'node:test';
import assert from 'node:assert/strict';

import { Tile, eq, key, manhattan } from '../src/engine/types';
import type { GameState, LevelData, Monster, Prop, SfxId, Vec, WorldData } from '../src/engine/types';
import { newHero } from '../src/engine/balance';
import { bfsDistances, bfsPath, floorNeighbors, isFloor } from '../src/engine/pathfind';
import { makeRng } from '../src/engine/rng';
import { CEMETERY } from '../src/engine/worlds/cemetery';
import type { WorldCtx } from '../src/engine/worlds/world';

const SEEDS = [1, 2, 3, 42, 999];

// ---------------------------------------------------------------------------
// A fake WorldCtx: a real level + hero, plus recorders for every call the
// module might make, so a test can both drive the module and inspect what it
// asked the engine to do.
// ---------------------------------------------------------------------------

interface FakeCtx extends WorldCtx {
  calls: {
    goto: number[];
    finish: number;
    returnHome: number;
    gameOver: string[];
    freeze: { ms: number; shake?: number }[];
    rebuild: number;
    logs: string[];
    sfx: SfxId[];
  };
}

function fakeCtx(level: LevelData, heroLevel = 1): FakeCtx {
  const hero = newHero();
  hero.level = heroLevel;
  hero.pos = { ...level.start };
  hero.rpos = { ...level.start };
  const state = {
    version: 9,
    depth: 1,
    seed: 1,
    hero,
    level,
    trail: new Set<string>(),
    path: [],
    pointer: null,
    fx: [],
    sfx: [],
    log: [],
    stats: { kills: 0, deepest: 1, playMs: 0, bosses: 0, bossRetries: 0 },
    descending: 0,
    modal: null,
    compass: null,
    over: false,
    boons: [],
    stash: null,
    freeze: 0,
    collection: [],
  } as unknown as GameState;

  const calls: FakeCtx['calls'] = {
    goto: [],
    finish: 0,
    returnHome: 0,
    gameOver: [],
    freeze: [],
    rebuild: 0,
    logs: [],
    sfx: [],
  };
  let carrying: Prop | null = null;

  const ctx: FakeCtx = {
    state,
    level,
    world: level.world as WorldData,
    hero,
    rng: makeRng(12345),
    stats: {} as WorldCtx['stats'],
    goto(stage) {
      calls.goto.push(stage);
    },
    finish() {
      calls.finish++;
    },
    returnHome() {
      calls.returnHome++;
    },
    gameOver(cause) {
      calls.gameOver.push(cause);
      state.over = true;
    },
    freeze(ms, shake) {
      calls.freeze.push({ ms, shake });
    },
    rebuild() {
      calls.rebuild++;
    },
    pickUp(prop) {
      prop.hidden = true;
      carrying = prop;
    },
    setDown(at) {
      if (!carrying) return null;
      const p = carrying;
      p.hidden = false;
      p.pos = { ...at };
      carrying = null;
      return p;
    },
    carried() {
      return carrying;
    },
    consume(prop) {
      const arr = level.props ?? [];
      const i = arr.indexOf(prop);
      if (i >= 0) arr.splice(i, 1);
      if (carrying === prop) carrying = null;
    },
    spawn(m) {
      level.monsters.push(m);
    },
    text() {},
    log(text) {
      calls.logs.push(text);
    },
    sfx(id) {
      calls.sfx.push(id);
    },
    ring() {},
    flash() {},
    shake() {},
    calls,
  };
  return ctx;
}

/** Directly place a prop in the hero's arms, as the engine would on a carriable pickup. */
function pickUpProp(ctx: FakeCtx, prop: Prop): void {
  ctx.pickUp(prop);
}

// ---------------------------------------------------------------------------
// Surface generation
// ---------------------------------------------------------------------------

test('surface: valid, deterministic, five crypts, exactly four pieces, contraption reachable', () => {
  for (const seed of SEEDS) {
    const a = CEMETERY.generate(0, seed, newHero(), null);
    const b = CEMETERY.generate(0, seed, newHero(), null);
    assert.deepEqual(a.tiles, b.tiles, `seed ${seed}: deterministic tiles`);
    assert.equal(a.width % 2, 1, `seed ${seed}`);
    assert.equal(a.height % 2, 1, `seed ${seed}`);
    for (let x = 0; x < a.width; x++) assert.equal(a.tiles[0][x], Tile.Wall, `seed ${seed}: top wall`);
    for (let y = 0; y < a.height; y++) assert.equal(a.tiles[y][0], Tile.Wall, `seed ${seed}: left wall`);
    assert.ok(isFloor(a, a.start), `seed ${seed}: start is floor`);

    const crypts = (a.props ?? []).filter((p) => p.kind === 'crypt');
    assert.equal(crypts.length, 5, `seed ${seed}: five crypts`);
    const contraption = (a.props ?? []).find((p) => p.kind === 'contraption');
    assert.ok(contraption, `seed ${seed}: a contraption`);
    const home = (a.props ?? []).find((p) => p.kind === 'portal-home');
    assert.ok(home, `seed ${seed}: a portal home`);
    assert.equal(home!.hidden, true, `seed ${seed}: nobody has finished yet, so the way home stays hidden`);

    // Every crypt's door tile, and the contraption, reachable from start
    // (solid props block like chests everywhere).
    const solid = new Set((a.props ?? []).filter((p) => p.solid).map((p) => key(p.pos)));
    const dist = bfsDistances(a, a.start, { blocked: (p) => solid.has(key(p)) && key(p) !== key(a.start) });
    for (const c of crypts) {
      const near = floorNeighbors(a, c.pos).some((n) => dist.has(key(n)));
      assert.ok(near, `seed ${seed}: crypt ${c.id} unreachable`);
    }
    const nearContraption = floorNeighbors(a, contraption!.pos).some((n) => dist.has(key(n)));
    assert.ok(nearContraption, `seed ${seed}: contraption unreachable`);

    // The world's data: a decoy and four pieces, no two crypts sharing a piece.
    const data = a.world!.data as { pieceKind: (string | null)[]; decoyCrypt: number };
    assert.equal(data.pieceKind.length, 5, `seed ${seed}`);
    const pieces = data.pieceKind.filter((k) => k !== null);
    assert.equal(pieces.length, 4, `seed ${seed}: four pieces assigned`);
    assert.equal(new Set(pieces).size, 4, `seed ${seed}: four distinct pieces`);
    assert.equal(data.pieceKind[data.decoyCrypt], null, `seed ${seed}: the decoy holds no piece`);

    // 6-10 angels, all idle, all invulnerable, none atop the hero's start.
    const angels = a.monsters.filter((m) => m.kind === 'angel');
    assert.ok(angels.length >= 6 && angels.length <= 10, `seed ${seed}: ${angels.length} angels`);
    for (const ang of angels) {
      assert.equal(ang.state, 'idle', `seed ${seed}`);
      assert.ok(ang.invulnerable, `seed ${seed}`);
      assert.notEqual(key(ang.pos), key(a.start), `seed ${seed}`);
    }
  }
});

test('surface: angel stats scale from hero level, not depth', () => {
  const low = CEMETERY.generate(0, 7, { ...newHero(), level: 1 }, null);
  const high = CEMETERY.generate(0, 7, { ...newHero(), level: 10 }, null);
  const lowAngel = low.monsters.find((m) => m.kind === 'angel')!;
  const highAngel = high.monsters.find((m) => m.kind === 'angel')!;
  assert.ok(highAngel.level > lowAngel.level, 'a higher hero level makes for a higher angel level');
});

// ---------------------------------------------------------------------------
// Crypt generation
// ---------------------------------------------------------------------------

test('a crypt: valid maze, its piece (or the decoy chest) reachable, stairs at start', () => {
  for (const seed of SEEDS) {
    for (let stage = 1; stage <= 5; stage++) {
      const level = CEMETERY.generate(stage, seed, newHero(), null);
      const where = `seed ${seed} stage ${stage}`;
      assert.equal(level.width % 2, 1, where);
      assert.equal(level.height % 2, 1, where);
      assert.ok(bfsPath(level, level.start, level.start) !== undefined, where);

      const stairs = (level.props ?? []).find((p) => p.kind === 'stairs-up');
      assert.ok(stairs, `${where}: stairs-up prop`);
      assert.deepEqual(stairs!.pos, level.start, `${where}: stairs at start`);

      const piece = (level.props ?? []).find((p) => p.kind.startsWith('piece:'));
      const chest = level.chests[0];
      assert.ok(piece || chest, `${where}: something to find`);
      const target = piece ? piece.pos : chest!.pos;
      const dist = bfsDistances(level, level.start);
      assert.ok(dist.has(key(target)), `${where}: the find is unreachable`);

      // Ghouls chase, skeletons are rooted; both reachable, none on the start.
      const ghouls = level.monsters.filter((m) => m.kind === 'ghoul');
      const guards = level.monsters.filter((m) => m.kind === 'guard');
      assert.ok(ghouls.length >= 3 && ghouls.length <= 5, `${where}: ${ghouls.length} ghouls`);
      assert.ok(guards.length >= 2 && guards.length <= 4, `${where}: ${guards.length} guards`);
      for (const m of [...ghouls, ...guards]) {
        assert.ok(dist.has(key(m.pos)), `${where}: a monster off the map`);
        assert.notEqual(key(m.pos), key(level.start), where);
      }
    }
  }
});

test('a crypt already done (from data) has no piece and no chest', () => {
  const seed = 42;
  const surface = CEMETERY.generate(0, seed, newHero(), null);
  const data = surface.world!.data as { cryptState: string[] };
  data.cryptState[0] = 'done';
  const level = CEMETERY.generate(1, seed, newHero(), data);
  assert.equal((level.props ?? []).some((p) => p.kind.startsWith('piece:')), false);
  assert.equal(level.chests.length, 0);
});

// ---------------------------------------------------------------------------
// Regeneration from data
// ---------------------------------------------------------------------------

test('regenerating the surface keeps delivered pieces gone and done crypts done', () => {
  const seed = 5;
  const first = CEMETERY.generate(0, seed, newHero(), null);
  const data = first.world!.data as { cryptState: string[]; pieces: number };
  data.cryptState = ['done', 'open', 'shut', 'shut', 'shut'];
  data.pieces = 2;
  const again = CEMETERY.generate(0, seed, newHero(), data);
  const crypts = (again.props ?? []).filter((p) => p.kind === 'crypt').sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(crypts[0].state, 'done');
  assert.equal(crypts[1].state, 'open');
  assert.equal(crypts[2].state, 'shut');
  const contraption = (again.props ?? []).find((p) => p.kind === 'contraption')!;
  assert.equal(contraption.state, 'two');
});

test('the surface portal home reveals once the contraption is finished', () => {
  const seed = 5;
  const first = CEMETERY.generate(0, seed, newHero(), null);
  const data = first.world!.data as { finished: boolean };
  assert.equal(data.finished, false);
  data.finished = true;
  const again = CEMETERY.generate(0, seed, newHero(), data);
  const home = (again.props ?? []).find((p) => p.kind === 'portal-home')!;
  assert.equal(home.hidden, false);
  assert.equal(again.world?.won, true);
});

// ---------------------------------------------------------------------------
// Crypt doors and the contraption (onBump)
// ---------------------------------------------------------------------------

test('a shut crypt opens on the first bump, and an open one descends', () => {
  const seed = 9;
  const level = CEMETERY.generate(0, seed, newHero(), null);
  const ctx = fakeCtx(level);
  const crypt = level.props!.find((p) => p.kind === 'crypt')!;
  const idx = (crypt.data as { index: number }).index;

  CEMETERY.onBump!(ctx, crypt);
  assert.equal(crypt.state, 'open');
  assert.equal((ctx.world.data as { cryptState: string[] }).cryptState[idx], 'open');
  assert.equal(ctx.calls.goto.length, 0, 'the first bump only opens the door');

  CEMETERY.onBump!(ctx, crypt);
  assert.deepEqual(ctx.calls.goto, [1 + idx], 'the second bump goes down');
});

test('a delivered piece counts toward the contraption, and the fourth finishes it', () => {
  const seed = 11;
  const level = CEMETERY.generate(0, seed, newHero(), null);
  const ctx = fakeCtx(level);
  const contraption = level.props!.find((p) => p.kind === 'contraption')!;
  const data = ctx.world.data as { pieces: number; finished: boolean };

  for (let i = 0; i < 4; i++) {
    const piece: Prop = { id: `test-piece-${i}`, pos: { ...level.start }, kind: 'piece:gear', solid: false, art: 'piece:gear', carriable: true };
    pickUpProp(ctx, piece);
    CEMETERY.onBump!(ctx, contraption);
    assert.equal(data.pieces, i + 1);
    assert.equal(ctx.carried(), null, 'the piece is consumed');
  }
  assert.equal(data.finished, true);
  assert.equal(ctx.calls.finish, 1);
  assert.equal(contraption.state, 'complete');

  // A fifth delivery attempt (nothing carried) never calls finish again.
  CEMETERY.onBump!(ctx, contraption);
  assert.equal(ctx.calls.finish, 1);
});

// ---------------------------------------------------------------------------
// Angels
// ---------------------------------------------------------------------------

/** A tiny open hall, far bigger than any wake/lose/hold radius, so BFS
 *  distance and manhattan distance agree and the geometry never interferes. */
function openHall(w = 41, h = 21): LevelData {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(x > 0 && y > 0 && x < w - 1 && y < h - 1 ? Tile.Floor : Tile.Wall);
    tiles.push(row);
  }
  const start = { x: 1, y: Math.floor(h / 2) };
  return {
    depth: 1,
    seed: 1,
    kind: 'world',
    theme: 'cemetery',
    world: { kind: 'angels', stage: 0, data: {}, won: false },
    width: w,
    height: h,
    tiles: tiles as unknown as LevelData['tiles'],
    start,
    exit: start,
    keys: [],
    doors: [],
    chests: [],
    goldPiles: [],
    monsters: [],
    props: [],
  };
}

function idleAngel(pos: Vec, id: string): Monster {
  const m: Monster = {
    id,
    kind: 'angel',
    name: 'Angel',
    glyph: '🗿',
    pos: { ...pos },
    rpos: { ...pos },
    home: { ...pos },
    hp: 1,
    maxHp: 1,
    atk: 0,
    def: 0,
    level: 5,
    xp: 0,
    gold: 0,
    moveInterval: 1e9,
    moveCooldown: 0,
    attackInterval: 1e9,
    attackCooldown: 0,
    state: 'idle',
    sightRange: 999,
    leash: 0,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    frozenMs: 0,
    hitFlash: 0,
    lungeT: 0,
    invulnerable: true,
  };
  return m;
}

test('angels: idle until the hero comes near, then hold at three tiles', () => {
  const level = openHall();
  const angel = idleAngel({ x: 25, y: level.start.y }, 'a1'); // 24 tiles off: far outside the wake radius
  level.monsters.push(angel);
  const ctx = fakeCtx(level);

  CEMETERY.tick!(ctx, 700);
  assert.equal(angel.state, 'idle', 'still asleep, far off');

  angel.pos = { x: 6, y: level.start.y }; // 5 tiles off: inside the wake radius
  angel.rpos = { ...angel.pos };
  CEMETERY.tick!(ctx, 700);
  assert.equal(angel.state, 'chasing', 'wakes within range with a clear line');

  // Holding: it approaches to exactly three tiles and no closer.
  for (let i = 0; i < 10; i++) CEMETERY.tick!(ctx, 700);
  assert.equal(manhattan(angel.pos, ctx.hero.pos), 3, 'holds at three tiles');
  assert.equal(ctx.state.over, false);
});

test('angels: five awake on screen close in, and a touch turns the hero to stone', () => {
  const level = openHall();
  const hero = { x: 20, y: 10 };
  level.start = hero;
  const angels = [
    idleAngel({ x: 18, y: 10 }, 'a1'),
    idleAngel({ x: 22, y: 10 }, 'a2'),
    idleAngel({ x: 20, y: 8 }, 'a3'),
    idleAngel({ x: 20, y: 12 }, 'a4'),
    idleAngel({ x: 19, y: 9 }, 'a5'),
  ];
  for (const a of angels) a.state = 'chasing'; // already awake, already on screen
  level.monsters.push(...angels);
  const ctx = fakeCtx(level);

  CEMETERY.tick!(ctx, 700);
  assert.ok(angels.every((a) => a.state === 'closing'), 'five on screen: all commit');

  let guard = 0;
  while (!ctx.state.over && guard++ < 20) CEMETERY.tick!(ctx, 700);
  assert.equal(ctx.calls.gameOver[0], 'stone');
  assert.equal(ctx.state.over, true);
});

test('angels: lose the hero beyond twelve BFS tiles and go idle where they stand', () => {
  const level = openHall();
  const angel = idleAngel({ x: 6, y: level.start.y }, 'a1');
  angel.state = 'chasing';
  level.monsters.push(angel);
  const ctx = fakeCtx(level);

  // Walk the hero far away without moving the angel (as if it broke line and
  // the hero kept going): once the walking distance exceeds twelve, it settles.
  ctx.hero.pos = { x: level.width - 2, y: level.start.y };
  const before = { ...angel.pos };
  CEMETERY.tick!(ctx, 700);
  assert.equal(angel.state, 'idle');
  assert.deepEqual(angel.pos, before, 'idle exactly where it stood');
});

// ---------------------------------------------------------------------------
// The maze shift
// ---------------------------------------------------------------------------

test('a shift keeps the piece and the stairs reachable, never moves an occupied tile, and calls freeze + rebuild', () => {
  for (const seed of SEEDS) {
    const level = CEMETERY.generate(1, seed, newHero(), null);
    const ctx = fakeCtx(level);
    const before = level.tiles.map((row) => [...row]);
    const occupied = new Set<string>([key(ctx.hero.pos)]);
    for (const m of level.monsters) occupied.add(key(m.pos));
    for (const p of level.props ?? []) occupied.add(key(p.pos));
    for (const c of level.chests) occupied.add(key(c.pos));

    // Run past the shift clock in one big step.
    CEMETERY.tick!(ctx, 26000);

    assert.equal(ctx.calls.freeze.length, 1, `seed ${seed}: freeze called`);
    assert.equal(ctx.calls.rebuild, 1, `seed ${seed}: rebuild called`);
    assert.ok(ctx.calls.logs.includes('The walls slide.'), `seed ${seed}`);
    assert.ok(ctx.calls.sfx.includes('rumble'), `seed ${seed}`);

    for (const p of occupied) {
      const [x, y] = p.split(',').map(Number);
      assert.equal(level.tiles[y][x], before[y][x], `seed ${seed}: an occupied tile changed`);
    }

    const piece = (level.props ?? []).find((p) => p.kind.startsWith('piece:'));
    const chest = level.chests[0];
    const target = piece ? piece.pos : chest!.pos;
    assert.ok(bfsPath(level, ctx.hero.pos, target) !== null, `seed ${seed}: the find is now unreachable`);
    assert.ok(bfsPath(level, ctx.hero.pos, level.start) !== null, `seed ${seed}: the stairs are now unreachable`);
  }
});

// ---------------------------------------------------------------------------
// Ghoul chase
// ---------------------------------------------------------------------------

test('a ghoul steps toward the hero within its range, and stays put beyond it', () => {
  const level = CEMETERY.generate(1, 3, newHero(), null);
  const ctx = fakeCtx(level);
  const ghoul = level.monsters.find((m) => m.kind === 'ghoul')!;

  // Close: right next to the hero's start, well inside the chase range.
  const near = bfsDistances(level, level.start, { maxDist: 5 });
  const nearSpots = [...near.entries()].filter(([, d]) => d > 0 && d <= 4);
  assert.ok(nearSpots.length > 0, 'the maze has room to test a close chase');
  const [k] = nearSpots[nearSpots.length - 1];
  const [x, y] = k.split(',').map(Number);
  ghoul.pos = { x, y };
  const step = CEMETERY.step!(ctx, ghoul);
  assert.ok(step, 'the ghoul steps toward a nearby hero');
  const distBefore = manhattan(ghoul.pos, ctx.hero.pos);
  const distAfter = manhattan(step!, ctx.hero.pos);
  assert.ok(distAfter <= distBefore, 'the step closes in, or the hero is already adjacent');

  // Far: further than the chase range along the actual maze (not manhattan).
  const far = [...bfsDistances(level, level.start)].sort((a, b) => b[1] - a[1])[0];
  const [fx, fy] = far[0].split(',').map(Number);
  ghoul.pos = { x: fx, y: fy };
  if (far[1] > 6) {
    const stayed = CEMETERY.step!(ctx, ghoul);
    assert.equal(stayed, null, 'out of range: the ghoul does not move');
  }
});

// ---------------------------------------------------------------------------
// The quality pass: what the first cut got wrong
// ---------------------------------------------------------------------------

test('a carried piece rides up to the surface and into other crypts, hidden in the hero\'s arms', () => {
  const seed = 11;
  const hero = newHero();
  const surface0 = CEMETERY.generate(0, seed, hero, null);
  const data = surface0.world!.data as { pieceKind: (string | null)[]; cryptState: string[] };
  const idx = data.pieceKind.findIndex((k) => k !== null);
  const crypt = CEMETERY.generate(1 + idx, seed, hero, surface0.world!.data);
  const piece = crypt.props!.find((p) => p.id === `piece-${idx}`)!;
  const ctx = fakeCtx(crypt);
  ctx.hero.carrying = piece.id;
  piece.hidden = true;
  CEMETERY.onEnter!(ctx, piece.pos);
  assert.notEqual(data.cryptState[idx], 'done', 'picking a piece up does not finish the crypt');

  const surface = CEMETERY.generate(0, seed, ctx.hero, crypt.world!.data);
  const ghost = surface.props!.find((p) => p.id === piece.id);
  assert.ok(ghost && ghost.hidden && ghost.kind === piece.kind, 'the piece is in the hero\'s arms on the surface');

  const other = data.pieceKind.findIndex((k, i) => k !== null && i !== idx);
  const otherCrypt = CEMETERY.generate(1 + other, seed, ctx.hero, crypt.world!.data);
  assert.ok(otherCrypt.props!.some((p) => p.id === piece.id && p.hidden), 'and in the next crypt too');
  assert.ok(otherCrypt.props!.some((p) => p.id === `piece-${other}` && !p.hidden), 'whose own piece still lies at the far end');
});

test('a piece dropped in its crypt is back at the far end next time; delivered, the crypt is done', () => {
  const seed = 11;
  const hero = newHero();
  const surface = CEMETERY.generate(0, seed, hero, null);
  const data = surface.world!.data as { pieceKind: (string | null)[]; cryptState: string[]; pieces: number };
  const idx = data.pieceKind.findIndex((k) => k !== null);
  const crypt = CEMETERY.generate(1 + idx, seed, hero, surface.world!.data);
  const piece = crypt.props!.find((p) => p.id === `piece-${idx}`)!;
  const ctx = fakeCtx(crypt);
  pickUpProp(ctx, piece);
  CEMETERY.onEnter!(ctx, piece.pos);
  ctx.setDown(ctx.hero.pos); // a knockdown drops it
  ctx.hero.carrying = null;

  const again = CEMETERY.generate(1 + idx, seed, ctx.hero, crypt.world!.data);
  const back = again.props!.find((p) => p.id === piece.id);
  assert.ok(back && !back.hidden && eq(back.pos, again.exit), 'the piece lies at the far end again');

  // Delivered to the contraption: its crypt is done and holds nothing.
  const surface2 = CEMETERY.generate(0, seed, ctx.hero, crypt.world!.data);
  const sctx = fakeCtx(surface2);
  const ghost: Prop = { id: piece.id, pos: { ...sctx.hero.pos }, kind: piece.kind, solid: false, art: piece.art, carriable: true, hidden: true };
  pickUpProp(sctx, ghost);
  CEMETERY.onBump!(sctx, surface2.props!.find((p) => p.kind === 'contraption')!);
  assert.equal(data.cryptState[idx], 'done');
  const emptied = CEMETERY.generate(1 + idx, seed, sctx.hero, surface2.world!.data);
  assert.equal(emptied.props!.some((p) => p.id === piece.id), false);
});

test('the decoy crypt holds the key to its own chest, and a shift never walls the key in', () => {
  for (const seed of SEEDS) {
    const surface = CEMETERY.generate(0, seed, newHero(), null);
    const data = surface.world!.data as { decoyCrypt: number };
    const crypt = CEMETERY.generate(1 + data.decoyCrypt, seed, newHero(), surface.world!.data);
    assert.equal(crypt.chests.length, 1, `seed ${seed}`);
    assert.equal(crypt.keys.length, 1, `seed ${seed}`);
    assert.equal(crypt.keys[0].kind, 'chest');
    assert.ok(bfsPath(crypt, crypt.start, crypt.keys[0].pos) !== null, `seed ${seed}: the key can be walked to`);
    const ctx = fakeCtx(crypt);
    CEMETERY.tick!(ctx, 26000);
    assert.ok(bfsPath(crypt, ctx.hero.pos, crypt.keys[0].pos) !== null, `seed ${seed}: still after a shift`);
    assert.equal(crypt.tiles[crypt.keys[0].pos.y][crypt.keys[0].pos.x], Tile.Floor);
  }
});

test('angels: a hero who walks up to a holding angel pushes it back a step', () => {
  const level = openHall();
  const angel = idleAngel({ x: 6, y: level.start.y }, 'a1');
  angel.state = 'chasing';
  level.monsters.push(angel);
  const ctx = fakeCtx(level);
  ctx.hero.pos = { x: 4, y: level.start.y }; // two tiles off
  CEMETERY.tick!(ctx, 700);
  assert.equal(manhattan(angel.pos, ctx.hero.pos), 3, 'stepped back out to three tiles');
  assert.equal(ctx.state.over, false);
});

test('the plaza has a way out on two sides', () => {
  const level = CEMETERY.generate(0, 3, newHero(), null);
  assert.equal(level.tiles[23][15], Tile.Floor);
  assert.equal(level.tiles[17][15], Tile.Floor);
});
