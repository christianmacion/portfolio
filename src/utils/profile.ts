/**
 * profile.ts — single source of truth for the site's owner identity.
 * NDA-safe values only. Editing here propagates to nav, footer,
 * schema.org JSON-LD, and the resume download link.
 */

// Stats are the canonical source for site-wide numerics. titles.secondary
// derives its 4 chrome figures (aiAgentCount / evalGates / locPython /
// certCount) from these values — so flipping any stat propagates to the
// default <meta description> + JSON-LD description + OG/Twitter card
// description simultaneously. No developer grep required.
const stats = {
  certCount: '102',
  ageMonths: '11', // 102 certs in 11 months
  aiAgentCount: '11', // orchestrator + workers
  locPython: '76.5k', // ~76,500 LOC
  evalGates: '31', // 31-gate evaluation harness
  pagesBuilt: '84', // built pages — update on route add/remove
  // v6.11.13 — derived chrome counts. /positions had hardcoded
  // "15 repos" / "Five seats" / "Three seat types" that contradicted
  // other pages and silently drifted when role-cards were added/removed.
  repoCount: '25', // GitHub public repos (api.github.com/users/christianmacion26 → public_repos=25)
  targetSeats: '5', // /positions conversation cards (lines 248-374)
  offTableSeats: '3', // /positions "off the table" bullets (lines 388-392)
  strategyCount: '9', // /projects quant files (01-…mdx) — update on strategy add/remove
  positionsStartDate: '2026-04-21', // /positions paper-trading series start (BTC/USDT 1d klines)
  // v6.11.33 — resume variants count. Drives /resume, /for-recruiters, /contact chrome.
  resumeCount: '3', // unified / AI-only / Quant one-pager (resumes[] in resume.astro)
  // v7.5 — multi-agent office stats (STELLA-public-safe slice).
  // These surface on /desk + ArchitectureBrief. Distinct from
  // aiAgentCount = '11' (the DAG node count on /ai) which is a different
  // abstraction level (orchestrator + 10 workers, not the full office).
  agentOfficeCount: '53', // full multi-agent office count (12 officers + 41 specialists)
  subTeamCount: '6', // active sub-teams (OSINT cell · posture bench · consultant bench · commander org · math doctrine owners · workspace IA)
  mathDoctrineCount: '4', // stochastic · dynamical · numerical PDE · stat-learn
  mustHaveCount: '5', // eval-first · NDA-clean · alpha-driven · ship-ready · tier-aware
} as const;

// v7.5 — architecture chrome used by ArchitectureBrief.astro + /desk.
// NDA-safe: numbers + taxonomy only, no brand/officer names.
export const archSafe = {
  agentCount: stats.agentOfficeCount,
  subTeamCount: stats.subTeamCount,
  mathDoctrineCount: stats.mathDoctrineCount,
  mustHaveCount: stats.mustHaveCount,
  evalGateCount: stats.evalGates,
  // Public-safe taxonomy for the multi-agent office. Names only, no
  // officer/role positions, no brand.
  subTeams: [
    { name: 'OSINT cell', tag: '14 specialists · open-source intelligence' },
    {
      name: 'Strategy bench',
      tag: '12 specialists · strategic positioning + market scan',
    },
    {
      name: 'Consulting bench',
      tag: '11 senior advisors · competitive strategy + valuation',
    },
    { name: 'Commander org', tag: '12 officers · dispatch · AAR loop · 5-must-have compliance' },
    {
      name: 'Math + quant',
      tag: '4 specialists · stochastic · numerical · stat-learn · dynamics',
    },
    { name: 'Workspace IA', tag: '6 mental spokes · 15 routes · 1 psychological hub' },
  ] as const,
  // Public-safe math doctrine roster.
  mathDoctrine: [
    'stochastic analysis',
    'dynamical systems',
    'numerical PDE',
    'statistical learning theory',
  ] as const,
  // 5-must-have compliance rubric. From the standing-order 5-must-have
  // contract (terminal state · idempotent write · dedupe key · coverage
  // filter · AAR) — rephrased for external audiences.
  mustHave: [
    { tag: 'eval-first', text: 'every primitive ships behind a 31-gate statistical eval harness' },
    { tag: 'NDA-clean', text: 'NDA scope audited on every artifact before publish' },
    { tag: 'alpha-driven', text: 'risk-graded AAR with idempotent re-run path' },
    { tag: 'ship-ready', text: 'terminal state · dedupe key · coverage filter · one-page AAR' },
    { tag: 'tier-aware', text: 'cost + quality gates tracked per loop primitive' },
  ] as const,
} as const;

