/**
 * Shop levels: the little room the hero walks into after every third maze
 * floor. One small room, three pedestals across the top half, stairs out.
 *
 * No monsters, keys, doors or chests live here: it is a safe breather where
 * the gold from the last three floors turns into one magic item.
 */
import type { Hero, LevelData, ShopOffer, Vec } from './types';
import { Tile } from './types';
import { hashSeed, makeRng } from './rng';
import { ITEM_SLOTS, itemPrice, rollShopOffers } from './items';
import { themeForDepth } from './themes';

/** Shop rooms are always this size (11 x 13 with a 9 x 11 floor). */
export const SHOP_WIDTH = 11;
export const SHOP_HEIGHT = 13;
/** Pedestal tiles, offense / defense / spirit from left to right. */
export const PEDESTAL_TILES: readonly Vec[] = [
  { x: 3, y: 4 },
  { x: 5, y: 4 },
  { x: 7, y: 4 },
];
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
    shop: { offers, bought: false },
    width: SHOP_WIDTH,
    height: SHOP_HEIGHT,
    tiles,
    start: { x: 5, y: SHOP_HEIGHT - 2 },
    exit: { x: 5, y: 1 },
    keys: [],
    doors: [],
    chests: [],
    monsters: [],
  };
}

/** The pedestal standing on `p`, if any. Pedestals are solid like chests. */
export function offerAt(level: LevelData, p: Vec): ShopOffer | null {
  const shop = level.shop;
  if (!shop) return null;
  for (const o of shop.offers) if (o.pos.x === p.x && o.pos.y === p.y) return o;
  return null;
}
