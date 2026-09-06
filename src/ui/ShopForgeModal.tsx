import type { ItemSlot, Modal } from '../engine/types';
import { itemName } from '../engine/items';
import { PixelIcon } from './icons';

/** The 'shopForge' arm of Modal, pulled out so the props stay readable. */
export type ShopForgeModalData = Extract<Modal, { kind: 'shopForge' }>;

export interface ShopForgeModalProps {
  forge: ShopForgeModalData;
  onBuy: (slot: ItemSlot) => void;
  onClose: () => void;
}

const SLOT_LABEL: Record<ItemSlot, string> = {
  offense: 'Offense',
  defense: 'Defense',
  spirit: 'Spirit',
};

/**
 * The forge: every worn item with the price of one more level on it. Buying
 * one is the shop's purchase, so the buttons grey out once anything has been
 * bought here, or when the purse is short of that item's price. A hero
 * wearing nothing is told so and sent to the podiums.
 */
export function ShopForgeModal({ forge, onBuy, onClose }: ShopForgeModalProps) {
  const { gold, offers, soldOut } = forge;
  return (
    <div className="modal-backdrop modal-ready shop-backdrop" role="dialog" aria-label="The forge">
      <div className="shop-modal">
        <div className="shop-head">
          <span className="shop-slot">
            <PixelIcon name="forge" size={14} />
            Forge
          </span>
          <span className="shop-head-hint">One level, one item</span>
        </div>

        <div className="shop-body">
          {offers.length === 0 ? (
            <p className="shop-desc">You wear nothing the forge could work on. The podiums sell items; the forge improves them.</p>
          ) : (
            <>
              <p className="shop-desc">Raise one of your items a level. Every number it has grows with it.</p>
              {offers.map(({ slot, item, price }) => {
                const short = gold < price;
                const canBuy = !soldOut && !short;
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`shop-btn forge-row${canBuy ? '' : ' forge-row-off'}`}
                    onClick={() => onBuy(slot)}
                    disabled={!canBuy}
                    aria-label={`${itemName(item.kind)} to level ${item.level + 1} for ${price} gold`}
                  >
                    <span className="forge-row-icon">
                      <PixelIcon name={item.kind} size={28} />
                    </span>
                    <span className="forge-row-text">
                      <span className="forge-row-name">{itemName(item.kind)}</span>
                      <span className="forge-row-levels">
                        <span className="shop-muted">{SLOT_LABEL[slot]}</span> Lv {item.level}
                        <span className="item-replaced-arrow" aria-hidden="true" />
                        Lv {item.level + 1}
                      </span>
                    </span>
                    <span className={`shop-price${short ? ' shop-purse-short' : ''}`}>
                      <PixelIcon name="coin" size={14} />
                      {price}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          <div className="shop-purse">
            <span className="shop-swap-label">You have</span>
            <PixelIcon name="coin" size={14} />
            <span className="shop-purse-ok">{gold}</span>
          </div>
        </div>

        <div className="shop-actions">
          <button type="button" className="shop-btn shop-btn-exit shop-btn-wide" onClick={onClose} aria-label="Leave the forge">
            Leave
          </button>
        </div>

        {soldOut && <div className="shop-warn">You already bought something in this shop.</div>}
      </div>
    </div>
  );
}
