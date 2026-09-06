import { useState } from 'react';
import { BossIntroModal } from './BossIntroModal';
import { BossWonModal } from './BossWonModal';
import { ChestModal } from './ChestModal';
import { GameOverModal } from './GameOverModal';
import { HelpModal } from './HelpModal';
import { Hud } from './Hud';
import { ItemModal } from './ItemModal';
import { LensShatterModal } from './LensShatterModal';
import { MazeCanvas } from './MazeCanvas';
import { ShopOfferModal } from './ShopOfferModal';
import { VolumeModal } from './VolumeModal';
import { useAudio } from './useAudio';
import { useGame } from './useGame';

export function App() {
  const { game, hud, newGame, dismissModal, openHelp, buyOffer, retryBoss } = useGame();
  const { audio, soundOn, toggleSound, sfxVolume, setSfxVolume, musicVolume, setMusicVolume } = useAudio();
  const [volumeOpen, setVolumeOpen] = useState(false);
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
          onOpenVolume={() => setVolumeOpen(true)}
        />
      </div>
      {volumeOpen && (
        <VolumeModal
          soundOn={soundOn}
          sfxVolume={sfxVolume}
          musicVolume={musicVolume}
          onChangeSfxVolume={setSfxVolume}
          onChangeMusicVolume={setMusicVolume}
          onClose={() => setVolumeOpen(false)}
        />
      )}
      {hud.modal?.kind === 'chest' && <ChestModal loot={hud.modal.loot} onClose={dismissModal} />}
      {hud.modal?.kind === 'shopOffer' && <ShopOfferModal offer={hud.modal} onBuy={buyOffer} onClose={dismissModal} />}
      {hud.modal?.kind === 'item' && <ItemModal item={hud.modal.item} replaced={hud.modal.replaced} onClose={dismissModal} />}
      {hud.modal?.kind === 'help' && <HelpModal model={hud} onClose={dismissModal} />}
      {hud.modal?.kind === 'lensShatter' && <LensShatterModal onClose={dismissModal} />}
      {hud.modal?.kind === 'bossIntro' && <BossIntroModal boss={hud.modal.boss} onClose={dismissModal} />}
      {hud.modal?.kind === 'bossWon' && (
        <BossWonModal boss={hud.modal.boss} upgraded={hud.modal.upgraded} heart={hud.modal.heart} onClose={dismissModal} />
      )}
      {hud.modal?.kind === 'gameOver' && (
        <GameOverModal
          cause={hud.modal.cause}
          boss={hud.modal.boss}
          stats={hud.modal.stats}
          retryCost={hud.modal.retryCost}
          onRetry={retryBoss}
          onClose={dismissModal}
        />
      )}
    </div>
  );
}
