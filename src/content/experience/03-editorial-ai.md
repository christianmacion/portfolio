---
title: 'AI Systems Engineer (Independent) : Editorial & Content Automation'
company: 'Editorial / content automation'
role: 'experience'
order: 3
location: 'Remote'
startDate: '2024-12'
endDate: '2025-12'
isCurrent: false
summary: 'Built an 8-agent content-production pipeline and a 290-line AI-slop evaluator that drove a real draft from HEAVY (81) to CLEAN (3).'
tags: [content-pipeline, agents, nlg, evaluation, headless-chrome]
contributions:
  - label: '8-agent content-production pipeline'
    evidence: 'topic-scout → researcher → drafter → editor → producer → art-director → chart-maker → exporter'
    proof: 'See /solutions/8-agent-editorial-pipeline'
  - label: '290-line AI-slop evaluator (13 metrics)'
    evidence: 'Drove a real draft from HEAVY (81) to CLEAN (3) : 96% reduction'
    proof: 'OSS repo (slop-scanner project, /projects/slop-scanner)'
  - label: 'Dependency-free rendering pipeline'
    evidence: 'HTML/SVG → headless-Chrome PNG; Markdown → publish-ready PDF; no LLM API cost on the output side'
    proof: 'Pipeline code on disk'
  - label: 'Measurable editorial work'
    evidence: "Each draft's slop score, iteration delta, and shipped-iteration provenance logged"
    proof: 'Logging + audit trail on disk'
proofs:
  - 'Public slop-scanner repo with scorecard'
  - 'Reuse pattern documented in systematic-strategy desk engagement methodology'
---

Built an **8-agent content-production pipeline** (topic-scout → researcher → drafter → editor → producer → art-director → chart-maker → exporter) and a 290-line **AI-output (slop) evaluator** scoring drafts on 13 literature-grounded metrics; drove a real draft from **HEAVY (index 81) to CLEAN (index 3)**.

Engineered a **dependency-free rendering pipeline** (HTML/SVG → headless-Chrome PNG; Markdown → publish-ready PDF) so the output side of the platform runs without LLM API costs.

Demonstrated that AI-assisted editorial work can be made **measurable**: each draft's slop score, iteration delta, and shipped-iteration provenance are all logged.
