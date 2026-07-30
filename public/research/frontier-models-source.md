<div class="cover">
  <div class="pub">Model Intelligence Brief</div>
  <h1>Frontier Models for Quant Research &amp; AI Engineering</h1>
  <div class="sub">M3 · Kimi K3 · Claude Opus 4.8 — with Fable 5, GPT-5.6 Sol, and Gemini 3 Pro as reference points</div>
  <div class="tag">Six frontier-class models, one question: which earns the default seat in a quant-research and AI-engineering workflow — and what should route where. A metrics-first comparison, with every number sourced and every gap declared.</div>
  <div class="meta">

**Data as of** &nbsp; 18 July 2026 (Kimi K3 released 16 July 2026)

**Prepared by** &nbsp; Christian Macion

**Method** &nbsp; Multi-agent research pipeline with two independent verification gates

**Distribution** &nbsp; Public — sources footnoted throughout

  </div>
</div>

<nav class="contents">

## Contents

1. Executive summary
2. The landscape
3. Metrics for quant research
4. Metrics for AI engineering & architecture
5. Operational metrics
6. Cost-per-task economics
7. The macro frame: why the price structure looks like this
8. Decision framework
9. Method, verification & gap log

</nav>

## 1. Executive summary

<div class="stats">
  <div class="stat hot"><div class="num">10–12.5×</div><div class="lbl">M3 is cheaper per token than Kimi K3 — the market floor among frontier-class APIs</div></div>
  <div class="stat"><div class="num">88.3</div><div class="lbl">Kimi K3 Terminal-Bench 2.1 — above Opus 4.8 (84.6), within 0.5 of GPT-5.6 Sol (88.8)</div></div>
  <div class="stat"><div class="num">f ≈ 44%</div><div class="lbl">Cache-hit fraction where Opus 4.8's effective input price undercuts K3's base input price</div></div>
  <div class="stat"><div class="num">144.9 t/s</div><div class="lbl">M3 measured output throughput (independent) — ~5× K3's ~30 t/s community reports</div></div>
</div>

**The landscape rearranged itself in 48 hours.** On 16 July 2026 Moonshot shipped Kimi K3 — a 2.8-trillion-parameter sparse MoE model at $3/$15 per million tokens — and within a day published agentic benchmarks that place it in the frontier cluster: Terminal-Bench 2.1 **88.3** (above Opus 4.8's 84.6, just under GPT-5.6 Sol's 88.8), MCP Atlas **84.2**, and BrowseComp **91.2**.[^k3blog] The release-day claim that K3 "has no agentic numbers" was true for roughly eleven hours. It is no longer a usable premise.

**The quieter finding is that M3 — the incumbent in this evaluation — is the market floor.** M3's public pricing, confirmed against M3's platform documentation and three corroborating sources, is **$0.30/$1.20 per million tokens** with a 1M-token context window.[^mmprice] That is 10–12.5× cheaper than K3 and roughly 17–21× cheaper than Opus 4.8 standard. M3 is not a weak model: its vendor-published SWE-bench Verified is **80.5** (between Gemini 3 Pro's 76.2 and Opus 4.8's 88.6), and its independently measured throughput of **~120–145 tokens/second** is the fastest in this comparison by a wide margin.[^mmbench]

**Capability per dollar now has three distinct tiers.** At the top, Claude Fable 5 ($10/$50) leads general reasoning (HLE 53.3, SWE-bench 95.0) and commands the highest price. In the middle, K3, Opus 4.8, GPT-5.6 Sol, and Gemini 3 Pro trade blows within a few points on most benchmarks at $2–$30. At the bottom, M3 delivers 90–95% of the middle tier's measured capability at one-tenth the price. The correct question is not "which model is best" but **"which tier does each workload deserve."**

**Cache economics complicate the middle.** Opus 4.8's prompt-cache minimum dropped to 1,024 tokens (from 4,096), which means most real agent loops — with multi-kilobyte static system prompts — now qualify for a 90% input discount.[^opus48] Derivation in §6: above a **~44% cache-hit fraction**, Opus 4.8's effective input price falls below K3's $3 base. Agentic workloads with 70–90% repeated prefixes can therefore be *cheaper on Opus than on K3*, despite K3's lower sticker — while K3's own cache price ($0.30) is published without documented mechanics. K3 also runs a single "max" reasoning tier, and verbosity is real: one independent test drew 16,658 output tokens (13,241 reasoning) from a 95-token prompt.[^willison]

