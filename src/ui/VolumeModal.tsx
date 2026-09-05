import { useCallback, type ChangeEvent } from 'react';
import { PixelIcon } from './icons';

export interface VolumeModalProps {
  soundOn: boolean;
  sfxVolume: number;
  musicVolume: number;
  onChangeSfxVolume: (level: number) => void;
  onChangeMusicVolume: (level: number) => void;
  onClose: () => void;
}

interface VolumeRowProps {
  label: string;
  level: number;
  onChange: (level: number) => void;
}

function VolumeRow({ label, level, onChange }: VolumeRowProps) {
  const pct = Math.round(level * 100);
  const handleInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value) / 100),
    [onChange],
  );
  return (
    <div className="volume-row">
      <div className="volume-row-head">
        <span className="volume-row-label">{label}</span>
        <span className="volume-row-pct">{pct}%</span>
      </div>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={handleInput}
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

/**
 * Opened by holding the speaker button. Effects and music trim independently
 * here; on/off still belongs to a tap on that same button, untouched by this.
 */
export function VolumeModal({
  soundOn,
  sfxVolume,
  musicVolume,
  onChangeSfxVolume,
  onChangeMusicVolume,
  onClose,
}: VolumeModalProps) {
  return (
    <div className="modal-backdrop volume-backdrop" role="dialog" aria-label="Volume">
      <div className="volume-modal">
        <div className="volume-head">
          <PixelIcon name={soundOn ? 'sound' : 'soundOff'} size={16} />
          <span className="volume-title">Volume</span>
        </div>
        <VolumeRow label="Effects" level={sfxVolume} onChange={onChangeSfxVolume} />
        <VolumeRow label="Music" level={musicVolume} onChange={onChangeMusicVolume} />
        <button type="button" className="hud-btn-newgame volume-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
