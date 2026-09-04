import { ChestModal } from './ChestModal';
import { HelpModal } from './HelpModal';
import { Hud } from './Hud';
import { ItemModal } from './ItemModal';
import { MazeCanvas } from './MazeCanvas';
import { useGame } from './useGame';

export function App() {
  const { game, hud, newGame, dismissModal, openHelp } = useGame();
  return (
    <div className="app">
      <MazeCanvas game={game} />
      <div className="hud">
        <Hud model={hud} onNewGame={newGame} onHelp={openHelp} />
      </div>
      {hud.modal?.kind === 'chest' && <ChestModal loot={hud.modal.loot} onClose={dismissModal} />}
      {hud.modal?.kind === 'item' && <ItemModal item={hud.modal.item} replaced={hud.modal.replaced} onClose={dismissModal} />}
      {hud.modal?.kind === 'help' && <HelpModal model={hud} onClose={dismissModal} />}
    </div>
  );
}
