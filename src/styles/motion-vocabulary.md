# Motion Vocabulary v11 (2026-08-08)

> **Owner:** uiux_engineer (Squad A Row 46, design-intelligence corpus owner)
> **Status:** BINDING for every future chrome change
> **Corpus:** `~/.claude/skills/ui-ux-pro-max` (84 styles / 192 palettes / 74 type pairings / 16 GSAP motion presets / 22 stacks)
> **Supersedes:** the informal "3 cubic-beziers per T3-M5" block in `tokens.css`
> **Companion gate:** `docs/motion-decision-matrix.md` (the 3-question ship gate stays in force)

This document is the single source of truth for how long motion takes and what curve it rides.
Colour, spacing, and type are governed elsewhere. This governs time only.

---

## 1. Duration tiers (4)

| Token | Value | Name | Owns |
|---|---|---|---|
| `--mv-dur-instant` | `80ms` | instant | focus rings, checkbox/toggle flips, tooltip show |
| `--mv-dur-snap` | `160ms` | snap | hover states, button press, link underline, arrow shift |
| `--mv-dur-settle` | `280ms` | settle | scroll reveal, accordion, tab swap, drawer |
| `--mv-dur-cinematic` | `480ms` | cinematic | first-paint hero entrance, route entrance. Once per page load. |

Four tiers is the cap. A fifth tier is a design failure, not a missing token.
Anything above 480ms is either a scrub (tied to scroll position, no duration)
or a loop (marquee, caret) and is out of scope for this table.

**Corpus anchor:** ui-ux-pro-max priority 7 (Animation) sets the working band at
150ms to 300ms for interactive feedback, which brackets `snap` and `settle`.
`instant` sits below the band deliberately: a focus ring that animates is a focus
ring that lags the keyboard. `cinematic` sits above it and is rationed to one
event per page load.

## 2. Easing curves (3)

| Token | Value | Name | Character |
|---|---|---|---|
| `--mv-ease-snappy` | `cubic-bezier(0.2, 0, 0, 1)` | snappy | leaves immediately, lands hard. Reads as responsive. |
| `--mv-ease-settle` | `cubic-bezier(0.4, 0, 0.2, 1)` | settle | symmetric ease-in-out. Reads as composed. |
| `--mv-ease-cinematic` | `cubic-bezier(0.65, 0, 0.35, 1)` | cinematic | slow lead-in, slow landing. Reads as deliberate. |

No overshoot curve. No elastic, no `back.out`, no bounce. The corpus flags
overshoot as "reads as sloppy on informational UI" (motion.csv row 8), and this
is an informational UI for a quant research audience.

### Naming hazard (read before you touch a token)

The pre-existing codebase token `--j-ease-snappy` is `cubic-bezier(0.4, 0, 0.2, 1)`,
which under this vocabulary is **settle**, not snappy. The two names disagree.

This vocabulary therefore uses the `--mv-` prefix throughout and does **not**
redefine `--j-ease-snappy`. Migration is opt-in per primitive. Do not "fix" the
`--j-` family by renaming it: 19 call sites consume `--j-ease-snappy` and a
rename is a silent site-wide motion change.

Mapping for anyone migrating a primitive:

| Old | New | Same curve? |
|---|---|---|
| `--j-ease-snappy` `cubic-bezier(0.4,0,0.2,1)` | `--mv-ease-settle` | yes, identical |
| `--j-ease-out` `cubic-bezier(0.16,1,0.3,1)` | `--mv-ease-snappy` | no, near equivalent, more aggressive decel |
| `--j-ease-out-soft` | `--mv-ease-cinematic` | no, approximate |

## 3. Motion categories (5)

| Category | Duration | Easing | Stagger | Repeat |
|---|---|---|---|---|
| **hover** | `--mv-dur-snap` 160ms | snappy | none | per pointer event |
| **focus** | `--mv-dur-instant` 80ms | snappy | none | per focus event |
| **scroll-reveal** | `--mv-dur-settle` 280ms | settle | `--mv-stagger` 80ms | once per element |
| **entrance** | `--mv-dur-cinematic` 480ms | cinematic | `--mv-stagger` 80ms | once per page load |
| **exit** | `--mv-dur-exit` 240ms | snappy | none | per dismissal |

Exit is deliberately faster than its matching entrance (240ms against 480ms).
The corpus states the rule directly: "Exit animation should always resolve faster
than entrance (asymmetric timing) so back/forward feels snappy" (motion.csv row 10).

