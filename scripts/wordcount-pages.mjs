#!/usr/bin/env node
/**
 * Per-page visible word count from built dist/ HTML.
 * Counts prose inside <main> only, excluding chrome (nav, siderail, header,
 * command palette, worldview modal), script/style/svg/noscript, and
 * aria-hidden / visually-hidden nodes.
 *
 * Usage: node scripts/wordcount-pages.mjs [--json] [label]
 */
import { readFileSync, existsSync } from 'node:fs';
import { load } from 'cheerio';

const ROUTES = [
  ['/now', 'dist/now/index.html'],
  ['/proof', 'dist/proof/index.html'],
  ['/methodology', 'dist/methodology/index.html'],
  ['/for-recruiters', 'dist/for-recruiters/index.html'],
  ['/contact', 'dist/contact/index.html'],
  ['/projects', 'dist/projects/index.html'],
  ['/experience', 'dist/experience/index.html'],
  ['/stack', 'dist/stack/index.html'],
  ['/certifications', 'dist/certifications/index.html'],
  ['/notes', 'dist/notes/index.html'],
  ['/repos', 'dist/repos/index.html'],
  ['/resources', 'dist/resources/index.html'],
  ['/', 'dist/index.html'],
];

const DROP = [
  'script',
  'style',
  'noscript',
  'svg',
  'template',
  'nav',
  '.sr-only',
  '.visually-hidden',
  '[aria-hidden="true"]',
  '[hidden]',
  '#command-palette',
  '.command-palette',
  '.worldview',
  '#worldview',
  '.side-rail',
  '#side-rail',
  '.chrome-marquee',
  '.marquee',
  '.site-header',
  '.chrome-header',
  'header.layout-header',
  'footer',
];

function countWords(file) {
  if (!existsSync(file)) return null;
  const $ = load(readFileSync(file, 'utf8'));
  const main = $('main').length ? $('main') : $('body');
  for (const sel of DROP) main.find(sel).remove();
  const text = main
    .text()
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 0;
  // A "word" = whitespace-delimited token containing at least one alphanumeric.
  return text.split(' ').filter((t) => /[a-z0-9]/i.test(t)).length;
}

const asJson = process.argv.includes('--json');
const label = process.argv.filter((a) => !a.startsWith('--'))[2] || '';
const out = {};
for (const [route, file] of ROUTES) out[route] = countWords(file);

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`# word counts ${label}`);
  for (const [r, n] of Object.entries(out)) {
    console.log(`${r.padEnd(18)} ${n === null ? 'MISSING' : n}`);
  }
  const total = Object.values(out).reduce((a, b) => a + (b || 0), 0);
  console.log(`${'TOTAL'.padEnd(18)} ${total}`);
}
