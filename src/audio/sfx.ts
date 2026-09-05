/**
 * The sound bank: one recipe per `SfxId`, built out of the voices in
 * `synth.ts`.
 *
 * Two kinds of sound live here, and they are treated differently on purpose.
 *
 * Sounds the player hears hundreds of times a run — a footstep, a swing, a hit
 * — take a variation number `v` in [-1, 1] and shift their pitch and timing
 * with it. It is a small shift: half a tone or so, nothing you would name if
 * asked, but enough that a long fight sounds like a fight rather than a
 * sample stuck on repeat.
 *
 * Sounds that mean one specific thing — a chest opening, a level up, a boss
 * going down — ignore `v` entirely and come out identical every time. That is
 * what lets a player learn them: hear the chest jingle from two rooms away and
 * know exactly what happened without looking.
 */

import type { SfxId } from '../engine/types';
import { arpeggio, midiToHz as hz, noise, tone } from './synth';

/** A recipe. `v` is the per-play variation, -1..1, and is 0 for fixed sounds. */
type Voice = (ctx: BaseAudioContext, dest: AudioNode, v: number) => void;

/** Turn a variation number into a pitch multiplier of at most `semis` semitones. */
const bend = (v: number, semis: number): number => Math.pow(2, (v * semis) / 12);

