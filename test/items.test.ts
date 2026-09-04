import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HEART, ITEM_KINDS, ITEM_SLOT, Tile } from '../src/engine/types';
import type { Hero, ItemSlot, MagicItem } from '../src/engine/types';
import { makeRng } from '../src/engine/rng';
import { newHero } from '../src/engine/balance';
import {
  NEUTRAL,
  equip,
  hasItem,
  heroMoveMs,
  heroStats,
  itemName,
  itemPrice,
  itemStats,
  kindsForSlot,
  rollShopOffers,
} from '../src/engine/items';
import { PEDESTAL_TILES, generateShopLevel, offerAt } from '../src/engine/shop';

function item(kind: MagicItem['kind'], level = 1): MagicItem {
  return { kind, level };
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

test('every item kind has a slot, a name and a price', () => {
  const slots: ItemSlot[] = ['offense', 'defense', 'spirit'];
  for (const kind of ITEM_KINDS) {
    const slot = ITEM_SLOT[kind];
    assert.ok(slots.includes(slot), `${kind} has a slot`);
    const name = itemName(kind);
    assert.ok(name.length > 0, `${kind} has a name`);
    assert.notEqual(name, kind, `${kind} has a human name`);
    for (const level of [1, 3, 7, 12]) {
      const price = itemPrice(kind, level);
      assert.ok(price > 0, `${kind} costs something at ${level}`);
      assert.equal(price % 5, 0, 'prices are round numbers of gold');
    }
  }
  // Every slot offers a real choice, and each list is complete.
  assert.equal(kindsForSlot('offense').length + kindsForSlot('defense').length + kindsForSlot('spirit').length, ITEM_KINDS.length);
  for (const slot of slots) assert.ok(kindsForSlot(slot).length >= 6);
});

test('prices grow with depth; spirit is cheaper than offense', () => {
  assert.ok(itemPrice('longSword', 6) > itemPrice('longSword', 1));
  assert.ok(itemPrice('goldCharm', 6) < itemPrice('longSword', 6));
  // Reachable: three floors of chests (5-15 gold x depth) easily cover one.
  assert.ok(itemPrice('longSword', 3) <= 3 * 10 * 3);
});

test('itemStats fills in the item and leaves everything else neutral', () => {
  const sword = itemStats(item('longSword', 6));
  assert.equal(sword.reach, 2);
  assert.equal(sword.atkBonus, 2);
  assert.equal(sword.goldMult, NEUTRAL.goldMult, 'multipliers stay 1');
  assert.equal(sword.fireDmg, 0);
  assert.equal(sword.knockbackImmune, false);
  assert.equal(sword.compass, false);

  const charm = itemStats(item('goldCharm', 4));
  assert.ok(Math.abs(charm.goldMult - 1.7) < 1e-9);
  assert.equal(charm.xpMult, 1);
  assert.equal(charm.reach, NEUTRAL.reach, 'a charm does not lengthen your arm');
  assert.equal(charm.atkBonus, 0);

  const staff = itemStats(item('fireStaff', 3));
  assert.equal(staff.fireIntervalMs, 4800);
  assert.equal(staff.fireDmg, 5);
  assert.equal(staff.fireRange, 6);

  const boots = itemStats(item('speedBoots', 1));
  assert.equal(boots.moveMs, 100);
  assert.equal(itemStats(item('speedBoots', 6)).moveMs, 90);

  const phoenix = itemStats(item('phoenixFeather', 20));
  assert.equal(phoenix.phoenixCooldownMs, 10000, 'cooldown bottoms out at 10s');
  assert.equal(itemStats(item('shieldAmulet', 30)).shieldRechargeMs, 3000);
  assert.ok(itemStats(item('lightningWand', 40)).chainChance <= 0.7);

  // A neutral hero reads neutral.
  assert.deepEqual(heroStats(newHero()), NEUTRAL);
});

// ---------------------------------------------------------------------------
// Equipping
// ---------------------------------------------------------------------------

test('equip applies constant bonuses and takes the old ones back off', () => {
  const hero = newHero();
  const hp0 = hero.hp;
  const max0 = hero.maxHp;

  const replacedNothing = equip(hero, item('lifeAmulet', 4));
  assert.equal(replacedNothing, null);
  assert.equal(hero.maxHp, max0 + 2 * HEART, 'two extra hearts at level 4');
  assert.equal(hero.hp, hp0 + 2 * HEART, 'and they come filled');
  assert.equal(hero.gear.spirit?.kind, 'lifeAmulet');
  assert.ok(hasItem(hero, 'lifeAmulet'));
  assert.equal(hasItem(hero, 'goldCharm'), null);

  // Same slot: the amulet's hearts come back off before the charm goes on.
  const replaced = equip(hero, item('goldCharm', 4));
  assert.equal(replaced?.kind, 'lifeAmulet');
  assert.equal(hero.maxHp, max0);
  assert.equal(hero.hp, hp0);
  assert.equal(hero.gear.spirit?.kind, 'goldCharm');
  assert.equal(hasItem(hero, 'lifeAmulet'), null);

  // Defense: stone ring's def, then swapped out for boots.
  const def0 = hero.def;
  equip(hero, item('stoneRing', 8));
  assert.equal(hero.def, def0 + 3);
  assert.equal(heroStats(hero).knockbackImmune, true);
  const out = equip(hero, item('speedBoots', 8));
  assert.equal(out?.kind, 'stoneRing');
  assert.equal(hero.def, def0, 'the ring took its defense with it');
  assert.equal(heroStats(hero).knockbackImmune, false);
  assert.equal(heroMoveMs(hero), 90);

  // Offense: attack bonus on and off again.
  const atk0 = hero.atk;
  equip(hero, item('longSword', 9));
  assert.equal(hero.atk, atk0 + 3);
  equip(hero, item('fireStaff', 9));
  assert.equal(hero.atk, atk0);
});

test('equip never leaves the hero over-healed and resets the slot timers', () => {
  const hero = newHero();
  equip(hero, item('lifeAmulet', 4));
  hero.hp = hero.maxHp;
  equip(hero, item('xpTome', 4));
  assert.equal(hero.hp, hero.maxHp, 'hp is clamped when the hearts leave');

  hero.shieldReady = true;
  hero.timers.shield = 4000;
  hero.timers.phoenix = 9000;
  equip(hero, item('thornMail', 2));
  assert.equal(hero.shieldReady, false);
  assert.equal(hero.timers.shield, 0);
  assert.equal(hero.timers.phoenix, 0);

  hero.timers.fire = 3000;
  equip(hero, item('fireStaff', 2));
  assert.equal(hero.timers.fire, 0);
});

// ---------------------------------------------------------------------------
// Shop rolls and shop levels
// ---------------------------------------------------------------------------

test('rollShopOffers gives one item per slot at the shop depth', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const offers = rollShopOffers(5, makeRng(seed), { offense: null, defense: null, spirit: null });
    assert.equal(offers.length, 3);
    assert.equal(ITEM_SLOT[offers[0].kind], 'offense');
    assert.equal(ITEM_SLOT[offers[1].kind], 'defense');
    assert.equal(ITEM_SLOT[offers[2].kind], 'spirit');
    for (const o of offers) assert.equal(o.level, 5);
  }
});

