import test from 'node:test';
import assert from 'node:assert/strict';

import { HEART, ITEM_SLOT, Tile, inRect, key } from '../src/engine/types';
import type { Boon, LevelData, MagicItem, Modal, Seal, Vec } from '../src/engine/types';
import { Game } from '../src/engine/game';
import { PASSAGE_MONSTER_CAP, generateLevel, passageTilesOf } from '../src/engine/maze';
import { WING_MAX_ROWS, WING_STAIRS_FROM_ROOMS, wingGrid } from '../src/engine/wings';
import { bfsDistances, floorNeighbors, isFloor } from '../src/engine/pathfind';
import { makeMonster, makeMimic, monsterLevelCap, newHero } from '../src/engine/balance';
import { makeRng } from '../src/engine/rng';
import { relicOffered, relicsBefore } from '../src/engine/puzzles';
import { BOON_RUNS, DEATHLESS_HEARTS, VIGOR_ATK, applyBoon, spendBoons } from '../src/engine/boons';
import { bossKindForDepth } from '../src/engine/boss';
import { clearSave, loadBoons, loadGame, saveBoons, saveGame } from '../src/engine/save';
import { FORGE_TILE, forgeAt, generateShopLevel } from '../src/engine/shop';
import { equip, itemPrice, upgradePrice } from '../src/engine/items';
import { updateMonsters } from '../src/engine/monsters';

const SEEDS = [1, 2, 3, 42, 999];
const DEPTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

test('a wing is a labyrinth of rooms with a sealed treasure room at the far end', () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      const wings = lv.passages ?? [];
      assert.equal(wings.length, 1, `${where}: one wing a floor`);
      const wing = wings[0];
      const inside = new Set(wing.tiles.map(key));

      // Rooms: a grid deep, as many along the wall as the depth allows (the
      // floor may have had to settle for narrower), every one of them open
      // floor inside the wing, no two touching.
      const grid = wingGrid(depth);
      assert.ok(wing.rooms.length >= 4, `${where}: only ${wing.rooms.length} rooms`);
      assert.ok(wing.rooms.length <= grid.cols * grid.rows, where);
      assert.ok(grid.rows <= WING_MAX_ROWS, where);
      // A wing that is a real walk has its own way down, in the treasure room.
      if (wing.rooms.length >= WING_STAIRS_FROM_ROOMS) {
        assert.ok(lv.wingExit, `${where}: a ${wing.rooms.length}-room wing with no stairs`);
        const w = lv.wingExit as Vec;
        const tr = wing.rooms[wing.treasure];
        assert.ok(inRect(tr, w) || floorNeighbors(lv, w).some((nb) => inRect(tr, nb)), `${where}: the wing stairs are not in the treasure room`);
        assert.ok(inside.has(key(w)), where);
      } else {
        assert.equal(lv.wingExit, undefined, `${where}: a small wing has no stairs of its own`);
      }
      for (const r of wing.rooms) {
        assert.ok(r.w >= 3 && r.h >= 3, `${where}: a room ${r.w}x${r.h} is not a room`);
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) assert.ok(inside.has(key({ x, y })), `${where}: room tile outside the wing`);
        }
      }
      assert.notEqual(wing.entry, wing.treasure, where);
      // The mouth opens into the entry room.
      const entry = wing.rooms[wing.entry];
      const mouthReach = bfsDistances(lv, wing.mouths[0], { blocked: (p) => !inside.has(key(p)), maxDist: 6 });
      assert.ok([...mouthReach.keys()].some((k) => inRect(entry, { x: +k.split(',')[0], y: +k.split(',')[1] })), `${where}: the mouth does not lead to the entry room`);

      // The treasure room: one seal on its only way in, a chest with a magic
      // item inside, and nothing else of the wing reachable only through it.
      const treasure = wing.rooms[wing.treasure];
      const seals = (lv.seals ?? []).filter((s) => floorNeighbors(lv, s.pos).some((nb) => inRect(treasure, nb)));
      assert.equal(seals.length, 1, `${where}: ${seals.length} seals on the treasure room`);
      const seal = seals[0];
      assert.ok(inside.has(key(seal.pos)), where);
      assert.equal(seal.open, false, where);
      const magic = lv.chests.filter((c) => c.loot.magic);
      assert.equal(magic.length, 1, `${where}: ${magic.length} magic chests`);
      const chest = magic[0];
      assert.equal(chest.loot.magic?.level, depth, where);
      assert.ok(inside.has(key(chest.pos)), `${where}: the treasure is out in the open`);
      assert.ok(!chest.mimic, `${where}: the treasure is a mimic`);

      const solid = new Set([...lv.chests.map((c) => key(c.pos)), ...(lv.altars ?? []).map((a) => key(a.pos))]);
      const shut = bfsDistances(lv, lv.start, { blocked: (p) => solid.has(key(p)) || key(p) === key(seal.pos) });
      const open = bfsDistances(lv, lv.start, { blocked: (p) => solid.has(key(p)) });
      assert.ok(!floorNeighbors(lv, chest.pos).some((nb) => shut.has(key(nb))), `${where}: the seal is not a lock`);
      assert.ok(floorNeighbors(lv, chest.pos).some((nb) => open.has(key(nb))), `${where}: the treasure is out of reach`);
      // Everything the lock is made of is on the near side of the seal.
      for (const r of lv.runes ?? []) assert.ok(shut.has(key(r.pos)), `${where}: a rune behind its own seal`);
      for (const o of lv.orbs ?? []) assert.ok(shut.has(key(o.pos)), `${where}: the orb behind its own seal`);
      for (const r of lv.relics ?? []) assert.ok(shut.has(key(r.pos)), `${where}: a relic behind the seal`);
      for (const a of lv.altars ?? []) assert.ok(floorNeighbors(lv, a.pos).some((nb) => shut.has(key(nb))), `${where}: an altar behind the seal`);
    }
  }
});

