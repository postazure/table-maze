import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HEART, ITEM_KINDS, ITEM_SLOT, Tile } from '../src/engine/types';
import type { Hero, ItemSlot, MagicItem } from '../src/engine/types';
import { makeRng } from '../src/engine/rng';
import { applyLevelUp, newHero, spiritForLevel } from '../src/engine/balance';
import {
  NEUTRAL,
  equip,
  hasItem,
  heroMoveMs,
  heroStats,
  itemName,
  itemPrice,
  itemStats,
  itemDescription,
  kindsForSlot,
  reviveGear,
  rollShopOffers,
  spiritSlotBonus,
  upgradeRandomItem,
} from '../src/engine/items';
import { PEDESTAL_SIZE, PEDESTAL_TILES, SHOP_MARGIN, generateShopLevel, offerAt, offerTiles } from '../src/engine/shop';

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

test('generateShopLevel builds the podium room', () => {
  const hero = newHero();
  const level = generateShopLevel(6, 1234, hero);

  assert.equal(level.kind, 'shop');
  assert.equal(level.depth, 6);
  assert.equal(level.width, 16 + SHOP_MARGIN);
  assert.equal(level.height, 15);
  assert.deepEqual(level.start, { x: 7 + SHOP_MARGIN, y: 13 });
  assert.deepEqual(level.exit, { x: 7 + SHOP_MARGIN, y: 1 });
  assert.deepEqual(level.keys, []);
  assert.deepEqual(level.doors, []);
  assert.deepEqual(level.chests, []);
  assert.deepEqual(level.monsters, [], 'a shop is a safe room');

  // Outer walls all round a 14 x 13 floor, plus the margin the bench alcove
  // is dug from on the left.
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
  // The room's own floor, plus the bench alcove's two hidden tiles.
  assert.equal(floors, 14 * 13 + 2);

  // Three podiums, one per slot, left to right.
  const shop = level.shop;
  assert.ok(shop);
  assert.equal(shop.boughtItem, false);
  assert.equal(shop.boughtUpgrade, false);
  assert.equal(shop.offers.length, 3);
  const slots: ItemSlot[] = ['offense', 'defense', 'spirit'];
  shop.offers.forEach((o, i) => {
    assert.equal(o.id, `s${i + 1}`);
    assert.deepEqual(o.pos, PEDESTAL_TILES[i]);
    assert.equal(ITEM_SLOT[o.item.kind], slots[i]);
    assert.equal(o.item.level, 6, 'items scale with the depth just finished');
    assert.equal(o.price, itemPrice(o.item.kind, 6));
    // Every tile of the 2x2 block belongs to the podium.
    for (const tile of offerTiles(o)) assert.equal(offerAt(level, tile)?.id, o.id);
    assert.equal(offerTiles(o).length, PEDESTAL_SIZE * PEDESTAL_SIZE);
  });

  // Two clear tiles between neighbouring podiums, and clear floor all round.
  for (let i = 1; i < shop.offers.length; i++) {
    const gap: number = shop.offers[i].pos.x - (shop.offers[i - 1].pos.x + PEDESTAL_SIZE);
    assert.equal(gap, 2, 'podiums stand two tiles apart');
  }
  for (const x of [5, 6, 9, 10].map((x) => x + SHOP_MARGIN)) {
    assert.equal(offerAt(level, { x, y: 5 }), null, 'the aisles between podiums stay walkable');
    assert.equal(offerAt(level, { x, y: 6 }), null);
  }
  assert.equal(offerAt(level, { x: 3 + SHOP_MARGIN, y: 4 }), null, 'nothing above the blocks');
  assert.equal(offerAt(level, { x: 3 + SHOP_MARGIN, y: 7 }), null, 'nothing below the blocks');

  // Deterministic for a (depth, seed, hero) triple.
  const again = generateShopLevel(6, 1234, newHero());
  assert.deepEqual(
    again.shop?.offers.map((o) => o.item.kind),
    shop.offers.map((o) => o.item.kind),
  );
});