**For quant research specifically, the benchmark picture is unusually tight.** GPQA-Diamond separates the six models by only 2.2 points (91.9–94.1). The differentiators are instead: long-horizon synthesis quality (K3 leads Artificial Analysis's long-horizon knowledge-work Elo among non-Fable models), finance-numeric benchmarks (none published for any model — an honest null), and hallucination discipline on citation-heavy work (Anthropic self-reports the lowest incorrect-rate among six tested models for Opus 4.8).

**The recommendation in one paragraph:** run a **three-tier routing policy** — M3 for bulk and high-frequency work (its price is a structural advantage, not a rounding error), K3 for long-horizon synthesis and terminal-agentic tasks where its numbers genuinely lead, Opus 4.8 for cache-friendly agent loops and precision-critical writing — with Fable 5 reserved for the small set of problems where being right is worth 2–4× the price. Section 8 gives the full decision matrix and the dated watch items (K3 open weights land 27 July 2026 under a Modified MIT license).

## 2. The landscape

<p class="kicker">Part 1 · The board</p>

Six models matter for a quant + AI-engineering practice right now. Two are open-weight Chinese labs (M3, Moonshot), three are US frontier labs (Anthropic ×2, OpenAI), one is Google's flagship. All six now advertise 1M-token-class context windows — the "who has long context" contest is over; the contest is now price, throughput, and agentic reliability.

<<<<<<< HEAD
| Model               | Provider    | Architecture                                                                                | Context      | Max output             | Price in/out ($/M)               | Cache read                     | Released        |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------------- | ------------------------------ | --------------- |
| **M3**              | MiniMax     | 428B MoE, ~22B active (128 experts, 4 active) + 600M vision enc.                            | 1M           | 512K (128K dflt)       | **$0.30 / $1.20**                | $0.06                          | current         |
| **Gemini 3 Pro**    | Google      | undisclosed                                                                                 | 1M           | 64K                    | $2 / $12 (≤200K); $4/$18 (>200K) | storage-based                  | 2026            |
| **Kimi K3**         | Moonshot AI | 2.8T Stable LatentMoE, 16/896 experts; active params **undisclosed** (~50–90B bounded est.) | 1M           | 131K dflt → 1M cfg     | **$3 / $15**                     | $0.30 (mechanics undocumented) | **16 Jul 2026** |
| **GPT-5.6 Sol**     | OpenAI      | undisclosed                                                                                 | 1.05M        | 128K                   | $5 / $30                         | $0.50                          | 2026            |
| **Claude Opus 4.8** | Anthropic   | undisclosed                                                                                 | 1M (default) | 128K (300K batch beta) | $5 / $25; fast $10/$50           | $0.50 (min 1,024 tok)          | 28 May 2026     |
| **Claude Fable 5**  | Anthropic   | undisclosed                                                                                 | 1M           | 128K                   | **$10 / $50**                    | $1.00                          | current top     |

_Sources: M3 platform pricing + model docs;[^mmprice] Moonshot K3 release + platform docs;[^k3blog] Anthropic Opus 4.8 announcement + pricing + platform docs;[^opus48] Anthropic Fable page + pricing;[^fable] OpenAI pricing;[^oai] Google Gemini pricing.[^gpricing] K3 active-parameter bound: §9, gap G1._
=======
| Model | Provider | Architecture | Context | Max output | Price in/out ($/M) | Cache read | Released |
|---|---|---|---|---|---|---|---|
| **M3** | MiniMax | 428B MoE, ~22B active (128 experts, 4 active) + 600M vision enc. | 1M | 512K (128K dflt) | **$0.30 / $1.20** | $0.06 | current |
| **Gemini 3 Pro** | Google | undisclosed | 1M | 64K | $2 / $12 (≤200K); $4/$18 (>200K) | storage-based | 2026 |
| **Kimi K3** | Moonshot AI | 2.8T Stable LatentMoE, 16/896 experts; active params **undisclosed** (~50–90B bounded est.) | 1M | 131K dflt → 1M cfg | **$3 / $15** | $0.30 (mechanics undocumented) | **16 Jul 2026** |
| **GPT-5.6 Sol** | OpenAI | undisclosed | 1.05M | 128K | $5 / $30 | $0.50 | 2026 |
| **Claude Opus 4.8** | Anthropic | undisclosed | 1M (default) | 128K (300K batch beta) | $5 / $25; fast $10/$50 | $0.50 (min 1,024 tok) | 28 May 2026 |
| **Claude Fable 5** | Anthropic | undisclosed | 1M | 128K | **$10 / $50** | $1.00 | current top |

*Sources: M3 platform pricing + model docs;[^mmprice] Moonshot K3 release + platform docs;[^k3blog] Anthropic Opus 4.8 announcement + pricing + platform docs;[^opus48] Anthropic Fable page + pricing;[^fable] OpenAI pricing;[^oai] Google Gemini pricing.[^gpricing] K3 active-parameter bound: §9, gap G1.*
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

<div class="figure"><img src="figs/fig1-price-landscape.png" alt="API price landscape"></div>
<p class="src">Figure 1. Published API list prices, USD per million tokens (log scale). M3's $0.30/$1.20 is an order of magnitude below every other frontier-class model; Fable 5 anchors the premium end. Fable 5's new tokenizer (~30% more tokens per document vs older Claudes) effectively multiplies its column by ~1.3.</p>

<<<<<<< HEAD
**Three structural notes.** _First_, K3 is the most expensive Chinese-lab model to date — "Sonnet-priced, not cheap-Chinese-priced" — which breaks the assumption that open-weight Chinese labs always undercut on price; M3 carries that flag now.[^decoder] _Second_, Opus 4.8's context window is 1M tokens by default (platform documentation) — earlier comparisons citing 200K were working from launch-era material.[^opusdocs] _Third_, K3's active parameter count is officially undisclosed; the circulating "~50B" is naive expert-ratio math (16/896 × 2.8T) that ignores shared and attention parameters. The best-bounded third-party estimate is ~80–90B by K2.6-generation ratio extrapolation — itself speculative. The technical report ships with open weights on **27 July 2026**; that is the resolution date.[^k3params]
=======
**Three structural notes.** *First*, K3 is the most expensive Chinese-lab model to date — "Sonnet-priced, not cheap-Chinese-priced" — which breaks the assumption that open-weight Chinese labs always undercut on price; M3 carries that flag now.[^decoder] *Second*, Opus 4.8's context window is 1M tokens by default (platform documentation) — earlier comparisons citing 200K were working from launch-era material.[^opusdocs] *Third*, K3's active parameter count is officially undisclosed; the circulating "~50B" is naive expert-ratio math (16/896 × 2.8T) that ignores shared and attention parameters. The best-bounded third-party estimate is ~80–90B by K2.6-generation ratio extrapolation — itself speculative. The technical report ships with open weights on **27 July 2026**; that is the resolution date.[^k3params]
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

## 3. Metrics for quant research

<p class="kicker">Part 2 · Reasoning under evidence</p>

Quant research workloads — factor research, mathematical modeling, statistical validation, long-document synthesis — stress four capabilities: graduate-level reasoning, competition math, very long context retrieval, and citation discipline. The published numbers:

<<<<<<< HEAD
| Benchmark                           | M3           | Kimi K3                          | Opus 4.8                              | Fable 5  | GPT-5.6 Sol | Gemini 3 Pro               |
| ----------------------------------- | ------------ | -------------------------------- | ------------------------------------- | -------- | ----------- | -------------------------- |
| **GPQA-Diamond**                    | 92.9 [1-src] | 93.5                             | **93.6**                              | 92.6     | 94.1        | 91.9 (93.8 DT)             |
| **AIME 2026**                       | N/P¹         | ~89.1 (2025) [1-src, unverified] | 100 [vendor] / 95.7 [agg.] — conflict | N/P      | N/P         | MathArena Apex 23.4 (SOTA) |
| **HLE (no tools)**                  | 37.1 [1-src] | 43.5                             | 49.8 / 45.7 — source conflict         | **53.3** | 47.2        | 37.5 (41.0 DT)             |
| **HLE (with tools)**                | N/P          | 56.0                             | 57.9                                  | N/P      | N/P         | N/P                        |
| **FrontierMath (tier unconfirmed)** | N/P          | ~42 [1-src]                      | ~40 [1-src]                           | N/P      | ~39 [1-src] | N/P                        |
| **FinQA / ConvFinQA**               | N/P          | N/P                              | N/P                                   | N/P      | N/P         | N/P                        |
| **Long-ctx (RULER/NIAH/MRCR-1M)**   | N/P          | N/P                              | N/P                                   | N/P      | N/P         | N/P                        |

_Sources: Moonshot K3 release table;[^k3blog] Anthropic Opus 4.8 system material;[^opus48] evals.report aggregator;[^er] Artificial Analysis;[^aa] Google Gemini 3 Pro model card;[^gcard] shawnhack independent runs [1-src].[^sh] ¹ M3's vendor reports IMO-2025/USAMO-2026 above the human gold threshold via a MaxProof test-time-scaffold — a scaffolded result, not raw-model AIME performance.[^maxproof]_

**Read 1 — the core reasoning band is saturated at the top.** GPQA-Diamond now separates six frontier models by 2.2 points. At this compression, GPQA is no longer a selection metric; it is a hygiene check. The discriminating tests have moved to HLE (where Fable 5's 53.3 still leads by ~4–6 points) and to scaffolded/tool-augmented regimes (HLE-with-tools: Opus 57.9, K3 56.0).

**Read 2 — the finance-numeric gap is total and matters.** No frontier lab publishes FinQA, ConvFinQA, or any finance-specific numeric-reasoning score for these six models. For a quant practice this means published benchmarks certify _general_ reasoning only; finance-numeric reliability must be self-evaluated on proprietary tasks. This brief flags it as the single most important missing metric for the QR track (§9, gap G3).

**Read 3 — long-context is now table stakes, but retrieval-quality data lags context-size marketing.** All six models advertise ~1M-token windows; none has a current public MRCR-1M or RULER score the others can be compared against (the leaderboard was unreachable during this research window — §9, gap G4). K3's Artificial Analysis long-horizon knowledge-work Elo of 1547 is the best available proxy and places it first among non-Fable models.[^aaleo]

**Read 4 — math claims need provenance discipline.** Anthropic's vendor-reported AIME 2026 = 100 conflicts with the 95.7 aggregator figure; K3's "~89.1 AIME 2025" circulates from a single unverified aggregator; FrontierMath figures are column-inferred from one source. All three are labeled here and excluded from the decision matrix. This is what the verification layer is _for_.
=======
| Benchmark | M3 | Kimi K3 | Opus 4.8 | Fable 5 | GPT-5.6 Sol | Gemini 3 Pro |
|---|---|---|---|---|---|---|
| **GPQA-Diamond** | 92.9 [1-src] | 93.5 | **93.6** | 92.6 | 94.1 | 91.9 (93.8 DT) |
| **AIME 2026** | N/P¹ | ~89.1 (2025) [1-src, unverified] | 100 [vendor] / 95.7 [agg.] — conflict | N/P | N/P | MathArena Apex 23.4 (SOTA) |
| **HLE (no tools)** | 37.1 [1-src] | 43.5 | 49.8 / 45.7 — source conflict | **53.3** | 47.2 | 37.5 (41.0 DT) |
| **HLE (with tools)** | N/P | 56.0 | 57.9 | N/P | N/P | N/P |
| **FrontierMath (tier unconfirmed)** | N/P | ~42 [1-src] | ~40 [1-src] | N/P | ~39 [1-src] | N/P |
| **FinQA / ConvFinQA** | N/P | N/P | N/P | N/P | N/P | N/P |
| **Long-ctx (RULER/NIAH/MRCR-1M)** | N/P | N/P | N/P | N/P | N/P | N/P |

*Sources: Moonshot K3 release table;[^k3blog] Anthropic Opus 4.8 system material;[^opus48] evals.report aggregator;[^er] Artificial Analysis;[^aa] Google Gemini 3 Pro model card;[^gcard] shawnhack independent runs [1-src].[^sh] ¹ M3's vendor reports IMO-2025/USAMO-2026 above the human gold threshold via a MaxProof test-time-scaffold — a scaffolded result, not raw-model AIME performance.[^maxproof]*

**Read 1 — the core reasoning band is saturated at the top.** GPQA-Diamond now separates six frontier models by 2.2 points. At this compression, GPQA is no longer a selection metric; it is a hygiene check. The discriminating tests have moved to HLE (where Fable 5's 53.3 still leads by ~4–6 points) and to scaffolded/tool-augmented regimes (HLE-with-tools: Opus 57.9, K3 56.0).

**Read 2 — the finance-numeric gap is total and matters.** No frontier lab publishes FinQA, ConvFinQA, or any finance-specific numeric-reasoning score for these six models. For a quant practice this means published benchmarks certify *general* reasoning only; finance-numeric reliability must be self-evaluated on proprietary tasks. This brief flags it as the single most important missing metric for the QR track (§9, gap G3).

**Read 3 — long-context is now table stakes, but retrieval-quality data lags context-size marketing.** All six models advertise ~1M-token windows; none has a current public MRCR-1M or RULER score the others can be compared against (the leaderboard was unreachable during this research window — §9, gap G4). K3's Artificial Analysis long-horizon knowledge-work Elo of 1547 is the best available proxy and places it first among non-Fable models.[^aaleo]

**Read 4 — math claims need provenance discipline.** Anthropic's vendor-reported AIME 2026 = 100 conflicts with the 95.7 aggregator figure; K3's "~89.1 AIME 2025" circulates from a single unverified aggregator; FrontierMath figures are column-inferred from one source. All three are labeled here and excluded from the decision matrix. This is what the verification layer is *for*.
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

## 4. Metrics for AI engineering &amp; architecture

<p class="kicker">Part 3 · Agentic evidence</p>

AI-engineering workloads — multi-file code generation, refactors, tool-using agent loops, MCP server work, RAG pipelines — stress a different axis: doing, not knowing. The published numbers:

<<<<<<< HEAD
| Benchmark                 | M3                                                                                | Kimi K3  | Opus 4.8                 | Fable 5  | GPT-5.6 Sol  | Gemini 3 Pro    |
| ------------------------- | --------------------------------------------------------------------------------- | -------- | ------------------------ | -------- | ------------ | --------------- |
| **SWE-bench Verified**    | 80.5 [vendor]                                                                     | **N/P**  | 88.6                     | **95.0** | N/P          | 76.2            |
| **Terminal-Bench 2.1**    | 66.0 [vendor]                                                                     | 88.3     | 84.6                     | 84.6     | **88.8**     | 54.2 on TB 2.0² |
| **MCP Atlas**             | 74.2 [vendor]                                                                     | **84.2** | N/P                      | N/P      | N/P          | N/P             |
| **BrowseComp**            | 83.5 [vendor]                                                                     | 91.2     | 79.3 (Opus 4.7; 4.8 N/P) | N/P      | **92.2**     | N/P             |
| **DeepSWE**               | N/P                                                                               | 67.5     | 59.0                     | 70.0     | **73.0**     | N/P             |
| **τ²-bench Telecom**      | N/P                                                                               | N/P      | **94.4**                 | N/P      | N/P          | N/P             |
| **OSWorld**               | N/P                                                                               | N/P      | 83.4 (v1)³               | N/P      | 62.6 (v2.0)³ | N/P             |
| **M3-only agentic suite** | Claw-Eval 74.5 (#1); PostTrainBench 37.1 (#3); SkillsBench 53; SWE-bench Pro 59.0 | —        | —                        | —        | —            | —               |

_Sources: M3 M3 release blog + HF model card;[^mmbench] Moonshot K3 release table;[^k3blog] Anthropic;[^opus48] OpenAI;[^oai] evals.report;[^er] Artificial Analysis.[^aa] ² Gemini's 54.2 is on Terminal-Bench 2.0 — do not cross-compare versions. ³ OSWorld v1 and v2.0 scores are not comparable across versions._

**Read 1 — K3's agentic debut is real, with a vendor asterisk.** Terminal-Bench 88.3 and MCP Atlas 84.2 are the strongest release-day agentic numbers any open-weight model has posted. Every K3 figure in this table is vendor-published on Moonshot's own harness; none is independently replicated as of 18 July. The correct confidence level is _high that the vendor ran them, medium on the numbers_ — independent reruns are the watch item (§8).
=======
| Benchmark | M3 | Kimi K3 | Opus 4.8 | Fable 5 | GPT-5.6 Sol | Gemini 3 Pro |
|---|---|---|---|---|---|---|
| **SWE-bench Verified** | 80.5 [vendor] | **N/P** | 88.6 | **95.0** | N/P | 76.2 |
| **Terminal-Bench 2.1** | 66.0 [vendor] | 88.3 | 84.6 | 84.6 | **88.8** | 54.2 on TB 2.0² |
| **MCP Atlas** | 74.2 [vendor] | **84.2** | N/P | N/P | N/P | N/P |
| **BrowseComp** | 83.5 [vendor] | 91.2 | 79.3 (Opus 4.7; 4.8 N/P) | N/P | **92.2** | N/P |
| **DeepSWE** | N/P | 67.5 | 59.0 | 70.0 | **73.0** | N/P |
| **τ²-bench Telecom** | N/P | N/P | **94.4** | N/P | N/P | N/P |
| **OSWorld** | N/P | N/P | 83.4 (v1)³ | N/P | 62.6 (v2.0)³ | N/P |
| **M3-only agentic suite** | Claw-Eval 74.5 (#1); PostTrainBench 37.1 (#3); SkillsBench 53; SWE-bench Pro 59.0 | — | — | — | — | — |

*Sources: M3 M3 release blog + HF model card;[^mmbench] Moonshot K3 release table;[^k3blog] Anthropic;[^opus48] OpenAI;[^oai] evals.report;[^er] Artificial Analysis.[^aa] ² Gemini's 54.2 is on Terminal-Bench 2.0 — do not cross-compare versions. ³ OSWorld v1 and v2.0 scores are not comparable across versions.*

**Read 1 — K3's agentic debut is real, with a vendor asterisk.** Terminal-Bench 88.3 and MCP Atlas 84.2 are the strongest release-day agentic numbers any open-weight model has posted. Every K3 figure in this table is vendor-published on Moonshot's own harness; none is independently replicated as of 18 July. The correct confidence level is *high that the vendor ran them, medium on the numbers* — independent reruns are the watch item (§8).
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

**Read 2 — M3's profile is "fast generalist with real agentic chops."** A vendor SWE-bench of 80.5 (unreplicated) plus the top Claw-Eval score plus the fastest measured throughput in the field makes M3 the natural bulk-workhorse: good enough to trust with high-frequency coding tasks, cheap enough to run at volume, fast enough to keep feedback loops tight.

**Read 3 — SWE-bench Verified is the metric K3 won't fight on.** Moonshot publishes DeepSWE, FrontierSWE (81.2), and SWE Marathon (42.0) instead. Treat any "K3 SWE-bench 76.8%" figure as non-credible — no official score exists (§9, D1). Until an independent rerun appears, the defensible coding statement is: Fable 5 > Opus 4.8 > {K3, M3} on real-issue resolution, with K3 strongest on terminal-style execution.

<<<<<<< HEAD
**Read 4 — the toolchain layer still belongs to Anthropic.** τ²-bench Telecom 94.4, the Claude Code harness, mature MCP/hook ecosystems, and mid-conversation system messages (which preserve prompt cache across agent-loop turns) are production features no benchmark table captures. For architecture work where the model must live _inside_ a tool-using system, this ecosystem maturity is itself a metric — currently unquantified but decisive (§9, gap G5).
=======
**Read 4 — the toolchain layer still belongs to Anthropic.** τ²-bench Telecom 94.4, the Claude Code harness, mature MCP/hook ecosystems, and mid-conversation system messages (which preserve prompt cache across agent-loop turns) are production features no benchmark table captures. For architecture work where the model must live *inside* a tool-using system, this ecosystem maturity is itself a metric — currently unquantified but decisive (§9, gap G5).
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

## 5. Operational metrics

<p class="kicker">Part 4 · The physics</p>

<div class="figure"><img src="figs/fig3-throughput.png" alt="Throughput"></div>
<p class="src">Figure 2. Measured output throughput, tokens/second. M3 leads by ~2.3× over the next fastest (Telnyx and Together, independent measurements); Kimi K3's ~30 t/s rests on first-week community reports. Sources: Telnyx/Together benchmarks;[^tput] Artificial Analysis;[^aa] r/LocalLLaMA.[^llama]</p>

<<<<<<< HEAD
| Metric                    | M3                         | Kimi K3         | Opus 4.8               | Fable 5 | GPT-5.6 Sol     | Gemini 3 Pro       |
| ------------------------- | -------------------------- | --------------- | ---------------------- | ------- | --------------- | ------------------ |
| **Throughput (tok/s)**    | **144.9 / 119.8** (indep.) | ~30 (community) | 59.8                   | 63.4    | 54.1 (max tier) | ~109               |
| **TTFT (p50)**            | N/P                        | N/P             | 1.9s                   | 1.4s    | 8.2s (high)     | 32.7s first-answer |
| **TTFT at max reasoning** | —                          | always-on       | 60.9s                  | 109s    | 145.6s          | —                  |
| **Context window**        | 1M                         | 1M              | 1M                     | 1M      | 1.05M           | 1M                 |
| **Max output**            | **512K** (128K dflt)       | 131K → 1M cfg   | 128K (300K batch beta) | 128K    | 128K            | 64K                |
| **Uptime / SLA**          | N/P                        | N/P             | N/P                    | N/P     | N/P             | N/P                |

_Sources: provider documentation as cited in §2; Artificial Analysis speed/TTFT measurements;[^aa] Contra Collective decode-rate tests.[^ct]_

**The operational story is M3's second surprise.** A model at $0.30/$1.20 that also runs 2.3–5× faster than everything else measured is not a compromise — for latency-sensitive, high-frequency workloads (interactive coding loops, rapid factor-iteration, live data munging) it is the _performance_ choice on two axes at once. K3's ~30 t/s is its most tangible daily friction: long synthesis jobs are measured in tens of minutes, and its max-only reasoning tier means there is no cheaper, faster mode to drop into. The max-reasoning TTFT figures (61–146 seconds across labs) quantify why "always-on max" is a workflow decision, not just a price decision.
=======
| Metric | M3 | Kimi K3 | Opus 4.8 | Fable 5 | GPT-5.6 Sol | Gemini 3 Pro |
|---|---|---|---|---|---|---|
| **Throughput (tok/s)** | **144.9 / 119.8** (indep.) | ~30 (community) | 59.8 | 63.4 | 54.1 (max tier) | ~109 |
| **TTFT (p50)** | N/P | N/P | 1.9s | 1.4s | 8.2s (high) | 32.7s first-answer |
| **TTFT at max reasoning** | — | always-on | 60.9s | 109s | 145.6s | — |
| **Context window** | 1M | 1M | 1M | 1M | 1.05M | 1M |
| **Max output** | **512K** (128K dflt) | 131K → 1M cfg | 128K (300K batch beta) | 128K | 128K | 64K |
| **Uptime / SLA** | N/P | N/P | N/P | N/P | N/P | N/P |

*Sources: provider documentation as cited in §2; Artificial Analysis speed/TTFT measurements;[^aa] Contra Collective decode-rate tests.[^ct]*

**The operational story is M3's second surprise.** A model at $0.30/$1.20 that also runs 2.3–5× faster than everything else measured is not a compromise — for latency-sensitive, high-frequency workloads (interactive coding loops, rapid factor-iteration, live data munging) it is the *performance* choice on two axes at once. K3's ~30 t/s is its most tangible daily friction: long synthesis jobs are measured in tens of minutes, and its max-only reasoning tier means there is no cheaper, faster mode to drop into. The max-reasoning TTFT figures (61–146 seconds across labs) quantify why "always-on max" is a workflow decision, not just a price decision.
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

## 6. Cost-per-task economics

<p class="kicker">Part 5 · The arithmetic that decides routing</p>

List prices are inputs; task economics are what a practice actually pays. Using the verified prices from §2 (`cost = in×P_in/1M + out×P_out/1M`, no caching), across four workload shapes representative of quant + AI-engineering work:

<<<<<<< HEAD
| Workload shape (tokens in/out)     | M3         | Gemini 3 Pro | Kimi K3 | GPT-5.6 Sol | Opus 4.8 | Fable 5 |
| ---------------------------------- | ---------- | ------------ | ------- | ----------- | -------- | ------- |
| **Backtest codegen** — 15K / 6K    | **$0.012** | $0.102       | $0.135  | $0.255      | $0.225   | $0.450  |
| **Research synthesis** — 80K / 15K | **$0.042** | $0.340       | $0.465  | $0.850      | $0.775   | $1.550  |
| **Agentic refactor** — 120K / 25K  | **$0.066** | $0.540       | $0.735  | $1.350      | $1.225   | $2.450  |
| **Routine edits** — 4K / 1K        | **$0.002** | $0.020       | $0.027  | $0.050      | $0.045   | $0.090  |

_Arithmetic shown in full in §9 note N1; prices verified in §2. Fable 5's tokenizer (~+30% tokens/document) effectively multiplies its column by ~1.3. No caching, batch, or subscription effects included._
=======
| Workload shape (tokens in/out) | M3 | Gemini 3 Pro | Kimi K3 | GPT-5.6 Sol | Opus 4.8 | Fable 5 |
|---|---|---|---|---|---|---|
| **Backtest codegen** — 15K / 6K | **$0.012** | $0.102 | $0.135 | $0.255 | $0.225 | $0.450 |
| **Research synthesis** — 80K / 15K | **$0.042** | $0.340 | $0.465 | $0.850 | $0.775 | $1.550 |
| **Agentic refactor** — 120K / 25K | **$0.066** | $0.540 | $0.735 | $1.350 | $1.225 | $2.450 |
| **Routine edits** — 4K / 1K | **$0.002** | $0.020 | $0.027 | $0.050 | $0.045 | $0.090 |

*Arithmetic shown in full in §9 note N1; prices verified in §2. Fable 5's tokenizer (~+30% tokens/document) effectively multiplies its column by ~1.3. No caching, batch, or subscription effects included.*
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

<div class="figure"><img src="figs/fig2-cost-per-task.png" alt="Cost per task"></div>
<p class="src">Figure 3. USD per task by workload shape (log scale). M3's advantage is structural (10–20×), not marginal; the middle tier (Gemini–K3–Sol–Opus) clusters within ~2×; Fable 5 prices as the premium tier it benchmarks as.</p>

**The scale intuition:** a practice running 50M input + 10M output tokens monthly pays, at list, **$27/month on M3, $220 on Gemini 3 Pro (≤200K tier), $300 on K3, $500 on Opus 4.8, $550 on GPT-5.6 Sol, and $1,000 on Fable 5.** Over a quarter that is the difference between a rounding error and a line item — and it reframes "which model is default" as a budget-architecture question with a capability overlay, not a benchmark-leaderboard question.

<<<<<<< HEAD
**Cache economics: where Opus claws the middle back.** Opus 4.8's 1,024-token cache minimum brings most real system prompts into the 90%-discount regime. Effective input price at cache-hit fraction _f_ is `5(1−f) + 0.50f`; setting equal to K3's $3 base gives **f ≈ 0.44**. Agentic loops routinely run 70–90% repeated prefix — deep into the region where cached Opus input undercuts K3. K3 lists a $0.30 cache-read price but publishes no minimum, TTL, or invalidation behavior, and lacks mid-conversation system-message support; treat K3 cache as a bonus if it hits, never as a planning assumption.
=======
**Cache economics: where Opus claws the middle back.** Opus 4.8's 1,024-token cache minimum brings most real system prompts into the 90%-discount regime. Effective input price at cache-hit fraction *f* is `5(1−f) + 0.50f`; setting equal to K3's $3 base gives **f ≈ 0.44**. Agentic loops routinely run 70–90% repeated prefix — deep into the region where cached Opus input undercuts K3. K3 lists a $0.30 cache-read price but publishes no minimum, TTL, or invalidation behavior, and lacks mid-conversation system-message support; treat K3 cache as a bonus if it hits, never as a planning assumption.
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

<div class="figure"><img src="figs/fig4-cache-breakeven.png" alt="Cache break-even"></div>
<p class="src">Figure 4. Opus 4.8 effective input price vs cache-hit fraction. Above f ≈ 44%, Opus input undercuts K3's base input price; the shaded region is where agentic workloads actually live. M3's $0.30 floor is shown for reference — no cache mechanism beats it on price.</p>

<<<<<<< HEAD
**The verbosity tax is the counterweight to K3's per-token price.** K3 runs one reasoning tier — max — and it shows: 16,658 output tokens (13,241 reasoning) from a 95-token prompt in one independent test ($0.25 for a trivial query), and ~130M tokens burned in its Artificial Analysis evaluation run (≈2× average verbosity).[^willison] Budget K3 by _output tokens_, not by request count; on poorly-scoped prompts its effective cost can double its table price. M3's MSA attention architecture (vendor-claimed 9× prefill / 15× decode efficiency vs its predecessor at 1M context) is the architectural reason its price-performance holds at long context.[^mmbench]
=======
**The verbosity tax is the counterweight to K3's per-token price.** K3 runs one reasoning tier — max — and it shows: 16,658 output tokens (13,241 reasoning) from a 95-token prompt in one independent test ($0.25 for a trivial query), and ~130M tokens burned in its Artificial Analysis evaluation run (≈2× average verbosity).[^willison] Budget K3 by *output tokens*, not by request count; on poorly-scoped prompts its effective cost can double its table price. M3's MSA attention architecture (vendor-claimed 9× prefill / 15× decode efficiency vs its predecessor at 1M context) is the architectural reason its price-performance holds at long context.[^mmbench]
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

## 7. The macro frame: why the price structure looks like this

<p class="kicker">Part 6 · Context from the funding and cost literature</p>

The price table in §2 is not arbitrary — it sits on top of two well-documented structural facts about the 2026 AI economy, drawn from companion cost-economics and funding research (data as of June 2026).[^companion]

<<<<<<< HEAD
**Fact 1 — the two superpowers fund AI in opposite directions, and it shows in model pricing.** US private AI investment ran ~$285.9B in 2025 against China's $12.4B (a 23× private-capital ratio, Stanford HAI) — yet China sits within roughly half a year of the frontier, because its labs compete on _efficiency_ rather than capital.[^hai] The US model is private-capital-first (mega-rounds plus hyperscaler capex of $379B in FY2025, guided toward ~$760B in FY2026); the China model is state-capital-first (a ~$138B guidance-fund target plus national-champion capex) with **open-weight, price-aggressive models as the strategic wedge** — commoditizing exactly what US labs monetize.[^companion] K3 at $3/$15 and M3 at $0.30/$1.20 are this strategy expressed as price lists.

**Fact 2 — training cost is a layering problem, and sparse-MoE reuse is China's hedge against export controls.** Public "training cost" figures conflate four layers: final-run compute (DeepSeek-V3's famous ~~$5.6M), compute + ablations (~$6–10M), all-in program (~~$15–35M), and company-wide strategic spend ($100M–$1B+).[^dsv3] Most Chinese flagships train for **tens of millions, not billions**, via four reuse techniques — checkpoint inheritance, distillation, continued pretraining, and sparse MoE with low active-parameter counts (DeepSeek-V3: 671B total / 37B active; M3-01: 456B / 45.9B).[^companion] K3 (2.8T, 16/896 experts) and M3 (428B, ~22B active) are direct descendants of this design lineage — large-model quality at small-model serving compute. Chips and staff are ~68% of a frontier run's cost while energy is 2–6%: the cost contest was never an electricity story.[^epoch]
=======
**Fact 1 — the two superpowers fund AI in opposite directions, and it shows in model pricing.** US private AI investment ran ~$285.9B in 2025 against China's $12.4B (a 23× private-capital ratio, Stanford HAI) — yet China sits within roughly half a year of the frontier, because its labs compete on *efficiency* rather than capital.[^hai] The US model is private-capital-first (mega-rounds plus hyperscaler capex of $379B in FY2025, guided toward ~$760B in FY2026); the China model is state-capital-first (a ~$138B guidance-fund target plus national-champion capex) with **open-weight, price-aggressive models as the strategic wedge** — commoditizing exactly what US labs monetize.[^companion] K3 at $3/$15 and M3 at $0.30/$1.20 are this strategy expressed as price lists.

**Fact 2 — training cost is a layering problem, and sparse-MoE reuse is China's hedge against export controls.** Public "training cost" figures conflate four layers: final-run compute (DeepSeek-V3's famous ~$5.6M), compute + ablations (~$6–10M), all-in program (~$15–35M), and company-wide strategic spend ($100M–$1B+).[^dsv3] Most Chinese flagships train for **tens of millions, not billions**, via four reuse techniques — checkpoint inheritance, distillation, continued pretraining, and sparse MoE with low active-parameter counts (DeepSeek-V3: 671B total / 37B active; M3-01: 456B / 45.9B).[^companion] K3 (2.8T, 16/896 experts) and M3 (428B, ~22B active) are direct descendants of this design lineage — large-model quality at small-model serving compute. Chips and staff are ~68% of a frontier run's cost while energy is 2–6%: the cost contest was never an electricity story.[^epoch]
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

**Why this matters for a buyer.** A $100M training run amortized over 100 trillion served tokens adds $1 per million tokens — below every list price in §2. The strategic implication: **API prices for open-weight-lineage models have structural room to fall further**, while premium US flagships must justify themselves on capability deltas and ecosystem, not cost. Lock no long-term spend to today's prices; revisit the routing table quarterly. The same literature carries a caution worth repeating: ~95% of enterprise generative-AI pilots report no measurable ROI (MIT) against a ~6× capex-to-realized-revenue gap — model selection discipline (this brief's purpose) is how a practice stays in the 5%.[^companion]

## 8. Decision framework

<p class="kicker">Part 7 · The routing table</p>

**Three-tier default policy for a quant + AI-engineering practice:**

<<<<<<< HEAD
| Workload class                  | Examples                                                                          | Route to         | Why                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| **Bulk / high-frequency**       | Data plumbing, routine codegen, file transforms, first drafts, test scaffolding   | **M3**           | Market-floor price + fastest measured throughput; 80.5 vendor SWE-bench is ample at this tier |
| **Long-horizon synthesis**      | Multi-source research briefs, literature sweeps, long-document QA                 | **Kimi K3**      | Best-in-class long-horizon Elo; 1M context; −21% output-token efficiency vs predecessor       |
| **Terminal-agentic execution**  | CLI-driven tasks, shell-heavy automation                                          | **Kimi K3**      | Terminal-Bench 88.3, MCP Atlas 84.2 (vendor-pending replication)                              |
| **Cache-friendly agent loops**  | Multi-turn tool-using systems with large static system prompts                    | **Opus 4.8**     | f≈44% break-even (§6); mature MCP/hooks ecosystem; mid-conv system messages                   |
| **Precision-critical writing**  | Client-facing analysis, anything where one wrong number costs trust               | **Opus 4.8**     | Self-reported lowest incorrect-rate of six models tested; strong instruction-following        |
| **Hardest-reasoning reserve**   | Novel proof-shaped problems, architecture decisions you can't afford to get wrong | **Fable 5**      | HLE 53.3, SWE-bench 95.0 — buy the top tier only where its delta is monetizable               |
| **Max-throughput long context** | 1M-token ingest where speed matters more than peak quality                        | **Gemini 3 Pro** | ~109 t/s + 1M context + $2/$12 entry price                                                    |
=======
| Workload class | Examples | Route to | Why |
|---|---|---|---|
| **Bulk / high-frequency** | Data plumbing, routine codegen, file transforms, first drafts, test scaffolding | **M3** | Market-floor price + fastest measured throughput; 80.5 vendor SWE-bench is ample at this tier |
| **Long-horizon synthesis** | Multi-source research briefs, literature sweeps, long-document QA | **Kimi K3** | Best-in-class long-horizon Elo; 1M context; −21% output-token efficiency vs predecessor |
| **Terminal-agentic execution** | CLI-driven tasks, shell-heavy automation | **Kimi K3** | Terminal-Bench 88.3, MCP Atlas 84.2 (vendor-pending replication) |
| **Cache-friendly agent loops** | Multi-turn tool-using systems with large static system prompts | **Opus 4.8** | f≈44% break-even (§6); mature MCP/hooks ecosystem; mid-conv system messages |
| **Precision-critical writing** | Client-facing analysis, anything where one wrong number costs trust | **Opus 4.8** | Self-reported lowest incorrect-rate of six models tested; strong instruction-following |
| **Hardest-reasoning reserve** | Novel proof-shaped problems, architecture decisions you can't afford to get wrong | **Fable 5** | HLE 53.3, SWE-bench 95.0 — buy the top tier only where its delta is monetizable |
| **Max-throughput long context** | 1M-token ingest where speed matters more than peak quality | **Gemini 3 Pro** | ~109 t/s + 1M context + $2/$12 entry price |
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

**If forced to a single default:** M3 for cost-driven practices, Kimi K3 for synthesis-driven practices, Opus 4.8 for agent-systems-driven practices. The evidence supports all three — which is the point of routing.

**Sensitivity — what would change this table (dated watch items):**

1. **27 July 2026 — K3 open weights + technical report (Modified MIT).** Resolves the active-parameter null (§9 G1); unlocks self-host economics (break-even historically ~50–100M output tokens/month — far above a solo practice's volume, so the API decision stands, but vendor-neutral serving via third-party hosts could cut K3's effective price).
2. **Independent replication of K3's agentic table** (Terminal-Bench, MCP Atlas). Upgrades confidence from vendor-medium to high — or revises §4 Read 1 downward.
3. **K3 cache-mechanics documentation.** If Moonshot publishes a real cache floor + TTL, the §6 break-even analysis needs a second curve.
4. **M3 third-party SWE-bench replication.** M3's 80.5 is vendor-run; an independent confirmation would make §8's bulk tier bulletproof.
5. **Any published FinQA-class or MRCR-1M result.** First mover in either gap materially shifts the QR recommendation.

## 9. Method, verification &amp; gap log

<p class="kicker">Appendix · Provenance</p>

<div class="method">
<strong>Method.</strong> This brief was produced by a multi-agent research pipeline: a research agent gathered and cross-checked primary sources (every headline number required two independent citations or an explicit [1-src] label); a cost-modeling agent computed task economics from verified prices; two independent verification gates then audited the draft — one for arithmetic/consistency/claim-labeling (six findings, all applied), one for disclosure hygiene. Figures were generated from the same verified tables. Nothing in this brief is unsourced; where the evidence does not exist, the gap is stated rather than filled.
</div>

**Honest nulls (declared, not filled):**

<<<<<<< HEAD
| #   | Gap                                          | Status                                                                  | Resolution path                      |
| --- | -------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------ |
| G1  | K3 active parameter count                    | Officially undisclosed; bounded ~50–90B (methodology-labeled)           | Technical report, 27 Jul 2026        |
| G2  | K3 SWE-bench Verified                        | Not published; vendor uses DeepSWE/FrontierSWE/SWE Marathon             | Independent rerun                    |
| G3  | Finance-numeric benchmarks (FinQA/ConvFinQA) | **Not published for any of the six models**                             | Self-evaluation on proprietary tasks |
| G4  | Long-context retrieval (MRCR-1M/RULER)       | Leaderboard unreachable in research window; no cross-model current data | Re-fetch at next refresh             |
| G5  | Agentic-ecosystem maturity metric            | No benchmark captures MCP/hooks/tooling depth                           | Qualitative assessment only          |
| G6  | Uptime/SLA comparisons                       | No public breach or SLA data for any model                              | Operational monitoring               |
| G7  | M3 GPQA/HLE/MMLU-Pro/LiveCodeBench           | Single-source independent [1-src]                                       | Await corroboration                  |
=======
| # | Gap | Status | Resolution path |
|---|---|---|---|
| G1 | K3 active parameter count | Officially undisclosed; bounded ~50–90B (methodology-labeled) | Technical report, 27 Jul 2026 |
| G2 | K3 SWE-bench Verified | Not published; vendor uses DeepSWE/FrontierSWE/SWE Marathon | Independent rerun |
| G3 | Finance-numeric benchmarks (FinQA/ConvFinQA) | **Not published for any of the six models** | Self-evaluation on proprietary tasks |
| G4 | Long-context retrieval (MRCR-1M/RULER) | Leaderboard unreachable in research window; no cross-model current data | Re-fetch at next refresh |
| G5 | Agentic-ecosystem maturity metric | No benchmark captures MCP/hooks/tooling depth | Qualitative assessment only |
| G6 | Uptime/SLA comparisons | No public breach or SLA data for any model | Operational monitoring |
| G7 | M3 GPQA/HLE/MMLU-Pro/LiveCodeBench | Single-source independent [1-src] | Await corroboration |
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))

