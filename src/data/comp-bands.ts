/**
 * comp-bands.ts — institutional comp positioning data.
 *
 * Source basis for the bands (defensible institutional defaults, 2026):
 *   - a16z salary bands (senior data + AI engineering, public posts 2024–2026)
 *   - OpenAI / Stripe senior staff engineer comp ranges (public + Levels.fyi)
 *   - H1B Wage-LCA Level IV (senior) for SF/NY data scientist + ML engineer seats
 *   - OJP/Upwork Top-Rated+ hourly senior quant data (public rate cards)
 *
 * HONEST PLACEMENT FLAG: these are PUBLIC KNOWLEDGE institutional defaults
 * the candidate can defend on a call. The exact band per role is OWNER-
 * CONFIRMED on wake (per memory `feedback-portfolio-voice-audit-2026-08-02`
 * "zero rate/salary/fee signals sitewide" blocker). Each table surfaces
 * the placeholder-flag line at the top per the design contract.
 *
 * Each band has: id, label, target (target audience), band (range), conditions
 * (engagement-specific guard rails), structure (how comp is delivered).
 */

export interface CompBand {
  /** Stable id for deep-links + table rows. */
  id: string;
  /** Display label for the row + section heading. */
  label: string;
  /** Target audience — who is this band for. */
  target: string;
  /** Defensible institutional range. Placeholder until Owner confirms. */
  band: string;
  /** Engagement-specific guard rails (hours / duration / scope). */
  conditions: string;
  /** How the comp is delivered — base / bonus / equity / carry / retainer. */
  structure: string;
}

export interface CompCategory {
  id: string;
  /** Display label for the section. */
  label: string;
  /** One-line description for the section header. */
  summary: string;
  bands: CompBand[];
}

export const compCategories: CompCategory[] = [
  {
    id: 'full-time',
    label: 'Full-time engagements',
    summary:
      'Senior Quant Researcher and AI Engineer / Architect seats, remote-first, US-premarket or APAC overlap.',
    bands: [
      {
        id: 'qr-remote',
        label: 'Senior Quant Researcher · remote (US/EU employer)',
        target:
          'Funds, prop shops, and trading firms staffing a senior QR seat with public-data discipline.',
        band: '$200 to 280k base + 30 to 100% target bonus',
        conditions:
          'Remote-first (Digos City, PH / UTC+8). US-premarket or APAC overlap. Full-time W-2 (EOR-OK) or independent contractor. Visa sponsorship is employer-side.',
        structure:
          'Base salary · annual target bonus · potential carry / profit-share · 4-year refresh · standard 1-year cliff on equity grants.',
      },
      {
        id: 'ai-eng-remote',
        label: 'AI Engineer / Architect · remote (US/EU)',
        target:
          'Funds, AI labs, and platform teams staffing a senior AI Engineer or Architect seat with eval-first discipline.',
        band: '$220 to 300k base + 0.05 to 0.50% equity',
        conditions:
          'Remote-first (Digos City, PH / UTC+8). US-premarket or APAC overlap. Full-time W-2 (EOR-OK) or independent contractor.',
        structure:
          'Base salary · equity grant (4-year vest, 1-year cliff) · annual performance bonus · potential signing.',
      },
    ],
  },
  {
    id: 'contract',
    label: 'Contract & project work',
    summary:
      'Bounded engagements with a defined deliverable. Discovery → ship-ready, no long-term commitment.',
    bands: [
      {
        id: 'hourly',
        label: 'Hourly contract · consulting',
        target:
          'Teams needing senior QR / AI engineering capacity for a bounded workstream. eval harness build, RAG pipeline, backtest infrastructure, MCP server.',
        band: '$150 to 220/hr',
        conditions:
          'Minimum 30 hr/wk. 3-month engagement minimum. NDAs on request. NDA-clean by construction (public-data only).',
        structure:
          'Hourly · monthly invoice · net-15 · kill-fee on 14-day notice · 50% kill-fee on scope change beyond week 2.',
      },
      {
        id: 'retainer',
        label: 'Project-based retainer',
        target:
          'Funds or teams scoping a single 4-week project. eval harness, RAG pipeline, multi-agent demo, MCP server build, strategy research sprint.',
        band: '$25 to 60k / 4-week project',
        conditions:
          'Discovery call (no-fee, 30 min) → fixed-scope SOW → ship-ready deliverable. NDA on request. Public-data only by default.',
        structure:
          '50% on signing · 50% on ship-ready milestone. Source code + deliverables transfer on final payment. NDA + IP terms negotiable.',
      },
    ],
  },
  {
    id: 'advisory',
    label: 'Advisory & squad-of-squads',
    summary:
      'Light-touch advisory engagements for venture, fund, or research-team contexts. No code shipped.',
    bands: [
      {
        id: 'squad-s-advisory',
        label: 'Advisory · squad / portfolio',
        target:
          'Early-stage funds, ventures, or research teams needing senior QR / AI counsel on a recurring cadence.',
        band: '$8 to 15k / engagement',
        conditions:
          '1 to 2 calls/wk · async review of memos / artifacts · 3-month minimum. NDA on request. Public-data only.',
        structure:
          'Quarterly invoice · kill-fee on 30-day notice · standard advisory agreement (no equity by default. equity requires separate term sheet).',
      },
    ],
  },
];

export const outOfScope = [
  'Commodity work to $50/hr one-off scripts, generic "junior Python dev" briefs, or anything below the senior practitioner register.',
  'Equity-only at seed. no cash component. Comp must include a defensible cash floor to be in scope.',
  'Below-30-hr/wk token-of-gratitude engagements. the candidate reserves capacity for senior practitioner work.',
  'Algorithm-only mandates without manual-edge-of-honesty disciplines. every engagement includes eval gates + reproducibility by default.',
  'Non-public signals / proprietary-data work. every shipped artifact uses public-data only (NDA-clean by construction).',
] as const;

export const engagementChecklist = [
  'Role type. Senior QR / AI Engineer / Architect / Advisory',
  'Comp range. your band or range, including base / bonus / equity / carry split',
  'Hours per week. full-time or bounded engagement',
  'Start date. when you need the seat filled',
  'Duration. permanent, fixed-term, or project-bounded',
  'Location / timezone overlap required',
  'NDA requirements. counter-party form or firm-standard',
] as const;

/** OWNER ACTION on wake — confirm / adjust the exact bands per row. */
export const placeholderFlag =
  'Owner-confirmed band; flag any band outside the listed range if it changes Owner-work-life balance. Each band uses institutional-default 2026 ranges the candidate can defend on a call. The exact figure per role is confirmed at first screening.';
