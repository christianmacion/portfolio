import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
for (const p of process.argv.slice(2)) {
  const $ = load(readFileSync(`dist/${p}/index.html`, 'utf8'));
  const m = $('main');
  m.find('script,style,svg,nav,.side-rail,#command-palette,.worldview').remove();
  console.log(`\n===== /${p} =====`);
  m.find('h1,h2,h3').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 95);
    if (t) console.log(`  ${el.tagName.toUpperCase()}  ${t}`);
  });
}
