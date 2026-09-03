/**
 * scripts/generate-sveltia-config.mjs
 *
 * Generates public/edit/config.yml from the TinaCMS collection schemas.
 * Run via `pnpm sveltia:config`, or automatically as part of every build.
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
 * mechanism: only the collections listed in SVELTIA_COLLECTIONS are emitted
 * into the Sveltia config. Everything else stays in TinaCMS exclusively.
 *
 * ── WHAT THIS SCRIPT DOES ────────────────────────────────────────────────────
 *
 * The TinaCMS schema is the source of truth (tina/collections/*.ts). This
 * script mirrors the compatible collections in Sveltia's YAML format, so
 * updating a field in TinaCMS and running the build keeps both UIs in sync.
 *
 * The script produces public/edit/config.yml on every build. The file is
 * always overwritten — do not hand-edit it; edit the field definitions below
 * and let the script regenerate it.
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
 * ── THINGS NOT TRANSLATED ────────────────────────────────────────────────────
 *
 *   TinaCMS ui.router        → Sveltia has no live-preview routing
 *   TinaCMS ui.itemProps     → cosmetic label hint; no Sveltia equivalent
 *   TinaCMS isTitle: true    → replaced by identifier_field on the collection
 *   TinaCMS isBody: true     → Sveltia markdown widget stores as file body
 *   TinaCMS allowedActions   → replaced by create: false on the collection
 *   TinaCMS global: true     → Sveltia uses a files: collection instead
 *   TinaCMS ui.slugify fn    → Sveltia uses a slug template string instead
 *
 * ── CLASH PREVENTION ─────────────────────────────────────────────────────────
 *
 *  1. PATH SEPARATION
 *     TinaCMS builds its SPA to public/admin/ (configured in tina/config.ts:
 *     build.outputFolder = "admin", build.publicFolder = "public").
 *     Sveltia lives in public/edit/ — a completely separate directory.
 *     The Cloudflare Worker serves both as static assets; no route conflict.
 *
 *  2. AUTH SEPARATION
 *     TinaCMS uses TinaCloud JWT auth, issued at /api/tina/*.
 *     Sveltia uses GitHub OAuth via a dedicated Cloudflare Worker proxy
 *     (sveltia-cms-auth). Different flow, different cookies, different tokens.
 *     An editor logged into one is not authenticated in the other.
 *
 *  3. COLLECTION ISOLATION
 *     The SVELTIA_COLLECTIONS constant below is the hard boundary. Sveltia
 *     never receives a Pages or Courses entry. TinaCMS never receives a
 *     Sveltia-managed collection in a special way — it still manages them
 *     in its own schema, but the two UIs target the same files independently.
 *
 *  4. MEDIA
 *     TinaCMS uses TinaCloud's asset API for uploads (proxied through tina.io).
 *     Sveltia commits images directly to the repo via the GitHub API, writing
 *     to per-collection subfolders under public/images/. Both ultimately land
 *     as files in git — the difference is the upload mechanism. Avoid uploading
 *     the same image through both; pick one tool per collection and stick to it.
 *
 *  5. GIT COMMITS
 *     Both CMSes commit to the master branch. Conflicts only arise if two
 *     editors save the same file simultaneously — the same risk as any shared
 *     repo. Workflow rule: use Sveltia for structured content (sermons, lessons,
 *     devotions, etc.), TinaCMS for page layout and course structure.
 *
 *  6. BUILD ORDER
 *     This script runs BEFORE tinacms build, so config.yml is committed to
 *     public/edit/ before Astro copies public/ to the output bundle.
 *     TinaCMS only reads tina/ and writes public/admin/ — it never touches
 *     public/edit/.
 *
 * ── HOW TO INVOKE ────────────────────────────────────────────────────────────
 *
 *   Automatically: runs at the start of `pnpm build` and `pnpm build:local`
 *   Manually:      node scripts/generate-sveltia-config.mjs
 *   npm script:    pnpm sveltia:config
 */

import { writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const OUT_DIR   = resolve(ROOT, 'public/edit');
const OUT_FILE  = resolve(OUT_DIR, 'config.yml');

// ── SVELTIA-MANAGED COLLECTIONS ───────────────────────────────────────────────
// This list is the hard boundary between the two CMS systems. Only these
// collection names appear in the generated config. Pages and Courses are
// deliberately absent — they stay in TinaCMS only.
const SVELTIA_COLLECTIONS = [
  'sermon',
  'devotion',
  'threeminutes',
  'event',
  'guide',
  'amplify',
  'kidsPreschool',
  'kidsJunior',
  'kidsSenior',
  // Files collections (single-file, no create/delete):
  'statementOfFaith',
  'liveVideo',
  'globalConfig',
];

// ── YAML SERIALISER ───────────────────────────────────────────────────────────
// A minimal block-style YAML emitter for the subset of types we use.
// We avoid a yaml dependency to keep the script dependency-free.

/** Wrap a string in double-quotes if it contains YAML-unsafe characters. */
function yamlStr(str) {
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
function scalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number')  return String(value);
  return yamlStr(String(value));
}

/** key + value → one or more YAML lines at the given indent depth. */
function kvLine(key, value, depth) {
  const ind = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return `${ind}${key}: []\n`;
    // Items are indented one level deeper than their containing key
    return `${ind}${key}:\n${value.map(i => itemLine(i, depth + 1)).join('')}`;
  }
  if (value !== null && typeof value === 'object') {
    const body = objLines(value, depth + 1);
    return body ? `${ind}${key}:\n${body}` : `${ind}${key}: {}\n`;
  }
  return `${ind}${key}: ${scalar(value)}\n`;
}

/** Object → YAML block (all key-value lines). */
function objLines(obj, depth) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => kvLine(k, v, depth))
    .join('');
}

/** Array item → YAML `- key: value` block. */
function itemLine(item, depth) {
  const ind = '  '.repeat(depth);
  if (item === null || item === undefined) return `${ind}- null\n`;
  if (typeof item !== 'object' || Array.isArray(item)) {
    return `${ind}- ${scalar(item)}\n`;
  }
  const entries = Object.entries(item).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return `${ind}-\n`;

  // First key becomes the `- key: value` opener; rest are indented under it.
  const [[fk, fv], ...rest] = entries;
  let out;
  if (Array.isArray(fv)) {
    out = fv.length
      ? `${ind}- ${fk}:\n${fv.map(i => itemLine(i, depth + 2)).join('')}`
      : `${ind}- ${fk}: []\n`;
  } else if (fv !== null && typeof fv === 'object') {
    out = `${ind}- ${fk}:\n${objLines(fv, depth + 2)}`;
  } else {
    out = `${ind}- ${fk}: ${scalar(fv)}\n`;
  }
  return out + rest.map(([k, v]) => kvLine(k, v, depth + 1)).join('');
}

/** Top-level entry point: JS value → YAML string. */
function toYaml(value, depth = 0) {
  if (Array.isArray(value))              return value.map(i => itemLine(i, depth)).join('');
  if (typeof value === 'object' && value) return objLines(value, depth);
  return scalar(value) + '\n';
}

// ── SHARED FIELD HELPERS ──────────────────────────────────────────────────────

/** Standard YYYY-MM-DD date field (no time). */
const dateField = (name = 'date', label = 'Date', required = true) => ({
  name,
  label,
  widget:      'datetime',
  date_format: 'YYYY-MM-DD',
  time_format: false,
  format:      'YYYY-MM-DDTHH:mm:ss.SSSZ',
  ...(required ? {} : { required: false }),
});

/** Scripture reference + text pair — used in several collections. */
const scriptureLink = [
  { name: 'ref', label: 'Reference', widget: 'string' },
  { name: 'url', label: 'URL',       widget: 'string' },
];

// ── FIELD DEFINITIONS ─────────────────────────────────────────────────────────
// Each block mirrors the matching tina/collections/*.ts definition.
// Field names and types must stay in sync with TinaCMS; run this script after
// any schema change to propagate updates to Sveltia.

