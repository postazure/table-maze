import { useEffect, useState } from 'react';
import type { Loot } from '../engine/types';
import { HEART } from '../engine/types';
import { itemName } from '../engine/items';
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
  onClose: () => void;
}

/**
 * Wordless "you opened a chest" popup: the chest wobbles, the lid pops, and
 * the prize floats out. Tap anywhere to continue.
 */
export function ChestModal({ loot, onClose }: ChestModalProps) {
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
    if (ready) onClose();
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
        <div className="chest-tap" aria-hidden="true">
          <span className="chest-tap-dot" />
        </div>
      </div>
    </div>
  );
}
