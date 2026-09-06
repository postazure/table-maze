/**
 * Shop levels: the little room the hero walks into after every third maze
 * floor. One room, three pedestals across the middle, stairs out.
 *
 * No monsters, keys, doors or chests live here: it is a safe breather where
 * the gold from the last three floors turns into one magic item.
 *
 * Pedestals are 2x2 tiles so the item on top and its slot emblem read at a
 * glance, and they sit two clear tiles apart so the hero can walk between
 * them without bumping into the wrong one. Below them, in the middle of the
 * room, stands the forge: the same size, and the shop's other offer — a
 * level on something the hero already wears, instead of a new item.
 */
import type { Hero, LevelData, ShopForge, ShopOffer, Vec } from './types';
import { Tile } from './types';
import { hashSeed, makeRng } from './rng';
import { ITEM_SLOTS, itemPrice, rollShopOffers } from './items';
import { themeForDepth } from './themes';

/** Shop rooms are always this size (16 x 15 with a 14 x 13 floor). */
export const SHOP_WIDTH = 16;
export const SHOP_HEIGHT = 15;
/** A pedestal covers PEDESTAL_SIZE x PEDESTAL_SIZE tiles from its `pos`. */
export const PEDESTAL_SIZE = 2;
/**
 * Top-left tile of each pedestal, offense / defense / spirit from left to
 * right. Each block is 2 wide with 2 empty tiles between blocks:
 * `..AA..BB..CC..` across the 14-tile floor.
 */
export const PEDESTAL_TILES: readonly Vec[] = [
  { x: 3, y: 5 },
  { x: 7, y: 5 },
  { x: 11, y: 5 },
];
/** The column the stairs in and the stairs out share. */
const AISLE_X = 7;
/**
 * Top-left tile of the forge: centred under the middle podium, two clear
 * rows below it, so it is the first thing in front of the hero on the way in
 * and there is room to walk round it on either side.
 */
export const FORGE_TILE: Vec = { x: 7, y: 9 };
/** Salt so the shop roll never shares a stream with the maze generator. */
const SHOP_SALT = 4242;

/**
 * The shop visited after finishing `depth`. Items are `level = depth` and the
 * offers avoid what the hero already wears when the slot has an alternative.
 */
export function generateShopLevel(depth: number, runSeed: number, hero: Hero): LevelData {
  const d = Math.max(1, Math.floor(depth));
  const seed = hashSeed(runSeed, d, SHOP_SALT);
  const rng = makeRng(seed);

  const tiles: Tile[][] = [];
  for (let y = 0; y < SHOP_HEIGHT; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < SHOP_WIDTH; x++) {
      const floor = x >= 1 && x <= SHOP_WIDTH - 2 && y >= 1 && y <= SHOP_HEIGHT - 2;
      row.push(floor ? Tile.Floor : Tile.Wall);
    }
    tiles.push(row);
  }

  const items = rollShopOffers(d, rng, hero.gear);
  const offers: ShopOffer[] = ITEM_SLOTS.map((_slot, i) => {
    const item = items[i];
    const tile = PEDESTAL_TILES[i];
    return {
      id: `s${i + 1}`,
      pos: { x: tile.x, y: tile.y },
      item,
      price: itemPrice(item.kind, item.level),
    };
  });

  return {
    depth: d,
    seed,
    kind: 'shop',
    theme: themeForDepth(depth).id,
    shop: { offers, forge: { pos: { x: FORGE_TILE.x, y: FORGE_TILE.y } }, bought: false },
    width: SHOP_WIDTH,
    height: SHOP_HEIGHT,
    tiles,
    start: { x: AISLE_X, y: SHOP_HEIGHT - 2 },
    exit: { x: AISLE_X, y: 1 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
  };
}

/** Does this pedestal stand on `p`? True for any of its four tiles. */
export function offerCovers(offer: ShopOffer, p: Vec): boolean {
  const dx = p.x - offer.pos.x;
  const dy = p.y - offer.pos.y;
  return dx >= 0 && dx < PEDESTAL_SIZE && dy >= 0 && dy < PEDESTAL_SIZE;
}

/** The four tiles a pedestal stands on, reading order. */
export function offerTiles(offer: ShopOffer): Vec[] {
  const out: Vec[] = [];
  for (let dy = 0; dy < PEDESTAL_SIZE; dy++) {
    for (let dx = 0; dx < PEDESTAL_SIZE; dx++) out.push({ x: offer.pos.x + dx, y: offer.pos.y + dy });
  }
  return out;
}

/** Middle of a pedestal block, in fractional tile coordinates. */
export function offerCenter(offer: ShopOffer): Vec {
  const half = (PEDESTAL_SIZE - 1) / 2;
  return { x: offer.pos.x + half, y: offer.pos.y + half };
}

/** The pedestal standing on `p`, if any. Pedestals are solid like chests. */
export function offerAt(level: LevelData, p: Vec): ShopOffer | null {
  const shop = level.shop;
  if (!shop) return null;
  for (const o of shop.offers) if (offerCovers(o, p)) return o;
  return null;
}

/** The forge, if `p` is one of its four tiles. Solid, like a podium. */
export function forgeAt(level: LevelData, p: Vec): ShopForge | null {
  const forge = level.shop?.forge;
  if (!forge) return null;
  const dx = p.x - forge.pos.x;
  const dy = p.y - forge.pos.y;
  return dx >= 0 && dx < PEDESTAL_SIZE && dy >= 0 && dy < PEDESTAL_SIZE ? forge : null;
}

/** Middle of the forge block, in fractional tile coordinates. */
export function forgeCenter(forge: ShopForge): Vec {
  const half = (PEDESTAL_SIZE - 1) / 2;
  return { x: forge.pos.x + half, y: forge.pos.y + half };
}
