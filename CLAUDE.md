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
| `VIMEO_ACCESS_TOKEN` | Vimeo API token — used by `/api/stream-status` to detect live stream |

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
| `amplify` | `src/content/amplify/` | MDX | `/amplify/{slug}` (teen ministry lessons) |
| `kidsPreschool/Junior/Senior` | `src/content/kids/` | MDX | `/kids-church/{group}/{date}` |
| `globalConfig` | `src/content/config/config.json` | JSON | global (nav, SEO, contact links, auth) |

Sermon filenames follow the pattern `YYYY-MM-DD-slugified-title.mdx` (enforced by the collection's `slugify` function). Devotion filenames are simply `YYYY-MM-DD.mdx`.

**Amplify lessons** use `tina/collections/amplify-lesson.ts`. The `mainScriptureText` field is `rich-text` — TinaCMS stores it as an AST object; `AmplifyLessonPage.astro` renders it via a `renderRichText()` helper that also handles legacy plain-string content (content not yet re-saved through the admin).

**Kids Church lessons** use `tina/collections/kids-lesson.ts`. Both lesson collections are factory functions called in `tina/config.ts` with `name`, `label`, `path`, and `route` options.

### Pages and routing

- `src/pages/[...slug].astro` — Catch-all for TinaCMS block-builder pages
- `src/pages/sermons/index.astro` — Sermon listing with client-side filtering and pagination (no SSR)
- `src/pages/sermons/[slug].astro` — Individual sermon
- `src/pages/devotion/[date].astro` — Date-specific devotion (`/devotion/2026-08-27`)
- `src/pages/amplify/[slug].astro` — Amplify teen ministry lesson (uses `AmplifyLessonPage.astro`)
- `src/pages/kids-church/[group]/[date].astro` — Kids Church lesson (uses `KidsLessonPage.astro`)
- `src/pages/today.astro` — Static fallback; in production intercepted by `functions/today.ts`
- `src/pages/tina-island/[name].ts` — Dynamic on-demand route powering TinaCMS visual editing
- `src/pages/course-admin.astro` — Admin: course completion viewer (gated to `adminListId` PCO list); `noindex`
- `src/pages/cf-status.astro` — Admin: Cloudflare free-tier usage dashboard (gated to `adminListId`); `noindex`
- `src/pages/api/stream-status.ts` — GET; checks Vimeo API for live stream
- `src/pages/api/stream-report.ts` — POST; writes problem report to `STREAM_REPORTS` KV, notifies DO
- `src/pages/api/stream-reports.ts` — GET; returns report counts + recent (last 60 min) from KV
- `src/pages/api/stream-ws.ts` — GET; proxies WebSocket upgrades to `StreamMonitor` Durable Object
- `src/pages/stream-dashboard.astro` — Live problem dashboard (no auth); responsive for OBS docks

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

### Stream reporting

`src/components/blocks/LiveStream.astro` shows a "Report a Problem" widget when the stream is live (detected via `/api/stream-status`). Clicking a button POSTs to `/api/stream-report`, which:

1. Writes `{ button, ip, timestamp }` to the `STREAM_REPORTS` KV namespace with a 7-day TTL
2. Notifies the `StreamMonitor` Durable Object via `POST /notify`

The DO broadcasts the report to all connected WebSocket clients (the dashboard). The dashboard at `/stream-dashboard` opens a WebSocket to `/api/stream-ws` and updates tiles in real time.

**Durable Object deployment**: The `StreamMonitor` class (`src/objects/StreamMonitor.ts`) is not in the Astro source tree — it is bundled post-build by `scripts/bundle-do.mjs` into `dist/server/StreamMonitor.js`. A thin `dist/server/worker-entry.js` re-exports both the Astro server handler and `StreamMonitor` as a named export. `scripts/patch-wrangler.mjs` injects the DO binding and migration into `dist/server/wrangler.json` (kept out of `wrangler.jsonc` so Miniflare doesn't try to resolve the class during the Vite build phase).

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
- **Icons** — `src/components/Icon.astro` is a hand-rolled component with inline Phosphor SVG paths (256×256 viewBox, `fill="currentColor"`). There is no npm icon package at runtime. To add an icon: find the Phosphor Regular SVG path at `github.com/phosphor-icons/core/tree/main/assets/regular`, add it to the `paths` map and `IconName` union in `Icon.astro`.
- **Cloudflare KV access** — use `import { env } from 'cloudflare:workers'` with a try/catch wrapper (see existing API routes for the pattern). Never access KV via `Astro.locals` or `process.env`.
- **Stream report widget** — five icon+label tappable items (not buttons) in `LiveStream.astro`. The description text is CMS-editable via the `reportDescription` field on the Live Stream block. `GET /api/stream-reports` deletes KV entries older than 60 minutes as it reads them; the dashboard polls this endpoint every 60 s so counts drop to zero on expiry.
- **DO bindings in `patch-wrangler.mjs` not `wrangler.jsonc`** — DO bindings must not be in `wrangler.jsonc` or Miniflare will try to resolve the class during the Vite build phase and fail. Always add them in `patch-wrangler.mjs` instead.
- **Admin pages** — `/course-admin` and `/cf-status` are SSR pages gated to the PCO list ID stored in `config.auth.adminListId` (editable via TinaCMS Global Config → Member Access). Both are `noindex`. The `adminListId` is included in `allTrackedIds` at login time in `src/pages/api/auth/login.ts` so it is baked into the session cookie. `CF_ACCOUNT_ID` and `CF_API_TOKEN` are optional Worker vars that unlock the Cloudflare Analytics API on `cf-status`; without them the page shows key counts only.
- **Sermon notes drawer mobile fix** — the drawer in `LiveStream.astro` uses `translate-x-full` to hide off-screen. On mobile WebKit, translated `fixed` elements bypass `overflow-x: hidden` on `html`/`body` and create horizontal scroll. The fix is a `fixed inset-0 overflow-hidden pointer-events-none` wrapper div that clips the drawer while allowing the slide animation to work.
- **Sveltia `rich-text → markdown` mapping** — `generate-sveltia-config.mts` automatically maps TinaCMS `rich-text` fields to Sveltia `widget: markdown`. Do not hand-edit `public/edit/config.yml` for field type changes — change the TinaCMS schema and run `pnpm sveltia:config` instead.
- **TinaCMS `datetime` frontmatter → JS Date objects** — Astro's YAML parser (`import.meta.glob` on MDX) auto-converts ISO datetime strings like `2026-09-13T00:00:00.000+02:00` into JavaScript `Date` objects. Calling `.slice(0, 10)` on a `Date` silently produces garbage. Rule: **never call string methods on TinaCMS datetime values**. Always pass them directly to `new Date(value as string)` and format with `timeZone: 'Africa/Johannesburg'` (not `'UTC'`). For date-equality comparisons, derive a `YYYY-MM-DD` string via `.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })`. Plain date strings from the sermon import pipeline (`YYYY-MM-DD`, no time component) are unaffected.