test('every lock is one the floor can be made to open', () => {
  const runSeed = 77;
  for (const depth of DEPTHS) {
    const lv = generateLevel(depth, runSeed, depth);
    const where = `depth ${depth}`;
    for (const s of lv.seals ?? []) {
      const lock = s.lock;
      if (lock.kind === 'runes') {
        const mine = (lv.runes ?? []).filter((r) => r.sealId === s.id);
        assert.equal(mine.length, lock.order.length, `${where}: runes and order disagree`);
        assert.ok(mine.length >= 3, where);
        assert.equal(new Set(mine.map((r) => r.glyph)).size, mine.length, `${where}: two runes with one shape`);
        if (lock.hint === 'none') assert.equal(mine.length, 3, `${where}: an unhinted lock with more than six orders`);
        if (depth === 1) assert.equal(lock.hint, 'pips', `${where}: the first floor teaches`);
      } else if (lock.kind === 'orb') {
        const orb = (lv.orbs ?? []).find((o) => o.sealId === s.id);
        assert.ok(orb, `${where}: an orb seal with no orb`);
        assert.equal(orb?.state, 'floor', where);
        assert.deepEqual(orb?.home, orb?.pos, where);
        // The cradle stands in front of the seal, not behind it.
        assert.equal(Math.abs(lock.socket.x - s.pos.x) + Math.abs(lock.socket.y - s.pos.y), 1, where);
      } else {
        // A keystone seal only ever asks for a relic some shallower floor of
        // this run laid out, and never before the first boss.
        assert.ok(depth > 3, `${where}: a keystone seal too early`);
        assert.ok(relicsBefore(runSeed, depth).includes(lock.relic), `${where}: a keystone nobody could have`);
      }
    }
    // The relic this floor offers is the one the run promised.
    const offered = relicOffered(runSeed, depth);
    assert.deepEqual((lv.relics ?? []).map((r) => r.kind), offered ? [offered] : [], where);
  }
});

test('the wing holds the hard end of the floor, and its monsters keep to it', () => {
  let lurkers = 0;
  let mimics = 0;
  let altars = 0;
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const lv = generateLevel(depth, seed, depth);
      const where = `depth ${depth} seed ${seed}`;
      const wing = (lv.passages ?? [])[0];
      const inside = new Set(wing.tiles.map(key));
      const treasure = wing.rooms[wing.treasure];
      const cap = monsterLevelCap(depth, depth);
      const mine = lv.monsters.filter((m) => inside.has(key(m.pos)));
      assert.ok(mine.length >= 2, `${where}: a wing with ${mine.length} monsters is not a dungeon`);
      assert.ok(mine.length <= PASSAGE_MONSTER_CAP, `${where}: overstocked`);
      assert.ok(mine.some((m) => inRect(treasure, m.pos) && m.kind === 'guard'), `${where}: nothing guards the treasure`);
      for (const m of mine) {
        // Over the floor's own roll for the role, never over the wing's cap.
        const plain = makeMonster(m.kind === 'lurker' ? 'lurker' : m.kind === 'guard' ? 'guard' : 'patrol', depth, makeRng(1), m.pos, 'x', { heroLevel: depth });
        assert.ok(m.level >= Math.min(plain.level, cap), `${where}: ${m.id} is no harder than the maze`);
        assert.ok(m.level <= cap + 1, `${where}: ${m.id} is over the wing's cap`);
        assert.ok(!wing.mouths.some((t) => key(t) === key(m.pos)), `${where}: ${m.id} blocks the mouth`);
        for (const s of lv.seals ?? []) {
          assert.ok(Math.abs(s.pos.x - m.pos.x) + Math.abs(s.pos.y - m.pos.y) > 1, `${where}: ${m.id} stands on the seal's doorstep`);
        }
        for (const t of m.patrolPath ?? []) {
          assert.ok(inside.has(key(t)), `${where}: ${m.id} paces out of the wing`);
          assert.ok(!(lv.seals ?? []).some((s) => key(s.pos) === key(t)), `${where}: ${m.id} paces through the seal`);
          assert.ok(!inRect(treasure, t), `${where}: ${m.id} paces the treasure room`);
        }
        if (m.kind === 'lurker') lurkers++;
      }
      // Mimics, relics and altars are the wing's own.
      for (const c of lv.chests) if (c.mimic) {
        mimics++;
        assert.ok(inside.has(key(c.pos)), `${where}: a mimic out in the maze`);
      }
      for (const r of lv.relics ?? []) assert.ok(inside.has(key(r.pos)), `${where}: a relic out in the maze`);
      for (const a of lv.altars ?? []) {
        altars++;
        assert.ok(inside.has(key(a.pos)), `${where}: an altar out in the maze`);
        assert.ok(depth > 3, `${where}: an altar before the first boss`);
        const fought = [3, 6, 9].filter((d) => d < depth).map((d) => bossKindForDepth(d, seed));
        assert.ok(fought.includes(a.trophy), `${where}: an altar for a boss not yet met`);
      }
    }
  }
  assert.ok(lurkers > 0, 'the wings hold hunters');
  assert.ok(mimics > 0, 'mimics turn up now and then');
  assert.ok(altars > 0, 'altars turn up now and then');
});

// ---------------------------------------------------------------------------
// A hand-made wing, for the rules
// ---------------------------------------------------------------------------

/**
 * '#' wall, '.' floor, '~' hidden floor (the wing), '@' the wing's mouth.
 * 'S' start, 'E' exit.
 */
