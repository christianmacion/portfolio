/**
 * prng.test.ts — deterministic PRNG contract.
 *
 * Standing Order §9 forbids Math.random/Date.now/argless Date in
 * deterministic outputs. The mulberry32 generator seeded via FNV-1a
 * is the single permitted path. These tests pin the contract.
 */
import { describe, it, expect } from 'vitest';
import { seedFromString, gauss, walk, formatPx, formatPct, buildSeed } from '@utils/prng';

describe('seedFromString', () => {
  it('returns a function that produces values in [0, 1)', () => {
    const rand = seedFromString('2026-07-11');
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces identical sequences for identical seeds (deterministic)', () => {
    const a = seedFromString('2026-07-11');
    const b = seedFromString('2026-07-11');
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = seedFromString('2026-07-11');
    const b = seedFromString('2026-07-12');
    // Take 100 samples; assert > 50% disagreement (extremely unlikely to collide).
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (a() !== b()) diff++;
    }
    expect(diff).toBeGreaterThan(50);
  });

  it('handles empty string without throwing', () => {
    const rand = seedFromString('');
    expect(() => rand()).not.toThrow();
    expect(rand()).toBeGreaterThan(0);
  });

  it('produces a stable distribution (mean ≈ 0.5 over many samples)', () => {
    const rand = seedFromString('distribution-test');
    const N = 5000;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += rand();
    const mean = sum / N;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
  });
});

describe('gauss', () => {
  it('returns a finite number (single-arg overload)', () => {
    const rand = seedFromString('g1');
    const z = gauss(rand);
    expect(Number.isFinite(z)).toBe(true);
  });

  it('returns a finite number (two-arg overload: mu, sigma)', () => {
    const rand = seedFromString('g2');
    const z = gauss(rand, 100, 5);
    expect(Number.isFinite(z)).toBe(true);
  });

  it('samples a distribution centered on mu', () => {
    const rand = seedFromString('g3');
    const N = 2000;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += gauss(rand, 50, 3);
    const mean = sum / N;
    // 3-sigma band on a 2000-sample mean is 3 / sqrt(2000) ≈ 0.067
    expect(Math.abs(mean - 50)).toBeLessThan(0.5);
  });

  it('does not blow up when u1 == 0 (guarded log)', () => {
    const stub = (() => {
      let n = 0;
      return () => (n++ === 0 ? 0 : 0.5);
    })();
    const z = gauss(stub);
    expect(Number.isFinite(z)).toBe(true);
  });
});

describe('walk', () => {
  it('returns an array of the requested length', () => {
    const rng = seedFromString('w1');
    const series = walk(rng, 100, 1, 25);
    expect(series).toHaveLength(25);
  });

  it('starts at `base`', () => {
    const rng = seedFromString('w2');
    const series = walk(rng, 1234.56, 2, 10);
    expect(series[0]).toBe(1234.56);
  });

  it('is deterministic for the same seed', () => {
    const a = seedFromString('w3');
    const b = seedFromString('w3');
    const walkA = walk(a, 100, 1, 30);
    const walkB = walk(b, 100, 1, 30);
    expect(walkA).toEqual(walkB);
  });

  it('produces a different sequence for different seeds', () => {
    const a = seedFromString('w4');
    const b = seedFromString('w5');
    const walkA = walk(a, 100, 1, 30);
    const walkB = walk(b, 100, 1, 30);
    expect(walkA).not.toEqual(walkB);
  });
});

describe('formatPx', () => {
  it('formats a positive price with $ and commas', () => {
    expect(formatPx(1234.56)).toBe('$1,234.56');
  });

  it('handles negative prices', () => {
    expect(formatPx(-987.65)).toBe('-$987.65');
  });

  it('handles zero', () => {
    expect(formatPx(0)).toBe('$0.00');
  });

  it('handles large numbers (thousands separator)', () => {
    expect(formatPx(1234567.89)).toBe('$1,234,567.89');
  });

  it('respects custom decimals (4dp for BTC)', () => {
    expect(formatPx(96480.1234, 4)).toBe('$96,480.1234');
  });

  it('respects decimals=0', () => {
    expect(formatPx(96480, 0)).toBe('$96,480');
  });

  it('returns em-dash for NaN', () => {
    expect(formatPx(Number.NaN)).toBe('—');
  });

  it('returns em-dash for Infinity', () => {
    expect(formatPx(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatPct', () => {
  it('formats positive with explicit + sign', () => {
    expect(formatPct(0.42)).toBe('+0.42%');
  });

  it('formats negative with native - sign (no double)', () => {
    expect(formatPct(-0.18)).toBe('-0.18%');
  });

  it('formats zero with a leading space (alignment-friendly)', () => {
    expect(formatPct(0)).toBe(' 0.00%');
  });

  it('returns em-dash for NaN', () => {
    expect(formatPct(Number.NaN)).toBe('—');
  });
});

describe('buildSeed', () => {
  it('returns the BUILD_DATE from process.env when present', () => {
    const prev = process.env.BUILD_DATE;
    process.env.BUILD_DATE = '2026-08-01T00:00:00Z';
    expect(buildSeed()).toBe('2026-08-01T00:00:00Z');
    if (prev === undefined) delete process.env.BUILD_DATE;
    else process.env.BUILD_DATE = prev;
  });

  it('falls back to a stable string when BUILD_DATE is unset', () => {
    const prev = process.env.BUILD_DATE;
    delete process.env.BUILD_DATE;
    // Fallback is hardcoded so dev previews are stable.
    expect(buildSeed()).toBe('2026-07-10T00:00:00Z');
    if (prev !== undefined) process.env.BUILD_DATE = prev;
  });
});