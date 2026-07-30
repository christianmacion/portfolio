#!/usr/bin/env node
// scripts/check-autocomplete-token-validity.mjs
// v7.7.80 — 84th CI gate
// Catches the WCAG 1.3.5 (Identify Input Purpose, Level AA) conformance
// bug class:
// every <input> with an autocomplete attribute MUST use a value from the
// WHATWG/HTML spec-defined token set. Values outside the set are silently
// ignored by browsers, breaking autofill behavior.
//
// Reference: WHATWG HTML Living Standard §4.10.18.7 Autofilling form
//   controls: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofilling-form-controls
// Reference: WCAG 1.3.5 https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose
//
// Token grammar (simplified):
//   autocomplete = <tokens>
//   tokens       = token *(SP token)
//   token        = optional-section *(SP optional-token)
//                 / autofill-field [SP optgroup-type]
//   autofill-field = "name" | "honorific-prefix" | "given-name" |
//                    "additional-name" | "family-name" | "honorific-suffix" |
//                    "nickname" | "email" | "username" | "new-password" |
//                    "current-password" | "one-time-code" |
//                    "organization-title" | "organization" |
//                    "address-line1" | "address-line2" | "address-line3" |
//                    "address-level1" | "address-level2" | "address-level3" |
//                    "address-level4" | "country" | "country-name" |
//                    "postal-code" | "cc-name" | "cc-given-name" |
//                    "cc-additional-name" | "cc-family-name" |
//                    "cc-number" | "cc-exp" | "cc-exp-month" | "cc-exp-year" |
//                    "cc-csc" | "cc-type" | "transaction-currency" |
//                    "transaction-amount" | "language" | "bday" |
//                    "bday-day" | "bday-month" | "bday-year" | "sex" |
//                    "url" | "photo" | "tel" | "tel-country-code" |
//                    "tel-national" | "tel-area-code" | "tel-local" |
//                    "tel-local-prefix" | "tel-local-suffix" |
//                    "tel-extension" | "impp" | "contact-type" |
//                    "shipping" | "billing" | "home" | "work" | "mobile" |
//                    "fax" | "pager" | "off"
//
// Optional-section is "shipping" / "billing"; the remaining tokens are
// optional-token qualifiers.
//
// For practical purposes, this gate validates that EACH TOKEN is in the
// known token set (treating the value as a space-separated list).
//
// Comment-strip handles JS/HTML/Astro comment false positives.
//
// Mutation harness:
//   - M1: inject `<input autocomplete="bogus-token">` → caught.
//   - M2: inject `<input autocomplete="email">` → pass.
//   - M3: inject `<input autocomplete="shipping postal-code">` → pass.
//
// Usage: node scripts/check-autocomplete-token-validity.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

function stripComments(html) {
  return html
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (SCAN_EXT.has(full.slice(full.lastIndexOf('.')))) files.push(full);
  }
  return files;
}

// WHATWG autocomplete token set (canonical + section qualifiers).
const AUTOCOMPLETE_TOKENS = new Set([
  // autofill-field tokens
  'name',
  'honorific-prefix',
  'given-name',
  'additional-name',
  'family-name',
  'honorific-suffix',
  'nickname',
  'email',
  'username',
  'new-password',
  'current-password',
  'one-time-code',
  'organization-title',
  'organization',
  'address-line1',
  'address-line2',
  'address-line3',
  'address-level1',
  'address-level2',
  'address-level3',
  'address-level4',
  'country',
  'country-name',
  'postal-code',
  'cc-name',
  'cc-given-name',
  'cc-additional-name',
  'cc-family-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
  'transaction-currency',
  'transaction-amount',
  'language',
  'bday',
  'bday-day',
  'bday-month',
  'bday-year',
  'sex',
  'url',
  'photo',
  'tel',
  'tel-country-code',
  'tel-national',
  'tel-area-code',
  'tel-local',
  'tel-local-prefix',
  'tel-local-suffix',
  'tel-extension',
  'impp',
  'contact-type',
  // section qualifiers
  'shipping',
  'billing',
  // contact-type qualifiers
  'home',
  'work',
  'mobile',
  'fax',
  'pager',
  // off (special — disables autofill)
  'off',
]);

function findInvalidTokens(html, file) {
  const findings = [];
  // Find every <input ... autocomplete="..."> ...>
  const re = /<input\b([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const acMatch = /\bautocomplete\s*=\s*(?:"([^"]+)"|'([^']+)'|\{([^}]+)\})/i.exec(attrs);
    if (!acMatch) continue;
    const raw = (acMatch[1] || acMatch[2] || acMatch[3] || '').trim();
    if (!raw) continue;
    // Split into tokens (space-separated).
    const tokens = raw.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      // Token must be lowercase per spec; reject mixed-case to catch typos.
      if (t !== t.toLowerCase()) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          token: t,
          reason: `autocomplete token "${t}" has uppercase characters (spec requires lowercase)`,
        });
        continue;
      }
      if (!AUTOCOMPLETE_TOKENS.has(t)) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          token: t,
          reason: `autocomplete token "${t}" is not in the WHATWG token set`,
        });
      }
    }
  }
  return findings;
}

async function main() {
  console.log(
    '=== Autocomplete-Token-Validity Audit (v7.7.80) — WCAG 1.3.5 Identify Input Purpose ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findInvalidTokens(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} invalid-autocomplete-token violation(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every <input autocomplete="..."> uses a valid WHATWG token (or has no autocomplete attribute).',
    );
    return;
  }

  console.error(`FAIL — ${allFindings.length} invalid-autocomplete-token violation(s):\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  — ${f.reason}`);
  }
  console.error(
    '\nFix: use a valid WHATWG autocomplete token (e.g., "email", "name", "tel", "current-password", "shipping postal-code"). Tokens are case-sensitive and must be lowercase.',
  );
  console.error(
    'Reference: WCAG 1.3.5 https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('autocomplete-token-validity scan crashed:', e);
  process.exit(2);
});
