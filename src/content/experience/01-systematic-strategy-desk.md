---
title: 'AI Systems Engineer / Quantitative Researcher (contract)'
company: 'systematic-strategy desk (NDA-protected; closed past contract 03/2026 – 06/2026)'
role: 'experience'
order: 1
location: 'Remote'
startDate: '2026-03'
endDate: '2026-06'
isCurrent: false
summary: 'Architected the 11-agent AI research platform and the 31-gate statistical eval harness used by the desk under a PM with publicly attributable initials. (Past contract; closed 06/2026.)'
tags: [multi-agent, eval-harness, quant-research, MCP, model-routing]
contributions:
  - label: '11-agent orchestrator + 31-gate eval harness'
    evidence: 'Public scorecards for the eval gates (G1–G31); methodology in publications log'
    proof: 'See /solutions/11-agent-eval-platform + methodology page'
  - label: 'Deflated Sharpe, CSCV-based PBO, MinBTL'
    evidence: 'Three canonical multiple-testing corrections in one gate stack'
    proof: 'OSS repo (deflated-sharpe module); publications log entry'
  - label: '5 asset-class systematic research'
    evidence: 'Locked OOS windows, frozen-spec evaluation per candidate'
    proof: 'Memo + figure for each (public-data)'
  - label: 'Public-data PIT data pipeline'
    evidence: 'byte-range subsetting, gap guards, idempotent incremental pulls'
    proof: 'Pipeline code in public quant portfolio'
proofs:
  - 'Contract disclosed under NDA — role: AI Systems Engineer / Quantitative Researcher. PM with publicly attributable initials (NDA-protected desk).'
  - 'Eval harness methodology (G1–G31, deflated Sharpe, block-bootstrap CIs) carried forward into the public methodology page'
  - 'All deliverables NDA-safe; no proprietary data sources referenced'
---

Designed and operated an **11-agent orchestrator-worker AI research platform** (~27,500 words of role-scoped agent charters) with contracted hand-off packets, few-shot routing, and separation-of-duties between generation, validation, and documentation agents — backed by ~76,500 LOC of light-dependency Python.

Built a **31-gate statistical evaluation harness** (G1–G31): block-bootstrap CIs, random-timing nulls, walk-forward, 5-era stability, plus a multiple-testing layer (Deflated Sharpe, CSCV-based PBO, Minimum Backtest Length) — implemented `scipy`-free in numpy and used to validate both LLM outputs and systematic-trading strategies.

Architected a **tiered model-routing policy** (Opus = judgment / Sonnet = assembly / Haiku = mechanical / Fable = hardest autonomous) with per-dispatch token budgeting — the cost layer that keeps a multi-agent system (measured at ~15× single-agent token cost) economical to run continuously — plus structured-output contracts gated by a mechanical validator (must exit 0).

Researched and validated systematic trading strategies across **5 asset classes** (equity-index, crypto, energy, metals, agriculture) on the desk's statistical-filter platform; shipped candidates through paper-shadow and live forward out-of-sample testing under pre-registration and frozen-spec evaluation.

Built **point-in-time, look-ahead-disciplined data pipelines** from scratch on free public sources; implemented byte-range subsetting, completeness guards, gap logging, and idempotent incremental pulls to produce reproducible research-grade datasets.

Caught and documented **false positives as enforced methodology** — banking each into the desk's reusable research-integrity playbook — and designed an automated monthly forward-out-of-sample monitoring fleet (scheduled data pull → S3 sync → frozen-spec evaluation → ledger) that produces un-gameable live performance evidence.
