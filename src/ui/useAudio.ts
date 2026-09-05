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
  const [sfxVolume, setSfxVolumeState] = useState(() => audio.sfxVolume);
  const [musicVolume, setMusicVolumeState] = useState(() => audio.musicVolume);

  useEffect(() => {
    audio.attach();
    return () => audio.dispose();
  }, [audio]);

  const toggleSound = useCallback(() => {
    audio.setEnabled(!audio.enabled);
    setSoundOn(audio.enabled);
  }, [audio]);

  const setSfxVolume = useCallback(
    (level: number) => {
      audio.setSfxVolume(level);
      setSfxVolumeState(audio.sfxVolume);
    },
    [audio],
  );

  const setMusicVolume = useCallback(
    (level: number) => {
      audio.setMusicVolume(level);
      setMusicVolumeState(audio.musicVolume);
    },
    [audio],
  );

  return { audio, soundOn, toggleSound, sfxVolume, setSfxVolume, musicVolume, setMusicVolume };
}
