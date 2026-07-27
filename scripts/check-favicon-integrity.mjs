// check-favicon-integrity.mjs — v7.7.22 FAVICON-INTEGRITY CI GATE
//
// Catches malformed <link rel="icon"> and <link rel="apple-touch-icon">
// tags before ship. A favicon 404 in the browser console is a "looks broken"
// surface signal — every recruiter / hiring manager who opens the site in
// a new tab sees the broken-favicon icon in the tab strip if it 404s.
//
// Companion gates:
//   - scripts/check-meta-integrity.mjs (v7.7.14)  — <title> + <meta description>
//   - scripts/check-og-integrity.mjs (v7.7.18)    — OG + Twitter Card
//   - scripts/check-canonical-url-integrity.mjs (v7.7.20) — canonical
//
// Rules enforced (per dist/**/index.html):
//   1. <link rel="icon"> MUST be present (any type)
//   2. <link rel="apple-touch-icon"> MUST be present (iOS bookmarks)
//   3. favicon href MUST resolve to a real file in dist/
//   4. apple-touch-icon href MUST resolve to a real file in dist/
//   5. favicon MIME type (if specified via "type=") MUST be valid
//      (image/svg+xml, image/png, image/x-icon, image/webp, image/vnd.microsoft.icon)
//   6. apple-touch-icon "sizes" (if specified) MUST be a valid dimension
//      pattern (NxN or NxM where N,M are integers ≥ 16)
//   7. For PNG / ICO favicons, the size attribute (if present) MUST be
//      achievable (16, 32, 48, 64, 96, 128, 192, 256, 512)
//   8. href MUST be a relative / absolute path (no http(s) to external hosts)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after hreflang:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';

// Valid image MIME types for favicons (per WHATWG + browser reality).
const VALID_FAVICON_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/gif',
  'image/ico',
]);