function mkWing(rows: string[]): LevelData {
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[][] = rows.map((r) => Array.from(r, (c) => (c === '#' ? Tile.Wall : Tile.Floor)));
  let start: Vec = { x: 1, y: 1 };
  let exit: Vec = { x: width - 2, y: height - 2 };
  const hidden: Vec[] = [];
  const mouths: Vec[] = [];
  rows.forEach((r, y) =>
    Array.from(r).forEach((c, x) => {
      if (c === 'S') start = { x, y };
      if (c === 'E') exit = { x, y };
      if (c === '~' || c === '@') hidden.push({ x, y });
      if (c === '@') mouths.push({ x, y });
    }),
  );
  return {
    depth: 1,
    seed: 1,
    kind: 'maze',
    theme: 'crypt',
    width,
    height,
    tiles,
    start,
    exit,
    keys: [],
    doors: [],
    chests: [],
    goldPiles: [],
    monsters: [],
    passages: [{ id: 'pg1', kind: 'wing', tiles: hidden, mouths, rooms: [{ x: 3, y: 3, w: 4, h: 3 }, { x: 8, y: 3, w: 3, h: 3 }], entry: 0, treasure: 1 }],
    seals: [],
    runes: [],
    orbs: [],
    relics: [],
    altars: [],
  };
}

/**
 * Two rooms behind the wall, joined by the one corridor tile at (7,4), which
 * is the seal. The left room is the entry (mouth at (4,2)), the right the
 * treasure room.
 */
const WING = [
  '##############',
  '#S...........#',
  '#.##@#######.#',
  '#.#~~~~#~~~#.#',
  '#.#~~~~~~~~#.#',
  '#.#~~~~#~~~#.#',
  '#.##########.#',
  '#...........E#',
  '##############',
];
const SEAL_POS = { x: 7, y: 4 };
const SOCKET_POS = { x: 6, y: 4 };

function wingGame(seal: Seal | null, at: Vec = { x: 4, y: 3 }): Game {
  const g = Game.forTest(1234);
  const st = g.state;
  st.level = mkWing(WING);
  if (seal) st.level.seals = [seal];
  st.depth = 1;
  st.hero.lens = { depth: 1, set: 0 };
  st.hero.pos = { ...at };
  st.hero.rpos = { ...at };
  st.trail = new Set<string>([key(at)]);
  st.path = [];
  st.fx = [];
  st.sfx = [];
  st.descending = 0;
  return g;
}

/** Walk the hero one tile (they must be adjacent) and let the step land. */
function step(g: Game, to: Vec): void {
  g.pointerAt(to);
  g.tick(150);
}

test('a closed seal is a wall to the hero and to the monsters; an open one is floor', () => {
  const seal: Seal = { id: 'seal1', pos: SEAL_POS, open: false, lock: { kind: 'keystone', relic: 'sun' } };
  const g = wingGame(seal, { x: 6, y: 4 });
  const st = g.state;
  g.pointerAt({ x: 8, y: 4 });
  assert.equal(st.path.length, 0, 'no drag routes through a seal');
  step(g, SEAL_POS);
  assert.deepEqual(st.hero.pos, { x: 6, y: 4 }, 'walking into a seal goes nowhere');
  assert.ok(st.sfx.includes('locked'));
  assert.ok(st.log.some((l) => l.text.includes('carved with a sun')), 'the seal says what it wants, in its own way');

  // A lurker on the far side cannot see or reach the hero through it.
  const m = makeMonster('lurker', 1, makeRng(3), { x: 9, y: 4 }, 'm1');
  m.home = { x: 9, y: 4 };
  st.level.monsters = [m];
  for (let i = 0; i < 30; i++) updateMonsters(st, 200, makeRng(i));
  assert.equal(m.state, 'idle', 'a seal blocks line of sight');
  assert.deepEqual(m.pos, { x: 9, y: 4 });

  seal.open = true;
  g.pointerAt({ x: 8, y: 4 });
  assert.ok(st.path.length > 0, 'an open seal is walked through');
});

test('runes stepped on in order open the seal; a wrong one puts them all out', () => {
  const seal: Seal = {
    id: 'seal1',
    pos: SEAL_POS,
    open: false,
    lock: { kind: 'runes', hint: 'pips', order: ['r1', 'r2', 'r3'], lit: 0 },
  };
  const g = wingGame(seal, { x: 4, y: 4 });
  const st = g.state;
  st.level.runes = [
    { id: 'r1', pos: { x: 3, y: 3 }, glyph: 0, sealId: 'seal1', lit: false },
    { id: 'r2', pos: { x: 3, y: 5 }, glyph: 1, sealId: 'seal1', lit: false },
    { id: 'r3', pos: { x: 5, y: 4 }, glyph: 2, sealId: 'seal1', lit: false },
  ];
  const [r1, r2, r3] = st.level.runes;

  // Wrong first: nothing lights and the runes reset.
  step(g, { x: 3, y: 4 });
  step(g, { x: 3, y: 5 });
  assert.equal(r2.lit, false, 'the second rune first is wrong');
  assert.ok(st.sfx.includes('runeFail'));
  assert.equal(seal.lock.kind === 'runes' && seal.lock.lit, 0);

  // Right order: one, two, three.
  step(g, { x: 3, y: 4 });
  step(g, { x: 3, y: 3 });
  assert.equal(r1.lit, true);
  assert.ok(st.sfx.includes('rune'));
  // Walking back over a lit rune costs nothing.
  step(g, { x: 3, y: 4 });
  step(g, { x: 3, y: 3 });
  assert.equal(r1.lit, true, 'a lit rune stays lit');
  step(g, { x: 3, y: 4 });
  step(g, { x: 3, y: 5 });
  assert.equal(r2.lit, true);
  assert.equal(seal.open, false, 'two of three is not enough');
  // The wrong one now: everything goes dark again.
  step(g, { x: 3, y: 4 });
  step(g, { x: 4, y: 4 });
  step(g, { x: 5, y: 4 });
  assert.equal(r3.lit, true, 'third in order lights');
  assert.equal(seal.open, true, 'and the seal opens');
  assert.ok(st.sfx.includes('seal'));
  assert.ok(st.log.some((l) => l.text === 'The seal opens'));
});

