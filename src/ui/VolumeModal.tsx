import { useCallback, type ChangeEvent } from 'react';
import { PixelIcon } from './icons';

export interface VolumeModalProps {
  soundOn: boolean;
  volume: number;
  onChangeVolume: (level: number) => void;
  onClose: () => void;
}

/**
 * Opened by holding the speaker button. Only the level moves here; on/off
 * still belongs to a tap on that same button, so this never touches it.
 */
export function VolumeModal({ soundOn, volume, onChangeVolume, onClose }: VolumeModalProps) {
  const pct = Math.round(volume * 100);

  const handleInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChangeVolume(Number(e.target.value) / 100),
    [onChangeVolume],
  );

  return (
    <div className="modal-backdrop volume-backdrop" role="dialog" aria-label="Volume">
      <div className="volume-modal">
        <div className="volume-head">
          <PixelIcon name={soundOn ? 'sound' : 'soundOff'} size={16} />
          <span className="volume-title">Volume</span>
        </div>
        <input
          type="range"
          className="volume-slider"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={handleInput}
          aria-label="Volume"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
        <div className="volume-pct">{pct}%</div>
        <button type="button" className="hud-btn-newgame volume-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