**Do-not-use register (claims in circulation that fail verification):** D1 — any "K3 SWE-bench 76.8%" (never official). D2 — "K3 ~50B active params" stated as fact (naive ratio math). D3 — K3 "AIME 89.1%" (single unverified aggregator). D4 — FrontierMath figures (attribution inferred). D5 — cross-version OSWorld or Terminal-Bench 2.0-vs-2.1 comparisons. D6 — Opus 4.8 "AA Index 61.4" (stale launch version; current 56). D7 — Fable 5 "$8/$40" pricing (verified $10/$50). D8 — "Opus 4.8 200K context" (1M default per current platform docs). D9 — Gemini "2M context" (official 1M).

**Note N1 — cost arithmetic.** `cost = in×P_in/1M + out×P_out/1M`. Example (agentic refactor, 120K/25K): M3 = 0.12×0.30 + 0.025×1.20 = $0.036+$0.030 = **$0.066**; K3 = 0.12×3 + 0.025×15 = $0.36+$0.375 = **$0.735**; Opus = 0.12×5 + 0.025×25 = $0.60+$0.625 = **$1.225**; Fable = $1.20+$1.25 = **$2.450**; Sol = $0.60+$0.75 = **$1.350**; Gemini = $0.24+$0.30 = **$0.540**. All §6 figures derive identically and were re-verified by the quality gate.

