// build-graph-snapshot.mjs — v7.7 GRAPH SNAPSHOT BUILDER
//
// Reads the STELLA knowledge graph from ~/.claude/cache/stella/graph/
// and writes a static public-safe JSON file to public/graph-stream.json
// for the GraphStream.astro component to embed.
//
// Public-safe: filters out NDA-protected entities (19V Capital, Macion
// Capital, anything with names.pythonCapital.mark).
//
// Run: node scripts/build-graph-snapshot.mjs
// Wired into prebuild per package.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const GRAPH_DIR = join(homedir(), '.claude/cache/stella/graph');
const OUT_DIR = 'public';
const OUT_FILE = 'graph-stream.json';

const NDA_BLOCKLIST = new Set([
  '19v_capital', '19v-capital', 'macion_capital', 'macion-capital',
  'compliance_officer', 'corporate_osint_analyst', 'osint_director',
]);

async function loadJsonl(path) {
  if (!existsSync(path)) return [];
  const text = await readFile(path, 'utf-8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function isPublicSafe(entity) {
  const id = (entity.id || entity.key || '').toLowerCase();
  const skill = (entity.skill || entity.tier || '').toLowerCase();
  if (NDA_BLOCKLIST.has(id)) return false;
  if (skill.includes('nda') || skill.includes('capital')) return false;
  if (entity.nda === true || entity.private === true) return false;
  return true;
}

async function main() {
  const agents = await loadJsonl(join(GRAPH_DIR, 'agent.graph.jsonl'));
  const skills = await loadJsonl(join(GRAPH_DIR, 'skill.graph.jsonl'));
  const relations = await loadJsonl(join(GRAPH_DIR, 'relation.graph.jsonl'));

  const safeAgents = agents.filter(isPublicSafe).map((a) => ({
    id: a.id || a.key,
    name: a.name || a.title || a.key,
    tier: a.tier || a.v8_tier || 'T3',
    squad: a.squad || 'A',
    mark: a.mark || '',
  }));

  const safeSkills = skills.filter(isPublicSafe).map((s) => ({
    id: s.id || s.key,
    name: s.name || s.title || s.key,
    type: s.type || 'skill',
  }));

  const safeRelations = relations
    .filter((r) => isPublicSafe({ id: r.from }) && isPublicSafe({ id: r.to }))
    .map((r) => ({
      from: r.from,
      to: r.to,
      type: r.type || r.relation || 'RELATED',
    }));

  const out = {
    generated: new Date().toISOString(),
    counts: {
      agents: safeAgents.length,
      skills: safeSkills.length,
      relations: safeRelations.length,
    },
    agents: safeAgents.slice(0, 200),
    skills: safeSkills.slice(0, 100),
    relations: safeRelations.slice(0, 500),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, OUT_FILE), JSON.stringify(out, null, 2));
  console.log(`graph-snapshot: wrote ${out.counts.agents} agents, ${out.counts.skills} skills, ${out.counts.relations} relations → ${join(OUT_DIR, OUT_FILE)}`);
}

main().catch((e) => {
  console.error('graph-snapshot failed:', e);
  process.exit(1);
});