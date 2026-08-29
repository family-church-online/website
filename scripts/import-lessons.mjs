#!/usr/bin/env node
/**
 * Batch-import lessons listed in scripts/lesson-manifest.json.
 *
 * Each entry in the manifest maps a source .md file to its course/chapter/lesson
 * metadata. Already-imported lessons are skipped unless --force is passed.
 *
 * Usage:
 *   pnpm lesson:import               # import all not-yet-imported lessons
 *   pnpm lesson:import --force       # re-import even if the file already exists
 *   pnpm lesson:import --dry-run     # show what would be imported without writing
 *   pnpm lesson:import --source-dir /path/to/md/files
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST  = join(ROOT, 'scripts', 'lesson-manifest.json');
const CONVERTER = join(ROOT, 'scripts', 'convert-lesson.mjs');

// ── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const force   = args.includes('--force');
const dryRun  = args.includes('--dry-run');
const srcDirArg = (() => {
  const i = args.indexOf('--source-dir');
  return i >= 0 ? args[i + 1] : null;
})();

// ── Load manifest ─────────────────────────────────────────────────────────────

if (!existsSync(MANIFEST)) {
  console.error(`Manifest not found: ${MANIFEST}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const sourceDir = resolve(
  (srcDirArg ?? manifest.sourceDir ?? '.').replace(/^~/, homedir())
);
const lessons = manifest.lessons ?? [];

if (lessons.length === 0) {
  console.log('No lessons in manifest.');
  process.exit(0);
}

// ── Process each lesson ───────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

let imported = 0, skipped = 0, failed = 0;

for (const entry of lessons) {
  const sourceFile = resolve(join(sourceDir, entry.file));
  const lessonSlug = slugify(entry.lesson);
  const outFile    = join(
    ROOT, 'src', 'content', 'courses',
    entry.course, entry.chapter, `${lessonSlug}.mdx`
  );

  const label = `${entry.course}/${entry.chapter}/${lessonSlug}`;

  // Skip check
  if (!force && existsSync(outFile)) {
    console.log(`⟳  skipped   ${label}`);
    skipped++;
    continue;
  }

  // Source file check
  if (!existsSync(sourceFile)) {
    console.error(`✗  missing   ${label}  (${sourceFile})`);
    failed++;
    continue;
  }

  // Build args for the converter
  const converterArgs = [
    CONVERTER,
    sourceFile,
    '--course', entry.course,
    '--chapter', entry.chapter,
    '--lesson', entry.lesson,
    ...(entry.point            ? ['--point',            String(entry.point)]            : []),
    ...(entry.statementNumber  ? ['--statement-number', String(entry.statementNumber)]  : []),
    ...(dryRun                 ? ['--dry-run']                                          : []),
  ];

  if (dryRun) {
    console.log(`   dry-run   ${label}`);
    const result = spawnSync(process.execPath, converterArgs, { stdio: 'inherit' });
    if (result.status !== 0) failed++;
    else imported++;
    continue;
  }

  try {
    execFileSync(process.execPath, converterArgs, { stdio: 'inherit' });
    console.log(`✓  imported  ${label}`);
    imported++;
  } catch {
    console.error(`✗  failed    ${label}`);
    failed++;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`${imported} imported  ${skipped} skipped  ${failed} failed`);
if (failed > 0) process.exit(1);
