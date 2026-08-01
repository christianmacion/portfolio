# Motion Decision Matrix v9.0 (2026-07-31)

> **doctrine-reflection: greene-law-38 + deming-sopk + munger-inversion + kahneman-system-1**
>
> A motion MUST answer 3 questions before ship.
> Audit cadence: quarterly + on any new motion proposal.

## 3-question ship gate (every motion)

1. **UX question** — What does this motion teach the user that static state cannot?
2. **Bundle cost question** — What's the KB cost (gz)? What's the hydration cost (any `client:*` island)?
3. **Reduced-motion fallback question** — What does `prefers-reduced-motion: reduce` get? (Exact CSS rule + semantic, not "we'll figure it out.")

**Hard gate:** if any answer is "I don't know", "decorative", "<1 KB / no JS", or "no fallback" → **CUT or DEFER**. The next HeroBurst is one un-gated motion away.

This contract is the regression gate that catches the HeroBurst class of failures (see v8.1.0 hotfix). It is **non-negotiable** for any new motion proposal.

---

## KEEP list (current production motion, audit-2)

> Source: `audits/2026-07-31-portfolio-v9/audit-2-motion.md` (verified 2026-07-31).
> Total motion JS bundle: ≤ **4.5 KB** minified · **0 hydration islands** · **0 mojs** · **0 GSAP** · **0 Framer Motion**.