Stagger is fixed at 80ms and capped at 8 children. Beyond 8, the last item lands
more than 640ms after the first and the group stops reading as one gesture
(motion.csv row 5: "Don't stagger more than ~8 children").

## 4. Reduced-motion policy

Under `@media (prefers-reduced-motion: reduce)`:

| Category | Behaviour |
|---|---|
| hover | collapses to `0ms`. Final state applies instantly. |
| focus | collapses to `0ms`. |
| entrance | collapses to `0ms`. Element is visible at final state on paint. |
| exit | collapses to `0ms`. |
| **scroll-reveal** | **becomes fade-only at 80ms.** No translate, no blur. |

Scroll-reveal is the single exception. It keeps an 80ms opacity fade because a
hard pop-in on scroll is itself a motion artefact: the eye reads an instantaneous
appearance as a flash. An 80ms fade removes the vestibular trigger (no positional
change, no blur) while preserving the "this content just arrived" signal.
Translate and blur are the properties that provoke motion sensitivity; opacity at
sub-100ms is not.

This is implemented by neutralising `transform` and `filter` while leaving a
short `opacity` transition in place, not by disabling the transition wholesale.

### Known gap: the fade is specified but not yet observable

`motion.css` section 23 pins `opacity: 1 !important` on `[data-reveal]` under
reduced motion. That rule is load-bearing: `motion.css` is also served through a
`<noscript>` link in `BaseLayout.astro`, so with JS disabled the reveal CSS
applies but nothing ever adds `.is-revealed`. Without the `!important`, no-JS
users get permanently invisible content.

Consequence: opacity has no delta to animate, so **reduced-motion scroll-reveal
currently resolves to instant-visible rather than an 80ms fade.** Every other
guarantee in the table above holds. Nothing animates, no vestibular trigger fires,
and the a11y outcome is safe; the 80ms fade is simply a refinement that has not
landed yet.

Closing it requires a JS-presence signal (a root class set by `motion.ts`) so the
`opacity: 0` start state can be scoped to JS-on sessions. That is a bootstrapping
change to `BaseLayout` with FOUC risk and is deliberately out of scope for v11 W3.

**Do not close this gap by deleting the `!important` in section 23.** That ships
invisible content to no-JS users, which is a strictly worse failure than a missing
80ms fade.

---

## 5. Conformance status (audited 2026-08-08)

Measured against what is actually in `src/styles/motion.css` and
`src/scripts/motion/` at the time of writing. This section records reality, not
intent.

| Primitive | Spec | Shipped before v11 | Verdict |
|---|---|---|---|
| Card lift (`.thesis-card`, `.pillar`, `.ai-rung`) | 160ms snappy | 200ms `--j-ease-out` | was OUT, now migrated |
| Scroll reveal (`[data-reveal]`) | 280ms settle | 700ms `--j-ease-out` + 8px blur | was OUT by 420ms, now migrated |
| Reveal stagger | 80ms | 80ms | conformed already |
| Hero entrance (`.hero [data-stagger]`) | 480ms cinematic | 580ms `--j-ease-out`, arc ends 480ms | duration was OUT, arc conformed |
| Exit / hero-curve scrub | 240ms snappy | 240ms | conformed already |
| mojs recipes | 480ms cinematic entrance | 600ms and 400ms | OUT, see note below |

**mojs note:** the mojs recipes in `src/scripts/motion/mojs-recipes.client.ts` run
at 600ms and 400ms with `cubic.out` and `sin.out` easings. These are library-internal
easing strings that cannot consume a CSS custom property. They are recorded here as a
known divergence rather than silently reported as conformant. Bringing them in line
requires editing the JS literals, which is owned by motion_designer, not by this
document.

---

## 6. Enforcement

Any future chrome change that introduces or edits motion MUST:

1. Use a `--mv-dur-*` token. No raw `ms` literals in `transition` or `animation` shorthand.
2. Use a `--mv-ease-*` token. No inline `cubic-bezier()`.
3. Declare which of the 5 categories it belongs to, in a comment.
4. Ship a reduced-motion branch per section 4.
5. Pass the 3-question gate in `docs/motion-decision-matrix.md`.
6. Ship with a **site-wide** axe sweep, not a per-page one, per the v9.9 regression
   (34 contrast violations across 32 routes passed per-page and failed site-wide).

A motion that cannot name its category does not ship.
