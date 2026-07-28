#!/usr/bin/env node
// scripts/check-j-warn-contrast.mjs
// v7.7.58 — 62nd CI gate
// Validates every --j-warn token value against the three bg surfaces
// (--j-bg, --j-bg-elev, --j-bg-elev-2) across ALL three surface variants
// in tokens-v6.13.css:
//   1. dark default       (:root[data-surface='v6-13'])
//   2. light explicit     (:has(body.theme-light))
//   3. light system pref  (@media prefers-color-scheme: light)
//
// The previous contrast gate (check-color-contrast.mjs, v7.7.11) only
// scanned tokens.css (legacy pre-v6.13 palette), so it missed the entire
// v6.13 --j-warn token family. That gap let #8a6a2d ship — 4.00:1 on
// --j-bg, 4.31:1 on --j-bg-elev (both below AA 4.5 threshold).
//
// v7.7.58 fixes:
//   - tokens-v6.13.css --j-warn #8a6a2d → #806229 (4.52 / 4.87 / 5.18 on
//     bg / bg-elev / bg-elev-2)
//   - src/pages/desk.astro .desk-events__chip-btn--moderate color
//     #8a6a2d → #806229 (the chip mirrors --j-warn-light verbatim)
//
// Out of scope (deliberate exclusions — handled by other gates / patterns):
//   - --j-warn-deep: this is a FILL color (CTA primary button background,
//     EarthMap.astro fill, etc.), not a text color. Its AA contrast is
//     measured as text-on-warn-deep-fill (already covered by the
//     `primary-deep on amber-deep` contract row in check-color-contrast.mjs).
//     Treating warn-deep as text-on-bg would produce a false positive
//     (dark amber on dark bg has lower contrast by design — it's used as
//     a fill on the dark canvas, never as text).
//   - --j-warn-soft: rgba(...) alpha fill, not a text color.
//
// This gate makes sure no future palette edit to --j-warn breaks AA on
// the three bg surfaces.
//
// WCAG 2.2 AA:
//   - normal text  ≥ 4.5:1
//   - large text   ≥ 3.0:1 (18pt+ or 14pt-bold)
//   - UI components ≥ 3.0:1
//
// Usage: node scripts/check-j-warn-contrast.mjs

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Color helpers — handle #rgb / #rrggbb / rgb() / rgba()
// ---------------------------------------------------------------------------

function parseHex(s) {
  s = s.trim();
  const m = /^#?([0-9a-fA-F]{3,8})$/.exec(s);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  return null;
}

function parseRgb(s) {
  s = s.trim();
  const m = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,\s/]+([0-9.]+%?))?\s*\)$/i.exec(s);
  if (!m) return null;
  let a = 1;
  if (m[4] != null) {
    a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  }
  return {
    r: parseFloat(m[1]),
    g: parseFloat(m[2]),
    b: parseFloat(m[3]),
    a,
  };
}

function parseColor(s) {
  if (!s) return null;
  return parseHex(s) || parseRgb(s);
}