// ── sermon ────────────────────────────────────────────────────────────────────
// Mapped from tina/collections/sermon.ts. Sermons are imported by script
// (import-sermons.mjs) and rarely created manually, so create: false.
// The transcript body is script-generated (Deepgram) — editors update
// structured metadata only, so the body field is omitted here.
const sermonFields = [
  { name: 'title',    label: 'Title',    widget: 'string', required: true },
  dateField('date', 'Date'),
  { name: 'speaker',  label: 'Speaker',  widget: 'string', required: true },
  { name: 'series',   label: 'Series',   widget: 'string', required: false },

  // Scripture
  { name: 'scripture',        label: 'Primary Scripture', widget: 'string', required: true },
  { name: 'primaryTheme',     label: 'Primary Theme',     widget: 'string', required: false },
  {
    name: 'additionalScriptures', label: 'Additional Scriptures',
    widget: 'list', required: false,
    fields: [
      { name: 'ref',   label: 'Reference', widget: 'string' },
      { name: 'theme', label: 'Theme',     widget: 'text' },
    ],
  },

  // Media — URLs are populated by import scripts, not manual upload
  { name: 'image',          label: 'Sermon Image',         widget: 'string', required: false },
  { name: 'audioUrl',       label: 'Audio URL',            widget: 'string', required: false },
  { name: 'audioSizeBytes', label: 'Audio File Size (bytes)', widget: 'number', required: false },
  { name: 'vimeoUrl',       label: 'Vimeo URL',            widget: 'string', required: false },
  { name: 'durationMinutes',label: 'Duration (minutes)',   widget: 'number', required: false },

  // Presentation copy
  { name: 'tagLine',           label: 'Tag Line',          widget: 'text', required: false },
  { name: 'shortDescription',  label: 'Short Description', widget: 'text', required: false },
  { name: 'subtitle',          label: 'Subtitle',          widget: 'text', required: false },
  { name: 'hook',              label: 'Hook',              widget: 'text', required: false },

  // Style
  {
    name: 'style', label: 'Preaching Style', widget: 'select', required: false,
    options: ['Expository', 'Pastoral', 'Topical', 'Evangelistic'],
  },
  {
    name: 'level', label: 'Level', widget: 'select', required: false,
    options: ['Introductory', 'Intermediate', 'Advanced'],
  },

  // Lists
  { name: 'takeaways',  label: "What You'll Take Away",  widget: 'list', required: false },
  { name: 'audience',   label: 'This Is For You If…',    widget: 'list', required: false },
  { name: 'application',label: 'What This Means for Us', widget: 'list', required: false },

  // Sermon notes
  { name: 'bigIdea',        label: 'The Big Idea',          widget: 'text',   required: false },
  { name: 'keyScriptureRef',label: 'Key Scripture Reference',widget: 'string', required: false },
  { name: 'keyScriptureText',label:'Key Scripture Text',     widget: 'text',   required: false },
  {
    name: 'mainPoints', label: 'Main Points', widget: 'list', required: false,
    fields: [
      { name: 'title', label: 'Title', widget: 'string' },
      { name: 'body',  label: 'Body',  widget: 'text' },
    ],
  },
  { name: 'keyIllustration', label: 'Key Illustration', widget: 'text',   required: false },
  { name: 'toRemember',      label: 'To Remember',      widget: 'text',   required: false },
  { name: 'closingPrayer',   label: 'Closing Prayer',   widget: 'text',   required: false },

  // Taxonomy
  {
    name: 'categories', label: 'Categories', widget: 'select',
    required: false, multiple: true,
    options: [
      'Suffering & Hope', 'Prayer & Worship', 'Gospel & Salvation', 'Discipleship',
      'Church & Community', 'Family & Relationships', 'Faith & Trust', 'Prophecy & Revelation',
    ],
  },
  { name: 'tags', label: 'Tags', widget: 'list', required: false },

  // Metadata
  { name: 'guid',          label: 'Podcast GUID',    widget: 'string',  required: false },
  { name: 'review',        label: 'Needs Review',    widget: 'boolean' },
  { name: 'transcribedBy', label: 'Transcribed By',  widget: 'string',  required: false },
  { name: 'wordCount',     label: 'Word Count',      widget: 'number',  required: false },
  // body (transcript) omitted — auto-generated by import-sermons.mjs / Deepgram
];

