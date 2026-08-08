---
title: '7-Agent Venture Incubation Pipeline'
slug: '7-agent-venture-pipeline'
category: 'AI Systems Engineering'
order: 2
client: 'Macion Ventures'
problem: |
  An operator-led venture incubation arm needed a repeatable way to triage, brief, and ledger new
  business ideas : without one human bottleneck, and without the agent that proposes a decision
  being the same one that approves it.
approach: |
  Built a **7-agent pipeline** (5 judgment-tier + 2 mechanical) with 10 lifecycle skills and an
  **anti-self-approval governance pattern**: the agent that proposes never approves. Encoded
  Philippine tax / regulatory rules (DTI / SEC / BIR / LGU, ₱3M VAT threshold, 8%-flat vs graduated
  election) directly into agent and skill prompts so the research output is jurisdiction-aware at
  the prompt level : not bolted on at the end.
evidence:
  - '**31 decision-grade artifacts** (charters, briefs, ledger entries) shipped'
  - '**Anti-self-approval** governance pattern documented as a reusable convention'
  - '**Jurisdiction-aware prompting** for PH tax/regulatory rules'
outcome: |
  Produced a clean separation-of-duties trail : every proposal had a corresponding validator hand-off,
  the validator never originated the proposal, and every decision was ledgered for later audit.
  The same separation-of-duties principle was reused at the systematic-strategy desk for LLM research validation.
proof:
  - '31 artifacts on disk (charters, briefs, ledgers)'
  - 'Reuse pattern documented in systematic-strategy desk engagement methodology'
tags: [multi-agent, governance, venture, prompts, separation-of-duties]
lane: 'ai'
---