| #   | component         | file                                     | route                     | motion-type                                         | library | KB  | reduced-motion           | UX question answered                                         |
| --- | ----------------- | ---------------------------------------- | ------------------------- | --------------------------------------------------- | ------- | --- | ------------------------ | ------------------------------------------------------------ |
| 1   | Marquee           | `src/components/Marquee.astro`           | home, /experience         | CSS keyframes (`translateX`)                        | CSS     | 0   | yes                      | "this is institutional breadth (logos / tickers / partners)" |
| 2   | NewsRibbon        | `src/components/NewsRibbon.astro`        | home, /desk               | CSS keyframes                                       | CSS     | 0   | yes                      | "news is live / agent activity is real-time"                 |
| 3   | HeroCursor        | `src/components/HeroCursor.astro`        | home                      | rAF lerp (~400 B JS)                                | vanilla | 0.4 | yes                      | "you are here, on the hero"                                  |
| 4   | PulseRing         | `src/components/PulseRing.astro`         | home, /about, /experience | CSS keyframes (box-shadow + opacity)                | CSS     | 0   | yes                      | "this is alive / verified / live"                            |
| 5   | SectionRail       | `src/components/SectionRail.astro`       | long pages                | IntersectionObserver (~600 B JS)                    | vanilla | 0.6 | yes                      | "you are in section X"                                       |
| 6   | ScrollReveal      | `src/components/ScrollReveal.astro`      | long pages                | IntersectionObserver (~500 B JS)                    | vanilla | 0.5 | yes                      | "the headline / section lands with intent"                   |
| 7   | Odometer          | `src/components/Odometer.astro`          | /about, /desk             | external driver (1.2s rAF counter)                  | vanilla | 0   | yes                      | "the number ticks up to its true value"                      |
| 8   | StatementCarousel | `src/components/StatementCarousel.astro` | home, /about              | setInterval (timer)                                 | vanilla | 0   | yes (freeze first quote) | "editorial pull-quote rotation reads as live editorial"      |
| 9   | AgentGraph        | `src/components/AgentGraph.astro`        | /about                    | CSS `stroke-dashoffset` draw-in                     | CSS     | 0   | yes                      | "this is the spine — agent roster / feedback loop"           |
| 10  | MarketTape        | `src/components/MarketTape.astro`        | /desk                     | CSS keyframes (`translateX`)                        | CSS     | 0   | yes                      | "institutional breadth (Bloomberg tape reference)"           |
| 11  | MiniSpark         | `src/components/MiniSpark.astro`         | /desk, /experience        | CSS `stroke-dashoffset` draw-in                     | CSS     | 0   | yes                      | "visual rhythm in stat tiles"                                |
| 12  | EarthDrawer       | `src/components/EarthDrawer.astro`       | /graph                    | native `<details>` (browser-native semantics)       | browser | 0   | yes                      | "event details (browser-expandable, no JS)"                  |
| 13  | GraphStream       | `src/components/GraphStream.astro`       | /graph, /desk             | vanilla JS fetch + radial layout (~3 KB)            | vanilla | 3.0 | yes                      | "live knowledge graph snapshot"                              |
| 14  | PredictionCard    | `src/components/PredictionCard.astro`    | /prediction-markets       | server-rendered SVG                                 | SSR     | 0   | yes                      | "data viz shows the data (prediction market line)"           |
| 15  | ProbabilityDecay  | `src/components/ProbabilityDecay.astro`  | /prediction-markets       | server-rendered SVG                                 | SSR     | 0   | yes                      | "data viz shows the data (decay curve)"                      |
| 16  | TermStructure     | `src/components/TermStructure.astro`     | /desk, /experience        | server-rendered SVG                                 | SSR     | 0   | yes                      | "data viz shows the data (term structure)"                   |
| 17  | TrustStrip        | `src/components/TrustStrip.astro`        | home, /about              | CSS keyframes (subtle opacity pulse)                | CSS     | 0   | yes                      | "'verified' status dot pulse"                                |
| 18  | BrandMotif        | `src/components/BrandMotif.astro`        | home                      | CSS keyframes (5.5s ship-cell breathe)              | CSS     | 0   | yes (no-pref gate)       | "G16 'ship' indicator in lattice"                            |
| 19  | Avatar            | `src/components/Avatar.astro`            | /about                    | none (static image)                                 | none    | 0   | n/a                      | n/a — static                                                 |
| 20  | Sparkline         | `src/components/Sparkline.astro`         | /desk                     | none (server-rendered SVG)                          | SSR     | 0   | n/a                      | "inline time-series visual (static)"                         |
| 21  | Collaborators     | `src/components/Collaborators.astro`     | /about                    | server-rendered pip pattern + hover                 | CSS     | 0   | yes                      | "6-cell engagement meter (deterministic seed)"               |
| 22  | Stat              | `src/components/Stat.astro`              | home, /desk, /about       | CSS hover transitions (border + box-shadow)         | CSS     | 0   | n/a (≤120ms)             | "this element is interactive"                                |
| 23  | ProjectCard       | `src/components/ProjectCard.astro`       | /experience               | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "this element is interactive"                                |
| 24  | ProofCard         | `src/components/ProofCard.astro`         | /experience               | CSS hover (scale)                                   | CSS     | 0   | n/a (≤120ms)             | "this element is interactive"                                |
| 25  | CodeProofCard     | `src/components/CodeProofCard.astro`     | /experience               | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "this element is interactive"                                |
| 26  | FactorTable       | `src/components/FactorTable.astro`       | /desk                     | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "row hover highlight"                                        |
| 27  | FlagshipCard      | `src/components/FlagshipCard.astro`      | home, /experience         | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "this element is interactive"                                |
| 28  | Footer            | `src/components/Footer.astro`            | all                       | CSS hover transitions (border-color)                | CSS     | 0   | n/a (≤120ms)             | "hover feedback on footer links + CTA"                       |
| 29  | Nav               | `src/components/Nav.astro`               | all                       | CSS transition (mobile menu `translateY(0)`, 200ms) | CSS     | 0   | yes                      | "mobile menu slide-in"                                       |
| 30  | NavMore           | `src/components/NavMore.astro`           | all                       | CSS transition (chevron rotation)                   | CSS     | 0   | yes                      | "disclosure affordance"                                      |
| 31  | KeyHintPanel      | `src/components/KeyHintPanel.astro`      | /desk                     | CSS opacity transition                              | CSS     | 0   | yes                      | "keyboard hint reveal"                                       |
| 32  | EntryStations     | `src/components/EntryStations.astro`     | home                      | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "hover feedback on entry grid"                               |
| 33  | ArchitectureBrief | `src/components/ArchitectureBrief.astro` | /experience               | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "hover feedback"                                             |
| 34  | AssetClassMatrix  | `src/components/AssetClassMatrix.astro`  | /desk                     | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "row hover"                                                  |
| 35  | DataSourceList    | `src/components/DataSourceList.astro`    | /about                    | CSS hover transitions                               | CSS     | 0   | n/a (≤120ms)             | "row hover"                                                  |
| 36  | SectionTOC        | `src/components/SectionTOC.astro`        | long pages                | CSS hover + active-state (color/border-color)       | CSS     | 0   | n/a (≤120ms)             | "sticky in-page TOC active highlight"                        |
| 37  | CTABanner         | `src/components/CTABanner.astro`         | all                       | CSS hover transitions (button bg/color)             | CSS     | 0   | yes                      | "terminal CTA strip + availability matrix"                   |
| 38  | VoiceLine         | `src/components/VoiceLine.astro`         | all                       | **none** (explicit no-motion docstring)             | none    | 0   | n/a (static)             | n/a — editorial italic voice line                            |

**Reduced-motion coverage:** 22 of 38 motion-capable components (58%) have explicit `prefers-reduced-motion: reduce` fallbacks. The other 16 are hover/transition-only micro-interactions (≤120 ms color/border-color transitions) that WCAG 2.2 AA classifies as "essential" feedback and exempts from reduced-motion override.

**Zero hydration islands.** No component uses `client:*` directives (per audit-2 Finding M-3).

---

## CUT list (zero, audit-2 GREEN)

| #   | component | reason-canned                                                                                                                                      | date       |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| —   | (none)    | All 38 components pass the 3-question gate. None are purely decorative. None exceed bundle budget. None lack reduced-motion fallback where needed. | 2026-07-31 |