test('a wrong rune after two right ones puts all three out', () => {
  const seal: Seal = {
    id: 'seal1',
    pos: SEAL_POS,
    open: false,
    lock: { kind: 'runes', hint: 'none', order: ['r1', 'r2', 'r3'], lit: 0 },
  };
  const g = wingGame(seal, { x: 4, y: 4 });
  const st = g.state;
  st.level.runes = [
    { id: 'r1', pos: { x: 3, y: 3 }, glyph: 0, sealId: 'seal1', lit: false },
    { id: 'r2', pos: { x: 5, y: 3 }, glyph: 1, sealId: 'seal1', lit: false },
    { id: 'r3', pos: { x: 3, y: 5 }, glyph: 2, sealId: 'seal1', lit: false },
  ];
  step(g, { x: 4, y: 3 });
  step(g, { x: 3, y: 3 });
  step(g, { x: 4, y: 3 });
  step(g, { x: 5, y: 3 });
  assert.ok(st.level.runes[0].lit && st.level.runes[1].lit);
  // r3 is next; stepping on nothing wrong yet. Now reset the order and go wrong.
  seal.lock = { kind: 'runes', hint: 'none', order: ['r1', 'r2', 'r3'], lit: 2 };
  st.level.runes[2].lit = false;
  // Make r1 "wrong" by unlighting it so it is the wrong next step.
  st.level.runes[0].lit = false;
  step(g, { x: 4, y: 3 });
  step(g, { x: 3, y: 3 });
  assert.ok(st.level.runes.every((r) => !r.lit), 'every rune is dark');
  assert.equal(seal.lock.kind === 'runes' && seal.lock.lit, 0);
});

test('the orb is carried to its cradle, set down to fight, and goes home if it leaves the wing', () => {
  const seal: Seal = { id: 'seal1', pos: SEAL_POS, open: false, lock: { kind: 'orb', socket: SOCKET_POS, placed: false } };
  const g = wingGame(seal, { x: 4, y: 4 });
  const st = g.state;
  const hero = st.hero;
  st.level.orbs = [{ id: 'orb1', pos: { x: 3, y: 4 }, home: { x: 3, y: 4 }, sealId: 'seal1', state: 'floor' }];
  const orb = st.level.orbs[0];

  step(g, { x: 3, y: 4 });
  assert.equal(hero.carrying, 'orb1', 'walking onto the orb picks it up');
  assert.equal(orb.state, 'carried');
  assert.ok(st.sfx.includes('orbLift'));

  // A monster in the way: the orb goes down first, then the swing.
  const m = makeMonster('patrol', 1, makeRng(3), { x: 4, y: 4 }, 'm1');
  st.level.monsters = [m];
  g.pointerAt({ x: 4, y: 4 });
  g.tick(150);
  assert.equal(hero.carrying, null, 'hands free to swing');
  assert.equal(orb.state, 'floor');
  assert.deepEqual(orb.pos, { x: 3, y: 4 }, 'set down under the hero');
  assert.ok(st.sfx.includes('swing'), 'and the swing lands');
  st.level.monsters = [];

  // Step off and back on to pick it up again, then carry it to the cradle.
  step(g, { x: 3, y: 3 });
  step(g, { x: 3, y: 4 });
  assert.equal(hero.carrying, 'orb1');
  step(g, { x: 4, y: 4 });
  step(g, { x: 5, y: 4 });
  assert.equal(seal.open, false);
  step(g, SOCKET_POS);
  assert.equal(hero.carrying, null);
  assert.equal(orb.state, 'placed');
  assert.deepEqual(orb.pos, SOCKET_POS);
  assert.equal(seal.open, true, 'the cradle opens the seal');
  assert.ok(st.sfx.includes('seal'));
});

test('an orb carried out of the wing slips back to where it lay', () => {
  const seal: Seal = { id: 'seal1', pos: SEAL_POS, open: false, lock: { kind: 'orb', socket: SOCKET_POS, placed: false } };
  const g = wingGame(seal, { x: 4, y: 4 });
  const st = g.state;
  st.level.orbs = [{ id: 'orb1', pos: { x: 4, y: 3 }, home: { x: 4, y: 3 }, sealId: 'seal1', state: 'floor' }];
  const orb = st.level.orbs[0];
  step(g, { x: 4, y: 3 });
  assert.equal(st.hero.carrying, 'orb1');
  step(g, { x: 4, y: 2 }); // the mouth: still hidden ground
  assert.equal(st.hero.carrying, 'orb1', 'the mouth is still the wing');
  step(g, { x: 4, y: 1 }); // out into the maze
  assert.equal(st.hero.carrying, null);
  assert.equal(orb.state, 'floor');
  assert.deepEqual(orb.pos, { x: 4, y: 3 }, 'back where it was found');
});