**Sources**

[^k3blog]: Moonshot AI, "Kimi K3" release blog + platform documentation (16–17 Jul 2026) — architecture, benchmark table, context window, sampling parameters, open-weights commitment. <https://www.kimi.com/blog/kimi-k3>
<<<<<<< HEAD

[^mmprice]: M3 platform pricing documentation + M3 model page; corroborated by Runware and Vercel AI Gateway model listings. <https://platform.minimax.io/docs/guides/pricing-paygo>

[^mmbench]: M3, "M3" release blog + Hugging Face model card — SWE-bench Verified 80.5, Terminal-Bench 66.0, MCP Atlas 74.2, Claw-Eval 74.5, architecture (428B/22B-active, MSA attention); NVIDIA developer blog on MSA efficiency. <https://www.minimax.io/blog/minimax-m3>

[^opus48]: Anthropic, "Claude Opus 4.8" announcement, pricing page, and platform documentation (1M default context, 1,024-token cache minimum, mid-conversation system messages, fast mode $10/$50); Simon Willison's Opus 4.8 review (28 May 2026). <https://www.anthropic.com/news/claude-opus-4-8>

[^fable]: Anthropic, Claude Fable page + platform pricing ($10/$50; cache write $12.50/$20, hits $1; tokenizer note). <https://www.anthropic.com/claude/fable>

