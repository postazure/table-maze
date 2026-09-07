/**
 * The background music: slow, sparse, mostly held chords.
 *
 * This is ambience rather than a tune. A dungeon crawl is played in long
 * stretches, so anything with a hook in it turns into an earworm and then into
 * the reason someone hits mute. What plays instead is a low drone, a chord that
 * changes every twenty seconds or so, and a handful of single notes an ear can
 * wander past — all of it through a big reverb, so the dungeon sounds like a
 * large stone room rather than a sound chip.
 *
 * Nothing here is a recorded loop. A track is a description — key, scale,
 * tempo, chord progression, how many notes a bar may hold — and the player
 * fills it in bar by bar: the chords come round on a fixed cycle so the music
 * has a shape, while which notes land, and whether any land at all, is decided
 * as it goes. Roughly a third of bars are silent above the drone.
 *
 * There are seven tracks. The dungeon theme picks one (and the theme changes
 * every three floors), shops get their own, and boss chambers get the one with
 * a pulse under it.
 */

import { hashSeed, makeRng } from '../engine/rng';
import type { Rng } from '../engine/types';
import { midiToHz as hz, noise, reverbImpulse, tone } from './synth';

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
  /** Slow. A bar lasts four beats, so 50 bpm is a bar every five seconds. */
  bpm: number;
  /** MIDI note of the tonic, down in the drone octave. */
  root: number;
  scale: readonly number[];
  /** Scale degrees, one chord each; wraps for as long as the track plays. */
  progression: readonly number[];
  /** Bars each chord is held for. Two or three, so nothing hurries. */
  chordBars: number;
  lead: OscillatorType;
  /** Most single notes a bar may hold. 0 = no melody at all, just the chord. */
  notes: number;
  /** Octaves between the drone and those notes. */
  leadOctave: number;
  /** A slow low pulse under everything, like a heartbeat. 0 = none. */
  pulse: number;
  /** Per-track level trim. */
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
  /** Crypt and library: the quietest thing here. Long chords, almost no notes. */
  nocturne: {
    bpm: 50,
    root: 45,
    scale: MINOR,
    progression: [0, 5, 3, 4],
    chordBars: 3,
    lead: 'triangle',
    notes: 1,
    leadOctave: 2,
    pulse: 0,
    gain: 1,
  },
  /** Sewer and overgrown ruins: damp and low, with the odd note dripping off it. */
  undertow: {
    bpm: 54,
    root: 38,
    scale: DORIAN,
    progression: [0, 3, 0, 6],
    chordBars: 2,
    lead: 'triangle',
    notes: 1,
    leadOctave: 2,
    pulse: 0,
    gain: 0.95,
  },
  /** Magma cavern and hive: warmer, and the only maze track with a pulse. */
  ember: {
    bpm: 58,
    root: 40,
    scale: MINOR,
    progression: [0, 0, 5, 4, 0, 3],
    chordBars: 2,
    lead: 'triangle',
    notes: 2,
    leadOctave: 2,
    pulse: 0.4,
    gain: 0.9,
  },
  /** Glacier: high, thin and slower than anything else. Nearly empty. */
  frost: {
    bpm: 44,
    root: 47,
    scale: MINOR,
    progression: [0, 5, 3, 6],
    chordBars: 3,
    lead: 'triangle',
    notes: 1,
    leadOctave: 3,
    pulse: 0,
    gain: 1,
  },
  /** Abyss: phrygian, so the second note of the scale sits a semitone up and sours everything. */
  descent: {
    bpm: 48,
    root: 43,
    scale: PHRYGIAN,
    progression: [0, 1, 0, 6],
    chordBars: 3,
    lead: 'square',
    notes: 1,
    leadOctave: 2,
    pulse: 0,
    gain: 0.95,
  },
  /** The shop: the one track in a major key. Still slow, just not sad. */
  market: {
    bpm: 60,
    root: 41,
    scale: MAJOR,
    progression: [0, 3, 4, 5],
    chordBars: 2,
    lead: 'triangle',
    notes: 2,
    leadOctave: 2,
    pulse: 0,
    gain: 0.9,
  },
  /**
   * Boss chambers. Still slow — a fast tune would fight the fight — but a
   * heartbeat under a harmonic-minor drone does the tension on its own.
   */
  dread: {
    bpm: 64,
    root: 45,
    scale: HARMONIC_MINOR,
    progression: [0, 0, 1, 4],
    chordBars: 2,
    lead: 'square',
    notes: 2,
    leadOctave: 2,
    pulse: 1,
    gain: 0.9,
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
export function trackForLevel(kind: 'maze' | 'shop' | 'boss' | 'world', theme: string): TrackId {
  if (kind === 'boss') return 'dread';
  if (kind === 'shop') return 'market';
  // A boss world plays by its theme like a maze floor; a world theme with no
  // track of its own gets the boss chambers' pulse.
  if (kind === 'world') return THEME_TRACK[theme] ?? 'dread';
  return THEME_TRACK[theme] ?? 'nocturne';
}

/** Beats per bar. Everything in here is in 4/4, slowly. */
const BEATS = 4;
/** How far ahead of the clock a bar is scheduled, in seconds. */
const LOOKAHEAD = 1.2;
/** How often the scheduler wakes up to top that up, in ms. */
const TICK_MS = 200;
/** Seconds to fade the old track out and the new one in. */
const FADE = 1.4;
/** Chance a bar holds no melody note at all. Silence is most of the point. */
const REST_CHANCE = 0.34;

/** Where a scale degree lands as a MIDI note. Degrees below 0 or above 6 wrap octaves. */
function scaleNote(track: Track, degree: number, octave: number): number {
  const n = track.scale.length;
  const i = ((degree % n) + n) % n;
  const o = Math.floor(degree / n) + octave;
  return track.root + track.scale[i] + 12 * o;
}

/** Chord tones, as scale steps either side of the chord root. Notes land on these. */
const CHORD_TONES = [-3, 0, 2, 4, 7];

/**
 * Plays one track at a time and crossfades between them.
 *
 * Web Audio's clock runs independently of the browser's frame loop, so a whole
 * bar is scheduled against it a second or so before it is due: a dropped frame
 * or a busy render can never make the music stutter.
 */
export class MusicPlayer {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly voices: GainNode;

  private trackId: TrackId | null = null;
  private track: Track | null = null;
  private rng: Rng = makeRng(1);

  private timer: number | null = null;
  /** AudioContext time the next bar starts on. */
  private nextTime = 0;
  private bar = 0;
  private chord = 0;
  /** Where the last melody note sat, so the next one is a step away, not a leap. */
  private lastDegree = 0;

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

    // A low lowpass takes the edge off the oscillators. Chip waveforms are
    // accurate but tiring, and this has to sit under an hour of play.
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 1800;
    soften.Q.value = 0.6;
    soften.connect(this.out);

    this.voices = ctx.createGain();
    this.voices.gain.value = 1;
    this.voices.connect(soften);

    // The reverb is what turns a few oscillators into a place. Most of the
    // signal goes through it: the tail is the point, not the note.
    const room = ctx.createConvolver();
    room.buffer = reverbImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.85;
    this.voices.connect(room);
    room.connect(wet).connect(soften);
  }

  /** The track currently playing (or fading in), if any. */
  get current(): TrackId | null {
    return this.pending ?? this.trackId;
  }

  /**
   * Switch to `id`, or to silence when it is null. The change is a long
   * crossfade, so walking through a door never clips the music off mid-chord.
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
    this.bar = 0;
    this.lastDegree = 0;

    const g = this.out.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(1, now + FADE);

    if (this.timer === null) {
      this.timer = setInterval(() => this.pump(), TICK_MS) as unknown as number;
    }
    // Lay the first bar down now. Waiting for the interval would drop it — and
    // with it the chord, which only re-voices every few bars.
    this.pump();
  }

  /** Seconds in one bar. */
  private barDur(): number {
    return this.track ? (60 / this.track.bpm) * BEATS : 4;
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

    // A backgrounded tab throttles this interval, so we can come back to a
    // schedule that is far behind. Never catch up by playing the missing bars
    // at once: skip to the present.
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;

    let guard = 0;
    while (this.nextTime < now + LOOKAHEAD && guard < 4) {
      guard += 1;
      const dur = this.barDur();
      this.playBar(this.nextTime, dur);
      this.nextTime += dur;
      this.bar += 1;
    }
  }

  /** Everything that sounds in one bar, scheduled in one go. */
  private playBar(at: number, dur: number): void {
    const track = this.track;
    if (!track) return;
    // A bar the scheduler reached slightly late still plays, starting now; only
    // one a whole bar stale is dropped (pump's catch-up covers that case).
    const late = this.ctx.currentTime - at;
    if (late > dur) return;
    const offset = Math.max(0, -late);
    const g = track.gain;

    // The chord holds for several bars; only its first bar re-voices the pad.
    const held = track.chordBars;
    if (this.bar % held === 0) {
      this.chord = track.progression[Math.floor(this.bar / held) % track.progression.length];
      this.chordVoices(dur * held, offset, g);
    }

    this.melody(offset, dur, g);

    if (track.pulse > 0) {
      // One low thud a bar, on the downbeat. Not a drum kit — a heartbeat.
      tone(this.ctx, this.voices, {
        type: 'sine',
        freq: 96,
        to: 44,
        at: offset,
        dur: 0.5,
        gain: 0.13 * track.pulse * g,
        attack: 0.02,
      });
    }

    // Every few bars, a breath of air moving through the stone.
    if (this.rng.chance(0.25)) {
      noise(this.ctx, this.voices, {
        filter: 'bandpass',
        freq: 240,
        to: 620,
        at: offset + this.rng.next() * dur * 0.5,
        dur: dur * 0.8,
        gain: 0.022 * g,
        q: 0.6,
        attack: dur * 0.3,
      });
    }
  }

  /**
   * The drone and the chord over it. Both run a fade longer than the chord's
   * own span so that one chord's tail is still sounding under the next one's
   * swell: the bed never breathes, it just changes colour.
   */
  private chordVoices(span: number, offset: number, g: number): void {
    const track = this.track;
    if (!track) return;
    const fade = Math.min(2.2, span * 0.4);
    const dur = span + fade;

    // The drone: the tonic, always, underneath whatever the chord is doing.
    // It is what makes the floor feel like one continuous place.
    tone(this.ctx, this.voices, {
      type: 'triangle',
      freq: hz(scaleNote(track, 0, 0)),
      at: offset,
      dur,
      gain: 0.16 * g,
      attack: fade,
      release: fade,
    });

    // The chord itself: root, third and fifth, each doubled and detuned a
    // few cents so the pair beats slowly against itself.
    for (const step of [0, 2, 4]) {
      const f = hz(scaleNote(track, this.chord + step, 1));
      for (const cents of [-5, 5]) {
        tone(this.ctx, this.voices, {
          type: 'triangle',
          freq: f,
          detune: cents,
          at: offset + (step / 8) * fade,
          dur,
          gain: 0.055 * g,
          attack: fade,
          release: fade,
        });
      }
    }
  }

  /**
   * The one thing in here that could be called a tune: at most a couple of long
   * notes, on chord tones, on a beat — and a third of bars have none at all.
   */
  private melody(offset: number, dur: number, g: number): void {
    const track = this.track;
    if (!track || track.notes === 0 || this.rng.chance(REST_CHANCE)) return;
    const beat = dur / BEATS;
    const slots = this.rng.shuffle([0, 1, 2, 3]).slice(0, this.rng.int(1, track.notes));
    slots.sort((a, b) => a - b);

    for (const slot of slots) {
      // Step to a neighbouring chord tone rather than leaping about.
      const i = CHORD_TONES.indexOf(this.lastDegree);
      const next = Math.max(0, Math.min(CHORD_TONES.length - 1, (i < 0 ? 1 : i) + this.rng.int(-1, 1)));
      this.lastDegree = CHORD_TONES[next];
      tone(this.ctx, this.voices, {
        type: track.lead,
        freq: hz(scaleNote(track, this.chord + this.lastDegree, track.leadOctave)),
        at: offset + slot * beat,
        dur: beat * 1.8,
        gain: 0.06 * g,
        attack: 0.25,
        release: beat,
      });
    }
  }
}
