# Components archive : 2026-08-07

**Archived by:** Commander AFK sweep
**Reason:** Zero functional references; all 10 files were orphans from prior v9.x iterations replaced by current components.

## Files (10, cumulative ~116 KB)

| File | Size | Last known role | Replaced by |
|---|---|---|---|
| `HeroCurve.astro` | 8K | Animated SVG equity curve (v9.4 flagship hero) | `HeroSkills.astro` (matrix of searchable proof) |
| `HeroCursor.astro` | 8K | Custom hero cursor accent | `BrandMotif.astro` (subtle) |
| `ArchitectureBrief.astro` | 8K | Architecture-doc card | `ProofCard.astro` |
| `EntryStations.astro` | 24K | Map entry stations | inline `<EarthDrawer>` references in `index.astro` |
| `EarthDrawer.astro` | 24K | Side drawer for EarthMap details | inline detail-row pattern |
| `Odometer.astro` | 4K | Numeric odometer (count-up) | `MetricPill.astro` |
| `MotionStyles.astro` | 4K | Opt-in motion CSS bundle | `motion.RWk-yGDU.css` (already in global bundle) |
| `SectionRail.astro` | 8K | Section navigation rail | `Nav.astro` (global) |
| `KeyHintPanel.astro` | 12K | Keyboard-shortcut hint panel | `Colophon.astro` for shortcut reference |
| `Collaborators.astro` | 12K | Co-author/collaborator cards | `ProofCard.astro` |

## Restoration

If any file needs to be restored:
```bash
mv src/_archive/components-2026-08-07/<Name>.astro src/components/<Name>.astro
npm run smoke:build
npm run deploy:mirror
```

## Verification

All 10 files had 0 functional references at archive time (only HTML/code comments in HeroSkills.astro and index.astro). Build + smoke test pass; deployed via `npm run deploy:mirror` at the same timestamp.
