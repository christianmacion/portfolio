/**
 * url.ts : small URL helpers that respect the configured `base`
 * (defaults to `/portfolio` for GitHub Pages deployment).
 *
 * Use `path('/projects')` instead of writing `href="/projects"` so
 * internal links resolve correctly under any base path.
 *
 * v6.10.12 : `path()` now appends a trailing slash for internal page
 * links to match Astro's `trailingSlash: 'always'`. Skipped for
 * assets (have `.` in segment) and fragments (`#anchor`).
 *
 * v9.2 fix : `path()` now passes absolute URLs through unchanged.
 * Before this fix, `path('https://example.com/')` returned
 * `/portfolio/https://example.com/`, which silently broke 3 cert
 * issuer URLs on /certifications. Detected by the T2-1 audit.
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

// Detect absolute URLs (http/https/mailto/tel/protocol-relative) so
// `path()` returns them unchanged instead of prepending the base.
function isAbsoluteUrl(p: string): boolean {
  return /^(https?:|mailto:|tel:|ftp:|\/\/)/i.test(p);
}

export function path(p: string): string {
  if (isAbsoluteUrl(p)) return p;
  const suffix = p.startsWith('/') ? p : `/${p}`;
  return `${BASE}${ensureTrailingSlash(suffix)}`;
}
