/**
 * The background music: a small chiptune band that writes its own parts as it
 * plays.
 *
 * Nothing here is a recorded loop. A track is a description — key, scale,
 * tempo, chord progression, how busy the melody is, what the drums do — and
 * the player fills that description in bar by bar. The chords and the bass
 * come round on a fixed cycle so the music always has a shape you can settle
 * into; the melody is a short motif that is re-written every few bars and
 * nudged in between, and every eighth bar the lead drops out entirely. So it
 * never plays the same eight bars twice, and it never demands your attention
 * either, which is the point: this is music to read a maze over.
 *
 * There are seven tracks. The dungeon theme picks one (and the theme changes
 * every three floors), shops get their own, and boss chambers get the only
 * fast one.
 */

import { hashSeed, makeRng } from '../engine/rng';
import type { Rng } from '../engine/types';
import { midiToHz as hz, noise, tone } from './synth';

export type TrackId =
  | 'nocturne'
  | 'undertow'
  | 'ember'
  | 'frost'
  | 'descent'
  | 'market'
  | 'dread';

// Scales as semitone offsets from the tonic. Seven notes each, so "degree + 7"
// is always the same note an octave up.
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

interface Track {
  bpm: number;
  /** MIDI note of the tonic, down in the bass octave. */
  root: number;
  scale: readonly number[];
  /** One scale degree per bar; wraps round for as long as the track plays. */
  progression: readonly number[];
  lead: OscillatorType;
  /** Chance any one melody slot holds a note instead of a rest. */
  density: number;
  /** Chord arpeggio underneath: 0 = none, 1 = eighths, 2 = sixteenths. */
  arp: 0 | 1 | 2;
  drums: 'none' | 'soft' | 'driving';
  /** Octaves between the bass and the melody. */
  leadOctave: number;
  /** Per-track level trim, so a busy track doesn't shout over a sparse one. */
  gain: number;
}

/** Every track id, in a fixed order; the index seeds that track's performance. */
const TRACK_IDS: readonly TrackId[] = [
  'nocturne',
  'undertow',
  'ember',
  'frost',
  'descent',
  'market',
  'dread',
];

const TRACKS: Record<TrackId, Track> = {
  /** Crypt and library: slow, minor, mostly space. */
  nocturne: {
    bpm: 84,
    root: 45,
    scale: MINOR,
    progression: [0, 5, 3, 4],
    lead: 'triangle',
    density: 0.4,
    arp: 1,
    drums: 'none',
    leadOctave: 2,
    gain: 1,
  },
  /** Sewer and overgrown ruins: a walking pulse, damp and rolling. */
  undertow: {
    bpm: 100,
    root: 38,
    scale: DORIAN,
    progression: [0, 3, 0, 6, 0, 3, 4, 3],
    lead: 'square',
    density: 0.42,
    arp: 2,
    drums: 'soft',
    leadOctave: 2,
    gain: 0.9,
  },
  /** Magma cavern and hive: the closest this game gets to urgent. */
  ember: {
    bpm: 116,
    root: 40,
    scale: MINOR,
    progression: [0, 0, 5, 4, 0, 3, 5, 4],
    lead: 'square',
    density: 0.48,
    arp: 2,
    drums: 'driving',
    leadOctave: 2,
    gain: 0.85,
  },
  /** Glacier: high, thin and very slow. Almost nothing happens. */
  frost: {
    bpm: 72,
    root: 47,
    scale: MINOR,
    progression: [0, 5, 3, 6],
    lead: 'triangle',
    density: 0.3,
    arp: 1,
    drums: 'none',
    leadOctave: 3,
    gain: 1,
  },
  /** Abyss: phrygian, so the second note of the scale sits a semitone up and sours everything. */
  descent: {
    bpm: 92,
    root: 43,
    scale: PHRYGIAN,
    progression: [0, 1, 0, 6, 0, 1, 5, 4],
    lead: 'square',
    density: 0.38,
    arp: 1,
    drums: 'soft',
    leadOctave: 2,
    gain: 0.95,
  },
  /** The shop: the one track in a major key. Warm, and shorter-breathed. */
  market: {
    bpm: 96,
    root: 41,
    scale: MAJOR,
    progression: [0, 3, 4, 0, 5, 3, 4, 4],
    lead: 'triangle',
    density: 0.5,
    arp: 2,
    drums: 'soft',
    leadOctave: 2,
    gain: 0.9,
  },
  /** Boss chambers: fast, harmonic minor, drums that don't let up. */
  dread: {
    bpm: 138,
    root: 45,
    scale: HARMONIC_MINOR,
    progression: [0, 0, 5, 4, 0, 0, 1, 4],
    lead: 'square',
    density: 0.55,
    arp: 2,
    drums: 'driving',
    leadOctave: 2,
    gain: 0.85,
  },
};