test('a knockdown drops the orb where the hero fell', () => {
  const seal: Seal = { id: 'seal1', pos: SEAL_POS, open: false, lock: { kind: 'orb', socket: SOCKET_POS, placed: false } };
  const g = wingGame(seal, { x: 4, y: 4 });
  const st = g.state;
  const hero = st.hero;
  st.level.orbs = [{ id: 'orb1', pos: { x: 4, y: 4 }, home: { x: 4, y: 4 }, sealId: 'seal1', state: 'floor' }];
  st.level.orbs[0].state = 'carried';
  hero.carrying = 'orb1';
  step(g, { x: 5, y: 4 });
  st.trail.add(key({ x: 3, y: 3 }));
  const m = makeMonster('guard', 1, makeRng(3), { x: 6, y: 4 }, 'm1');
  m.atk = 999;
  m.sinceCombat = 0;
  m.attackCooldown = 0;
  st.level.monsters = [m];
  updateMonsters(st, 100, makeRng(9));
  assert.equal(hero.sleeping, true);
  assert.equal(hero.carrying, null, "the orb is out of the hero's arms");
  assert.equal(st.level.orbs[0].state, 'floor');
  assert.ok(hiddenAtWing(st.level, st.level.orbs[0].pos), 'and lies in the wing where they fell');
});

test('tapping your own tile picks up an orb stuck underfoot', () => {
  // A knockdown can drop the orb right where the hero falls and then find
  // nowhere safer to retreat to, leaving the hero asleep standing on the
  // very tile the orb landed on. Walking never carries the hero onto a tile
  // they're already on, so the ordinary onEnter pickup would never fire —
  // tapping their own feet has to work instead.
  const seal: Seal = { id: 'seal1', pos: SEAL_POS, open: false, lock: { kind: 'orb', socket: SOCKET_POS, placed: false } };
  const g = wingGame(seal, { x: 4, y: 4 });
  const st = g.state;
  const hero = st.hero;
  st.level.orbs = [{ id: 'orb1', pos: { x: 4, y: 4 }, home: { x: 4, y: 4 }, sealId: 'seal1', state: 'floor' }];
  const orb = st.level.orbs[0];

  g.pointerAt(hero.pos);
  assert.equal(hero.carrying, 'orb1', 'tapping your own feet picks it up');
  assert.equal(orb.state, 'carried');
  assert.ok(st.sfx.includes('orbLift'));

  // Already carrying: tapping your own tile again is just a no-op, same as
  // ever tapping the tile you stand on.
  st.sfx.length = 0;
  g.pointerAt(hero.pos);
  assert.equal(hero.carrying, 'orb1');
  assert.equal(st.sfx.length, 0);
});

function hiddenAtWing(level: LevelData, p: Vec): boolean {
  return (level.passages ?? [])[0].tiles.some((t) => t.x === p.x && t.y === p.y);
}

test('a keystone seal takes the relic it is carved with and nothing else', () => {
  const seal: Seal = { id: 'seal1', pos: SEAL_POS, open: false, lock: { kind: 'keystone', relic: 'moon' } };
  const g = wingGame(seal, { x: 6, y: 4 });
  const st = g.state;
  const hero = st.hero;
  hero.relics = ['sun'];
  step(g, SEAL_POS);
  assert.equal(seal.open, false, 'the wrong relic does nothing');
  assert.deepEqual(hero.relics, ['sun']);
  hero.relics = ['sun', 'moon'];
  step(g, SEAL_POS);
  assert.equal(seal.open, true);
  assert.deepEqual(hero.relics, ['sun'], 'the moon stone is spent, the sun stone kept');
  assert.ok(st.log.some((l) => l.text.includes('Moon Stone fits')));
});

test('a relic is picked up off the floor and carried for the run', () => {
  const g = wingGame(null, { x: 4, y: 4 });
  const st = g.state;
  st.level.relics = [{ id: 'relic1', pos: { x: 5, y: 3 }, kind: 'star', taken: false }];
  step(g, { x: 5, y: 4 });
  step(g, { x: 5, y: 3 });
  assert.deepEqual(st.hero.relics, ['star']);
  assert.equal(st.level.relics[0].taken, true);
  assert.ok(st.sfx.includes('relic'));
  // It survives the stairs: the hero, not the floor, carries it.
  st.hero.pos = { x: 11, y: 7 };
  st.hero.rpos = { x: 11, y: 7 };
  st.hero.lens = null;
  step(g, { x: 12, y: 7 });
  g.tick(1000);
  assert.equal(st.depth, 2);
  assert.deepEqual(st.hero.relics, ['star']);
});

test('a mimic springs when bumped: no key spent, the chest gone, a hunter in its place', () => {
  const g = wingGame(null, { x: 4, y: 4 });
  const st = g.state;
  const hero = st.hero;
  hero.keys.chest = 1;
  st.level.chests = [{ id: 'v1', pos: { x: 5, y: 4 }, opened: false, loot: { gold: 0, xp: 0 }, mimic: true }];
  const hp = hero.hp;
  g.pointerAt({ x: 5, y: 4 });
  assert.equal(st.path.length, 1, 'a chest is a legal drag target, mimic or not');
  g.tick(150);
  assert.equal(hero.keys.chest, 1, 'no key is spent on a mimic');
  assert.equal(st.level.chests.length, 0, 'the chest is gone');
  assert.equal(st.modal, null, 'no chest popup');
  const mimic = st.level.monsters.find((m) => m.kind === 'mimic');
  assert.ok(mimic, 'a mimic stands where it was');
  assert.deepEqual(mimic?.pos, { x: 5, y: 4 });
  assert.equal(mimic?.state, 'chasing');
  assert.ok(st.sfx.includes('mimic'));
  assert.ok(st.log.some((l) => l.text.includes('mimic')));
  // It bites — in the very tick it springs, since the hero is standing right
  // there with a hand out.
  assert.ok(hero.hp < hp || hero.sleeping, 'a mimic fights back');
});

