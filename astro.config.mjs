// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Site deploy target. Default is the GH Pages canonical site
// (https://christianmacion26.github.io/portfolio). For the Cloudflare Pages mirror,
// pass PUBLIC_SITE_URL=https://christianmacion-portfolio.pages.dev at build time.
// Used by feed.xml / sitemap to set the canonical host in generated XML.
const SITE = process.env.PUBLIC_SITE_URL ?? 'https://christianmacion26.github.io';
// BASE_PATH: explicit env var > Cloudflare Pages auto-detect (CF_PAGES=1) > /portfolio.
// CF_PAGES=1 is set by Cloudflare Pages during `wrangler pages deploy` and during
// the Pages CI build, so the mirror deploy uses `/` automatically — `npm run build`
// (no env var) keeps the /portfolio default for GH Pages. The Phase 5a pre-deploy
// regression (2026-08-01) showed that relying on `BASE_PATH=/` in the `build:mirror`
// npm script alone is fragile: a `npm run build` + `wrangler pages deploy` cycle
// silently produced a broken site with all assets at /portfolio/_astro/ 404ing.
const BASE_PATH = process.env.BASE_PATH ?? (process.env.CF_PAGES ? '/' : '/portfolio');

// 2026-08-08 — Astro hybrid mode (SSR opt-in for personalization pages).
// `output: 'static'` is the Astro 5+/7 equivalent of the legacy `output: 'hybrid'`:
// pages are prerendered by default; individual routes opt into SSR via
// `export const prerender = false` (used by /index.astro, /for-recruiters.astro,
// and /api/who-am-i + /api/track-visit). Static routes keep the build-time
// prerender path so 95% of routes stay 0-RTT edge-cacheable.
// Adapter v14 sets `Astro.locals.cfContext` (replaces `Astro.locals.runtime.ctx`)
// and binds via `import { env } from 'cloudflare:workers'`. Local dev reads
// bindings from `wrangler.toml` natively via the workerd dev server.

export default defineConfig({
  site: SITE,
  // Same env var controls the base path: mirror wants `/`, GH Pages wants `/portfolio`.
  // Build scripts must set BASE_PATH=/ for the mirror deploy — the CLI
  // --base flag does NOT override a config-file value in current Astro.
  base: BASE_PATH,
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // v9.3.2 (architecture audit 2026-08-02) — Phase 2 fix. The 'always' setting
    // packed every page's CSS into the HTML payload (95–140KB per page) which
    // defeated HTTP/2 multiplexing and ballooned the first-byte payload beyond
    // Cloudflare's edge-cache sweet spot. Switching to 'auto' lets Astro decide:
    // small CSS stays inline (preserves first-paint on the few pages where it
    // matters), large CSS externalizes to /_astro/*.css (multi-request
    // parallelism, cacheable across pages). Target: home HTML drops from ~100KB
    // to <60KB; per-route CSS chunk is cached and reused across visits.
    // The Phase 5a Gate-12 rationale (eliminates one CSS round-trip) still holds
    // for the small per-page CSS that Astro decides to inline under 'auto'.
    inlineStylesheets: 'auto',
  },
  integrations: [
    mdx(),
    sitemap({
      // Include public static workbook readers that are copied from public/
      // rather than emitted as Astro routes.
      customPages: [
        `${SITE}${BASE_PATH === '/' ? '' : BASE_PATH}/workbooks/ai-engineering/`,
        `${SITE}${BASE_PATH === '/' ? '' : BASE_PATH}/workbooks/graph-engineering/`,
      ],
    }),
  ],
  // No @astrojs/cloudflare adapter — see comment block above. The static build
  // emits `dist/` directly; Cloudflare Pages Functions (in `functions/`) handle
  // every dynamic endpoint. The CF Pages deploy runs `astro build` and uploads
  // `dist/` as the static surface; `functions/` is auto-detected by Pages.
  vite: {
    ssr: { noExternal: ['@fontsource/inter', '@fontsource/jetbrains-mono'] },
  },
  prefetch: { prefetchAll: true },
});
