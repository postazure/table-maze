import { useState } from 'react';
import type { HudBuff, HudModel } from './hudModel';
import type { ItemSlot, MagicItem } from '../engine/types';
import { BOSS_KINDS } from '../engine/types';
import { itemDescription, itemName } from '../engine/items';
import { heartsLabel, shrineDescription, shrineName } from '../engine/shrines';
import { LENS_NAME } from '../engine/lens';
import { relicName } from '../engine/puzzles';
import { boonDescription, boonName, trophyName } from '../engine/boons';
import { WORLDS } from '../engine/worlds';
import { BRASS_DESCRIPTION, BRASS_NAME, crystalName } from '../engine/crafting';
import { PixelIcon, crystalIcon, type IconName } from './icons';

/** Every world's collectible, looked up by id. An id nothing offered is skipped. */
function collectibleById(id: string): { name: string; description: string } | null {
  for (const kind of BOSS_KINDS) {
    const c = WORLDS[kind].collectible;
    if (c.id === id) return c;
  }
  return null;
}

export interface HelpModalProps {
  model: HudModel;
  onClose: () => void;
}

const SLOTS: { slot: ItemSlot; label: string }[] = [
  { slot: 'offense', label: 'Offense' },
  { slot: 'defense', label: 'Defense' },
  { slot: 'spirit', label: 'Spirit' },
];

/**
 * The three tabs of the help screen. `hero` is what you are carrying right
 * now, `log` is what has happened, `guide` is how any of it works — so the two
 * that change every few seconds are separated from the one that never does.
 */
type Tab = 'hero' | 'log' | 'guide';

