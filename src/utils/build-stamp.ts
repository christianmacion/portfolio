/**
 * build-stamp.ts — deterministic build-time date helpers.
 *
 * Standing Order §9 forbids `Date.now()` / `new Date()` in deterministic
 * outputs. This module reads `process.env.BUILD_DATE` (set by `npm run
 * build` and `npm run build:mirror`) and returns a stable UTC+8 date
 * string. If the env var is missing (e.g., dev mode), it falls back to
 * the fixed `BUILD_DATE_FALLBACK` constant so dev previews still work
 * without producing a non-deterministic build.
 *
 * Usage:
 *   import { buildStampUtc8, buildYear } from '@utils/build-stamp';
 *   <span>last deployed {buildStampUtc8()}</span>
 *   <span>© {buildYear()}</span>
 *
 * Build-time env var:
 *   BUILD_DATE=2026-07-10T13:30:00Z
 *
 * (The +8h shift to UTC+8 / Asia-Manila is applied here so call sites
 * don't have to do it.)
 */

// Fallback used when BUILD_DATE is not set (dev preview). Set to the
// canonical build date so dev renderings are stable across reloads.
const BUILD_DATE_FALLBACK = '2026-07-10T00:00:00Z';

function readBuildDate(): Date {
  const raw = process.env.BUILD_DATE;
  if (!raw) {
    return new Date(BUILD_DATE_FALLBACK);
  }
  // Defensive: accept any ISO-8601-ish string Astro's env passes through.
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(BUILD_DATE_FALLBACK);
  }
  return parsed;
}

const TZ_OFFSET_HOURS = 8; // UTC+8. Asia/Manila

/**
 * Returns the build date as a YYYY-MM-DD string in UTC+8.
 * Deterministic per build (set by npm script via BUILD_DATE env var).
 */
export function buildStampUtc8(): string {
  const d = readBuildDate();
  const shifted = new Date(d.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Returns the build year as a 4-digit number (UTC+8).
 */
export function buildYear(): number {
  const d = readBuildDate();
  const shifted = new Date(d.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  return shifted.getUTCFullYear();
}

/**
 * Returns the full ISO 8601 timestamp of the build, shifted to UTC+8.
 * Used for Atom feed `<updated>` elements where a full timestamp is required
 * (not just YYYY-MM-DD). Stamped from BUILD_DATE; deterministic per build.
 */
export function buildStampUtc8Iso(): string {
  const d = readBuildDate();
  const shifted = new Date(d.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  return shifted.toISOString();
}

// v6.10.28 — `buildStampUtc8Iso` removed (knip reported unused).
// v6.10.45 — restored; the three feed routes (`feed.xml.ts`, `feed-projects.xml.ts`,
// `feed-solutions.xml.ts`) need a deterministic full ISO8601 string for `<updated>`.
// They previously called `new Date().toISOString()` directly — a §9 violation.
// v6.10.52 — `packageVersion()` was added to read package.json at build time
// and replace the stale `packageVersion = '6.5.0'` literal in index.astro.
// v9.3.6 — removed: no longer referenced by any consumer. The institution
// footer hard-codes the version string from CI/CD metadata.
