import { BossIntroModal } from './BossIntroModal';
import { BossWonModal } from './BossWonModal';
import { ChestModal } from './ChestModal';
import { GameOverModal } from './GameOverModal';
import { HelpModal } from './HelpModal';
import { Hud } from './Hud';
import { ItemModal } from './ItemModal';
import { MazeCanvas } from './MazeCanvas';
import { ShopOfferModal } from './ShopOfferModal';
import { useAudio } from './useAudio';
import { useGame } from './useGame';

export function App() {
  const { game, hud, newGame, dismissModal, openHelp, buyOffer } = useGame();
  const { audio, soundOn, toggleSound } = useAudio();
  return (
    <div className="app">
      <MazeCanvas game={game} audio={audio} />
      <div className="hud">
        <Hud
          model={hud}
          onNewGame={newGame}
          onHelp={openHelp}
          soundOn={soundOn}
          onToggleSound={toggleSound}
        />
      </div>
      {hud.modal?.kind === 'chest' && <ChestModal loot={hud.modal.loot} onClose={dismissModal} />}
      {hud.modal?.kind === 'shopOffer' && <ShopOfferModal offer={hud.modal} onBuy={buyOffer} onClose={dismissModal} />}
      {hud.modal?.kind === 'item' && <ItemModal item={hud.modal.item} replaced={hud.modal.replaced} onClose={dismissModal} />}
      {hud.modal?.kind === 'help' && <HelpModal model={hud} onClose={dismissModal} />}
      {hud.modal?.kind === 'bossIntro' && <BossIntroModal boss={hud.modal.boss} onClose={dismissModal} />}
      {hud.modal?.kind === 'bossWon' && (
        <BossWonModal boss={hud.modal.boss} upgraded={hud.modal.upgraded} heart={hud.modal.heart} onClose={dismissModal} />
      )}
      {hud.modal?.kind === 'gameOver' && (
        <GameOverModal cause={hud.modal.cause} boss={hud.modal.boss} stats={hud.modal.stats} onClose={dismissModal} />
      )}
    </div>
  );
}
