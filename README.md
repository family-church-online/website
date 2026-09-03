# Family Church Fourways — Website

The public website for [Family Church, Fourways](https://familychurch.online). Built with Astro and deployed on Cloudflare Workers.

## Stack

- **Astro 6** — static site generation + on-demand Cloudflare Worker routes
- **TinaCMS** — visual CMS at `/admin/` for Pages and Courses
- **Sveltia CMS** — lightweight git CMS at `/edit/` for structured content
- **Tailwind CSS v4** — utility styling with CSS custom property brand tokens
- **Cloudflare Workers** — hosting, edge KV for lesson progress, on-demand routes

## Getting started

Requires Node ≥ 22.22 and [pnpm](https://pnpm.io).

```sh
pnpm install
cp .env.example .env   # fill in credentials (see table below)
pnpm dev               # Astro + TinaCMS dev server → http://localhost:4321
                       # TinaCMS admin → /admin/
                       # Sveltia CMS   → /edit/  (GitHub OAuth, needs deploy)
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `PUBLIC_TINA_CLIENT_ID` | TinaCloud project ID — from [app.tina.io](https://app.tina.io) |
| `TINA_TOKEN` | TinaCloud read token |
| `SITE_URL` | Canonical URL — required on Cloudflare Workers (no platform var injected) |
| `DEPLOY_ADAPTER` | Force `vercel \| cloudflare \| netlify \| node`; normally auto-detected |
| `TINA_HOST` | LAN IP or full URL for TinaCMS mobile dev on the same network |
| `PCO_APP_ID` | Planning Center Online app ID — for magic-link auth |
| `PCO_SECRET` | Planning Center Online app secret |
| `RESEND_API_KEY` | Resend API key — for sending magic-link emails |

## Commands

```sh
pnpm dev              # TinaCMS + Astro dev server
pnpm build            # Production build — requires TinaCloud credentials
pnpm build:local      # Local build without TinaCloud auth
pnpm preview          # Preview production build
pnpm astro check      # TypeScript type-check
pnpm sveltia:config   # Regenerate public/edit/config.yml from TinaCMS schema
```

## Content management

The site uses two CMS systems that co-exist without clashing:

| CMS | URL | Manages |
|-----|-----|---------|
| **TinaCMS** | `/admin/` | Pages (block builder), Courses (course/chapter/lesson hierarchy) |
| **Sveltia** | `/edit/` | Everything else — structured content with frontmatter + markdown |

Sveltia's config is auto-generated from the TinaCMS schema at every build by `scripts/generate-sveltia-config.mts`. When you change a field in `tina/collections/*.ts`, the Sveltia UI updates on the next build automatically.

### Content collections

| Collection | Path | CMS | Notes |
|-----------|------|-----|-------|
| Pages | `src/content/page/` | TinaCMS | Block-builder pages (Hero, CTA, Features…) |
| Courses | `src/content/courses/` | TinaCMS | Three-level hierarchy: course → chapter → lesson |
| Sermons | `src/content/sermons/` | — | Populated by import pipeline, not edited manually |
| Announcements | `src/content/announcements/` | Sveltia | Rich-text body, optional expiry date |
| Devotions | `src/content/devotion/` | Sveltia | One MDX per day, named `YYYY-MM-DD.mdx` |
| Three Minutes | `src/content/threeminutes/` | Sveltia | Short outreach articles |
| Events | `src/content/events/` | Sveltia | Dated events with optional registration link |
| Guides | `src/content/guides/` | Sveltia | Long-form reference articles |
| Amplify | `src/content/amplify/` | Sveltia | Teen ministry lessons |
| Kids — Pre-School | `src/content/kids/preschool/` | Sveltia | Kids church lessons |
| Kids — Junior | `src/content/kids/junior/` | Sveltia | Kids church lessons |
| Kids — Senior | `src/content/kids/senior/` | Sveltia | Kids church lessons |
| Global config | `src/content/config/config.json` | TinaCMS | Nav, SEO, contact links, auth copy |

### TinaCMS schema changes

After any change to `tina/collections/*.ts`:

1. The running `pnpm dev` server regenerates `tina/tina-lock.json` automatically
2. Commit **both** the collection file and `tina-lock.json` in the same commit
3. Push — TinaCloud reads `tina-lock.json` to validate the schema during the Cloudflare build

Forgetting to commit `tina-lock.json` causes a `ERR_CLOUD_CHECK_FAILED` build error.

### Sermon import pipeline

Sermons are sourced from Google Drive and imported via scripts:

```sh
pnpm sermons:download   # Pull raw sermon data from Drive → scripts/drive/
pnpm sermons:images     # Download sermon images
pnpm sermons:audio      # Upload audio to Cloudflare R2
pnpm sermons:import     # Write MDX files into src/content/sermons/

pnpm sermons:latest     # Import only the most recent sermon
pnpm sermons:check      # Report what's missing without writing anything
```

Sermons with `review: true` in frontmatter are hidden from the listing page until the flag is removed.

## Member auth

Sign-in uses passwordless magic links:

1. Member enters their email at `/login`
2. The server checks it against Planning Center Online (PCO) People API
3. If found, a time-limited sign-in link is emailed via Resend
4. Clicking the link sets a session cookie; protected content becomes accessible

## On-demand routes (Cloudflare Worker)

These routes run as Worker handlers — everything else is pre-rendered static HTML:

| Route | Purpose |
|-------|---------|
| `/today` | Redirects to today's devotion (`/devotion/YYYY-MM-DD`), computed at UTC+2. Cached at the edge until SA midnight — the Worker runs once per edge location per day. |
| `/login` | Magic-link sign-in form |
| `/auth/check-email` | Post-submission confirmation page |
| `/auth/denied` | Access denied |
| `/auth/expired` | Expired magic-link |
| `/api/auth/login` | Sends the magic-link email |
| `/api/auth/verify` | Validates token, sets session cookie |
| `/api/auth/logout` | Clears session cookie |
| `/api/courses/progress` | Reads/writes lesson progress to Cloudflare KV |
| `/api/stream-status` | Live stream availability check |
| `/courses/` | Course listing — reads KV for member progress |
| `/courses/[course]/` | Course detail — reads KV for member progress |
| `/courses/[course]/[chapter]/[lesson]` | Lesson page — reads/writes KV |
| `/tina-island/[name]` | TinaCMS visual editing islands |

## Deployment

The Astro adapter is auto-detected from the build environment (Cloudflare, Vercel, Netlify, or Node). `wrangler.jsonc` targets Cloudflare Workers.

Before the first deploy:
1. Create a project at [app.tina.io](https://app.tina.io)
2. Set `PUBLIC_TINA_CLIENT_ID` and `TINA_TOKEN` in Cloudflare's environment variables
3. Set the auth variables (`PCO_APP_ID`, `PCO_SECRET`, `RESEND_API_KEY`)
4. Set `SITE_URL` to the production URL

For Sveltia CMS to work in production, a GitHub OAuth proxy Worker must be deployed separately — see the auth setup instructions in `public/edit/config.yml`.
