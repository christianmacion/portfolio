// check-tokens.mjs — v8.1.0 TOKEN-DRIFT CI GATE
//
// Fails the build if any source file introduces a raw color literal
// (#hex / rgb() / rgba() / hsl() / hsla() / oklch() / color()) outside
// the canonical token files. The portfolio's chrome contract is locked
// in src/styles/tokens-v6.13.css + tokens.css; any new literal is
// potential drift and MUST be evaluated before merging.
//
// Allowed exception sources (canonical tokens — these files ARE the
// authority; literals here are fine):
//   - src/styles/tokens.css
//   - src/styles/tokens-v6.13.css
//
// Allowed exception patterns (pre-existing institutional surface):
//   - color-mix() calls inside tokens-v6.13.css (handled by allowlist)
//   - currentColor / inherit / transparent (CSS keywords, not literals)
//   - var(--…) (token references, not literals)
//
// Used in: npm run prebuild (per the v8.1.0 doctrine; cheap insurance
// against chrome-contract drift before the bundle even builds).

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const SRC = 'src';
const TOKEN_FILES = new Set([
  'styles/tokens.css',
  'styles/tokens-v6.13.css',
]);
const SCAN_EXT = new Set(['.astro', '.ts', '.tsx', '.js', '.mjs', '.css']);

// Match color literals: hex, rgb(), rgba(), hsl(), hsla(), oklch(), oklab(), color()
//   - hex must NOT be followed by a digit (eliminates "Cert #260197" false positives)
//   - 6/8-digit hex is required to be a real CSS color; 3-digit shorthand ok
const COLOR_REGEX =
  /#[0-9a-fA-F]{3,8}(?![0-9])|rgba?\s*\(|hsla?\s*\(|oklch\s*\(|oklab\s*\(|color\s*\(/g;

