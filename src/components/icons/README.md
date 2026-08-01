# STELLA Icon Library (v9.2)

Custom SVG icon system for the portfolio. **38 single-concern icons**, vector-only,
stroke-only at 1.5px — designed for the institutional chrome contract.

## Why this exists

The portfolio's chrome (nav, footer, status indicators, CTAs) consumes thousands of
icons. Off-the-shelf icon sets (Lucide, Heroicons, Feather) drift over versions, ship
their own visual register (often with halos / colored fills), and decouple the icon
glyph from the project's palette. A small in-house system — 38 hand-curated icons,
token-bound, monochrome + accent — is faster to maintain and auditable line by line.

The `lucide` dependency in `package.json` is kept as a fallback for the odd icon we
haven't shipped yet, but every chrome surface should consume `<Icon />` from this
directory.

## Files

```
src/components/icons/
├── Icon.astro                # the wrapper component (consume this)
├── icon-defs/                # one file per icon (38 files)
├── types.ts                  # IconName union + ICON_NAMES list
├── index.ts                  # the typed PATHS registry
└── README.md                 # this file
```

## The contract (5 invariants)

| #   | Invariant                                           | Where enforced       | How to verify                              |
| --- | --------------------------------------------------- | -------------------- | ------------------------------------------ |
| 1   | `viewBox="0 0 24 24"`                               | `Icon.astro` wrapper | `grep -n viewBox Icon.astro`               |
| 2   | `stroke-width="1.5"` (default)                      | `Icon.astro` wrapper | `grep -n stroke-width Icon.astro`          |
| 3   | `stroke-linecap="round"`, `stroke-linejoin="round"` | `Icon.astro` wrapper | `grep -n stroke-line Icon.astro`           |
| 4   | `fill="none"` (line icons only)                     | `Icon.astro` wrapper | `grep -n fill Icon.astro`                  |
| 5   | `currentColor` for stroke (mono + 1 accent)         | `Icon.astro` wrapper | `grep -n stroke="currentColor" Icon.astro` |

The chrome contract forbids:

- `box-shadow: 0 0 Npx` (halo) — no exceptions
- `filter: drop-shadow(...)` / `filter: blur(...)` / `filter: glow` — no exceptions
- `<linearGradient>` / `<radialGradient>` / `fill="url(#…)"` — no exceptions
- `border-radius: > 8px` on icon containers — no exceptions
- Filled glyphs except where structurally required (e.g. dot inside `info-circle`)

## Adding a new icon

1. Create `src/components/icons/icon-defs/<name>.ts`. Export `SVG_PATH` as the path data.
2. Add the name to `IconName` union in `types.ts`. TypeScript will error in `index.ts`
   if you skip step 3.
3. Add the import to `index.ts` and add the entry to `PATHS`. TypeScript exhaustiveness
   is the gate — there's no runtime `window.NAP.parts[key]` lookup table to keep in sync.
4. Run `npx astro check` — both `getIconPath()` lookup AND any consumer will fail
   at compile-time if the registry drifts.

```ts
// icon-defs/example.ts
/**
 * example — one-line description of the single concern.
 */
export const SVG_PATH = 'M5 12h14M13 5l7 7-7 7';
```

## Usage

```astro
---
import Icon from '@components/icons/Icon.astro';
---

<!-- Decorative (chrome, no label needed) -->
<Icon name="arrow-right" size={16} />

<!-- Informative (status indicator, opened in new tab, etc.) -->
<Icon name="github" size={20} label="GitHub profile (opens in new tab)" />

<!-- With a wrapper class for layout hooks -->
<Icon name="trending-up" size={16} class="cta__icon" />
```

The `label` prop drives the a11y mapping per WCAG 2.2 AA SC 1.1.1:

- **Label present** → `role="img"` + `aria-label={label}`
- **Label absent** → `aria-hidden="true"` + `focusable="false"` (decorative)

## Verification

The AAR at `~/.claude/cache/corporate/aars/2026-07-31-portfolio-v9-2-phase3-icons.md`
ships the chrome-contract audit, TypeScript exhaustiveness check, and a11y mapping
matrix.

## Doctrine

Per [[webcraft-no-vibe]] (chrome contract), [[wcag-2.2-aa-sc-1.1.1]] (a11y),
[[goldratt-5focusingsteps]] (icons are the one constraint — Phase 4 chrome work
unblocks once this ships). Public-surface register per [[greene-law-38]] — speak
as others speak; institutional chrome is the vocabulary.
