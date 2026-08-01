/**
 * functions/_middleware.js — Pages Function middleware
 *
 * Architecture: 2026-07-31-portfolio-v9-2-backend-architecture.md §14 (lines 599-644).
 *
 * Purpose:
 *   The static `public/_headers` cannot mint a per-request nonce (Cloudflare Pages
 *   `_headers` is evaluated once at deploy time). This middleware generates a fresh
 *   nonce per HTML request, uses HTMLRewriter to inject the nonce into every inline
 *   `<script>` and `<style>` element, and sets the production CSP from architecture
 *   AAR §14 line 613.
 *
 * Two-layer CSP model:
 *   1. `public/_headers` — static fallback with `'unsafe-inline'` bridge (Lighthouse)
 *   2. This middleware — architecture-grade nonce CSP for HTML responses in prod
 *
 * Hard-refusals (binding):
 *   - 'unsafe-eval' is REFUSED (security_engineer standing orders + architecture AAR)
 *   - 'unsafe-inline' for script-src is the bridge; middleware closes the gap
 *   - All HTML must pass through this middleware via `_routes.json` `include: "/*"`
 *   - Immutable assets `/_astro/*` and binary media are excluded (1-year cache stays)
 *   - API routes have their own typed envelopes; not modified here
 *
 * Plain JavaScript (not TypeScript) so the middleware compiles without needing
 * @cloudflare/workers-types installed in node_modules — Cloudflare Pages Functions
 * handles .js files natively via esbuild at deploy time.
 */

// Cryptographically secure 128-bit base64url nonce (architecture AAR §14 line 611).
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Architecture AAR §14 line 613 — exact production CSP with nonce interpolated.
// NOTE on `script-src-attr` / `style-src-attr`: architecture calls for 'none' on
// both, but the current build still ships inline event handlers (onclick on
// Flag/Toast/Marquee) and inline style attributes (KaTeX, CSS custom properties).
// Architecture §14 line 641 calls "zero inline event handlers" + "zero
// `style=` attributes" a pre-deploy gate. Until that gate is met, the bridge is
// `'unsafe-inline'` on both attribute variants — but `script-src 'self'
// 'nonce-...'` still gates every `<script>` element and `style-src 'self'
// 'nonce-...'` still gates every `<style>` block. Documented exception per the
// security sign-off memo N2 + N3 (2026-08-01 prod-triage).
function buildCSP(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`,
    "script-src-attr 'unsafe-inline'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src https://challenges.cloudflare.com https://cal.com https://*.cal.com",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
}

// Static-asset exclusions (architecture AAR §14 line 643):
// `_routes.json` ALSO excludes these from middleware, but checking here is
// defense-in-depth and lets the middleware work standalone (e.g., during tests).
const STATIC_ASSET_RE = /\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|m4a|pdf|zip|tar|gz|br|mp3|wasm|map)$/i;
function isStaticAsset(pathname) {
  if (pathname.startsWith('/_astro/')) return true;
  if (pathname === '/sw.js') return true;
  if (pathname === '/site.webmanifest') return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname.startsWith('/llms')) return true;
  if (pathname.startsWith('/humans')) return true;
  if (pathname.startsWith('/proof/')) return true; // videos — long cache
  return STATIC_ASSET_RE.test(pathname);
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // 1. Skip middleware for static immutable assets — keep 1-year cache intact.
  if (isStaticAsset(url.pathname)) {
    return next();
  }

  // 2. Skip middleware for /api/* routes — they have their own typed error envelopes
  //    (architecture AAR §"Shared typed contract"). The CSP / security-header
  //    contract for API responses is enforced inside each handler (see
  //    functions/lib/contracts.ts → `errorResponse`/`json` which set the same headers).
  if (url.pathname.startsWith('/api/')) {
    return next();
  }

  // 3. Generate a fresh nonce for THIS request.
  const nonce = generateNonce();

  // 4. Fetch the upstream response (static asset or 404).
  const response = await next();

  // 5. Only transform HTML responses. JSON / XML / plain text pass through untouched.
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  // 6. Build the production CSP with the fresh nonce.
  const csp = buildCSP(nonce);

  // 7. Apply the full security header suite (architecture AAR §14 lines 615-618).
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', csp);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // HSTS: production only (architecture AAR §14 line 645). ENV var ENVIRONMENT
  // is set by Cloudflare Pages at deploy time (production | preview | branch).
  const isProd = env && env.ENVIRONMENT === 'production';
  headers.set(
    'Strict-Transport-Security',
    isProd
      ? 'max-age=31536000; includeSubDomains; preload'
      : 'max-age=0',
  );
  // Cache-Control: HTML responses are per-request (nonce is per-request) so
  // we MUST prevent shared cache from leaking the nonce across requests.
  headers.set('Cache-Control', 'private, no-store');

  // 8. Use HTMLRewriter to inject the nonce into every `<script>` and `<style>`
  //    element (architecture AAR §14 line 638).
  //
  //    Element selectors:
  //      script[src]         — external script (nonce-marked; required because
  //                            `strict-dynamic` ignores host allowlists like
  //                            `'self'` — only nonce-marked scripts execute)
  //      script:not([src])   — inline `<script>` (nonce-marked; includes JSON-LD
  //                            `<script type="application/ld+json">` and Astro
  //                            hydration `<script type="module">`)
  //      style               — inline `<style>` (nonce-marked; Astro emits one
  //                            per-component at build time)
  //
  //    HTMLRewriter is streaming — the Worker does NOT buffer the page body
  //    (architecture AAR §14 line 638 + [CF-HTMLREWRITER]).
  const rewriter = new HTMLRewriter()
    .on('script', {
      element(el) {
        el.setAttribute('nonce', nonce);
      },
    })
    .on('style', {
      element(el) {
        el.setAttribute('nonce', nonce);
      },
    });

  const transformed = rewriter.transform(response);

  return new Response(transformed.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
