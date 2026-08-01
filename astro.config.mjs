// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Site deploy target. Default is the live Cloudflare Pages canonical
// (https://christianmacion-portfolio.pages.dev). For GH Pages builds, set
// PUBLIC_SITE_URL=https://christianmacion26.github.io at build time.
// Used by feed.xml / sitemap to set the canonical host in generated XML.
const SITE = process.env.PUBLIC_SITE_URL ?? 'https://christianmacion-portfolio.pages.dev';
// BASE_PATH: explicit env var > Cloudflare Pages auto-detect (CF_PAGES=1) > /portfolio.
// CF_PAGES=1 is set by Cloudflare Pages during `wrangler pages deploy` and during
// the Pages CI build, so the mirror deploy uses `/` automatically — `npm run build`
// (no env var) keeps the /portfolio default for GH Pages. The Phase 5a pre-deploy
// regression (2026-08-01) showed that relying on `BASE_PATH=/` in the `build:mirror`
// npm script alone is fragile: a `npm run build` + `wrangler pages deploy` cycle
// silently produced a broken site with all assets at /portfolio/_astro/ 404ing.
const BASE_PATH = process.env.BASE_PATH ?? (process.env.CF_PAGES ? '/' : '/portfolio');

export default defineConfig({
  site: SITE,
  // Same env var controls the base path: mirror wants `/`, GH Pages wants `/portfolio`.
  // Build scripts must set BASE_PATH=/ for the mirror deploy — the CLI
  // --base flag does NOT override a config-file value in current Astro.
  base: BASE_PATH,
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // v9.2.2 (Gate 12) — Phase 5a fix. BaseLayout CSS is 61KB (render-blocking
    // on every page) and the home page ships only one extra 7KB chunk. Inlining
    // the BaseLayout CSS into the HTML eliminates one round-trip per page load
    // (~1,480ms render-blocking savings per Lighthouse on mobile). The HTML grows
    // from ~35KB → ~95KB but the network round-trip is eliminated, which is the
    // correct tradeoff for LCP on a portfolio site where every page loads the
    // same chrome. Astro inlines per-route CSS automatically when this is set.
    inlineStylesheets: 'always',
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
  vite: {
    ssr: { noExternal: ['@fontsource/inter', '@fontsource/jetbrains-mono'] },
  },
  prefetch: { prefetchAll: true },
});
