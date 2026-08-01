# Christian T. Macion — Portfolio Site

Personal portfolio for **AI Engineer · Quantitative Researcher** roles.

- **Live:** [christianmacion26.github.io/portfolio](https://christianmacion26.github.io/portfolio)
- **Built with:** Astro 5 · MDX · TypeScript · handcrafted CSS (no Tailwind)
- **Hosting:** GitHub Pages (free)
- **NDA-clean:** build-time audit enforces it

## Develop

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # → dist/ (static)
npm run preview    # serve dist/
npm run audit      # NDA audit on built site
```

## Add a project

```bash
# 1. Drop an MDX in src/content/projects/<lane>/NN-slug.mdx
#    with frontmatter:
#      ---
#      title: project-name
#      role: ai | quant
#      order: 7
#      summary: "One-line headline"
#      summary_long: "Paragraph for the detail page"
#      stack: [...]
#      metrics:
#        - { label: "recall@3", value: "0.886" }
#      sourceLink: "https://github.com/..."
#      status: open-source
#      tags: [...]
#      ---
#
#      ## Why this exists
#      …
#
# 2. Save. Astro picks it up; the project auto-renders on /projects and /projects/<slug>.
```

## Content collections

| Collection   | Folder                             | Schema                                |
| ------------ | ---------------------------------- | ------------------------------------- |
| `project`    | `src/content/projects/{ai,quant}/` | Zod schema in `src/content.config.ts` |
| `experience` | `src/content/experience/`          | Zod schema                            |
| `skillGroup` | `src/content/skills/`              | Zod schema                            |
| `certGroup`  | `src/content/certifications/`      | Zod schema                            |

Edit a single source of truth — `src/utils/profile.ts` — for owner identity.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys on push to `main`:

1. `npm ci`
2. `npm run build` → `dist/`
3. `npm run audit` → 0 violations required
4. Uploads as Pages artifact and deploys

**Required repo setting:** Settings → Pages → Build and deployment → Source: **GitHub Actions**.

## NDA guardrails

The `src/utils/nda-audit.ts` script runs in CI and enforces:

- No `"Davao City"` (correct location is "Digos City, Davao del Sur")
- No `"Present"` / `"currently"` tied to 19V Capital
- No fund rename disclosure (`"Alpha Apex"`, `"Alpha Apex Quant"`)
- No proprietary data sources (Polymarket, Kalshi, NOAA, USDA)
- No `Quantivo` or `CallRank AI` specifics

A violation fails the CI build. To allow an edge case, refine the rule's `exceptionPattern`.

## Layout

```
src/
├── content.config.ts         Astro 5 Zod schemas (4 collections)
├── content/                  MDX + MD content (29 files)
├── pages/                    9 routes (home, projects/[...slug], experience, …)
├── components/               5 reusable components
├── layouts/BaseLayout.astro  wraps every page (head + nav + footer)
├── styles/                   design system tokens + global
└── utils/                    profile, seo, nda-audit
public/
├── resume-*.pdf              3 resume PDFs
├── figures/quant/            9 quant project figures
└── favicon.svg
```

## License

Code: MIT. Content (`.mdx` files, copy): © Christian T. Macion.

<!-- ci-retrigger 2026-08-01T13:08:09Z -->
