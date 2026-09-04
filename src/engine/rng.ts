/**
 * Deterministic pseudo-random numbers.
 *
 * Everything random in Table Maze goes through an `Rng` so a (runSeed, depth)
 * pair always produces the exact same level.
 */
import type { Rng } from './types';

/**
 * mulberry32: a tiny, fast, decent-quality 32-bit PRNG.
 * The same `seed` always yields the same stream.
 */
export function makeRng(seed: number): Rng {
  let a = (seed >>> 0) || 0x9e3779b9;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int(min: number, max: number): number {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi <= lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick<T>(arr: readonly T[]): T {
      return arr[rng.int(0, arr.length - 1)];
    },
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
    chance(p: number): boolean {
      return next() < p;
    },
  };
  return rng;
}

/**
 * Mix any number of numbers into a 32-bit unsigned seed.
 * `hashSeed(runSeed, depth)` gives a stable per-level seed.
 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < parts.length; i++) {
    const v = Math.floor(parts[i]) | 0;
    h = (h ^ (v >>> 0)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    // fmix32 avalanche so nearby inputs give very different seeds
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    h = h >>> 0;
  }
  return h >>> 0;
}
