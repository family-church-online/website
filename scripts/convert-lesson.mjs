#!/usr/bin/env node
/**
 * Convert a structured MCQ markdown lesson file into the MDX frontmatter
 * format used by src/content/courses/[course]/[chapter]/[lesson].mdx.
 *
 * Source format (from Google Docs exports):
 *   # Statement N on <topic>
 *   We believe ...
 *   ## Point N
 *   *That when ...*
 *   ## Scriptural Basis
 *   ### A — heading
 *   **Ref**
 *   > *quote*
 *   commentary paragraph
 *   <div class="question-block">
 *   **Q1 — Type**
 *   question text?
 *   - a) ...
 *   </div>
 *   ## Key Takeaways
 *   - ...
 *   ## Answer Key
 *   |#|...|Q1|Q2|
 *   |A|...|a|a|
 *
 * Course and chapter definitions live in src/content/courses/<course-slug>.json
 * and are managed via TinaCMS. Define the course there first, then reference
 * it here by slug.
 *
 * Usage:
 *   node scripts/convert-lesson.mjs <input.md> \
 *     --course truth-and-grace \
 *     --chapter the-son-of-god \
 *     --lesson "Perfect Man, Perfect Time" \
 *     [--point 1] [--statement-number 4] [--dry-run]
 *
 * Output: src/content/courses/<course-slug>/<chapter-slug>/<lesson-slug>.mdx
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));

function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const courseSlug   = arg('course');
const chapterSlug  = arg('chapter');
const lessonName   = arg('lesson');
const pointNumArg  = arg('point');
const stmtNumArg   = arg('statement-number');
const dryRun       = args.includes('--dry-run');

if (!inputFile || !courseSlug || !chapterSlug || !lessonName) {
  console.error([
    'Usage:',
    '  node scripts/convert-lesson.mjs <input.md> \\',
    '    --course truth-and-grace \\',
    '    --chapter the-son-of-god \\',
    '    --lesson "Perfect Man, Perfect Time" \\',
    '    [--point 1] [--statement-number 4] [--dry-run]',
    '',
    'Courses and chapters are defined in TinaCMS.',
    'Run: pnpm lesson:list-courses  to see available slugs.',
  ].join('\n'));
  process.exit(1);
}

// ── Course registry lookup ───────────────────────────────────────────────────

const registryPath = join(ROOT, 'src', 'content', 'courses', `${courseSlug}.json`);

if (!existsSync(registryPath)) {
  console.error([
    `Error: No course registry found for "${courseSlug}".`,
    `Expected: src/content/courses/${courseSlug}.json`,
    '',
    'Create the course in TinaCMS first (admin → Courses → New Course),',
    'or run: pnpm lesson:list-courses  to see available courses.',
  ].join('\n'));
  process.exit(1);
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const courseName = registry.title;

const chapterDef = (registry.chapters ?? []).find(c => c.slug === chapterSlug);
if (!chapterDef) {
  const available = (registry.chapters ?? []).map(c => `  ${c.slug}  →  ${c.title}`).join('\n');
  console.error([
    `Error: Chapter "${chapterSlug}" not found in course "${courseName}".`,
    '',
    available
      ? `Available chapters:\n${available}`
      : 'No chapters defined yet — add them in TinaCMS (admin → Courses).',
  ].join('\n'));
  process.exit(1);
}

const chapterName = chapterDef.title;

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/['']/g, '')        // remove smart apostrophes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Produce a valid YAML double-quoted scalar (JSON strings are valid YAML dq scalars)
function ys(str) {
  return JSON.stringify(String(str ?? ''));
}

// Produce a YAML block scalar (>-) for long prose strings.
// indent = number of spaces the PARENT KEY is indented at.
// Content will be indented at indent + 2.
function bs(str, indent = 0) {
  const normalized = str.replace(/\s+/g, ' ').trim();
  const contentIndent = ' '.repeat(indent + 2);
  const maxWidth = 78 - contentIndent.length;

  const words = normalized.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return `>-\n${lines.map(l => contentIndent + l).join('\n')}`;
}

// ── Parse source ─────────────────────────────────────────────────────────────

const src = readFileSync(inputFile, 'utf8');

// Statement number from heading or arg
const stmtHeadingMatch = src.match(/^# Statement (\d+)/m);
const statementNumber  = stmtNumArg
  ? parseInt(stmtNumArg, 10)
  : stmtHeadingMatch ? parseInt(stmtHeadingMatch[1], 10) : null;

// Point number from heading or arg
const pointHeadingMatch = src.match(/^## Point (\d+)/m);
const pointNumber = pointNumArg
  ? parseInt(pointNumArg, 10)
  : pointHeadingMatch ? parseInt(pointHeadingMatch[1], 10) : null;

// "We believe ..." paragraph
const statementMatch = src.match(/^(We believe[\s\S]*?)(?=\n\n---|\n---)/m);
const statement = statementMatch
  ? statementMatch[1].replace(/\s+/g, ' ').trim()
  : '';

// Italic sentence after ## Point N
const pointMatch = src.match(/## Point \d+\n\n\*([\s\S]*?)\*/);
const point = pointMatch
  ? pointMatch[1].replace(/\s+/g, ' ').trim()
  : '';