test('every item has a description that mentions its real numbers', async () => {
  const { itemDescription, itemStats } = await import('../src/engine/items');
  const { ITEM_KINDS } = await import('../src/engine/types');
  for (const kind of ITEM_KINDS) {
    for (const level of [1, 4, 9]) {
      const text = itemDescription({ kind, level });
      assert.ok(text.length > 20, `${kind} has a description`);
      assert.ok(/\d/.test(text) || kind === 'keyCompass', `${kind} description carries a number`);
    }
  }
  const lvl9 = itemStats({ kind: 'fireStaff', level: 9 });
  assert.ok(itemDescription({ kind: 'fireStaff', level: 9 }).includes(String(lvl9.fireDmg)));
});


// ---------------------------------------------------------------------------
// Spirit
// ---------------------------------------------------------------------------

test('spirit starts at one and creeps up every third level', () => {
  assert.equal(spiritForLevel(1), 1);
  assert.equal(spiritForLevel(2), 1);
  assert.equal(spiritForLevel(3), 2);
  assert.equal(spiritForLevel(9), 4);
  // It grows, but nowhere near as fast as attack: the point is a nudge, not a
  // third combat stat.
  assert.ok(spiritForLevel(20) < 10);

  const hero = newHero();
  assert.equal(hero.spirit, spiritForLevel(1));
  hero.xp = hero.xpToNext;
  applyLevelUp(hero);
  assert.equal(hero.spirit, spiritForLevel(hero.level));
});

test('every spirit-slot item carries spirit, and no other slot does', () => {
  for (const kind of ITEM_KINDS) {
    const s = itemStats(item(kind, 6));
    if (ITEM_SLOT[kind] === 'spirit') {
      assert.equal(s.spiritBonus, spiritSlotBonus(6), `${kind} should carry spirit`);
      assert.ok(s.spiritBonus > 0);
    } else {
      assert.equal(s.spiritBonus, 0, `${kind} is not a spirit item`);
    }
  }
});

test('equipping, replacing and upgrading a spirit item all move the stat', () => {
  const hero = newHero();
  const base = hero.spirit;

  equip(hero, item('goldCharm', 6));
  assert.equal(hero.spirit, base + spiritSlotBonus(6));

  // Swapping within the slot takes the old bonus off before adding the new.
  equip(hero, item('xpTome', 1));
  assert.equal(hero.spirit, base + spiritSlotBonus(1));

  // A boss upgrade re-applies at the new level. The spirit slot is the only
  // one filled, so it is the one that gets the bump.
  const worn = hero.gear.spirit as MagicItem;
  assert.equal(upgradeRandomItem(hero, makeRng(3)), worn);
  assert.equal(worn.level, 2);
  assert.equal(hero.spirit, base + spiritSlotBonus(2));

  // And an item in another slot leaves spirit alone.
  const before = hero.spirit;
  equip(hero, item('longSword', 9));
  assert.equal(hero.spirit, before);
});

test('a hero loaded from before the stat existed gets their spirit rebuilt', () => {
  const hero = newHero();
  equip(hero, item('vampireFang', 7));
  const expected = hero.spirit;

  // A save written before spirit existed: the field is simply absent.
  delete (hero as Partial<Hero>).spirit;
  reviveGear(hero);
  assert.equal(hero.spirit, expected, 'level curve plus the worn item');
  assert.equal(hero.spirit, spiritForLevel(hero.level) + spiritSlotBonus(7));
});

test('a spirit item says what it does for shrines', () => {
  const text = itemDescription(item('keyCompass', 6));
  assert.ok(/spirit/i.test(text), 'a spirit item mentions spirit');
  assert.ok(/shrine/i.test(text), '...and what spirit is for');
  assert.ok(!/spirit/i.test(itemDescription(item('longSword', 6))), 'other slots do not');
});
