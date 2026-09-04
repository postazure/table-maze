import type { HudModel } from './hudModel';
import type { ItemSlot, MagicItem } from '../engine/types';
import { itemDescription, itemName } from '../engine/items';
import { PixelIcon } from './icons';

export interface HelpModalProps {
  model: HudModel;
  onClose: () => void;
}

const SLOTS: { slot: ItemSlot; label: string }[] = [
  { slot: 'offense', label: 'Offense' },
  { slot: 'defense', label: 'Defense' },
  { slot: 'spirit', label: 'Spirit' },
];

function GearRow({ slot, label, item }: { slot: ItemSlot; label: string; item: MagicItem | null }) {
  return (
    <div className={`help-gear${item ? '' : ' help-gear-empty'}`}>
      <div className="help-gear-icon">
        <PixelIcon name={item ? item.kind : slot} size={32} />
      </div>
      <div className="help-gear-text">
        <div className="help-gear-title">
          <span className="help-gear-slot">{label}</span>
          {item ? (
            <>
              <span className="help-gear-name">{itemName(item.kind)}</span>
              <span className="help-gear-level">Lv {item.level}</span>
            </>
          ) : (
            <span className="help-gear-name help-muted">Empty</span>
          )}
        </div>
        <p className="help-gear-desc">{item ? itemDescription(item) : 'Buy something for this slot in the next shop.'}</p>
      </div>
    </div>
  );
}

/**
 * The one screen with words: what the hero is wearing and what it does,
 * plus a short reminder of how to play. The game is paused behind it.
 */
export function HelpModal({ model, onClose }: HelpModalProps) {
  return (
    <div className="modal-backdrop modal-ready help-backdrop" role="dialog" aria-label="Help">
      <div className="help-modal">
        <div className="help-head">
          <span className="help-title">Your gear</span>
          <button type="button" className="hud-btn-newgame help-close" onClick={onClose} aria-label="Close help">
            X
          </button>
        </div>
        <div className="help-body">
          {SLOTS.map(({ slot, label }) => (
            <GearRow key={slot} slot={slot} label={label} item={model.gear[slot]} />
          ))}
          <div className="help-section">
            <span className="help-title">How to play</span>
            <ul className="help-list">
              <li>Drag your finger to walk. The hero follows your line.</li>
              <li>Walk into a monster to fight it. The hero keeps swinging on their own until it's beaten or you walk away.</li>
              <li>Purple horned keys open horned doors. Gold keys open chests. Keys stay on their floor.</li>
              <li>Monsters are solid. Nobody walks through one.</li>
              <li>Roaming monsters are weak. Cut them down and move on.</li>
              <li>Guards stand still and only fight back if you hit them. Beating one costs real hearts.</li>
              <li>Hunters chase you when you get close and hit far too hard to fight at your level. Lead them away, then loop around.</li>
              <li>Out of hearts? You sleep somewhere safe until they refill, and every monster heals to full.</li>
              <li>Every third floor has a shop. Walk into a podium to see what the item does, then buy it or walk away.</li>
              <li>The emblem on a podium says what the item is for: sword = offense, shield = defense, star = spirit.</li>
              <li>You can buy one item per shop, and each slot holds one item.</li>
            </ul>
          </div>
        </div>
        <button type="button" className="hud-btn-newgame help-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
