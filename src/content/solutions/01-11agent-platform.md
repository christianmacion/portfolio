---
title: '11-Agent Eval-First Research Platform'
slug: '11-agent-eval-platform'
category: 'AI Systems Engineering'
order: 1
client: 'systematic-strategy desk (NDA-protected; closed past contract 03/2026 – 06/2026)'
problem: |
  A small systematic-trading desk needed an AI workflow that could keep pace with the research pipeline
  *without* shipping hallucinated or unverifiable analysis. The naive path — a single agent with one
  prompt — produced plausible but unfalsifiable outputs. The desk needed something closer to a research
  organization than a chatbot.
approach: |
  Built an **orchestrator + worker topology** with 11 agents, ~27,500 words of role-scoped charters, and
  contracted hand-off packets between generation, validation, and documentation roles. Added a 31-gate
  statistical evaluation harness (G1–G31) that ran the same validation stack on LLM outputs and
  on the desk's systematic trading strategies — so the *same* notion of "evidence" applied across
  both. Tiered model-routing (Opus = judgment, Sonnet = assembly, Haiku = mechanical) kept the
  ~15× token multiplier economical.
evidence:
  - '~27,500 words of role-scoped agent charters'
  - '31-gate statistical evaluation harness (G1–G31)'
  - '~76,500 LOC light-dependency Python'
  - '5 asset classes researched (equity-index, crypto, energy, metals, agriculture)'
  - '~15× token cost vs single-agent, offset by tiered routing'
outcome: |
  Caught and documented false positives as enforced methodology (each banked into the desk's research-integrity
  playbook). Shipped an automated monthly forward-OOS monitoring fleet — scheduled data pull → S3 sync →
  frozen-spec evaluation → ledger — that produced un-gameable live performance evidence.
proof:
  - 'Contract disclosed under NDA — PM with publicly attributable initials (NDA-protected desk)'
  - 'Eval harness methodology (G1–G31, deflated Sharpe, block-bootstrap CIs, walk-forward) carried forward into the public methodology page'
  - 'All deliverables NDA-safe; no proprietary data sources referenced'
tags: [multi-agent, eval-harness, MCP, model-routing, walk-forward, deflated-sharpe]
lane: 'ai'
---
