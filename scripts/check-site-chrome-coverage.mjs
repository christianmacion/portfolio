// check-site-chrome-coverage.mjs — v7.7.45 SITE-CHROME-COVERAGE CI GATE
//
// Validates that every dist/*.html page includes the three landmark
// navigation elements: <header>, <nav>, <footer>.
//
// Why this matters: HTML5 landmarks give screen-reader users a quick way to
// navigate by region. Without <header>/<nav>/<footer>, a user visiting a
// page has no way to know there's site-wide navigation or how to get back
// to the home page. Beyond a11y, missing footer also breaks the link graph
// audit (v7.7.x internal-link-graph gate) because footer links are how the
// rest of the site gets discovered.
//
// Rules enforced:
//   1. page-without-header  — every dist/*.html MUST contain a <header> element
//   2. page-without-nav     — every dist/*.html MUST contain a <nav> element
//   3. page-without-footer  — every dist/*.html MUST contain a <footer> element
//
// Skip rules:
//   - `/workbooks/*` paths — these are hand-authored print-PDF HTMLs
//     (designed for export, not web view). They intentionally lack the
//     standard site chrome because adding it would break the print layout.
//     The corresponding PDF at `/workbooks/<slug>/index.pdf` is the
//     canonical artifact; the HTML is a print-template sibling.
//
// Exits 1 on any fail. Exits 0 otherwise.

import { readFileSync, readdirSync } from 'node:fs';

const DIST = 'dist';

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

function hasElement(html, tag) {
  // Element opening tag — match `<tag` at start or after whitespace
  // Use a generic tag boundary check to avoid false positives inside attributes
  const re = new RegExp(`<${tag}\\b[\\s>]`, 'i');
  return re.test(html);
}

function audit() {
  const issues = [];
  let totalPages = 0;
  let pagesWithHeader = 0;
  let pagesWithNav = 0;
  let pagesWithFooter = 0;
  let pagesWithoutHeader = 0;
  let pagesWithoutNav = 0;
  let pagesWithoutFooter = 0;

  for (const f of walk(DIST)) {
    // Skip workbook print-PDF HTMLs — see skip rules comment above
    if (f.includes('/workbooks/')) continue;

    const html = readFileSync(f, 'utf8');
    totalPages++;

    const hasHeader = hasElement(html, 'header');
    const hasNav = hasElement(html, 'nav');
    const hasFooter = hasElement(html, 'footer');

    if (hasHeader) pagesWithHeader++;
    else {
      pagesWithoutHeader++;
      issues.push({
        rule: 'page-without-header',
        msg: `${f} — page has NO <header> element (screen-reader users have no region to jump to for site nav, breaking Landmarks navigation pattern)`,
      });
    }

    if (hasNav) pagesWithNav++;
    else {
      pagesWithoutNav++;
      issues.push({
        rule: 'page-without-nav',
        msg: `${f} — page has NO <nav> element (no explicit site-navigation landmark — visitors may not know how to leave this page)`,
      });
    }

    if (hasFooter) pagesWithFooter++;
    else {
      pagesWithoutFooter++;
      issues.push({
        rule: 'page-without-footer',
        msg: `${f} — page has NO <footer> element (no footer landmark + no site-wide link back to home/about, breaking internal-link-graph discovery)`,
      });
    }
  }

  return {
    issues,
    totalPages,
    pagesWithHeader,
    pagesWithNav,
    pagesWithFooter,
    pagesWithoutHeader,
    pagesWithoutNav,
    pagesWithoutFooter,
  };
}

function main() {
  console.log('=== Site-Chrome-Coverage Audit (v7.7.45) — every dist/*.html page must have <header> + <nav> + <footer> landmarks ===\n');

  const {
    issues,
    totalPages,
    pagesWithHeader,
    pagesWithNav,
    pagesWithFooter,
    pagesWithoutHeader,
    pagesWithoutNav,
    pagesWithoutFooter,
  } = audit();

  console.log(
    `Scanned ${totalPages} HTML page(s) · ${pagesWithHeader} with <header> · ${pagesWithNav} with <nav> · ${pagesWithFooter} with <footer> · ${pagesWithoutHeader} WITHOUT header · ${pagesWithoutNav} WITHOUT nav · ${pagesWithoutFooter} WITHOUT footer · ${issues.length} issue(s)\n`
  );

  if (issues.length === 0) {
    console.log(`✓ All ${totalPages} HTML page(s) have <header> + <nav> + <footer> landmarks (screen-reader Landmarks navigation works).`);
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs.slice(0, 8)) console.log(`  ${m}`);
    if (msgs.length > 8) console.log(`  ... and ${msgs.length - 8} more`);
  }

  console.error(`\nFAIL — ${issues.length} site-chrome issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('site-chrome-coverage scan crashed:', e);
  process.exit(2);
}
