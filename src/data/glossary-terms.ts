/**
 * glossary-terms.ts — single source of truth for the /glossary page
 * (single-page alphabetical list) and /glossary/[slug] deep pages
 * (one per term with longer-form prose + related terms).
 *
 * Adding a new term: append a new entry below. Both routes re-render
 * automatically via the Astro content collections convention.
 */
import { profile } from '../utils/profile';

// Gate-count chrome: derives from profile.stats.evalGates so flipping
// 31 → 32 in profile.ts propagates to all 15 "G1–G31" / "31-gate" /
// "31 gates" references across the glossary entries. Specific gate
// names (G2, G9, G11, G18, G21, G22, G24, G25, G30) stay inline —
// they're stable identifiers, not count-derived.
const GATES = profile.stats.evalGates;
const GATE_RANGE = `G1 to G${GATES}`;
const NGATE = `${GATES}-gate`;

export type GlossaryCategory = 'Quant' | 'AI';

export interface GlossaryTerm {
  /** Stable kebab-case id; used as the URL slug for /glossary/[id] */
  id: string;
  /** Display term, e.g. "Deflated Sharpe Ratio" or "Block bootstrap" */
  term: string;
  category: GlossaryCategory;
  /** <280-char blurb; shown on the index /glossary/ page and the deep page */
  short: string;
  /** Longer prose for the deep page. 1-3 short paragraphs. */
  extended: string;
  /** 3-6 kebab-case term ids of related terms; deep page renders them as cross-links */
  related: string[];
}

