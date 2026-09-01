#!/usr/bin/env node
/**
 * Strip raw (non-timestamped) transcripts from sermon MDX files.
 *
 * A "clean" transcript has paragraphs prefixed with [MM:SS] timestamps.
 * Everything else is raw Deepgram output we no longer want to display.
 *
 * For each sermon:
 *   - If the body contains ≥5 timestamp markers → keep as-is (it's a clean transcript)
 *   - Otherwise → clear the body and set wordCount: 0 in frontmatter
 *
 * Run: node scripts/strip-raw-transcripts.mjs [--dry-run]
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const SERMONS_DIR = join(fileURLToPath(import.meta.url), '../../src/content/sermons');
const TIMESTAMP_RE = /^\[(?:[0-9]{1,2}:)?[0-9]{2}:[0-9]{2}\]/m;
const MIN_TIMESTAMPS = 5;
const DRY_RUN = process.argv.includes('--dry-run');

function countTimestamps(body) {
  const global = new RegExp(TIMESTAMP_RE.source, 'gm');
  return (body.match(global) ?? []).length;
}

function clearBody(content) {
  // Match: opening ---, frontmatter content, closing ---, then everything after
  const match = content.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/);
  if (!match) return null;

  let [, fm, body] = match;

  if (countTimestamps(body) >= MIN_TIMESTAMPS) return null; // clean transcript — skip

  // Set wordCount: 0 so the component can hide the transcript tab
  fm = fm.replace(/^(wordCount:\s*).*$/m, '$10');

  return fm + '\n';
}

async function main() {
  const files = (await readdir(SERMONS_DIR))
    .filter(f => f.endsWith('.mdx'))
    .sort();

  let kept = 0;
  let cleared = 0;
  let skipped = 0;

  for (const file of files) {
    const path = join(SERMONS_DIR, file);
    const original = await readFile(path, 'utf8');

    const updated = clearBody(original);

    if (updated === null) {
      kept++;
      continue;
    }

    if (updated === original) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`[dry-run] would clear: ${file}`);
    } else {
      await writeFile(path, updated, 'utf8');
    }
    cleared++;
  }

  console.log(`\nTimestamped transcripts kept : ${kept}`);
  console.log(`Raw transcripts cleared      : ${cleared}`);
  if (skipped) console.log(`Already empty (skipped)      : ${skipped}`);
  if (DRY_RUN) console.log('\n(dry run — no files were modified)');
}

main().catch(err => { console.error(err); process.exit(1); });