test('a wing chest opens with no key: the wing itself was the lock', () => {
  const g = wingGame(null, { x: 4, y: 4 });
  const st = g.state;
  const hero = st.hero;
  hero.keys.chest = 0;
  st.level.chests = [
    { id: 'v1', pos: { x: 5, y: 4 }, opened: false, loot: { gold: 5, xp: 5 }, secret: true },
  ];
  g.pointerAt({ x: 5, y: 4 });
  g.tick(150);
  assert.equal(st.level.chests[0].opened, true, 'opened despite no chest key');
  assert.equal(hero.keys.chest, 0, 'no key spent on a wing chest');
  assert.ok(!st.sfx.includes('locked'), 'no locked cue');
});

test('a mimic is a monster of the wing: it never follows the hero out', () => {
  const g = wingGame(null, { x: 4, y: 4 });
  const st = g.state;
  const mimic = makeMimic(3, makeRng(1), { x: 4, y: 3 }, 'mimic1');
  mimic.state = 'chasing';
  mimic.chaseFrom = { x: 4, y: 3 };
  st.level.monsters = [mimic];
  assert.ok(mimic.level >= 5, 'a mimic sits well over the floor');
  assert.ok(mimic.gold >= 30, 'and pays like the chest it pretended to be');
  st.hero.pos = { x: 4, y: 1 };
  st.hero.rpos = { x: 4, y: 1 };
  for (let i = 0; i < 40; i++) updateMonsters(st, 200, makeRng(i));
  assert.ok(hiddenAtWing(st.level, mimic.pos), 'it stays behind the wall');
});

test('beating a boss leaves a trophy in the pack', () => {
  const g = Game.forTest(99);
  const st = g.state;
  st.depth = 3;
  st.level = {
    ...mkWing(['#####', '#S.E#', '#####']),
    kind: 'boss',
    depth: 3,
    boss: { kind: 'minotaur', defeated: false },
    passages: [],
  };
  st.hero.pos = { x: 2, y: 1 };
  st.hero.rpos = { x: 2, y: 1 };
  st.trail = new Set([key(st.hero.pos)]);
  st.path = [];
  st.descending = 0;
  step(g, { x: 3, y: 1 });
  assert.deepEqual(st.hero.trophies, ['minotaur']);
  assert.ok(st.log.some((l) => l.text.includes("Minotaur's Horn")));
});

test('an altar takes the trophy it is carved for and hands over a boon, now and for the next runs', () => {
  const g = wingGame(null, { x: 4, y: 4 });
  const st = g.state;
  const hero = st.hero;
  // Read through the game each time: `assert.equal` narrows whatever it is
  // handed, and a modal that changes under it would otherwise read as never.
  const modalKind = (): string => g.state.modal?.kind ?? 'none';
  st.level.altars = [{ id: 'altar1', pos: { x: 5, y: 4 }, trophy: 'necromancer', used: false }];

  // Without the trophy: the carving is all it says.
  step(g, { x: 5, y: 4 });
  assert.deepEqual(hero.pos, { x: 4, y: 4 }, 'an altar is solid');
  assert.equal(modalKind(), 'none');
  assert.ok(st.log.some((l) => l.text.includes('carved with a skull')));

  // With it: the popup asks, and offering it pays out.
  hero.trophies = ['necromancer'];
  step(g, { x: 5, y: 4 });
  assert.equal(modalKind(), 'altar');
  const maxHp = hero.maxHp;
  g.offerTrophy();
  assert.deepEqual(hero.trophies, [], 'the trophy is spent');
  assert.equal(st.level.altars[0].used, true);
  assert.equal(hero.maxHp, maxHp + DEATHLESS_HEARTS * HEART, "the boon is the hero's now");
  assert.equal(modalKind(), 'boon');
  assert.deepEqual(st.boons, [{ kind: 'deathless', runsLeft: BOON_RUNS - 1 }]);
  assert.ok(st.sfx.includes('altar'));
  g.dismissModal();
  // A spent altar is scenery.
  step(g, { x: 5, y: 4 });
  assert.equal(modalKind(), 'none');
});

test('a boon carries into the next runs and breaks after its last', () => {
  let boons: Boon[] = [{ kind: 'vigor', runsLeft: 2 }, { kind: 'grace', runsLeft: 1 }];
  const base = newHero();
  // Run one: both apply.
  let g = Game.forTest(5, boons);
  assert.equal(g.state.hero.atk, base.atk + VIGOR_ATK);
  assert.equal(g.state.hero.spirit, base.spirit + 2, "angel's grace adds spirit");
  assert.equal(g.state.hero.potionCapacity, base.potionCapacity + 1, "angel's grace hands over a potion");
  assert.equal(g.state.hero.potions, base.potions + 1);
  assert.deepEqual(g.state.boons, [{ kind: 'vigor', runsLeft: 1 }, { kind: 'grace', runsLeft: 0 }]);
  // What spendBoons keeps for the run after is what Game wrote back.
  const spent = spendBoons(boons, newHero());
  assert.deepEqual(spent.keep, [{ kind: 'vigor', runsLeft: 1 }]);
  boons = spent.keep;
  g = Game.forTest(6, boons);
  assert.equal(g.state.hero.spirit, base.spirit, "angel's grace has broken");
  assert.equal(g.state.hero.atk, base.atk + VIGOR_ATK);
  assert.deepEqual(spendBoons(boons, newHero()).keep, [], 'and vigor after this one');
  // A boon with no runs left is ignored, and duplicates apply once.
  const h = newHero();
  const { active } = spendBoons([{ kind: 'vigor', runsLeft: 0 }, { kind: 'deathless', runsLeft: 3 }, { kind: 'deathless', runsLeft: 1 }], h);
  assert.deepEqual(active, [{ kind: 'deathless', runsLeft: 2 }]);
  assert.equal(h.maxHp, newHero().maxHp + DEATHLESS_HEARTS * HEART);
  // applyBoon hands the hero the numbers directly.
  const beforeSpirit = h.spirit;
  applyBoon(h, 'grace', 4);
  assert.equal(h.spirit, beforeSpirit + 2);
});

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