/** Which track a maze floor's theme plays. Neighbouring themes never share one. */
const THEME_TRACK: Record<string, TrackId> = {
  crypt: 'nocturne',
  sewer: 'undertow',
  cavern: 'ember',
  glacier: 'frost',
  forest: 'undertow',
  library: 'nocturne',
  hive: 'ember',
  abyss: 'descent',
};

/** The track for the level the hero is standing on. */
export function trackForLevel(kind: 'maze' | 'shop' | 'boss', theme: string): TrackId {
  if (kind === 'boss') return 'dread';
  if (kind === 'shop') return 'market';
  return THEME_TRACK[theme] ?? 'nocturne';
}

/**
 * Bass figures, one bar of sixteenths each. Numbers are scale steps above the
 * chord's root (0 root, 2 third, 4 fifth, 7 the octave); null is a rest. The
 * player holds one figure for two bars at a time so the bass line has a shape.
 */
const BASS_FIGURES: readonly (number | null)[][] = [
  [0, null, null, null, null, null, 4, null, 0, null, null, null, 4, null, null, null],
  [0, null, 0, null, null, null, null, null, 4, null, null, null, null, null, 0, null],
  [0, null, null, 0, null, null, 4, null, null, null, 0, null, null, 4, null, null],
  [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, 7, null],
  [0, null, null, null, 7, null, null, null, 4, null, null, null, 2, null, null, null],
];

/** The notes an arpeggio walks, as scale steps above the chord root. */
const ARP_SHAPE = [0, 2, 4, 7, 4, 2];

/** Sixteenths per bar. Everything in here is in 4/4. */
const STEPS = 16;
/** How far ahead of the clock notes are scheduled, in seconds. */
const LOOKAHEAD = 0.3;
/** How often the scheduler wakes up to top that up, in ms. */
const TICK_MS = 25;
/** Seconds to fade the old track out and the new one in. */
const FADE = 0.7;

/** Where a scale degree lands as a MIDI note. Degrees below 0 or above 6 wrap octaves. */
function scaleNote(track: Track, degree: number, octave: number): number {
  const n = track.scale.length;
  const i = ((degree % n) + n) % n;
  const o = Math.floor(degree / n) + octave;
  return track.root + track.scale[i] + 12 * o;
}

/** Chord tones, as scale steps either side of the chord root. Strong beats land on these. */
const CHORD_TONES = [-3, 0, 2, 4, 7];

function nearestChordTone(deg: number): number {
  let best = CHORD_TONES[0];
  for (const t of CHORD_TONES) {
    if (Math.abs(t - deg) < Math.abs(best - deg)) best = t;
  }
  return best;
}

/**
 * Plays one track at a time and crossfades between them.
 *
 * Web Audio's clock runs independently of the browser's frame loop, so notes
 * are scheduled a fraction of a second ahead of time rather than "now": a
 * dropped frame or a busy render can never make the music stutter.
 */
export class MusicPlayer {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly voices: GainNode;
  private readonly delay: DelayNode;

  private trackId: TrackId | null = null;
  private track: Track | null = null;
  private rng: Rng = makeRng(1);

  private timer: number | null = null;
  /** AudioContext time the next sixteenth falls on. */
  private nextTime = 0;
  private step = 0;
  private bar = -1;
  private chord = 0;
  private figure: (number | null)[] = BASS_FIGURES[0];
  /** One entry per eighth note: a scale step above the chord root, or a rest. */
  private motif: (number | null)[] = [];
  private restBar = false;

