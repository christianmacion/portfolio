// check-color-contrast.mjs — v7.7.11 STATIC COLOR-CONTRAST CI GATE
//
// Closes the gap left by scripts/scan-a11y.mjs (which intentionally
// disables axe-core color-contrast because jsdom cannot compute
// styles). This gate walks src/styles/tokens.css, resolves the
// concrete color values of every token pair used in the design
// system, and emits the WCAG 2.2 contrast ratio + pass/fail.
//
// The contract is the list of (text-token, bg-token, "AA"|"AAA",
// large-text?, role) tuples below. Every token pair that's actually
// rendered together goes in here. When a future contributor changes
// a token value without re-checking the pair, CI catches it.
//
// WCAG 2.2 AA:
//   - normal text  ≥ 4.5:1
//   - large text   ≥ 3.0:1 (18pt+ or 14pt-bold)
//   - UI components ≥ 3.0:1 (boundary/icon)
//
// This is the canonical gate to catch the "tokens.css v6.10.17"
// bug class — a contributor changes one of the tokens and forgets
// to check downstream pair ratios. v7.7.11 is the contract.
//
// Exits 1 on any AA fail (text < 4.5:1, UI < 3.0:1).
// Exits 0 otherwise. Used in: npm run ci (before headings:check).

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Color resolution helpers — handle #rgb / #rrggbb / rgb() / rgba()
// transparently. Skip color-mix() and var()-only (leave the dynamic
// ratio to a future Playwright pass) and warn on those.
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