export const terms: GlossaryTerm[] = [
  {
    id: 'agent-charter',
    term: 'Agent charter',
    category: 'AI',
    short:
      "A short document that defines an AI agent's job, inputs, outputs, and failure modes before it is built. Every agent on this site ships with one.",
    extended:
      "An agent charter is the contract a multi-agent system signs before the first tool call. It names the agent's role, the JSON-schema inputs it accepts, the JSON-schema outputs it must return, the eval harness that grades it, and a short list of failure modes the agent must explicitly refuse or escalate. Charter-first design keeps agents from drifting into the space where they 'look productive but aren't measurable.' On this site, every agent in the orchestrator-worker platform has a published charter so the system's behaviour is auditable rather than emergent.",
    related: ['multi-agent', 'eval-harness', 'json-schema', 'mcp'],
  },
  {
    id: 'alpha',
    term: 'Alpha (α)',
    category: 'Quant',
    short:
      "The portion of an investment's return that is not explained by exposure to broad market risk. The signal beyond the benchmark.",
    extended: `Alpha is the residual return after stripping out beta, sector, style, and factor exposure. In a systematic book, alpha is what the strategy is supposed to produce in excess of its benchmark. The qualitative question. does this strategy actually have alpha? to is the question the ${GATE_RANGE} evaluation stack on /methodology is designed to answer honestly. A positive expected alpha that survives walk-forward, multiple-testing correction, and out-of-sample testing is what counts as 'real' alpha on this site.`,
    related: ['sharpe', 'deflated-sharpe', 'pbo', 'cscv-pbo', 'walk-forward'],
  },
  {
    id: 'block-bootstrap',
    term: 'Block bootstrap',
    category: 'Quant',
    short:
      'A resampling method that preserves short-term autocorrelation in time-series by sampling contiguous blocks rather than individual data points. Used to build honest confidence intervals.',
    extended: `A block bootstrap draws resamples by sampling whole contiguous blocks of observations, then concatenating them, instead of drawing individual points independently. The block length is chosen to exceed the longest horizon over which the strategy's returns are autocorrelated (look-ahead, position-holding period, signal-half-life). This preserves the variance and clustering of the original series, which ordinary i.i.d. bootstrap destroys. On this site, block-bootstrap is one of the ${GATE_RANGE} evaluation gates. gate G18 uses it to build confidence intervals on Sharpe, drawdown, and turnover without breaking the time-series structure of returns.`,
    related: ['walk-forward', 'deflated-sharpe', 'sharpe', 'embargo'],
  },
  {
    id: 'bonferroni-holm',
    term: 'Bonferroni to Holm correction',
    category: 'Quant',
    short:
      'A multiple-testing correction applied when many hypothesis tests are run at once. Prevents the probability of any false positive from inflating as the number of tests grows.',
    extended: `When a strategy search runs hundreds or thousands of hypothesis tests in parallel. backtests, factor regressions, parameter sweeps. the family-wise error rate (probability of at least one false positive) inflates with the number of tests. The Bonferroni to Holm correction adjusts each test's p-value by a step-down procedure that controls the family-wise error rate while staying less conservative than the plain Bonferroni. On this site, Bonferroni to Holm is gate G24 of the ${GATE_RANGE} evaluation stack: every quantitative project reports the corrected p-value for its headline test, not the raw one.`,
    related: ['deflated-sharpe', 'pbo', 'cscv-pbo', 'minbtl'],
  },
  {
    id: 'cscv-pbo',
    term: 'CSCV / PBO',
    category: 'Quant',
    short:
      'Combinatorially Symmetric Cross-Validation, the standard method for estimating Probability of Backtest Overfitting. Tells you how many of your backtest winners would have been selected by chance alone.',
    extended: `CSCV (Combinatorially Symmetric Cross-Validation), introduced by Bailey, Borwein, López de Prado, and Zhu (2014), is the standard method for estimating the Probability of Backtest Overfitting (PBO). It partitions the backtest time-series into N blocks, then iterates over all 2^N combinations of training/test splits. The proportion of splits in which the best in-sample strategy underperforms the median out-of-sample is the PBO estimate. A PBO of 50% means half your 'best' strategies would have lost out-of-sample by chance. On this site, CSCV is gate G22 of the ${GATE_RANGE} evaluation stack; every quant project reports its PBO with the block count and split count disclosed.`,
    related: ['pbo', 'walk-forward', 'deflated-sharpe', 'minbtl', 'block-bootstrap'],
  },
  {
    id: 'cointegration',
    term: 'Cointegration',
    category: 'Quant',
    short:
      'A statistical property of two or more time-series that move together in the long run even though each one individually wanders. The basis for pairs and stat-arb strategies.',
    extended:
      "Two price series are cointegrated if a linear combination of them is stationary (mean-reverting) even though each series is itself non-stationary. The Engle to Granger test and the Johansen test are the standard estimators. Cointegration is the statistical foundation of pairs trading, statistical arbitrage, and spread trading: it lets you bet on the spread returning to its mean rather than on either leg's absolute direction. On this site, cointegration is the statistical primitive behind at least one of the 9 quant projects listed on /projects.",
    related: ['regime', 'walk-forward', 'block-bootstrap', 'drawdown'],
  },
  {
    id: 'deflated-sharpe',
    term: 'Deflated Sharpe Ratio (DSR)',
    category: 'Quant',
    short:
      'A correction to the Sharpe ratio that adjusts for the number of trials, the distribution of returns, and the skew/kurtosis of the strategy. Tells you whether a high Sharpe is real or a multiple-testing artifact.',
    extended: `The Deflated Sharpe Ratio (Bailey & López de Prado, 2014) adjusts the observed Sharpe for: (1) the number of trials run (multiple-testing correction), (2) the non-normality of returns (skew and kurtosis), and (3) the correlation between strategies in the trial set. A backtest Sharpe of 1.5 that emerged from a 50-trial search is much less impressive than the same Sharpe from a single test. On this site, DSR is gate G21 of the ${GATE_RANGE} evaluation stack. every quant project reports DSR alongside the raw Sharpe so the recruiter can tell signal from search.`,
    related: ['sharpe', 'pbo', 'cscv-pbo', 'bonferroni-holm', 'minbtl'],
  },
  {
    id: 'drawdown',
    term: 'Drawdown (DD)',
    category: 'Quant',
    short:
      'The peak-to-trough decline of an equity curve over a specified window. The most-cited measure of risk in a systematic book.',
    extended: `Maximum drawdown is the largest peak-to-trough percentage decline of a strategy's equity curve. Average drawdown and drawdown duration (time to recovery) are also standard. Drawdown is the risk measure most clients and recruiters actually care about. even a high-Sharpe strategy with a 60% max drawdown is unsellable. On this site, every quant project reports max DD, average DD, and recovery time at the OOS sample. Gate G9 of the ${GATE_RANGE} evaluation stack requires DD reporting on a transaction-cost-adjusted basis.`,
    related: ['sharpe', 'deflated-sharpe', 'slippage', 'walk-forward'],
  },
  {
    id: 'embargo',
    term: 'Embargo',
    category: 'Quant',
    short:
      'A gap between the train set and the test set in walk-forward evaluation. Prevents leakage of recent information into the model used for older data.',
    extended:
      'An embargo is a deliberate gap inserted between the training window and the test window in walk-forward or rolling-origin evaluation. Without an embargo, the test set can leak information back into the training set via look-ahead in features that depend on forward-looking data (rolling means, regime labels, factor scores). On this site, every walk-forward evaluation uses an embargo of at least 1 bar between train and test; the embargo length is reported as part of gate G7.',
    related: ['walk-forward', 'block-bootstrap', 'oos'],
  },
  {
    id: 'eval-harness',
    term: 'Eval harness',
    category: 'AI',
    short:
      'A test rig that runs a model or agent through a fixed set of inputs, scores the outputs against a rubric, and persists the scores for trend analysis. The AI equivalent of a quant backtest.',
    extended:
      'An eval harness is the AI-engineering equivalent of a quant backtest: a reproducible test rig that pins a model version, runs it through a fixed input set, scores outputs against a rubric (JSON-schema validators, BLEU/ROUGE, LLM-as-judge panels, ground-truth references), and persists the scores for trend analysis. The harness makes model behaviour auditable. On this site, the eval-mcp-server ships a reference harness that hits 100% round-trip parity on JSON-schema outputs across 20 prompts; the numerical-faithfulness-eval hits similar accuracy on quantitative reasoning prompts.',
    related: ['agent-charter', 'frozen-spec', 'json-schema', 'llm-as-judge'],
  },
  {
    id: 'frozen-spec',
    term: 'Frozen spec',
    category: 'AI',
    short:
      'A pinned version of a model, prompt, and tool set used inside an eval. The spec is immutable for the duration of the eval so scores are reproducible.',
    extended:
      'A frozen spec is the AI-equivalent of a fixed backtest universe. It pins: the model id and version, the system prompt, the tool schema, the temperature and seed, and the JSON-schema validators. Once frozen, no spec element may change for the duration of the eval. any change forces a new eval version. On this site, every published eval ships its frozen-spec manifest as a JSON sidecar so the scores can be reproduced by a third party.',
    related: ['eval-harness', 'agent-charter', 'json-schema'],
  },
  {
    id: 'g1-g31',
    term: `${GATE_RANGE} (evaluation gates)`,
    category: 'Quant',
    short: `A ${NGATE} statistical evaluation stack applied to every quantitative project on this site. Covers leakage, multiple-testing, walk-forward, DSR, PBO, transaction-cost modelling, and OOS paper-trade.`,
    extended: `${GATE_RANGE} is the canonical evaluation stack used on this site. Every quant project passes through all ${GATES} gates before being published. Gates cover: (G1 to G6) data hygiene and PIT discipline, (G7 to G10) leakage and embargo, (G11 to G15) walk-forward and OOS, (G16 to G20) block-bootstrap and variance estimation, (G21) deflated Sharpe, (G22) CSCV/PBO, (G23) Bonferroni to Holm, (G24) MinBTL, (G25 to G28) transaction-cost and slippage modelling, (G29) OOS paper-trade gate, (G30) regime stratification, (G31) reproducibility. The full gate list and per-project compliance is on /methodology.`,
    related: ['deflated-sharpe', 'pbo', 'cscv-pbo', 'walk-forward', 'block-bootstrap', 'minbtl'],
  },
  {
    id: 'json-schema',
    term: 'JSON Schema',
    category: 'AI',
    short:
      'A declarative specification for the shape of a JSON document. Used as a contract between agents and as a validator inside eval harnesses.',
    extended:
      'JSON Schema (draft 2020-12) is a declarative language for describing the shape, types, and constraints of a JSON document. On this site, every agent in the orchestrator-worker platform declares a JSON-schema for its inputs and outputs; every eval harness uses JSON-schema validation as the first line of correctness checking. This keeps agent boundaries machine-verifiable and lets the eval harness fail-fast on schema violations before invoking more expensive LLM-as-judge scoring.',
    related: ['agent-charter', 'eval-harness', 'frozen-spec', 'mcp'],
  },
  {
    id: 'llm-as-judge',
    term: 'LLM-as-judge',
    category: 'AI',
    short:
      'Using a language model to grade the outputs of another model on dimensions that are hard to express as a deterministic check (tone, completeness, faithfulness).',
    extended:
      'LLM-as-judge uses one language model to score the outputs of another. It is the only practical way to grade open-ended qualities (faithfulness, tone, completeness, qualitative correctness). The technique is biased. the judge model shares failure modes with the candidate. so it must be paired with at least one deterministic ground-truth check and a panel of at least two judge models for high-stakes scoring. On this site, LLM-as-judge appears in the numerical-faithfulness-eval as one of three scoring lanes alongside exact-match and calculator grounding.',
    related: ['eval-harness', 'frozen-spec', 'json-schema'],
  },
  {
    id: 'mcp',
    term: 'MCP (Model Context Protocol)',
    category: 'AI',
    short:
      'A protocol for connecting language models to tools, data sources, and other agents over a typed JSON-RPC interface. The eval-mcp-server on this site conforms to MCP 2025-06-18.',
    extended:
      'MCP (Model Context Protocol, Anthropic 2024) is a typed JSON-RPC protocol for exposing tools, resources, and prompts to a language model. The model declares which tools it wants to call, the host routes the call to the MCP server, and the server returns a JSON-schema-validated response. On this site, the eval-mcp-server is a reference MCP implementation that hits 100% conformance with the 2025-06-18 spec and ships a public eval harness.',
    related: ['json-schema', 'eval-harness', 'agent-charter', 'multi-agent'],
  },
  {
    id: 'minbtl',
    term: 'MinBTL (Minimum Backtest Length)',
    category: 'Quant',
    short:
      'The minimum number of trades a backtest must contain before its Sharpe ratio is statistically distinguishable from zero at a given confidence level.',
    extended: `MinBTL (Minimum Backtest Length, Bailey et al., 2017) is the minimum number of trades a backtest must contain before its observed Sharpe ratio can be trusted to be statistically distinguishable from zero. A backtest with 12 trades and a Sharpe of 1.5 is essentially noise; a backtest with 1,200 trades and a Sharpe of 1.5 is signal. MinBTL formalises the intuition. On this site, MinBTL is gate G24 of the ${GATE_RANGE} evaluation stack; every published project reports its trade count against the MinBTL threshold for its target Sharpe.`,
    related: ['deflated-sharpe', 'pbo', 'cscv-pbo', 'walk-forward'],
  },
  {
    id: 'multi-agent',
    term: 'Multi-agent system',
    category: 'AI',
    short:
      'A system composed of multiple specialised agents that coordinate to complete tasks a single agent could not. The orchestrator-worker pattern is the dominant topology.',
    extended:
      "A multi-agent system decomposes a complex task into specialised sub-tasks, each handled by an agent with a narrow charter. The orchestrator-worker pattern has one orchestrator that decomposes the user request and dispatches it to workers; workers report back with JSON-schema-validated outputs; the orchestrator synthesises the final answer. On this site, the orchestrator-worker platform runs 11 specialised agents with published charters and an eval harness that scores each agent's contribution independently.",
    related: ['agent-charter', 'mcp', 'json-schema', 'eval-harness'],
  },
  {
    id: 'oos',
    term: 'Out-of-sample (OOS)',
    category: 'Quant',
    short:
      'Data the model has never seen during training or parameter selection. The closest a backtest gets to a real test of generalisation.',
    extended: `Out-of-sample (OOS) data is the held-out portion of the historical record that the model was neither trained on nor used to select hyperparameters against. A backtest's OOS performance is the most honest signal of how the strategy would have behaved live. On this site, OOS is gated by G11 to G15 of the ${GATE_RANGE} evaluation stack: every published project reports its OOS window start, end, and embargo separately from its in-sample window.`,
    related: ['walk-forward', 'embargo', 'block-bootstrap'],
  },
  {
    id: 'pbo',
    term: 'PBO (Probability of Backtest Overfitting)',
    category: 'Quant',
    short:
      'The probability that the best backtest winner, selected by in-sample performance, underperforms the median out-of-sample. Estimated by CSCV.',
    extended:
      "PBO is the probability that a backtest search overfits. i.e. that the 'best' in-sample strategy underperforms the median OOS strategy, implying the selection was driven by chance rather than signal. PBO is estimated by Combinatorially Symmetric Cross-Validation (CSCV). A PBO below 25% is conventionally acceptable; above 50% means the search has produced more losers than winners regardless of which one looked best in-sample. On this site, PBO is reported as a per-project transparency metric on /proof.",
    related: ['cscv-pbo', 'deflated-sharpe', 'walk-forward', 'bonferroni-holm'],
  },
  {
    id: 'rag',
    term: 'RAG (Retrieval-Augmented Generation)',
    category: 'AI',
    short:
      'A pattern where a language model is given retrieved context (chunks from a vector store) before generating its answer. Reduces hallucination on factual queries.',
    extended:
      "Retrieval-Augmented Generation (RAG) pairs a language model with a vector store: at inference time, the query is embedded, the top-k most similar chunks are retrieved, and those chunks are inserted into the model's context window as grounding. RAG reduces hallucination on factual queries because the model has access to the source material rather than relying on its parametric memory. On this site, the qfin-rag-harness is a reference RAG stack for financial-document QA with an eval harness that scores retrieval recall and answer faithfulness.",
    related: ['eval-harness', 'json-schema', 'llm-as-judge'],
  },
  {
    id: 'regime',
    term: 'Regime',
    category: 'Quant',
    short:
      'A persistent state of the market (high-vol, low-vol, trending, mean-reverting, risk-on, risk-off) that affects which strategies work and which do not.',
    extended: `A regime is a persistent state of the market characterised by a cluster of co-moving indicators (realised volatility, trend strength, correlation structure, central-bank stance). Strategies that work in a low-vol trending regime often fail in a high-vol mean-reverting one. On this site, gate G30 of the ${GATE_RANGE} evaluation stack requires every quant project to report performance stratified by regime, not just aggregate Sharpe.`,
    related: ['cointegration', 'drawdown', 'walk-forward'],
  },
  {
    id: 'sharpe',
    term: 'Sharpe ratio',
    category: 'Quant',
    short:
      'The average excess return of a strategy divided by its standard deviation. The canonical risk-adjusted return measure.',
    extended:
      'The Sharpe ratio (Sharpe 1966) measures the average excess return per unit of total volatility. It is the most-cited risk-adjusted return metric in quant work but is biased by non-normality (skew, kurtosis) and by multiple-testing (a search over many strategies inflates the maximum Sharpe by chance). On this site, the headline Sharpe of every published project is paired with its Deflated Sharpe Ratio (DSR) and its MinBTL threshold so the reader can judge whether the number is real.',
    related: ['deflated-sharpe', 'minbtl', 'pbo', 'cscv-pbo'],
  },
  {
    id: 'slippage',
    term: 'Slippage',
    category: 'Quant',
    short:
      'The difference between the expected fill price of a trade and the price at which it actually executes. A major component of transaction cost in liquid markets.',
    extended: `Slippage is the gap between the price the model expected when it placed an order and the price at which the order actually filled. It arises from latency, market impact, and queue position. In liquid markets it is small; in less-liquid markets it can be the difference between a profitable strategy and a losing one. On this site, gate G25 of the ${GATE_RANGE} evaluation stack requires every published backtest to model slippage explicitly with a per-asset basis-points assumption that is disclosed alongside the backtest.`,
    related: ['drawdown', 'walk-forward', 'g1-g31'],
  },
  {
    id: 'survivorship-bias',
    term: 'Survivorship bias',
    category: 'Quant',
    short:
      'A dataset error where only assets that "survived" to the present are included, biasing the historical sample toward winners. Common in equity-index backtests.',
    extended: `Survivorship bias arises when a historical dataset excludes assets that have since been delisted, merged, or gone bankrupt. The remaining sample is biased toward winners, which inflates backtest performance. On this site, gate G2 of the ${GATE_RANGE} evaluation stack requires every equity or index backtest to use a survivorship-bias-free universe (point-in-time constituent history) and to disclose the source.`,
    related: ['pbo', 'oos', 'walk-forward', 'embargo'],
  },
  {
    id: 'walk-forward',
    term: 'Walk-forward evaluation',
    category: 'Quant',
    short:
      'A rolling evaluation where the model is retrained on a moving window and tested on the immediately following window. The most honest single-shot backtest.',
    extended: `Walk-forward evaluation slides a fixed-width training window forward through time, retraining the model on each window and testing on the next. The concatenated test predictions form the OOS performance series. Walk-forward is the standard method for honest backtesting on time-series data because it preserves the chronological order and avoids the look-ahead bias of k-fold cross-validation. On this site, walk-forward is gate G11 of the ${GATE_RANGE} evaluation stack; every published project reports its walk-forward OOS Sharpe with window size and step size disclosed.`,
    related: ['oos', 'embargo', 'block-bootstrap', 'deflated-sharpe'],
  },
];
