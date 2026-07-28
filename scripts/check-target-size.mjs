#!/usr/bin/env node
// scripts/check-target-size.mjs
// v7.7.61 — 65th CI gate
// Catches the WCAG 2.2 Level AA 2.5.8 Target Size (Minimum) bug class:
// every interactive UI element must have a target size of at least 24×24
// CSS pixels. Screen-reader / motor-impaired / stylus users on small
// targets will fail to activate buttons smaller than that.
//
// Detection strategy: walk src/**/*.astro + src/**/*.css. For each CSS
// rule that targets an interactive element (button / chip / toggle / dot
// / thumb / control / swatch / close / link / summary / pill / tag /
// nav-btn / picker / icon-btn / link-btn) OR has `cursor: pointer`,
// compute the rendered target size:
//   - explicit width × height (or min-width × min-height) when set;
//   - otherwise text height (font-size × line-height) + vertical padding.
// Flag any element with computed width < 24 OR height < 24.
//
// What this gate does NOT detect (out of scope, documented in allow-list):
//   - SVG <circle> / <path> elements with cursor: pointer — the SVG
//     element's hit area is the geometry itself, not its CSS box. The
//     containing <a> or interactive parent is the actual target.
//   - <input type="range"> slider tracks — the track is decorative; the
//     thumb is the actual target.
//   - Focus-visible outline drawing — the outline is the indicator, not
//     the target.
//   - 24px-equivalent spacing exception (WCAG 2.5.8 allows a smaller
//     target if there is ≥24px clear space around it). Static CSS
//     cannot reliably compute clear-space-to-neighbor for every rule;
//     this exemption is editorial, not automatic.
//
// Allow-list (known-safe patterns):
//   - `.stmt-carousel__dot` 44×44 explicit
//   - `.stmt-cards__pip` 44×44 explicit
//   - `#back-to-top` 40×40 explicit
//   - `.earth-drawer__panel summary` min-height: 44px
//   - `.nav-more__summary` padding: 0.5rem 0.6rem + fs-sm text (~30px height)
//
// Mutation harness: inject `width: 20px; height: 20px` on a known-safe
// button → caught. Append a CSS rule with `cursor: pointer` + small box
// → caught.
//
// Usage: node scripts/check-target-size.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.css']);
const MIN_TARGET = 24; // WCAG 2.5.8 Level AA minimum (CSS pixels)

// Patterns that identify an interactive element by class name.
const INTERACTIVE_PATTERNS = [
  /\bbtn\b/i,
  /\bbutton\b/i,
  /\bchip\b/i,
  /\btoggle\b/i,
  /\bswitch\b/i,
  /\bmenu-btn\b/i,
  /\bicon-btn\b/i,
  /\blink-btn\b/i,
  /\bnav-btn\b/i,
  /\bnav-toggle\b/i,
  /\bnav__toggle\b/i,
  /\bnav-toggle-input\b/i,
  /\bback-to-top\b/i,
  /\bsummary\b/i, // <details><summary>
];

// Decorative class fragments — these match no matter what the suffix is.
// If a class name contains one of these, the element is a decorative badge
// or indicator (not an interactive control), so we skip it even if the class
// also contains `btn` etc.
const DECORATIVE_FRAGMENTS = [
  /\bswatch\b/i,
  /\bpill\b/i,
  /\bbadge\b/i,
  /\bcap-swatch\b/i,
  /\bcap\b/i,
  /\bindicator\b/i,
  /\bmarker\b/i,
  /\bdot\b/i,
  /\b__thumb\b/i, // matches ::-webkit-slider-thumb (pseudo-element, decorative)
  /\blegend\b/i, // matches .legend-swatch etc.
  /\btag\b/i, // matches .eval-pill / .tag-label (not <button>)
  /\b__label\b/i,
  /\b__text\b/i,
];

// Known-safe allow-list (file + selector + why).
const ALLOW = [
  {
    file: 'src/components/StatementCarousel.astro',
    selector: '.stmt-carousel__dot',
    why: '44×44 explicit, large transparent hit area around small visible dot',
  },
  {
    file: 'src/components/StatementCarousel.astro',
    selector: '.stmt-cards__pip',
    why: '44×44 explicit, large transparent hit area',
  },
  { file: 'src/styles/back-to-top.css', selector: '#back-to-top', why: '40×40 explicit' },
  {
    file: 'src/components/EarthDrawer.astro',
    selector: '.earth-drawer__panel summary',
    why: 'min-height: 44px',
  },
  {
    file: 'src/components/NavMore.astro',
    selector: '.nav-more__summary',
    why: 'padding: 0.5rem 0.6rem + fs-sm text (~30px computed height)',
  },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (SCAN_EXT.has(full.slice(full.lastIndexOf('.')))) files.push(full);
  }
  return files;
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