// ── devotion ──────────────────────────────────────────────────────────────────
// Mapped from tina/collections/devotion.ts.
// readingPlans is a deeply nested object (Connected / Chronological / Literary);
// Sveltia handles nested object + list widgets without issue.
const scriptureTextPair = [
  { name: 'ref',  label: 'Reference', widget: 'string' },
  { name: 'text', label: 'Text',      widget: 'text' },
];
const devotionFields = [
  { name: 'title', label: 'Title', widget: 'string', required: true },
  dateField(),
  { name: 'image',     label: 'Sermon Image URL', widget: 'string', required: false },
  { name: 'sermonUrl', label: 'Sermon URL',        widget: 'string', required: false },
  {
    name: 'keyScripture', label: 'Key Scripture', widget: 'object',
    fields: [
      { name: 'ref',  label: 'Reference (e.g. John 3:16)', widget: 'string' },
      { name: 'text', label: 'Text',                       widget: 'text' },
    ],
  },
  { name: 'reflection',        label: 'Reflection',       widget: 'text', required: false },
  {
    name: 'supportingScriptures', label: 'Supporting Scriptures',
    widget: 'list', required: false, fields: scriptureTextPair,
  },
  { name: 'lifeApplication', label: 'Life Application', widget: 'text', required: false },
  { name: 'prayer',          label: 'Prayer',           widget: 'text', required: false },
  {
    name: 'readingPlans', label: 'Reading Plans', widget: 'object', required: false,
    fields: [
      {
        name: 'connected', label: 'Connected Reading', widget: 'object', required: false,
        fields: [
          { name: 'ot',     label: 'Old Testament', widget: 'list', required: false, fields: scriptureLink },
          { name: 'nt',     label: 'New Testament', widget: 'list', required: false, fields: scriptureLink },
          { name: 'wisdom', label: 'Wisdom',        widget: 'list', required: false, fields: scriptureLink },
        ],
      },
      { name: 'chronological', label: 'Chronological', widget: 'list', required: false, fields: scriptureLink },
      {
        name: 'literary', label: 'ESV Literary Study Bible', widget: 'object', required: false,
        fields: [
          { name: 'wisdom',          label: 'Wisdom',             widget: 'list', required: false, fields: scriptureLink },
          { name: 'narrative',       label: 'Narrative',          widget: 'list', required: false, fields: scriptureLink },
          { name: 'historyProphecy', label: 'History & Prophecy', widget: 'list', required: false, fields: scriptureLink },
          { name: 'nt',              label: 'New Testament',      widget: 'list', required: false, fields: scriptureLink },
        ],
      },
    ],
  },
];

// ── three-minutes ─────────────────────────────────────────────────────────────
// Mapped from tina/collections/three-minutes.ts.
// rich-text (no templates) → markdown widget stored as file body.
const threeMinutesFields = [
  { name: 'title',       label: 'Title',       widget: 'string', required: true },
  dateField('date', 'Date', false),
  { name: 'image',       label: 'Image',       widget: 'image',  required: false, media_folder: '/images/three-minutes' },
  { name: 'description', label: 'Description', widget: 'text',   required: false },
  { name: 'body',        label: 'Body',        widget: 'markdown' },
];

// ── event ─────────────────────────────────────────────────────────────────────
// Mapped from tina/collections/event.ts.
const eventFields = [
  { name: 'title', label: 'Title', widget: 'string', required: true },
  {
    name: 'date', label: 'Start Date & Time',
    widget: 'datetime', date_format: 'YYYY-MM-DD', time_format: 'HH:mm',
    format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
  },
  {
    name: 'endDate', label: 'End Date & Time', required: false,
    widget: 'datetime', date_format: 'YYYY-MM-DD', time_format: 'HH:mm',
    format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
  },
  { name: 'location',        label: 'Location',              widget: 'string', required: false },
  { name: 'image',           label: 'Image',                 widget: 'image',  required: false, media_folder: '/images/events' },
  { name: 'description',     label: 'Short Description',     widget: 'text',   required: false },
  { name: 'registrationUrl', label: 'Registration / Info Link', widget: 'string', required: false },
  { name: 'body',            label: 'Full Details',          widget: 'markdown' },
];

// ── guide ─────────────────────────────────────────────────────────────────────
// Mapped from tina/collections/guide.ts.
const guideFields = [
  { name: 'title',   label: 'Title',   widget: 'string', required: true },
  dateField(),
  { name: 'image',   label: 'Image',   widget: 'image',  required: false, media_folder: '/images/guides' },
  { name: 'excerpt', label: 'Excerpt', widget: 'text',   required: false },
  { name: 'body',    label: 'Body',    widget: 'markdown' },
];

