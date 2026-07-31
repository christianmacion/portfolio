// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Site deploy target. Default is the GH Pages canonical site
// (https://christianmacion26.github.io/portfolio). For the Cloudflare Pages mirror,
// pass PUBLIC_SITE_URL=https://christianmacion-portfolio.pages.dev at build time.
// Used by feed.xml / sitemap to set the canonical host in generated XML.
const SITE = process.env.PUBLIC_SITE_URL ?? 'https://christianmacion26.github.io';
const BASE_PATH = process.env.BASE_PATH ?? '/portfolio';

export default defineConfig({
  site: SITE,
  // Same env var controls the base path: mirror wants `/`, GH Pages wants `/portfolio`.
  // Build scripts must set BASE_PATH=/ for the mirror deploy — the CLI
  // --base flag does NOT override a config-file value in current Astro.
  base: BASE_PATH,
  trailingSlash: 'always',
  build: {
    format: 'directory',
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