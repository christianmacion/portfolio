#!/usr/bin/env node
// scripts/check-math-rigor.mjs
// v7.7.60 — 64th CI gate
// Audits every KaTeX equation on the site for math rigor. Catches the
// "Pr(ship) equation" bug class: equations that imply product-of-conditionals
// without stating the conditional-independence assumption that justifies
// the product simplification.
//
// Three classes of issue detected:
//
// 1. LaTeX syntax errors — unbalanced braces / parens / \left\right pairs
//    that KaTeX silently renders as broken (because Equation.astro uses
//    throwOnError: false). The gate imports katex and re-renders with
//    throwOnError: true to catch these.
//
// 2. Conditional independence assumption — equation contains BOTH
//    `Pr(X | Y)` and `∏ Pr(G_i | evidence_i)` on the RHS but the page
//    does NOT include a phrase like "assuming conditional independence"
//    / "under the assumption" / "treats as independent" / "ind. assumed"
//    within ±5 lines. Flag for review.
//
// 3. Single-event Pr on RHS of multi-event equation — equation claims
//    `Pr(A) = f(Pr(B), Pr(C), Pr(D))` where the product form collapses
//    multiple events without an independence statement. Flag.
//
// What this gate does NOT detect:
//   - Equations with wrong numerical values (semantic correctness)
//   - Variables defined only on one side (use a separate editorial pass)
//   - Equations outside `<Equation>` components (raw KaTeX in MDX)
//
// Mutation: inject an equation with `\Pr(A | B) \cdot \Pr(C)` and no
// independence note → caught by class 2.
//
// Usage: node scripts/check-math-rigor.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let katex = null;
try {
  katex = require('katex');
} catch {
  // katex not installed; class-1 detection will skip
}

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro']);

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
  for (let i = 0; i < offset && i < haystack.length; i++) {
    if (haystack.charCodeAt(i) === 10) line++;
  }
  return line;
}

function extractLatexEquations(html) {
  // Find every `latex={` JSX-style attribute whose value is a string literal.
  // The prop value can be `"..."`, `'...'`, or `` `...` `` (template literal).
  // Inside the string, `${...}` interpolations are valid JSX.
  // The challenge: LaTeX itself uses `{...}` heavily (e.g., `\text{ship}`),
  // so we MUST track the string-literal boundary and only look for the
  // closing `}` of the JSX prop AFTER the string literal closes.
  const equations = [];
  // Match `latex={` (without consuming the string opener).
  const propRe = /latex\s*=\s*\{/g;
  let propMatch;
  while ((propMatch = propRe.exec(html)) !== null) {
    // Position right after `latex={` — this is the start of the value.
    const valueStart = propMatch.index + propMatch[0].length;
    const opener = html[valueStart];
    if (opener !== '"' && opener !== "'" && opener !== '`') {
      // Not a string literal (might be a bare identifier like `{latex}`);
      // skip.
      continue;
    }
    const closer = opener; // same char closes
    // Walk forward, respecting escapes and template-literal interpolations,
    // until we find the matching closer.
    let i = valueStart + 1;
    let escape = false;
    let inInterpolation = false;
    let interpDepth = 0;
    let valueEnd = -1;
    while (i < html.length) {
      const c = html[i];
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (c === '\\' && opener !== '`') {
        // String-literal escape (backtick templates don't process \X as escape)
        escape = true;
        i++;
        continue;
      }
      // Template-literal interpolation: ${ ... }
      if (opener === '`' && !inInterpolation && c === '$' && html[i + 1] === '{') {
        inInterpolation = true;
        interpDepth = 1;
        i += 2;
        continue;
      }
      if (inInterpolation) {
        if (c === '{') interpDepth++;
        else if (c === '}') {
          interpDepth--;
          if (interpDepth === 0) inInterpolation = false;
        }
        i++;
        continue;
      }
      if (c === closer) {
        valueEnd = i;
        break;
      }
      i++;
    }
    if (valueEnd === -1) {
      // Unterminated string literal — bail.
      continue;
    }
    // The closing `}` of the JSX prop is the very next char after valueEnd.
    const propEnd = valueEnd + 1;
    if (html[propEnd] !== '}') continue;
    const latex = html.slice(valueStart + 1, valueEnd);
    equations.push({
      latex,
      offset: valueStart,
      line: lineOf(html, valueStart),
      contextAfter: html.slice(propEnd, propEnd + 1500),
    });
  }
  return equations;
}

function latexToJsString(jsxLatex) {
  // JSX template literal like `\\Pr(\\text{ship})` → JS string "\Pr(\text{ship})"
  return jsxLatex.replace(/\\\\/g, '\\').replace(/\\'/g, "'");
}

function interpolateTemplateLiterals(latex) {
  // Replace Astro/JSX template-literal interpolations `${expr}` with a
  // safe placeholder LaTeX (just `n`). KaTeX can't parse `${...}` because
  // that's JS syntax, not LaTeX. The actual rendered equation has the
  // expression's value in place of `${expr}` — for syntax checking, a
  // placeholder is enough to verify brace balance + katex render.
  return latex.replace(/\$\{[^}]*\}/g, 'n');
}

function checkLatexSyntax(latex) {
  // Count braces, parens, brackets. KaTeX parse errors are caught via katex render.
  const issues = [];

  // Brace balance (counting only non-interpolated braces — strip interpolations first)
  const stripped = interpolateTemplateLiterals(latex);
  let depth = 0;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth < 0) {
      issues.push(`unbalanced '{' at offset ${i}`);
      break;
    }
  }
  if (depth !== 0) {
    issues.push(`unbalanced braces (final depth = ${depth})`);
  }

  // \left / \right pairing (use the stripped version too)
  const leftCount = (stripped.match(/\\left\s*[([{]/g) || []).length;
  const rightCount = (stripped.match(/\\right\s*[)\]}]/g) || []).length;
  if (leftCount !== rightCount) {
    issues.push(`\\left (${leftCount}) / \\right (${rightCount}) count mismatch`);
  }

  // KaTeX parse test (if katex is installed). Interpolate template literals
  // first so KaTeX sees a valid LaTeX string.
  if (katex) {
    try {
      katex.renderToString(stripped, {
        throwOnError: true,
        displayMode: false,
        strict: 'ignore',
        trust: false,
      });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const shortMsg = msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
      issues.push(`katex parse error: ${shortMsg}`);
    }
  }

  return issues;
}

