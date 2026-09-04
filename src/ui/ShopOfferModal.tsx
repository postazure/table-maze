import type { Modal } from '../engine/types';
import { ITEM_SLOT } from '../engine/types';
import { itemDescription, itemName } from '../engine/items';
import { PixelIcon } from './icons';

/** The 'shopOffer' arm of Modal, pulled out so the props stay readable. */
export type ShopOfferModalData = Extract<Modal, { kind: 'shopOffer' }>;

export interface ShopOfferModalProps {
  offer: ShopOfferModalData;
  onBuy: (offerId: string) => void;
  onClose: () => void;
}

const SLOT_LABEL: Record<string, string> = {
  offense: 'Offense',
  defense: 'Defense',
  spirit: 'Spirit',
};

/**
 * What is on this podium, what it does, and what it costs. Opened by walking
 * into a podium; the game is frozen behind it. Green button buys, red button
 * walks away. The buy button greys out when the shop has already sold its one
 * item or the purse is short, and says which.
 */
export function ShopOfferModal({ offer, onBuy, onClose }: ShopOfferModalProps) {
  const { item, price, gold, replaces, soldOut } = offer;
  const slot = ITEM_SLOT[item.kind];
  const short = gold < price;
  const canBuy = !soldOut && !short;

  return (
    <div className="modal-backdrop modal-ready shop-backdrop" role="dialog" aria-label={`${itemName(item.kind)} for sale`}>
      <div className="shop-modal">
        <div className="shop-head">
          <span className="shop-slot">
            <PixelIcon name={slot} size={14} />
            {SLOT_LABEL[slot] ?? slot}
          </span>
          <span className="shop-head-hint">For sale</span>
        </div>

        <div className="shop-body">
          <div className="shop-item">
            <div className="shop-item-icon">
              <PixelIcon name={item.kind} size={56} />
            </div>
            <div className="shop-item-text">
              <div className="shop-item-name">{itemName(item.kind)}</div>
              <div className="shop-item-level">Lv {item.level}</div>
            </div>
          </div>

          <p className="shop-desc">{itemDescription(item)}</p>

          <div className="shop-swap">
            {replaces ? (
              <>
                <span className="shop-swap-label">Replaces</span>
                <PixelIcon name={replaces.kind} size={16} />
                <span className="shop-swap-name">
                  {itemName(replaces.kind)} <span className="shop-muted">Lv {replaces.level}</span>
                </span>
              </>
            ) : (
              <span className="shop-swap-label">Your {SLOT_LABEL[slot]?.toLowerCase() ?? slot} slot is empty.</span>
            )}
          </div>

          <div className="shop-purse">
            <span className="shop-swap-label">You have</span>
            <PixelIcon name="coin" size={14} />
            <span className={short ? 'shop-purse-short' : 'shop-purse-ok'}>{gold}</span>
          </div>
        </div>

        <div className="shop-actions">
          <button
            type="button"
            className="shop-btn shop-btn-buy"
            onClick={() => onBuy(offer.offerId)}
            disabled={!canBuy}
            aria-label={`Buy for ${price} gold`}
          >
            <span className="shop-btn-label">Buy</span>
            <span className="shop-price">
              <PixelIcon name="coin" size={14} />
              {price}
            </span>
          </button>
          <button type="button" className="shop-btn shop-btn-exit shop-btn-wide" onClick={onClose} aria-label="Leave the podium">
            Leave
          </button>
        </div>

        {!canBuy && <div className="shop-warn">{soldOut ? 'You already bought an item in this shop.' : 'Not enough gold.'}</div>}
      </div>
    </div>
  );
}