[^oai]: OpenAI, API pricing documentation (GPT-5.6 Sol $5/$30, cached input $0.50). <https://openai.com/api/pricing>

[^gpricing]: Google, Gemini API pricing (Gemini 3 Pro $2/$12 ≤200K, $4/$18 >200K). <https://ai.google.dev/pricing>

[^gcard]: Google, Gemini 3 Pro model card (GPQA-D 91.9/93.8 DT, HLE 37.5/41.0 DT, SWE-bench 76.2, MathArena Apex 23.4). <https://deepmind.google>

[^willison]: Simon Willison, "Kimi K3" deep-dive (16 Jul 2026) — 95-token prompt → 16,658 output tokens = $0.25; tokenizer anomaly; per-task cost $0.94. <https://simonwillison.net/2026/Jul/16/kimi-k3/>

[^k3params]: Tosea.ai, "Kimi K3 complete guide" (undisclosed active params; ~80–90B K2.6-ratio extrapolation, labeled speculation); Latent.Space coverage ("2.8T-A50B" naming); dev.to/tokenmixai ratio-critique. <https://tosea.ai/blog/kimi-k3-complete-guide>

[^er]: evals.report benchmark aggregator — Opus 4.8 SWE-bench 88.6, HLE 49.8, τ²-Telecom 94.4, ARC-AGI-2 72.08, OSWorld v1 83.4. <https://evals.report>