const TABS: { id: Tab; label: string }[] = [
  { id: 'hero', label: 'Hero' },
  { id: 'log', label: 'Log' },
  { id: 'guide', label: 'How to play' },
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
 * One shrine effect the hero has running, and how much of it is left.
 *
 * This is the one screen that puts the clock into words. Out in the maze a
 * timer is a pip that blinks, because out there the hero is mid-fight; here
 * the game is paused and the player has come looking for the detail, so
 * seconds are what they want. The ward has no clock, so it counts out the
 * hearts it has left instead.
 */
function BuffRow({ buff, tempHp }: { buff: HudBuff; tempHp: number }) {
  const left = buff.kind === 'ward' ? `${heartsLabel(tempHp)} left` : `${buff.secondsLeft}s left`;
  return (
    <div className={`help-gear help-buff help-buff-${buff.phase}`}>
      <div className="help-gear-icon">
        <PixelIcon name={buff.kind} size={32} />
      </div>
      <div className="help-gear-text">
        <div className="help-gear-title">
          <span className="help-gear-name">{shrineName(buff.kind)}</span>
          <span className="help-gear-level">{left}</span>
        </div>
        <p className="help-gear-desc">{shrineDescription(buff.kind, buff.level)}</p>
      </div>
    </div>
  );
}

/** One thing the hero carries that is not gear: a lens, an orb, a relic, a trophy. */
function CarriedRow({ icon, name, desc }: { icon: IconName; name: string; desc: string }) {
  return (
    <div className="help-gear help-lens">
      <div className="help-gear-icon">
        <PixelIcon name={icon} size={32} />
      </div>
      <div className="help-gear-text">
        <div className="help-gear-title">
          <span className="help-gear-name">{name}</span>
        </div>
        <p className="help-gear-desc">{desc}</p>
      </div>
    </div>
  );
}

function HeroTab({ model }: { model: HudModel }) {
  const carried =
    model.lens ||
    model.carrying ||
    model.relics.length > 0 ||
    model.trophies.length > 0 ||
    model.brass > 0 ||
    model.crystals.length > 0;
  const lensDesc = model.lensWhole ? 'Whole.' : model.lensHeirloom ? 'The housing is cracked.' : 'See the unseen.';
  return (
    <>
      <div className="help-section">
        <span className="help-title">Your gear</span>
        {SLOTS.map(({ slot, label }) => (
          <GearRow key={slot} slot={slot} label={label} item={model.gear[slot]} />
        ))}
      </div>
      {carried && (
        <div className="help-section">
          <span className="help-title">Carried</span>
          {model.lens && <CarriedRow icon="lens" name={LENS_NAME} desc={lensDesc} />}
          {model.carrying && <CarriedRow icon="orb" name="Orb" desc="Both hands full. You set it down to fight; it goes home if it leaves the wing." />}
          {model.brass > 0 && (
            <CarriedRow icon="brass" name={model.brass > 1 ? `${BRASS_NAME} x${model.brass}` : BRASS_NAME} desc={BRASS_DESCRIPTION} />
          )}
          {model.relics.map((kind, i) => (
            <CarriedRow key={`${kind}-${i}`} icon={kind} name={relicName(kind)} desc="A keystone. Somewhere deeper, a sealed door is carved with this shape." />
          ))}
          {model.trophies.map((boss, i) => (
            <CarriedRow key={`${boss}-${i}`} icon={boss} name={trophyName(boss)} desc="Proof of a boss beaten. Some altar, somewhere, is carved for it." />
          ))}
          {model.crystals.map((boss, i) => (
            <CarriedRow
              key={`${boss}-${i}`}
              icon={crystalIcon(boss)}
              name={crystalName(boss)}
              desc="Carved from a trophy. Spend it at the portal to open its world."
            />
          ))}
        </div>
      )}
      {model.boons.length > 0 && (
        <div className="help-section">
          <span className="help-title">Boons</span>
          {model.boons.map((b) => (
            <CarriedRow
              key={b.kind}
              icon={b.kind}
              name={boonName(b.kind)}
              desc={`${boonDescription(b.kind)} ${b.runsLeft > 0 ? `${b.runsLeft} more run${b.runsLeft === 1 ? '' : 's'} after this one.` : 'This is its last run.'}`}
            />
          ))}
        </div>
      )}
      {model.collection.length > 0 && (
        <div className="help-section">
          <span className="help-title">Collection</span>
          {model.collection.map((id) => {
            const c = collectibleById(id);
            if (!c) return null;
            return <CarriedRow key={id} icon="lens" name={c.name} desc={c.description} />;
          })}
        </div>
      )}
      <div className="help-section">
        <span className="help-title">Running now</span>
        {model.buffs.length > 0 ? (
          model.buffs.map((buff) => <BuffRow key={buff.kind} buff={buff} tempHp={model.tempHp} />)
        ) : (
          <p className="help-gear-desc help-muted">Nothing running.</p>
        )}
      </div>
    </>
  );
}

/**
 * What has happened, newest at the top. This used to be three lines fading out
 * in the corner of the HUD, which meant the one line you wanted was usually
 * the one that had just gone. Here it keeps a real history and waits until you
 * come looking.
 */
function LogTab({ log }: { log: string[] }) {
  if (log.length === 0) {
    return <p className="help-gear-desc help-muted">Nothing has happened yet.</p>;
  }
  return (
    <ol className="help-log">
      {log
        .map((text, i) => ({ text, i }))
        .reverse()
        .map(({ text, i }) => (
          <li key={i} className="help-log-line">
            {text}
          </li>
        ))}
    </ol>
  );
}

function GuideTab() {
  return (
    <ul className="help-list">
      <li>Drag your finger to walk. The hero follows your line.</li>
      <li>Walk into a monster to fight it. The hero keeps swinging on their own until it's beaten or you walk away.</li>
      <li>Purple eye keys open eye doors. Gold keys open chests. Keys stay on their floor.</li>
      <li>Monsters are solid. Nobody walks through one.</li>
      <li>Roaming monsters are weak. Cut them down and move on.</li>
      <li>Guards stand still and only fight back if you hit them. Beating one costs real hearts.</li>
      <li>Hunters chase you when you get close and hit far too hard to fight at your level. They spot you later while they are over your level, so early floors give you room to back out. Lead them away, then loop around.</li>
      <li>Out of hearts? You sleep somewhere safe until they refill, and every monster heals to full.</li>
      <li>
        Chests sometimes hold a golden health potion: it raises how many you can carry. Run out of hearts with
        one in reserve and it kicks in on its own for half your hearts back, instead of a knockdown. They refill
        at the start of every floor.
      </li>
      <li>A chest may hold a {LENS_NAME}. See the unseen: behind the wall of every floor is a wing of rooms it opens.</li>
      <li>The wing's monsters are the floor's hardest, and a chest in one may be a mimic. Its treasure room is behind a sealed door.</li>
      <li>Seals open three ways: step on the runes in the right order (a wrong one puts them all out), carry the orb to the cradle before the door, or bring the relic the door is carved with from an earlier floor.</li>
      <li>You set the orb down to fight. Step back onto it to pick it up again.</li>
      <li>Beat a boss and you keep its trophy. An altar carved for it trades it for a boon that lasts three runs.</li>
      <li>A chest may hold a Brass Lump. Crafting material.</li>
      <li>A carving shrine cuts a trophy into a crystal that outlives the run, if an altar hasn't taken it first.</li>
      <li>A portal hides in the first floor's wing. Spend a crystal there to step into its boss's world and back.</li>
      <li>Glowing alcoves are shrines. Step on one for a gift that runs out; a dark one is already spent. The pips above your head are what you have running.</li>
      <li>Spirit makes every shrine go further: the timed ones last longer, the ward hands out more hearts. It creeps up as you level, and anything in your spirit slot adds to it.</li>
      <li>Every third floor has a shop. Walk into a podium to see what the item does, then buy it or walk away.</li>
      <li>The emblem on a podium says what the item is for: sword = offense, shield = defense, star = spirit.</li>
      <li>You can buy one thing per shop, and each slot holds one item. The forge is the other choice: a level on something you already wear.</li>
      <li>After every third floor you face a boss. Beat it and one of your magic items gains a level.</li>
      <li>Lose in a boss chamber and the run is over.</li>
      <li>A carved crystal, spent at the portal on floor one, opens the way into a boss's own world.</li>
      <li>Win a boss world and its collectible is yours for good — win it once, keep it every run after.</li>
      <li>The hero faces the way they last walked. Some monsters care about that.</li>
    </ul>
  );
}

/**
 * The one screen with words. Everything the HUD used to try to say in the
 * bottom of the display — what you are wearing, what you have running, what
 * just happened — lives behind here on its own tab, so the HUD itself can go
 * back to being hearts and numbers. The game is paused the whole time.
 */
export function HelpModal({ model, onClose }: HelpModalProps) {
  const [tab, setTab] = useState<Tab>('hero');
  return (
    <div className="modal-backdrop modal-ready help-backdrop" role="dialog" aria-label="Help">
      <div className="help-modal">
        <div className="help-head">
          <div className="help-tabs" role="tablist" aria-label="Help sections">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`help-tab${tab === id ? ' help-tab-on' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="hud-btn-newgame help-close" onClick={onClose} aria-label="Close help">
            X
          </button>
        </div>
        <div className="help-body">
          {tab === 'hero' && <HeroTab model={model} />}
          {tab === 'log' && <LogTab log={model.log} />}
          {tab === 'guide' && <GuideTab />}
        </div>
        <button type="button" className="hud-btn-newgame help-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
