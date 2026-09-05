/**
 * The bottom of the audio stack: a handful of one-shot Web Audio voices.
 *
 * Everything you hear in Table Maze is made here, at runtime — there are no
 * sound files to download, the same way the sprites are drawn in code rather
 * than loaded as images. The palette is deliberately small and deliberately
 * old: square, triangle and sawtooth oscillators with short envelopes, plus
 * white noise for anything percussive. That combination is what a 1980s sound
 * chip could do, and it is why this comes out sounding like one.
 *
 * Every voice here is fire-and-forget: it builds its nodes, schedules them
 * against the AudioContext clock, and stops them. Stopped source nodes
 * disconnect themselves and are collected, so nothing needs cleaning up.
 */

/** Semitones above A4 (440 Hz) as a frequency. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * One second of white noise, made once per context and shared by every noise
 * voice. Building a buffer per hit would allocate a few hundred KB a second in
 * a busy fight.
 */
const NOISE = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = NOISE.get(ctx);
  if (cached) return cached;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  NOISE.set(ctx, buf);
  return buf;
}

export interface ToneOpts {
  /** Waveform. Square is the classic chiptune lead; triangle is the soft one. */
  type?: OscillatorType;
  /** Starting pitch in Hz. */
  freq: number;
  /** Ending pitch in Hz, if the note should slide. Defaults to `freq`. */
  to?: number;
  /** Seconds from `now` before the note starts. */
  at?: number;
  /** Total length in seconds, envelope included. */
  dur: number;
  /** Peak gain, 0..1. */
  gain?: number;
  /** Attack time in seconds. Short = percussive, longer = a swell. */
  attack?: number;
  /**
   * Seconds of fade at the end. Given, the note holds at full volume between
   * the attack and the fade instead of decaying the whole way — which is the
   * difference between a plucked note and a pad you can lie under.
   */
  release?: number;
  /** Detune in cents, for thickening two voices against each other. */
  detune?: number;
  /** Slow pitch wobble: how fast, and how wide in cents. */
  vibrato?: { hz: number; cents: number };
}

/**
 * A single pitched note. The envelope is a fast linear attack into an
 * exponential decay, which is what gives plucked chip notes their bite —
 * exponential ramps can never reach zero, so the tail ends on a tiny value and
 * a final ramp to silence.
 */
export function tone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOpts): void {
  const t0 = ctx.currentTime + (o.at ?? 0);
  const dur = Math.max(0.01, o.dur);
  const peak = Math.max(0.0001, o.gain ?? 0.2);
  const attack = Math.min(o.attack ?? 0.004, dur * 0.5);

  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'square';
  if (o.detune) osc.detune.value = o.detune;
  osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
  if (o.to !== undefined && o.to !== o.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  if (o.release !== undefined) {
    // Hold, then fade: no automation between these two points leaves the gain
    // sitting at `peak`, which is the sustain.
    env.gain.setValueAtTime(peak, t0 + Math.max(attack, dur - o.release));
  }
  env.gain.exponentialRampToValueAtTime(peak * 0.02, t0 + dur);
  env.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.01);

  osc.connect(env).connect(dest);

  let lfo: OscillatorNode | null = null;
  if (o.vibrato) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = o.vibrato.hz;
    const depth = ctx.createGain();
    depth.gain.value = o.vibrato.cents;
    lfo.connect(depth).connect(osc.detune);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.02);
  }

  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/**
 * A room to put the sound in: noise decaying over `seconds`, in stereo, for a
 * ConvolverNode. Made once per context and shared — building one is a second's
 * worth of arithmetic.
 */
const IMPULSE = new WeakMap<BaseAudioContext, AudioBuffer>();

export function reverbImpulse(ctx: BaseAudioContext, seconds = 2.8, decay = 2.6): AudioBuffer {
  const cached = IMPULSE.get(ctx);
  if (cached) return cached;
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      // A short silent head makes it read as a large space rather than a box.
      const head = i < ctx.sampleRate * 0.02 ? i / (ctx.sampleRate * 0.02) : 1;
      data[i] = (Math.random() * 2 - 1) * head * Math.pow(1 - i / n, decay);
    }
  }
  IMPULSE.set(ctx, buf);
  return buf;
}

export interface NoiseOpts {
  at?: number;
  dur: number;
  gain?: number;
  /** Filter shape. Lowpass = thud, highpass = hiss, bandpass = whoosh. */
  filter?: BiquadFilterType;
  /** Filter cutoff in Hz at the start... */
  freq?: number;
  /** ...and where it sweeps to by the end. Defaults to `freq`. */
  to?: number;
  q?: number;
  attack?: number;
}

/**
 * A burst of filtered white noise: hits, footsteps, whooshes, breaking glass.
 * Sweeping the filter is what turns one noise buffer into a dozen different
 * percussive sounds.
 */
export function noise(ctx: BaseAudioContext, dest: AudioNode, o: NoiseOpts): void {
  const t0 = ctx.currentTime + (o.at ?? 0);
  const dur = Math.max(0.01, o.dur);
  const peak = Math.max(0.0001, o.gain ?? 0.2);
  const attack = Math.min(o.attack ?? 0.002, dur * 0.5);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  // Start somewhere random in the buffer so repeated hits never phase-align.
  const offset = Math.random() * Math.max(0, (src.buffer?.duration ?? 1) - dur - 0.05);

  const filter = ctx.createBiquadFilter();
  filter.type = o.filter ?? 'bandpass';
  filter.Q.value = o.q ?? 1;
  const f0 = Math.max(20, o.freq ?? 1200);
  filter.frequency.setValueAtTime(f0, t0);
  if (o.to !== undefined && o.to !== f0) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(peak * 0.02, t0 + dur);
  env.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.01);

  src.connect(filter).connect(env).connect(dest);
  src.start(t0, offset, dur + 0.05);
  src.stop(t0 + dur + 0.02);
}

/**
 * A run of notes, each one `step` seconds after the last. The workhorse behind
 * every jingle in the game: fanfares, stingers and the little rising runs that
 * say "you picked something up".
 */
export function arpeggio(
  ctx: BaseAudioContext,
  dest: AudioNode,
  notes: number[],
  o: { step: number; at?: number; dur?: number; gain?: number; type?: OscillatorType },
): void {
  const at = o.at ?? 0;
  for (let i = 0; i < notes.length; i++) {
    tone(ctx, dest, {
      type: o.type ?? 'square',
      freq: notes[i],
      at: at + i * o.step,
      dur: o.dur ?? o.step * 1.6,
      gain: o.gain ?? 0.16,
    });
  }
}