// ── ministry lesson (shared template) ────────────────────────────────────────
// Mapped from the updated tina/collections/ministry-lesson.ts.
// The old schema had a single `scripture` string, `image`, and a rich-text
// `body` with embedded MDX component templates (YouTube, Scripture, Download,
// Timeline). Those were not Sveltia-compatible.
// The new schema replaces them with four structured arrays:
//   scriptures → list of { ref, text } objects
//   paragraphs → list of { heading?: string, content: string } (plain text + optional heading)
//   images     → list of { image, description } (uploads to /images/lessons/)
//   videos     → list of { url, description }
const ministryLessonFields = [
  { name: 'title', label: 'Title', widget: 'string', required: true },
  dateField(),
  {
    name: 'scriptures', label: 'Scriptures', widget: 'list', required: false,
    fields: [
      { name: 'ref',  label: 'Reference (e.g. John 3:16)', widget: 'string' },
      { name: 'text', label: 'Text',                       widget: 'text' },
    ],
  },
  {
    name: 'paragraphs', label: 'Paragraphs', widget: 'list', required: false,
    // TinaCloud does not allow rich-text inside object list items, so content
    // is a plain string (textarea). An optional heading allows section breaks.
    fields: [
      { name: 'heading', label: 'Heading', widget: 'string', required: false },
      { name: 'content', label: 'Content', widget: 'text' },
    ],
  },
  {
    name: 'images', label: 'Images', widget: 'list', required: false,
    fields: [
      { name: 'image',       label: 'Image',       widget: 'image', media_folder: '/images/lessons' },
      { name: 'description', label: 'Description', widget: 'string' },
    ],
  },
  {
    name: 'videos', label: 'Videos', widget: 'list', required: false,
    fields: [
      { name: 'url',         label: 'Video URL',   widget: 'string' },
      { name: 'description', label: 'Description', widget: 'text' },
    ],
  },
];

// ── statement-of-faith ────────────────────────────────────────────────────────
// Mapped from tina/collections/statement-of-faith.ts.
// Single JSON file — no create or delete. Sveltia files: collection.
const statementOfFaithFields = [
  {
    name: 'articles', label: 'Articles', widget: 'list',
    fields: [
      { name: 'number',    label: 'Number',            widget: 'number' },
      { name: 'title',     label: 'Title',             widget: 'string', required: true },
      { name: 'summary',   label: 'Summary',           widget: 'text',   required: false },
      { name: 'statement', label: 'Full Statement',    widget: 'text',   required: false },
      { name: 'scriptures',label: 'Scripture References', widget: 'list', required: false },
    ],
  },
];

// ── live-video ────────────────────────────────────────────────────────────────
// Mapped from tina/collections/live-video.ts.
// Single JSON file — no create or delete. Sveltia files: collection.
// NOTE: src/content/live-video/ may not exist yet; create the file when needed.
const liveVideoFields = [
  { name: 'pageHeading', label: 'Page Heading', widget: 'string', required: true },
  {
    name: 'video', label: 'Video Section', widget: 'object',
    fields: [
      { name: 'heading',  label: 'Heading',   widget: 'string', required: false },
      { name: 'embedUrl', label: 'Embed URL', widget: 'string', required: false },
    ],
  },
  {
    name: 'audio', label: 'Audio Section', widget: 'object',
    fields: [
      { name: 'heading',     label: 'Heading',     widget: 'string', required: false },
      { name: 'streamUrl',   label: 'Stream URL',  widget: 'string', required: false },
      { name: 'description', label: 'Description', widget: 'text',   required: false },
    ],
  },
];

