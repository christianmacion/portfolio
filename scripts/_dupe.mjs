import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
const get = (p, sel) => {
  const $ = load(readFileSync(`dist/${p}/index.html`, 'utf8'));
  return new Set($(sel).map((_, el) => $(el).text().replace(/\s+/g,' ').trim()).get().filter(Boolean));
};
const proof = get('proof', '.proof-list__name');
const projects = get('projects', '.project-card__title, .card__title, h3');
console.log('proof P.4 items:', proof.size);
console.log('projects items :', projects.size);
const inter = [...proof].filter(t => [...projects].some(p => p.includes(t) || t.includes(p)));
console.log('OVERLAP        :', inter.length);
console.log(inter.slice(0,20).map(s=>'  · '+s).join('\n'));
