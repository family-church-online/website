#!/usr/bin/env node
/**
 * Patches only the `tags:` section of existing sermon MDX files using
 * canonical tags from the comp-tax JSON files in scripts/drive/comp-tax/.
 * All other frontmatter is left untouched.
 *
 * Matching: comp-tax and MDX are both keyed by YYYY-MM-DD prefix. Since no
 * two sermons share a date, this is unambiguous. Exact stem matches are
 * preferred; date-only fallback handles slug divergences (e.g. chosen-baptism
 * vs chosen-for-baptism).
 *
 * Usage:
 *   node scripts/patch-sermon-tags.mjs           # patch all
 *   node scripts/patch-sermon-tags.mjs --dry-run # report only
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMP_TAX_DIR = join(__dirname, 'drive', 'comp-tax');
const SERMONS_DIR = join(__dirname, '..', 'src', 'content', 'sermons');
const DRY_RUN = process.argv.includes('--dry-run');

// ── helpers ────────────────────────────────────────────────────────────────

function datePrefix(filename) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Format a single tag as a YAML list item, quoting when necessary. */
function tagYaml(tag) {
  // Quote if the string contains `: ` (YAML mapping indicator),
  // `&` (anchor), `'` (single quote), or `#` (comment).
  if (/[&'#]|: /.test(tag)) {
    return `  - "${tag.replace(/"/g, '\\"')}"`;
  }
  return `  - ${tag}`;
}

/**
 * Replace the `tags:` block in MDX frontmatter.
 * Handles both block-style and inline (tags: []) formats.
 * Returns the new file content, or null if no `tags:` field found.
 */
function replaceTags(content, newTags) {
  const lines = content.split('\n');

  if (!lines[0]?.startsWith('---')) return null;

  const fmEnd = lines.indexOf('---', 1);
  if (fmEnd === -1) return null;

  let tagsStart = -1;
  let tagsEnd = -1;

  for (let i = 1; i < fmEnd; i++) {
    if (/^tags:/.test(lines[i])) {
      tagsStart = i;
      tagsEnd = i + 1;
      // Consume any following indented/continuation lines
      while (tagsEnd < fmEnd && /^[ \t]/.test(lines[tagsEnd])) {
        tagsEnd++;
      }
      break;
    }
  }

  if (tagsStart === -1) return null;

  const tagLines = newTags.length === 0
    ? ['tags: []']
    : ['tags:', ...newTags.map(tagYaml)];

  return [
    ...lines.slice(0, tagsStart),
    ...tagLines,
    ...lines.slice(tagsEnd),
  ].join('\n');
}

// ── build lookup maps ──────────────────────────────────────────────────────

const mdxByDate = new Map();   // YYYY-MM-DD → full path
const mdxByStem = new Map();   // stem (no .mdx) → full path

for (const f of readdirSync(SERMONS_DIR).filter(f => f.endsWith('.mdx'))) {
  const stem = f.replace('.mdx', '');
  const date = datePrefix(f);
  const full = join(SERMONS_DIR, f);
  mdxByStem.set(stem, full);
  if (date) mdxByDate.set(date, full); // last one wins; no duplicate dates
}

const taxFiles = readdirSync(COMP_TAX_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

// ── main loop ─────────────────────────────────────────────────────────────

let patched = 0, skipped = 0, noMatch = 0;

for (const taxFile of taxFiles) {
  const stem = taxFile.replace('.json', '');
  const date = datePrefix(taxFile);

  // Prefer exact stem match; fall back to same-date MDX
  const mdxPath = mdxByStem.get(stem) ?? (date ? mdxByDate.get(date) : null);

  if (!mdxPath) {
    console.log(`  NO MATCH: ${taxFile}`);
    noMatch++;
    continue;
  }

  const taxData = JSON.parse(readFileSync(join(COMP_TAX_DIR, taxFile), 'utf-8'));
  const newTags = taxData.tags ?? [];

  const original = readFileSync(mdxPath, 'utf-8');
  const updated = replaceTags(original, newTags);

  if (updated === null) {
    console.log(`  NO TAGS FIELD: ${mdxPath}`);
    skipped++;
    continue;
  }

  if (updated === original) {
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    const mdxStem = mdxPath.split('/').pop().replace('.mdx', '');
    if (stem !== mdxStem) {
      console.log(`  [dry] ${stem} → ${mdxStem}`);
    }
    patched++;
    continue;
  }

  writeFileSync(mdxPath, updated);
  const mdxStem = mdxPath.split('/').pop().replace('.mdx', '');
  if (stem !== mdxStem) {
    console.log(`  patched: ${stem} → ${mdxStem}`);
  }
  patched++;
}

console.log(`\nDone: ${patched} patched, ${skipped} unchanged, ${noMatch} unmatched.`);
