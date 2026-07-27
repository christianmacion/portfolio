---
title: 'Crypto Statistical-Arbitrage Pipeline with Funding-Carry'
slug: 'crypto-stat-arb-funding'
category: 'Quantitative Research'
order: 7
client: 'Self-directed / Ledger51 era (public-data)'
problem: |
  Crypto perps run funding payments every 8h. A naive long-short book ignores funding carry and
  bleeds slowly when the spread is inverted. A working stat-arb needs the funding cost added back
  to P&L *before* sizing.
approach: |
  Built a **crypto stat-arb pipeline** that integrates funding carry into the cost model, pairs it
  with a cointegration gate (Engle–Granger + Johansen + half-life band), and gates trades through
  the same 31-gate harness as systematic equity strategies. Locked OOS window; block-bootstrap CIs;
  random-timing nulls.
evidence:
  - '**Funding-carry** integrated into P&L (not an afterthought)'
  - '**Cointegration + half-life** gate before trade signal'
  - '**Same 31-gate harness** as equity strategies'
  - '**Public-data reproducible** (Binance/Bybit free data)'
outcome: |
  Pipeline gates every candidate through the standard gate stack. Funding carry is part of the
  cost model, not a P&L surprise. Research-ready for hedge-fund desks that already understand
  carry-aware systematic trading.
proof:
  - 'Memo + figure in public quant portfolio'
  - 'Methodology declared in project README'
tags: [crypto, stat-arb, funding-carry, cointegration, half-life]
lane: 'quant'
lastUpdated: 2026-07-26
---
