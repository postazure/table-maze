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
import { ShopForgeModal } from './ShopForgeModal';
import { AltarModal } from './AltarModal';
import { BoonModal } from './BoonModal';
import { VolumeModal } from './VolumeModal';
import { WorldIntroModal } from './WorldIntroModal';
import { WorldWonModal } from './WorldWonModal';
import { useAudio } from './useAudio';
import { useGame } from './useGame';

export function App() {
  const { game, hud, newGame, dismissModal, openHelp, buyOffer, retryBoss, buyUpgrade, takeMagic, sellMagic, offerTrophy } =
    useGame();
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
      {hud.modal?.kind === 'chest' && (
        <ChestModal loot={hud.modal.loot} choice={hud.modal.choice} onTake={takeMagic} onSell={sellMagic} onClose={dismissModal} />
      )}
      {hud.modal?.kind === 'shopOffer' && <ShopOfferModal offer={hud.modal} onBuy={buyOffer} onClose={dismissModal} />}
      {hud.modal?.kind === 'shopForge' && <ShopForgeModal forge={hud.modal} onBuy={buyUpgrade} onClose={dismissModal} />}
      {hud.modal?.kind === 'item' && <ItemModal item={hud.modal.item} replaced={hud.modal.replaced} onClose={dismissModal} />}
      {hud.modal?.kind === 'upgraded' && <ItemModal item={hud.modal.item} replaced={null} upgraded onClose={dismissModal} />}
      {hud.modal?.kind === 'altar' && (
        <AltarModal trophy={hud.modal.trophy} boon={hud.modal.boon} onOffer={offerTrophy} onClose={dismissModal} />
      )}
      {hud.modal?.kind === 'boon' && <BoonModal boon={hud.modal.boon} runsLeft={hud.modal.runsLeft} onClose={dismissModal} />}
      {hud.modal?.kind === 'help' && <HelpModal model={hud} onClose={dismissModal} />}
      {hud.modal?.kind === 'lensShatter' && <LensShatterModal onClose={dismissModal} />}
      {hud.modal?.kind === 'bossIntro' && <BossIntroModal boss={hud.modal.boss} onClose={dismissModal} />}
      {hud.modal?.kind === 'bossWon' && (
        <BossWonModal boss={hud.modal.boss} upgraded={hud.modal.upgraded} heart={hud.modal.heart} onClose={dismissModal} />
      )}
      {hud.modal?.kind === 'worldIntro' && (
        <WorldIntroModal
          world={hud.modal.world}
          stage={hud.modal.stage}
          data={game.state.level.world?.data ?? {}}
          onClose={dismissModal}
        />
      )}
      {hud.modal?.kind === 'worldWon' && (
        <WorldWonModal world={hud.modal.world} collectible={hud.modal.collectible} onClose={dismissModal} />
      )}
      {hud.modal?.kind === 'gameOver' && (
        <GameOverModal
          cause={hud.modal.cause}
          boss={hud.modal.boss}
          stats={hud.modal.stats}
          retryCost={hud.modal.retryCost}
          world={hud.modal.world}
          onRetry={retryBoss}
          onClose={dismissModal}
        />
      )}
    </div>
  );
}
