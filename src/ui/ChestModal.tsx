import { useEffect, useState } from 'react';
import type { Loot, MagicItem } from '../engine/types';
import { HEART } from '../engine/types';
import { itemDescription, itemName } from '../engine/items';
import { LENS_NAME } from '../engine/lens';
import { PixelIcon, type IconName } from './icons';
import { PixelArt } from './PixelArt';

/** 8x8 chest sprites (same shapes the canvas renderer uses). */
const CHEST_CLOSED = ['........', '.WWWWWW.', 'WWWWWWWW', 'WGGGGGGW', 'WW.LL.WW', 'WWWWWWWW', 'WWWWWWWW', '........'];
const CHEST_OPEN = ['.WWWWWW.', '........', 'WWWWWWWW', 'W......W', 'W.gggg.W', 'W......W', 'WWWWWWWW', '........'];
const CHEST_PALETTE: Record<string, string> = { W: '#8b5a2b', G: '#f5c451', L: '#2a2016', g: '#f5c451' };

/**
 * What comes out of the chest.
 *
 * The two finds worth a name in words come first — a magic item out of a
 * vault, and the lens itself — because neither is a number the player can read
 * off an icon. Everything else stays wordless: a trinket shows what it adds,
 * and a chest with nothing else in it shows its coins.
 */
function prize(loot: Loot): { icon: IconName; amount: number | null; label?: string } {
  if (loot.magic) return { icon: loot.magic.kind, amount: null, label: itemName(loot.magic.kind) };
  if (loot.lens) return { icon: 'lens', amount: null, label: LENS_NAME };
  const item = loot.item;
  if (item?.atk) return { icon: 'sword', amount: item.atk };
  if (item?.def) return { icon: 'shield', amount: item.def };
  if (item?.maxHp) return { icon: 'heart', amount: Math.max(1, Math.round(item.maxHp / HEART)) };
  if (item?.potionCapacity) return { icon: 'potion', amount: item.potionCapacity };
  return { icon: 'coin', amount: loot.gold };
}

export interface ChestModalProps {
  loot: Loot;
  /**
   * A magic item found with that slot already filled: the popup asks whether
   * to wear it or melt it down, and only closes on an answer.
   */
  choice: { magic: MagicItem; replaces: MagicItem; sellGold: number } | null;
  onTake: () => void;
  onSell: () => void;
  onClose: () => void;
}

/**
 * Wordless "you opened a chest" popup: the chest wobbles, the lid pops, and
 * the prize floats out. Tap anywhere to continue — unless the prize is a
 * magic item the hero has to choose about, in which case two buttons do.
 */
export function ChestModal({ loot, choice, onTake, onSell, onClose }: ChestModalProps) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const { icon, amount, label } = prize(loot);
  const showCoins = icon !== 'coin' && loot.gold > 0;

  useEffect(() => {
    const lid = window.setTimeout(() => setOpen(true), 550);
    const done = window.setTimeout(() => setReady(true), 1300);
    return () => {
      window.clearTimeout(lid);
      window.clearTimeout(done);
    };
  }, []);

  const close = () => {
    if (ready && !choice) onClose();
  };

  return (
    <div className={`modal-backdrop${ready ? ' modal-ready' : ''}`} onPointerDown={close} role="dialog" aria-label="Chest opened">
      <div className="chest-modal">
        <div className={`chest-stage${open ? ' chest-open' : ''}`}>
          <div className="chest-glow" />
          <div className="chest-prize">
            <PixelIcon name={icon} size={64} />
            {amount !== null && <span className="chest-amount">+{amount}</span>}
          </div>
          <PixelArt rows={open ? CHEST_OPEN : CHEST_CLOSED} palette={CHEST_PALETTE} size={96} className="chest-sprite" />
          <span className="chest-spark chest-spark-a" />
          <span className="chest-spark chest-spark-b" />
          <span className="chest-spark chest-spark-c" />
        </div>
        {label && <span className="chest-label">{label}</span>}
        {showCoins && (
          <div className="chest-coins">
            <PixelIcon name="coin" size={16} />
            <span>+{loot.gold}</span>
          </div>
        )}
        {choice ? (
          <div className={`chest-choice${ready ? ' chest-choice-ready' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
            <p className="shop-desc chest-choice-desc">{itemDescription(choice.magic)}</p>
            <div className="shop-swap">
              <span className="shop-swap-label">Replaces</span>
              <PixelIcon name={choice.replaces.kind} size={16} />
              <span className="shop-swap-name">
                {itemName(choice.replaces.kind)} <span className="shop-muted">Lv {choice.replaces.level}</span>
              </span>
            </div>
            <div className="shop-actions chest-choice-actions">
              <button type="button" className="shop-btn shop-btn-buy" onClick={onTake} disabled={!ready} aria-label="Wear it">
                <span className="shop-btn-label">Wear it</span>
              </button>
              <button
                type="button"
                className="shop-btn shop-btn-exit shop-btn-wide"
                onClick={onSell}
                disabled={!ready}
                aria-label={`Melt it down for ${choice.sellGold} gold`}
              >
                <span className="shop-btn-label">Melt down</span>
                <span className="shop-price">
                  <PixelIcon name="coin" size={14} />
                  {choice.sellGold}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="chest-tap" aria-hidden="true">
            <span className="chest-tap-dot" />
          </div>
        )}
      </div>
    </div>
  );
}
