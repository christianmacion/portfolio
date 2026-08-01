/**
 * build-stamp.test.ts — deterministic build date helpers.
 *
 * Critical contract: never call Date.now() / argless new Date() in
 * deterministic outputs (Standing Order §9). The build date must come
 * from BUILD_DATE env var, falling back to a fixed constant.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildStampUtc8, buildYear, packageVersion } from '@utils/build-stamp';

describe('buildStampUtc8', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.BUILD_DATE;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.BUILD_DATE;
    else process.env.BUILD_DATE = prev;
  });

  it('returns a YYYY-MM-DD string in UTC+8', () => {
    process.env.BUILD_DATE = '2026-07-10T00:00:00Z';
    expect(buildStampUtc8()).toBe('2026-07-10');
  });

  it('shifts to UTC+8 (a UTC evening becomes the next morning local)', () => {
    // 2026-07-10T18:00:00Z = 2026-07-11T02:00:00 UTC+8
    process.env.BUILD_DATE = '2026-07-10T18:00:00Z';
    expect(buildStampUtc8()).toBe('2026-07-11');
  });

  it('falls back to the canonical date when BUILD_DATE is unset', () => {
    delete process.env.BUILD_DATE;
    expect(buildStampUtc8()).toBe('2026-07-10');
  });

  it('falls back when BUILD_DATE is malformed', () => {
    process.env.BUILD_DATE = 'not-a-date';
    expect(buildStampUtc8()).toBe('2026-07-10');
  });
});

describe('buildYear', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.BUILD_DATE;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.BUILD_DATE;
    else process.env.BUILD_DATE = prev;
  });

  it('returns the year as a 4-digit number', () => {
    process.env.BUILD_DATE = '2026-07-10T00:00:00Z';
    const y = buildYear();
    expect(typeof y).toBe('number');
    expect(y).toBe(2026);
  });

  it('crosses year boundary when UTC evening rolls into UTC+8 next year', () => {
    // 2026-12-31T18:00:00Z = 2027-01-01T02:00:00 UTC+8
    process.env.BUILD_DATE = '2026-12-31T18:00:00Z';
    expect(buildYear()).toBe(2027);
  });
});

describe('packageVersion', () => {
  it('returns a non-empty version string', () => {
    const v = packageVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  it('returns the actual package.json version (matches package.json)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };
    expect(packageVersion()).toBe(pkg.version);
  });
});