// ── global-config ─────────────────────────────────────────────────────────────
// Mapped from tina/collections/global-config.ts.
// Single JSON file. TinaCMS marks this global: true (always accessible in the
// sidebar). Sveltia has no global: concept — it's just a files: collection.
const globalConfigFields = [
  {
    name: 'seo', label: 'Site Identity & SEO', widget: 'object',
    fields: [
      { name: 'title',        label: 'Site Name',                    widget: 'string', required: true },
      { name: 'description',  label: 'Default Meta Description',     widget: 'text',   required: true },
      { name: 'siteOwner',    label: 'Site Owner',                   widget: 'string', required: true },
      { name: 'logo',         label: 'Logo',                         widget: 'image',  required: false, media_folder: '/images/site' },
      { name: 'whatsappPhone',label: 'WhatsApp Phone Number',        widget: 'string', required: false },
    ],
  },
  {
    name: 'nav', label: 'Navigation Menu', widget: 'list',
    fields: [
      { name: 'title', label: 'Link Label', widget: 'string', required: true },
      { name: 'link',  label: 'Link URL',   widget: 'string', required: false },
      {
        name: 'children', label: 'Submenu Items', widget: 'list', required: false,
        fields: [
          { name: 'title', label: 'Label', widget: 'string', required: true },
          { name: 'link',  label: 'URL',   widget: 'string', required: true },
        ],
      },
    ],
  },
  {
    name: 'contactLinks', label: 'Contact Links', widget: 'list',
    fields: [
      { name: 'title', label: 'Title', widget: 'string' },
      { name: 'link',  label: 'Link',  widget: 'string' },
      { name: 'icon',  label: 'Icon',  widget: 'string' },
    ],
  },
  {
    name: 'banner', label: 'Announcement Banner', widget: 'object',
    fields: [
      { name: 'enabled', label: 'Show Banner', widget: 'boolean' },
      { name: 'text',    label: 'Banner Text', widget: 'string', required: false },
      { name: 'link',    label: 'Link URL',    widget: 'string', required: false },
    ],
  },
  {
    name: 'auth', label: 'Member Access', widget: 'object',
    fields: [
      {
        name: 'email', label: 'Sign-in Email', widget: 'object',
        fields: [
          { name: 'subject',  label: 'Subject Line',     widget: 'string', required: false },
          { name: 'intro',    label: 'Intro Text',        widget: 'string', required: false },
          { name: 'linkText', label: 'Link Button Text',  widget: 'string', required: false },
          { name: 'footer',   label: 'Footer Note',       widget: 'string', required: false },
        ],
      },
      {
        name: 'loginPage', label: 'Sign-in Page', widget: 'object',
        fields: [
          { name: 'heading', label: 'Heading',     widget: 'string', required: false },
          { name: 'body',    label: 'Body Text',   widget: 'string', required: false },
          { name: 'footer',  label: 'Footer Note', widget: 'string', required: false },
        ],
      },
      {
        name: 'checkEmailPage', label: 'Check Email Page', widget: 'object',
        fields: [
          { name: 'heading', label: 'Heading',   widget: 'string', required: false },
          { name: 'body',    label: 'Body Text', widget: 'string', required: false },
        ],
      },
      {
        name: 'deniedPage', label: 'Access Denied Page', widget: 'object',
        fields: [
          { name: 'heading', label: 'Heading',   widget: 'string', required: false },
          { name: 'body',    label: 'Body Text', widget: 'string', required: false },
        ],
      },
      {
        name: 'expiredPage', label: 'Link Expired Page', widget: 'object',
        fields: [
          { name: 'heading', label: 'Heading',   widget: 'string', required: false },
          { name: 'body',    label: 'Body Text', widget: 'string', required: false },
        ],
      },
    ],
  },
  {
    name: 'announcements', label: 'Announcements', widget: 'list',
    fields: [
      { name: 'title',     label: 'Title',      widget: 'string', required: true },
      { name: 'body',      label: 'Body',       widget: 'text',   required: false },
      { name: 'link',      label: 'Link URL',   widget: 'string', required: false },
      { name: 'linkLabel', label: 'Link Label', widget: 'string', required: false },
      {
        name: 'expiryDate', label: 'Expiry Date', required: false,
        widget: 'datetime', date_format: 'YYYY-MM-DD', time_format: false,
        format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
      },
    ],
  },
  {
    name: 'kidsChurch', label: 'Kids Church Ministry', widget: 'object',
    fields: [
      { name: 'ministryName',   label: 'Ministry Name',          widget: 'string', required: false },
      { name: 'preschoolLabel', label: 'Pre-School Group Name',  widget: 'string', required: false },
      { name: 'preschoolAges',  label: 'Pre-School Age Range',   widget: 'string', required: false },
      { name: 'juniorLabel',    label: 'Junior Group Name',      widget: 'string', required: false },
      { name: 'juniorAges',     label: 'Junior Age Range',       widget: 'string', required: false },
      { name: 'seniorLabel',    label: 'Senior Group Name',      widget: 'string', required: false },
      { name: 'seniorAges',     label: 'Senior Age Range',       widget: 'string', required: false },
    ],
  },
];