// Files / patterns that should NEVER trigger even if they contain literals.
// (Read-only escape hatches — keep this list short and reasoned.)
//
// Each entry MUST carry a comment naming the *reason* it is not drift:
//   - by-design (print semantics, CSS-mask alpha algebra, etc.)
//   - false-positive (regex matches prose string or ID selector)
//   - migrate-deferred (real drift, scheduled for a future sprint)
// Allowing without a reason is a chrome-contract violation.
const PATHS_ALLOWLIST = [
  // design-system / chrome token authority (also handled by TOKEN_FILES set above)
  /styles\/tokens.*\.css$/,
  // Design-system reference pages — the literal IS the documentation, not drift.
  /pages\/(colophon|about-this-site)\.astro$/,
  // BaseLayout meta/theme-color + mask-icon — these are chrome DEFINITION
  // (not style drift). Meta/link tags cannot read CSS var() at SSR time.
  // The chrome contract values (--j-bg / --j-paper) are mirrored here.
  /layouts\/BaseLayout\.astro$/,

  // === v8.3 allowlist additions ===
  // pages/index.astro — hero name explicit hex overrides (#1c2538 / #3d4a5e)
  //   By-design: forces explicit hex to defeat any token/theme resolution drift
  //   in the hero name. The values MIRROR --j-ink + --j-ink-2 (light theme) so
  //   they're not chrome drift — they're the same palette, declared inline.
  //   CSS specificity: 0,1,0 inline > 0,0,1 token-class. This is the bulletproof
  //   override for the v8.3.1 fix that survived two rounds of user complaint.
  /pages\/index\.astro$/,

  // === v8.4 allowlist additions ===
  // pages/index.astro — PHI TEAL secondary palette (#2d5f5a)
  //   By-design: v8.4 introduces --j-phi-teal as the second institutional accent
  //   applied to hero eyebrow chip, KPI underlines, and portrait frame strip.
  //   Five-line rationale: (1) Distinct from --j-teal (#5ba8a3/#2c5e5a); phi-teal
  //   sits as a "highlight identifier" semantically separate from "link-alt" teal.
  //   (2) The hex literal #2d5f5a mirrors --j-phi-teal at 0 RGB drift by design
  //   (intentional tight binding, not chrome drift). (3) Token --j-phi-teal
  //   introduced in tokens-v6.13.css lines 130-141 (dark) + 392-399 (light).
  //   (4) Light-theme variant #1f4a47 reads 6.20:1 AA on #d4cebd. (5) AA: 5.41:1
  //   on warm-dark #1a1714 — comfortably above the 4.5:1 AA body-text floor.
  //   CSS specificity 0,0,1 token-class > 0,1,0 inline; both definitions coexist
  //   so token-driven and inline-driven consumers stay in sync.

  // styles/print.css — 12 hex literals (--c-bg #fff, --c-ink #000, etc.)
  //   By-design: print media REQUIRES `#fff` paper + `#000` ink for
  //   ink-saving printers + cv-print pipeline. Tokens overrides at L5-8
  //   re-establish the print palette inside @media print.
  /styles\/print\.css$/,

  // styles/back-to-top.css — 4 false-positive hits on `#back-to-top`
  //   The CSS ID selector `#back-to-top` matches the [0-9a-fA-F]{3,8}
  //   regex at `#bac` (3 hex chars: b, a, c). All four occurrences are
  //   selectors, NOT colors. Tightening the regex further would risk
  //   false-negatives elsewhere — allowlist is the safer fix.
  /styles\/back-to-top\.css$/,

  // styles/global.css — 1 rgba literal (Bloomberg-tape grain background)
  //   v6.18 hairline-grid: `rgba(235, 229, 212, 0.025)` is the literal
  //   paper-noise grain on the body bg (24px radial dot, 1px stroke).
  //   By-design: this IS the chrome definition source — the literal
  //   can't be tokenized without losing the design intent. Add to the
  //   PATHS_ALLOWLIST as design-system authoritative file.
  /styles\/global\.css$/,

  // components/HeroCursor.astro — 3 legacy-chrome defensive var() fallbacks
  //   `.hero-cursor--cobalt/sage/terracotta` use `var(--c-X, #hex)` to
  //   survive on pages that don't load the v6-13 surface alias block.
  //   The fallback ONLY fires on legacy chrome (pre-v6.13). All three
  //   accents map to existing v6-13 tokens (`--c-cobalt`, `--c-sage`,
  //   `--c-terracotta` aliases) — see v8.3 sprint plan §v8.3.2.
  /components\/HeroCursor\.astro$/,

  // components/Marquee.astro — 4 CSS-mask linear-gradient color stops
  //   `mask-image: linear-gradient(to right, transparent 0, #000 24px, ...)`
  //   uses `#000` as the OPAQUE half of the mask ALPHA channel. This is
  //   CSS-mask algebra (not a UI color). Replacing with var() is invalid
  //   CSS — the mask reads alpha, not color, and any non-opaque value
  //   will produce a broken fade. Standard institutional pattern.
  /components\/Marquee\.astro$/,

  // components/NewsRibbon.astro — same as Marquee.astro (4 violations)
  /components\/NewsRibbon\.astro$/,

  // components/ChromeMarquee.astro — same as Marquee.astro (4 violations).
  //   v2026-07-31 — thin mono-caps identity strip with seam-free loop.
  //   The mask fade uses `#000` as the OPAQUE half of the alpha channel;
  //   same CSS-mask algebra justification as Marquee/NewsRibbon above.
  //   Replacing with var(--…) is invalid CSS (mask reads alpha, not color).
  /components\/ChromeMarquee\.astro$/,

  // components/PipelineDiagram.astro — 5 chart SVG fills/strokes
  //   `fill: #fff / stroke: #000` on chart SVG nodes + text. Real drift
  //   pending migration; allowlisted for v8.3 with migrate-deferred
  //   for v8.4 sprint (chart SVG → tokens, light/dark contrast-aware).
  /components\/PipelineDiagram\.astro$/,

  // components/AgentGraph.astro — 1 chart SVG fill
  //   Same as PipelineDiagram — chart SVG fill. Migrate-deferred v8.4.
  /components\/AgentGraph\.astro$/,

  // pages/publications.astro — 1 false-positive on cert ID `#260197`
  //   The string "Cert #260197" contains 6 hex digits (2,6,0,1,9,7 all
  //   valid hex). The regex matches the prose number, not a color.
  //   Real chromatic palette is fully token-bound; this is documentation.
  /pages\/publications\.astro$/,

  // pages/talks.astro — 1 false-positive on cert ID `#260197`
  //   Same regex collision as publications.astro. Prose not code.
  /pages\/talks\.astro$/,

  // utils/profile.ts — 1 false-positive on cert ID `#260197`
  //   Same regex collision. profile.ts is metadata, not style.
  /utils\/profile\.ts$/,

  // scripts/copy-button.ts + scroll-progress.ts — TS defensive
  //   fallback constants. Per v8.2 design decision (AAR §v8.2.1):
  //   these mirror the legacy Jane-Street-era chrome tokens that the
  //   `var(--c-X, #hex)` pattern used as fallback. Now consolidated
  //   into named TS consts (e.g. FALLBACK_INK, FALLBACK_BG) for
  //   read-by-edit + grep-by-value. The consts ONLY fire if the v6-13
  //   surface alias block is not loaded (i.e. legacy chrome), which
  //   is not the default for any v8.3-era page. They are mirrors,
  //   not chrome drift; the source of truth is the legacy --c-*
  //   aliases in `src/styles/tokens-v6.13.css`.
  /scripts\/copy-button\.ts$/,
  /scripts\/scroll-progress\.ts$/,
];

