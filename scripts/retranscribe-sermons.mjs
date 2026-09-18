#!/usr/bin/env node
/**
 * Batch-retranscribe sermons using Deepgram (nova-2) + Claude (Anthropic API).
 *
 * Reads all sermon MDX files, skips any that already have a properly structured
 * transcript (≥3 `### ` section headings AND ≥5 `[MM:SS]` timestamps), and
 * processes the rest oldest-first.
 *
 * Progress is resume-safe: raw and cleaned transcripts are written to
 * scripts/transcripts/{slug}/ before the MDX is touched, so an interrupted run
 * can pick up where it left off without re-billing Deepgram or Anthropic.
 *
 * Usage:
 *   node scripts/retranscribe-sermons.mjs              transcribe all missing
 *   node scripts/retranscribe-sermons.mjs --test       dry run — list what would run
 *   node scripts/retranscribe-sermons.mjs --limit 5    process at most N sermons
 *   node scripts/retranscribe-sermons.mjs --slug foo   process one specific sermon
 *   node scripts/retranscribe-sermons.mjs --force      redo even if clean file exists
 *
 * Env vars (add to .env at project root):
 *   DEEPGRAM_API_KEY   Deepgram key
 *   FC_ANTHROPIC_KEY   Anthropic key
 *                      Named FC_ANTHROPIC_KEY (not ANTHROPIC_API_KEY) so the
 *                      Claude CLI does not auto-pick it up from the environment.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname       = dirname(fileURLToPath(import.meta.url));
const ROOT            = join(__dirname, '..');
const SERMONS_DIR     = join(ROOT, 'src', 'content', 'sermons');
const TRANSCRIPTS_DIR = join(__dirname, 'transcripts');
const STRUCTURE_PROMPT_PATH = join(ROOT, 'sermon-pipeline', 'prompts', 'structure.txt');

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const eq = t.indexOf('=');
    const k  = t.slice(0, eq).trim();
    if (!(k in process.env)) process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv(join(ROOT, '.env'));

const DEEPGRAM_KEY  = process.env.DEEPGRAM_API_KEY || '';
const ANTHROPIC_KEY = process.env.FC_ANTHROPIC_KEY || '';

// ─── Colour helpers ───────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;
const dash  = `${c.dim}–${c.reset}`;
const warni = `${c.yellow}⚠${c.reset}`;

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  ${msg}`);
}

// ─── MDX helpers ──────────────────────────────────────────────────────────────

function parseMdx(content) {
  // MDX starts with ---, frontmatter, then a second ---.
  // Split on bare --- lines; parts[0]='' parts[1]=frontmatter parts[2]=body
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) return { fm: {}, fmRaw: '', body: content };

  const fmRaw = parts[1]; // includes the surrounding newlines
  const body  = parts.slice(2).join('\n---\n');

  // Lightweight single-value extractor — only reads the keys we need.
  // Multi-line values (lists, objects) are left untouched; we only access
  // scalar fields from the top level.
  const fm = {};
  for (const line of fmRaw.split('\n')) {
    const eq = line.indexOf(':');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    // Skip YAML list items and nested keys
    if (!key || key.startsWith(' ') || key.startsWith('-')) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    fm[key] = val;
  }

  return { fm, fmRaw, body };
}

function hasGoodTranscript(body) {
  const headings   = (body.match(/### /g) || []).length;
  const timestamps = (body.match(/\[\d{1,2}:\d{2}\]/g) || []).length;
  return headings >= 3 && timestamps >= 5;
}

// Replace a single scalar frontmatter value in the raw frontmatter block.
function setFmField(fmRaw, key, value) {
  const re = new RegExp(`^(${key}:[ \\t]*).*$`, 'm');
  return fmRaw.replace(re, `$1${value}`);
}

// Reconstruct the MDX string from (possibly modified) frontmatter and new body.
// fmRaw already includes its own surrounding newlines — just wrap in ---.
function rebuildMdx(fmRaw, body) {
  return `---${fmRaw}---\n\n${body.trimEnd()}\n`;
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// ─── Sermon loading ───────────────────────────────────────────────────────────

function loadSermons() {
  return readdirSync(SERMONS_DIR)
    .filter(f => f.endsWith('.mdx'))
    .map(f => {
      const slug    = f.replace(/\.mdx$/, '');
      const content = readFileSync(join(SERMONS_DIR, f), 'utf8');
      const { fm, fmRaw, body } = parseMdx(content);
      // Normalise date: strip quotes/time component so we can sort
      const dateRaw = (fm.date || '0000-00-00').replace(/['"]/g, '').slice(0, 10);
      const audioUrl = (fm.audioUrl || '').replace(/['"]/g, '').trim();
      return {
        slug,
        content,
        fmRaw,
        body,
        date:     dateRaw,
        title:    (fm.title || slug).replace(/['"]/g, ''),
        audioUrl,
      };
    })
    .filter(s => s.audioUrl.startsWith('http'))
    .sort((a, b) => a.date.localeCompare(b.date)); // oldest first
}

// ─── Deepgram ─────────────────────────────────────────────────────────────────

async function transcribeUrl(audioUrl) {
  log(`  Deepgram ↓ ${audioUrl.split('/').pop()}`);
  const params = new URLSearchParams({
    model:        'nova-2',
    language:     'en',
    punctuate:    'true',
    filler_words: 'true',
    paragraphs:   'true',
  });
  const resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method:  'POST',
    headers: {
      Authorization:  `Token ${DEEPGRAM_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: audioUrl }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Deepgram ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const alt  = data.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) throw new Error('Deepgram: no alternatives in response');

  const durationMins = Math.round((data.metadata?.duration ?? 0) / 60 * 10) / 10;

  // Build [MM:SS] paragraph transcript — same logic as sermon-pipeline
  let raw;
  const paraData = alt.paragraphs;
  if (paraData?.paragraphs?.length) {
    raw = paraData.paragraphs.map(para => {
      const mm   = String(Math.floor(para.start / 60)).padStart(2, '0');
      const ss   = String(Math.floor(para.start % 60)).padStart(2, '0');
      const text = para.sentences.map(s => s.text).join(' ');
      return `[${mm}:${ss}] ${text}`;
    }).join('\n\n');
  } else {
    raw = alt.transcript || '';
  }

  const wc = wordCount(raw);
  log(`  Deepgram: ${wc.toLocaleString()} words, ${durationMins} min`);
  return { raw, durationMins };
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

const STRUCTURE_PROMPT = existsSync(STRUCTURE_PROMPT_PATH)
  ? readFileSync(STRUCTURE_PROMPT_PATH, 'utf8')
  : null;

async function cleanTranscript(rawTranscript) {
  if (!STRUCTURE_PROMPT) {
    throw new Error(`Prompt not found: ${STRUCTURE_PROMPT_PATH}`);
  }
  log(`  Anthropic ↑ cleaning ${wordCount(rawTranscript).toLocaleString()} words...`);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 16000,
      messages:   [{
        role:    'user',
        content: `${STRUCTURE_PROMPT}\n\n---\n\nRAW TRANSCRIPT:\n\n${rawTranscript}`,
      }],
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Anthropic ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data  = await resp.json();
  const clean = data.content?.[0]?.text?.trim() ?? '';
  if (!clean) throw new Error('Anthropic returned empty content');

  log(`  Anthropic: ${wordCount(clean).toLocaleString()} words`);
  return clean;
}

// ─── Process one sermon ───────────────────────────────────────────────────────

async function processSermon(sermon, { force = false } = {}) {
  const { slug, fmRaw, audioUrl } = sermon;
  const dir       = join(TRANSCRIPTS_DIR, slug);
  const rawFile   = join(dir, `${slug}-raw.txt`);
  const cleanFile = join(dir, `${slug}-clean.txt`);

  mkdirSync(dir, { recursive: true });

  let clean;

  if (!force && existsSync(cleanFile)) {
    // Resume: clean transcript already written — skip both API calls
    log(`  ${dash} Using saved clean transcript`);
    clean = readFileSync(cleanFile, 'utf8');
  } else {
    // Step 1: Deepgram
    let raw;
    if (!force && existsSync(rawFile)) {
      log(`  ${dash} Using saved raw transcript (skipping Deepgram)`);
      raw = readFileSync(rawFile, 'utf8');
    } else {
      const result = await transcribeUrl(audioUrl);
      raw = result.raw;
      writeFileSync(rawFile, raw, 'utf8');
    }

    // Step 2: Claude
    clean = await cleanTranscript(raw);
    writeFileSync(cleanFile, clean, 'utf8');
  }

  // Sanity check before touching the MDX
  const h3s = (clean.match(/### /g) || []).length;
  const tss  = (clean.match(/\[\d{1,2}:\d{2}\]/g) || []).length;
  if (h3s < 2 || tss < 5) {
    log(`${warni} Cleaned transcript looks thin (${h3s} headings, ${tss} timestamps) — MDX not updated`);
    return false;
  }

  // Update MDX: replace body + patch wordCount and transcribedBy in frontmatter
  const wc = wordCount(clean);
  let newFmRaw = setFmField(fmRaw, 'wordCount',     wc);
  newFmRaw     = setFmField(newFmRaw, 'transcribedBy', 'deepgram-nova-2');

  const newContent = rebuildMdx(newFmRaw, clean);
  writeFileSync(join(SERMONS_DIR, `${slug}.mdx`), newContent, 'utf8');

  log(`${tick} MDX updated — ${wc.toLocaleString()} words, ${h3s} sections, ${tss} timestamps`);
  return true;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const test      = args.includes('--test');
const force     = args.includes('--force');
const limitIdx  = args.indexOf('--limit');
const limit     = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const slugIdx   = args.indexOf('--slug');
const onlySlug  = slugIdx !== -1 ? args[slugIdx + 1] : null;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}retranscribe-sermons${c.reset} — batch-transcribe sermon audio (Deepgram nova-2 + Claude)

  ${c.cyan}(no args)${c.reset}          transcribe all sermons missing a structured transcript
  ${c.cyan}--test${c.reset}             dry run — list what would be processed, no API calls
  ${c.cyan}--limit N${c.reset}          process at most N sermons
  ${c.cyan}--slug <slug>${c.reset}      process one specific sermon by its MDX filename slug
  ${c.cyan}--force${c.reset}            redo even if a saved clean transcript already exists
  ${c.cyan}--help${c.reset}             show this message

Required in .env:
  DEEPGRAM_API_KEY      Deepgram key
  FC_ANTHROPIC_KEY      Anthropic key (NOT named ANTHROPIC_API_KEY — that would be
                        auto-picked up by the Claude CLI)

Saved files (resume-safe — re-use on next run to avoid duplicate billing):
  scripts/transcripts/{slug}/{slug}-raw.txt    raw Deepgram paragraphs
  scripts/transcripts/{slug}/{slug}-clean.txt  cleaned + structured transcript
`);
  process.exit(0);
}

// Validate env (skip in test mode — no API calls will be made)
if (!test) {
  const missing = [
    !DEEPGRAM_KEY  && 'DEEPGRAM_API_KEY',
    !ANTHROPIC_KEY && 'FC_ANTHROPIC_KEY',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`\n${cross} Missing env vars: ${missing.join(', ')}`);
    console.error(`Add them to .env (use FC_ANTHROPIC_KEY for Anthropic — see header for why)\n`);
    process.exit(1);
  }
}

// Load and filter sermons
let sermons = loadSermons();

if (onlySlug) {
  sermons = sermons.filter(s => s.slug === onlySlug);
  if (!sermons.length) {
    console.error(`\n${cross} Sermon not found: ${onlySlug}\n`);
    process.exit(1);
  }
} else {
  const total   = sermons.length;
  sermons = sermons.filter(s => force || !hasGoodTranscript(s.body));
  const already = total - sermons.length;
  if (already) log(`${dash} ${already} sermons already have a structured transcript — skipped`);
}

if (!sermons.length) {
  console.log(`\n${tick} All sermons already have structured transcripts. Nothing to do.\n`);
  process.exit(0);
}

if (isFinite(limit)) sermons = sermons.slice(0, limit);

console.log(`\n${c.bold}Sermon Retranscription${c.reset}${test ? `  ${c.yellow}[DRY RUN — no API calls]${c.reset}` : ''}`);
console.log('═'.repeat(60));
console.log(`To process: ${c.bold}${sermons.length}${c.reset} sermon${sermons.length !== 1 ? 's' : ''}  (oldest first)`);
if (!test) {
  console.log(`Transcripts → ${c.dim}scripts/transcripts/{slug}/${c.reset}`);
  console.log(`Deepgram model: nova-2    Claude model: claude-haiku-4-5`);
}
console.log('─'.repeat(60) + '\n');

if (test) {
  for (const s of sermons) {
    const saved = existsSync(join(TRANSCRIPTS_DIR, s.slug, `${s.slug}-clean.txt`));
    console.log(`  ${s.date}  ${s.slug}${saved ? `  ${c.dim}(clean saved)${c.reset}` : ''}`);
  }
  console.log(`\n${sermons.length} sermons would be processed.\n`);
  process.exit(0);
}

let ok = 0, skipped = 0, failed = 0;

for (const sermon of sermons) {
  console.log(`${c.bold}${sermon.date}${c.reset}  ${sermon.slug}`);
  try {
    const updated = await processSermon(sermon, { force });
    if (updated) ok++; else skipped++;
  } catch (err) {
    console.error(`  ${cross} ${err.message}`);
    failed++;
  }
  console.log();
}

console.log('─'.repeat(60));
console.log(
  `Done.  ${tick} ${ok} transcribed` +
  (skipped ? `  ${warni} ${skipped} skipped (thin output)` : '') +
  (failed  ? `  ${cross} ${failed} failed` : '') +
  '\n'
);
