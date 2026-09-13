#!/usr/bin/env node
/**
 * Family Church Online — Sermon Pipeline
 * Reads sermon identity from TinaCMS sermon-notes (current.mdx), selects and
 * downloads the matching Vimeo video, then runs the full content pipeline.
 *
 * Requirements:
 *   pnpm install  (inside sermon-pipeline/)
 *   ffmpeg, claude CLI (authenticated)
 *
 * Environment variables (in .env at website root, or exported):
 *   VIMEO_TOKEN
 *   DEEPGRAM_API_KEY
 *   DATABASE_URL          Neon connection string (step 8)
 *   VOYAGE_API_KEY        Voyage AI key (step 8)
 *   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   R2_AUDIO_PUBLIC_URL
 *
 * Google credentials (kept outside the repo):
 *   GOOGLE_CREDENTIALS_FILE  path to oauth_credentials.json
 *   GOOGLE_TOKEN_FILE        path to oauth_token.json
 *   Defaults: ~/.config/sermon-pipeline/oauth_credentials.json / oauth_token.json
 */

import { execSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync,
  copyFileSync, unlinkSync, statSync, readdirSync,
} from 'node:fs';
import { join, dirname, extname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';

import matter from 'gray-matter';
import { createClient as createDeepgram } from '@deepgram/sdk';
import { google } from 'googleapis';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pkg from 'pg';
import { parse as parseHtml } from 'node-html-parser';

const { Client: PgClient } = pkg;

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const PIPELINE_DIR  = __dirname;
const WEBSITE_DIR   = dirname(__dirname);
const PROMPTS_DIR   = join(PIPELINE_DIR, 'prompts');
const AUDIO_DIR     = join(PIPELINE_DIR, 'audio');
const OUTPUT_DIR    = join(PIPELINE_DIR, 'output');
const SESSION_FILE  = join(PIPELINE_DIR, 'session', 'pipeline_session.json');
const SERMON_NOTES  = join(WEBSITE_DIR, 'src', 'content', 'sermon-notes', 'current.mdx');

for (const d of [AUDIO_DIR, OUTPUT_DIR, join(PIPELINE_DIR, 'session')]) {
  mkdirSync(d, { recursive: true });
}

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const [key, ...rest] = t.split('=');
    const k = key.trim();
    if (!(k in process.env)) process.env[k] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

loadEnvFile(join(WEBSITE_DIR, '.env'));
loadEnvFile(join(PIPELINE_DIR, '.env'));

const VIMEO_TOKEN       = process.env.VIMEO_TOKEN || '';
const DEEPGRAM_API_KEY  = process.env.DEEPGRAM_API_KEY || '';
const DATABASE_URL      = process.env.DATABASE_URL || '';
const VOYAGE_API_KEY    = process.env.VOYAGE_API_KEY || '';
const R2_ENDPOINT       = process.env.R2_ENDPOINT || '';
const R2_ACCESS_KEY_ID  = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET         = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET         = process.env.R2_BUCKET || 'family-church-sermons';
const R2_PUBLIC_URL     = process.env.R2_AUDIO_PUBLIC_URL || process.env.R2_PUBLIC_URL || 'https://audio.familychurch.online';
const SITE_URL          = 'https://familychurch.online';

const CONFIG_DIR              = join(homedir(), '.config', 'sermon-pipeline');
const GOOGLE_CREDENTIALS_FILE = process.env.GOOGLE_CREDENTIALS_FILE
  || (existsSync(join(PIPELINE_DIR, 'oauth_credentials.json')) ? join(PIPELINE_DIR, 'oauth_credentials.json') : join(CONFIG_DIR, 'oauth_credentials.json'));
const GOOGLE_TOKEN_FILE       = process.env.GOOGLE_TOKEN_FILE
  || (existsSync(join(PIPELINE_DIR, 'oauth_token.json')) ? join(PIPELINE_DIR, 'oauth_token.json') : join(CONFIG_DIR, 'oauth_token.json'));

const DEVOTIONS_CAL_ID     = 'kalsva0235makn1pq3d52sko1k@group.calendar.google.com';
const READING_PLANS_CAL_ID = '9e339a64af832e22e2845990e12e5734996425604454b26ff45a86230c00d463@group.calendar.google.com';
const DRIVE_ENRICHED       = '1w2ADe6xQ-_0Hz2KvAHbmMTSK_7WNkALO';
const DRIVE_COMP_TAX       = '19f02nUtBL9xNQaTsECgKvEWkcyefgixy';
const DRIVE_SERMON_BLOCK   = '1rmr23NQsNHYFstSSW2cyB2U2XMBOt39l';
const R2_MANIFEST_PATH     = join(WEBSITE_DIR, 'scripts', 'r2-audio-manifest.json');
const DEEPGRAM_MODEL        = 'nova-2';
const VOYAGE_MODEL          = 'voyage-context-4';
const MAX_CHUNK_WORDS       = 600;
const GOOGLE_SCOPES         = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive'];

const TRANSCRIPT_SPAN_STYLE = 'font-size:0.75em;opacity:0.55;margin-right:0.4em;font-variant-numeric:tabular-nums';

// ─── Readline helper ──────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// ─── Utilities ────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function wordCount(text) { return text.split(/\s+/).filter(Boolean).length; }

function hEscape(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hJson(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

function yamlStr(value) {
  if (!value) return '""';
  if (value.includes('\n')) {
    const body = value.split('\n').map(l => '  ' + l).join('\n');
    return `|\n${body}`;
  }
  if (/[:{}&*!,[\]|>\'"#@`]/.test(value) || /^[-?]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function yamlListOfDicts(items, indent = 2) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const item of items) {
    let first = true;
    for (const [k, v] of Object.entries(item)) {
      const vy = v != null ? yamlStr(String(v)) : 'null';
      lines.push(first ? `${pad}- ${k}: ${vy}` : `${pad}  ${k}: ${vy}`);
      first = false;
    }
  }
  return lines.join('\n');
}

function listField(items) {
  if (!items?.length) return '[]';
  return '\n' + items.map(i => `  - ${yamlStr(String(i))}`).join('\n');
}

function strOrNull(v) { return v ? yamlStr(v) : 'null'; }

function loadPrompt(filename) {
  const path = join(PROMPTS_DIR, filename);
  if (!existsSync(path)) throw new Error(`Prompt not found: ${path}`);
  return readFileSync(path, 'utf8');
}

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  INFO      ${msg}`);
}
function warn(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  WARNING   ${msg}`);
}

// ─── Session ──────────────────────────────────────────────────────────────────

function saveSession(sermon) {
  writeFileSync(SESSION_FILE, JSON.stringify(sermon, null, 2));
}

function loadSession() {
  if (!existsSync(SESSION_FILE)) {
    console.error('Session file not found. Run setup (option s) first.');
    process.exit(1);
  }
  const sermon = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  log(`Session loaded: ${sermon.date} — ${sermon.title}`);
  const outputDir = join(OUTPUT_DIR, `${sermon.date}-${sermon.slug}`);
  mkdirSync(outputDir, { recursive: true });
  return { sermon, outputDir };
}

function resolveFile(outputDir, filename, errorMsg) {
  const path = join(outputDir, filename);
  if (!existsSync(path)) { console.error(errorMsg); process.exit(1); }
  return readFileSync(path, 'utf8');
}

// ─── Sermon Notes reader ──────────────────────────────────────────────────────

function readSermonNotes() {
  if (!existsSync(SERMON_NOTES)) {
    console.error(`Sermon notes not found: ${SERMON_NOTES}`);
    process.exit(1);
  }
  const raw = readFileSync(SERMON_NOTES, 'utf8');
  const { data } = matter(raw);
  // Extract date as a string from the raw YAML to avoid UTC conversion bugs.
  // js-yaml parses ISO datetimes as Date objects; toISOString() shifts midnight SAST to the previous UTC day.
  const dateMatch = raw.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  const date = dateMatch ? dateMatch[1] : (data.date instanceof Date
    ? `${data.date.getFullYear()}-${String(data.date.getMonth()+1).padStart(2,'0')}-${String(data.date.getDate()).padStart(2,'0')}`
    : String(data.date || '').slice(0, 10));
  return {
    title:   (data.title  || '').trim(),
    speaker: (data.speaker || '').trim(),
    series:  (data.series  || '').trim(),
    image:   (data.image   || '').trim(), // e.g. /images/temp/filename.webp
    date,
  };
}

// ─── claude -p ────────────────────────────────────────────────────────────────

function runClaude(promptText, label, model = 'claude-opus-4-8', effort = null) {
  log(`Running claude -p: ${label}...`);
  const args = [
    '-p', promptText,
    '--model', model,
    '--output-format', 'stream-json',
    '--verbose',
    '--disallowed-tools', 'Bash,Edit,Write,Read,WebFetch,WebSearch,NotebookEdit,Task',
  ];
  if (effort) args.push('--effort', effort);

  const result = spawnSync('claude', args, {
    timeout: 1_800_000,
    maxBuffer: 100 * 1024 * 1024,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`claude -p failed (${label}):\n${result.stderr || ''}`);
  }

  const parts = [];
  for (const line of (result.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'text') parts.push(block.text);
        }
      }
    } catch {}
  }
  const output = parts.join('').trim();
  log(`  ${label} — ${output.length} chars returned`);
  return output;
}

function stripJsonFences(raw) {
  if (!raw.startsWith('```')) return raw;
  let s = raw.split('```')[1];
  if (s.startsWith('json')) s = s.slice(4);
  return s.trim();
}