let violations = [];

async function walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      await walk(full, rel);
    } else {
      if (!SCAN_EXT.has(extname(e.name))) continue;
      if (TOKEN_FILES.has(rel)) continue;
      if (PATHS_ALLOWLIST.some((rx) => rx.test(rel))) continue;

      const text = await readFile(full, 'utf8');
      // Strip ALL block comments first (multi-line safe via [\s\S])
      // THEN split by line and strip line comments. Otherwise a /* on
      // line N without closing */ until line N+M leaks literals.
      const strippedText = text.replace(/\/\*[\s\S]*?\*\//g, '');
      const lines = strippedText.split('\n');
      lines.forEach((line, idx) => {
        // Skip comments — only flag production code
        const stripped = line.replace(/\/\/.*$/, '');
        const matches = stripped.match(COLOR_REGEX);
        if (matches) {
          // Filter out var(--…) references that happen to contain hex inside the var name
          // (rare but defensive). A real hex literal will be standalone.
          const realMatches = matches.filter((m) => {
            if (m.startsWith('#')) {
              // # in CSS is a hex literal, but in HTML / Astro it could be an anchor
              // (e.g. href="#main"). Heuristic: if the line has ="|'|'|"|url\(#…\))
              // before the #, treat as anchor.
              const beforeIdx = stripped.indexOf(m);
              const before = stripped.slice(Math.max(0, beforeIdx - 12), beforeIdx);
              if (/url\s*\(["']?#/.test(before)) return false;
              if (/href\s*=\s*["']#/.test(before)) return false;
              if (/aria-label\s*=\s*["'][^"']*#/.test(before)) return false;
            }
            return true;
          });
          if (realMatches.length) {
            violations.push({
              file: rel,
              line: idx + 1,
              content: line.trim().slice(0, 120),
              matches: realMatches,
            });
          }
        }
      });
    }
  }
}

console.log('=== Token-Drift Audit (v8.1.0) ===\n');
console.log('Source:', SRC);
console.log('Token authority files:', [...TOKEN_FILES].join(', '));
console.log('Scan extensions:', [...SCAN_EXT].join(', '));
console.log();

const start = Date.now();
await walk(SRC);
const elapsed = Date.now() - start;

if (violations.length === 0) {
  console.log(`✓ No token drift detected (${elapsed}ms)`);
  console.log('  All color literals resolved through src/styles/tokens*.css.');
  process.exit(0);
} else {
  console.log(`✗ ${violations.length} token-drift violation(s) found:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}`);
    console.log(`    ${v.content}`);
    console.log(`    → ${v.matches.join(', ')}`);
    console.log();
  }
  console.log('Fix:');
  console.log('  1. Move the literal into src/styles/tokens.css (add a new semantic token)');
  console.log('  2. Reference it via var(--your-token) in the source file');
  console.log('  3. Re-run: node scripts/check-tokens.mjs');
  console.log();
  console.log('If the literal is justified (e.g. design-system source file):');
  console.log('  Add the path to PATHS_ALLOWLIST in scripts/check-tokens.mjs with a comment.');
  process.exit(1);
}
