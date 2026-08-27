# Family Church Fourways — Website

The public website for [Family Church, Fourways](https://familychurch.online). Built with [Astro](https://astro.build) and [TinaCMS](https://tina.io), deployed on Cloudflare.

## Stack

- **Astro 6** — static site generation with view transitions
- **TinaCMS** — visual CMS with Git-backed content
- **Tailwind CSS v4** — utility styling with CSS custom property brand tokens
- **Cloudflare Pages/Workers** — hosting + edge function for `/today`

## Getting started

Requires Node ≥ 22 and [pnpm](https://pnpm.io).

```sh
pnpm install
cp .env.example .env   # fill in TinaCloud credentials
pnpm dev               # http://localhost:4321 · admin at /admin/
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `PUBLIC_TINA_CLIENT_ID` | TinaCloud project ID — from [app.tina.io](https://app.tina.io) |
| `TINA_TOKEN` | TinaCloud read token |
| `SITE_URL` | Production canonical URL (required on Cloudflare Workers) |
| `DEPLOY_ADAPTER` | Force `vercel \| cloudflare \| netlify \| node`; normally auto-detected |

## Development

```sh
pnpm dev          # TinaCMS + Astro dev server
pnpm build        # Production build (needs TinaCloud credentials)
pnpm build:local  # Local build without TinaCloud auth
pnpm preview      # Preview production build
pnpm astro check  # TypeScript type-check
```

## Content

Content is edited visually at `/admin/` or by editing MDX files directly in `src/content/`.

| Section | Path | Notes |
|---------|------|-------|
| Pages | `src/content/page/` | Block-builder pages (Hero, CTA, Features…) |
| Sermons | `src/content/sermons/` | One MDX file per sermon, named `YYYY-MM-DD-title.mdx` |
| Devotions | `src/content/devotion/` | One MDX file per day, named `YYYY-MM-DD.mdx` |
| Global config | `src/content/config/config.json` | Nav, SEO, contact links |

### Sermon import pipeline

Sermons are sourced from Google Drive and imported via a set of scripts. Run them in order:

```sh
pnpm sermons:download   # Pull raw sermon data from Drive into scripts/drive/
pnpm sermons:images     # Download sermon images
pnpm sermons:audio      # Upload audio to Cloudflare R2
pnpm sermons:import     # Write MDX files into src/content/sermons/

pnpm sermons:latest     # Import only the most recent sermon
pnpm sermons:check      # Report what's missing without writing anything
```

Sermons with `review: true` in their frontmatter are hidden from the listing page until the flag is removed.

## Deployment

The site is host-neutral — the right Astro adapter is selected automatically from the build environment (Vercel, Cloudflare Pages/Workers, Netlify, or Node standalone). The bundled `wrangler.jsonc` targets Cloudflare Workers.

Before your first deploy, create a project at [app.tina.io](https://app.tina.io) and set `PUBLIC_TINA_CLIENT_ID` and `TINA_TOKEN` in your host's environment variables. To build without TinaCloud, use `pnpm build:local`.

### `/today` edge function

`functions/today.ts` is a Cloudflare Pages Function that intercepts `/today`, looks up the current South African date (UTC+2), serves the pre-built static `/devotion/YYYY-MM-DD` page, and caches it until midnight SA time. In local dev this function does not run — `today.astro` handles the request instead.
