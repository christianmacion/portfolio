// scripts/build-llms-full.mjs — generate /llms-full.txt, a concatenated
// Markdown version of every public page for AI agents and crawlers.
//
// Output:
//   public/llms-full.txt  (copied to dist by astro build)
//
// Strategy:
//   For each page, fetch the rendered HTML from /dist/{path}/index.html,
//   strip scripts/styles/nav, and extract:
//     - the <main> element as markdown
//   Bundle all pages into a single Markdown file with H1 per page
//   and horizontal-rule separators.
//
// This is intentionally a "raw" markdown export — not a hand-curated
// summary. AI agents that want a quick index read llms.txt; agents that
// want the full content read llms-full.txt.
//
// Usage:
//   node scripts/build-llms-full.mjs           # build from dist/
//   astro build && node scripts/build-llms-full.mjs   # build then refresh

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const distDir = join(repoRoot, 'dist');
const outFile = join(repoRoot, 'public', 'llms-full.txt');

// Preferred reading order keeps the short, high-signal portfolio spine first.
// Any generated public route not listed here is appended in deterministic path order.
const PREFERRED_PAGES = [
  'index',
  'for-recruiters',
  'proof',
  'methodology',
  'now',
  'positions',
  'experience',
  'skills',
  'certifications',
  'publications',
  'projects',
  'solutions',
  'papers',
  'talks',
  'uses',
  'glossary',
  'reading',
  'about',
  'about-this-site',
  'colophon',
  'contact',
];

function discoverPages() {
  const pages = [];

  function walk(dir, routeParts = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('_')) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, [...routeParts, entry.name]);
        continue;
      }
      if (entry.name !== 'index.html') continue;
      const route = routeParts.length ? routeParts.join('/') : 'index';
      if (route === '404') continue;
      pages.push({ path: route, label: route });
    }
  }

  walk(distDir);
  const priority = new Map(PREFERRED_PAGES.map((route, index) => [route, index]));
  return pages.sort((a, b) => {
    const aRank = priority.get(a.path) ?? Number.MAX_SAFE_INTEGER;
    const bRank = priority.get(b.path) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank || a.path.localeCompare(b.path);
  });
}

// === HTML → text-only "markdown" converter (very lightweight) ===
// This is not a full HTML→MD converter. It just gives AI agents readable
// content: tags become headers, text content is preserved, scripts/styles
// are removed, links become [text](href).

function htmlToMd(html) {
  let s = html;

  // Strip <script>...</script> and <style>...</style> blocks
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');

  // Drop the entire <header class="nav"> and <footer> blocks (we already
  // covered those in llms.txt).
  s = s.replace(/<header\b[^>]*class="[^"]*nav[\s\S]*?<\/header>/gi, '');
  s = s.replace(/<footer\b[\s\S]*?<\/footer>/gi, '');

  // Keep <main> only
  const mainMatch = s.match(/<main\b[\s\S]*?<\/main>/i);
  if (mainMatch) s = mainMatch[0];
  else {
    // fallback: take <body>
    const bodyMatch = s.match(/<body\b[\s\S]*?<\/body>/i);
    if (bodyMatch) s = bodyMatch[0];
  }

  // Strip every tag except those we explicitly convert
  s = s.replace(/<(\/?)(h1|h2|h3|h4|h5|h6|p|li|ul|ol|blockquote|hr|br|code|pre|strong|em|b|i|u|sup|sub|small)\b[^>]*>/gi, (_, close, tag) => {
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (close) return '\n';
    return `\n\n<${tag}>`;
  });

  // Headings: prepend # count based on tag
  s = s.replace(/\n\n<h1>/g, '\n\n# ');
  s = s.replace(/\n\n<h2>/g, '\n\n## ');
  s = s.replace(/\n\n<h3>/g, '\n\n### ');
  s = s.replace(/\n\n<h4>/g, '\n\n#### ');
  s = s.replace(/\n\n<h5>/g, '\n\n##### ');
  s = s.replace(/\n\n<h6>/g, '\n\n###### ');

  // Drop <a> but keep inner text and href
  s = s.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = text.replace(/<[^>]+>/g, '').trim();
    return t ? `[${t}](${href})` : href;
  });

  // Drop <img> alt text as italic
  s = s.replace(/<img\b[^>]*alt="([^"]+)"[^>]*\/?>/gi, (_, alt) => ` _(${alt})_ `);
  s = s.replace(/<img\b[^>]*\/?>/gi, '');

  // Drop remaining tags (svg, g, path, defs, etc.)
  s = s.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™');

  // Collapse blank lines: 3+ → 2
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

function extractPageTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return null;
  // Strip the " · Christian T. Macion, CTA®" trailer that BaseLayout always adds.
  return m[1]
    .replace(/\s+·\s+Christian T\. Macion,?\s*CTA®?$/, '')
    .replace(/\s+·\s+Christian T\. Macion,?\s*CTA®?$/, '')
    .trim();
}

function extractDescription(html) {
  const m = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  return m ? m[1] : '';
}

function main() {
  if (!existsSync(distDir)) {
    console.error(`[build-llms-full] dist directory not found at ${distDir}. Run \`astro build\` first.`);
    process.exit(1);
  }

  const lines = [
    '# Christian T. Macion — Portfolio (llms-full.txt)',
    '',
    '> Concatenated Markdown export of every public page on the portfolio. This file',
    '> is a complement to [/llms.txt](/llms.txt) — the short index. Agents that want',
    '> the full text content should read this file. Each section is one page, in',
    '> canonical reading order, separated by `---`.',
    '',
    `> Build: ${process.env.BUILD_DATE ?? 'build-time'}. Regenerated on every deploy. Generated by \`scripts/build-llms-full.mjs\`.`,
    '',
    '---',
  ];

  const pages = discoverPages();
  let pageCount = 0;
  for (const page of pages) {
    // Home page is at dist/index.html (Astro's special case).
    const htmlPath =
      page.path === 'index'
        ? join(distDir, 'index.html')
        : join(distDir, page.path, 'index.html');
    if (!existsSync(htmlPath)) {
      console.warn(`[build-llms-full] skip: ${htmlPath} not found`);
      continue;
    }
    const html = readFileSync(htmlPath, 'utf8');
    const desc = extractDescription(html);
    const title = extractPageTitle(html) || page.label;
    const md = htmlToMd(html);

    if (!md || md.length < 30) {
      console.warn(`[build-llms-full] skip: ${page.path} produced no content`);
      continue;
    }

    lines.push('');
    lines.push(`# ${title}`);
    if (desc) {
      lines.push('');
      lines.push(`> ${desc}`);
    }
    lines.push('');
    lines.push(`Source: \`${page.path === 'index' ? '/' : `/${page.path}/`}\``);
    lines.push('');
    lines.push(md);
    lines.push('');
    lines.push('---');

    pageCount += 1;
  }

  const out = lines.join('\n') + '\n';
  writeFileSync(outFile, out, 'utf8');
  console.log(`[build-llms-full] wrote ${pageCount} pages, ${out.length} bytes to ${outFile}`);

  // Also project per-page content into sub-paths if a /projects/quant/01-... page exists
  // (not enumerated above; agents can fetch those directly).
}

main();
