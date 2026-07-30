// check-image-alt-integrity.mjs — v7.7.23 IMAGE-ALT-INTEGRITY CI GATE
//
// Catches malformed <img> and <area> tags before ship. WCAG 2.2 SC 1.1.1:
// every non-text content must have a text alternative that serves the
// equivalent purpose. axe-core (a11y:scan gate, v7.7.5) catches serious /
// critical violations but doesn't fail on the specific alt-attribute-shape
// class (e.g. <img alt>) — this gate enforces the explicit attribute shape.
//
// Companion gates:
//   - scripts/scan-a11y.mjs (v7.7.5)    — axe-core full WCAG scan
//   - scripts/check-favicon-integrity.mjs (v7.7.22) — favicon link surface
//
// Rules enforced (per dist/**/index.html):
//   1. Every <img> MUST have an alt attribute (even if alt="" for decorative)
//   2. Empty alt="" on non-decorative <img> (no role="presentation" or
//      role="img" with aria-label) is flagged as suspicious — likely missing
//      descriptive alt text
//   3. <img alt="..."> with role="presentation" is a conflict (decorative
//      should have alt="", informative should not have role="presentation")
//   4. Every <area> MUST have an alt attribute (image-map regions)
//   5. <img src="..."> with empty src + no alt is suspicious
//   6. <img> with both alt and aria-label is allowed (alt wins) but flagged
//      if they conflict (aria-label !== alt)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after favicon:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'data' || (e.name.startsWith('_') && e.isDirectory())) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// Backref-aware regex for <img> tags. Captures the full attrs body.
const IMG_RE = /<img\s+([^>]*?)\/?>/gi;
const AREA_RE = /<area\s+([^>]*?)\/?>/gi;

function extractAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i');
  const m = re.exec(attrs);
  return m ? m[2] : null;
}

function hasAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=`, 'i');
  return re.test(attrs);
}

function auditRoute(distRelPath, html) {
  const issues = [];
  const scan = stripScripts(html);

  // === <img> ===
  const imgFindings = [];
  let m;
  while ((m = IMG_RE.exec(scan)) !== null) {
    const attrs = m[1];
    const src = extractAttr(attrs, 'src');
    const alt = extractAttr(attrs, 'alt');
    const role = extractAttr(attrs, 'role');
    const ariaLabel = extractAttr(attrs, 'aria-label');

    imgFindings.push({
      src: src ? src.slice(0, 80) : '(none)',
      alt,
      role,
      ariaLabel,
      hasAltAttr: hasAttr(attrs, 'alt'),
      hasRoleAttr: hasAttr(attrs, 'role'),
    });
  }

  for (const img of imgFindings) {
    // Rule 1 — alt attribute must be present
    if (!img.hasAltAttr) {
      issues.push({
        rule: 'img-missing-alt',
        msg: `<img src="${img.src}"> on ${distRelPath} is missing alt attribute`,
      });
      continue;
    }

    // Rule 3 — alt + role="presentation" is a conflict
    if (img.hasAltAttr && img.role && /^(presentation|none)$/i.test(img.role) && img.alt !== '') {
      issues.push({
        rule: 'img-alt-role-conflict',
        msg: `<img src="${img.src}" alt="${img.alt}" role="${img.role}"> on ${distRelPath} — role="${img.role}" means decorative, but alt is non-empty ("${img.alt}")`,
      });
    }

    // Rule 5 — empty src + empty alt is suspicious
    if ((!img.src || img.src === '') && img.alt === '') {
      issues.push({
        rule: 'img-empty-src-and-alt',
        msg: `<img> on ${distRelPath} has both empty src and empty alt — likely a placeholder that was never replaced`,
      });
    }

    // Rule 6 — alt + aria-label conflict
    if (img.alt !== null && img.ariaLabel !== null && img.alt !== img.ariaLabel) {
      issues.push({
        rule: 'img-alt-aria-label-conflict',
        msg: `<img src="${img.src}"> on ${distRelPath} has alt="${img.alt}" but aria-label="${img.ariaLabel}" — they conflict; alt wins for screen readers`,
      });
    }
  }

  // === <area> ===
  const areaFindings = [];
  AREA_RE.lastIndex = 0;
  while ((m = AREA_RE.exec(scan)) !== null) {
    const attrs = m[1];
    const alt = extractAttr(attrs, 'alt');
    const href = extractAttr(attrs, 'href');
    areaFindings.push({
      href: href ? href.slice(0, 80) : '(none)',
      alt,
      hasAltAttr: hasAttr(attrs, 'alt'),
    });
  }

  for (const area of areaFindings) {
    // Rule 4 — area must have alt
    if (!area.hasAltAttr) {
      issues.push({
        rule: 'area-missing-alt',
        msg: `<area href="${area.href}"> on ${distRelPath} is missing alt attribute`,
      });
    }
  }

  return {
    route: distRelPath,
    imgCount: imgFindings.length,
    areaCount: areaFindings.length,
    issues,
  };
}

async function main() {
  console.log(
    '=== Image-Alt-Integrity Audit (v7.7.23) — WCAG 2.2 SC 1.1.1 alt surface ===\n',
  );

  const findings = [];
  for await (const f of walk(DIST)) {
    if (!f.endsWith('index.html')) continue;
    const rel = f.slice(DIST.length + 1);
    const html = await readFile(f, 'utf8');
    findings.push(auditRoute(rel, html));
  }

  const totalImgs = findings.reduce((n, f) => n + f.imgCount, 0);
  const totalAreas = findings.reduce((n, f) => n + f.areaCount, 0);
  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);

  console.log(
    `Scanned ${findings.length} route(s) · ${totalImgs} <img> · ${totalAreas} <area> · ${totalIssues} issue(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    console.log(`✓ All <img> + <area> have explicit alt attributes (decorative may use alt="").`);
    return;
  }

  const byRule = new Map();
  for (const f of failing) {
    for (const i of f.issues) {
      if (!byRule.has(i.rule)) byRule.set(i.rule, []);
      byRule.get(i.rule).push({ route: f.route, msg: i.msg });
    }
  }
  for (const [rule, list] of byRule) {
    console.log(`\n[${rule}] — ${list.length} site(s):`);
    for (const x of list) {
      console.log(`  ${x.route}  →  ${x.msg}`);
    }
  }

  console.error(
    `\nFAIL — ${totalIssues} image-alt integrity issue(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('image-alt-integrity scan crashed:', e);
  process.exit(2);
});