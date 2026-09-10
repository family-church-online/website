#!/usr/bin/env node
/**
 * Convert a generic MCQ markdown lesson file into the MDX frontmatter
 * format used by src/content/courses/[course]/[chapter]/[lesson].mdx.
 *
 * Source format (for non-statement-of-faith courses):
 *   # Lesson Title (or "Course: Lesson Title")
 *   *Optional subtitle line*          ← ignored
 *   Opening paragraph                  ← → statement field
 *   ---
 *   ## Point: Summary text             ← text on heading line (optional)
 *   *Italic point summary*             ← → point field
 *   ---
 *   ### A — Section heading
 *   **Scripture Ref**
 *   > "Quote text"
 *   Commentary paragraph(s)
 *   **Q1 — Comprehension**
 *   Question text?
 *   - a) Option A
 *   - b) Option B
 *   - c) Option C
 *   - d) Option D
 *   **Q2 — Faith and Life**
 *   ...
 *   ---
 *   ### B — ...
 *   ## Key Takeaways
 *   - ...
 *   ## Answer Key
 *   |#|Section|Q1|Q2|
 *   |A|...|a|b|
 *
 * Usage:
 *   node scripts/convert-generic-lesson.mjs <input.md> \
 *     --course prayer \
 *     --chapter humility-in-prayer \
 *     --lesson "Asking in Faith, Not Declaring Outcomes" \
 *     [--point 1] [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));

function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const courseSlug  = arg('course');
const chapterSlug = arg('chapter');
const lessonName  = arg('lesson');
const pointNumArg = arg('point');
const dryRun      = args.includes('--dry-run');

if (!inputFile || !courseSlug || !chapterSlug || !lessonName) {
  console.error([
    'Usage:',
    '  node scripts/convert-generic-lesson.mjs <input.md> \\',
    '    --course prayer \\',
    '    --chapter humility-in-prayer \\',
    '    --lesson "Asking in Faith, Not Declaring Outcomes" \\',
    '    [--point 1] [--dry-run]',
  ].join('\n'));
  process.exit(1);
}

// ── Course registry lookup ────────────────────────────────────────────────────

const registryPath = join(ROOT, 'src', 'content', 'courses', `${courseSlug}.json`);

if (!existsSync(registryPath)) {
  console.error([
    `Error: No course registry found for "${courseSlug}".`,
    `Expected: src/content/courses/${courseSlug}.json`,
    '',
    'Create the course in TinaCMS first (admin → Courses → New Course).',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ys(str) {
  return JSON.stringify(String(str ?? ''));
}

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

function cleanText(str) {
  return str
    .replace(/\n>\s*/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseScriptures(body) {
  const scriptures = [];
  const re = /\*\*([^\n*]+)\*\*\n\n((?:> [^\n]*\n?)+)/g;
  for (const m of body.matchAll(re)) {
    const ref  = cleanText(m[1]);
    const text = cleanText(
      m[2].split('\n')
        .filter(l => l.startsWith('> '))
        .map(l => l.slice(2))
        .join(' ')
        .replace(/^[""]|[""]$/g, '')   // strip wrapping curly quotes
        .replace(/^"|"$/g, '')          // strip wrapping straight quotes
    );
    if (ref && text) scriptures.push({ ref, text });
  }
  return scriptures;
}

function parseCommentary(body) {
  return body
    .split('\n\n')
    .filter(p => {
      const t = p.trim();
      return t
        && !t.startsWith('>')
        && !t.startsWith('**')
        && !t.startsWith('#')
        && !t.startsWith('---')
        && !t.startsWith('*');
    })
    .map(p => cleanText(p))
    .join(' ')
    .trim();
}

// Handles both `- a) text` and `- a\) text` (T&G pandoc export style)
function parseOptions(body) {
  const options = [];
  let cur = null;
  for (const line of body.split('\n')) {
    const start = line.match(/^-\s+([a-d])\\?\)\s+(.*)/);
    if (start) {
      if (cur) options.push(cur);
      cur = { label: start[1], parts: [start[2]] };
      continue;
    }
    const cont = line.match(/^\s+>\s+(.*)/);
    if (cont && cur) { cur.parts.push(cont[1]); continue; }
  }
  if (cur) options.push(cur);
  return options.map(o => ({ label: o.label, text: cleanText(o.parts.join(' ')) }));
}

function parseTakeaways(body) {
  const items = [];
  let cur = null;
  for (const line of body.split('\n')) {
    const start = line.match(/^-\s+(.*)/);
    if (start) {
      if (cur !== null) items.push(cur);
      cur = start[1];
      continue;
    }
    const cont = line.match(/^\s+>\s+(.*)/);
    if (cont !== null && cur !== null) { cur += ' ' + cont[1]; continue; }
  }
  if (cur !== null) items.push(cur);
  return items.filter(Boolean).map(cleanText);
}

// ── Parse source ──────────────────────────────────────────────────────────────

const src = readFileSync(inputFile, 'utf8');

