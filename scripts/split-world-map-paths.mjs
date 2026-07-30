#!/usr/bin/env node
/* split-world-map-paths.mjs — split the inline world-map-paths.ts into two
 * JSON files served as static assets. v7.9 split: drops inline HTML by ~1.4 MB.
 *
 *   public/data/world-map-equirect.json (1.46 MB) — SwarmScene on home
 *   public/data/world-map-ortho.json    (1.05 MB) — EarthMap on /desk
 *
 * Run: node scripts/split-world-map-paths.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC = resolve(ROOT, 'src/data/world-map-paths.backup.ts');
const OUT_DIR = resolve(ROOT, 'public/data');

const src = readFileSync(SRC, 'utf8');
const start = src.indexOf('export const countries:');
const eq = src.indexOf('=', start);
const arrStart = src.indexOf('[', eq);
let depth = 0,
  end = arrStart;
for (let i = arrStart; i < src.length; i++) {
  if (src[i] === '[') depth++;
  else if (src[i] === ']') {
    depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
const countries = JSON.parse(src.substring(arrStart, end + 1));

mkdirSync(OUT_DIR, { recursive: true });
const equirect = countries.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, d: c.d }));
const ortho = countries.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, dGlobe: c.dGlobe }));

writeFileSync(resolve(OUT_DIR, 'world-map-equirect.json'), JSON.stringify(equirect));
writeFileSync(resolve(OUT_DIR, 'world-map-ortho.json'), JSON.stringify(ortho));

console.log(`Split ${countries.length} countries into:`);
console.log(`  equirect: ${equirect.length} entries`);
console.log(`  ortho:    ${ortho.length} entries`);