function useMemStorage(): MemStorage {
  const mem = new MemStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
  return mem;
}

test('boons live beside the save and outlive it; relics and trophies ride in it', () => {
  useMemStorage();
  saveBoons([{ kind: 'deathless', runsLeft: 2 }]);
  assert.deepEqual(loadBoons(), [{ kind: 'deathless', runsLeft: 2 }]);
  // A fresh Game reads them, applies them and writes back one run fewer.
  const g = new Game(null);
  assert.equal(g.state.hero.maxHp, newHero().maxHp + DEATHLESS_HEARTS * HEART);
  assert.deepEqual(loadBoons(), [{ kind: 'deathless', runsLeft: 1 }]);
  assert.deepEqual(g.state.boons, [{ kind: 'deathless', runsLeft: 1 }]);

  g.state.hero.relics = ['sun'];
  g.state.hero.trophies = ['angels'];
  saveGame(g.state);
  const loaded = loadGame();
  assert.ok(loaded);
  assert.deepEqual(loaded?.hero.relics, ['sun']);
  assert.deepEqual(loaded?.hero.trophies, ['angels']);
  assert.deepEqual(loaded?.boons, [{ kind: 'deathless', runsLeft: 1 }]);
  clearSave();
  assert.deepEqual(loadBoons(), [{ kind: 'deathless', runsLeft: 1 }], 'clearing the save leaves the boons');
  saveBoons([]);
  assert.deepEqual(loadBoons(), []);
});

test('by the middle of the run a wing has more floor in it than the maze it hangs off', () => {
  const grew: number[] = [];
  for (const depth of [2, 5, 8, 12, 16, 21]) {
    const lv = generateLevel(depth, 4242, depth);
    const hidden = new Set(passageTilesOf(lv).map(key));
    let mazeFloor = 0;
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) if (isFloor(lv, { x, y }) && !hidden.has(key({ x, y }))) mazeFloor++;
    grew.push(hidden.size / mazeFloor);
  }
  for (let i = 1; i < grew.length; i++) assert.ok(grew[i] >= grew[i - 1] * 0.9, `wings should grow with the floor: ${grew.map((g) => g.toFixed(2)).join(' ')}`);
  assert.ok(grew[grew.length - 1] > 0.85, `the deepest wing should rival the maze: ${grew[grew.length - 1].toFixed(2)}`);
});

test('the wing\'s own stairs go down like any other, and nobody stands on them', () => {
  const g = wingGame(null, { x: 9, y: 4 });
  const st = g.state;
  st.level.wingExit = { x: 10, y: 4 };
  const m = makeMonster('patrol', 1, makeRng(3), { x: 9, y: 3 }, 'm1');
  m.patrolPath = [{ x: 9, y: 3 }, { x: 10, y: 3 }, { x: 10, y: 4 }];
  m.patrolIndex = 0;
  m.patrolDir = 1;
  st.level.monsters = [m];
  updateMonsters(st, 500, makeRng(1));
  updateMonsters(st, 500, makeRng(2));
  assert.notDeepEqual(m.pos, { x: 10, y: 4 }, 'a monster never steps onto the stairs');
  step(g, { x: 10, y: 4 });
  assert.ok(st.descending > 0, 'the wing stairs start the descent');
  g.tick(1000);
  assert.equal(st.depth, 2);
  assert.equal(st.hero.carrying, null);
});

// ---------------------------------------------------------------------------
// The forge, and the chest that asks
// ---------------------------------------------------------------------------

function shopGame(gold: number): Game {
  const g = Game.forTest(2024);
  const st = g.state;
  st.depth = 3;
  st.level = generateShopLevel(3, st.seed, st.hero);
  st.hero.gold = gold;
  const at = { x: FORGE_TILE.x, y: FORGE_TILE.y + 2 };
  st.hero.pos = { ...at };
  st.hero.rpos = { ...at };
  st.trail = new Set([key(at)]);
  st.path = [];
  st.descending = 0;
  return g;
}

