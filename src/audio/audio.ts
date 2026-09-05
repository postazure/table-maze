/**
 * The one object the rest of the app talks to about sound.
 *
 * The engine never touches the Web Audio API: it just names moments by
 * pushing `SfxId`s onto `state.sfx` (see `pushSfx` in engine/combat.ts). This
 * class drains that queue once a frame, turns each id into an actual noise,
 * and keeps the background music matched to whatever floor the hero is on.
 *
 * Two browser facts shape everything here:
 *
 *  - A page may not make a sound until the user has interacted with it, so the
 *    AudioContext is built on the first tap or key press rather than at start
 *    up. Until then `update` quietly throws the queue away.
 *  - A backgrounded tab throttles timers, so the context is suspended while
 *    the page is hidden and resumed when it comes back.
 */

import type { GameState, SfxId } from '../engine/types';
import { VARIED_SFX } from '../engine/types';
import { playSfx } from './sfx';
import { MusicPlayer, trackForLevel } from './music';

const STORAGE_KEY = 'table-maze:sound';
const SFX_VOLUME_KEY = 'table-maze:volume:sfx';
const MUSIC_VOLUME_KEY = 'table-maze:volume:music';
/** Superseded by the two keys above; still read once as a fallback default for both. */
const LEGACY_VOLUME_KEY = 'table-maze:volume';

/**
 * The mix, in one place, measured rather than guessed.
 *
 * This is a phone game played in long sittings, often somewhere with other
 * people in it, so the whole thing is deliberately quiet: the loudest sound in
 * the game peaks around -24 dBFS, which leaves the player's own volume control
 * somewhere useful to sit rather than pinned at its lowest notch.
 *
 * `music` is set level with `sfx`, comparing each one's level while it is
 * actually sounding — a continuous bed against a 100ms blip, which is what an
 * ear compares. The ambience is meant to be heard, not merely detected, and
 * it is sparse enough that it never competes with an effect for attention.
 *
 * The other job these numbers do is keep the busses under the compressor's
 * threshold (0.126 at its input). Sound effects touch it only when several
 * pile up or a long jingle plays, which is what it is there for. The music
 * must never reach it at all, or every swell ducks the effects: at this
 * setting its worst peak lands around 0.09, which leaves 3 dB of room —
 * raising `music` much past 0.18 would spend it.
 */
const MIX = {
  /** Overall trim, applied last, after the compressor. Just on/off; the
   *  player's own sfx/music sliders (see `GameAudio.sfxVolume`/`musicVolume`)
   *  trim their own busses instead, so one can duck without the other. */
  master: 0.5,
  sfx: 0.44,
  music: 0.127,
} as const;

/** Volume slider default: full, the mix as tuned above. Persisted once changed. */
const DEFAULT_VOLUME = 1;

/** At most this many sounds start in any one frame... */
const MAX_PER_FRAME = 5;
/** ...and at most this many of any single kind. */
const MAX_SAME_PER_FRAME = 2;

/**
 * The shortest gap between two plays of the same sound, in ms. Chain lightning
 * hitting four monsters on one tick is one zap, not four; a hero sprinting
 * down a corridor is a walk, not a drum roll.
 */
const MIN_GAP_MS: Partial<Record<SfxId, number>> = {
  step: 70,
  swing: 45,
  hit: 45,
  hurt: 60,
  kill: 40,
  zap: 70,
  rise: 60,
  immune: 200,
};

const VARIED = new Set<SfxId>(VARIED_SFX);

export class GameAudio {
  /** Whether the player wants sound at all. Persisted across runs. */
  private on: boolean;

  /** The player's own trim on each bus, 0..1. Persisted across runs. */
  private sfxLevel: number;
  private musicLevel: number;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private music: MusicPlayer | null = null;

  /** performance.now() of the last play, per sound, for the gap rule above. */
  private readonly lastPlayed = new Map<SfxId, number>();
  private detach: (() => void) | null = null;

