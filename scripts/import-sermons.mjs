/**
 * Import sermons from local Drive cache into src/content/sermons/.
 *
 * Run scripts/download-sermons.mjs first to populate the cache.
 *
 * Usage:
 *   node scripts/import-sermons.mjs --check          cache vs local status report
 *   node scripts/import-sermons.mjs --latest         import the most recent sermon
 *   node scripts/import-sermons.mjs --limit 5        import up to 5 missing sermons
 *   node scripts/import-sermons.mjs --force          re-import even if already exists
 *   node scripts/import-sermons.mjs                  import all missing sermons
 *
 * Cache layout (populated by download-sermons.mjs):
 *   scripts/drive/comp-tax/       {slug}.json
 *   scripts/drive/enriched/       {slug}.md
 *   scripts/drive/sermon-blocks/  {slug}.html
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env')); } catch {}

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const CACHE_DIR   = join(__dirname, 'drive');
const SERMONS_DIR = join(ROOT, 'src/content/sermons');

const DIR = {
  compTax:      join(CACHE_DIR, 'comp-tax'),
  enriched:     join(CACHE_DIR, 'enriched'),
  sermonBlocks: join(CACHE_DIR, 'sermon-blocks'),
};
const MANIFEST  = join(__dirname, 'r2-manifest.json');
const RSS_FILE  = join(CACHE_DIR, 'sermons.rss');

const r2Manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf-8'))
  : {};

// Build a date → guid map from the Squarespace RSS so we preserve the exact
// opaque GUIDs that podcast apps (Spotify, Apple) already have indexed.
// Keyed by YYYY-MM-DD extracted from each item's <pubDate>.
function loadRssGuids() {
  if (!existsSync(RSS_FILE)) return {};
  const xml = readFileSync(RSS_FILE, 'utf-8');
  const map  = {};
  // Extract each <item>…</item> block, then pull pubDate and guid from it
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block   = item[1];
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
    const guid    = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim();
    if (!pubDate || !guid) continue;
    // Parse RFC 2822 date → YYYY-MM-DD
    const d = new Date(pubDate);
    if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10); // "2026-08-23"
    map[key] = guid;
  }
  return map;
}

const rssGuids = loadRssGuids();

// ─── Colour helpers ───────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;
const warn  = `${c.yellow}⚠${c.reset}`;

// ─── File helpers ─────────────────────────────────────────────────────────────

function readCache(dir, slug, ext) {
  const p = join(dir, `${slug}.${ext}`);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

// All slugs present in comp-tax (the canonical list), excluding private files
function compTaxSlugs() {
  if (!existsSync(DIR.compTax)) return [];
  return readdirSync(DIR.compTax)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => f.replace(/\.json$/, ''))
    .filter(slug => /^\d{4}-\d{2}-\d{2}-/.test(slug))
    .sort((a, b) => b.localeCompare(a)); // newest first
}

// All MDX slugs already imported into src/content/sermons/
function importedSlugs() {
  if (!existsSync(SERMONS_DIR)) return new Set();
  return new Set(
    readdirSync(SERMONS_DIR)
      .filter(f => f.endsWith('.mdx'))
      .map(f => f.replace(/\.mdx$/, ''))
  );
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseCompTax(json) {
  const d = JSON.parse(json);
  return {
    title:      d.title,
    date:       d.date,
    series:     d.series     ?? null,
    scripture:  d.sermon_scripture ?? null,
    categories: d.category   ?? [],
    tags:       (d.tags ?? []).filter(t => !/^(Series|Book|Ref):\s/.test(t)),
    review:     d.review ?? false,
  };
}

function parseEnrichedMd(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: content };

  const fm = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let   val = line.slice(colon + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val !== '' && !isNaN(Number(val))) fm[key] = Number(val);
    else if (val === 'true')  fm[key] = true;
    else if (val === 'false') fm[key] = false;
    else fm[key] = val;
  }

  const body = match[2]
    .replace(/^#\s+[^\n]+\n+/, '')
    .replace(/^##\s+Transcript\s*\n+/m, '')
    .trim();

  return { fm, body };
}

const TS_SPAN = 'style="font-size:0.75em;opacity:0.55;margin-right:0.4em;font-variant-numeric:tabular-nums"';

// Build the transcript panel HTML from the enriched MD body, matching the
// exact format of the Aug 2026 sermon blocks (alternating tinted sections,
// inline-styled timestamp spans).
function buildTranscriptPanel(mdBody) {
  const lines    = mdBody.split('\n');
  const sections = [];
  let   current  = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('### ')) {
      if (current) sections.push(current);
      current = { heading: line.slice(4).trim(), paras: [] };
    } else if (current) {
      const para = line.replace(
        /^\[(\d{1,2}:\d{2})\]\s*/,
        `<span ${TS_SPAN}>[$1]</span> `
      );
      current.paras.push(para);
    }
  }
  if (current) sections.push(current);
  if (!sections.length) return '';

  const inner = sections.map((s, i) => {
    const cls = i % 2 === 0
      ? 'sfc-notes-section'
      : 'sfc-notes-section sfc-notes-section--tinted';
    const paras = s.paras.map(p => `        <p>${p}</p>`).join('\n');
    return `\n      <div class="${cls}">\n        <div class="sfc-col-label">${s.heading}</div>\n${paras}\n      </div>`;
  }).join('\n');

  return `\n  <!-- TRANSCRIPT PANEL -->\n  <div class="sfc-panel" data-panel="transcript">\n    <div class="sfc-notes">${inner}\n    </div>\n  </div>\n`;
}