// Standard favicon sizes (per browser reality + manifest spec).
const STANDARD_SIZES = new Set([
  16, 24, 32, 48, 64, 72, 96, 120, 128, 144, 152, 167, 180, 192, 196, 256, 512,
]);

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'data' || (e.name.startsWith('_') && e.isDirectory())) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Build a Set of known asset paths (relative to dist/), including _astro/*
// (hashed CSS/JS) and the root-level files like favicon.ico.
async function buildKnownAssets() {
  const assets = new Set();
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'data') continue;
      const full = join(dir, e.name);
      const childPrefix = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, childPrefix);
        assets.add(childPrefix); // directory itself
      } else {
        assets.add(childPrefix);
      }
    }
  }
  await walk(DIST, '');
  return assets;
}

// Backref-aware regex for extracting <link> tags. We accept any attribute order:
// rel-then-href, href-then-rel, sizes-then-type-then-href, etc.
function extractLinkTags(html, relValue) {
  // Match the whole <link ... rel="<relValue>" ...> tag (any attribute order)
  const re = new RegExp(
    `<link\\s+([^>]*?\\brel\\s*=\\s*(["'])${relValue}\\2[^>]*?|\\bhref\\s*=\\s*(["'])[^"']+\\3[^>]*?\\brel\\s*=\\s*(["'])${relValue}\\4[^>]*?)>`,
    'gi',
  );
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    // Extract href
    const hrefMatch = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(attrs);
    const href = hrefMatch ? hrefMatch[2] : null;
    // Extract type
    const typeMatch = /\btype\s*=\s*(["'])([^"']+)\1/i.exec(attrs);
    const type = typeMatch ? typeMatch[2] : null;
    // Extract sizes
    const sizesMatch = /\bsizes\s*=\s*(["'])([^"']+)\1/i.exec(attrs);
    const sizes = sizesMatch ? sizesMatch[2] : null;
    out.push({ href, type, sizes });
  }
  return out;
}

function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// Resolve a favicon href against the current route. Same dual-build logic
// as check-link-target-validity: tolerate /portfolio/ prefix for GH build.
function resolveAssetPath(href, knownAssets) {
  if (!href) return null;
  // External? Skip — favicons should be local
  if (/^https?:\/\//i.test(href)) return 'external';

  // Strip query / fragment
  const qIdx = href.indexOf('?');
  const cleanPath = qIdx >= 0 ? href.slice(0, qIdx) : href;
  const hashIdx = cleanPath.indexOf('#');
  const cleanPathNoHash = hashIdx >= 0 ? cleanPath.slice(0, hashIdx) : cleanPath;

  let resolved = cleanPathNoHash.replace(/^\/+/, '');
  // Strip /portfolio/ prefix (GH build tolerance)
  resolved = resolved.replace(/^portfolio\//, '');

  if (knownAssets.has(resolved)) return resolved;
  // Try with leading /portfolio/ added (mirror → GH direction)
  if (knownAssets.has(`portfolio/${resolved}`)) return `portfolio/${resolved}`;
  return null;
}

function auditRoute(distRelPath, html, knownAssets) {
  const issues = [];
  const scan = stripScripts(html);
  const iconLinks = extractLinkTags(scan, 'icon');
  const appleTouchLinks = extractLinkTags(scan, 'apple-touch-icon');
  const maskIconLinks = extractLinkTags(scan, 'mask-icon');

  // Rule 1 — <link rel="icon"> must exist
  if (iconLinks.length === 0) {
    issues.push({
      rule: 'missing-icon-link',
      msg: `<link rel="icon"> missing on ${distRelPath}`,
    });
  }

  // Rule 2 — <link rel="apple-touch-icon"> must exist
  if (appleTouchLinks.length === 0) {
    issues.push({
      rule: 'missing-apple-touch-icon',
      msg: `<link rel="apple-touch-icon"> missing on ${distRelPath}`,
    });
  }

  // Rule 3, 4, 8 — favicon hrefs must resolve to real local assets
  for (const link of iconLinks) {
    if (!link.href) {
      issues.push({
        rule: 'icon-no-href',
        msg: `<link rel="icon"> on ${distRelPath} has no href`,
      });
      continue;
    }
    const resolved = resolveAssetPath(link.href, knownAssets);
    if (resolved === 'external') {
      issues.push({
        rule: 'icon-external-href',
        msg: `<link rel="icon" href="${link.href}" on ${distRelPath} points to external URL (must be local)`,
      });
      continue;
    }
    if (resolved === null) {
      issues.push({
        rule: 'icon-href-not-found',
        msg: `<link rel="icon" href="${link.href}" on ${distRelPath} does not resolve to a real file in dist/`,
      });
    }

    // Rule 5 — favicon MIME type
    if (link.type && !VALID_FAVICON_TYPES.has(link.type.toLowerCase())) {
      issues.push({
        rule: 'icon-bad-mime',
        msg: `<link rel="icon" type="${link.type}" on ${distRelPath} is not a valid favicon MIME type`,
      });
    }

    // Rule 6, 7 — favicon sizes
    if (link.sizes) {
      // sizes can be "NxN", "NxM", or "any"
      if (link.sizes.toLowerCase() === 'any') {
        // OK — usually paired with SVG
      } else {
        const dimMatch = /^(\d+)x(\d+)$/.exec(link.sizes);
        if (!dimMatch) {
          issues.push({
            rule: 'icon-bad-sizes',
            msg: `<link rel="icon" sizes="${link.sizes}" on ${distRelPath} is not a valid "NxN" or "NxM" pattern`,
          });
        } else {
          const w = Number(dimMatch[1]);
          const h = Number(dimMatch[2]);
          if (w < 16 || h < 16) {
            issues.push({
              rule: 'icon-size-too-small',
              msg: `<link rel="icon" sizes="${link.sizes}" on ${distRelPath} has dimensions < 16px`,
            });
          }
          // For PNG/ICO icons, both dims should be in STANDARD_SIZES
          if (link.type && (link.type.includes('png') || link.type.includes('ico') || link.type.includes('icon'))) {
            if (!STANDARD_SIZES.has(w) || !STANDARD_SIZES.has(h)) {
              issues.push({
                rule: 'icon-nonstandard-size',
                msg: `<link rel="icon" sizes="${link.sizes}" on ${distRelPath} is not a standard favicon size`,
              });
            }
          }
        }
      }
    }
  }

  // Rule for apple-touch-icon: href must resolve, sizes must be square ≥ 16
  for (const link of appleTouchLinks) {
    if (!link.href) {
      issues.push({
        rule: 'apple-touch-icon-no-href',
        msg: `<link rel="apple-touch-icon"> on ${distRelPath} has no href`,
      });
      continue;
    }
    const resolved = resolveAssetPath(link.href, knownAssets);
    if (resolved === 'external') {
      issues.push({
        rule: 'apple-touch-icon-external-href',
        msg: `<link rel="apple-touch-icon" href="${link.href}" on ${distRelPath} points to external URL`,
      });
      continue;
    }
    if (resolved === null) {
      issues.push({
        rule: 'apple-touch-icon-href-not-found',
        msg: `<link rel="apple-touch-icon" href="${link.href}" on ${distRelPath} does not resolve to a real file in dist/`,
      });
    }

    // Apple-touch-icon must have sizes
    if (!link.sizes) {
      issues.push({
        rule: 'apple-touch-icon-no-sizes',
        msg: `<link rel="apple-touch-icon" on ${distRelPath} is missing sizes attribute`,
      });
    } else {
      const dimMatch = /^(\d+)x(\d+)$/.exec(link.sizes);
      if (!dimMatch || dimMatch[1] !== dimMatch[2]) {
        issues.push({
          rule: 'apple-touch-icon-not-square',
          msg: `<link rel="apple-touch-icon" sizes="${link.sizes}" on ${distRelPath} must be NxN (square)`,
        });
      } else if (Number(dimMatch[1]) < 180) {
        // Apple HIG: 180x180 is the minimum for iOS
        issues.push({
          rule: 'apple-touch-icon-too-small',
          msg: `<link rel="apple-touch-icon" sizes="${link.sizes}" on ${distRelPath} is below the iOS 180x180 minimum`,
        });
      }
    }
  }

  // mask-icon is optional but if present must resolve
  for (const link of maskIconLinks) {
    if (!link.href) continue;
    const resolved = resolveAssetPath(link.href, knownAssets);
    if (resolved === null) {
      issues.push({
        rule: 'mask-icon-href-not-found',
        msg: `<link rel="mask-icon" href="${link.href}" on ${distRelPath} does not resolve to a real file in dist/`,
      });
    }
  }

  return {
    route: distRelPath,
    iconCount: iconLinks.length,
    appleCount: appleTouchLinks.length,
    issues,
  };
}

async function main() {
  console.log(
    '=== Favicon-Integrity Audit (v7.7.22) — favicon + apple-touch-icon + mask-icon ===\n',
  );

  const knownAssets = await buildKnownAssets();
  console.log(`Known assets: ${knownAssets.size}\n`);

  const findings = [];
  for await (const f of walk(DIST)) {
    if (!f.endsWith('index.html')) continue;
    const rel = f.slice(DIST.length + 1);
    const html = await readFile(f, 'utf8');
    findings.push(auditRoute(rel, html, knownAssets));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);

  console.log(
    `Scanned ${findings.length} route(s) · ${totalIssues} issue(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    console.log(`✓ All favicons + apple-touch-icons present, valid MIME types, real local assets.`);
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
    `\nFAIL — ${totalIssues} favicon integrity issue(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('favicon-integrity scan crashed:', e);
  process.exit(2);
});