// ── CONFIG ASSEMBLY ───────────────────────────────────────────────────────────
// Assemble the full Sveltia config. Each collection entry mirrors its TinaCMS
// equivalent but expressed in Sveltia's schema format.
//
// Shared collection options:
//   editor.preview: false  — no live preview pane (site uses SSR + Cloudflare;
//                            there is no static preview URL to point at)
//   format: frontmatter    — YAML frontmatter + markdown body (works for .mdx
//                            files too; Sveltia treats them as markdown)
//   identifier_field       — the field Sveltia shows as the item label in lists;
//                            replaces TinaCMS's isTitle: true marker

const editor = { preview: false };

// Folder collections (one file per entry)
const folderCollections = [
  {
    name: 'sermon',
    label: 'Sermons',
    folder: 'src/content/sermons',
    format: 'frontmatter',
    extension: 'mdx',
    create: false,        // Sermons are created by the import pipeline, not manually
    identifier_field: 'title',
    slug: '{{year}}-{{month}}-{{day}}-{{slug}}',
    editor,
    fields: sermonFields,
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
    fields: devotionFields,
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
    fields: threeMinutesFields,
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
    fields: eventFields,
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
    fields: guideFields,
  },
  // Ministry lesson collections — four instances of the same field template.
  // Each maps to a ministryLessonCollection({ ... }) call in tina/config.ts.
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
    fields: ministryLessonFields,
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
    fields: ministryLessonFields,
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
    fields: ministryLessonFields,
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
    fields: ministryLessonFields,
  },
];

// Files collections (single JSON files; no create or delete)
// TinaCMS marks these with allowedActions: { create: false, delete: false }
// or global: true. Sveltia models them as files: collections.
const filesCollections = [
  {
    name: 'statement-of-faith',
    label: 'Statement of Faith',
    editor,
    files: [
      {
        name: 'statement-of-faith',
        label: 'Statement of Faith',
        file: 'src/content/statement-of-faith/index.json',
        fields: statementOfFaithFields,
      },
    ],
  },
  {
    name: 'live-video',
    label: 'Live Video',
    editor,
    files: [
      {
        name: 'live-video',
        label: 'Live Video',
        // NOTE: create src/content/live-video/live.json when this feature is used
        file: 'src/content/live-video/live.json',
        fields: liveVideoFields,
      },
    ],
  },
  {
    name: 'global-config',
    label: 'Global Config',
    editor,
    files: [
      {
        name: 'config',
        label: 'Global Config',
        file: 'src/content/config/config.json',
        fields: globalConfigFields,
      },
    ],
  },
];

// ── WRITE OUTPUT ──────────────────────────────────────────────────────────────

const header = `\
# public/edit/config.yml
#
# AUTO-GENERATED — do not edit this file directly.
# Source: scripts/generate-sveltia-config.mjs
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
    name:       'github',
    repo:       'family-church-online/website',
    branch:     'master',
    // base_url points to the Cloudflare Worker OAuth proxy (see AUTH SETUP above)
    base_url:   'https://sveltia-auth.familychurch.online',
  },
  site_url:      'https://familychurch.online',
  // Sveltia uploads go to public/images/ in the repo, committed via GitHub API.
  // Keep upload dirs consistent with TinaCMS uploadDir values in tina/collections/*.ts
  // so images land in the same per-collection folders regardless of which CMS is used.
  media_folder:  'public/images/uploads',
  public_folder: '/images/uploads',
  collections:   [...folderCollections, ...filesCollections],
};

mkdirSync(OUT_DIR, { recursive: true });

// Copy the prebuilt Sveltia CMS JS from node_modules so we serve it locally
// rather than depending on the unpkg CDN. The file is version-pinned by
// package.json and regenerated here on every build.
const CMS_SRC  = resolve(ROOT, 'node_modules/@sveltia/cms/dist/sveltia-cms.js');
const CMS_DEST = resolve(OUT_DIR, 'sveltia-cms.js');
copyFileSync(CMS_SRC, CMS_DEST);
console.log(`✓ Sveltia CMS JS copied to ${CMS_DEST}`);

writeFileSync(OUT_FILE, header + toYaml(configObj), 'utf8');
console.log(`✓ Sveltia config written to ${OUT_FILE}`);
