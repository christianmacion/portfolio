---
title: '8-Agent Editorial Production Pipeline (SLOP ↓ 96%)'
slug: '8-agent-editorial-pipeline'
category: 'AI Systems Engineering'
order: 3
client: 'Editorial AI / Content Automation'
problem: |
  A high-volume editorial workflow was generating content with a measurable "slop index" — generic,
  templated, easily-detected text. Quality gate was after-the-fact and manual. Production scaled
  faster than the editorial team could review.
approach: |
  Built an **8-agent content production pipeline** with a **SLOP-scanner** (proprietary eval gate)
  woven into the pipeline as a mechanical validator. The scanner measured the proportion of stock
  phrases, hedge words, and un-statistical copy against a baseline corpus, and gated publication.
  Agents were chartered to **rewrite before publishing**, not to publish first and edit later.
evidence:
  - '**SLOP index dropped from 81 → 3** on the working corpus'
  - '**Mechanical validator** enforced the gate (exit-0 contract)'
  - '**Rewrite-before-publish** semantics in the agent charter'
outcome: |
  Production volume held; editorial-review labor fell (the gate did the rejection). The
  SLOP-scanner is one of the OSS projects in the AI portfolio (separate repo).
proof:
  - 'Scorecard JSON for the SLOP scanner is OSS'
  - 'Pipeline charter documented in editorial-ai engagement'
tags: [multi-agent, content, eval-gate, slop-scanner]
lane: 'ai'
lastUpdated: 2026-07-26
---
