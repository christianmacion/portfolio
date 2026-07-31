/**
 * types.ts — IconName contract for the STELLA custom SVG icon library.
 *
 * Single source of truth for which icons ship. The IconName union below is
 * the allowlist — every other file imports from here. A typo at any consumer
 * site (e.g. `arrow-riight`) is caught at TypeScript compile time, not at
 * runtime.
 *
 * v9.2 — institutional chrome contract. Designed for the matcha + amber
 * palette via `currentColor`. All icons are stroke-only at 1.5px stroke-width
 * with round linecap + linejoin — matches the Heroicons outline register
 * and rejects the SF Symbols "tinted weight" feel.
 *
 * Per [[webcraft-no-vibe]]: no halo, no glow, no gradient, no filter.
 * Per [[wcag-2.2-aa-sc-1.1.1]]: every icon is either labelled (role="img"
 * + aria-label) or decorative (aria-hidden="true"). Both states ship in
 * the Icon.astro wrapper contract below.
 */

/**
 * The canonical icon allowlist — 38 single-concern icons.
 *
 * Categories:
 *   - Navigation + chrome (9): arrow-right, arrow-left, arrow-up, arrow-down,
 *     chevron-right, chevron-down, menu, close, external-link
 *   - Status indicators (6): check, circle-check, clock, alert-triangle,
 *     info-circle, x-circle
 *   - Content (5): book, code, document, folder, link
 *   - Communication (5): mail, message, send, github, linkedin
 *   - Work / case-study (6): briefcase, chart-bar, chart-line, lightbulb,
 *     target, trending-up
 *   - Meta (7): sun, moon, globe, filter, search, play, pause
 */
export type IconName =
  // Navigation + chrome
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'chevron-right'
  | 'chevron-down'
  | 'menu'
  | 'close'
  | 'external-link'
  // Status indicators
  | 'check'
  | 'circle-check'
  | 'clock'
  | 'alert-triangle'
  | 'info-circle'
  | 'x-circle'
  // Content
  | 'book'
  | 'code'
  | 'document'
  | 'folder'
  | 'link'
  // Communication
  | 'mail'
  | 'message'
  | 'send'
  | 'github'
  | 'linkedin'
  // Work / case-study
  | 'briefcase'
  | 'chart-bar'
  | 'chart-line'
  | 'lightbulb'
  | 'target'
  | 'trending-up'
  // Meta
  | 'sun'
  | 'moon'
  | 'globe'
  | 'filter'
  | 'search'
  | 'play'
  | 'pause';

/**
 * The exhaustive list — used for build-time coverage checks and for
 * Storybook's `<IconGallery />`. Keep in lockstep with the union above.
 */
export const ICON_NAMES: readonly IconName[] = [
  'arrow-right',
  'arrow-left',
  'arrow-up',
  'arrow-down',
  'chevron-right',
  'chevron-down',
  'menu',
  'close',
  'external-link',
  'check',
  'circle-check',
  'clock',
  'alert-triangle',
  'info-circle',
  'x-circle',
  'book',
  'code',
  'document',
  'folder',
  'link',
  'mail',
  'message',
  'send',
  'github',
  'linkedin',
  'briefcase',
  'chart-bar',
  'chart-line',
  'lightbulb',
  'target',
  'trending-up',
  'sun',
  'moon',
  'globe',
  'filter',
  'search',
  'play',
  'pause',
] as const;

/** Default sizes for the two consumption tiers. */
export const ICON_SIZE_CHROME = 16; // chrome (nav, footer, inline status)
export const ICON_SIZE_CONTENT = 24; // content (case-study openers, hero art)
