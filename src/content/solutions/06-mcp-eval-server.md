---
title: 'Eval MCP Server : 31 Gates as First-Class Tools'
slug: 'eval-mcp-server'
category: 'AI Systems Engineering'
order: 6
client: 'Self-directed / OSS'
problem: |
  LLM eval harnesses live in code or in spreadsheets : neither is a clean integration target for
  multi-agent pipelines. A multi-agent system needs the eval gates exposed as **tools**, not as
  Python imports.
approach: |
  Built an **MCP server** that exposes the 31-gate statistical evaluation harness as discoverable
  tools. Each gate has a typed contract (input schema, output schema, exit codes). An agent can
  dispatch a strategy candidate through the gate stack via MCP without owning the implementation.
  **The mechanical validator enforces exit-0** before downstream agents consume the result.
evidence:
  - '**MCP-compliant** server (Claude Agent SDK / Cursor / etc. can connect)'
  - '**31 typed tools** (one per gate)'
  - '**Exit-0 contract** enforced by mechanical validator'
  - '**No agent can bypass** the gate stack when calling downstream'
outcome: |
  The eval harness becomes the **single source of truth** for what counts as "passed validation" :
  whether the input is an LLM output or a systematic strategy. Reusable across projects.
proof:
  - 'Open-source repo (eval-mcp-server) with scorecard'
  - 'Documented in AI portfolio README'
tags: [MCP, eval-harness, multi-agent, contract-first]
lane: 'ai'
---