test('the forge stands under the podiums and raises a worn item a level for gold', () => {
  const g = shopGame(9999);
  const st = g.state;
  const hero = st.hero;
  const level = st.level;
  assert.ok(forgeAt(level, FORGE_TILE), 'the forge is where it should be');
  assert.ok(forgeAt(level, { x: FORGE_TILE.x + 1, y: FORGE_TILE.y + 1 }), 'all four tiles');
  assert.equal(forgeAt(level, { x: FORGE_TILE.x - 1, y: FORGE_TILE.y }), null);

  // Wearing nothing: the popup opens and offers nothing.
  step(g, { x: FORGE_TILE.x, y: FORGE_TILE.y + 1 });
  assert.deepEqual(hero.pos, { x: FORGE_TILE.x, y: FORGE_TILE.y + 2 }, 'the forge is solid');
  let modal = st.modal as Extract<Modal, { kind: 'shopForge' }>;
  assert.equal(modal.kind, 'shopForge');
  assert.equal(modal.offers.length, 0);
  g.buyUpgrade('offense');
  assert.equal(hero.gold, 9999, 'nothing to upgrade, nothing paid');
  g.dismissModal();

  // Wearing a sword: one row, priced, and buying it is the forge's own purchase.
  const sword: MagicItem = { kind: 'longSword', level: 3 };
  equip(hero, sword);
  step(g, { x: FORGE_TILE.x, y: FORGE_TILE.y + 1 });
  modal = st.modal as Extract<Modal, { kind: 'shopForge' }>;
  assert.equal(modal.offers.length, 1);
  assert.equal(modal.offers[0].price, upgradePrice(sword));
  assert.ok(upgradePrice(sword) < itemPrice('longSword', 4), 'cheaper than buying the next level new');
  g.buyUpgrade('offense');
  assert.equal(sword.level, 4);
  assert.equal(hero.gear.offense?.level, 4);
  assert.equal(hero.gold, 9999 - upgradePrice({ kind: 'longSword', level: 3 }));
  assert.equal(level.shop?.boughtUpgrade, true);
  assert.equal(level.shop?.boughtItem, false, 'a podium purchase is still open');
  assert.equal(st.modal?.kind, 'upgraded');
  assert.ok(st.sfx.includes('forge'));
  g.dismissModal();

  // The podiums are not sold out: using the forge does not spend a podium's
  // one item, so a hero may buy both in the same visit.
  const offer = level.shop?.offers[0];
  assert.ok(offer);
  g.buyOffer(offer!.id);
  assert.equal(hero.gear[ITEM_SLOT[offer!.item.kind]]?.kind, offer!.item.kind, 'the podium still sells after the forge is used');
  assert.equal(level.shop?.boughtItem, true);

  // But the forge itself is spent: a second upgrade is refused.
  const goldBeforeSecondUpgrade = hero.gold;
  g.buyUpgrade('offense');
  assert.equal(hero.gold, goldBeforeSecondUpgrade, 'the forge already sold its one upgrade');
});

test('the forge refuses a short purse', () => {
  const g = shopGame(0);
  const st = g.state;
  const worn: MagicItem = { kind: 'goldCharm', level: 2 };
  equip(st.hero, worn);
  step(g, { x: FORGE_TILE.x, y: FORGE_TILE.y + 1 });
  g.buyUpgrade('spirit');
  assert.equal(worn.level, 2);
  assert.equal(st.level.shop?.boughtUpgrade, false);
  assert.equal(st.modal?.kind, 'shopForge', 'the popup stays up');
});

function chestGame(magic: MagicItem, worn: MagicItem | null): Game {
  const g = Game.forTest(1234);
  const st = g.state;
  st.level = mkWing(['#####', '#S..#', '#####']);
  st.level.passages = [];
  st.level.chests = [{ id: 'c1', pos: { x: 3, y: 1 }, opened: false, loot: { gold: 10, xp: 1, magic } }];
  st.depth = 1;
  if (worn) equip(st.hero, worn);
  st.hero.pos = { x: 2, y: 1 };
  st.hero.rpos = { x: 2, y: 1 };
  st.hero.keys.chest = 1;
  st.trail = new Set([key(st.hero.pos)]);
  st.path = [];
  st.descending = 0;
  return g;
}

test('a magic item goes straight into an empty slot, but asks before pushing something out', () => {
  const g = chestGame({ kind: 'fireStaff', level: 2 }, null);
  step(g, { x: 3, y: 1 });
  assert.equal(g.state.hero.gear.offense?.kind, 'fireStaff');
  const modal = g.state.modal as Extract<Modal, { kind: 'chest' }>;
  assert.equal(modal.kind, 'chest');
  assert.equal(modal.choice, null);

  const g2 = chestGame({ kind: 'fireStaff', level: 2 }, { kind: 'longSword', level: 5 });
  step(g2, { x: 3, y: 1 });
  const st = g2.state;
  assert.equal(st.hero.gear.offense?.kind, 'longSword', 'nothing is worn until the player says');
  const asked = st.modal as Extract<Modal, { kind: 'chest' }>;
  assert.equal(asked.choice?.magic.kind, 'fireStaff');
  assert.equal(asked.choice?.replaces.kind, 'longSword');
  assert.ok((asked.choice?.sellGold ?? 0) > 0);
  g2.takeMagic();
  assert.equal(st.hero.gear.offense?.kind, 'fireStaff');
  assert.equal(st.modal?.kind, 'item');

  const g3 = chestGame({ kind: 'fireStaff', level: 2 }, { kind: 'longSword', level: 5 });
  step(g3, { x: 3, y: 1 });
  const gold = g3.state.hero.gold;
  const sell = (g3.state.modal as Extract<Modal, { kind: 'chest' }>).choice?.sellGold ?? 0;
  g3.sellMagic();
  assert.equal(g3.state.hero.gear.offense?.kind, 'longSword');
  assert.equal(g3.state.hero.gold, gold + sell);
  assert.equal(g3.state.modal, null);

  // Closing the popup without answering keeps the gear as it is.
  const g4 = chestGame({ kind: 'fireStaff', level: 2 }, { kind: 'longSword', level: 5 });
  step(g4, { x: 3, y: 1 });
  g4.dismissModal();
  assert.equal(g4.state.hero.gear.offense?.kind, 'longSword');
  assert.equal(g4.state.modal, null);
});

test('a wing chest is solid where it stands, and the treasure guard stands over it', () => {
  const lv = generateLevel(4, 42, 4);
  const wing = (lv.passages ?? [])[0];
  const chest = lv.chests.find((c) => c.loot.magic);
  assert.ok(chest);
  const treasure = wing.rooms[wing.treasure];
  const guard = lv.monsters.find((m) => inRect(treasure, m.pos) && m.kind === 'guard');
  assert.ok(guard);
  assert.ok(isFloor(lv, chest!.pos));
  assert.ok(guard!.level > lv.depth, 'a wing guard is over the floor');
});
