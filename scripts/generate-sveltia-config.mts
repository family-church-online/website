/**
 * scripts/generate-sveltia-config.mts
 *
 * Generates public/edit/config.yml from the TinaCMS collection schemas.
 * Run via `pnpm sveltia:config`, or automatically as part of every build.
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────────────
 *
 * This script imports the TinaCMS collection TypeScript files DIRECTLY using
 * Node 22's built-in --experimental-strip-types flag, which strips TypeScript
 * type annotations at runtime — no separate compile step, no tsx, no esbuild.
 *
 * A translateFields() function converts TinaCMS field definitions to their
 * Sveltia widget equivalents automatically. When you change a field in
 * tina/collections/*.ts, running `pnpm sveltia:config` (or `pnpm build`)
 * immediately reflects that change in the Sveltia config. No manual sync.
 *
 * The only things that stay hand-maintained below are:
 *   - Collection-level Sveltia config: folder paths, slug templates, create
 *     flags, identifier_field. These don't exist in the TinaCMS schema in a
 *     form that translates cleanly to Sveltia.
 *   - FIELD_OVERRIDES: a small list of intentional divergences where Sveltia
 *     should show the field differently from how TinaCMS defines it.
 *
 * ── BACKGROUND: WHY TWO CMS SYSTEMS ──────────────────────────────────────────
 *
 * This site uses TWO content management systems that co-exist without clashing:
 *
 *   TinaCMS  → served at /admin/
 *     Handles: Pages (block-builder with 17+ polymorphic templates) and
 *     Courses (three-level file hierarchy: course / chapter / lesson).
 *     These require TinaCMS-specific features (visual selector, nested routing,
 *     JSON registry + MDX lesson files) that have no Sveltia equivalent.
 *
 *   Sveltia  → served at /edit/
 *     Handles: everything else — structured content that maps cleanly to
 *     YAML frontmatter fields with an optional markdown body.
 *     Sveltia is a lightweight git-based CMS (GitHub OAuth + direct commits)
 *     with no server-side backend. It's ideal for non-developer editors.
 *
 * The two systems never share a collection. This script is the enforcement
 * mechanism: only the collections listed below are emitted into the Sveltia
 * config. Pages and Courses stay in TinaCMS exclusively.
 *
 * ── FIELD TYPE TRANSLATION ───────────────────────────────────────────────────
 *
 *   TinaCMS type                        → Sveltia widget
 *   ─────────────────────────────────────────────────────
 *   string                              → string
 *   string  + ui.component = textarea   → text
 *   string  + options[]                 → select
 *   string  + list: true  (no options)  → list  (simple string items)
 *   string  + list: true  + options[]   → select + multiple: true
 *   number                              → number
 *   boolean                             → boolean
 *   datetime                            → datetime
 *   image   (+ uploadDir)               → image  (+ per-field media_folder)
 *   object  (not list)                  → object (with fields)
 *   object  + list: true                → list   (with fields)
 *   rich-text (no templates)            → markdown
 *
 * ── THINGS NOT AUTO-TRANSLATED ───────────────────────────────────────────────
 *
 *   TinaCMS ui.router        → Sveltia has no live-preview routing
 *   TinaCMS ui.itemProps     → cosmetic label hint; no Sveltia equivalent
 *   TinaCMS isTitle: true    → replaced by identifier_field on the collection
 *   TinaCMS isBody: true     → ignored; rich-text naturally becomes the body
 *   TinaCMS allowedActions   → replaced by create: false on the collection
 *   TinaCMS global: true     → Sveltia uses a files: collection instead
 *   TinaCMS ui.slugify fn    → Sveltia uses a slug template string instead
 *   TinaCMS description      → omitted (would map to Sveltia `comment` field)
 *   TinaCMS reference type   → skipped; not supported in Sveltia
 *
 * ── CLASH PREVENTION ─────────────────────────────────────────────────────────
 *
 *  1. PATH SEPARATION
 *     TinaCMS builds its SPA to public/admin/. Sveltia lives in public/edit/.
 *     No route conflict.
 *
 *  2. AUTH SEPARATION
 *     TinaCMS uses TinaCloud JWT auth. Sveltia uses GitHub OAuth via a
 *     dedicated Cloudflare Worker proxy (sveltia-cms-auth). Different flow,
 *     different cookies, different tokens.
 *
 *  3. COLLECTION ISOLATION
 *     Only the collections assembled below appear in the Sveltia config.
 *     Pages and Courses are never emitted here.
 *
 *  4. MEDIA
 *     TinaCMS uses TinaCloud's asset API. Sveltia commits images directly to
 *     the repo via the GitHub API. Both land as files in git. Use one tool
 *     per collection for uploads and don't mix them.
 *
 *  5. BUILD ORDER
 *     This script runs BEFORE tinacms build, so config.yml is present before
 *     Astro copies public/ to the output bundle. TinaCMS never touches
 *     public/edit/.
 *
 * ── HOW TO INVOKE ────────────────────────────────────────────────────────────
 *
 *   Automatically: runs at the start of `pnpm build` and `pnpm build:local`
 *   Manually:      node --experimental-strip-types scripts/generate-sveltia-config.mts
 *   npm script:    pnpm sveltia:config
 */

import { writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// TinaCMS collection definitions imported directly — Node 22 strips type
// annotations at runtime via --experimental-strip-types, so .ts files load
// without any compile step. The `import type { Collection }` in each file
// is a type-only import that is completely removed at runtime.
import { SermonCollection }         from '../tina/collections/sermon.ts';
import { DevotionCollection }       from '../tina/collections/devotion.ts';
import { ThreeMinutesCollection }   from '../tina/collections/three-minutes.ts';
import { EventCollection }          from '../tina/collections/event.ts';
import { GuideCollection }          from '../tina/collections/guide.ts';
import { ministryLessonCollection } from '../tina/collections/ministry-lesson.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const OUT_DIR   = resolve(ROOT, 'public/edit');
const OUT_FILE  = resolve(OUT_DIR, 'config.yml');

// ── YAML SERIALISER ───────────────────────────────────────────────────────────
// A minimal block-style YAML emitter for the subset of types we use.
// We avoid a yaml dependency to keep the script dependency-free.

/** Wrap a string in double-quotes if it contains YAML-unsafe characters. */
function yamlStr(str: string): string {
  if (str === '' || str === null || str === undefined) return '""';
  const unsafe =
    /^[\s\-?:,[\]{}#&*!|>'"%@`~]/.test(str) || // dangerous first char
    /:\s|^---| #/.test(str)                    || // inline structural tokens
    /[\n\r]/.test(str)                          || // newlines
    /^(true|false|null|yes|no|on|off)$/i.test(str.trim()); // reserved words
  return unsafe
    ? `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    : str;
}

/** Scalar value → inline YAML literal (no trailing newline). */
function scalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number')  return String(value);
  return yamlStr(String(value));
}

/** key + value → one or more YAML lines at the given indent depth. */
function kvLine(key: string, value: unknown, depth: number): string {
  const ind = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return `${ind}${key}: []\n`;
    return `${ind}${key}:\n${value.map(i => itemLine(i, depth + 1)).join('')}`;
  }
  if (value !== null && typeof value === 'object') {
    const body = objLines(value as Record<string, unknown>, depth + 1);
    return body ? `${ind}${key}:\n${body}` : `${ind}${key}: {}\n`;
  }
  return `${ind}${key}: ${scalar(value)}\n`;
}

/** Object → YAML block (all key-value lines). */
function objLines(obj: Record<string, unknown>, depth: number): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => kvLine(k, v, depth))
    .join('');
}

/** Array item → YAML `- key: value` block. */
function itemLine(item: unknown, depth: number): string {
  const ind = '  '.repeat(depth);
  if (item === null || item === undefined) return `${ind}- null\n`;
  if (typeof item !== 'object' || Array.isArray(item)) {
    return `${ind}- ${scalar(item)}\n`;
  }
  const entries = Object.entries(item as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return `${ind}-\n`;

  const [[fk, fv], ...rest] = entries;
  let out: string;
  if (Array.isArray(fv)) {
    out = fv.length
      ? `${ind}- ${fk}:\n${fv.map(i => itemLine(i, depth + 2)).join('')}`
      : `${ind}- ${fk}: []\n`;
  } else if (fv !== null && typeof fv === 'object') {
    out = `${ind}- ${fk}:\n${objLines(fv as Record<string, unknown>, depth + 2)}`;
  } else {
    out = `${ind}- ${fk}: ${scalar(fv)}\n`;
  }
  return out + rest.map(([k, v]) => kvLine(k, v, depth + 1)).join('');
}

/** Top-level entry point: JS value → YAML string. */
function toYaml(value: unknown, depth = 0): string {
  if (Array.isArray(value))              return value.map(i => itemLine(i, depth)).join('');
  if (typeof value === 'object' && value) return objLines(value as Record<string, unknown>, depth);
  return scalar(value) + '\n';
}

// ── FIELD TRANSLATOR ──────────────────────────────────────────────────────────
// Converts a TinaCMS field definition to a Sveltia widget definition.
// Nested object/list fields are translated recursively.

type TinaField = Record<string, unknown>;
type SveltiaField = Record<string, unknown>;

/**
 * Intentional divergences from auto-translation.
 * Key: "collectionName.fieldName", value: Sveltia field definition (or null to skip).
 * Add an entry here when Sveltia should render a field differently from what
 * the TinaCMS type would normally produce.
 */
const FIELD_OVERRIDES: Record<string, SveltiaField | null> = {
  // Sermon image: TinaCMS has `type: image` but editors should not upload via
  // Sveltia — the import pipeline sets this to an R2 URL string.
  'sermon.image': { name: 'image', label: 'Sermon Image', widget: 'string', required: false },

  // Sermon transcript: auto-generated by Deepgram — editors must not edit it.
  'sermon.body': null,
};

function translateField(field: TinaField, collectionName: string): SveltiaField | null {
  const overrideKey = `${collectionName}.${field.name}`;
  if (overrideKey in FIELD_OVERRIDES) return FIELD_OVERRIDES[overrideKey];

  // isTitle is handled at collection level via identifier_field — include the
  // field itself normally (it still renders as a string widget in Sveltia).
  // isBody only affects where TinaCMS stores the value; translation is the same.

  const req = (field.required as boolean) === true ? {} : { required: false };
  const base = { name: field.name, label: field.label, ...req };

  const type = field.type as string;
  const ui   = (field.ui ?? {}) as Record<string, unknown>;
  const list = field.list as boolean | undefined;
  const opts = field.options as unknown[] | undefined;

  switch (type) {
    case 'string':
      if (list && opts?.length) return { ...base, widget: 'select', multiple: true, options: opts };
      if (list)                 return { ...base, widget: 'list' };
      if (opts?.length)         return { ...base, widget: 'select', options: opts };
      if (ui.component === 'textarea') return { ...base, widget: 'text' };
      return { ...base, widget: 'string' };

    case 'number':
      return { ...base, widget: 'number' };

    case 'boolean':
      // Boolean fields have no meaningful required concept — omit it.
      return { name: field.name, label: field.label, widget: 'boolean' };

    case 'datetime': {
      const dateFormat = (ui.dateFormat as string)  ?? 'YYYY-MM-DD';
      const timeFormat = (ui.timeFormat as boolean | string) ?? false;
      return { ...base, widget: 'datetime', date_format: dateFormat, time_format: timeFormat, format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' };
    }

    case 'image': {
      const uploadDir = typeof ui.uploadDir === 'function'
        ? (ui.uploadDir as () => string)()
        : '/images/uploads';
      return { ...base, widget: 'image', media_folder: uploadDir };
    }

    case 'rich-text':
      return { ...base, widget: 'markdown' };

    case 'object': {
      const subFields = translateFields(
        (field.fields as TinaField[] | undefined) ?? [],
        collectionName,
      );
      return list
        ? { ...base, widget: 'list', fields: subFields }
        : { ...base, widget: 'object', fields: subFields };
    }

    case 'reference':
      console.warn(`  ⚠ Skipping "${field.name}" (type "reference" not supported in Sveltia)`);
      return null;

    default:
      console.warn(`  ⚠ Skipping "${String(field.name)}" (unknown TinaCMS type "${type}")`);
      return null;
  }
}

function translateFields(tinaFields: TinaField[], collectionName: string): SveltiaField[] {
  return tinaFields
    .map(f => translateField(f, collectionName))
    .filter((f): f is SveltiaField => f !== null);
}

// ── COLLECTION DEFINITIONS ───────────────────────────────────────────────────
// Fields come from TinaCMS schema via translateFields().
// Collection-level config (folder, slug, create, identifier_field) is
// maintained here because it's Sveltia-specific and has no TinaCMS equivalent.

const editor = { preview: false };

// Shared fields for the four ministry-lesson collections.
// ministryLessonCollection() is a factory — opts affect routing/naming only,
// not the field definitions, so we call it with placeholder values.
const lessonFields = translateFields(
  (ministryLessonCollection({ name: '_', label: '_', path: '_', route: '_' }).fields ?? []) as TinaField[],
  'lesson',
);

const folderCollections = [
  {
    name: 'sermon',
    label: 'Sermons',
    folder: 'src/content/sermons',
    format: 'frontmatter',
    extension: 'mdx',
    create: false,        // Created by the import pipeline, not manually
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}-{{slug}}',
    editor,
    fields: translateFields(SermonCollection.fields as TinaField[], 'sermon'),
  },
  {
    name: 'devotion',
    label: 'Devotions',
    folder: 'src/content/devotion',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}',
    editor,
    fields: translateFields(DevotionCollection.fields as TinaField[], 'devotion'),
  },
  {
    name: 'threeminutes',
    label: 'Three Minutes',
    folder: 'src/content/threeminutes',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{slug}}',
    editor,
    fields: translateFields(ThreeMinutesCollection.fields as TinaField[], 'threeminutes'),
  },
  {
    name: 'event',
    label: 'Events',
    folder: 'src/content/events',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}-{{slug}}',
    editor,
    fields: translateFields(EventCollection.fields as TinaField[], 'event'),
  },
  {
    name: 'guide',
    label: 'Guides',
    folder: 'src/content/guides',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}-{{slug}}',
    editor,
    fields: translateFields(GuideCollection.fields as TinaField[], 'guide'),
  },
  // Ministry lesson collections — four instances of the same field template.
  // create: true because teachers create their own lessons.
  {
    name: 'amplify',
    label: 'Amplify — Teens',
    folder: 'src/content/amplify',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}',
    editor,
    fields: lessonFields,
  },
  {
    name: 'kids-preschool',
    label: 'Kids Church — Pre-School',
    folder: 'src/content/kids/preschool',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}',
    editor,
    fields: lessonFields,
  },
  {
    name: 'kids-junior',
    label: 'Kids Church — Junior',
    folder: 'src/content/kids/junior',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}',
    editor,
    fields: lessonFields,
  },
  {
    name: 'kids-senior',
    label: 'Kids Church — Senior',
    folder: 'src/content/kids/senior',
    format: 'frontmatter',
    extension: 'mdx',
    create: true,
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}',
    editor,
    fields: lessonFields,
  },
];

// No files collections currently — global-config, statement-of-faith, and
// live-video are TinaCMS-only. Add entries here if single-file collections
// ever need Sveltia access.
const filesCollections: unknown[] = [];

// ── WRITE OUTPUT ──────────────────────────────────────────────────────────────

const header = `\
# public/edit/config.yml
#
# AUTO-GENERATED — do not edit this file directly.
# Source: scripts/generate-sveltia-config.mts
# Regenerate: pnpm sveltia:config  (also runs automatically on every build)
#
# Sveltia CMS — served at /edit/
# TinaCMS    — served at /admin/   (Pages, Courses — not managed here)
#
# ── AUTH SETUP (one-time, ~10 minutes) ───────────────────────────────────────
#
# Sveltia uses GitHub OAuth to commit changes on behalf of editors.
# You need a small proxy Worker that holds the OAuth client secret.
#
#  1. Create a GitHub OAuth App (github.com/settings/developers):
#       Homepage URL:   https://familychurch.online
#       Callback URL:   https://sveltia-auth.YOUR-ACCOUNT.workers.dev/callback
#     Copy the Client ID and generate a Client Secret.
#
#  2. Deploy the Sveltia auth proxy Worker:
#       npx wrangler deploy node_modules/sveltia-cms-auth/dist/worker.js \\
#         --name sveltia-auth --compatibility-date 2024-01-01
#     Set the secrets:
#       npx wrangler secret put GITHUB_CLIENT_ID     --name sveltia-auth
#       npx wrangler secret put GITHUB_CLIENT_SECRET --name sveltia-auth
#
#  3. Replace base_url below with https://sveltia-auth.YOUR-ACCOUNT.workers.dev
#
# ─────────────────────────────────────────────────────────────────────────────

`;

const configObj = {
  backend: {
    name:     'github',
    repo:     'family-church-online/website',
    branch:   'master',
    base_url: 'https://sveltia-auth.familychurch.online',
  },
  site_url:      'https://familychurch.online',
  // Sveltia uploads go to public/images/ in the repo, committed via GitHub API.
  // Keep upload dirs consistent with TinaCMS uploadDir values in tina/collections/*.ts.
  media_folder:  'public/images/uploads',
  public_folder: '/images/uploads',
  collections:   [...folderCollections, ...filesCollections],
};

mkdirSync(OUT_DIR, { recursive: true });

// Copy the prebuilt Sveltia CMS JS from node_modules so we serve it locally
// rather than depending on the unpkg CDN. Version-pinned by package.json.
const CMS_SRC  = resolve(ROOT, 'node_modules/@sveltia/cms/dist/sveltia-cms.js');
const CMS_DEST = resolve(OUT_DIR, 'sveltia-cms.js');
copyFileSync(CMS_SRC, CMS_DEST);
console.log(`✓ Sveltia CMS JS copied to ${CMS_DEST}`);

writeFileSync(OUT_FILE, header + toYaml(configObj), 'utf8');
console.log(`✓ Sveltia config written to ${OUT_FILE}`);