// ─── Vimeo ────────────────────────────────────────────────────────────────────

async function fetchVimeoVideos() {
  log('Fetching recent Vimeo videos...');
  const resp = await fetch('https://api.vimeo.com/me/videos?' + new URLSearchParams({
    sort: 'date', direction: 'desc', per_page: '10',
    fields: 'uri,name,status,embed,download,created_time',
  }), { headers: { Authorization: `Bearer ${VIMEO_TOKEN}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' } });
  if (!resp.ok) throw new Error(`Vimeo API error: ${resp.status}`);
  return (await resp.json()).data || [];
}

function getSmallestDownload(video) {
  const downloads = video.download || [];
  if (!downloads.length) { console.error('No download links — check Vimeo plan'); process.exit(1); }
  return downloads.reduce((a, b) => (a.size || Infinity) < (b.size || Infinity) ? a : b);
}

function getVimeoEmbedUrl(video) {
  return `https://player.vimeo.com/video/${video.uri.split('/').pop()}`;
}

// ─── Download + convert ───────────────────────────────────────────────────────

async function downloadVideo(url, destPath) {
  log(`Downloading video to ${basename(destPath)}...`);
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const total = Number(resp.headers.get('content-length') || 0);
  let downloaded = 0;
  const chunks = [];
  for await (const chunk of resp.body) {
    chunks.push(chunk);
    downloaded += chunk.length;
    if (total) process.stdout.write(`  ${(downloaded / total * 100).toFixed(1)}%\r`);
  }
  writeFileSync(destPath, Buffer.concat(chunks));
  console.log(`  Download complete (${(downloaded / 1048576).toFixed(1)} MB)`);
}

function convertToMp3(videoPath, mp3Path) {
  log('Converting to MP3...');
  const result = spawnSync('ffmpeg', ['-y', '-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-b:a', '64k', mp3Path], {
    encoding: 'utf8',
  });
  if (result.status !== 0) { console.error(`ffmpeg failed:\n${result.stderr}`); process.exit(1); }
  const mb = (statSync(mp3Path).size / 1048576).toFixed(1);
  log(`  MP3 saved: ${basename(mp3Path)} (${mb} MB)`);
}

// ─── Image ────────────────────────────────────────────────────────────────────

function moveSermonImage(imageField, date, slug) {
  // imageField is like /images/temp/filename.webp
  if (!imageField) return '';
  const srcPath = join(WEBSITE_DIR, 'public', imageField.replace(/^\//, ''));
  if (!existsSync(srcPath)) {
    warn(`Image not found at ${srcPath} — skipping move`);
    return imageField;
  }
  const ext      = extname(srcPath);
  const destName = `${date}-${slug}${ext}`;
  const destPath = join(WEBSITE_DIR, 'public', 'images', 'sermons', destName);
  copyFileSync(srcPath, destPath);
  // Only remove from temp after confirming copy succeeded
  unlinkSync(srcPath);
  log(`  Image moved: /images/temp/${basename(srcPath)} → /images/sermons/${destName}`);
  return `/images/sermons/${destName}`;
}

// ─── Transcription ────────────────────────────────────────────────────────────

async function transcribeAudio(audioPath) {
  if (!DEEPGRAM_API_KEY) { console.error('DEEPGRAM_API_KEY not set'); process.exit(1); }
  log('Transcribing via Deepgram Nova-2...');
  const deepgram = createDeepgram(DEEPGRAM_API_KEY);
  const audio    = readFileSync(audioPath);

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(audio, {
    model: DEEPGRAM_MODEL, language: 'en', punctuate: true, filler_words: true, paragraphs: true,
  });
  if (error) throw error;

  const alt          = result.results.channels[0].alternatives[0];
  const durationMins = Math.round(result.metadata.duration / 60 * 10) / 10;
  const paraData     = alt.paragraphs;

  let transcript;
  if (paraData?.paragraphs?.length) {
    transcript = paraData.paragraphs.map(para => {
      const mm   = String(Math.floor(para.start / 60)).padStart(2, '0');
      const ss   = String(Math.floor(para.start % 60)).padStart(2, '0');
      const text = para.sentences.map(s => s.text).join(' ');
      return `[${mm}:${ss}] ${text}`;
    }).join('\n\n');
  } else {
    transcript = alt.transcript || '';
  }

  log(`  ${wordCount(transcript).toLocaleString()} words — ${durationMins} min`);
  return { transcript, durationMins };
}

function generateStructuredTranscript(rawTranscript) {
  const prompt = loadPrompt('structure.txt');
  return runClaude(`${prompt}\n\n---\n\nRAW TRANSCRIPT:\n\n${rawTranscript}`, 'structure', 'claude-haiku-4-5');
}

function buildTranscriptMarkdown(sermon, transcript, duration, taxFilename) {
  const dur    = duration ?? sermon.duration_minutes ?? '';
  const vimeo  = sermon.vimeo_url || '';
  const series = sermon.series    || '';
  const lines  = ['---', `title: "${(sermon.title || '').replace(/"/g, "'")}"`, `date: ${sermon.date}`, `speaker: "${sermon.speaker || ''}"`];
  if (series) lines.push(`series: "${series}"`);
  lines.push(`duration_minutes: ${dur}`, `post_url: "${sermon.post_url || ''}"`, `image_url: "${sermon.image_url || ''}"`, `taxonomy: ${taxFilename}`);
  if (vimeo) lines.push(`vimeo_url: "${vimeo}"`);
  lines.push(`word_count: ${wordCount(transcript)}`, `transcribed_by: "deepgram-${DEEPGRAM_MODEL}"`, '---', '', `# ${sermon.title || ''}`, '', '## Transcript', '', transcript.trim(), '');
  return lines.join('\n');
}

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

function generateTaxonomy(sermon, structuredTranscript) {
  const prompt  = loadPrompt('taxonomy.txt');
  const context = [
    'CONFIRMED IDENTITY (use verbatim — do not derive from transcript):',
    `TITLE: ${sermon.title}`,
    `SPEAKER: ${sermon.speaker || '(unknown)'}`,
    `SERIES: ${sermon.series || '(none)'}`,
    `DATE: ${sermon.date}`,
    `POST URL: ${sermon.post_url}`,
    '',
    `TRANSCRIPT:\n\n${structuredTranscript}`,
  ].join('\n');
  const raw = runClaude(`${prompt}\n\n---\n\n${context}`, 'taxonomy');
  return JSON.parse(stripJsonFences(raw));
}

async function promptMissingTaxonomyFields(taxonomy) {
  if (taxonomy.review && taxonomy.review_notes) {
    console.log(`\n  Needs review: ${taxonomy.review_notes}`);
  }
  // Only scripture needs interactive review now — identity fields come from sermon-notes
  if (!taxonomy.sermon_scripture) {
    const val = (await ask('\n  Sermon scripture (couldn\'t be derived): ')).trim();
    if (val) taxonomy.sermon_scripture = val;
  }
  if (taxonomy.sermon_scripture) {
    taxonomy.review = false;
    delete taxonomy.review_notes;
  }
  return taxonomy;
}

// ─── SEO slug ─────────────────────────────────────────────────────────────────

function generateSeoTitleSlug(sermon, htmlText) {
  const sfcData = extractSfcData(htmlText);
  const bigIdea = sfcData.bigIdea || '';
  if (!bigIdea) { warn("No bigIdea in sermon block — skipping SEO slug"); return null; }

  const scripture = sermon.sermon_scripture || '';
  const prompt = [
    'You are an SEO expert for a church website.',
    'Given a sermon\'s big idea, main scripture, and original title, produce:',
    '1. An SEO-optimised title — compelling, searchable, under 65 characters; include the FULL scripture reference (book, chapter AND verses, e.g. "Revelation 4:1-4") — never abbreviate to chapter alone',
    '2. A URL slug — lowercase, hyphens only; include every word from the title (do NOT drop prepositions, articles, or any other word); include an abbreviated scripture reference (e.g. john-3-16); under 70 characters total',
    '',
    `Original title: ${sermon.title}`,
    scripture ? `Main scripture: ${scripture}` : '',
    `Big idea: ${bigIdea}`,
    '',
    'Return JSON only — no markdown fences: {"title": "...", "slug": "..."}',
  ].filter(Boolean).join('\n');

  const raw  = runClaude(prompt, 'seo-title-slug', 'claude-haiku-4-5');
  let data;
  try {
    data = JSON.parse(stripJsonFences(raw));
  } catch {
    warn(`SEO slug: model returned non-JSON — ${raw.slice(0, 80)}`);
    return null;
  }
  return { title: (data.title || sermon.title).trim(), slug: slugify(data.slug || '') };
}

// ─── Sermon block HTML ────────────────────────────────────────────────────────

function extractTranscriptBody(mdText) {
  const parts = mdText.split('## Transcript');
  return parts.length > 1 ? parts[1].trim() : mdText.trim();
}

function renderTranscriptPanel(transcriptMd) {
  const body  = extractTranscriptBody(transcriptMd);
  const parts = body.split(/\n(?=### )/);
  const sections = [];
  parts.forEach((part, i) => {
    const lines   = part.trim().split('\n');
    const heading = lines[0].startsWith('### ') ? lines[0].replace(/^###\s*/, '') : '';
    const paras   = lines.slice(lines[0].startsWith('### ') ? 1 : 0).join('\n').trim();
    const chunks  = paras.split(/(?=\[\d{2}:\d{2}\])/);
    const pHtml   = chunks.map(chunk => {
      chunk = chunk.trim();
      if (!chunk) return '';
      const m = chunk.match(/^\[(\d{2}:\d{2})\]\s*([\s\S]*)/);
      if (!m) return '';
      return `        <p><span style="${TRANSCRIPT_SPAN_STYLE}">[${m[1]}]</span> ${hEscape(m[2].trim())}</p>`;
    }).filter(Boolean).join('\n');
    const tint = i % 2 ? ' sfc-transcript-section--tinted' : '';
    sections.push(
      `      <div class="sfc-transcript-section${tint}">\n` +
      `        <div class="sfc-col-label">${hEscape(heading)}</div>\n` +
      pHtml + '\n      </div>'
    );
  });
  return sections.join('\n\n');
}

function buildSermonBlockHtml(content, taxonomy, sermon, transcriptMd) {
  const title     = sermon.title || '';
  const speaker   = sermon.speaker || '';
  const series    = taxonomy.series || sermon.series || '';
  const scripture = taxonomy.sermon_scripture || '';
  const translation = scripture.split(' ').pop() || '';
  const dateStr   = sermon.date || '';
  let dateFmt     = dateStr;
  try {
    const d = new Date(dateStr + 'T12:00:00');
    dateFmt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {}
  const duration    = sermon.duration_minutes;
  const durationStr = duration ? `${Math.round(duration)} min` : '';
  const audioUrl    = sermon.r2_audio_url || sermon.audio_url || '';
  const vimeoUrl    = sermon.vimeo_url || '';
  const dlName      = (title + '-' + speaker).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

  const warnings = [
    !audioUrl ? '<!-- WARNING: audio_url missing -->' : '',
    !vimeoUrl ? '<!-- WARNING: vimeo_url missing -->' : '',
  ].filter(Boolean).join('\n');

  const li = items => items.map(i => `          <li>${hEscape(i)}</li>`).join('\n');

  const scriptureEntries = (content.additionalScriptures || []).map(s =>
    `      <div class="sfc-scripture-entry">\n` +
    `        <span class="sfc-ref">${hEscape(s.ref || '')}</span>\n` +
    `        <span class="sfc-theme">${hEscape(s.theme || '')}</span>\n` +
    `      </div>`
  ).join('\n      <span class="sfc-sep">·</span>\n');

  const mainPointsHtml = (content.mainPoints || []).map(mp =>
    `          <li><strong>${hEscape(mp.title || '')}</strong> ${hEscape(mp.body || '')}</li>`
  ).join('\n');

  const illustrationBlock = content.keyIllustration ? `
      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">Key Illustration</div>
        <p>${hEscape(content.keyIllustration)}</p>
      </div>` : '';

  return `<!--
SERMON DESCRIPTION
==================
SHORT DESCRIPTION (145-160 characters)
${scripture} · ${series} · ${durationStr}
${content.shortDescription || ''}

TAG LINE (10-18 words)
${content.tagLine || ''}
-->
${warnings}
<div class="sfc">
  <script type="application/json" id="sfc-data">${hJson(content)}</script>

  <!-- ── TAB BAR ── -->
  <div class="sfc-tabbar">
    <button class="sfc-tab sfc-tab--active" data-tab="about">About</button>
    <button class="sfc-tab" data-tab="notes">Sermon Notes</button>
    <button class="sfc-tab" data-tab="transcript">Transcript</button>
  </div>

  <!-- ── ABOUT PANEL ── -->
  <div class="sfc-panel sfc-panel--active" data-panel="about">
    <div class="sfc-meta-strip">
      <span>
        <span class="sfc-primary-ref">${hEscape(scripture)}</span>
        <span class="sfc-primary-theme">${hEscape(content.primaryTheme || '')}</span>
      </span>
      <span class="sfc-duration">${hEscape(series)} &nbsp;·&nbsp; ${hEscape(dateFmt)} &nbsp;·&nbsp; ${hEscape(durationStr)} &nbsp;·&nbsp; ${hEscape(translation)}</span>
    </div>
    <div class="sfc-subtitle">
      <p>${hEscape(content.subtitle || '')}</p>
      <div class="sfc-pills">
        <span class="sfc-pill">${hEscape(content.style || '')}</span>
        <span class="sfc-pill">${hEscape(content.level || '')}</span>
      </div>
    </div>
    <div class="sfc-grid">
      <div class="sfc-col">
        <div class="sfc-col-label">What this is about</div>
        <p class="sfc-hook">${hEscape(content.hook || '')}</p>
      </div>
      <div class="sfc-col">
        <div class="sfc-col-label">What you'll take away</div>
        <ul class="sfc-tags">\n${li(content.takeaways || [])}\n        </ul>
      </div>
      <div class="sfc-col">
        <div class="sfc-col-label">This is for you if</div>
        <ul class="sfc-audience">\n${li(content.audience || [])}\n        </ul>
      </div>
    </div>
    <div class="sfc-scripture">
      <span class="sfc-label">Also</span>
      ${scriptureEntries}
    </div>
  </div>

  <!-- ── NOTES PANEL ── -->
  <div class="sfc-panel" data-panel="notes">
    <div class="sfc-notes">
      <div class="sfc-notes-section">
        <div class="sfc-col-label">The Big Idea</div>
        <p>${hEscape(content.bigIdea || '')}</p>
      </div>
      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">Key Scripture</div>
        <blockquote class="sfc-notes-quote">
          <p>${hEscape(content.keyScriptureText || '')}</p>
          <cite>${hEscape(content.keyScriptureRef || '')}</cite>
        </blockquote>
      </div>
      <div class="sfc-notes-section">
        <div class="sfc-col-label">Main Points</div>
        <ol class="sfc-notes-list">\n${mainPointsHtml}\n        </ol>
      </div>${illustrationBlock}
      <div class="sfc-notes-section">
        <div class="sfc-col-label">What This Means for Us</div>
        <ul class="sfc-notes-apply">\n${li(content.application || [])}\n        </ul>
      </div>
      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">To Remember</div>
        <p class="sfc-notes-closing">${hEscape(content.toRemember || '')}</p>
      </div>
    </div>
  </div>

  <!-- ── TRANSCRIPT PANEL ── -->
  <div class="sfc-panel" data-panel="transcript">
    <div class="sfc-notes">
${renderTranscriptPanel(transcriptMd)}
    </div>
  </div>

  <!-- ── AUDIO ── -->
  <div class="sfc-audio-wrap">
    <div class="sfc-audio-header">
      <span class="sfc-label">Audio</span>
      <span style="font-family:Arial,sans-serif;font-size:8.5pt;color:#2B4A6B;font-weight:700;">${hEscape(speaker)}</span>
    </div>
    <div class="sfc-audio-body">
      <audio controls preload="none"><source src="${hEscape(audioUrl)}" type="audio/mpeg"></audio>
      <a class="sfc-download" href="${hEscape(audioUrl)}" download="${hEscape(dlName)}.mp3">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 5.5l3 3 3-3M1 10h10" stroke="#2B4A6B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        MP3
      </a>
    </div>
  </div>

  <!-- ── VIDEO ── -->
  <div class="sfc-video-wrap">
    <div class="sfc-video-header"><span class="sfc-label">Video</span></div>
    <div class="sfc-video-ratio">
      <iframe src="${hEscape(vimeoUrl)}" frameborder="0"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        title="${hEscape(title)} — ${hEscape(speaker)}"></iframe>
    </div>
  </div>

  <!-- ── FOOTER ── -->
  <div class="sfc-footer">
    <span class="sfc-name">Family Church</span>
    <div class="sfc-dots">
      <span class="sfc-dot" style="background:#C0392B;"></span>
      <span class="sfc-dot" style="background:#5B8A2D;"></span>
      <span class="sfc-dot" style="background:#8B7355;"></span>
    </div>
  </div>
</div>
<script src="https://player.vimeo.com/api/player.js"></script>
<script>
(function(){var tabs=document.querySelectorAll('.sfc-tab');tabs.forEach(function(btn){btn.addEventListener('click',function(){var t=btn.dataset.tab;tabs.forEach(function(b){b.classList.remove('sfc-tab--active');});document.querySelectorAll('.sfc-panel').forEach(function(p){p.classList.remove('sfc-panel--active');});btn.classList.add('sfc-tab--active');document.querySelector('.sfc-panel[data-panel="'+t+'"]').classList.add('sfc-panel--active');});});})();
</script>`;
}

function extractSfcData(htmlText) {
  const m = htmlText.match(/<script type="application\/json" id="sfc-data">([\s\S]*?)<\/script>/);
  const defaults = {
    shortDescription: '', tagLine: '', primaryTheme: '', subtitle: '', hook: '',
    style: '', level: '', takeaways: [], audience: [], additionalScriptures: [],
    bigIdea: '', keyScriptureRef: '', keyScriptureText: '', mainPoints: [],
    keyIllustration: null, application: [], toRemember: '',
  };
  if (!m) { warn('No #sfc-data block found'); return defaults; }
  try { return { ...defaults, ...JSON.parse(m[1].replace(/<\\\//g, '</')) }; }
  catch (e) { warn(`Could not parse #sfc-data: ${e.message}`); return defaults; }
}

// ─── Devotions ────────────────────────────────────────────────────────────────

function parseReadingPlansHtml(rpHtml) {
  if (!rpHtml?.trim()) return {};
  const root = parseHtml(rpHtml);
  const LABEL_MAP = {
    'old testament': 'ot', 'new testament': 'nt', 'wisdom': 'wisdom',
    'wisdom literature': 'wisdom', 'narrative': 'narrative',
    'history & prophecy': 'historyProphecy', 'history and prophecy': 'historyProphecy',
    'history': 'historyProphecy',
  };
  function linksFrom(el) {
    return el.querySelectorAll('a').map(a => ({ ref: a.text.trim(), url: a.getAttribute('href') || '' })).filter(l => l.ref);
  }
  function subsections(col) {
    const result = {};
    let currentKey = null;
    for (const child of col.childNodes) {
      if (child.rawTagName === 'b') { currentKey = LABEL_MAP[child.text.trim().toLowerCase()]; }
      else if (child.rawTagName === 'ul' && currentKey) {
        const links = linksFrom(child);
        if (links.length) result[currentKey] = links;
      }
    }
    return result;
  }
  const out = {};
  for (const col of root.querySelectorAll('div.rp-col')) {
    const h3 = col.querySelector('h3');
    if (!h3) continue;
    const title = h3.text.trim().toLowerCase();
    if (title.includes('connected'))    { const s = subsections(col); if (Object.keys(s).length) out.connected = s; }
    else if (title.includes('chronological')) { const l = linksFrom(col); if (l.length) out.chronological = l; }
    else if (title.includes('literary') || title.includes('esv')) { const s = subsections(col); if (Object.keys(s).length) out.literary = s; }
  }
  return out;
}

function parseDevotionHtml(contentHtml) {
  const rpIdx   = contentHtml.indexOf('<div class="reading-plans">');
  const mainHtml = rpIdx >= 0 ? contentHtml.slice(0, rpIdx).trim() : contentHtml;
  const rpHtml   = rpIdx >= 0 ? contentHtml.slice(rpIdx) : '';

  const SECTION_NAMES = new Set(['Reflection', 'Supporting Scriptures', 'Life Application', 'Prayer', 'Links']);
  const parts = mainHtml.split(/<h3>(.*?)<\/h3>/s);

  let keyRef = '', keyText = '', reflection = '', lifeApp = '', prayer = '';
  const supporting = [];

  for (let i = 1; i < parts.length - 1; i += 2) {
    const label   = parts[i].trim();
    const content = parts[i + 1];

    if (label === 'Reflection') {
      reflection = content.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
        .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    } else if (label === 'Supporting Scriptures') {
      for (const [, refHtml, bqHtml] of content.matchAll(/<b>(.*?)<\/b>.*?<blockquote>(.*?)<\/blockquote>/gs)) {
        const ref = refHtml.replace(/<[^>]+>/g, '').trim();
        const txt = bqHtml.replace(/<[^>]+>/g, '').trim().replace(/^[""“”']+|[""“”']+$/g, '');
        if (ref) supporting.push({ ref, text: txt });
      }
    } else if (label === 'Life Application') {
      lifeApp = content.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
        .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    } else if (label === 'Prayer') {
      const prayerSection = content.split(/<hr\s*\/?>/i)[0];
      prayer = prayerSection.replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    } else if (!SECTION_NAMES.has(label) && !keyRef) {
      keyRef = label;
      const bqM = content.match(/<blockquote>([\s\S]*?)<\/blockquote>/i);
      if (bqM) {
        keyText = bqM[1].replace(/<b>.*?<\/b>\s*\n?/gs, '')
          .replace(/<[^>]+>/g, '').trim().replace(/^[""“”']+|[""“”']+$/g, '');
      }
    }
  }

  return {
    keyScripture: { ref: keyRef, text: keyText },
    reflection, supportingScriptures: supporting,
    lifeApplication: lifeApp, prayer,
    readingPlans: parseReadingPlansHtml(rpHtml),
  };
}

function buildDevotionMdx(dateStr, title, imageLocal, sermonUrl, fields) {
  const ks   = fields.keyScripture || {};
  const rp   = fields.readingPlans || {};
  const supp = fields.supportingScriptures || [];
  const lines = ['---'];
  lines.push(`title: ${yamlStr(title)}`);
  lines.push(`date: ${dateStr}T00:00:00.000Z`);
  lines.push(`image: ${yamlStr(imageLocal)}`);
  lines.push(`sermonUrl: ${yamlStr(sermonUrl)}`);
  lines.push('keyScripture:');
  lines.push(`  ref: ${yamlStr(ks.ref || '')}`);
  lines.push(`  text: ${yamlStr(ks.text || '')}`);
  lines.push(`reflection: ${yamlStr(fields.reflection || '')}`);
  if (supp.length) { lines.push('supportingScriptures:'); lines.push(yamlListOfDicts(supp)); }
  else lines.push('supportingScriptures: []');
  lines.push(`lifeApplication: ${yamlStr(fields.lifeApplication || '')}`);
  lines.push(`prayer: ${yamlStr(fields.prayer || '')}`);

  const rpLink = (links, pad) => links.flatMap(l => [`${pad}- ref: ${yamlStr(l.ref||'')}`, `${pad}  url: ${yamlStr(l.url||'')}`]);
  lines.push('readingPlans:');
  if (!Object.keys(rp).length) {
    lines.push('  connected: {}', '  chronological: []', '  literary: {}');
  } else {
    const conn = rp.connected || {};
    if (Object.keys(conn).length) {
      lines.push('  connected:');
      for (const sub of ['ot', 'nt', 'wisdom']) { if (conn[sub]) { lines.push(`    ${sub}:`); lines.push(...rpLink(conn[sub], '      ')); } }
    } else lines.push('  connected: {}');
    const chron = rp.chronological || [];
    if (chron.length) { lines.push('  chronological:'); lines.push(...rpLink(chron, '    ')); }
    else lines.push('  chronological: []');
    const lit = rp.literary || {};
    if (Object.keys(lit).length) {
      lines.push('  literary:');
      for (const sub of ['wisdom', 'narrative', 'historyProphecy', 'nt']) { if (lit[sub]) { lines.push(`    ${sub}:`); lines.push(...rpLink(lit[sub], '      ')); } }
    } else lines.push('  literary: {}');
  }
  lines.push('---', '');
  return lines.join('\n');
}

function buildSermonMdx(sermon, taxonomy, htmlText, transcriptMd) {
  const block     = extractSfcData(htmlText);
  const series    = sermon.series || taxonomy.series || '';
  const scripture = taxonomy.sermon_scripture || '';
  const wcM       = transcriptMd.match(/^word_count:\s*(\d+)/m);
  const wc        = wcM ? parseInt(wcM[1]) : null;

  const lines = ['---', '# ── IDENTITY ─────────────────────────────────────────────────────'];
  lines.push(`title: ${yamlStr(sermon.title || '')}`);
  lines.push(`date: ${sermon.date}`);
  lines.push(`speaker: ${yamlStr(sermon.speaker || '')}`);
  if (series) lines.push(`series: ${yamlStr(series)}`);

  lines.push('', '# ── SCRIPTURE ────────────────────────────────────────────────────');
  lines.push(`scripture: ${yamlStr(scripture)}`);
  if (block.primaryTheme) lines.push(`primaryTheme: ${yamlStr(block.primaryTheme)}`);
  if (block.additionalScriptures?.length) {
    lines.push('additionalScriptures:');
    for (const s of block.additionalScriptures) {
      lines.push(`  - ref: ${yamlStr(s.ref||'')}`, `    theme: ${yamlStr(s.theme||'')}`);
    }
  }

  lines.push('', '# ── MEDIA ────────────────────────────────────────────────────────');
  lines.push(`image: ${strOrNull(sermon.image_local || '')}`);
  lines.push(`audioUrl: ${strOrNull(sermon.r2_audio_url || '')}`);
  lines.push(`audioSizeBytes: ${sermon.r2_audio_size_bytes ?? 'null'}`);
  lines.push(`vimeoUrl: ${strOrNull(sermon.vimeo_url || '')}`);
  lines.push(`durationMinutes: ${sermon.duration_minutes ?? 'null'}`);

  lines.push('', '# ── PRESENTATION COPY ────────────────────────────────────────────');
  lines.push(`tagLine: ${strOrNull(block.tagLine)}`);
  lines.push(`shortDescription: ${strOrNull(block.shortDescription)}`);
  lines.push(`subtitle: ${strOrNull(block.subtitle)}`);
  lines.push(`hook: ${strOrNull(block.hook)}`);

  lines.push('', '# ── STYLE ────────────────────────────────────────────────────────');
  lines.push(`style: ${strOrNull(block.style)}`);
  lines.push(`level: ${strOrNull(block.level)}`);

  lines.push('', '# ── ABOUT LISTS ──────────────────────────────────────────────────');
  lines.push(`takeaways:${listField(block.takeaways)}`);
  lines.push(`audience:${listField(block.audience)}`);

  lines.push('', '# ── SERMON NOTES ─────────────────────────────────────────────────');
  lines.push(`bigIdea: ${yamlStr(block.bigIdea || '')}`);
  lines.push(`keyScriptureRef: ${strOrNull(block.keyScriptureRef)}`);
  lines.push(`keyScriptureText: ${yamlStr(block.keyScriptureText || '')}`);
  if (block.mainPoints?.length) {
    lines.push('mainPoints:');
    for (const mp of block.mainPoints) { lines.push(`  - title: ${yamlStr(mp.title||'')}`, `    body: ${yamlStr(mp.body||'')}`); }
  } else lines.push('mainPoints: []');
  lines.push(`keyIllustration: ${yamlStr(block.keyIllustration || '')}`);
  lines.push(`application:${listField(block.application)}`);
  lines.push(`toRemember: ${yamlStr(block.toRemember || '')}`);
  lines.push('closingPrayer: null');

  lines.push('', '# ── TAXONOMY ─────────────────────────────────────────────────────');
  lines.push(`categories:${listField(taxonomy.category || [])}`);
  lines.push(`tags:${listField(taxonomy.tags || [])}`);

  lines.push('', '# ── METADATA ─────────────────────────────────────────────────────');
  lines.push('guid: null', 'review: true', `transcribedBy: deepgram-${DEEPGRAM_MODEL}`);
  lines.push(`wordCount: ${wc ?? 'null'}`);
  lines.push('---', '');

  const body = extractTranscriptBody(transcriptMd);
  lines.push(`# ${sermon.title || ''}`, '', '## Transcript', '', body, '');
  return lines.join('\n');
}

// ─── Google Auth ──────────────────────────────────────────────────────────────

async function getGoogleCredentials() {
  if (!existsSync(GOOGLE_CREDENTIALS_FILE)) {
    throw new Error(`Google credentials not found: ${GOOGLE_CREDENTIALS_FILE}\nSet GOOGLE_CREDENTIALS_FILE or place oauth_credentials.json in ~/.config/sermon-pipeline/`);
  }
  const creds = JSON.parse(readFileSync(GOOGLE_CREDENTIALS_FILE, 'utf8'));
  const { client_id, client_secret } = creds.installed;

  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost');

  if (existsSync(GOOGLE_TOKEN_FILE)) {
    const token = JSON.parse(readFileSync(GOOGLE_TOKEN_FILE, 'utf8'));
    oauth2.setCredentials(token);
    oauth2.on('tokens', t => {
      const existing = existsSync(GOOGLE_TOKEN_FILE) ? JSON.parse(readFileSync(GOOGLE_TOKEN_FILE, 'utf8')) : {};
      writeFileSync(GOOGLE_TOKEN_FILE, JSON.stringify({ ...existing, ...t }, null, 2));
    });
    return oauth2;
  }

  // Initial auth flow — open browser, start one-shot local server
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url  = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('code');
      res.end('<h2>Auth complete — return to your terminal.</h2>');
      server.close();
      try {
        const { tokens } = await oauth2.getToken({ code, redirect_uri: `http://localhost:${port}` });
        oauth2.setCredentials(tokens);
        mkdirSync(dirname(GOOGLE_TOKEN_FILE), { recursive: true });
        writeFileSync(GOOGLE_TOKEN_FILE, JSON.stringify(tokens, null, 2));
        log('Google token saved');
        resolve(oauth2);
      } catch (e) { reject(e); }
    });
    let port;
    server.listen(0, () => {
      port = server.address().port;
      const authUrl = oauth2.generateAuthUrl({ access_type: 'offline', scope: GOOGLE_SCOPES, redirect_uri: `http://localhost:${port}` });
      console.log('\nOpening browser for Google auth...');
      try { execSync(`xdg-open "${authUrl}" 2>/dev/null || open "${authUrl}" 2>/dev/null`); } catch {}
      console.log('If browser did not open, visit:\n' + authUrl);
    });
  });
}

// ─── Google Calendar ──────────────────────────────────────────────────────────

function getNextMonday() {
  const now  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }));
  const day  = now.getDay(); // 0=Sun
  const diff = day === 0 ? 1 : (8 - day) % 7 || 7;
  const mon  = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setUTCHours(0, 0, 0, 0);
  return mon;
}

async function fetchReadingPlans(calendar, monday) {
  log('Fetching Reading Plans calendar events...');
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd   = new Date(monday.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const plans     = {};
  try {
    const res = await calendar.events.list({
      calendarId: READING_PLANS_CAL_ID,
      timeMin: `${weekStart}T00:00:00+02:00`,
      timeMax: `${weekEnd}T00:00:00+02:00`,
      singleEvents: true, orderBy: 'startTime',
    });
    for (const item of res.data.items || []) {
      const date = item.start?.date;
      if (date) plans[date] = item.description || '';
    }
  } catch (e) { warn(`Could not fetch reading plans: ${e.message}`); }
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (!(d in plans)) { plans[d] = ''; warn(`  No reading plan for ${d}`); }
    else log(`  Reading plan found for ${d}`);
  }
  return plans;
}

async function uploadDevotion(calendar, title, content, date) {
  const dateStr = date.toISOString().slice(0, 10);
  const nextDay = new Date(date.getTime() + 86400000).toISOString().slice(0, 10);
  await calendar.events.insert({
    calendarId: DEVOTIONS_CAL_ID,
    requestBody: { summary: title, description: content, start: { date: dateStr }, end: { date: nextDay } },
  });
  log(`  Uploaded: ${title} (${dateStr})`);
}

async function doUploadDevotions(devotions, monday, calendar, dryRun = false) {
  const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  let uploaded = 0;
  for (let i = 0; i < Math.min(devotions.length, 7); i++) {
    const d = new Date(monday.getTime() + i * 86400000);
    const { title = dayNames[i] + ' Devotion', content = '' } = devotions[i];
    if (!content) { warn(`  No content for ${dayNames[i]} — skipping`); continue; }
    if (dryRun) { console.log(`  [DRY RUN] ${d.toISOString().slice(0,10)}: ${title} (${content.length} chars)`); uploaded++; }
    else { try { await uploadDevotion(calendar, title, content, d); uploaded++; await new Promise(r => setTimeout(r, 500)); } catch (e) { console.error(`  Failed ${dayNames[i]}: ${e.message}`); } }
  }
  log(dryRun ? `Dry run: ${uploaded}/7 would upload` : `Uploaded ${uploaded}/7 devotions`);
}

function generateDevotions(transcriptMd, sermon, readingPlans) {
  const prompt   = loadPrompt('devotions.txt');
  const dates    = Object.keys(readingPlans).sort();
  const plansText = dates.map(d => readingPlans[d] ? `READING PLAN — ${d}:\n${readingPlans[d]}` : `READING PLAN — ${d}: (none available)`).join('\n\n');
  const fullPrompt = `${prompt}\n\n---\n\nTRANSCRIPT FILE (.md):\n\n${transcriptMd}\n\nREADING PLANS:\n\n${plansText}\n\nPOST URL: ${sermon.post_url || ''}\nIMAGE URL: ${sermon.image_url || ''}`;
  const raw = runClaude(fullPrompt, 'devotions', 'claude-opus-4-8', 'max');

  const devotions = [];
  for (const section of raw.split('===DEVOTION===')) {
    const s = section.trim();
    if (!s) continue;
    const titleM   = s.match(/^TITLE:\s*(.+?)[\r\n]/);
    const contentM = s.match(/^CONTENT:\s*[\r\n]([\s\S]*)/m);
    if (titleM && contentM) devotions.push({ title: titleM[1].trim(), content: contentM[1].trim() });
  }
  if (devotions.length !== 7) {
    warn(`Expected 7 devotions, got ${devotions.length}`);
    return [{ title: 'Devotion Set', content: raw, parse_error: true }];
  }
  // Append reading plans HTML to each devotion
  for (let i = 0; i < devotions.length; i++) {
    if (i < dates.length && readingPlans[dates[i]]) {
      const rpHtml = buildReadingPlansHtml(readingPlans[dates[i]]);
      if (rpHtml) devotions[i].content = devotions[i].content.trimEnd() + rpHtml;
    }
  }
  return devotions;
}

function buildReadingPlansHtml(description) {
  if (!description?.trim()) return '';
  const parts = description.split(/(?=<h3>(?:Connected Reading|Chronological Reading|ESV Literary Study Bible)<\/h3>)/);
  const cols  = parts.filter(p => p.trim()).map(p => `<div class="rp-col">${p}</div>`).join('');
  return cols ? `<div class="reading-plans">${cols}</div>` : '';
}

// ─── R2 Audio ─────────────────────────────────────────────────────────────────

async function uploadAudioToR2(mp3Path, date, slug) {
  const missing = [['R2_ENDPOINT',R2_ENDPOINT],['R2_ACCESS_KEY_ID',R2_ACCESS_KEY_ID],['R2_SECRET_ACCESS_KEY',R2_SECRET]].filter(([,v])=>!v).map(([k])=>k);
  if (missing.length) throw new Error(`R2 credentials not set: ${missing.join(', ')}`);

  const key       = `sermons/${date}-${slug}.mp3`;
  const publicUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  const bytes     = statSync(mp3Path).size;
  log(`  Uploading to R2: ${key} (${(bytes/1048576).toFixed(1)} MB)...`);

  const s3 = new S3Client({ endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET }, region: 'auto' });
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: readFileSync(mp3Path), ContentType: 'audio/mpeg' }));
  log(`  Uploaded: ${publicUrl}`);

  let manifest = {};
  if (existsSync(R2_MANIFEST_PATH)) { try { manifest = JSON.parse(readFileSync(R2_MANIFEST_PATH, 'utf8')); } catch {} }
  manifest[`${date}-${slug}`] = { url: publicUrl, bytes };
  writeFileSync(R2_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  log(`  Manifest updated`);
  return { publicUrl, bytes };
}

// ─── Google Drive ─────────────────────────────────────────────────────────────

async function uploadFileToDrive(drive, filePath, folderId, mimeType) {
  const name = basename(filePath);
  const existing = await drive.files.list({ q: `name='${name}' and '${folderId}' in parents and trashed=false`, fields: 'files(id)' });
  const { Readable } = await import('node:stream');
  const media = { mimeType, body: Readable.from(readFileSync(filePath)) };
  if (existing.data.files?.length) {
    await drive.files.update({ fileId: existing.data.files[0].id, media });
    log(`  Updated in Drive: ${name}`);
  } else {
    await drive.files.create({ requestBody: { name, parents: [folderId] }, media });
    log(`  Uploaded to Drive: ${name}`);
  }
}

// ─── Search ingestion ─────────────────────────────────────────────────────────

function parseFrontmatter(mdText) {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.includes(':')) continue;
    const [k, ...rest] = line.split(':');
    meta[k.trim()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
  }
  return meta;
}

function blockRowsFromSfcData(content) {
  const rows = [];
  if (content.bigIdea) rows.push(['the_big_idea', content.bigIdea]);
  if (content.keyScriptureText) rows.push(['key_scripture', content.keyScriptureText]);
  for (const mp of content.mainPoints || []) rows.push(['main_point', `${(mp.title||'').replace(/\.$/, '')} ${mp.body||''}`.trim()]);
  if (content.keyIllustration) rows.push(['key_illustration', content.keyIllustration]);
  for (const i of content.application || []) rows.push(['what_this_means_for_us', i]);
  if (content.toRemember) rows.push(['to_remember', content.toRemember]);
  for (const i of content.takeaways || []) rows.push(['take_away', i]);
  for (const i of content.audience || []) rows.push(['audience_fit', i]);
  for (const s of content.additionalScriptures || []) { if (s.ref && s.theme) rows.push(['related_scripture', `${s.ref} — ${s.theme}`]); }
  return rows;
}

function chunkTranscript(transcript) {
  const STAMP = /\[(\d{2}):(\d{2})\]/;
  function startSecs(text) { const m = text.match(STAMP); return m ? parseInt(m[1])*60+parseInt(m[2]) : null; }
  function stripStamps(text) { return text.replace(/\[\d{2}:\d{2}\]/g, '').trim(); }
  function wc(t) { return t.split(/\s+/).filter(Boolean).length; }
  function splitSection(s) {
    if (wc(s) <= MAX_CHUNK_WORDS) return [s];
    const sents = s.split(/(?<=[.!?])\s+(?=[A-Z"'])/);
    const chunks = []; let cur = [], n = 0;
    for (const sent of sents) { cur.push(sent); n += wc(sent); if (n >= MAX_CHUNK_WORDS) { chunks.push(cur.join(' ')); cur = []; n = 0; } }
    if (cur.length) chunks.push(cur.join(' '));
    return chunks;
  }
  if (!/(?:^|\n)### /.test(transcript)) return null;
  const parts = transcript.split(/\n(?=### )/);
  return parts.flatMap(p => splitSection(p.trim())).map(s => [stripStamps(s), startSecs(s)]);
}

async function embedAndStore(date, mdText, taxonomyJson, htmlText) {
  if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  if (!VOYAGE_API_KEY) { console.error('VOYAGE_API_KEY not set'); process.exit(1); }

  const meta      = parseFrontmatter(mdText);
  const taxonomy  = JSON.parse(taxonomyJson);
  const content   = extractSfcData(htmlText);
  const blockRows = blockRowsFromSfcData(content);
  const transcript = extractTranscriptBody(mdText);

  // Voyage REST API (avoids SDK version uncertainty)
  async function voyageEmbed(inputs, inputType = 'document') {
    const resp = await fetch('https://api.voyageai.com/v1/contextualize_and_embed', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VOYAGE_MODEL, inputs: [inputs], input_type: inputType }),
    });
    if (!resp.ok) throw new Error(`Voyage API error: ${resp.status} ${await resp.text()}`);
    return (await resp.json()).results[0].embeddings;
  }

  const headerChunks = chunkTranscript(transcript);
  let chunkTexts, chunkStarts, embeddings;

  if (headerChunks) {
    const allTexts = [...blockRows.map(([,t])=>t), ...headerChunks.map(([t])=>t)];
    embeddings  = await voyageEmbed(allTexts);
    chunkTexts  = allTexts;
    chunkStarts = [...blockRows.map(()=>null), ...headerChunks.map(([,s])=>s)];
  } else {
    const blockEmbeds = blockRows.length ? await voyageEmbed(blockRows.map(([,t])=>t)) : [];
    // Fallback: regular embed for transcript
    const tResp = transcript ? await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: [transcript.replace(/\[\d{2}:\d{2}\]/g,'').trim()], input_type: 'document' }),
    }).then(r => r.json()) : null;
    const tEmbeds = tResp?.data?.map(d => d.embedding) ?? [];
    chunkTexts  = [...blockRows.map(([,t])=>t), ...(tResp ? [transcript.replace(/\[\d{2}:\d{2}\]/g,'').trim()] : [])];
    chunkStarts = chunkTexts.map(() => null);
    embeddings  = [...blockEmbeds, ...tEmbeds];
  }

  const { registerTypes } = await import('pgvector/pg');
  const db = new PgClient({ connectionString: DATABASE_URL });
  await db.connect();
  await registerTypes(db);

  try {
    await db.query('DELETE FROM sermon_chunks WHERE sermon_date = $1', [date]);
    const base = {
      sermon_date: date, sermon_title: meta.title || date,
      speaker: meta.speaker || '', series: taxonomy.series || meta.series || '',
      category: taxonomy.category || [], tags: taxonomy.tags || [],
      sermon_scripture: taxonomy.sermon_scripture || '',
      audio_url: meta.audio_url || null, web_url: sermon_post_url(date, meta) || null,
    };
    for (let i = 0; i < chunkTexts.length; i++) {
      const stype = i < blockRows.length ? blockRows[i][0] : 'transcript';
      await db.query(
        `INSERT INTO sermon_chunks (sermon_date,sermon_title,speaker,series,category,tags,sermon_scripture,section_type,content,embedding,audio_url,web_url,start_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [base.sermon_date,base.sermon_title,base.speaker,base.series,base.category,base.tags,base.sermon_scripture,stype,chunkTexts[i],embeddings[i],base.audio_url,base.web_url,chunkStarts[i]]
      );
    }
    await db.query('COMMIT');
    log(`  Inserted ${chunkTexts.length} rows for ${date}`);
    return chunkTexts.length;
  } finally { await db.end(); }
}

function sermon_post_url(date, meta) {
  return meta.post_url || `${SITE_URL}/sermons/${date}`;
}

// ─── Website file writing ─────────────────────────────────────────────────────

function gitPushWebsite(newFiles) {
  if (!newFiles.length) { log('No new files — nothing to commit'); return; }
  function git(...args) {
    return spawnSync('git', ['-C', WEBSITE_DIR, ...args], { encoding: 'utf8' });
  }
  const add = git('add', ...newFiles);
  if (add.status !== 0) { console.error(`git add failed: ${add.stderr}`); return; }
  const status = git('status', '--porcelain', ...newFiles);
  if (!status.stdout.trim()) { log('No changes to commit (files unchanged)'); return; }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
  const msg   = `chore: add devotions and sermon for ${today}`;
  const commit = git('commit', '-m', msg);
  if (commit.status !== 0) { console.error(`git commit failed: ${commit.stderr}`); return; }
  log(`  Committed: ${msg}`);
  git('stash');
  const pull = git('pull', '--rebase');
  if (pull.status !== 0) { console.error(`git pull --rebase failed: ${pull.stderr}`); return; }
  git('stash', 'pop');
  const push = git('push');
  if (push.status !== 0) { console.error(`git push failed: ${push.stderr}`); return; }
  log('  Pushed — Cloudflare build triggered');
}

function writeWebsiteFiles(sermon, outputDir, date, slug) {
  const devotionsPath = join(outputDir, `devotions-${date}-${slug}.json`);
  const taxPath       = join(outputDir, `${date}-${slug}.json`);
  const htmlPath      = join(outputDir, `${date}-${slug}.html`);
  const mdPath        = join(outputDir, `${date}-${slug}.md`);
  const newFiles      = [];

  const imageLocal = sermon.image_local || '';
  const imageUrl   = imageLocal ? `${SITE_URL}${imageLocal}` : '';
  const sermonUrl  = `${SITE_URL}/sermons/${date}-${slug}`;

  // ── Devotion MDX ──
  const devotionDir = join(WEBSITE_DIR, 'src', 'content', 'devotion');
  mkdirSync(devotionDir, { recursive: true });

  if (!existsSync(devotionsPath)) {
    warn(`Devotions file not found: ${devotionsPath} — skipping`);
  } else {
    const devotions = JSON.parse(readFileSync(devotionsPath, 'utf8'));
    const metaPath  = join(outputDir, `devotions-meta-${date}-${slug}.json`);
    let monday;
    if (existsSync(metaPath)) {
      monday = new Date(JSON.parse(readFileSync(metaPath, 'utf8')).monday + 'T00:00:00Z');
    } else {
      monday = getNextMonday();
      warn('No devotions-meta file — using next Monday as fallback');
    }
    let written = 0;
    for (let i = 0; i < Math.min(devotions.length, 7); i++) {
      if (devotions[i].parse_error) { warn(`Devotion ${i+1}: parse_error — skipping`); continue; }
      const dayDate = new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10);
      const mdxPath = join(devotionDir, `${dayDate}.mdx`);
      if (existsSync(mdxPath)) { log(`  Devotion ${dayDate}: exists — skipping`); continue; }
      const { title = `Devotion ${i+1}`, content = '' } = devotions[i];
      if (!content) { warn(`  Devotion ${dayDate}: empty — skipping`); continue; }
      const fields = parseDevotionHtml(content);
      writeFileSync(mdxPath, buildDevotionMdx(dayDate, title, imageLocal, sermonUrl, fields));
      newFiles.push(relative(WEBSITE_DIR, mdxPath));
      log(`  Devotion ${dayDate}: written`);
      written++;
    }
    log(`Devotion MDX: ${written} file(s) written`);
  }

  // ── Sermon MDX ──
  const sermonDir    = join(WEBSITE_DIR, 'src', 'content', 'sermons');
  const sermonMdxPath = join(sermonDir, `${date}-${slug}.mdx`);
  mkdirSync(sermonDir, { recursive: true });

  if (existsSync(sermonMdxPath)) {
    log(`Sermon MDX exists — skipping: ${basename(sermonMdxPath)}`);
  } else if (!existsSync(htmlPath) || !existsSync(taxPath) || !existsSync(mdPath)) {
    warn('Sermon MDX skipped — missing step outputs (run steps 2, 3, 4 first)');
  } else {
    const taxJson  = readFileSync(taxPath, 'utf8');
    const htmlText = readFileSync(htmlPath, 'utf8');
    const mdText   = readFileSync(mdPath, 'utf8');
    const tax      = JSON.parse(taxJson);
    const mdxStr   = buildSermonMdx(sermon, tax, htmlText, mdText);
    writeFileSync(sermonMdxPath, mdxStr);
    newFiles.push(relative(WEBSITE_DIR, sermonMdxPath));
    log(`Sermon MDX written: ${basename(sermonMdxPath)}`);
  }

  gitPushWebsite(newFiles);
}

// ─── Step runners ─────────────────────────────────────────────────────────────

async function runSetup() {
  console.log('\nReading sermon-notes (current.mdx)...');
  const notes = readSermonNotes();

  console.log(`\n  Title  : ${notes.title}`);
  console.log(`  Speaker: ${notes.speaker || '(none)'}`);
  console.log(`  Series : ${notes.series  || '(none)'}`);
  console.log(`  Image  : ${notes.image   || '(none)'}`);
  console.log(`  Date   : ${notes.date}`);

  const confirm = (await ask(`\n  Date is ${notes.date} — correct? (y/n): `)).trim().toLowerCase();
  if (confirm !== 'y') { console.log('  Update current.mdx and re-run setup.'); return; }

  // Vimeo selection
  if (!VIMEO_TOKEN) { console.error('VIMEO_TOKEN not set'); process.exit(1); }
  const videos = await fetchVimeoVideos();
  console.log('\nRecent Vimeo videos:');
  console.log('-'.repeat(60));
  videos.forEach((v, i) => {
    const mark = v.status === 'available' ? '✓' : '✗';
    console.log(`  ${String(i+1).padStart(2)}. [${mark}] ${v.name}  (${(v.created_time||'').slice(0,10)}) — ${v.status}`);
  });
  console.log('-'.repeat(60));
  let selected;
  while (true) {
    const choice = (await ask('\nEnter video number: ')).trim();
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < videos.length) { selected = videos[idx]; break; }
    console.log(`  Enter 1–${videos.length}`);
  }
  if (selected.status !== 'available') {
    const ok = (await ask(`  Status is '${selected.status}' — continue? (y/n): `)).trim().toLowerCase();
    if (ok !== 'y') { console.log('Aborted.'); return; }
  }
  if (!selected.download) { console.error('No download links — check Vimeo plan'); process.exit(1); }

  const dl       = getSmallestDownload(selected);
  const slug     = slugify(notes.title);
  const videoPath = join(AUDIO_DIR, `${notes.date}-${slug}.mp4`);
  const mp3Path   = join(AUDIO_DIR, `${notes.date}-${slug}.mp3`);

  await downloadVideo(dl.link, videoPath);
  convertToMp3(videoPath, mp3Path);
  unlinkSync(videoPath);
  log('  Video file removed');

  const postUrl = `${SITE_URL}/sermons/${notes.date}-${slug}`;
  const sermon  = {
    date:     notes.date,
    title:    notes.title,
    speaker:  notes.speaker,
    series:   notes.series,
    image:    notes.image,     // original /images/temp/... path
    image_local: '',           // filled after slug confirmed in step 9
    image_url:   notes.image ? `${SITE_URL}${notes.image}` : '', // full URL for prompts/calendar
    post_url: postUrl,
    slug,
    mp3_path: mp3Path,
    vimeo_url:        getVimeoEmbedUrl(selected),
    vimeo_embed_html: selected.embed?.html || '',
  };
  saveSession(sermon);
  console.log('\n' + '='.repeat(60));
  console.log('Setup complete.');
  console.log(`  Sermon : ${sermon.date} — ${sermon.title}`);
  console.log(`  MP3    : ${mp3Path}`);
  console.log('='.repeat(60));
}

async function runTranscribe() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const mp3 = sermon.mp3_path;
  if (!mp3 || !existsSync(mp3)) { console.error(`MP3 not found: ${mp3}`); process.exit(1); }

  const { transcript, durationMins } = await transcribeAudio(mp3);
  sermon.duration_minutes = durationMins;
  saveSession(sermon);

  log('Cleaning and structuring transcript (claude Haiku)...');
  const structured = generateStructuredTranscript(transcript);
  const stagedPath = join(outputDir, `${date}-${slug}.structured.txt`);
  writeFileSync(stagedPath, structured);
  log(`Structured transcript staged: ${basename(stagedPath)}`);
}

async function runTaxonomy() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const stagedPath = join(outputDir, `${date}-${slug}.structured.txt`);
  if (!existsSync(stagedPath)) { console.error('Run step 2 (transcribe) first'); process.exit(1); }
  const structured = readFileSync(stagedPath, 'utf8');

  let taxonomy = generateTaxonomy(sermon, structured);
  taxonomy = await promptMissingTaxonomyFields(taxonomy);

  const taxPath = join(outputDir, `${date}-${slug}.json`);
  writeFileSync(taxPath, JSON.stringify(taxonomy, null, 2));
  log(`Taxonomy saved: ${basename(taxPath)}`);

  // Merge series from taxonomy if blank in session
  sermon.series = sermon.series || taxonomy.series || '';
  saveSession(sermon);

  const series = sermon.series || taxonomy.series || '';
  const mdText = buildTranscriptMarkdown(sermon, structured, sermon.duration_minutes, `${date}-${slug}.json`);
  const mdPath = join(outputDir, `${date}-${slug}.md`);
  writeFileSync(mdPath, mdText);
  log(`Transcript saved: ${basename(mdPath)}`);
  if (existsSync(stagedPath)) unlinkSync(stagedPath);
}

function runSermonBlock() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const mdText  = resolveFile(outputDir, `${date}-${slug}.md`,   'Run steps 2 and 3 first');
  const taxJson = resolveFile(outputDir, `${date}-${slug}.json`, 'Run step 3 first');

  const prompt = loadPrompt('sermon-block.txt');
  const raw    = runClaude(`${prompt}\n\n---\n\nTRANSCRIPT FILE (.md):\n\n${mdText}\n\nTAXONOMY FILE (.json):\n\n${taxJson}`, 'sermon-block', 'claude-opus-4-8', 'max');
  const content = JSON.parse(stripJsonFences(raw));

  // Patch audio (may not be uploaded yet — placeholder)
  const sermonForHtml = { ...sermon, audio_url: sermon.r2_audio_url || '' };
  const html = buildSermonBlockHtml(content, JSON.parse(taxJson), sermonForHtml, mdText);
  const htmlPath = join(outputDir, `${date}-${slug}.html`);
  writeFileSync(htmlPath, html);
  log(`Sermon block saved: ${basename(htmlPath)}`);
}

async function runOptimizeSlug() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const htmlPath = join(outputDir, `${date}-${slug}.html`);
  if (!existsSync(htmlPath)) { console.error('Run step 4 first'); process.exit(1); }
  const htmlText = readFileSync(htmlPath, 'utf8');

  const taxPath = join(outputDir, `${date}-${slug}.json`);
  if (existsSync(taxPath) && !sermon.sermon_scripture) {
    const tax = JSON.parse(readFileSync(taxPath, 'utf8'));
    if (tax.sermon_scripture) sermon.sermon_scripture = tax.sermon_scripture;
  }

  const seoResult = generateSeoTitleSlug(sermon, htmlText);
  if (!seoResult) return;

  console.log(`\n  Current title : ${sermon.title}`);
  console.log(`  Current slug  : ${slug}`);
  console.log(`\n  Proposed title: ${seoResult.title}`);
  console.log(`  Proposed slug : ${seoResult.slug}`);

  const editTitle = (await ask('\n  Title [Enter to accept]: ')).trim();
  const editSlug  = (await ask('  Slug  [Enter to accept]: ')).trim();
  const newTitle  = editTitle || seoResult.title;
  const newSlug   = slugify(editSlug || seoResult.slug);

  if (!newSlug) { console.error('Slug empty — aborted'); return; }
  if (newTitle === sermon.title && newSlug === slug) { log('No changes'); return; }

  // Rename output files
  for (const [oldN, newN] of [
    [`${date}-${slug}.md`,             `${date}-${newSlug}.md`],
    [`${date}-${slug}.json`,           `${date}-${newSlug}.json`],
    [`${date}-${slug}.html`,           `${date}-${newSlug}.html`],
    [`devotions-${date}-${slug}.json`, `devotions-${date}-${newSlug}.json`],
  ]) {
    const oldP = join(outputDir, oldN);
    if (existsSync(oldP)) { const newP = join(outputDir, newN); copyFileSync(oldP, newP); unlinkSync(oldP); }
  }
  const newOutputDir = join(OUTPUT_DIR, `${date}-${newSlug}`);
  if (newSlug !== slug) {
    // rename directory
    spawnSync('mv', [outputDir, newOutputDir]);
    log(`Directory renamed: ${date}-${newSlug}`);
  }

  // Move image now that slug is final
  const imageLocal = moveSermonImage(sermon.image, date, newSlug);
  sermon.image_local = imageLocal;
  sermon.image_url   = imageLocal ? `${SITE_URL}${imageLocal}` : sermon.image_url;

  // Update session
  sermon.title    = newTitle;
  sermon.slug     = newSlug;
  sermon.post_url = `${SITE_URL}/sermons/${date}-${newSlug}`;
  saveSession(sermon);
  log(`  Title: ${newTitle}\n  Slug: ${newSlug}`);
}

async function runDevotions() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const mdText = resolveFile(outputDir, `${date}-${slug}.md`, 'Run steps 2 and 3 first');

  log('Connecting to Google Calendar...');
  const auth     = await getGoogleCredentials();
  const calendar = google.calendar({ version: 'v3', auth });
  const monday   = getNextMonday();
  log(`Devotions start Monday ${monday.toISOString().slice(0,10)}`);

  const plans    = await fetchReadingPlans(calendar, monday);
  const devotions = generateDevotions(mdText, sermon, plans);
  const devotionsPath = join(outputDir, `devotions-${date}-${slug}.json`);
  writeFileSync(devotionsPath, JSON.stringify(devotions, null, 2));
  const metaPath = join(outputDir, `devotions-meta-${date}-${slug}.json`);
  writeFileSync(metaPath, JSON.stringify({ monday: monday.toISOString().slice(0,10) }, null, 2));

  if (devotions.length === 7 && !devotions[0].parse_error) log('Devotions saved. Run option 6 to upload to calendar.');
  else warn('Parse error — saved for manual review');
}

async function runUploadDevotions() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const devotionsPath = join(outputDir, `devotions-${date}-${slug}.json`);
  if (!existsSync(devotionsPath)) { console.error('Run step 5 first'); process.exit(1); }
  const devotions = JSON.parse(readFileSync(devotionsPath, 'utf8'));

  const auth     = await getGoogleCredentials();
  const calendar = google.calendar({ version: 'v3', auth });
  const monday   = getNextMonday();
  log(`Uploading from Monday ${monday.toISOString().slice(0,10)}`);
  await doUploadDevotions(devotions, monday, calendar);
}

async function runUploadAudioR2() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const mp3 = sermon.mp3_path;
  if (!mp3 || !existsSync(mp3)) { console.error(`MP3 not found: ${mp3}`); process.exit(1); }
  const { publicUrl, bytes } = await uploadAudioToR2(mp3, date, slug);
  sermon.r2_audio_url        = publicUrl;
  sermon.r2_audio_size_bytes = bytes;
  saveSession(sermon);

  // Patch audio URL into existing HTML if it exists
  const htmlPath = join(outputDir, `${date}-${slug}.html`);
  if (existsSync(htmlPath)) {
    const htmlText = readFileSync(htmlPath, 'utf8');
    const mdText   = resolveFile(outputDir, `${date}-${slug}.md`, '');
    const taxJson  = resolveFile(outputDir, `${date}-${slug}.json`, '');
    const content  = extractSfcData(htmlText);
    const taxonomy = JSON.parse(taxJson);
    const newHtml  = buildSermonBlockHtml(content, taxonomy, sermon, mdText);
    writeFileSync(htmlPath, newHtml);
    log('HTML rebuilt with R2 audio URL');
  }
}

async function runUploadToDrive() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const mdPath   = join(outputDir, `${date}-${slug}.md`);
  const taxPath  = join(outputDir, `${date}-${slug}.json`);
  const htmlPath = join(outputDir, `${date}-${slug}.html`);
  for (const p of [mdPath, taxPath, htmlPath]) { if (!existsSync(p)) { console.error(`Missing: ${basename(p)}`); process.exit(1); } }

  const auth  = await getGoogleCredentials();
  const drive = google.drive({ version: 'v3', auth });
  await uploadFileToDrive(drive, mdPath,   DRIVE_ENRICHED,     'text/markdown');
  await uploadFileToDrive(drive, taxPath,  DRIVE_COMP_TAX,     'application/json');
  await uploadFileToDrive(drive, htmlPath, DRIVE_SERMON_BLOCK, 'text/html');
  log('Drive upload complete');
}

async function runIngestToDb() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const md   = resolveFile(outputDir, `${date}-${slug}.md`,   'Run steps 2 and 3 first');
  const tax  = resolveFile(outputDir, `${date}-${slug}.json`, 'Run step 3 first');
  const html = resolveFile(outputDir, `${date}-${slug}.html`, 'Run step 4 first');
  log(`Ingesting ${date} into search database...`);
  const n = await embedAndStore(date, md, tax, html);
  log(`Ingest complete — ${n} rows`);
}

async function runWriteWebsiteFiles() {
  const { sermon, outputDir } = loadSession();
  writeWebsiteFiles(sermon, outputDir, sermon.date, sermon.slug);
}

async function runTestCalendar() {
  const auth     = await getGoogleCredentials();
  const calendar = google.calendar({ version: 'v3', auth });
  const monday   = getNextMonday();
  try {
    await calendar.events.list({ calendarId: DEVOTIONS_CAL_ID, timeMin: monday.toISOString(), maxResults: 1 });
    log('  Connected to Devotions calendar');
    await calendar.events.list({ calendarId: READING_PLANS_CAL_ID, timeMin: monday.toISOString(), maxResults: 1 });
    log('  Connected to Reading Plans calendar');
    console.log(`\n  Calendar connectivity: OK\n  Next Monday: ${monday.toISOString().slice(0,10)}`);
  } catch (e) { console.error(`  Calendar failed: ${e.message}`); }
}

async function runDryRunDevotions() {
  const { sermon, outputDir } = loadSession();
  const { date, slug } = sermon;
  const devotionsPath = join(outputDir, `devotions-${date}-${slug}.json`);
  if (!existsSync(devotionsPath)) { console.error('Run step 5 first'); process.exit(1); }
  const devotions = JSON.parse(readFileSync(devotionsPath, 'utf8'));
  const monday    = getNextMonday();
  log(`Dry run — would start Monday ${monday.toISOString().slice(0,10)}`);
  await doUploadDevotions(devotions, monday, null, true);
}

async function runFullPipeline() {
  await runTranscribe();
  await runTaxonomy();
  runSermonBlock();
  await runOptimizeSlug();
  const { sermon, outputDir } = loadSession();
  await runUploadAudioR2();
  await runDevotions();
  await runUploadDevotions();
  runWriteWebsiteFiles();
  await runUploadToDrive();
  await runIngestToDb();
  console.log('\n' + '='.repeat(60) + '\nPipeline complete.\n' + '='.repeat(60));
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

const MENU = `
Select a step:

  s.  Setup — read sermon-notes, select Vimeo video, download MP3

  1.  Full pipeline (steps 2–11)
  2.  Transcribe audio
  3.  Generate taxonomy
  4.  Generate sermon block HTML
  5.  Optimise title and slug (SEO)
  6.  Upload audio to Cloudflare R2
  7.  Generate devotions
  8.  Upload devotions to calendar
  9.  Write MDX to website + git push
  10. Upload files to Google Drive
  11. Ingest to search database

  t.  Test calendar connectivity
  d.  Dry run — preview devotion upload

  0.  Exit

Choice: `;

async function main() {
  console.log('='.repeat(60));
  console.log('Family Church — Sermon Pipeline');
  console.log('='.repeat(60));

  if (existsSync(SESSION_FILE)) {
    const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    console.log(`\n  Session : ${s.date} — ${s.title}`);
  } else {
    console.log('\n  No session — run option s to set up.');
  }

  const choice = (await ask(MENU)).trim().toLowerCase();

  switch (choice) {
    case '0':  process.exit(0); break;
    case 's':  await runSetup(); break;
    case '1':  await runFullPipeline(); break;
    case '2':  await runTranscribe(); break;
    case '3':  await runTaxonomy(); break;
    case '4':  runSermonBlock(); break;
    case '5':  await runOptimizeSlug(); break;
    case '6':  await runUploadAudioR2(); break;
    case '7':  await runDevotions(); break;
    case '8':  await runUploadDevotions(); break;
    case '9':  await runWriteWebsiteFiles(); break;
    case '10': await runUploadToDrive(); break;
    case '11': await runIngestToDb(); break;
    case 't':  await runTestCalendar(); break;
    case 'd':  await runDryRunDevotions(); break;
    default: console.log('Invalid choice.'); rl.close(); process.exit(1);
  }
  rl.close();
}

main().catch(e => { rl.close(); console.error(e); process.exit(1); });
