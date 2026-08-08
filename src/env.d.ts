/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// No `App.Locals.cfContext` — we don't run the @astrojs/cloudflare adapter
// (v14 has a hard incompatibility with Pages: it auto-emits an `assets:
// { binding: 'ASSETS' }` block which Pages rejects as a reserved binding name).
// All dynamic endpoints live in functions/api/ as Pages Functions; static
// pages stay 0-RTT edge-cacheable. See astro.config.mjs for the architecture
// decision; see functions/lib/contracts.ts for the Env shape.
