/**
 * url.ts — small URL helpers that respect the configured `base`
 * (defaults to `/portfolio` for GitHub Pages deployment).
 *
 * Use `path('/projects')` instead of writing `href="/projects"` so
 * internal links resolve correctly under any base path.
 *
 * v6.10.12 — `path()` now appends a trailing slash for internal page
 * links to match Astro's `trailingSlash: 'always'`. Skipped for
 * assets (have `.` in segment) and fragments (`#anchor`).
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

// Add trailing slash for internal page routes. Skip assets (`.xml`,
// `.txt`, `.png`, etc.) and hashes. URLs already ending with `/`
// pass through.
function ensureTrailingSlash(p: string): string {
  if (p.endsWith('/')) return p;
  if (p.includes('#')) return p;
  // Detect asset: last path segment has a dot
  const lastSegment = p.split('/').pop() ?? '';
  if (lastSegment.includes('.')) return p;
  return `${p}/`;
}

export function path(p: string): string {
  const suffix = p.startsWith('/') ? p : `/${p}`;
  return `${BASE}${ensureTrailingSlash(suffix)}`;
}

/**
 * For href values that may be either an internal path or an
 * absolute http(s) URL (e.g. external certification links stored in
 * markdown content collections). Leaves `https://…` / `http://…`
 * untouched; routes everything else through `path()` so the
 * configured base prefix still applies for internal links.
 */
export function hrefOrPath(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return path(href);
}
