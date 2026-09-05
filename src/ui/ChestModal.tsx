import { useEffect, useState } from 'react';
import type { Loot } from '../engine/types';
import { HEART } from '../engine/types';
import { PixelIcon, type IconName } from './icons';
import { PixelArt } from './PixelArt';

/** 8x8 chest sprites (same shapes the canvas renderer uses). */
const CHEST_CLOSED = ['........', '.WWWWWW.', 'WWWWWWWW', 'WGGGGGGW', 'WW.LL.WW', 'WWWWWWWW', 'WWWWWWWW', '........'];
const CHEST_OPEN = ['.WWWWWW.', '........', 'WWWWWWWW', 'W......W', 'W.gggg.W', 'W......W', 'WWWWWWWW', '........'];
const CHEST_PALETTE: Record<string, string> = { W: '#8b5a2b', G: '#f5c451', L: '#2a2016', g: '#f5c451' };

/** What comes out of the chest: the item if there is one, otherwise the coins. */
function prize(loot: Loot): { icon: IconName; amount: number } {
  const item = loot.item;
  if (item?.atk) return { icon: 'sword', amount: item.atk };
  if (item?.def) return { icon: 'shield', amount: item.def };
  if (item?.maxHp) return { icon: 'heart', amount: Math.max(1, Math.round(item.maxHp / HEART)) };
  if (item?.potionCapacity) return { icon: 'potion', amount: item.potionCapacity };
  return { icon: 'coin', amount: loot.gold };
}

export interface ChestModalProps {
  loot: Loot;
  onClose: () => void;
}

/**
 * Wordless "you opened a chest" popup: the chest wobbles, the lid pops, and
 * the prize floats out. Tap anywhere to continue.
 */
export function ChestModal({ loot, onClose }: ChestModalProps) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const { icon, amount } = prize(loot);
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
    if (ready) onClose();
  };

  return (
    <div className={`modal-backdrop${ready ? ' modal-ready' : ''}`} onPointerDown={close} role="dialog" aria-label="Chest opened">
      <div className="chest-modal">
        <div className={`chest-stage${open ? ' chest-open' : ''}`}>
          <div className="chest-glow" />
          <div className="chest-prize">
            <PixelIcon name={icon} size={64} />
            <span className="chest-amount">+{amount}</span>
          </div>
          <PixelArt rows={open ? CHEST_OPEN : CHEST_CLOSED} palette={CHEST_PALETTE} size={96} className="chest-sprite" />
          <span className="chest-spark chest-spark-a" />
          <span className="chest-spark chest-spark-b" />
          <span className="chest-spark chest-spark-c" />
        </div>
        {showCoins && (
          <div className="chest-coins">
            <PixelIcon name="coin" size={16} />
            <span>+{loot.gold}</span>
          </div>
        )}
        <div className="chest-tap" aria-hidden="true">
          <span className="chest-tap-dot" />
        </div>
      </div>
    </div>
  );
}