  constructor() {
    this.on = readPreference();
    const legacy = readLegacyVolume();
    this.sfxLevel = readVolume(SFX_VOLUME_KEY, legacy);
    this.musicLevel = readVolume(MUSIC_VOLUME_KEY, legacy);
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The player's own trim on the sound-effects bus, 0..1. */
  get sfxVolume(): number {
    return this.sfxLevel;
  }

  /** The player's own trim on the music bus, 0..1. */
  get musicVolume(): number {
    return this.musicLevel;
  }

  /**
   * Listen for the first gesture (which is when a context is allowed to start)
   * and for the tab going away. Returns nothing; call `dispose` to undo.
   */
  attach(): void {
    if (this.detach) return;
    if (this.on) {
      // Don't wait for a gesture to even try: plenty of browsers (a return
      // visit, a desktop browser with sound already allowed for this site)
      // let a context start running with no tap at all. Where they don't,
      // this just leaves it suspended and the gesture listeners below wake
      // it the moment the player does anything.
      this.start();
      void this.ctx?.resume().catch(() => undefined);
    }
    const wake = () => {
      this.start();
      // iOS can park a context as "interrupted" at any time; every gesture is
      // a chance to bring it back, so this listener stays on for good.
      void this.ctx?.resume().catch(() => undefined);
    };
    const visibility = () => {
      const ctx = this.ctx;
      if (!ctx) return;
      if (document.visibilityState === 'hidden') void ctx.suspend().catch(() => undefined);
      else if (this.on) void ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', wake, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    this.detach = () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('touchstart', wake);
      document.removeEventListener('visibilitychange', visibility);
    };
  }

  /** Turn sound on or off and remember the choice. */
  setEnabled(on: boolean): void {
    this.on = on;
    writePreference(on);
    if (on) {
      this.start();
      void this.ctx?.resume().catch(() => undefined);
    } else {
      // Stop the band rather than just turning it down: a muted player would
      // otherwise go on scheduling notes into a silent gain for the whole run.
      this.music?.play(null);
    }
    this.rampGain(this.master, this.on ? MIX.master : 0.0001, 0.15);
  }

  /** Set the effects trim (0..1) and remember it. A quick ramp, so dragging never clicks. */
  setSfxVolume(level: number): void {
    this.sfxLevel = clamp01(level);
    writeVolume(SFX_VOLUME_KEY, this.sfxLevel);
    this.rampGain(this.sfxBus, MIX.sfx * this.sfxLevel, 0.05);
  }

  /** Set the music trim (0..1) and remember it. A quick ramp, so dragging never clicks. */
  setMusicVolume(level: number): void {
    this.musicLevel = clamp01(level);
    writeVolume(MUSIC_VOLUME_KEY, this.musicLevel);
    this.rampGain(this.musicBus, MIX.music * this.musicLevel, 0.05);
  }

  /**
   * Called once a frame from the render loop, after `Game.tick`. Plays
   * everything the simulation asked for and clears the queue — even with the
   * sound off, so a muted run never builds up a backlog to blast out later.
   */
  update(state: GameState): void {
    const queue = state.sfx;
    if (queue && queue.length > 0) {
      if (this.ready()) this.drain(queue);
      queue.length = 0;
    }
    this.syncMusic(state);
  }

  /** Tear down the context and stop listening. */
  dispose(): void {
    this.detach?.();
    this.detach = null;
    this.music?.dispose();
    this.music = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    void ctx?.close().catch(() => undefined);
  }

  // -------------------------------------------------------------------------

  /** Glide a gain node to `target` over `seconds`, so a change never clicks. */
  private rampGain(node: GainNode | null, target: number, seconds: number): void {
    if (!node || !this.ctx) return;
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(target, now + seconds);
  }

  private ready(): boolean {
    return this.on && this.ctx !== null && this.ctx.state === 'running' && this.sfxBus !== null;
  }

  /** Build the audio graph. Safe to call as often as you like; only the first does anything. */
  private start(): void {
    if (this.ctx) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return; // no audio available; the game plays on in silence
    }
    this.ctx = ctx;

    // Everything meets at a compressor, so a fireball landing on four monsters
    // at once ducks rather than distorts.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 12;
    glue.ratio.value = 6;
    glue.attack.value = 0.004;
    glue.release.value = 0.16;

    const master = ctx.createGain();
    master.gain.value = this.on ? MIX.master : 0.0001;
    glue.connect(master).connect(ctx.destination);
    this.master = master;

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = MIX.sfx * this.sfxLevel;
    sfxBus.connect(glue);
    this.sfxBus = sfxBus;

    const musicBus = ctx.createGain();
    musicBus.gain.value = MIX.music * this.musicLevel;
    musicBus.connect(glue);
    this.musicBus = musicBus;
    this.music = new MusicPlayer(ctx, musicBus);
  }

  /** Play what fits from this frame's queue, dropping the rest. */
  private drain(queue: SfxId[]): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const now = performance.now();
    const seen = new Map<SfxId, number>();
    let played = 0;
    for (const id of queue) {
      if (played >= MAX_PER_FRAME) break;
      const already = seen.get(id) ?? 0;
      if (already >= MAX_SAME_PER_FRAME) continue;
      const gap = MIN_GAP_MS[id] ?? 0;
      if (gap > 0 && now - (this.lastPlayed.get(id) ?? -Infinity) < gap) continue;
      seen.set(id, already + 1);
      this.lastPlayed.set(id, now);
      // Sounds heard all day get a nudge; sounds that mean something don't.
      playSfx(ctx, bus, id, VARIED.has(id) ? Math.random() * 2 - 1 : 0);
      played += 1;
    }
  }

  /** Keep the music on the track this floor calls for; silence once the run is over. */
  private syncMusic(state: GameState): void {
    const music = this.music;
    if (!music || !this.on || this.ctx?.state !== 'running') return;
    music.play(state.over ? null : trackForLevel(state.level.kind, state.level.theme));
  }
}

function readPreference(): boolean {
  try {
    return localStorage?.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true; // private mode and the like: sound on, just not remembered
  }
}

function writePreference(on: boolean): void {
  try {
    localStorage?.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* nothing to do; the choice lasts for this session only */
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Read one channel's volume, falling back to `fallback` (the legacy combined slider, or the default) if unset. */
function readVolume(key: string, fallback: number): number {
  try {
    const raw = localStorage?.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : fallback;
  } catch {
    return fallback;
  }
}

/** The single volume slider this replaced; read once as the starting point for both new ones. */
function readLegacyVolume(): number {
  try {
    const raw = localStorage?.getItem(LEGACY_VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function writeVolume(key: string, level: number): void {
  try {
    localStorage?.setItem(key, String(level));
  } catch {
    /* nothing to do; the choice lasts for this session only */
  }
}