// Return true if the HTML already has a transcript panel with content
function hasTranscript(html) {
  return /data-panel="transcript"[\s\S]*?<p[\s\S]*?<\/p>/.test(html);
}

// Inject a built transcript panel before the closing </div> of the .sfc wrapper
function injectTranscript(html, mdBody) {
  const panel = buildTranscriptPanel(mdBody);
  if (!panel) return html;
  // Insert before the final </div> that closes the sfc root
  return html.replace(/(\n?<\/div>\s*)$/, panel + '$1');
}

function parseSermonBlock(html) {
  const dec = (s) => s
    .replace(/&amp;/g,  '&').replace(/&lt;/g,   '<').replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#x2F;/g, '/').replace(/&#39;/g,  "'");

  const strip = (s) => dec(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  const grab = (re) => {
    const m = html.match(re);
    return m ? strip(m[1]) : null;
  };

  // ── HTML comment block ───────────────────────────────────────────────────
  let shortDescription = null, tagLine = null;
  const cm = html.match(/<!--([\s\S]*?)-->/);
  if (cm) {
    const sdm = cm[1].match(/SHORT DESCRIPTION[^\n]*\n[^\n]*·[^\n]*\n([\s\S]*?)(?:\n[ \t]*\n|TAG LINE)/);
    if (sdm) shortDescription = sdm[1].replace(/\n/g, ' ').trim();

    const tlm = cm[1].match(/TAG LINE[^\n]*\n([^\n]+)/);
    if (tlm) tagLine = tlm[1].trim();
  }

  // ── About panel ──────────────────────────────────────────────────────────
  const primaryTheme = grab(/<span class="sfc-primary-theme">(.*?)<\/span>/);
  const subtitle     = grab(/<div class="sfc-subtitle">\s*<p>([\s\S]*?)<\/p>/);

  const pills = [...html.matchAll(/<span class="sfc-pill">(.*?)<\/span>/g)].map(m => dec(m[1]));
  const style = pills[0] ?? null;
  const level = pills[1] ?? null;

  const hook = grab(/<p class="sfc-hook">([\s\S]*?)<\/p>/);

  const tagsBlock = html.match(/<ul class="sfc-tags">([\s\S]*?)<\/ul>/);
  const takeaways = tagsBlock
    ? [...tagsBlock[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => strip(m[1]))
    : [];

  const audBlock = html.match(/<ul class="sfc-audience">([\s\S]*?)<\/ul>/);
  const audience = audBlock
    ? [...audBlock[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => strip(m[1]))
    : [];

  const additionalScriptures = [...html.matchAll(
    /<div class="sfc-scripture-entry">\s*<span class="sfc-ref">(.*?)<\/span>\s*<span class="sfc-theme">([\s\S]*?)<\/span>\s*<\/div>/g
  )].map(m => ({ ref: dec(m[1].trim()), theme: strip(m[2]) }));

  // ── Notes panel ──────────────────────────────────────────────────────────
  const notesText = (label) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = html.match(
      new RegExp(`<div class="sfc-col-label">${esc}<\\/div>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i')
    );
    return m ? strip(m[1]) : null;
  };

  const notesItems = (label) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = html.match(
      new RegExp(`<div class="sfc-col-label">${esc}<\\/div>\\s*<ul[^>]*>([\\s\\S]*?)<\\/ul>`, 'i')
    );
    return m
      ? [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m2 => strip(m2[1]))
      : [];
  };

  const bigIdea = notesText('The Big Idea');

  const bqm = html.match(/<blockquote class="sfc-notes-quote">\s*<p>([\s\S]*?)<\/p>(?:\s*<cite>([\s\S]*?)<\/cite>)?/);
  const keyScriptureText = bqm ? strip(bqm[1]) : null;
  const keyScriptureRef  = bqm?.[2] ? dec(bqm[2].trim()) : null;

  const olm = html.match(/<ol class="sfc-notes-list">([\s\S]*?)<\/ol>/);
  const mainPoints = olm
    ? [...olm[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => {
        const sm = m[1].match(/<strong>([\s\S]*?)<\/strong>/);
        return {
          title: sm ? strip(sm[1]) : '',
          body:  strip(m[1].replace(/<strong>[\s\S]*?<\/strong>/, '')),
        };
      })
    : [];

  const keyIllustration = notesText('Key Illustration');
  const application     = notesItems('What This Means for Us');
  const toRemember      = grab(/<p class="sfc-notes-closing">([\s\S]*?)<\/p>/) ?? notesText('To Remember');
  const closingPrayer   = notesText('Closing Prayer');

  return {
    shortDescription, tagLine,
    primaryTheme, subtitle, hook, style, level,
    takeaways, audience, additionalScriptures,
    bigIdea, keyScriptureText, keyScriptureRef,
    mainPoints, keyIllustration, application,
    toRemember, closingPrayer,
  };
}

// Empty block result for sermons with no sermon-blocks file
function emptyBlock() {
  return {
    shortDescription: null, tagLine: null,
    primaryTheme: null, subtitle: null, hook: null, style: null, level: null,
    takeaways: [], audience: [], additionalScriptures: [],
    bigIdea: null, keyScriptureText: null, keyScriptureRef: null,
    mainPoints: [], keyIllustration: null, application: [],
    toRemember: null, closingPrayer: null,
  };
}

// ─── MDX generation ───────────────────────────────────────────────────────────

function q(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  const s = String(val);
  if (s === '') return '""';
  const needsQuotes = /[:#\[\]{}*&!|>'"%@`\\]/.test(s) ||
                      s.startsWith(' ') || s.endsWith(' ') ||
                      s.includes('\n') || /^(true|false|null|~)$/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const yamlList = (items) =>
  items?.length ? '\n' + items.map(i => `  - ${q(i)}`).join('\n') : ' []';

const yamlObjList = (items, fields) =>
  items?.length
    ? '\n' + items.map(item =>
        fields.map((f, i) => `  ${i === 0 ? '- ' : '  '}${f}: ${q(item[f])}`).join('\n')
      ).join('\n')
    : ' []';

function generateMDX(data, transcriptBody) {
  return `---
# ── IDENTITY ──────────────────────────────────────────────────────────────────
title: ${q(data.title)}
date: ${data.date}
speaker: ${q(data.speaker)}
series: ${q(data.series)}

# ── SCRIPTURE ─────────────────────────────────────────────────────────────────
scripture: ${q(data.scripture)}
primaryTheme: ${q(data.primaryTheme)}

additionalScriptures:${yamlObjList(data.additionalScriptures, ['ref', 'theme'])}

# ── MEDIA ─────────────────────────────────────────────────────────────────────
image: ${q(data.image)}
audioUrl: ${q(data.audioUrl)}
audioSizeBytes: ${data.audioSizeBytes ?? 'null'}
vimeoUrl: ${q(data.vimeoUrl)}
durationMinutes: ${data.durationMinutes ?? 'null'}

# ── PRESENTATION COPY ─────────────────────────────────────────────────────────
tagLine: ${q(data.tagLine)}
shortDescription: ${q(data.shortDescription)}
subtitle: ${q(data.subtitle)}
hook: ${q(data.hook)}

# ── STYLE ─────────────────────────────────────────────────────────────────────
style: ${q(data.style)}
level: ${q(data.level)}

# ── ABOUT LISTS ───────────────────────────────────────────────────────────────
takeaways:${yamlList(data.takeaways)}

audience:${yamlList(data.audience)}

# ── SERMON NOTES ──────────────────────────────────────────────────────────────
bigIdea: ${q(data.bigIdea)}
keyScriptureRef: ${q(data.keyScriptureRef)}
keyScriptureText: ${q(data.keyScriptureText)}

mainPoints:${yamlObjList(data.mainPoints, ['title', 'body'])}

keyIllustration: ${q(data.keyIllustration)}

application:${yamlList(data.application)}

toRemember: ${q(data.toRemember)}
closingPrayer: ${q(data.closingPrayer)}

# ── TAXONOMY ──────────────────────────────────────────────────────────────────
categories:${yamlList(data.categories)}

tags:${yamlList(data.tags)}

# ── METADATA ──────────────────────────────────────────────────────────────────
guid: ${q(data.guid)}
review: ${data.review ?? false}
transcribedBy: ${q(data.transcribedBy)}
wordCount: ${data.wordCount ?? 'null'}
---

${transcriptBody}
`.trimEnd() + '\n';
}

// ─── Core import logic ────────────────────────────────────────────────────────

function mergeData(slug, compTax, enrichedFm, block) {
  const r2 = r2Manifest[slug];
  return {
    title:    compTax.title,
    date:     compTax.date,
    speaker:  enrichedFm.speaker ?? 'Peter Stoffberg',
    series:   compTax.series,

    scripture:            compTax.scripture,
    primaryTheme:         block.primaryTheme,
    additionalScriptures: block.additionalScriptures,

    image:           (() => {
      for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
        if (existsSync(join(ROOT, 'public', 'images', 'sermons', `${slug}${ext}`)))
          return `/images/sermons/${slug}${ext}`;
      }
      return enrichedFm.image_url ?? null;
    })(),
    audioUrl:        r2?.url ?? enrichedFm.audio_url ?? null,
    audioSizeBytes:  r2?.bytes ?? null,
    vimeoUrl:        enrichedFm.vimeo_url ?? null,
    durationMinutes: enrichedFm.duration_minutes ?? null,

    tagLine:          block.tagLine,
    shortDescription: block.shortDescription,
    subtitle:         block.subtitle,
    hook:             block.hook,

    style: block.style,
    level: block.level,

    takeaways: block.takeaways,
    audience:  block.audience,

    bigIdea:          block.bigIdea,
    keyScriptureRef:  block.keyScriptureRef ?? compTax.scripture,
    keyScriptureText: block.keyScriptureText,
    mainPoints:       block.mainPoints,
    keyIllustration:  block.keyIllustration,
    application:      block.application,
    toRemember:       block.toRemember,
    closingPrayer:    block.closingPrayer,

    categories: compTax.categories,
    tags:       compTax.tags,

    // Squarespace GUID looked up by date from sermons.rss — null for new sermons
    guid:          rssGuids[compTax.date] ?? null,

    review:        compTax.review,
    transcribedBy: enrichedFm.transcribed_by ?? null,
    wordCount:     enrichedFm.word_count ?? null,
  };
}

function importOne(slug) {
  const jsonText = readCache(DIR.compTax,      slug, 'json');
  const mdText   = readCache(DIR.enriched,     slug, 'md');
  let   htmlText = readCache(DIR.sermonBlocks, slug, 'html');

  if (!jsonText) { console.log(`  ${warn} ${slug} — missing comp-tax JSON — skipped`); return false; }
  if (!mdText)   { console.log(`  ${warn} ${slug} — missing enriched MD — skipped`);   return false; }

  const compTax      = parseCompTax(jsonText);
  const { fm, body } = parseEnrichedMd(mdText);

  let block;
  if (htmlText) {
    if (!hasTranscript(htmlText)) {
      htmlText = injectTranscript(htmlText, body);
    }
    block = parseSermonBlock(htmlText);
  } else {
    block = emptyBlock();
  }

  const data       = mergeData(slug, compTax, fm, block);
  const mdxContent = generateMDX(data, body);

  mkdirSync(SERMONS_DIR, { recursive: true });
  writeFileSync(join(SERMONS_DIR, `${slug}.mdx`), mdxContent, 'utf-8');
  return true;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdCheck() {
  console.log(`\n${c.bold}Sermon Import Status${c.reset}`);
  console.log('═'.repeat(60));

  const all      = compTaxSlugs();
  const imported = importedSlugs();

  let missing = 0;
  for (const slug of all) {
    const hasEnriched = existsSync(join(DIR.enriched,     `${slug}.md`));
    const hasBlock    = existsSync(join(DIR.sermonBlocks, `${slug}.html`));
    const isImported  = imported.has(slug);

    const blockNote = hasBlock ? '' : `${c.dim} (no block)${c.reset}`;

    if (!hasEnriched) {
      // Older sermons without enriched MD — skip silently (there are hundreds)
      continue;
    }
    if (isImported) {
      console.log(`${tick} ${c.dim}imported${c.reset}  ${slug}${blockNote}`);
    } else {
      console.log(`${cross} ${c.red}missing${c.reset}   ${slug}${blockNote}`);
      missing++;
    }
  }

  console.log('─'.repeat(60));
  const importable = all.filter(s => existsSync(join(DIR.enriched, `${s}.md`))).length;
  console.log(`Importable: ${importable}   Imported: ${imported.size}   Missing: ${missing}`);

  if (missing > 0) {
    console.log(`\nRun ${c.cyan}node scripts/import-sermons.mjs${c.reset} to import all missing.\n`);
  } else {
    console.log(`\n${tick} All sermons are imported.\n`);
  }
}

function cmdImport({ latest = false, limit = Infinity, force = false } = {}) {
  const all      = compTaxSlugs();
  const imported = importedSlugs();

  let candidates = all.filter(slug =>
    existsSync(join(DIR.enriched, `${slug}.md`)) &&
    (force || !imported.has(slug))
  );

  if (candidates.length === 0) {
    console.log(`\n${tick} Nothing to import — all sermons are already local.\n`);
    return;
  }

  if (latest)           candidates = candidates.slice(0, 1);
  else if (limit < Infinity) candidates = candidates.slice(0, limit);

  console.log(`\n${c.bold}Importing ${candidates.length} sermon${candidates.length !== 1 ? 's' : ''}${c.reset}\n`);

  let ok = 0, skipped = 0;
  for (const slug of candidates) {
    process.stdout.write(`  ${c.dim}importing${c.reset} ${slug} … `);
    try {
      const result = importOne(slug);
      if (result) { process.stdout.write(`${tick}\n`); ok++; }
      else skipped++;
    } catch (err) {
      process.stdout.write(`${cross}\n`);
      console.error(`  ${c.red}Error:${c.reset} ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n${c.bold}Done.${c.reset} ${ok} imported${skipped ? `, ${skipped} skipped` : ''}.\n`);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}import-sermons${c.reset} — import sermons from local Drive cache into src/content/sermons/

  ${c.cyan}--check${c.reset}       show cache vs local status
  ${c.cyan}--latest${c.reset}      import the most recent sermon only
  ${c.cyan}--limit N${c.reset}     import up to N missing sermons (newest first)
  ${c.cyan}--force${c.reset}       re-import even if already imported
  ${c.cyan}--help${c.reset}        show this message

Run ${c.cyan}node scripts/download-sermons.mjs${c.reset} first to populate the cache.
`);
  process.exit(0);
}

if (!existsSync(DIR.compTax)) {
  console.error(`\n${cross} Cache not found at scripts/drive/`);
  console.error(`Run: node scripts/download-sermons.mjs\n`);
  process.exit(1);
}

const force   = args.includes('--force');
const latest  = args.includes('--latest');
const limitI  = args.indexOf('--limit');
const limit   = limitI !== -1 ? parseInt(args[limitI + 1], 10) : Infinity;

if (args.includes('--check')) {
  cmdCheck();
} else {
  cmdImport({ latest, limit, force });
}
