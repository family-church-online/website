#!/usr/bin/env node
/**
 * Interactive lesson importer.
 *
 * Scans a directory for .md files, asks you to pick a course and chapter
 * (from those defined in TinaCMS), then prompts for each lesson name.
 * Course and chapter are retained across all files in the batch.
 *
 * Usage:  pnpm lesson:import [source-directory]
 *         pnpm lesson:import --force   (re-import already-imported lessons)
 */

import { createInterface }             from 'node:readline/promises';
import { readdirSync, readFileSync,
         existsSync, execFileSync }    from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir }                     from 'node:os';
import { fileURLToPath }               from 'node:url';

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONVERTER = join(ROOT, 'scripts', 'convert-lesson.mjs');

const args    = process.argv.slice(2);
const force   = args.includes('--force');
const dirArg  = args.find(a => !a.startsWith('--'));

// ── Readline helpers ──────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question, fallback = '') {
  const hint = fallback ? ` [${fallback}]` : '';
  const raw  = (await rl.question(`${question}${hint}: `)).trim();
  return raw || fallback;
}

async function pick(label, items, display) {
  console.log(`\n${label}:`);
  items.forEach((item, i) => console.log(`  ${i + 1}.  ${display(item)}`));
  while (true) {
    const raw = (await rl.question(`Choice [1]: `)).trim();
    const idx = (raw === '' ? 1 : parseInt(raw, 10)) - 1;
    if (idx >= 0 && idx < items.length) return items[idx];
    console.log(`  Enter a number between 1 and ${items.length}.`);
  }
}

// ── Load course registry ──────────────────────────────────────────────────────

function loadCourses() {
  const dir   = join(ROOT, 'src', 'content', 'courses');
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const slug = f.replace('.json', '');
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return { slug, title: data.title ?? slug, chapters: data.chapters ?? [] };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Try to extract a point number from the filename, e.g. "Point_2" → 2
function guessPoint(filename) {
  const m = filename.match(/point[_\s-]?(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Try to extract a statement number from the filename, e.g. "Statement_4" → 4
function guessStatement(filename) {
  const m = filename.match(/statement[_\s-]?(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Read the italic point text from the source file to suggest a lesson name
function readPointText(filePath) {
  try {
    const src   = readFileSync(filePath, 'utf8');
    const match = src.match(/## Point \d+\n\n\*([\s\S]*?)\*/);
    return match ? match[1].replace(/\s+/g, ' ').trim() : null;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const courses = loadCourses();
if (courses.length === 0) {
  console.error('No courses defined yet. Create one in TinaCMS (admin → Courses).');
  process.exit(1);
}

// Source directory
const rawDir    = dirArg ?? (await ask('Source directory', '~/Downloads'));
const sourceDir = resolve(rawDir.replace(/^~/, homedir()));

if (!existsSync(sourceDir)) {
  console.error(`Directory not found: ${sourceDir}`);
  rl.close();
  process.exit(1);
}

// Scan for .md files
const mdFiles = readdirSync(sourceDir)
  .filter(f => f.endsWith('.md'))
  .sort();

if (mdFiles.length === 0) {
  console.log(`No .md files found in ${sourceDir}`);
  rl.close();
  process.exit(0);
}

console.log(`\nFound ${mdFiles.length} .md file${mdFiles.length === 1 ? '' : 's'} in ${sourceDir}`);

// Pick course
const course = await pick('Course', courses, c => `${c.title}  (${c.slug})`);

// Pick chapter
if (course.chapters.length === 0) {
  console.error(`No chapters in "${course.title}". Add them in TinaCMS first.`);
  rl.close();
  process.exit(1);
}

const chapter = await pick('Chapter', course.chapters, c => `${c.title}  (${c.slug})`);

// Name each file
console.log('\nEnter a lesson name for each file, or press Enter to skip.\n');

const plan = [];

for (const file of mdFiles) {
  const filePath       = join(sourceDir, file);
  const pointNum       = guessPoint(file);
  const statementNum   = guessStatement(file);
  const pointText      = readPointText(filePath);

  // Show context so the user knows what they're naming
  const pointLabel = pointNum ? `Point ${pointNum}` : null;
  const hint       = [pointLabel, pointText ? `"${pointText.slice(0, 60)}…"` : null]
    .filter(Boolean).join(' — ');

  console.log(`  ${file}`);
  if (hint) console.log(`  ${hint}`);

  const lessonName = (await rl.question('  Lesson name (Enter to skip): ')).trim();

  if (lessonName) {
    plan.push({ file, filePath, lessonName, pointNum, statementNum });
  } else {
    console.log('  skipped\n');
  }
}

if (plan.length === 0) {
  console.log('\nNothing to import.');
  rl.close();
  process.exit(0);
}

// Confirm
console.log(`\nReady to import ${plan.length} lesson${plan.length === 1 ? '' : 's'} into:`);
console.log(`  Course:  ${course.title}`);
console.log(`  Chapter: ${chapter.title}`);
plan.forEach(p => {
  const badge = p.pointNum ? ` (Point ${p.pointNum})` : '';
  console.log(`  · ${p.lessonName}${badge}`);
});

const confirm = (await rl.question('\nProceed? [Y/n]: ')).trim().toLowerCase();
rl.close();

if (confirm === 'n') {
  console.log('Aborted.');
  process.exit(0);
}

// Run imports
console.log('');
let imported = 0, skipped = 0, failed = 0;

for (const entry of plan) {
  const lessonSlug = slugify(entry.lessonName);
  const outFile    = join(ROOT, 'src', 'content', 'courses',
                          course.slug, chapter.slug, `${lessonSlug}.mdx`);
  const label      = `${course.slug}/${chapter.slug}/${lessonSlug}`;

  if (!force && existsSync(outFile)) {
    console.log(`⟳  skipped   ${label}`);
    skipped++;
    continue;
  }

  const converterArgs = [
    CONVERTER,
    entry.filePath,
    '--course',  course.slug,
    '--chapter', chapter.slug,
    '--lesson',  entry.lessonName,
    ...(entry.pointNum     ? ['--point',            String(entry.pointNum)]     : []),
    ...(entry.statementNum ? ['--statement-number', String(entry.statementNum)] : []),
  ];

  try {
    execFileSync(process.execPath, converterArgs, { stdio: 'inherit' });
    console.log(`✓  imported  ${label}`);
    imported++;
  } catch {
    console.error(`✗  failed    ${label}`);
    failed++;
  }
}

console.log(`\n${imported} imported  ${skipped} skipped  ${failed} failed`);
if (failed > 0) process.exit(1);
