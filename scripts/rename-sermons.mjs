#!/usr/bin/env node
/**
 * Rename sermon MDX files from YYYY-MM-DD-title-slug.mdx
 * to title-slug-scripture-ref.mdx (no date, scripture appended).
 *
 * Also:
 *   - Updates scripts/redirects/familychurch_redirects.csv destinations
 *   - Appends new redirect rows for old date-prefixed live URLs
 *   - Updates tina/collections/sermon.ts slugify to match new format
 *
 * After running (when not --dry-run):
 *   node scripts/build-related-sermons.mjs
 *   pnpm dev  (to regenerate tina-lock.json — commit it)
 *
 * Run: node scripts/rename-sermons.mjs [--dry-run]
 */

import { readdir, readFile, writeFile, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT        = join(fileURLToPath(import.meta.url), '../..');
const SERMONS_DIR = join(ROOT, 'src/content/sermons');
const CSV_PATH    = join(ROOT, 'scripts/redirects/familychurch_redirects.csv');
const TINA_PATH   = join(ROOT, 'tina/collections/sermon.ts');
const DRY_RUN     = process.argv.includes('--dry-run');

const TRANSLATIONS = /\s+(ESV|NIV|NKJV|NLT|KJV|CSB|NASB|NET|MSG|AMP|CEV|BSB|LSB)$/i;

function titleSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function scriptureSlug(scripture) {
  return scripture
    .replace(TRANSLATIONS, '')         // strip "ESV" etc.
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function computeNewSlug(title, scripture) {
  const ts = titleSlug(title);
  if (!scripture) return ts;
  const ss = scriptureSlug(scripture);
  if (ts.endsWith(ss)) return ts;
  return `${ts}-${ss}`;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*["']?(.*?)["']?\s*$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

async function main() {
  const files = (await readdir(SERMONS_DIR))
    .filter(f => f.endsWith('.mdx'))
    .sort();

  // Build old-slug → new-slug map
  const renames = new Map();   // oldSlug → newSlug
  const errors  = [];

  for (const file of files) {
    const oldSlug = file.slice(0, -4); // strip .mdx
    const content = await readFile(join(SERMONS_DIR, file), 'utf8');
    const fm = parseFrontmatter(content);

    if (!fm.title) {
      errors.push(`${file}: missing title`);
      continue;
    }
    if (!fm.scripture) {
      errors.push(`${file}: missing scripture`);
      continue;
    }

    const newSlug = computeNewSlug(fm.title, fm.scripture);
    if (oldSlug !== newSlug) {
      renames.set(oldSlug, newSlug);
    }
  }

  if (errors.length) {
    console.error('\nErrors (files skipped):');
    errors.forEach(e => console.error('  ' + e));
  }

  // Check for collisions
  const newSlugs = [...renames.values()];
  const duplicates = newSlugs.filter((s, i) => newSlugs.indexOf(s) !== i);
  if (duplicates.length) {
    console.error('\nCollision — multiple files map to the same new slug:');
    for (const dup of new Set(duplicates)) {
      const originals = [...renames.entries()].filter(([, v]) => v === dup).map(([k]) => k);
      console.error(`  ${dup} ← ${originals.join(', ')}`);
    }
    process.exit(1);
  }

  console.log(`\nSermons to rename: ${renames.size}`);
  if (renames.size <= 30 || DRY_RUN) {
    for (const [old, nw] of renames) {
      console.log(`  ${old}`);
      console.log(`    → ${nw}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n(dry run — no files modified)');
    await previewCsvChanges(renames);
    return;
  }

  // ── Rename MDX files ─────────────────────────────────────────────────────
  for (const [oldSlug, newSlug] of renames) {
    await rename(
      join(SERMONS_DIR, `${oldSlug}.mdx`),
      join(SERMONS_DIR, `${newSlug}.mdx`),
    );
  }
  console.log(`\nRenamed ${renames.size} files.`);

  // ── Update redirect CSV ──────────────────────────────────────────────────
  await updateCsv(renames);

  // ── Update tina/collections/sermon.ts slugify ────────────────────────────
  await updateTina();

  console.log('\nDone. Next steps:');
  console.log('  node scripts/build-related-sermons.mjs');
  console.log('  pnpm dev   (let tina-lock.json regenerate, then Ctrl-C)');
  console.log('  git add -A && git commit');
}

async function updateCsv(renames) {
  const csv   = await readFile(CSV_PATH, 'utf8');
  const lines = csv.split('\n');
  const newRows = [];

  const updated = lines.map(line => {
    if (!line.trim()) return line;
    const cols = line.split(',');
    if (cols.length < 2) return line;

    const dest = cols[1]; // e.g. https://familychurch.online/sermons/2022-07-03-slug/
    const m = dest.match(/\/sermons\/([^/]+)\//);
    if (!m) return line;

    const oldSlug = m[1];
    const newSlug = renames.get(oldSlug);
    if (!newSlug) return line;

    // Append a redirect from the old (date-prefixed) live URL to the new slug
    newRows.push(
      `familychurch.online/sermons/${oldSlug},https://familychurch.online/sermons/${newSlug}/,301,false,false,false,false`
    );

    // Update the destination in the existing row
    cols[1] = dest.replace(`/sermons/${oldSlug}/`, `/sermons/${newSlug}/`);
    return cols.join(',');
  });

  const finalCsv = [...updated, ...newRows].filter(Boolean).join('\n') + '\n';
  await writeFile(CSV_PATH, finalCsv, 'utf8');
  console.log(`Updated CSV: ${newRows.length} rows updated, ${newRows.length} new rows appended.`);
}

async function previewCsvChanges(renames) {
  const csv  = await readFile(CSV_PATH, 'utf8');
  let shown  = 0;
  for (const line of csv.split('\n')) {
    const cols = line.split(',');
    if (cols.length < 2) continue;
    const m = cols[1].match(/\/sermons\/([^/]+)\//);
    if (!m) continue;
    const oldSlug = m[1];
    if (!renames.has(oldSlug)) continue;
    const newSlug = renames.get(oldSlug);
    console.log(`\n  CSV row dest: ...${oldSlug}/ → ...${newSlug}/`);
    console.log(`  New row:      familychurch.online/sermons/${oldSlug} → /sermons/${newSlug}/`);
    if (++shown >= 5) { console.log('  (showing first 5 only)'); break; }
  }
}

async function updateTina() {
  const src  = await readFile(TINA_PATH, 'utf8');
  const TRANSLATIONS_LITERAL = 'ESV|NIV|NKJV|NLT|KJV|CSB|NASB|NET|MSG|AMP|CEV|BSB|LSB';

  const newSlugify = `\t\t\tslugify: (values) => {
\t\t\t\tconst ts = values.title
\t\t\t\t\t? values.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
\t\t\t\t\t: 'untitled';
\t\t\t\tif (!values.scripture) return ts;
\t\t\t\tconst ss = values.scripture
\t\t\t\t\t.replace(/\\s+(${TRANSLATIONS_LITERAL})$/i, '')
\t\t\t\t\t.toLowerCase()
\t\t\t\t\t.replace(/[^a-z0-9]+/g, '-')
\t\t\t\t\t.replace(/(^-|-$)/g, '');
\t\t\t\tif (ts.endsWith(ss)) return ts;
\t\t\t\treturn \`\${ts}-\${ss}\`;
\t\t\t},`;

  const updated = src.replace(
    /slugify: \(values\) => \{[\s\S]*?\},/,
    newSlugify,
  );

  if (updated === src) {
    console.warn('Warning: could not find slugify function in sermon.ts — update it manually.');
    return;
  }

  await writeFile(TINA_PATH, updated, 'utf8');
  console.log('Updated tina/collections/sermon.ts slugify.');
}

main().catch(err => { console.error(err); process.exit(1); });
