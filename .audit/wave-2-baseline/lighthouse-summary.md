# Wave 2 Lighthouse Baseline (pre-Wave-2-ship)

- Server: `http://127.0.0.1:4178`
- Build: `BASE_PATH=/` (CF Pages prod-equivalent)
- Mode: single run per (route,form-factor) — Wave 2 verify will run 3-run median
- Generated: 2026-08-01T06:54:21Z

| Route | Form | Perf | A11y | BP | SEO | LCP (s) | TBT (ms) | CLS |
|---|---|---|---|---|---|---|---|---|
| / | mobile | 93 | 100 | 100 | 100 | 2710 | 0 | 0.00 |
| / | desktop | 100 | 100 | 100 | 100 | 570 | 0 | 0.00 |
| /for-recruiters/ | mobile | 96 | 100 | 100 | 100 | 2410 | 0 | 0.00 |
| /for-recruiters/ | desktop | 100 | 100 | 100 | 100 | 486 | 0 | 0.00 |
| /about/ | mobile | 86 | 100 | 100 | 100 | 3462 | 0 | 0.00 |
| /about/ | desktop | 100 | 96 | 100 | 100 | 700 | 0 | 0.00 |
| /proof/ | mobile | 88 | 97 | 100 | 100 | 3308 | 0 | 0.00 |
| /proof/ | desktop | 100 | 97 | 100 | 100 | 670 | 0 | 0.00 |
| /projects/quant/01-deflated-sharpe/ | mobile | 86 | 96 | 100 | 100 | 3460 | 0 | 0.00 |
| /projects/quant/01-deflated-sharpe/ | desktop | 99 | 96 | 100 | 100 | 738 | 0 | 0.00 |
| /methodology/ | mobile | 85 | 97 | 100 | 100 | 3461 | 0 | 0.00 |
| /methodology/ | desktop | 99 | 97 | 100 | 100 | 736 | 0 | 0.00 |

## Hard-gate thresholds (binding per `.github/workflows/lighthouse.yml`)

| Form | Perf | A11y | BP | SEO |
|---|---|---|---|---|
| Mobile | ≥ 0.95 | = 1.00 | = 1.00 | = 1.00 |
| Desktop | ≥ 0.98 | = 1.00 | = 1.00 | = 1.00 |

## Notes

- 3-run median reserved for Part 2 (post-Wave-2-ship) verification.
