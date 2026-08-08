/**
 * nda-audit.ts — build-time NDA guardrail.
 *
 * Walks the built `dist/` directory and fails the build if any NDA-prohibited
 * content slips into public-facing HTML or PDFs.
 *
 * Run:
 *   npx tsx src/utils/nda-audit.ts
 *
 * Or invoke from CI: `npm run nda-audit`
 *
 * The audit enforces:
 *   1. No "Davao City" (must be "Digos City, Davao del Sur")
 *   2. No "Present"/"currently" tied to 19V Capital
 *   3. No fund rename ("Alpha Apex", "Alpha Apex Quant")
 *   4. No proprietary data sources (Polymarket, Kalshi, NOAA, USDA)
 *   5. No Quantivo / CallRank AI specifics
 *   6. No raw per-strategy t-stats/Sharpe/bps in user-facing copy
 *   7. No "19V Capital" or "19V" employer-name leak in resume PDFs (defensive)
 *   8. No PM-by-name disclosure ("Evan Ferioli" etc.) in resume PDFs or humans.md (defensive)
 *   9. No past-employer name leak ("Arclion AI") in resume PDFs or humans.md (defensive)
 *
 * Rules 7–9 are narrowly scoped to the file types whose source content has
 * already been redacted (PDF resumes + humans.md). They catch future
 * re-introduction in those specific artifacts; broader coverage of
 * `src/content/experience/*.md` and similar is a separate task and is
 * deliberately NOT enforced by this audit (see memory: portfolio-positioning-level).
 *
 * Exits 0 if clean, 1 with a violation report otherwise.
 */

import { spawnSync } from 'node:child_process';

import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIST = join(__dirname, '..', '..', 'dist');

interface Rule {
  id: string;
  label: string;
  pattern: RegExp;
  exceptionPattern?: RegExp;
  scope: 'content' | 'meta'; // 'content' = all text, 'meta' = allow in <meta> tags only
  // Restrict a rule to specific file types within dist/. Default 'all' = scan every
  // walked file. Use 'pdf' for resume-only rules, 'pdf-and-humans' for rules that
  // cover both the resume PDFs and the humans.md agent-index file.
  fileScope?: 'all' | 'pdf' | 'pdf-and-humans';
}

const RULES: Rule[] = [
  {
    id: 'location-wrong-city',
    label: 'Location must be "Digos City", not "Davao City"',
    pattern: /\bDavao City\b/gi,
    scope: 'content',
  },
  {
    id: 'present-19v',
    label: 'Never claim "Present" employment at 19V Capital',
    pattern:
      /\b(?:Present|Currently|presently|currently)\b[^.]*?19V|19V[^.]*?(?:Present|Currently|presently|currently)\b/gi,
    exceptionPattern: /closed past contract|03\/2026\s*[–-]\s*06\/2026/i,
    scope: 'content',
  },
  {
    id: 'fund-rename',
    label: 'No fund rename disclosure ("Alpha Apex", "Alpha Apex Quant")',
    pattern: /\bAlpha Apex(?:\s+Quant)?\b/gi,
    scope: 'content',
  },
  {
    id: 'proprietary-data-sources',
    label: 'No proprietary data sources referenced (Polymarket, Kalshi, NOAA, USDA)',
    pattern: /\b(?:Polymarket|Kalshi|NOAA|USDA)\b/g,
    scope: 'content',
    // v6.11 — GDELT 2.0 (Global Database of Events, Language, and Tone)
    // is a public-domain event monitor from Yahoo Research / Georgetown.
    // It's NOT in the proprietary-data-sources ban list. We do not
    // render raw GDELT SOURCEURL fields; the gdelt-bucket.ts mapper
    // hardcodes `source: 'GDELT event monitor'` for safety.
  },
  {
    id: 'quantivo-mention',
    label: 'No Quantivo specifics',
    pattern: /\bQuantivo\b/gi,
    scope: 'content',
  },
  {
    id: 'callrank-mention',
    label: 'No CallRank AI specifics',
    pattern: /\bCallRank\b/gi,
    scope: 'content',
  },
  {
    id: '19v-past-pdf-mention',
    label: 'No "19V Capital" or "19V" employer-name leak anywhere in dist/',
    pattern: /\b19V(?:\s+Capital)?\b/g,
    scope: 'content',
    fileScope: 'all',
  },
  {
    id: 'pm-name-disclosure',
    label: 'No PM-by-name disclosure ("Evan Ferioli" etc.) anywhere in dist/',
    pattern: /\bEvan\s+Ferioli\b/gi,
    scope: 'content',
    fileScope: 'all',
  },
  {
    id: 'past-employer-name-leak',
    label: 'No past-employer name leak ("Arclion AI") anywhere in dist/',
    pattern: /\bArclion(?:\s+AI)?\b/gi,
    scope: 'content',
    fileScope: 'all',
  },
];

