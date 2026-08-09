/**
 * qa-kb.ts : ⌘K "Ask anything" knowledge base (v13.1.4 polish-5).
 *
 * Curated question-answer pairs grounded in actual portfolio content.
 * Every entry has a [Source: ...] pointer so the answer can be audited
 * against the source-of-truth page (CLAUDE.md §11 — sagan-extraordinary-
 * claims, no ungrounded flags).
 *
 * Trigger logic (client-side, in CommandPalette.astro):
 *   - Input ends with "?" → Q&A mode
 *   - Input starts with what/how/why/when/where/who/can/do/are/is/tell
 *     → Q&A mode
 *   - Input has 4+ tokens AND no route-slug hit → Q&A mode
 *
 * Scoring (v1) : keyword overlap (Jaccard on token-set) + question-keyword
 * boost. Future v2 would replace this with embedding cosine similarity
 * (would require a static embedding bundle; deferred).
 *
 * NDA scope (CLAUDE.md §6) : all entries are persona-agnostic. NDA-
 * protected employers (19V Capital, Macion Capital) are NOT named. STELLA
 * is named only because it's a public-facing brand surface.
 */

export interface QaPair {
  /** Stable id, used as the result key (dedupe per CLAUDE.md §1). */
  id: string;
  /** Trigger phrases (lowercase). Match any of these substrings OR the
   *  question-token set to score. */
  triggers: string[];
  /** Single-paragraph answer (120-220 chars target). */
  answer: string;
  /** Source pointer for the audit trail. */
  source: string;
  /** Optional page to deep-link to (for "Show me his proof" routes). */
  href?: string;
  /** Optional page anchor (#gates etc.). */
  anchor?: string;
}

/**
 * 16 Q&A pairs covering : identity, methodology, gate stack, alpha work,
 * contact, experience, stack, current focus. Each pair is grounded in
 * an actual portfolio page — no invented metrics, no NDA-protected
 * employer names.
 */