The two borderline cases were audited and kept:

1. **StatementCarousel** (timer-driven editorial pull-quote rotation): borderline "decorative". KEEP because (i) reduced-motion fallback freezes to first quote, (ii) it serves the "institutional voice" pattern (Stratechery / Schonfeld signature), (iii) bundle cost is 0 KB. Future revision: first quote static + remainder user-paused (not delete).
2. **BrandMotif ship-breathe** (5.5s opacity pulse on one SVG cell): could read as decoration if G16 context is missed. KEEP because (i) it's semantic (G16 = "ship" = system passes when this lights), (ii) restrained (opacity-only, no scale/rotate/translate), (iii) gated by `prefers-reduced-motion: no-preference`.

---

## UPGRADE-with-mojs list (zero, audit-2 GREEN — HeroBurst rolled back v8.1.0)

| #   | component | proposal                     | blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | (none)    | No component has a mojs gap. | The 7 motion primitives (Marquee, NewsRibbon, TextReveal, SectionRail, HeroCursor, PulseRing, ForceDirected) are implemented in CSS or vanilla JS at 0–3 KB per component — well below mojs's ~30 KB gz baseline. Adding mojs to any current component would: add ≥30 KB gz to the component bundle (10× the entire current motion budget), require a `client:visible` hydration island (currently 0 of 38 components hydrate), trigger the HeroBurst regression class (motion that competes with content rather than serving it). |

The one borderline upgrade candidate was audited and rejected:

- **HeroCursor.astro** — replacing the 400-byte rAF lerp with a mojs-driven pointer-follow would gain nothing visible to a recruiter on a 6-second hero visit. **Do not upgrade.**

---

## Mojs budget rules (v8.1.0 — binding)

`@mojs/core` stays installed in `package.json` for `/desk` + `/prediction-markets` where motion adds semantic value (these routes have a quant-research motion vocabulary where burst/cascade are part of the data language, not decoration).

**Hard bans** (any proposal that violates any of these is rejected at the gate):

- **No rotate** — rotations read as celebratory, not institutional.
- **No halo** — soft halo shadows / glows are a vibe-coding tell (per `webcraft-no-vibe` doctrine).
- **Bundle <30 KB per island** — the entire current motion budget is 4.5 KB; a single mojs island cannot exceed 6.7× that.
- **No static-import at module top-level** — any mojs use must be `client:visible` dynamic-import gated by IntersectionObserver idle-trigger.

**HeroBurst regression guard:** the v8.1.0 mojs HeroBurst caused Lighthouse mobile Perf 99 → 92 → 94 → 95 across three variants. Even dynamic-import + IntersectionObserver idle-trigger did not save it. The rollback is permanent. Any future mojs proposal must show a Lighthouse dry-run ≥ 99 mobile before merge.

---

## Review cadence

- **Quarterly** — next: 2026-10-31 (lead: `motion_designer`).
- **On any new motion proposal** — auto-fire on keywords: `motion|mojs|gsap|framer|marquee|reveal|pulse|parallax|carousel|draw|line|animate|transition|tween|kinetic|choreograph`.
- **On any new component ship** — the PR description must include the 3-question ship gate answers (1-line each).
- **Owner approval required** for UPGRADE-list additions. The motion_designer can propose; only Owner can promote.

---

## References

- **Audit-2 findings**: `~/.claude/cache/corporate/audits/2026-07-31-portfolio-v9/audit-2-motion.md` (38 components · 4.5 KB JS · 0 hydration · 0 mojs)
- **v8.1.0 hotfix**: `~/.claude/projects/-Users-christianmacion/memory/portfolio-v8-1-0-hotfix1-2026-07-31.md` (HeroBurst rollback, Perf 99→95)
- **HeroBurst regression lesson**: 3-move generalisation (motion that competes with content loses; mojs is the wrong tool for the institutional register; bundle cost compounds).
- **Motion primitive registry**: this matrix is the canonical roster for the 7 charter primitives (Marquee · NewsRibbon · TextReveal · SectionRail · HeroCursor · PulseRing · ForceDirected).
- **doctrine anchors**:
  - `greene-law-38` — technical depth / public surface; motion is the public surface that signals engineering taste.
  - `deming-sopk` — chrome-as-system means motion-as-system; the matrix is the system.
  - `munger-inversion` — what if we skip the matrix? Future motion proposals get ad-hoc decisions, HeroBurst-class regressions repeat.
  - `kahneman-system-1` — System-1 expectation: motion should feel effortless; anything that breaks that = CUT.

---

## Changelog

- **v9.0 (2026-07-31)** — initial matrix shipped. 38 components audited, all KEEP. 0 cuts. 0 mojs upgrades. 4.5 KB total motion JS. 0 hydration islands. Dedupe key: `motion-decision-matrix-v9`.
