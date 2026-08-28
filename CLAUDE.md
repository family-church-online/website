# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
pnpm dev              # Start TinaCMS + Astro dev server (admin at localhost:4321/admin/)
pnpm build            # Production build — requires TinaCloud credentials (PUBLIC_TINA_CLIENT_ID, TINA_TOKEN)
pnpm build:local      # Local build without TinaCloud auth
pnpm preview          # Preview the built site

pnpm astro check      # TypeScript type-checking for .astro files
```

There are no tests. Type-checking is the primary static verification tool.

### Sermon import pipeline

Run in order when importing new sermons from Google Drive:

```sh
pnpm sermons:download      # Download raw sermon data from Drive → scripts/drive/
pnpm sermons:images        # Download sermon images
pnpm sermons:audio         # Upload audio to Cloudflare R2
pnpm sermons:import        # Write MDX files into src/content/sermons/

# Dry-run / status variants:
pnpm sermons:check         # Report which sermons are missing locally
pnpm sermons:latest        # Import only the most recent sermon
```

### Environment variables

Copy `.env.example` → `.env`. Key vars:

| Var | Purpose |
|-----|---------|
| `PUBLIC_TINA_CLIENT_ID` | TinaCloud project ID (from app.tina.io) |
| `TINA_TOKEN` | TinaCloud read token |
| `SITE_URL` | Canonical URL — required on Cloudflare Workers where no platform var is injected |
| `DEPLOY_ADAPTER` | Force `vercel \| cloudflare \| netlify \| node`; normally auto-detected |
| `TINA_HOST` | LAN IP or full URL for mobile dev against the same local TinaCMS |

## Architecture

### Data flow: TinaCMS → Astro → HTML

Content is managed by TinaCMS and lives in `src/content/` as MDX files. **Astro's built-in content layer is not used** — all data access goes through the generated GraphQL client.

```
tina/collections/*.ts       ← Schema definitions (source of truth)
    ↓  (tinacms dev regenerates)
tina/__generated__/client.ts ← Typed GraphQL client (auto-generated, do not edit)
    ↓
src/lib/data.ts             ← Loader functions + TypeScript types derived from loader return types
    ↓
src/pages/**/*.astro        ← Pages call loaders and pass typed data to components
src/components/**/*.astro   ← Components receive typed props
```

**Types are never hand-written** — they're `Awaited<ReturnType<...>>` derivations in `src/lib/data.ts`. When the Tina schema changes, run `tinacms dev` to regenerate the client, and the types update automatically.

### TinaCMS collections

| Collection | Path | Format | Route |
|-----------|------|--------|-------|
| `page` | `src/content/page/` | MDX | `/{slug}` (block-based CMS pages) |
| `sermon` | `src/content/sermons/` | MDX | `/sermons/{date}-{slug}` |
| `devotion` | `src/content/devotion/` | MDX | `/devotion/{YYYY-MM-DD}` |
| `globalConfig` | `src/content/config/config.json` | JSON | global (nav, SEO, contact links) |

Sermon filenames follow the pattern `YYYY-MM-DD-slugified-title.mdx` (enforced by the collection's `slugify` function). Devotion filenames are simply `YYYY-MM-DD.mdx`.

### Pages and routing

- `src/pages/[...slug].astro` — Catch-all for TinaCMS block-builder pages
- `src/pages/sermons/index.astro` — Sermon listing with client-side filtering and pagination (no SSR)
- `src/pages/sermons/[slug].astro` — Individual sermon
- `src/pages/devotion/[date].astro` — Date-specific devotion (`/devotion/2026-08-27`)
- `src/pages/today.astro` — Static fallback; in production intercepted by `functions/today.ts`
- `src/pages/tina-island/[name].ts` — Dynamic on-demand route powering TinaCMS visual editing

### `/today` — server-rendered redirect

`src/pages/today.astro` is an on-demand route (`prerender = false`) that runs in the Cloudflare Worker at request time. It computes the current South African date (UTC+2) and returns a `302` redirect to `/devotion/YYYY-MM-DD`. The response carries `Cache-Control: s-maxage=<seconds-until-midnight-SA>` so Cloudflare's CDN caches the redirect at the edge — the Worker only runs once per edge location per day. No rebuild or redeploy is needed for the daily rollover; as long as the MDX file for a date exists in the repo before that day arrives, `/today` will redirect to it correctly.

### Visual editing (TinaCMS islands)

`src/lib/islands.ts` is the registry for all editable regions. Each entry maps a URL slug (`/tina-island/{name}`) to a data fetcher + Astro component. The dynamic route `src/pages/tina-island/[name].ts` uses this registry. Adding a new editable region means adding one entry to `islands.ts`.

The `tinaField()` helper from `@tinacms/astro/tina-field` is added as `data-tina-field` attributes on elements to enable click-to-edit in the admin iframe.

### Block builder (CMS pages)

Pages use a composable block system. Each block type has two files:

- `src/components/blocks/Foo.astro` — Rendering component
- `src/components/blocks/foo.template.ts` — TinaCMS default values for that block type

`src/components/blocks/Blocks.astro` maps `__typename` to the correct block component.

### Adapters (deployment targets)

`astro.config.mjs` auto-detects the hosting platform from build environment variables (Vercel, Cloudflare Pages/Workers, Netlify → Node fallback). Override with `DEPLOY_ADAPTER`. `wrangler.jsonc` targets Cloudflare Workers and enables `nodejs_compat` for `node:async_hooks` (needed by the Tina island route).

### Styling

Tailwind CSS v4 via `@tailwindcss/vite`. Brand color tokens are CSS custom properties on `:root`:

```
--navy:  #273f61   (primary, nav background)
--green: #92c423   (accent, hover, links)
--red:   #c84029
--olive: #8f926b   (section labels, series names)
--ink:   #14202f   (body text)
```

Dark mode is controlled by the `.dark` class on `<html>` (set by `ThemeToggle.astro` + localStorage), not `prefers-color-scheme`. The CSS variant is `@custom-variant dark (&:where(.dark, .dark *))`.

### Notable implementation details

- **Shiki is stubbed** — `src/shiki-stub.js` replaces all Shiki imports to avoid a 17 MB SSR bundle. Syntax highlighting is disabled in `astro.config.mjs`. Do not add code blocks that need highlighting without also addressing this.
- **React is dev-only** — `react`/`react-dom` are in `devDependencies` for the TinaCMS admin build only. The site ships zero React. Both packages are pinned to the same version to prevent mismatched peer installs (see README for the upstream issue).
- **`src/content.config.ts`** only declares the `config` collection (to prevent Astro from treating the JSON global-config as Markdown). Blog and page Markdown generation remains auto.
- **All CSS is inlined** — `build.inlineStylesheets: 'always'` in `astro.config.mjs` prevents a render-blocking `<link>` on mobile.
- **Sermon `review: true`** — Sermons with `review: true` in their frontmatter are excluded from the listing page. Use this flag to stage content before going live.