// Parse CSS declarations inside one `{ ... }` rule body.
function parseDecls(body) {
  const decls = {};
  // Strip comments
  const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([a-z-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    decls[m[1].toLowerCase().trim()] = m[2].trim();
  }
  return decls;
}

// Walk `src/**/*.css` (and `<style>` blocks inside `src/**/*.astro`),
// return list of {file, line, selector, decls}.
function collectRules(files) {
  const rules = [];
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    // Capture every <style>...</style> block + for .css files, the whole file.
    const styleRanges = [];
    if (file.endsWith('.css')) {
      styleRanges.push([0, html.length]);
    } else {
      const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        styleRanges.push([
          m.index + m[0].indexOf('>') + 1,
          m.index + m[0].length - '</style>'.length,
        ]);
      }
    }
    for (const [start, end] of styleRanges) {
      const css = html.slice(start, end);
      let i = 0;
      while (i < css.length) {
        // Find next `{`
        const braceIdx = css.indexOf('{', i);
        if (braceIdx === -1) break;
        const selector = css.slice(i, braceIdx).trim();
        // Find matching `}` (no nested braces in CSS)
        const closeIdx = css.indexOf('}', braceIdx);
        if (closeIdx === -1) break;
        const body = css.slice(braceIdx + 1, closeIdx);
        rules.push({
          file,
          line: lineOf(html, start + braceIdx),
          selector,
          decls: parseDecls(body),
        });
        i = closeIdx + 1;
      }
    }
  }
  return rules;
}