interface Violation {
  rule: string;
  file: string;
  match: string;
  excerpt: string;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (['.html', '.pdf', '.txt', '.md', '.mdx'].includes(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function stripMetaTags(html: string): string {
  // Allow meta descriptions to mention Digos City for SEO without false-positive
  return html.replace(/<meta[^>]*>/gi, '').replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '');
}

/**
 * Decide whether a given file should be checked against a rule with a
 * particular fileScope. A rule with `fileScope: 'pdf'` only applies to
 * resume PDFs in dist/. A rule with `fileScope: 'pdf-and-humans'` applies
 * to resume PDFs and to the humans.md agent-index file. `fileScope: 'all'`
 * (the default) applies to every walked file.
 */
function fileMatchesScope(file: string, scope: Rule['fileScope']): boolean {
  if (!scope || scope === 'all') return true;
  const ext = extname(file);
  const name = basename(file);
  if (scope === 'pdf') return ext === '.pdf';
  if (scope === 'pdf-and-humans') {
    return ext === '.pdf' || name === 'humans.md';
  }
  return true;
}

function extractPdfText(pdfPath: string): string {
  // Uses poppler's `pdftotext` if available; falls back to empty string.
  // If pdftotext is missing, PDFs are silently skipped (not silently passed).
  const r = spawnSync('pdftotext', ['-q', pdfPath, '-'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout;
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.warn(`[nda-audit] warn: pdftotext not found. skipping ${pdfPath}`);
    return '';
  }
  return r.stdout || '';
}

async function audit(): Promise<number> {
  console.log(`[nda-audit] scanning ${DIST} ...`);
  const files = await walk(DIST);
  const violations: Violation[] = [];

  for (const file of files) {
    const ext = extname(file);
    let content: string;
    if (ext === '.pdf') {
      // Extract text via pdftotext so the same rules apply to PDF resumes too.
      content = extractPdfText(file);
    } else {
      try {
        content = await readFile(file, 'utf8');
      } catch {
        continue;
      }
    }

    const auditable = ext === '.html' ? stripMetaTags(content) : content;

    for (const rule of RULES) {
      if (!fileMatchesScope(file, rule.fileScope)) continue;
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(auditable)) !== null) {
        if (rule.exceptionPattern && rule.exceptionPattern.test(m[0])) continue;
        const start = Math.max(0, m.index - 40);
        const end = Math.min(auditable.length, m.index + m[0].length + 40);
        const excerpt = auditable.slice(start, end).replace(/\s+/g, ' ');
        violations.push({
          rule: rule.id,
          file: file.replace(DIST, 'dist'),
          match: m[0],
          excerpt,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log(`[nda-audit] OK. 0 violations in ${files.length} files.`);
    return 0;
  }

  console.error(`[nda-audit] FAIL to ${violations.length} violation(s) in ${files.length} files:`);
  for (const v of violations) {
    console.error(`  ✗ [${v.rule}] ${v.file}`);
    console.error(`      match:    ${v.match}`);
    console.error(`      excerpt:  …${v.excerpt}…`);
  }
  console.error('');
  console.error('See src/utils/nda-audit.ts for the rule list.');
  console.error("To allow a match, refine the rule's exceptionPattern (preferred) or");
  console.error('rewrite the source content to comply.');
  return 1;
}

audit().then((code) => process.exit(code));
