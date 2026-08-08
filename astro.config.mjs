// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// 2026-08-09 — GitHub account renamed from christianmacion26 to christianmacion.
// Live URL = https://christianmacion.github.io/portfolio/.
// CF Pages mirror at christianmacion-portfolio.pages.dev has been DELETED
// (per Owner directive: "we just need the live site. and in GH").
// The CF_PAGES detection branch is no longer reachable — kept as a safety
// valve for local dev, but never set in any CI/CD path.
const SITE = 'https://christianmacion.github.io';
// 2026-08-09 : BASE_PATH is env-driven so the same repo can build for:
//   - GH Pages production (BASE_PATH=/portfolio, default)
//   - Local dev + Lighthouse CI (BASE_PATH=/, no prefix)
// The default stays /portfolio so production deploy is unchanged.
const BASE_PATH = process.env.BASE_PATH || '/portfolio';

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
        `${SITE}${BASE_PATH}/workbooks/ai-engineering/`,
        `${SITE}${BASE_PATH}/workbooks/graph-engineering/`,
      ],
    }),
  ],
  // No @astrojs/cloudflare adapter — static site only, deployed to GitHub Pages.
  // Functions in `functions/` are now local-dev-only artifacts (CF Pages deleted).
  vite: {
    ssr: { noExternal: ['@fontsource/inter', '@fontsource/jetbrains-mono'] },
  },
  prefetch: { prefetchAll: true },
});