// Extract selector tokens. We treat each comma-separated selector separately.
function selectorsOf(ruleSelector) {
  return ruleSelector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pick the FIRST class name (.foo) from a selector — used to match allow-list.
function firstClass(sel) {
  const m = sel.match(/\.([a-zA-Z0-9_-]+)/);
  return m ? '.' + m[1] : null;
}

// Check whether selector targets an interactive element. Two signals:
//   1. `cursor: pointer` — strong signal that the element IS clickable
//   2. Class-name match against INTERACTIVE_PATTERNS — the LAST class in
//      the selector must match (avoids flagging children of interactive
//      parents like `.nav__toggle span` where `span` is decorative)
function isInteractive(selector, decls) {
  const cleanSel = selector.replace(/\/\*[\s\S]*?\*\//g, '');
  if (decls && decls['cursor'] && /^pointer$/i.test(decls['cursor'])) {
    // cursor:pointer is sufficient even without class match
    return true;
  }
  return lastTokenInteractive(cleanSel);
}

function lastTokenInteractive(cleanSel) {
  const parts = cleanSel.split(',');
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const lastTok = tokens[tokens.length - 1];
    const bare = lastTok.replace(
      /::?(hover|focus|active|focus-visible|focus-within|disabled|visited|checked|not|is|where|has|nth-child|nth-of-type|first-child|last-child|before|after|root|target|empty|placeholder-shown|invalid|valid|required|optional|read-only|read-write|dir|any-link|link|local-link|target-within|focus-within|webkit-slider-thumb|moz-range-thumb|ms-thumb|ms-track|ms-fill-lower|ms-fill-upper|placeholder|selection|marker|scrollbar|first-letter|first-line|spelling-error|grammar-error)\b.*$/i,
      '',
    );
    if (!bare) continue;
    // Skip bare tag names (span, div, etc.) — they need a class to qualify
    if (/^[a-z][a-z0-9]*$/i.test(bare)) continue;
    // Decorative class fragments → skip
    for (const re of DECORATIVE_FRAGMENTS) {
      if (re.test(bare)) return false;
    }
    for (const re of INTERACTIVE_PATTERNS) {
      if (re.test(bare)) return true;
    }
  }
  return false;
}

// Resolve a CSS pixel value: `24px` → 24, `0.5rem` → 8 (assuming 16px base),
// `var(--x)` → null unless we recognise it from TOKEN_VARS.
const TOKEN_VARS = {
  '--sp-1': 8,
  '--sp-2': 16,
  '--sp-3': 24,
  '--sp-4': 40,
  '--sp-5': 64,
  '--sp-6': 96,
  '--sp-7': 144,
  '--j-sp-1': 8,
  '--j-sp-2': 16,
  '--j-sp-3': 24,
  '--j-sp-4': 40,
  '--j-t-xs': 12,
  '--j-t-sm': 14,
  '--j-t-base': 16,
  '--j-t-md': 19,
  '--j-t-lg': 28,
  '--j-t-xl': 42,
  '--j-t-2xl': 64,
  '--fs-3xs': 12,
  '--fs-2xs': 12,
  '--fs-xs': 12,
  '--fs-sm': 14,
  '--fs-base': 16,
  '--fs-lg': 19,
  '--fs-xl': 28,
  '--fs-2xl': 42,
  '--fs-3xl': 42,
  '--fs-4xl': 64,
};
const REM_BASE = 16; // 1rem = 16px

function pxValue(v) {
  if (!v) return null;
  v = v.trim();
  // Unitless 0 — CSS allows `0` to mean 0 in any context
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return parseFloat(v);
  // Direct px
  const px = v.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (px) return parseFloat(px[1]);
  // rem
  const rem = v.match(/^(-?\d+(?:\.\d+)?)rem$/);
  if (rem) return parseFloat(rem[1]) * REM_BASE;
  // em
  const em = v.match(/^(-?\d+(?:\.\d+)?)em$/);
  if (em) return parseFloat(em[1]) * REM_BASE;
  // var() reference
  const vmatch = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (vmatch && TOKEN_VARS[vmatch[1].toLowerCase()]) return TOKEN_VARS[vmatch[1].toLowerCase()];
  // calc(...) — only handle simple `var(...) + 0` or `0 + var(...)`
  // or `var(...) / N` or `N * var(...)`
  const calc = v.match(/^calc\(([^)]+)\)$/);
  if (calc) {
    // Replace var(...) with pxValue, then eval simple math
    let expr = calc[1]
      .replace(/var\((--[a-z0-9-]+)\)/gi, (_, name) => {
        return TOKEN_VARS[name.toLowerCase()] != null
          ? String(TOKEN_VARS[name.toLowerCase()])
          : '0';
      })
      .replace(/\s+/g, '');
    // Only allow digits, +, -, *, /, parens
    if (/^[\d+\-*/().\s]+$/.test(expr)) {
      try {
        return Function(`"use strict"; return (${expr});`)();
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Parse a `padding:` shorthand. Supports 1-4 values.
function parsePadding(v) {
  if (!v) return null;
  const parts = v
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const resolved = parts.map(pxValue);
  if (resolved.some((r) => r == null)) return null;
  if (parts.length === 1)
    return { top: resolved[0], right: resolved[0], bottom: resolved[0], left: resolved[0] };
  if (parts.length === 2)
    return { top: resolved[0], right: resolved[1], bottom: resolved[0], left: resolved[1] };
  if (parts.length === 3)
    return { top: resolved[0], right: resolved[1], bottom: resolved[2], left: resolved[1] };
  return { top: resolved[0], right: resolved[1], bottom: resolved[2], left: resolved[3] };
}

// Parse `font: 600 10px / 1.4 var(--ff-mono)` shorthand. Returns
// { fontSize: px, lineHeight: ratio | px }.
function parseFont(v) {
  if (!v) return null;
  const sizeMatch = v.match(/(\d+(?:\.\d+)?)(px|rem|em)\s*\/\s*([\d.]+)/);
  if (sizeMatch) {
    const size = pxValue(sizeMatch[1] + sizeMatch[2]);
    const lh = parseFloat(sizeMatch[3]);
    return { fontSize: size, lineHeight: lh < 4 ? lh * size : lh }; // <4 ratio, else px
  }
  const sizeOnly = v.match(/(\d+(?:\.\d+)?)(px|rem|em)/);
  if (sizeOnly) return { fontSize: pxValue(sizeOnly[1] + sizeOnly[2]), lineHeight: null };
  return null;
}

// Compute target size. Returns {width, height, how}.
function computeSize(decls) {
  const explicitW = pxValue(decls['width']);
  const explicitH = pxValue(decls['height']);
  const minW = pxValue(decls['min-width']);
  const minH = pxValue(decls['min-height']);
  const padShort = parsePadding(decls['padding']);
  // padding-inline / padding-block contribute to width / height respectively.
  const padInline = parsePadding(
    decls['padding-inline'] || decls['padding-inline-start'] || decls['padding-inline-end'],
  );
  const padBlock = parsePadding(
    decls['padding-block'] || decls['padding-block-start'] || decls['padding-block-end'],
  );
  const padding =
    padShort ||
    (padInline || padBlock
      ? {
          top: padBlock?.top ?? 0,
          right: padInline?.right ?? 0,
          bottom: padBlock?.bottom ?? 0,
          left: padInline?.left ?? 0,
        }
      : null);
  const fontInfo = parseFont(decls['font']);
  const fontSize = fontInfo?.fontSize ?? pxValue(decls['font-size']);
  const lh = fontInfo?.lineHeight ?? pxValue(decls['line-height']);
  const effectiveLh = lh ?? (fontSize ? fontSize * 1.2 : null);

  const padX = padding ? padding.left + padding.right : 0;
  const padY = padding ? padding.top + padding.bottom : 0;
  const textH = fontSize && effectiveLh ? effectiveLh : null;

  const width = Math.max(explicitW ?? 0, minW ?? 0, textH ?? 0) + padX;
  let height;
  if (explicitH || minH) {
    height = Math.max(explicitH ?? 0, minH ?? 0) + padY;
  } else if (textH) {
    height = textH + padY;
  } else {
    height = padY || null;
  }
  return {
    width: width || null,
    height: height || null,
    parts: { explicitW, explicitH, minW, minH, padding, fontSize, effectiveLh },
  };
}

function isAllowed(file, firstCls) {
  if (!firstCls) return null;
  for (const a of ALLOW) {
    if (a.file !== file) continue;
    if (a.selector !== firstCls) continue;
    return a;
  }
  return null;
}

async function main() {
  console.log(
    '=== Target-Size Audit (v7.7.61) — WCAG 2.5.8 Target Size (Minimum, 24×24 CSS px) ===\n',
  );

  const files = walk(ROOT);
  const rules = collectRules(files);
  const findings = [];
  const allowed = [];
  const reviewed = new Set();

  for (const rule of rules) {
    for (const sel of selectorsOf(rule.selector)) {
      if (!isInteractive(sel, rule.decls)) continue;
      const size = computeSize(rule.decls);
      const w = size.width;
      const h = size.height;
      if (w == null && h == null) continue; // can't determine — skip
      const firstCls = firstClass(sel);
      const allow = isAllowed(rule.file, firstCls);
      if (allow) {
        allowed.push({ file: rule.file, line: rule.line, selector: sel, size, why: allow.why });
        continue;
      }
      const smallW = w != null && w < MIN_TARGET;
      const smallH = h != null && h < MIN_TARGET;
      if (smallW || smallH) {
        findings.push({
          file: rule.file,
          line: rule.line,
          selector: sel,
          width: w,
          height: h,
          parts: size.parts,
        });
      }
      reviewed.add(`${rule.file}::${sel}`);
    }
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${reviewed.size} interactive rule(s) · ${findings.length} candidate(s) · ${allowed.length} allow-listed\n`,
  );

  if (allowed.length > 0) {
    console.log('Allow-listed (permitted):\n');
    for (const a of allowed) {
      console.log(`  ✓ ${a.file}:${a.line}  ${a.selector}`);
      console.log(
        `      size ≈ ${a.size.width ?? '?'}×${a.size.height ?? '?'}  |  why: ${a.why}\n`,
      );
    }
  }

  if (findings.length === 0) {
    console.log('✓ All interactive elements meet WCAG 2.5.8 (≥24×24 CSS px target).');
    return;
  }

  console.error(
    `FAIL — ${findings.length} interactive element(s) below WCAG 2.5.8 24×24 CSS px minimum:\n`,
  );
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.line}  ${f.selector}`);
    console.error(
      `      computed ≈ ${f.width ?? '?'}×${f.height ?? '?'}  (min ${MIN_TARGET}×${MIN_TARGET})`,
    );
    console.error(
      `      decls: ${JSON.stringify({ w: f.parts.explicitW, h: f.parts.explicitH, minW: f.parts.minW, minH: f.parts.minH, pad: f.parts.padding, fs: f.parts.fontSize, lh: f.parts.effectiveLh })}\n`,
    );
  }
  console.error(
    "Fix: either (a) increase the element's width / height / min-width / min-height to ≥24, OR (b) add padding to bring the click target ≥24 in both axes, OR (c) add an entry to the ALLOW array with a one-line `why` justification.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('target-size scan crashed:', e);
  process.exit(2);
});