// Statement: opening paragraph(s) after title (skipping optional italic subtitle)
// before the first --- separator
const statementMatch = src.match(/^# [^\n]+\n\n(?:\*[^\n]+\*\n\n)?([\s\S]+?)(?=\n---)/m);
const statement = statementMatch ? cleanText(statementMatch[1]) : '';

// Point: italic paragraph after ## Point... heading
const pointBodyMatch = src.match(/## Point[^\n]*\n\n\*([\s\S]*?)\*/);
// Fallback: text after "## Point: " on the heading line itself
const pointHeadingMatch = src.match(/## Point:\s*(.+)/);
const point = pointBodyMatch
  ? cleanText(pointBodyMatch[1])
  : (pointHeadingMatch ? cleanText(pointHeadingMatch[1]) : '');

// Point number: from heading ("## Point 1") or --point arg
const pointNumInHeading = src.match(/## Point\s+(\d+)/);
const pointNumber = pointNumArg
  ? parseInt(pointNumArg, 10)
  : (pointNumInHeading ? parseInt(pointNumInHeading[1], 10) : null);

// Answer key (same pipe-table format as T&G)
const answerMap = {};
for (const m of src.matchAll(/\|\s*([A-D])\s*\|[^|]+\|\s*([a-d])\)?\s*\|\s*([a-d])\)?\s*\|/g)) {
  answerMap[m[1]] = { q1: m[2], q2: m[3] };
}

// Takeaways
const takeawaysMatch = src.match(/## Key Takeaways\n\n([\s\S]*?)(?=\n## |\n---|$)/);
const takeaways = parseTakeaways(takeawaysMatch ? takeawaysMatch[1] : '');

// ── Parse sections ────────────────────────────────────────────────────────────
//
// Sections sit between the second --- (after the Point block) and ## Key Takeaways.
// They are separated from each other by --- horizontal rules.

const sectionBodyMatch = src.match(/---\n\n(### [A-D] —[\s\S]*?)(?=\n## Key Takeaways|\n## Answer Key|$)/);
if (!sectionBodyMatch) {
  console.error('Could not find section blocks (### A — ...). Check the source format.');
  process.exit(1);
}

const sectionBody = sectionBodyMatch[1];
const chunks = sectionBody.split(/\n---\n\n/).map(c => c.trim()).filter(Boolean);
const sections = [];

for (const chunk of chunks) {
  const hm = chunk.match(/^### ([A-D]) —\s+(.+)/);
  if (!hm) continue;

  const sectionId = hm[1];
  const heading   = hm[2].trim();
  const body      = chunk.slice(hm[0].length).trim();

  const scriptures = parseScriptures(body);

  // Everything before the first **Q\d+ — is commentary (plus scripture refs)
  const qSplitIdx = body.search(/\*\*Q\d+ —/);
  const preQ      = qSplitIdx >= 0 ? body.slice(0, qSplitIdx) : body;
  const qPart     = qSplitIdx >= 0 ? body.slice(qSplitIdx) : '';

  const commentary = parseCommentary(preQ);

  // Split question blocks on **Q\d+ — boundaries
  const qBlocks  = qPart.split(/(?=\*\*Q\d+ —)/).map(b => b.trim()).filter(Boolean);
  const questions = [];

  for (const qBlock of qBlocks) {
    const typeLine = qBlock.match(/^\*\*Q\d+ —\s+([^*]+)\*\*/);
    if (!typeLine) continue;
    const qType     = typeLine[1].trim();
    const afterType = qBlock.slice(typeLine[0].length).trim();
    const optStart  = afterType.search(/^- [a-d]\\?\)/m);
    const qText     = cleanText(optStart >= 0 ? afterType.slice(0, optStart) : afterType);
    const opts      = optStart >= 0 ? parseOptions(afterType.slice(optStart)) : [];
    const ans       = answerMap[sectionId];
    questions.push({
      type:     qType,
      question: qText,
      options:  opts,
      answer:   questions.length === 0 ? (ans?.q1 ?? '') : (ans?.q2 ?? ''),
    });
  }

  sections.push({ id: sectionId, heading, scriptures, commentary, questions });
}

// ── Validate ──────────────────────────────────────────────────────────────────

const warnings = [];

if (!statement)           warnings.push('⚠ No opening paragraph found (statement field will be empty).');
if (!point)               warnings.push('⚠ No point text found.');
if (sections.length === 0) warnings.push('⚠ No sections (### A-D) found.');
if (takeaways.length === 0) warnings.push('⚠ No key takeaways found.');
if (Object.keys(answerMap).length === 0) warnings.push('⚠ No answer key table found.');

for (const s of sections) {
  if (s.scriptures.length === 0) warnings.push(`⚠ Section ${s.id}: no scriptures found.`);
  if (!s.commentary)             warnings.push(`⚠ Section ${s.id}: no commentary found.`);
  for (const [qi, q] of s.questions.entries()) {
    if (!q.answer)               warnings.push(`⚠ Section ${s.id} Q${qi + 1}: no answer in key.`);
    if (q.options.length !== 4)  warnings.push(`⚠ Section ${s.id} Q${qi + 1}: expected 4 options, got ${q.options.length}.`);
  }
}

for (const w of warnings) console.warn(w);

// ── Build MDX ─────────────────────────────────────────────────────────────────

const lines = ['---'];

lines.push(`course: ${ys(courseName)}`);
lines.push(`chapter: ${ys(chapterName)}`);
lines.push(`lesson: ${ys(lessonName)}`);
if (pointNumber) lines.push(`pointNumber: ${pointNumber}`);
if (point)       lines.push(`point: ${bs(point, 0)}`);
if (statement)   lines.push(`statement: ${bs(statement, 0)}`);

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

// ── Write output ──────────────────────────────────────────────────────────────

const lessonSlug = slugify(lessonName);
const outDir     = join(ROOT, 'src', 'content', 'courses', courseSlug, chapterSlug);
const outFile    = join(outDir, `${lessonSlug}.mdx`);

if (dryRun) {
  console.log('\n── DRY RUN OUTPUT (' + outFile + ') ──\n');
  console.log(mdx);
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, mdx, 'utf8');
  console.log(`✓ Written: ${outFile}`);
  console.log(`  Sections: ${sections.length}  Questions: ${sections.reduce((n, s) => n + s.questions.length, 0)}  Takeaways: ${takeaways.length}`);
}