const SFX: Record<SfxId, Voice> = {
  // --- heard constantly: varied ------------------------------------------
  /** A boot on stone. Deliberately almost inaudible; it is texture, not an event. */
  step(ctx, dest, v) {
    noise(ctx, dest, {
      filter: 'lowpass',
      freq: 900 * bend(v, 5),
      to: 300,
      dur: 0.05,
      gain: 0.075,
      q: 0.7,
    });
  },

  /** The blade moving, before it lands (or misses). */
  swing(ctx, dest, v) {
    const f = bend(v, 4);
    noise(ctx, dest, {
      filter: 'bandpass',
      freq: 2000 * f,
      to: 620 * f,
      dur: 0.085,
      gain: 0.13,
      q: 1.6,
    });
  },

  /** The blade landing: the short square drop every 8-bit game hits you with. */
  hit(ctx, dest, v) {
    const f = bend(v, 3);
    tone(ctx, dest, { type: 'square', freq: 360 * f, to: 105 * f, dur: 0.09, gain: 0.17 });
    noise(ctx, dest, { filter: 'bandpass', freq: 1500 * f, to: 500, dur: 0.06, gain: 0.09, q: 1.2 });
  },

  /** Something died. A short fall, so it reads as "down" without a fanfare. */
  kill(ctx, dest, v) {
    const f = bend(v, 3);
    tone(ctx, dest, { type: 'square', freq: 520 * f, to: 150 * f, dur: 0.16, gain: 0.15 });
    tone(ctx, dest, {
      type: 'triangle',
      freq: 260 * f,
      to: 75 * f,
      dur: 0.24,
      gain: 0.11,
      at: 0.04,
    });
    noise(ctx, dest, { filter: 'lowpass', freq: 1600, to: 260, dur: 0.18, gain: 0.09 });
  },

  /** The hero taking a hit. Harsh on purpose: sawtooth, low, no sweetener. */
  hurt(ctx, dest, v) {
    const f = bend(v, 2);
    tone(ctx, dest, { type: 'sawtooth', freq: 230 * f, to: 82 * f, dur: 0.22, gain: 0.2 });
    noise(ctx, dest, { filter: 'lowpass', freq: 900, to: 180, dur: 0.16, gain: 0.13 });
  },

  /** A skeleton clawing its way out of the floor. */
  rise(ctx, dest, v) {
    const f = bend(v, 3);
    tone(ctx, dest, {
      type: 'sawtooth',
      freq: 62 * f,
      to: 190 * f,
      dur: 0.4,
      gain: 0.1,
      attack: 0.08,
    });
    noise(ctx, dest, { filter: 'bandpass', freq: 320, to: 1400, dur: 0.36, gain: 0.06, q: 0.8 });
  },

  /** The fire staff going off: a whoosh over a body of low fire. */
  fireball(ctx, dest, v) {
    const f = bend(v, 2);
    noise(ctx, dest, { filter: 'bandpass', freq: 420 * f, to: 2600, dur: 0.26, gain: 0.11, q: 0.9 });
    tone(ctx, dest, { type: 'sawtooth', freq: 210 * f, to: 70, dur: 0.3, gain: 0.1 });
  },

  /** A frost shrine's ice ball: a thin glassy whistle down onto a cold thud. */
  iceball(ctx, dest, v) {
    const f = bend(v, 4);
    tone(ctx, dest, { type: 'sine', freq: 1750 * f, to: 620 * f, dur: 0.22, gain: 0.1 });
    tone(ctx, dest, { type: 'triangle', freq: 500 * f, to: 180, dur: 0.18, gain: 0.07, at: 0.06 });
    noise(ctx, dest, { filter: 'highpass', freq: 4200, to: 1800, dur: 0.16, gain: 0.05, q: 0.5 });
  },

  /** Chain lightning: bright, thin, crackly. */
  zap(ctx, dest, v) {
    const f = bend(v, 5);
    tone(ctx, dest, { type: 'square', freq: 1500 * f, to: 620 * f, dur: 0.1, gain: 0.1 });
    noise(ctx, dest, { filter: 'highpass', freq: 2600, to: 5200, dur: 0.13, gain: 0.075, q: 0.5 });
  },

  // --- one meaning each: always identical --------------------------------
  /** Door key: two notes, the second a fifth up. Purple, magical, brief. */
  keyDoor(ctx, dest) {
    arpeggio(ctx, dest, [hz(81), hz(88)], { step: 0.07, dur: 0.2, gain: 0.14, type: 'square' });
  },

  /** Chest key: three notes up a major triad, plainer and brighter than the door key. */
  keyChest(ctx, dest) {
    arpeggio(ctx, dest, [hz(79), hz(83), hz(86)], {
      step: 0.055,
      dur: 0.17,
      gain: 0.13,
      type: 'triangle',
    });
  },

  /** A lock giving and a heavy door swinging. */
  doorOpen(ctx, dest) {
    tone(ctx, dest, { type: 'square', freq: 700, to: 900, dur: 0.05, gain: 0.11 });
    tone(ctx, dest, {
      type: 'sawtooth',
      freq: 120,
      to: 240,
      dur: 0.34,
      gain: 0.12,
      at: 0.06,
      attack: 0.05,
    });
    noise(ctx, dest, { filter: 'lowpass', freq: 700, to: 220, dur: 0.3, gain: 0.06, at: 0.06 });
  },

  /** "You can't do that": a flat double buzz, no pitch movement, no reward. */
  locked(ctx, dest) {
    tone(ctx, dest, { type: 'square', freq: 155, dur: 0.06, gain: 0.13 });
    tone(ctx, dest, { type: 'square', freq: 146, dur: 0.08, gain: 0.13, at: 0.1 });
  },

  /** The chest jingle. The one sound worth learning by ear. */
  chestOpen(ctx, dest) {
    noise(ctx, dest, { filter: 'lowpass', freq: 1200, to: 300, dur: 0.12, gain: 0.08 });
    arpeggio(ctx, dest, [hz(72), hz(76), hz(79), hz(84)], {
      step: 0.075,
      dur: 0.24,
      gain: 0.13,
      at: 0.05,
      type: 'square',
    });
    tone(ctx, dest, { type: 'triangle', freq: hz(84), dur: 0.5, gain: 0.1, at: 0.28 });
  },

  /** Stairs down: the chest jingle's mirror image, walking downwards. */
  stairs(ctx, dest) {
    arpeggio(ctx, dest, [hz(79), hz(76), hz(72), hz(67)], {
      step: 0.09,
      dur: 0.26,
      gain: 0.12,
      type: 'triangle',
    });
    tone(ctx, dest, { type: 'square', freq: hz(55), dur: 0.6, gain: 0.09, at: 0.34 });
  },

  /** Level up: a bright run that ends on a held note, so it lands. */
  levelUp(ctx, dest) {
    arpeggio(ctx, dest, [hz(72), hz(76), hz(79), hz(84), hz(88)], {
      step: 0.06,
      dur: 0.18,
      gain: 0.13,
      type: 'square',
    });
    tone(ctx, dest, { type: 'square', freq: hz(91), dur: 0.55, gain: 0.13, at: 0.3 });
    tone(ctx, dest, { type: 'triangle', freq: hz(79), dur: 0.6, gain: 0.09, at: 0.3 });
  },

  /** Knocked down: the floor coming up to meet you. */
  knockDown(ctx, dest) {
    tone(ctx, dest, { type: 'sawtooth', freq: 420, to: 45, dur: 0.55, gain: 0.2 });
    noise(ctx, dest, { filter: 'lowpass', freq: 800, to: 90, dur: 0.5, gain: 0.16 });
    tone(ctx, dest, { type: 'square', freq: 90, to: 60, dur: 0.4, gain: 0.09, at: 0.2 });
  },

  /** A health potion downed in one go: a quick glug, then a bright little chime. */
  potion(ctx, dest) {
    noise(ctx, dest, { filter: 'bandpass', freq: 500, to: 1100, dur: 0.14, gain: 0.09, q: 1.0 });
    arpeggio(ctx, dest, [hz(72), hz(76), hz(79), hz(84)], {
      step: 0.06,
      dur: 0.22,
      gain: 0.12,
      at: 0.08,
      type: 'triangle',
    });
  },

  /** Waking up at full health. Soft — the player has been sitting still a while. */
  wake(ctx, dest) {
    tone(ctx, dest, { type: 'triangle', freq: hz(69), dur: 0.22, gain: 0.09, attack: 0.03 });
    tone(ctx, dest, {
      type: 'triangle',
      freq: hz(76),
      dur: 0.4,
      gain: 0.09,
      at: 0.14,
      attack: 0.04,
    });
  },

  /** Money changing hands. */
  buy(ctx, dest) {
    tone(ctx, dest, { type: 'square', freq: hz(83), dur: 0.09, gain: 0.13 });
    tone(ctx, dest, { type: 'square', freq: hz(90), dur: 0.34, gain: 0.13, at: 0.08 });
    tone(ctx, dest, { type: 'triangle', freq: hz(78), dur: 0.34, gain: 0.08, at: 0.08 });
  },

  /** The shield bubble coming back up: a quiet swell, easy to ignore. */
  shieldUp(ctx, dest) {
    tone(ctx, dest, {
      type: 'triangle',
      freq: 320,
      to: 640,
      dur: 0.35,
      gain: 0.07,
      attack: 0.15,
    });
  },

  /** ...and the bubble popping. */
  shieldPop(ctx, dest) {
    tone(ctx, dest, { type: 'sine', freq: 900, to: 260, dur: 0.16, gain: 0.14 });
    noise(ctx, dest, { filter: 'highpass', freq: 1800, to: 700, dur: 0.12, gain: 0.07 });
  },

  /** The phoenix feather burning. Big, rising, unmistakable. */
  phoenix(ctx, dest) {
    tone(ctx, dest, {
      type: 'sawtooth',
      freq: 180,
      to: 1100,
      dur: 0.6,
      gain: 0.16,
      attack: 0.06,
      vibrato: { hz: 7, cents: 30 },
    });
    noise(ctx, dest, { filter: 'bandpass', freq: 500, to: 4000, dur: 0.6, gain: 0.09, q: 0.7 });
    arpeggio(ctx, dest, [hz(76), hz(83), hz(88)], {
      step: 0.1,
      dur: 0.4,
      gain: 0.11,
      at: 0.35,
      type: 'square',
    });
  },

  /** A necromancer's crystal breaking: glass, then a long ring out. */
  crystal(ctx, dest) {
    noise(ctx, dest, { filter: 'highpass', freq: 3000, to: 8000, dur: 0.3, gain: 0.13, q: 0.4 });
    tone(ctx, dest, { type: 'triangle', freq: hz(96), to: hz(89), dur: 0.5, gain: 0.12 });
    tone(ctx, dest, { type: 'triangle', freq: hz(89), dur: 0.9, gain: 0.07, at: 0.1 });
  },

  /** Hitting something that cannot be hurt: a dead, muffled thud. */
  immune(ctx, dest) {
    noise(ctx, dest, { filter: 'lowpass', freq: 380, to: 140, dur: 0.13, gain: 0.13, q: 0.5 });
    tone(ctx, dest, { type: 'triangle', freq: 105, to: 88, dur: 0.12, gain: 0.08 });
  },

  /** An angel opening its eyes. Two notes a semitone apart, held. Wrong on purpose. */
  angel(ctx, dest) {
    tone(ctx, dest, {
      type: 'triangle',
      freq: hz(70),
      dur: 1.1,
      gain: 0.1,
      attack: 0.25,
      vibrato: { hz: 4.5, cents: 22 },
    });
    tone(ctx, dest, {
      type: 'triangle',
      freq: hz(71),
      dur: 1.1,
      gain: 0.08,
      attack: 0.35,
      detune: 8,
    });
  },

  /**
   * An alcove lighting up. A soft bell swelling open — no fanfare, this is a
   * gift you picked up, not a floor you beat.
   */
  shrine(ctx, dest) {
    arpeggio(ctx, dest, [hz(69), hz(76), hz(81)], {
      step: 0.08,
      dur: 0.4,
      gain: 0.1,
      type: 'triangle',
    });
    tone(ctx, dest, { type: 'sine', freq: hz(88), dur: 0.8, gain: 0.07, at: 0.22, attack: 0.12 });
  },

  /** The last temporary heart going: the same shape as the shrine, downward. */
  wardBreak(ctx, dest) {
    tone(ctx, dest, { type: 'sine', freq: hz(81), to: hz(69), dur: 0.3, gain: 0.11 });
    noise(ctx, dest, { filter: 'highpass', freq: 2600, to: 900, dur: 0.2, gain: 0.06 });
  },

  /** Boss down. The longest sound in the game, and the only real fanfare. */
  bossWin(ctx, dest) {
    arpeggio(ctx, dest, [hz(65), hz(69), hz(72), hz(77)], {
      step: 0.1,
      dur: 0.3,
      gain: 0.13,
      type: 'square',
    });
    arpeggio(ctx, dest, [hz(76), hz(79), hz(84)], {
      step: 0.11,
      dur: 0.34,
      gain: 0.13,
      at: 0.42,
      type: 'square',
    });
    tone(ctx, dest, { type: 'square', freq: hz(88), dur: 1.0, gain: 0.13, at: 0.75 });
    tone(ctx, dest, { type: 'triangle', freq: hz(76), dur: 1.0, gain: 0.09, at: 0.75 });
    tone(ctx, dest, { type: 'triangle', freq: hz(64), dur: 1.1, gain: 0.09, at: 0.75 });
  },

  /** The run ending: four notes down a minor chord, slow, no hurry. */
  gameOver(ctx, dest) {
    arpeggio(ctx, dest, [hz(69), hz(65), hz(62), hz(57)], {
      step: 0.24,
      dur: 0.5,
      gain: 0.12,
      type: 'triangle',
    });
    tone(ctx, dest, { type: 'sawtooth', freq: hz(45), dur: 1.6, gain: 0.09, at: 0.7, attack: 0.2 });
  },
};

/** Play one sound. `v` (-1..1) is ignored by every fixed sound. */
export function playSfx(ctx: BaseAudioContext, dest: AudioNode, id: SfxId, v: number): void {
  const voice = SFX[id];
  if (voice) voice(ctx, dest, v);
}