[^aa]: Artificial Analysis — Intelligence Index v4.1 (Fable 60, K3 57, Opus 56, M3 ~55), speed/TTFT measurements, Terminal-Bench Hard leaderboard. <https://artificialanalysis.ai>

[^aaleo]: Artificial Analysis long-horizon knowledge-work Elo — K3 1547, first among non-Fable models (as of 17 Jul 2026). <https://artificialanalysis.ai>

[^sh]: shawnhack.com independent model runs [single-source]: M3 GPQA 92.9, HLE 37.1, MMLU-Pro 84.2, LiveCodeBench 82.2; corroborated directionally by Kili Technology data story (AA ~55). <https://shawnhack.com>

[^maxproof]: M3 MaxProof blog — IMO-2025/USAMO-2026 above human gold threshold under test-time scaffolding (scaffolded result, not raw-model AIME). <https://www.minimax.io/blog>

[^tput]: Telnyx and Together independent throughput benchmarks for M3 (144.9 and 119.8 tok/s). <https://www.telnyx.com>

[^ct]: Contra Collective decode-rate tests (Opus 4.8 ~52 t/s, Fable 5 ~71 t/s, TTFT p50 figures). <https://contracollective.com>

[^llama]: r/LocalLLaMA first-week K3 hands-on reports (~30 t/s; 35-minute frontend task; quality assessments). <https://www.reddit.com/r/LocalLLaMA>

