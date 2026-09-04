import { Hud } from './Hud';
import { MazeCanvas } from './MazeCanvas';
import { useGame } from './useGame';

export function App() {
  const { game, hud, newGame } = useGame();
  return (
    <div className="app">
      <MazeCanvas game={game} />
      <div className="hud">
        <Hud model={hud} onNewGame={newGame} />
      </div>
    </div>
  );
}