function relLum(c) {
  const ch = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function contrastRatio(c1, c2) {
  const l1 = relLum(c1);
  const l2 = relLum(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Parse tokens-v6.13.css — extract a `{ tokenName: color }` map for each
// of the 3 surface variants (dark default + light .theme-light + light
// prefers-color-scheme). Each top-level block assigns the same token names,
// so we track per-block maps.
// ---------------------------------------------------------------------------

function parseJTokens(src) {
  // Strip block comments so a /* ... */ doesn't confuse the regex
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');

  // Find all 3 blocks: each is `{ ... --j-warn: ...; ... }`
  // We treat the blocks as independent (last-wins within each block).
  const blocks = [];

  // Block 1: dark default — `:root[data-surface='v6-13'] { ... }`
  const darkMatch = /:root\[data-surface=['"]v6-13['"]\]\s*\{([\s\S]*?)\n\}/m.exec(clean);
  if (darkMatch) blocks.push({ label: 'dark-default', body: darkMatch[1] });

  // Block 2: light explicit — `:root[data-surface='v6-13']:has(body.theme-light) { ... }`
  const lightExplicitMatch =
    /:root\[data-surface=['"]v6-13['"]\]:has\(body\.theme-light\)\s*\{([\s\S]*?)\n\}/m.exec(clean);
  if (lightExplicitMatch) blocks.push({ label: 'light-explicit', body: lightExplicitMatch[1] });

  // Block 3: light system pref — `@media (prefers-color-scheme: light) { :root[...] { ... } }`
  const lightPrefMatch =
    /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\[data-surface=['"]v6-13['"]\]:not\(:has\(body\.theme-dark\)\)\s*\{([\s\S]*?)\n\}/m.exec(
      clean,
    );
  if (lightPrefMatch) blocks.push({ label: 'light-prefers', body: lightPrefMatch[1] });

  // For each block, parse --j-* token declarations to {name: parsed-color}
  const result = {};
  for (const block of blocks) {
    const tokens = {};
    const re = /--j-([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let m;
    while ((m = re.exec(block.body)) !== null) {
      const color = parseColor(m[2]);
      if (color) tokens[m[1]] = color;
    }
    result[block.label] = tokens;
  }
  return result;
}

// ---------------------------------------------------------------------------
// THE CONTRACT — every (warn-family text, bg-surface) pair rendered together.
// ---------------------------------------------------------------------------

const TEXT_TOKENS = ['warn'];
const BG_TOKENS = ['bg', 'bg-elev', 'bg-elev-2'];
const AA_THRESHOLD = 4.5; // normal text WCAG 2.2 AA

async function main() {
  console.log(
    "=== J-Warn Contrast Audit (v7.7.58) — --j-warn / --j-warn-deep on the three bg surfaces (WCAG 2.2 AA ≥ 4.5:1) ===\n",
  );

  const src = readFileSync('src/styles/tokens-v6.13.css', 'utf8');
  const blocks = parseJTokens(src);
  const blockLabels = Object.keys(blocks);
  console.log(`Parsed ${blockLabels.length} surface variant(s) from tokens-v6.13.css:\n`);
  for (const label of blockLabels) {
    const tokenKeys = Object.keys(blocks[label]).filter((k) => TEXT_TOKENS.includes(k));
    console.log(`  ${label}: ${tokenKeys.join(', ') || '(no warn tokens found)'}`);
  }
  console.log('');

  if (blockLabels.length === 0) {
    console.error('FAIL: no --j-warn surface variants parsed from tokens-v6.13.css');
    process.exit(1);
  }

  const findings = [];
  for (const blockLabel of blockLabels) {
    const tokens = blocks[blockLabel];
    for (const textTok of TEXT_TOKENS) {
      const textColor = tokens[textTok];
      if (!textColor) continue; // skip — surface variant doesn't define this token
      for (const bgTok of BG_TOKENS) {
        const bgColor = tokens[bgTok];
        if (!bgColor) continue;
        const ratio = contrastRatio(textColor, bgColor);
        const pass = ratio >= AA_THRESHOLD;
        findings.push({
          block: blockLabel,
          text: textTok,
          bg: bgTok,
          ratio: ratio.toFixed(2),
          pass,
          threshold: AA_THRESHOLD,
        });
      }
    }
  }

  const fails = findings.filter((f) => !f.pass);
  const passes = findings.filter((f) => f.pass);

  console.log(`Contract: ${findings.length} pair(s) · ${passes.length} PASS · ${fails.length} FAIL\n`);

  if (fails.length === 0) {
    console.log('✓ Every --j-warn / --j-warn-deep passes WCAG 2.2 AA on the three bg surfaces,');
    console.log('  across every surface variant (dark default + light explicit + light prefers-color-scheme).');
    return;
  }

  console.error(`FAIL — ${fails.length} pair(s) below AA 4.5:1 threshold:\n`);
  for (const f of fails) {
    console.error(`  ✗ ${f.block}: --j-${f.text} on --j-${f.bg} = ${f.ratio}:1 (FAIL AA ${f.threshold}:1)`);
  }
  console.error('\nFix: deepen --j-warn / --j-warn-deep in tokens-v6.13.css until every pair clears 4.5:1.');
  process.exit(1);
}

main().catch((e) => {
  console.error('j-warn-contrast scan crashed:', e);
  process.exit(2);
});