export const profile = {
  fullName:
    'Christian T. Macion' /* v6.18 — dropped "CTA®" suffix from masthead. The registered CTA® mark is held by UK STA / IFTA chartered designation; the PH STA Tier-1 program does not grant it. Recruiter-verifiable credential — drop the ®, keep the cert detail in the bio block. */,
  shortName: 'Christian Macion',
  initials: 'CM',
  titles: {
    primary: 'Quantitative Researcher · AI Engineer',
    // v6.10.47 — compact form for the Nav brand slot (36px logo). Uses
    // 'Quant' (not 'Quantitative') so the word fits the available width
    // without ellipsis at the smallest desktop breakpoint. Kept distinct
    // from `primary` so the visual hierarchy at H1 size still reads
    // 'Quantitative Researcher' in full.
    short: 'Quant Researcher · AI Engineer',
    secondary: `Christian T. Macion — Quant Researcher and AI Engineer. ${stats.aiAgentCount}-agent research platform, ${stats.evalGates}-gate statistical eval harness, ${stats.locPython} LOC Python, ${stats.certCount} professional certifications. NDA-safe by construction.`,
    tagline: 'I do solutions. Eval-first. NDA-clean.',
  },
  headshot: {
    src: '/headshot.jpg',
    alt: 'Christian T. Macion, dark blazer over graphic tee, three-quarter view, neutral background. Photographed February 2026.',
    credit: 'Photo · Feb 2026',
  },
  location: {
    city: 'Digos City',
    province: 'Davao del Sur',
    country: 'Philippines',
    timezone: 'UTC+8',
    display: 'Digos City, Davao del Sur, Philippines (UTC+8)',
  },
  contact: {
    // TODO(macion.ventures-domain): replace Gmail with christian@macion.ventures once domain
    //   is acquired + MX records resolve. Gmail breaks institutional register — a hedge-fund
    //   head-of-research hits the Gmail, the chrome deflates. Voice audit 2026-08-02 BLOCKER.
    //   Verified via `dig macion.ventures MX +short` (empty) + `dig macion.ventures A +short`
    //   (empty) + `dig macion.ventures NS +short` (empty). Domain is registered at Identity
    //   Digital (`.ventures` TLD) but has no DNS configured. SWAPPING NOW would break 20+
    //   mailto: links sitewide (BaseLayout, index, proof, for-recruiters, contact, JSON-LD,
    //   sitemap, RSS feeds). HARD TODO surfaced to Owner in
    //   ~/.claude/cache/corporate/aars/2026-08-02-voice-audit-fixes.md with the exact DNS
    //   verification commands + the deployment sequence once MX resolves.
    email: 'christianmacion26@gmail.com',
    phone: '+63-991-616-2630',
    phoneDisplay: '+63 991 616 2630',
    linkedin: 'https://www.linkedin.com/in/christianmacion',
    github: 'https://github.com/christianmacion26',
    medium: 'https://medium.com/@christianmacion',
    ojp: 'https://v2.onlinejobs.ph/jobseekers/info/4760383',
    upwork: 'https://www.upwork.com/freelancers/~01785a76c001e4acd8',
  },
  knowsAbout: [
    'Multi-Agent LLM Systems',
    'LLM Evaluation',
    'RAG',
    'Structured Outputs',
    'MCP (Model Context Protocol)',
    'Deflated Sharpe Ratio',
    'Walk-Forward Validation',
    'Block-Bootstrap',
    'Cointegration',
    'Variance Risk Premium',
    'Crypto Derivatives',
    'Python',
    'KaTeX',
    'OSINT (Open-Source Intelligence)',
    'AI Architecture Auditing',
  ],
  alumniOf: [
    'University of Mindanao (UM)',
    'Southern Technical Academy (STA)',
    'Philippine Science High School — Southern Mindanao Campus (PSHS-SMC)',
    'University of Southeastern Philippines (USeP) — units',
  ],
  awards: [
    // [VERIFY] date-range-mismatch with ageMonths: stats.ageMonths is '11'
    // (derived into /solutions, /about, /index chrome) but this award
    // bracket spans 17 months (Dec 2024 → May 2026). Two interpretations
    // resolve to consistent chrome:
    //   A. ageMonths='11' is the OWNER's "active research arc" (e.g. since
    //      v2 push), separate from the full cert history
    //   B. ageMonths should be '17' to match the bracket on this line
    // Awaiting OWNER verdict. For now, keep both as-is and let OWNER
    // reconcile. See chrome-honesty memory: portfolio-chrome-unification
    // for the rest of the v6.11.x chrome-derivation pattern.
    `${stats.certCount} certificates (2024-12 → 2026-05)`,
    'STA Tier-1 Certified Technical Analyst · cert #260197 · Jan 2026' /* v6.18 — dropped ® and "Society of Technical Analysts" claim; renamed to PH STA Tier-1 (the actual program). UK STA / IFTA CTA® chartered designation is a separate credential not held. */,
    'Galactic Problem Solver · NASA Space Apps Challenge 2024 (Zurich cohort)',
    'AI for the Modern Workforce · Ateneo de Davao + US Embassy · Nov 8 2025',
    'AIccelerate 2025 · BIDA × Bayan Academy × Meta · Nov 12–21 2025',
    'Blockchain4Youth B4Y-2026-000701 · Bitget · 2026',
  ],
  availability: {
    hours: '30 hrs/wk',
    mode: 'remote',
  },
  stats,
} as const;
