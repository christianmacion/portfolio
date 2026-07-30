// __tests__/verify-anchors.test.mjs — minimal sanity test for the parser
//
// Runs the parser against a synthetic Astro frontmatter block + a tiny
// stub HTML file, verifies both the positive (all anchors found) and
// negative (one anchor missing → failure path) cases.
//
// Standalone: `node scripts/__tests__/verify-anchors.test.mjs`

// Inline copy of the parser (kept in sync with scripts/verify-anchors.mjs).
// Avoids cross-file import gymnastics for a one-shot test.
function parseWorkbooks(src) {
  const workbooks = [];
  const wbRegex =
    /\{\s*id:\s*'(w\d+)'[\s\S]*?href:\s*'([^']+)'[\s\S]*?chapters:\s*\[([\s\S]*?)\],?\s*\}/g;
  let m;
  while ((m = wbRegex.exec(src)) !== null) {
    const [, id, href, chaptersBlock] = m;
    const chapters = [];
    const chRegex =
      /\{\s*num:\s*(\d+)\s*,\s*name:\s*'([^']*)'\s*,\s*anchor:\s*'(#ch-\d+)'\s*,?\s*\}/g;
    let cm;
    while ((cm = chRegex.exec(chaptersBlock)) !== null) {
      chapters.push({ num: parseInt(cm[1], 10), name: cm[2], anchor: cm[3] });
    }
    workbooks.push({ id, href, chapters });
  }
  return workbooks;
}

const SRC_FIXTURE = `
const workbooks = [
  {
    id: 'w1',
    title: 'Test',
    href: '/workbooks/test/',
    chapters: [
      { num: 1, name: 'Intro', anchor: '#ch-1' },
      { num: 2, name: 'Body', anchor: '#ch-2' },
    ],
  },
];
`;

const TINY_HTML = `<!doctype html>
<html><body>
<h2 class="chapter" id="ch-1">Chapter 1. Intro</h2>
<p>...</p>
<h2 class="chapter" id="ch-2">Chapter 2. Body</h2>
</body></html>
`;

const TINY_HTML_MISSING_CH2 = `<!doctype html>
<html><body>
<h2 class="chapter" id="ch-1">Chapter 1. Intro</h2>
</body></html>
`;

let passed = 0;
let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

console.log('=== verify-anchors parser tests ===\n');

// --- Positive: parser extracts id/href/chapters correctly ---
{
  const parsed = parseWorkbooks(SRC_FIXTURE);
  assert('parses 1 workbook', parsed.length === 1);
  assert('extracts id', parsed[0]?.id === 'w1');
  assert('extracts href', parsed[0]?.href === '/workbooks/test/');
  assert('extracts 2 chapters', parsed[0]?.chapters.length === 2);
  assert('chapter 1 anchor', parsed[0]?.chapters[0]?.anchor === '#ch-1');
  assert('chapter 2 anchor', parsed[0]?.chapters[1]?.anchor === '#ch-2');
}

// --- Positive: regex detects every anchor when present ---
{
  const parsed = parseWorkbooks(SRC_FIXTURE);
  const allFound = parsed[0].chapters.every((ch) => {
    const idAttr = ch.anchor.startsWith('#') ? ch.anchor.slice(1) : ch.anchor;
    const re = new RegExp(`id=["']${idAttr}["']`);
    return re.test(TINY_HTML);
  });
  assert('all 2 anchors found in stub HTML', allFound === true);
}

// --- Negative: regex detects missing anchor ---
{
  const parsed = parseWorkbooks(SRC_FIXTURE);
  const results = parsed[0].chapters.map((ch) => {
    const idAttr = ch.anchor.startsWith('#') ? ch.anchor.slice(1) : ch.anchor;
    const re = new RegExp(`id=["']${idAttr}["']`);
    return { anchor: ch.anchor, found: re.test(TINY_HTML_MISSING_CH2) };
  });
  assert('ch-1 found in incomplete HTML', results[0].found === true);
  assert('ch-2 NOT found in incomplete HTML', results[1].found === false);
}

// --- Boundary: anchor with quote variants (' and ") ---
{
  const html = `<h2 id='ch-9'>x</h2>`;
  const re = new RegExp(`id=["']ch-9["']`);
  assert('handles single-quote id attribute', re.test(html));
}

// --- Boundary: extra whitespace inside braces ---
{
  const src = `[{ num: 3,  name:'Whitespace',  anchor:'#ch-3' }]`;
  // Inject into a wrapper so the outer wbRegex still matches a single block.
  const wrapped = `
const workbooks = [
  {
    id: 'w9',
    href: '/x/',
    chapters: ${src},
  },
];
`;
  const parsed = parseWorkbooks(wrapped);
  assert('tolerates extra whitespace', parsed[0]?.chapters[0]?.anchor === '#ch-3');
}

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