  /** Track queued behind the current fade-out, and the clock time to swap on. */
  private pending: TrackId | null = null;
  private swapAt = 0;
  /** Clock time a fade to silence finishes, or 0 when nothing is fading out. */
  private stopAt = 0;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    // A gentle lowpass takes the fizz off the square waves. Chip music without
    // it is accurate but tiring, and this has to sit under an hour of play.
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 2700;
    soften.Q.value = 0.7;
    soften.connect(this.out);

    this.voices = ctx.createGain();
    this.voices.gain.value = 1;
    this.voices.connect(soften);

    // A short feedback delay: the cheapest way to make four bare oscillators
    // sound like they are in a room rather than in a spreadsheet.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.28;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.26;
    const send = ctx.createGain();
    send.gain.value = 0.3;
    this.voices.connect(send);
    send.connect(this.delay);
    this.delay.connect(feedback);
    feedback.connect(this.delay);
    this.delay.connect(soften);
  }

  /** The track currently playing (or fading in), if any. */
  get current(): TrackId | null {
    return this.pending ?? this.trackId;
  }

  /**
   * Switch to `id`, or to silence when it is null. The change is a crossfade,
   * so walking through a door never clips the music off mid-note.
   */
  play(id: TrackId | null): void {
    if (this.current === id) return;
    const now = this.ctx.currentTime;
    if (this.trackId === null && id !== null) {
      // Nothing playing: start straight away and fade up.
      this.begin(id, now + 0.08);
      return;
    }
    this.pending = id;
    this.swapAt = id === null ? 0 : now + FADE;
    this.stopAt = id === null ? now + FADE : 0;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(0.0001, now + FADE);
  }

  /** Stop scheduling entirely and release the timer. */
  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.trackId = null;
    this.track = null;
    this.pending = null;
    this.swapAt = 0;
    this.stopAt = 0;
    try {
      this.out.gain.cancelScheduledValues(this.ctx.currentTime);
      this.out.gain.value = 0;
    } catch {
      /* the context may already be closed */
    }
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  private begin(id: TrackId, at: number): void {
    this.trackId = id;
    this.track = TRACKS[id];
    this.pending = null;
    this.swapAt = 0;
    this.stopAt = 0;
    // Seeded from the track and the clock, so two visits to the same theme are
    // recognisably the same music without being the same performance.
    this.rng = makeRng(hashSeed(Math.floor(at * 1000), TRACK_IDS.indexOf(id)));
    this.nextTime = at;
    this.step = 0;
    this.bar = -1;
    this.motif = [];
    this.delay.delayTime.value = Math.min(0.9, this.stepDur() * 3);

    const g = this.out.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(1, now + FADE);

    if (this.timer === null) {
      this.timer = setInterval(() => this.pump(), TICK_MS) as unknown as number;
    }
  }

  private stepDur(): number {
    return this.track ? 60 / this.track.bpm / 4 : 0.1;
  }

  /** Top up the schedule. Called on a plain interval; the audio clock does the rest. */
  private pump(): void {
    const now = this.ctx.currentTime;

    if (this.pending !== null && now >= this.swapAt) {
      this.begin(this.pending, now + 0.05);
      return;
    }
    // The fade to silence has run out: stop scheduling and drop the timer.
    if (this.stopAt > 0 && now >= this.stopAt) {
      this.dispose();
      return;
    }
    if (!this.track) return;

    // A backgrounded tab throttles this interval to about once a second, so we
    // can come back to a schedule that is far behind. Never try to catch up by
    // playing the missing bars at once: skip to the present.
    if (this.nextTime < now - 0.5) {
      this.nextTime = now + 0.05;
      this.step = 0;
    }

    const dur = this.stepDur();
    let guard = 0;
    while (this.nextTime < now + LOOKAHEAD && guard < 64) {
      guard += 1;
      if (this.step === 0) this.newBar();
      this.scheduleStep(this.nextTime, this.step);
      this.nextTime += dur;
      this.step = (this.step + 1) % STEPS;
    }
  }

  /**
   * Set up the bar about to start: move to the next chord, re-write or nudge
   * the melody, and decide whether the lead sits this one out.
   */
  private newBar(): void {
    const track = this.track;
    if (!track) return;
    this.bar += 1;
    this.chord = track.progression[this.bar % track.progression.length];

    // The bass holds a figure for two bars, so it reads as a line rather than
    // a new idea every bar.
    if (this.bar % 2 === 0) this.figure = this.rng.pick(BASS_FIGURES);

    // A fresh melody every four bars; in between, one or two notes move. That
    // is enough to keep it from looping without losing the thread.
    if (this.motif.length === 0 || this.bar % 4 === 0) this.motif = this.makeMotif();
    else this.mutateMotif();

    // Every eighth bar the lead drops out. Silence is what stops background
    // music turning into foreground music.
    this.restBar = this.bar % 8 === 7;
  }

  /** Eight eighth-notes: chord tones on the strong beats, a wandering line between. */
  private makeMotif(): (number | null)[] {
    const track = this.track;
    if (!track) return [];
    const out: (number | null)[] = [];
    let cur = this.rng.pick([0, 2, 4]);
    for (let i = 0; i < 8; i++) {
      const strong = i % 2 === 0;
      const chance = strong ? track.density + 0.22 : track.density - 0.1;
      if (!this.rng.chance(chance)) {
        out.push(null);
        continue;
      }
      cur = Math.max(-3, Math.min(9, cur + this.rng.int(-2, 2)));
      out.push(strong ? nearestChordTone(cur) : cur);
    }
    return out;
  }

  /** Re-roll a slot or two of the current motif: a variation, not a new tune. */
  private mutateMotif(): void {
    const track = this.track;
    if (!track) return;
    const changes = this.rng.int(1, 2);
    for (let n = 0; n < changes; n++) {
      const i = this.rng.int(0, this.motif.length - 1);
      if (this.rng.chance(0.28)) {
        this.motif[i] = null;
      } else {
        const near = this.motif.find((x) => x !== null) ?? 0;
        const deg = Math.max(-3, Math.min(9, (near as number) + this.rng.int(-2, 2)));
        this.motif[i] = i % 2 === 0 ? nearestChordTone(deg) : deg;
      }
    }
  }

  /** Everything that sounds on one sixteenth of the bar. */
  private scheduleStep(t: number, step: number): void {
    const track = this.track;
    if (!track) return;
    const at = t - this.ctx.currentTime;
    if (at < -0.05) return;
    const dur = this.stepDur();
    const g = track.gain;

    // --- bass ---------------------------------------------------------------
    const b = this.figure[step];
    if (b !== null && b !== undefined) {
      tone(this.ctx, this.voices, {
        type: 'triangle',
        freq: hz(scaleNote(track, this.chord + b, 0)),
        at,
        dur: dur * 2.4,
        gain: 0.2 * g,
        attack: 0.008,
      });
    }

    // --- chord arpeggio -----------------------------------------------------
    if (track.arp > 0 && (track.arp === 2 || step % 2 === 0)) {
      const idx = track.arp === 2 ? step : step / 2;
      const deg = ARP_SHAPE[idx % ARP_SHAPE.length];
      tone(this.ctx, this.voices, {
        type: 'square',
        freq: hz(scaleNote(track, this.chord + deg, 1)),
        at,
        dur: dur * 1.3,
        gain: 0.045 * g,
      });
    }

    // --- melody -------------------------------------------------------------
    if (!this.restBar && step % 2 === 0) {
      const deg = this.motif[step / 2];
      if (deg !== null && deg !== undefined) {
        tone(this.ctx, this.voices, {
          type: track.lead,
          freq: hz(scaleNote(track, this.chord + deg, track.leadOctave)),
          at,
          dur: dur * 2.2,
          gain: 0.095 * g,
          attack: 0.006,
        });
      }
    }

    // --- drums --------------------------------------------------------------
    if (track.drums === 'none') return;
    const driving = track.drums === 'driving';
    if (step === 0 || step === 8 || (driving && step === 6)) {
      tone(this.ctx, this.voices, {
        type: 'sine',
        freq: 130,
        to: 45,
        at,
        dur: 0.14,
        gain: 0.16 * g,
      });
    }
    if (step % 4 === 2) {
      noise(this.ctx, this.voices, {
        filter: 'highpass',
        freq: 6500,
        at,
        dur: 0.03,
        gain: 0.026 * g,
      });
    }
    if (driving && step === 8) {
      noise(this.ctx, this.voices, {
        filter: 'highpass',
        freq: 1800,
        to: 3200,
        at,
        dur: 0.09,
        gain: 0.06 * g,
      });
    }
  }
}