test('rollShopOffers avoids what the hero already wears', () => {
  const owned: Hero['gear'] = {
    offense: item('longSword', 3),
    defense: item('speedBoots', 3),
    spirit: item('goldCharm', 3),
  };
  for (let seed = 1; seed <= 40; seed++) {
    const offers = rollShopOffers(3, makeRng(seed), owned);
    assert.notEqual(offers[0].kind, 'longSword');
    assert.notEqual(offers[1].kind, 'speedBoots');
    assert.notEqual(offers[2].kind, 'goldCharm');
  }
});

test('generateShopLevel builds the pedestal room', () => {
  const hero = newHero();
  const level = generateShopLevel(6, 1234, hero);

  assert.equal(level.kind, 'shop');
  assert.equal(level.depth, 6);
  assert.equal(level.width, 11);
  assert.equal(level.height, 13);
  assert.deepEqual(level.start, { x: 5, y: 11 });
  assert.deepEqual(level.exit, { x: 5, y: 1 });
  assert.deepEqual(level.keys, []);
  assert.deepEqual(level.doors, []);
  assert.deepEqual(level.chests, []);
  assert.deepEqual(level.monsters, [], 'a shop is a safe room');

  // Outer walls all round a 9 x 11 floor.
  for (let x = 0; x < level.width; x++) {
    assert.equal(level.tiles[0][x], Tile.Wall);
    assert.equal(level.tiles[level.height - 1][x], Tile.Wall);
  }
  for (let y = 0; y < level.height; y++) {
    assert.equal(level.tiles[y][0], Tile.Wall);
    assert.equal(level.tiles[y][level.width - 1], Tile.Wall);
  }
  let floors = 0;
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) if (level.tiles[y][x] === Tile.Floor) floors += 1;
  }
  assert.equal(floors, 9 * 11);

  // Three pedestals, one per slot, left to right.
  const shop = level.shop;
  assert.ok(shop);
  assert.equal(shop.bought, false);
  assert.equal(shop.offers.length, 3);
  const slots: ItemSlot[] = ['offense', 'defense', 'spirit'];
  shop.offers.forEach((o, i) => {
    assert.equal(o.id, `s${i + 1}`);
    assert.deepEqual(o.pos, PEDESTAL_TILES[i]);
    assert.equal(ITEM_SLOT[o.item.kind], slots[i]);
    assert.equal(o.item.level, 6, 'items scale with the depth just finished');
    assert.equal(o.price, itemPrice(o.item.kind, 6));
    assert.equal(offerAt(level, o.pos)?.id, o.id);
  });
  assert.equal(offerAt(level, { x: 4, y: 4 }), null);

  // Deterministic for a (depth, seed, hero) triple.
  const again = generateShopLevel(6, 1234, newHero());
  assert.deepEqual(
    again.shop?.offers.map((o) => o.item.kind),
    shop.offers.map((o) => o.item.kind),
  );
});