// Key takeaways
const takeawaysMatch = src.match(/## Key Takeaways\n\n([\s\S]*?)(?=\n---|\n## |$)/);
const takeaways = takeawaysMatch
  ? takeawaysMatch[1]
      .split('\n')
      .filter(l => l.startsWith('- '))
      .map(l => l.slice(2).trim())
  : [];

// Answer key table: |A|description|a|a|
const answerMap = {};
for (const m of src.matchAll(/\|\s*([A-D])\s*\|[^|]+\|\s*([a-d])\s*\|\s*([a-d])\s*\|/g)) {
  answerMap[m[1]] = { q1: m[2], q2: m[3] };
}

// ── Parse sections ───────────────────────────────────────────────────────────
// Each section starts with "### X — heading" and runs until the next ### or a ## heading or end.
// We split the Scriptural Basis block by the section pattern.

const scriptBasisMatch = src.match(/## Scriptural Basis\n\n([\s\S]*?)(?=\n## Key Takeaways|\n## Answer Key|$)/);
if (!scriptBasisMatch) {
  console.error('Could not find "## Scriptural Basis" section.');
  process.exit(1);
}

const basisBody = scriptBasisMatch[1];

// Split into per-section chunks on "### X — "
const sectionChunks = basisBody.split(/(?=### [A-D] —)/);

const sections = [];

for (const chunk of sectionChunks) {
  if (!chunk.trim()) continue;

  const headingMatch = chunk.match(/^### ([A-D]) —\s+(.+)/);
  if (!headingMatch) continue;

  const sectionId = headingMatch[1];
  const heading   = headingMatch[2].trim();
  const body      = chunk.slice(headingMatch[0].length).trim();

  // Scripture references: **Ref\n\n> *text*
  const scriptures = [];
  const scriptureRegex = /\*\*([^\n*]+)\*\*\n\n> \*([^*]+)\*/g;
  for (const sm of body.matchAll(scriptureRegex)) {
    scriptures.push({
      ref:  sm[1].trim(),
      text: sm[2].replace(/\s+/g, ' ').trim(),
    });
  }

  // Commentary: the plain paragraph(s) after all blockquotes and before the
  // first question-block div.
  const beforeFirstQ = body.split('<div class="question-block">')[0] ?? body;
  // Remove blockquote lines and scripture ref lines, collect remaining paragraphs
  const commentaryParas = beforeFirstQ
    .split('\n\n')
    .filter(p => {
      const t = p.trim();
      return t
        && !t.startsWith('>')          // not a blockquote
        && !t.startsWith('**')         // not a scripture ref
        && !t.startsWith('###')        // not a heading
        && !t.startsWith('#')
        && !t.startsWith('---');
    });
  const commentary = commentaryParas
    .map(p => p.replace(/\s+/g, ' ').trim())
    .join(' ')
    .trim();

  // Question blocks
  const questions = [];
  const qBlockRegex = /<div class="question-block">([\s\S]*?)<\/div>/g;
  let qIndex = 0;

  for (const qm of body.matchAll(qBlockRegex)) {
    const qBody = qm[1].trim();

    // Type line: **Q1 — Comprehension**
    const typeMatch = qBody.match(/\*\*Q\d+ —\s+([^*]+)\*\*/);
    const qType = typeMatch ? typeMatch[1].trim() : '';

    // Question text: paragraph immediately after the type line
    const segments = qBody.split('\n\n');
    const typeIdx  = segments.findIndex(s => s.startsWith('**Q'));
    const qText    = (segments[typeIdx + 1] ?? '').replace(/\s+/g, ' ').trim();

    // Options: "- a) ..."
    const options = [];
    for (const om of qBody.matchAll(/^- ([a-d])\) (.+)$/gm)) {
      options.push({ label: om[1], text: om[2].trim() });
    }

    // Answer from key
    const answers = answerMap[sectionId];
    const answer  = qIndex === 0 ? (answers?.q1 ?? '') : (answers?.q2 ?? '');

    questions.push({ type: qType, question: qText, options, answer });
    qIndex++;
  }

  sections.push({ id: sectionId, heading, scriptures, commentary, questions });
}

// ── Validate ─────────────────────────────────────────────────────────────────

const warnings = [];

if (!statement)  warnings.push('⚠ Could not find "We believe ..." statement.');
if (!point)      warnings.push('⚠ Could not find Point italic text.');
if (sections.length === 0) warnings.push('⚠ No sections (A-D) found.');
if (takeaways.length === 0) warnings.push('⚠ No key takeaways found.');
if (Object.keys(answerMap).length === 0) warnings.push('⚠ No answer key table found.');

for (const s of sections) {
  if (s.scriptures.length === 0) warnings.push(`⚠ Section ${s.id}: no scriptures found.`);
  if (!s.commentary) warnings.push(`⚠ Section ${s.id}: no commentary found.`);
  for (const q of s.questions) {
    if (!q.answer) warnings.push(`⚠ Section ${s.id} Q${s.questions.indexOf(q)+1}: no answer in key.`);
    if (q.options.length !== 4) warnings.push(`⚠ Section ${s.id} Q${s.questions.indexOf(q)+1}: expected 4 options, got ${q.options.length}.`);
  }
}

for (const w of warnings) console.warn(w);

// ── Build MDX ────────────────────────────────────────────────────────────────

const lines = ['---'];

lines.push(`course: ${ys(courseName)}`);
lines.push(`chapter: ${ys(chapterName)}`);
lines.push(`lesson: ${ys(lessonName)}`);
if (statementNumber) lines.push(`statementNumber: ${statementNumber}`);
if (pointNumber)     lines.push(`pointNumber: ${pointNumber}`);
if (point)     lines.push(`point: ${bs(point, 0)}`);
if (statement) lines.push(`statement: ${bs(statement, 0)}`);

lines.push('sections:');
for (const section of sections) {
  lines.push(`  - id: ${section.id}`);
  lines.push(`    heading: ${ys(section.heading)}`);
  lines.push('    scriptures:');
  for (const s of section.scriptures) {
    lines.push(`      - ref: ${ys(s.ref)}`);
    lines.push(`        text: ${bs(s.text, 8)}`);
  }
  lines.push(`    commentary: ${bs(section.commentary, 4)}`);
  lines.push('    questions:');
  for (const q of section.questions) {
    lines.push(`      - type: ${ys(q.type)}`);
    lines.push(`        question: ${bs(q.question, 8)}`);
    lines.push('        options:');
    for (const opt of q.options) {
      lines.push(`          - label: ${opt.label}`);
      lines.push(`            text: ${bs(opt.text, 12)}`);
    }
    lines.push(`        answer: ${q.answer}`);
  }
}

lines.push('takeaways:');
for (const t of takeaways) {
  lines.push(`  - ${bs(t, 2)}`);
}

lines.push('---');

const mdx = lines.join('\n') + '\n';

// ── Write output ─────────────────────────────────────────────────────────────

const lessonSlug  = slugify(lessonName);

const outDir  = join(ROOT, 'src', 'content', 'courses', courseSlug, chapterSlug);
const outFile = join(outDir, `${lessonSlug}.mdx`);

if (dryRun) {
  console.log('\n── DRY RUN OUTPUT (' + outFile + ') ──\n');
  console.log(mdx);
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, mdx, 'utf8');
  console.log(`✓ Written: ${outFile}`);
  console.log(`  Sections: ${sections.length}  Questions: ${sections.reduce((n, s) => n + s.questions.length, 0)}  Takeaways: ${takeaways.length}`);
}