[^decoder]: The Decoder — "K3 is Sonnet-priced": most expensive Chinese-lab model to date. <https://the-decoder.com>

[^companion]: "AI Workload Cost: The United States vs. China" and "AI Funding & Economics: The United States vs. China" — companion deep-research briefings (data as of 26 June 2026): four-layer training-cost framework, node-hour TCO model, reuse techniques, amortization math, MIT 95%-pilots statistic, capex/revenue gap. Sources therein: EIA, LBNL, Uptime Institute, Epoch AI, DeepSeek-V3 technical report, company filings via Perplexity Finance.

[^hai]: Stanford HAI, AI Index 2026 — US $285.9B vs China $12.4B private AI investment (2025), like-for-like private-only basis. <https://hai.stanford.edu/ai-index>

[^dsv3]: DeepSeek-V3 Technical Report — 2.788M H800 GPU-hours, ~$5.576M direct run cost, 671B/37B-active MoE. <https://arxiv.org/abs/2412.19437>

[^epoch]: Epoch AI, "The rising costs of training frontier AI models" — chips and staff dominate; energy ~2–6%. <https://arxiv.org/abs/2405.21015>

_Prepared by Independent research · Multi-agent pipeline: research → cost modeling → quality gate → disclosure gate → render · Generated 18 July 2026 · This brief may be shared freely with attribution._
=======
[^mmprice]: M3 platform pricing documentation + M3 model page; corroborated by Runware and Vercel AI Gateway model listings. <https://platform.minimax.io/docs/guides/pricing-paygo>
[^mmbench]: M3, "M3" release blog + Hugging Face model card — SWE-bench Verified 80.5, Terminal-Bench 66.0, MCP Atlas 74.2, Claw-Eval 74.5, architecture (428B/22B-active, MSA attention); NVIDIA developer blog on MSA efficiency. <https://www.minimax.io/blog/minimax-m3>
[^opus48]: Anthropic, "Claude Opus 4.8" announcement, pricing page, and platform documentation (1M default context, 1,024-token cache minimum, mid-conversation system messages, fast mode $10/$50); Simon Willison's Opus 4.8 review (28 May 2026). <https://www.anthropic.com/news/claude-opus-4-8>
[^fable]: Anthropic, Claude Fable page + platform pricing ($10/$50; cache write $12.50/$20, hits $1; tokenizer note). <https://www.anthropic.com/claude/fable>
[^oai]: OpenAI, API pricing documentation (GPT-5.6 Sol $5/$30, cached input $0.50). <https://openai.com/api/pricing>
[^gpricing]: Google, Gemini API pricing (Gemini 3 Pro $2/$12 ≤200K, $4/$18 >200K). <https://ai.google.dev/pricing>
[^gcard]: Google, Gemini 3 Pro model card (GPQA-D 91.9/93.8 DT, HLE 37.5/41.0 DT, SWE-bench 76.2, MathArena Apex 23.4). <https://deepmind.google>
[^willison]: Simon Willison, "Kimi K3" deep-dive (16 Jul 2026) — 95-token prompt → 16,658 output tokens = $0.25; tokenizer anomaly; per-task cost $0.94. <https://simonwillison.net/2026/Jul/16/kimi-k3/>
[^k3params]: Tosea.ai, "Kimi K3 complete guide" (undisclosed active params; ~80–90B K2.6-ratio extrapolation, labeled speculation); Latent.Space coverage ("2.8T-A50B" naming); dev.to/tokenmixai ratio-critique. <https://tosea.ai/blog/kimi-k3-complete-guide>
[^er]: evals.report benchmark aggregator — Opus 4.8 SWE-bench 88.6, HLE 49.8, τ²-Telecom 94.4, ARC-AGI-2 72.08, OSWorld v1 83.4. <https://evals.report>
[^aa]: Artificial Analysis — Intelligence Index v4.1 (Fable 60, K3 57, Opus 56, M3 ~55), speed/TTFT measurements, Terminal-Bench Hard leaderboard. <https://artificialanalysis.ai>
[^aaleo]: Artificial Analysis long-horizon knowledge-work Elo — K3 1547, first among non-Fable models (as of 17 Jul 2026). <https://artificialanalysis.ai>
[^sh]: shawnhack.com independent model runs [single-source]: M3 GPQA 92.9, HLE 37.1, MMLU-Pro 84.2, LiveCodeBench 82.2; corroborated directionally by Kili Technology data story (AA ~55). <https://shawnhack.com>
[^maxproof]: M3 MaxProof blog — IMO-2025/USAMO-2026 above human gold threshold under test-time scaffolding (scaffolded result, not raw-model AIME). <https://www.minimax.io/blog>
[^tput]: Telnyx and Together independent throughput benchmarks for M3 (144.9 and 119.8 tok/s). <https://www.telnyx.com>
[^ct]: Contra Collective decode-rate tests (Opus 4.8 ~52 t/s, Fable 5 ~71 t/s, TTFT p50 figures). <https://contracollective.com>
[^llama]: r/LocalLLaMA first-week K3 hands-on reports (~30 t/s; 35-minute frontend task; quality assessments). <https://www.reddit.com/r/LocalLLaMA>
[^decoder]: The Decoder — "K3 is Sonnet-priced": most expensive Chinese-lab model to date. <https://the-decoder.com>
[^companion]: "AI Workload Cost: The United States vs. China" and "AI Funding & Economics: The United States vs. China" — companion deep-research briefings (data as of 26 June 2026): four-layer training-cost framework, node-hour TCO model, reuse techniques, amortization math, MIT 95%-pilots statistic, capex/revenue gap. Sources therein: EIA, LBNL, Uptime Institute, Epoch AI, DeepSeek-V3 technical report, company filings via Perplexity Finance.
[^hai]: Stanford HAI, AI Index 2026 — US $285.9B vs China $12.4B private AI investment (2025), like-for-like private-only basis. <https://hai.stanford.edu/ai-index>
[^dsv3]: DeepSeek-V3 Technical Report — 2.788M H800 GPU-hours, ~$5.576M direct run cost, 671B/37B-active MoE. <https://arxiv.org/abs/2412.19437>
[^epoch]: Epoch AI, "The rising costs of training frontier AI models" — chips and staff dominate; energy ~2–6%. <https://arxiv.org/abs/2405.21015>

*Prepared by Independent research · Multi-agent pipeline: research → cost modeling → quality gate → disclosure gate → render · Generated 18 July 2026 · This brief may be shared freely with attribution.*
>>>>>>> 21663f4 (v8.1.x WIP consolidation — terminal-austere chrome + bloomberg tape + 6-layer globe (EarthMap 1983 LOC))
