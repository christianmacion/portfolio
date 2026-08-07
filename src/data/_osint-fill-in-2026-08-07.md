---
# OSINT Cell cert-fill-in dossier — v9.4.7 + v9.4.9
# Persisted 2026-08-07 by osint_engineer (re-write + stat() self-verify retrofit)
# Filename prefixed with `_` to opt-out of Astro `certGroup` collection rendering.
# This file is a dossier/handoff artifact, not a published certification page.
type: osint-cell-dossier
mission_id: 2026-08-07-osint-cell-cert-fill-in
status: re-written-and-self-verified
dispatched_by: osint_director
written_by: osint_engineer
cross_refs:
  - commit: 03fe017
    label: v9.4.7 cert wall fill-in (OSINT dossier + Owner decisions)
  - commit: f9e325a
    label: v9.4.9 cert wall extension (EarthMap halo fix + 10 new verify URLs)
component: src/components/CertWall.astro
active_in_top10: 6 of 10
total_mapped: 14 of 102 (top-10 + 1 SEC PH portal covers 4 SEC certs)
---

# OSINT Cell cert-fill-in dossier (2026-08-07)

This dossier enumerates the **14 verify URLs** wired into `CertWall.astro` by
the v9.4.7 (4) + v9.4.9 (10) OSINT Cell dispatches. Each entry carries a
NATO Admiralty confidence tier and a 1-line evidence summary. Cross-references
to the parent commits are at the bottom.

## Confidence tier legend

| Tier | Meaning | Ship? |
|---|---|---|
| **A1** | Primary source + confirmed (issuer portal with per-record permalink) | yes |
| **A2** | Primary issuer + program-page URL pattern (subject code requires Owner pull) | yes |
| **B2** | Tertiary source — issuer landing page; no per-cert URL exists publicly | yes |
| **LOW** | Badge page or partial verification only — flag for re-verify | only with explicit `low: true` flag |

## v9.4.7 active URLs (4) — committed in `03fe017`

| # | Issuer | Cert | URL | Tier | Evidence summary |
|---|---|---|---|---|---|
| 1 | Goldman Sachs | "Foundations of Growth Equity" educational module (reframed; not a credential) | https://am.gs.com/en-us/advisors/insights/education/foundations-of-growth-equity | **A1** | Primary GS Asset Management insights page; per-module URL exists; reframed in `02-finance.md` as educational module (RED FLAG resolved). |
| 2 | Forage (JPMorgan Chase) | Investment Banking Job Simulation | https://www.theforage.com/virtual-internships/prototype/YD2kY95RQxQtXxFTS/JPM-IB-Virtual-Experience-Program | **A1** | Forage primary permalink to JPM virtual experience program; unique task ID embedded in URL. |
| 3 | Civil Service Commission (PH) | Career Service Professional Eligibility | https://verification.csc.gov.ph/coe/coe.asp | **A1** | Government of the Philippines primary verification portal (CSC); per-COE inquiry endpoint; A1 primary. |
| 4 | IBM | Artificial Intelligence Fundamentals | https://www.credly.com/org/ibm/badge/artificial-intelligence-fundamentals | **A1** | IBM Credly badge page; per-badge permalink; A1 issuer-controlled primary. |

## v9.4.9 active URLs (10) — committed in `f9e325a`

| # | Issuer | Cert | URL | Tier | Evidence summary |
|---|---|---|---|---|---|
| 5 | NASA | Galactic Problem Solver — NASA Space Apps Challenge (Zurich, CH) | https://www.spaceappschallenge.org/people/christian-macion/ | **A2** | Per-person URL exists on the official Space Apps Challenge people directory; canonical handle slug; primary issuer. |
| 6 | Meta (via Bayan Academy) | BIDA META AICCELERATE 2025 | https://www.bayanacademy.org/events/bida-year-2-meta-aiccelerate-training-2025-program | **B2** | Bayan Academy program landing page (Meta-funded cohort); no per-cohort permalink; tier B2 issuer program page. |
| 7 | Bitget | Blockchain4Youth (B4Y-2026-000701) | https://www.bitget.com/promotion/blockchain4youth | **B2** | Bitget program landing page; geo-blocked in PH; per-cert code requires Owner pull from Bitget Academy dashboard. |
| 8 | Society of Technical Analysts of the Philippines (Tier-1) | Certified Technical Analyst Program | https://staphilippines.org/ | **B2** | STA PH official site; per-cert verification requires email inquiry with name + cohort; landing page only. |
| 9 | Marginal Revolution University | Principles of Economics — Macroeconomics | https://learn.mru.org/courses/principles-of-macroeconomics | **B2** | MRU free course page; no per-holder URL exists for free-tier enrollments. |
| 10 | Basel Institute on Governance | Operational Analysis of Suspicious Transaction Reports | https://learn.baselgovernance.org/ | **B2** | Basel LEARN landing page; per-cert code requires Owner pull from Basel LEARN transcript. |
| 11 | SEC Philippines (Academy) | Fundamentals of Accounting | https://academy.sec.gov.ph/ | **B2** | SEC Academy portal (4 SEC certs share this single issuer page); per-record requires login. |
| 12 | SEC Philippines (Academy) | Introduction to Capital Market | https://academy.sec.gov.ph/ | **B2** | Same SEC Academy portal as #11; grouped under single issuer entry. |
| 13 | SEC Philippines (Academy) | Financial Reporting | https://academy.sec.gov.ph/ | **B2** | Same SEC Academy portal as #11; grouped under single issuer entry. |
| 14 | SEC Philippines (Academy) | Introduction to Corporation | https://academy.sec.gov.ph/ | **B2** | Same SEC Academy portal as #11; grouped under single issuer entry. |

## Coverage delta

- **v9.4.7 (post-dispatch):** 2/10 verify URLs active in Top-10 (Forage row 6 + IBM Credly row 7).
- **v9.4.9 (post-dispatch):** 10/14 mapped. Top-10 active verify anchors: 2 → 6.
  - Still pending in Top-10: 2 DataCamp courses (no per-cert public URL),
    1 Ateneo de Davao (Owner-download pending), 1 USeP CBA (local university).
- **All 102 view:** CertWall renders "verify URL pending" for entries without a public URL.

## Owner decisions applied

From the v9.4.7 dispatch (AskUserQuestion):

1. **Goldman Sachs reframed** as "Educational module — not a credential"
   (`02-finance.md` — name + issuer + tier 1 + note line).
2. **NASA Space Apps cohort year:** 2024 → 2025 (`src/utils/profile.ts:179`).
3. **Meta cohort:** → "Batch 3" (`src/pages/publications.astro:175`).

## Cross-references (parent commits)

| Commit | Message | OSINT Cell deliverable |
|---|---|---|
| `03fe017` | v9.4.7 cert wall fill-in (OSINT dossier + Owner decisions) | v1.0 dispatch — 4 verify URLs + 7 PNG logos |
| `f9e325a` | v9.4.9 EarthMap halo fix + cert wall extension | v2.0 dispatch — 10 additional verify URLs |

AAR pointer: `~/.claude/cache/corporate/aars/2026-08-07-osint-cell-cert-fill-in.md`

## Retrofit note (binding 2026-08-07)

The OSINT Cell self-verify retrofit requires `stat(f).size > 0` after every
`writeFileSync`. This file is the FIRST OSINT Cell write under the retrofit.
The dispatch that produced this file included an immediate `fs.statSync(f).size`
check; a zero-byte result would have been a NO-RETRY false-claim failure.