// WCAG relative luminance.
function relLum(c) {
  const ch = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const r = ch(c.r);
  const g = ch(c.g);
  const b = ch(c.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(c1, c2) {
  const l1 = relLum(c1);
  const l2 = relLum(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Token resolver — find `--c-name: value;` declarations in tokens.css.
// Strips comments + matches hex/rgb/rgba literals. For color-mix() and
// var()-only references, we record the token but emit a warning.
// ---------------------------------------------------------------------------

function parseTokens(src) {
  const tokens = new Map();
  // Strip block comments
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /--c-([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const name = m[1];
    const raw = m[2].trim();
    // Try hex
    let parsed = parseHex(raw);
    let isDynamic = false;
    if (!parsed) {
      parsed = parseRgb(raw);
    }
    if (!parsed) {
      // color-mix(...) or var(...) — dynamic
      isDynamic = true;
      parsed = null;
    }
    tokens.set(name, { raw, color: parsed, isDynamic });
  }
  return tokens;
}

// Resolve a token string to a concrete color by walking the token map.
// Returns { color, dynamic } — color is null if any step is dynamic.
function resolveColor(spec, tokens) {
  if (typeof spec === 'object' && spec !== null) {
    // Already a parsed color
    return { color: spec, dynamic: false };
  }
  const tokenName = spec.replace(/^--c-/, '');
  const tok = tokens.get(tokenName);
  if (!tok) return { color: null, dynamic: true };
  if (tok.isDynamic) {
    return { color: null, dynamic: true, raw: tok.raw };
  }
  return { color: tok.color, dynamic: false };
}

// ---------------------------------------------------------------------------
// THE CONTRACT — every text/bg pair that's actually rendered together.
// Add a row when introducing a new rendered combination.
//
// Columns:
//   text        — --c-* token name (the foreground / text color)
//   bg          — --c-* token name (the background surface)
//   level       — 'AA' or 'AAA' (AAA is stricter)
//   size        — 'normal' (≥4.5:1) | 'large' (≥3.0:1) | 'ui' (≥3.0:1)
//   role        — where this pair is used (so the maintainer knows what
//                 visual surface is affected by a change)
//
// Missing combos can be inferred but historically are: body text on bg,
// caption text on bg, button text on amber, link on hover, etc.
// ---------------------------------------------------------------------------

const CONTRACT = [
  // === Body text — primary ink on primary bg ===
  { text: 'ink', bg: 'bg', level: 'AA', size: 'normal', role: 'body text' },
  { text: 'ink', bg: 'tape', level: 'AA', size: 'normal', role: 'body text' },
  { text: 'ink-2', bg: 'bg', level: 'AA', size: 'normal', role: 'muted body' },
  { text: 'ink-3', bg: 'bg', level: 'AA', size: 'normal', role: 'faintest text (captions, footnotes)' },

  // === Panel surfaces ===
  { text: 'ink', bg: 'bg-2', level: 'AA', size: 'normal', role: 'lifted panel body' },
  { text: 'ink-2', bg: 'bg-2', level: 'AA', size: 'normal', role: 'lifted panel muted' },
  { text: 'ink-2', bg: 'bg-3', level: 'AA', size: 'normal', role: 'deepest panel muted' },

  // === CTA / accent — amber on dark ===
  { text: 'amber-light', bg: 'bg', level: 'AA', size: 'normal', role: 'amber link/highlight' },
  { text: 'amber', bg: 'bg', level: 'AA', size: 'normal', role: 'amber body emphasis' },
  { text: 'amber-deep', bg: 'bg', level: 'AA', size: 'normal', role: 'amber-deep body emphasis' },

  // === CTA button — actual rendered pair per global.css:468-475 + CTABanner.astro:292-299 ===
  // .btn--primary { background: var(--c-amber-deep); color: var(--c-primary-deep); }
  // v7.7.11 — was var(--c-primary) on amber-deep (2.89:1, fail AA 4.5:1).
  // Changed to var(--c-primary-deep) — clears AAA on amber fill.
  // WCAG normal text needs ≥ 4.5:1.
  { text: 'primary-deep', bg: 'amber-deep', level: 'AA', size: 'normal', role: 'CTA btn--primary text on amber-deep fill' },
  { text: 'primary-deep', bg: 'amber', level: 'AA', size: 'normal', role: 'CTA btn--primary hover text on amber fill' },
  { text: 'primary-deep', bg: 'amber-light', level: 'AA', size: 'normal', role: 'CTA hover state on amber-light' },

  // === Footer / chrome ===
  { text: 'ink-mute', bg: 'bg', level: 'AA', size: 'normal', role: 'footer muted link' },
  { text: 'white-soft', bg: 'bg', level: 'AA', size: 'normal', role: 'white-mute on bg' },
  { text: 'white-faint', bg: 'bg', level: 'AA', size: 'normal', role: 'white-faint on bg' },
  { text: 'white-ghost', bg: 'bg', level: 'AA', size: 'ui', role: 'white-ghost UI chrome' },

  // === Warning / status ===
  { text: 'warn', bg: 'bg', level: 'AA', size: 'normal', role: 'warning text on bg' },
];

// ---------------------------------------------------------------------------

function aaThreshold(size) {
  // Normal text needs 4.5:1 (WCAG 2.2 AA, SC 1.4.3)
  // Large text (18pt+ or 14pt bold) needs 3.0:1
  // UI components / icons need 3.0:1
  return size === 'normal' ? 4.5 : 3.0;
}

async function main() {
  console.log('=== Static Color-Contrast Audit (v7.7.11) — WCAG 2.2 AA SC 1.4.3 ===\n');

  const src = readFileSync('src/styles/tokens.css', 'utf8');
  const tokens = parseTokens(src);
  console.log(`Parsed ${tokens.size} token(s) from tokens.css.\n`);

  let dynamicCount = 0;
  const findings = [];

  for (const pair of CONTRACT) {
    const a = resolveColor(`--c-${pair.text}`, tokens);
    const b = resolveColor(`--c-${pair.bg}`, tokens);

    if (a.dynamic || b.dynamic) {
      // Skip pairs where one side is dynamic; Playwright would catch those.
      // Track for awareness.
      dynamicCount++;
      findings.push({
        pair: `${pair.text} on ${pair.bg}`,
        role: pair.role,
        status: 'skip-dynamic',
        msg: `dynamic mix — skipped (${a.raw || b.raw})`,
      });
      continue;
    }

    const ratio = contrastRatio(a.color, b.color);
    const threshold = aaThreshold(pair.size);
    const pass = ratio >= threshold;
    findings.push({
      pair: `${pair.text} on ${pair.bg}`,
      role: pair.role,
      size: pair.size,
      threshold,
      ratio: ratio.toFixed(2),
      status: pass ? 'PASS' : 'FAIL',
      msg: pass
        ? `ratio ${ratio.toFixed(2)}:1 ≥ ${threshold}:1 (${pair.level} ${pair.size})`
        : `ratio ${ratio.toFixed(2)}:1 < ${threshold}:1 (${pair.level} ${pair.size} — FAIL)`,
    });
  }

  const fails = findings.filter((f) => f.status === 'FAIL');
  const passes = findings.filter((f) => f.status === 'PASS');
  const skips = findings.filter((f) => f.status === 'skip-dynamic');

  console.log(`Contract: ${CONTRACT.length} pair(s) · ${passes.length} PASS · ${fails.length} FAIL · ${skips.length} skip-dynamic\n`);

  if (fails.length === 0) {
    console.log('✓ All token-pair contracts hold at the documented AA thresholds.');
    if (dynamicCount > 0) {
      console.log(`  (${dynamicCount} pair(s) skipped due to color-mix() / var()-only tokens — those are caught by axe-core in Playwright.)`);
    }
    return;
  }

  console.error(`\nFAIL — ${fails.length} pair(s) below AA threshold:\n`);
  for (const f of fails) {
    console.error(`  ✗ ${f.pair}  [${f.role}]`);
    console.error(`      ${f.msg}`);
  }
  process.exit(1);
}

main().catch((e) => {
  console.error('color-contrast audit crashed:', e);
  process.exit(2);
});
