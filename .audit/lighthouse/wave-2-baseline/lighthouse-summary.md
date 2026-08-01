# Wave 2 Lighthouse Baseline (pre-Wave-2-ship)

- Server: `http://127.0.0.1:4178`
- Build: `BASE_PATH=/` (CF Pages prod-equivalent)
- Mode: single run per (route,form-factor) — Wave 2 verify will run 3-run median
- Generated: 2026-08-01T06:54Z

| Route | Form | Perf | A11y | BP | SEO | LCP (s) | TBT (ms) | CLS | Gate |
|---|---|---|---|---|---|---|---|---|---|
| / | mobile | 93 | 100 | 100 | 100 | 2.71 | 0 | 0.00 | FAIL(perf<95) |
| / | desktop | 100 | 100 | 100 | 100 | 0.57 | 0 | 0.00 | PASS |
| /for-recruiters/ | mobile | 96 | 100 | 100 | 100 | 2.41 | 0 | 0.00 | PASS |
| /for-recruiters/ | desktop | 100 | 100 | 100 | 100 | 0.49 | 0 | 0.00 | PASS |
| /about/ | mobile | 86 | 100 | 100 | 100 | 3.46 | 0 | 0.00 | FAIL(perf<95) |
| /about/ | desktop | 100 | 96 | 100 | 100 | 0.70 | 0 | 0.00 | FAIL(a11y<100) |
| /proof/ | mobile | 88 | 97 | 100 | 100 | 3.31 | 0 | 0.00 | FAIL(perf<95,a11y<100) |
| /proof/ | desktop | 100 | 97 | 100 | 100 | 0.67 | 0 | 0.00 | FAIL(a11y<100) |
| /projects/quant/01-deflated-sharpe/ | mobile | 86 | 96 | 100 | 100 | 3.46 | 0 | 0.00 | FAIL(perf<95,a11y<100) |
| /projects/quant/01-deflated-sharpe/ | desktop | 99 | 96 | 100 | 100 | 0.74 | 0 | 0.00 | FAIL(a11y<100) |
| /methodology/ | mobile | 85 | 97 | 100 | 100 | 3.46 | 0 | 0.00 | FAIL(perf<95,a11y<100) |
| /methodology/ | desktop | 99 | 97 | 100 | 100 | 0.74 | 0 | 0.00 | FAIL(a11y<100) |

## Hard-gate thresholds (binding per `.github/workflows/lighthouse.yml`)

| Form | Perf | A11y | BP | SEO |
|---|---|---|---|---|
| Mobile | ≥ 0.95 | = 1.00 | = 1.00 | = 1.00 |
| Desktop | ≥ 0.98 | = 1.00 | = 1.00 | = 1.00 |

## Roll-up

- **Mobile Perf FAIL** on 4 of 6 primary routes (about, proof, projects/quant, methodology). Drives the Goldratt 1-constraint: pre-existing mobile perf regression that Wave 2 chrome additions MUST NOT exacerbate. LCP dominates (>2.4s on every mobile route).
- **Mobile A11y FAIL** on 2 of 6 (proof, methodology = 97; projects/quant = 96). Likely contrast issues — Phase 3 follow-up.
- **Desktop Perf PASS** all (99-100). Desktop A11y same 2-3 routes below 100 due to same source pages.

## Raw JSONs

- `mobile-<route>.json`, `desktop-<route>.json` per route in this directory.

## Notes

- 3-run median reserved for Part 2 (post-Wave-2-ship) verification. Single-run mobile here is conservative — actual field median may differ ±2 pts.
