#!/usr/bin/env node
/**
 * Append scripture reference to sermon titles that don't already have one.
 *
 * Before: title: Lukewarm
 * After:  title: "Lukewarm : Revelation 3:14-22"
 *
 * Run: node scripts/add-scripture-to-titles.mjs [--dry-run]
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT        = join(fileURLToPath(import.meta.url), '../..');
const SERMONS_DIR = join(ROOT, 'src/content/sermons');
const DRY_RUN     = process.argv.includes('--dry-run');

const TRANSLATIONS = /\s+(ESV|NIV|NKJV|NLT|KJV|CSB|NASB|NET|MSG|AMP|CEV|BSB|LSB)$/i;

function stripTranslation(s) {
  return s.replace(TRANSLATIONS, '').trim();
}

function hasScriptureRef(title) {
  // "Title : Book Chapter:Verse" or "Title: Book Chapter:Verse"
  return /:\d/.test(title);
}

function yamlQuote(str) {
  // Always double-quote; escape any internal double quotes
  return `"${str.replace(/"/g, '\\"')}"`;
}

function extractField(frontmatter, field) {
  // Handles: field: value  /  field: "value"  /  field: 'value'
  const re = new RegExp(`^${field}:\\s*(?:"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"|'([^']*)'|(.+))\\s*$`, 'm');
  const m = frontmatter.match(re);
  if (!m) return null;
  return (m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2] !== undefined ? m[2] : m[3]).trim();
}

async function main() {
  const files = (await readdir(SERMONS_DIR)).filter(f => f.endsWith('.mdx')).sort();
  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const content = await readFile(join(SERMONS_DIR, file), 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) { console.warn(`${file}: no frontmatter`); continue; }
    const fm = fmMatch[1];

    const title     = extractField(fm, 'title');
    const scripture = extractField(fm, 'scripture');

    if (!title)     { console.warn(`${file}: missing title`);     skipped++; continue; }
    if (!scripture) { console.warn(`${file}: missing scripture`); skipped++; continue; }
    if (hasScriptureRef(title)) { skipped++; continue; }

    const ref      = stripTranslation(scripture);
    const newTitle = `${title} : ${ref}`;

    if (DRY_RUN) {
      console.log(`${file}`);
      console.log(`  ${title}  →  ${newTitle}`);
      updated++;
      continue;
    }

    // Replace the title: line in the raw content (not just frontmatter)
    const newTitleLine = `title: ${yamlQuote(newTitle)}`;
    const newContent   = content.replace(
      /^title:\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|.+)$/m,
      newTitleLine,
    );

    if (newContent === content) {
      console.warn(`${file}: title line not replaced — check format`);
      skipped++;
      continue;
    }

    await writeFile(join(SERMONS_DIR, file), newContent, 'utf8');
    updated++;
  }

  console.log(`\n${DRY_RUN ? '[dry run] ' : ''}Updated: ${updated}  Skipped: ${skipped}`);
}

main().catch(err => { console.error(err); process.exit(1); });
