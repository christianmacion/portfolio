---
title: 'Transaction-Cost-Aware Backtest Engine'
slug: 'txn-cost-aware-backtest'
category: 'Quantitative Research'
order: 8
client: 'Self-directed / Portfolio'
problem: |
  Backtests that ignore transaction costs, slippage, and latency are the most common source of
  overfit research. A backtest engine needs all three treated as first-class inputs, not as
  after-the-fact deductions.
approach: |
  Built a **transaction-cost-aware backtest engine** in numpy (no scipy dependency) with realistic
  spread + slippage + latency models per asset class. The engine treats **capacity** as a
  constrained variable — strategies report the AUM at which they would still survive costs.
  Walk-forward and 5-era stability are enforced.
evidence:
  - '**Spread + slippage + latency** modeled per asset class'
  - '**Capacity constraint** enforced as a reportable dimension'
  - '**numpy-only** (deploys anywhere)'
  - '**Walk-forward + 5-era stability** gates on every strategy'
outcome: |
  Strategies ship with a **capacity-aware** backtest, not a fantasy one. A hiring manager can
  read a project's "survives costs at $X AUM" line and immediately trust the number.
proof:
  - 'Memo + figure in public quant portfolio'
  - 'Methodology documented in project README'
tags: [txn-costs, slippage, capacity, walk-forward]
lane: 'quant'
lastUpdated: 2026-07-26
---
