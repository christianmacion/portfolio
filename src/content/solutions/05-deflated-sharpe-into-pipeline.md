---
title: 'Deflated Sharpe Ratio as a Built-in Pipeline Gate'
slug: 'deflated-sharpe-gate'
category: 'Quantitative Research'
order: 5
client: 'systematic-strategy desk (NDA-protected; closed past contract 03/2026 – 06/2026)'
problem: |
  Naive Sharpe ratios ignore the search effort — if you try 100 variants of an idea, the
  best-looking one will overstate the true edge. The desk needed this multiple-testing
  correction built into the validation pipeline, not stapled on at the end.
approach: |
  Implemented **Deflated Sharpe Ratio (DSR)** with a scipy-free numpy implementation, plus
  **CSCV-based Probability of Backtest Overfit (PBO)** and **Minimum Backtest Length (MinBTL)** —
  the three canonical multiple-testing corrections. All three run as gates G-23 → G-25 in the
  31-gate harness, every strategy candidate.
evidence:
  - '**scipy-free** numpy implementation (deploys anywhere)'
  - '**3 canonical corrections** in one gate stack (DSR, PBO, MinBTL)'
  - '**All gates share the same contract** as the LLM-eval gates'
outcome: |
  No strategy ships through the pipeline without surviving the multiple-testing correction layer.
  This gate is reusable: any new systematic strategy passes through the same validation stack.
proof:
  - 'Methodology referenced in the public methodology page'
  - 'Implementation available in public quant library'
tags: [deflated-sharpe, PBO, MinBTL, multiple-testing, scipy-free]
lane: 'quant'
lastUpdated: 2026-07-26
---
