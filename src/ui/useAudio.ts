import { useCallback, useEffect, useState } from 'react';
import { GameAudio } from '../audio/audio';

/**
 * Owns the single `GameAudio` for the app: one AudioContext, one music player.
 * `MazeCanvas` feeds it the game state every frame; the HUD flips it on and
 * off. The on/off choice lives in localStorage, so this hook starts from
 * whatever the player picked last time.
 */
export function useAudio() {
  const [audio] = useState(() => new GameAudio());
  const [soundOn, setSoundOn] = useState(() => audio.enabled);

  useEffect(() => {
    audio.attach();
    return () => audio.dispose();
  }, [audio]);

  const toggleSound = useCallback(() => {
    audio.setEnabled(!audio.enabled);
    setSoundOn(audio.enabled);
  }, [audio]);

  return { audio, soundOn, toggleSound };
}
