/**
 * gdelt-client.ts — Browser-direct GDELT 2.0 fetcher with CORS fallback.
 *
 * GDELT 2.0 publishes geo-tagged news events at 15-minute cadence:
 *   1. data.gdeltproject.org/gdeltv2/lastupdate.txt   (3-line manifest)
 *   2. The second line is a URL to a 15-minute event export (CSV, no header)
 *
 * GDELT may CORS-block direct browser fetch. This module:
 *   1. Tries the same-origin Cloudflare Worker proxy at /api/worldview/gdelt
 *   2. On failure (worker down, CORS, network), loads the static fallback
 *      from src/data/worldview-static.json (already baked at build time)
 *
 * Normalized event shape (matches the existing gdelt-cache.json schema so
 * the EarthMap.astro layer and the WorldView globe can share rendering):
 *
 *   {
 *     id: string,           // GKGRECORDID or hash of url+timestamp
 *     title: string,        // human headline
 *     category: string,     // central-bank | fx | earnings | geopolitical | data-release
 *     severity: string,     // mild | moderate | critical
 *     lat: number,
 *     lon: number,
 *     city: string,
 *     source: string,       // "GDELT 2.0"
 *     timestamp: string,    // ISO8601
 *     goldstein?: number    // -10..+10 cooperation/conflict scale
 *   }
 *
 * Bundle budget: ~3KB minified. No deps.
 */

import fallback from '../data/worldview-static.json';

export interface GdeltEvent {
  id: string;
  title: string;
  category: string;
  severity: string;
  lat: number;
  lon: number;
  city: string;
  source: string;
  timestamp: string;
  goldstein?: number;
}

/** Resolve a JSON value to GdeltEvent[] (handles the static-fallback shape). */
function asEvents(raw: unknown): GdeltEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as { events?: unknown };
  const arr = root.events;
  if (!Array.isArray(arr)) return [];
  return arr.filter((e: unknown): e is GdeltEvent => {
    if (!e || typeof e !== 'object') return false;
    const o = e as Record<string, unknown>;
    return (
      typeof o.id === 'string' &&
      typeof o.lat === 'number' &&
      typeof o.lon === 'number' &&
      typeof o.title === 'string'
    );
  });
}

/**
 * Parse GDELT 2.0 lastupdate.txt manifest.
 *
 *   1025
 *   http://data.gdeltproject.org/gdeltv2/20251008124500.export.CSV.zip
 *   http://data.gdeltproject.org/gdeltv2/20251008124500.gkg.csv.zip
 *
 * Returns the .export.CSV.zip URL (the events file). When parsing fails,
 * returns null and the caller falls back to /api/worldview/gdelt or static.
 */
function parseManifest(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const exportUrl = lines[1];
  if (!/\.export\.CSV\.zip$/i.test(exportUrl)) return null;
  return exportUrl;
}

/** Fetch the lastupdate.txt manifest from GDELT (browser-direct). */
async function fetchManifest(): Promise<string | null> {
  try {
    const res = await fetch('https://data.gdeltproject.org/gdeltv2/lastupdate.txt', {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const text = await res.text();
    return parseManifest(text);
  } catch {
    return null;
  }
}

/** Fetch the proxied GDELT JSON from the Cloudflare Worker. */
async function fetchFromWorker(): Promise<GdeltEvent[] | null> {
  try {
    const res = await fetch('/api/worldview/gdelt', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return asEvents(data);
  } catch {
    return null;
  }
}

/**
 * Fetch the manifest URL via the same Worker (so we never hit the GDELT
 * CORS block directly from the browser). The Worker unzips the CSV and
 * returns JSON. Returns null on any failure path.
 */
async function fetchViaWorkerProxy(manifestUrl: string): Promise<GdeltEvent[]> {
  try {
    const u = new URL('/api/worldview/gdelt', window.location.origin);
    u.searchParams.set('url', manifestUrl);
    const res = await fetch(u.toString(), { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return asEvents(data);
  } catch {
    return [];
  }
}

/**
 * loadGdelt() — primary entry point. Returns up to 6 GDELT events, newest first.
 *
 * Resolution order:
 *   1. Cloudflare Worker at /api/worldview/gdelt (handles CORS + unzipping)
 *   2. Static fallback baked at build time (src/data/worldview-static.json)
 *
 * Never throws. Resolves to GdeltEvent[] (possibly empty).
 */
export async function loadGdelt(): Promise<GdeltEvent[]> {
  const via = await fetchFromWorker();
  if (via && via.length > 0) return via.slice(0, 6);

  // Try the worker proxy with a manifest URL (second-chance CORS bypass).
  const manifest = await fetchManifest();
  if (manifest) {
    const proxied = await fetchViaWorkerProxy(manifest);
    if (proxied.length > 0) return proxied.slice(0, 6);
  }

  // Static fallback (always available).
  return asEvents(fallback).slice(0, 6);
}