export const QA_PAIRS: readonly QaPair[] = [
  {
    id: 'identity',
    triggers: ['who is christian', 'who are you', 'what is christian', 'tell me about christian', 'who is this', 'introduce yourself', 'about you', 'about yourself'],
    answer: 'Christian T. Macion is a quant researcher + AI engineer based in Digos City, Philippines (UTC+8). He builds alpha factors, runs gated backtests, and ships production Python trading infrastructure.',
    source: 'index.astro · now.astro',
    href: '/now/',
  },
  {
    id: 'focus',
    triggers: ['what is he working on', 'current focus', 'what are you doing', 'focus right now', 'current project', 'this week', 'this month', 'right now'],
    answer: 'Current focus: AFK alpha-hunt. Funding-carry v1 (crypto perp funding-rate carry) shipped with Sharpe 5.29 / annualized 9.76%. Now drafting 4 new strategies from a 5-source data substrate (CFTC COT + SEC 13F + GDELT + DefiLlama + EIA).',
    source: 'now.astro · papers/2026-08-09-afk-alpha-hunt-funding-carry',
    href: '/now/',
  },
  {
    id: 'methodology',
    triggers: ['methodology', 'how do you do it', 'approach', 'process', 'how does he work', 'workflow'],
    answer: '5-criteria filter (idea sourcing → pre-flight → research → backtest → scribe) + 38-gate stack (Gates 1-38, K1-K12). Every strategy must clear Gates 1-4 (PIT, fire unit, regime sign, walk-forward) + Gates 5-7 (data integrity) before paper trade.',
    source: 'methodology.astro',
    href: '/methodology/',
  },
  {
    id: 'gates',
    triggers: ['gates', 'gate stack', 'validation', 'how do you validate', 'how do you avoid overfitting', 'overfit', 'out-of-sample'],
    answer: 'The gate stack is a 38-gate funnel. Gates 1-4 are pre-flight (PIT, fire unit, regime sign, walk-forward). Gates 5-7 are data integrity. Gates 16/18/20/21 are anti-data-mining sniffs. Gate 22 is sharpe significance. K1-K12 cover additional quant-specific checks. Full list on /methodology/#gates.',
    source: 'methodology.astro (id="gates")',
    href: '/methodology/',
    anchor: 'gates',
  },
  {
    id: 'open-to-work',
    triggers: ['open to work', 'is he available', 'is he hiring', 'available for hire', 'freelance', 'contract work', 'consulting', 'looking for work', 'is he open'],
    answer: 'Open to remote quant-research + AI-engineering engagements. Email christianmacion26@gmail.com with the role spec.',
    source: 'contact.astro · now.astro',
    href: '/contact/',
  },
  {
    id: 'experience',
    triggers: ['experience', 'work history', 'where has he worked', 'past roles', 'previous jobs', 'background'],
    answer: 'Founder/operator at Macion Ventures (current). Multiple prior contract roles (closed per NDA — public-facing references available on request). Live quant work on funding carry + regime vectors. See /experience for the timeline.',
    source: 'experience.astro',
    href: '/experience/',
  },
  {
    id: 'stack',
    triggers: ['stack', 'tools', 'tech stack', 'technologies', 'what does he use', 'programming languages', 'languages', 'libraries'],
    answer: 'Python (pandas, numpy, vectorbt, zipline-reloaded) for quant. TypeScript + Astro + d3-geo for web. STELLA infra runs on a custom 88-agent orchestration layer (proprietary to Acion Capital) with reasoning-graph backing.',
    source: 'stack.astro',
    href: '/stack/',
  },
  {
    id: 'funding-carry',
    triggers: ['funding carry', 'funding rate', 'funding-carry', 'what is funding carry', 'crypto perp', 'perpetual', 'perps'],
    answer: 'Funding-carry v1 is a crypto perpetual funding-rate carry strategy. Long top-funding / short bottom-funding pairs, 21-day cadence, top-8 universe by signal strength, manual-only. Sharpe 5.29, annualized 9.76% on the OOS window.',
    source: 'papers/2026-08-09-afk-alpha-hunt-funding-carry.md',
    href: '/papers/',
  },
  {
    id: 'contact',
    triggers: ['contact', 'how do i reach', 'how do you contact', 'get in touch', 'reach out', 'email him', 'talk to him'],
    answer: 'Email christianmacion26@gmail.com. GitHub + LinkedIn links in the site footer. Average reply window: 24-48h on weekdays (UTC+8).',
    source: 'contact.astro',
    href: '/contact/',
  },
  {
    id: 'location',
    triggers: ['where is he', 'location', 'based in', 'where are you', 'time zone', 'timezone', 'remote'],
    answer: 'Digos City, Davao del Sur, Philippines (UTC+8). Remote-first; engagements are async-friendly.',
    source: 'index.astro · now.astro',
  },
  {
    id: 'education',
    triggers: ['education', 'degree', 'university', 'school', 'certifications', 'certified', 'training'],
    answer: 'Self-taught in quant + AI engineering. Active certifications tracked on /certifications. Has lectured at USEP and spoken at Ateneo American Corner. No formal CS degree — the gate stack + workbooks are the credential.',
    source: 'certifications.astro',
    href: '/certifications/',
  },
  {
    id: 'proof',
    triggers: ['proof', 'show me his work', 'where is the evidence', 'results', 'performance', 'track record', 'show your work'],
    answer: 'Public workbooks with full audit trail — notebooks, trade logs, scorecards. Every shipped strategy ships with a §LM doc + §1.5 verdict matrix tied to gate evidence. See /proof.',
    source: 'proof.astro',
    href: '/proof/',
  },
  {
    id: 'alpha',
    triggers: ['alpha', 'edge', 'sharpe', 'sortino', 'expectancy', 'returns', 'p&l', 'pnl'],
    answer: 'Current best: funding-carry v1 at Sharpe 5.29 / annualized 9.76% on OOS. Other live strategies under research are kill-only so far — the methodology pre-flight gate kills 80%+ of candidates before any backtest cost.',
    source: 'papers/astro · strategy registry',
    href: '/papers/',
  },
  {
    id: 'ai',
    triggers: ['ai work', 'do you do ai', 'machine learning', 'ml', 'llm', 'rag', 'agents'],
    answer: 'Yes — STELLA (88-agent office for quant + AI work) and a public workbook library on graph-engineering + ai-engineering. RAG, MCP, agent orchestration are core competencies. See /ai.',
    source: 'ai.astro',
    href: '/ai/',
  },
  {
    id: 'stella',
    triggers: ['what is stella', 'tell me about stella', 'stella office', 'agents'],
    answer: 'STELLA is Christian\'s proprietary 88-agent orchestration layer for quant + AI work — 14 squads (Leadership + 13 product squads + OSINT cell), 3200+ graph nodes, doctrine-corpus backing (Sagan / Kahneman / Munger / Deming / Tetlock / Arendt / Goldratt / Sun Tzu). Used internally; surfaced publicly via the workbook library.',
    source: 'ai.astro · workbook library',
    href: '/ai/',
  },
  {
    id: 'remote',
    triggers: ['remote only', 'relocate', 'on-site', 'in office', 'hybrid', 'where will you work'],
    answer: 'Remote-first (Digos City, UTC+8). Open to short on-site immersions for kickoff weeks; not open to full relocation. Engagement hours overlap-friendly with APAC + EU.',
    source: 'now.astro · contact.astro',
    href: '/contact/',
  },
];

/**
 * Lightweight scorer for v1 : token-set Jaccard over the lowercased
 * input + trigger overlap boost. v2 should swap to embedding cosine
 * (would require a static embedding bundle on GH Pages).
 *
 * Returns the best matching pair OR null if no pair clears the 0.30
 * Jaccard floor. The 0.30 floor is intentional — false positives are
 * worse than misses (visitor loses trust faster than they lose time).
 */
export function bestMatch(input: string): { pair: QaPair; score: number } | null {
  const q = input.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return null;
  const qTokens = new Set(q.split(' ').filter((t) => t.length > 1));

  let best: { pair: QaPair; score: number } | null = null;

  for (const pair of QA_PAIRS) {
    // Direct substring match on any trigger phrase.
    let directHit = false;
    for (const trigger of pair.triggers) {
      if (q.includes(trigger)) {
        directHit = true;
        break;
      }
    }

    // Token-set overlap : union of all trigger tokens.
    const triggerTokens = new Set<string>();
    for (const trigger of pair.triggers) {
      for (const tok of trigger.split(' ').filter((t) => t.length > 1)) {
        triggerTokens.add(tok);
      }
    }
    let intersection = 0;
    for (const tok of triggerTokens) {
      if (qTokens.has(tok)) intersection++;
    }
    const union = triggerTokens.size + qTokens.size - intersection;
    const jaccard = union === 0 ? 0 : intersection / union;

    // Score : direct hit gets a strong boost, otherwise pure jaccard.
    const score = directHit ? Math.max(jaccard, 0.55) + 0.2 : jaccard;

    if (score >= 0.30 && (!best || score > best.score)) {
      best = { pair, score };
    }
  }

  return best;
}