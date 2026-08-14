// check-no-interpolation-leaks.mjs — v13.1.4 CI GATE
//
// Fails the build if any HTML attribute (class / aria-label / id / role /
// href / src) contains a literal `{var}` interpolation inside a
// double-quoted attribute value. Astro does NOT interpolate `{…}` inside
// double-quoted attributes — only inside JSX expression braces
// (`attr={value}`) or backtick template literals (`attr={\`foo ${x}\`}`).
// The result of the bug is the literal text `{var}` shipping to the
// browser, which silently breaks the selector.
//
// Bug class closed:
//   - polish-7aa  (reading.astro status pills)
//   - polish-7ac  (contact.astro recency stamp href)
//
// Excluded by design:
//   - matches inside backtick template literals (`…${var}…` is valid JS)
//   - lines marked with `// @intentional` (escape hatch with intent)
//   - LaTeX math like `\mathcal{S}` / `\mathrm{rated}` (the `{` is a
//     backslash-command brace, not an interpolation)
//
// Used in: npm run prebuild (per v13.1.4 doctrine; cheap insurance
// against the silent-`{var}`-leak class before the bundle even builds).

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const SRC = 'src';
const SCAN_DIRS = new Set(['pages', 'components', 'layouts']);
const SCAN_EXT = new Set(['.astro', '.ts', '.tsx', '.jsx']);
const ATTRS = ['class', 'aria-label', 'id', 'role', 'href', 'src'];

// Match an attribute whose double-quoted value contains a `{…}` block.
//   attr="prefix{middle}suffix"
// Examples (should FLAG):
//   class="foo {bar} baz"
//   href="/x/{id}/y"
//   aria-label="Section {n} of {total}"
// Examples (should NOT match):
//   class={expr}                       (no quotes — uses JSX expression)
//   class={`foo ${bar}`}               (backticks — template literal)
//   class="static-value"               (no interpolation at all)
const ATTR_REGEX = new RegExp(
  `\\b(?:${ATTRS.join('|')})\\s*=\\s*"([^"]*\\{[^}]+\\}[^"]*)"`,
  'g',
);

let violations = [];

function countUnescapedBackticks(s) {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '`' && s[i - 1] !== '\\') count++;
  }
  return count;
}

// Pre-compute, for each character offset in the stripped file, whether
// the position is inside an unescaped backtick template literal.
// Backticks toggle state (even count → outside, odd count → inside);
// multi-line template literals are common in Astro XML/string builders
// (e.g. RSS feeds) so per-line tracking would mis-flag them.
function buildBacktickMask(text) {
  const mask = new Uint8Array(text.length);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`' && text[i - 1] !== '\\') depth ^= 1;
    mask[i] = depth;
  }
  return mask;
}

function isLatexMath(matchStr) {
  // LaTeX math command: `\cmd{arg}` or escaped `\{…\}`.
  // If the matched substring contains a `\` followed by letters then `{`,
  // treat the surrounding `{…}` block as a LaTeX brace, not interpolation.
  return /\\[a-zA-Z]+\s*\{/.test(matchStr) || /\\\{/.test(matchStr);
}

async function walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SCAN_DIRS.has(rel)) continue; // only recurse into pages/components/layouts
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      await walk(full, rel);
    } else {
      if (!SCAN_EXT.has(extname(e.name))) continue;

      const originalText = await readFile(full, 'utf8');
      // Strip block comments first (multi-line safe via [\s\S]).
      const strippedText = originalText.replace(/\/\*[\s\S]*?\*\//g, '');
      const tplMask = buildBacktickMask(strippedText);
      const lines = strippedText.split('\n');

      // Build a per-line offset table so we can map (line, match.index)
      // back to absolute char offsets in strippedText.
      const lineOffsets = [];
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        lineOffsets.push(acc);
        acc += lines[i].length + 1; // +1 for the '\n'
      }

      lines.forEach((rawLine, idx) => {
        const originalLine = originalText.split('\n')[idx] ?? rawLine;

        // Per-line escape hatch: `// @intentional` (case-sensitive,
        // checked on the ORIGINAL line, before comment-strip).
        if (originalLine.includes('// @intentional')) return;

        // Strip trailing line comments. Match must operate on the
        // code-only portion so URL `//` in strings is preserved.
        const noComment = rawLine.replace(/\/\/.*$/, '');

        ATTR_REGEX.lastIndex = 0;
        let m;
        while ((m = ATTR_REGEX.exec(noComment)) !== null) {
          const absOffset = lineOffsets[idx] + m.index;
          // Check backtick state at the START of the match (any
          // backtick INSIDE the match that opens a sub-literal is
          // fine — we only care whether we entered this attribute
          // already inside a template literal).
          if (tplMask[absOffset] === 1) continue;
          const matchStr = m[0];
          if (isLatexMath(matchStr)) continue;
          violations.push({
            file: rel,
            line: idx + 1,
            content: (originalLine || rawLine).trim().slice(0, 160),
            match: matchStr,
          });
        }
      });
    }
  }
}

console.log('=== Astro Interpolation-Leak Audit (v13.1.4) ===\n');
console.log('Source:', `${SRC}/{${[...SCAN_DIRS].join(',')}}/**`);
console.log('Attributes scanned:', ATTRS.join(', '));
console.log('Extensions:', [...SCAN_EXT].join(', '));
console.log();

const start = Date.now();
await walk(SRC);
const elapsed = Date.now() - start;

if (violations.length === 0) {
  console.log(`✓ No interpolation leaks detected (${elapsed}ms)`);
  console.log('  All HTML attributes use Astro-safe value forms.');
  console.log('  (JSX {expr} · backtick template literals · static strings)');
  process.exit(0);
} else {
  console.log(`✗ ${violations.length} interpolation-leak violation(s) found:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}`);
    console.log(`    ${v.content}`);
    console.log(`    → ${v.match}`);
    console.log();
  }
  console.log('Fix one of two ways:');
  console.log('  1. Use JSX expression form:        attr={`prefix${var}suffix`}');
  console.log('  2. Use template-literal form:       attr={`prefix${var}suffix`}');
  console.log('  3. If intentional, mark the line:   attr="… {var} …" // @intentional');
  console.log();
  console.log('Astro does NOT interpolate {var} inside double-quoted attributes.');
  console.log('The literal text `{var}` ships to the browser and silently breaks the selector.');
  process.exit(1);
}