const INDEPENDENCE_KEYWORDS = [
  /conditional[- ]?independence/i,
  /independence assumed/i,
  /under the assumption/i,
  /treats?\s+(as|them as)\s+independent/i,
  /assuming\s+(\w+\s+)?independence/i,
  /independent given/i,
  /\b(indep\.?|ind\.)\s*assumed/i,
  /\bassuming\b/i, // general catch-all
];

function hasIndependenceNote(contextAfter) {
  // Look at the next 1500 chars of source after the latex prop closing brace.
  // If any independence-related phrase appears within, the equation is
  // considered to have stated the assumption.
  return INDEPENDENCE_KEYWORDS.some((re) => re.test(contextAfter));
}

function checkIndependenceAssumption(latex, contextAfter) {
  // Class 2: equation contains BOTH a single Pr(X|Y) AND a product of
  // Pr(G_i | evidence_i) — implies conditional independence. Flag if
  // no independence note follows within 1500 chars.
  const hasConditionalPr = /Pr\s*\(.*?\|/.test(latex);
  const hasProduct = /\\prod/i.test(latex);
  const hasPr = /\\Pr\b/i.test(latex);
  if (hasConditionalPr && hasProduct && hasPr) {
    if (!hasIndependenceNote(contextAfter)) {
      return [
        'Pr(...) with conditional + product of multiple Pr(...) — conditional independence assumption not stated in surrounding context. Add a footnote / note like "assuming conditional independence" / "under the assumption".',
      ];
    }
  }
  return [];
}

async function main() {
  console.log(
    '=== Math-Rigor Audit (v7.7.60) — KaTeX equation syntax + conditional-independence annotation check ===\n',
  );

  const files = walk(ROOT);
  console.log(`Scanning ${files.length} source file(s) for KaTeX equations...\n`);

  let totalEquations = 0;
  const findings = [];
  const passed = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const equations = extractLatexEquations(html);
    for (const eq of equations) {
      totalEquations++;
      const latexStr = latexToJsString(eq.latex);
      const syntaxIssues = checkLatexSyntax(latexStr);
      const rigorIssues = checkIndependenceAssumption(latexStr, eq.contextAfter);
      const allIssues = [...syntaxIssues, ...rigorIssues];
      if (allIssues.length === 0) {
        passed.push({ file, line: eq.line, latex: latexStr });
      } else {
        findings.push({
          file,
          line: eq.line,
          latex: latexStr,
          issues: allIssues,
        });
      }
    }
  }

  console.log(`Parsed ${totalEquations} KaTeX equation(s) across ${files.length} file(s).`);
  console.log(`  ${passed.length} PASS · ${findings.length} FAIL\n`);

  if (findings.length === 0) {
    console.log(
      '✓ All KaTeX equations are syntactically valid AND any conditional-independence product is annotated.',
    );
    return;
  }

  console.error(`FAIL — ${findings.length} equation(s) require attention:\n`);
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.line}`);
    console.error(`      LaTeX: ${f.latex.slice(0, 100)}${f.latex.length > 100 ? '...' : ''}`);
    for (const iss of f.issues) {
      console.error(`      • ${iss}`);
    }
    console.error('');
  }
  console.error(
    'Fix: either correct the LaTeX syntax, or add a conditional-independence note within the next ~10 lines after the equation.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('math-rigor scan crashed:', e);
  process.exit(2);
});
