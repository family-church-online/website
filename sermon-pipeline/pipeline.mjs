#!/usr/bin/env node
/**
 * Family Church Online — Sermon Pipeline
 *
 * Run by AV crew after Sunday's sermon. Takes ~25 minutes:
 *   1. Read sermon identity from TinaCMS sermon-notes (current.mdx)
 *   2. Select and download the Vimeo recording
 *   3. Convert to MP3 with ffmpeg
 *   4. Transcribe with Deepgram, clean with Claude Haiku
 *   5. Generate taxonomy, sermon block, slug, devotions (all via claude -p)
 *   6. Upload MP3 to temp R2 location
 *   7. POST everything to Cloudflare Worker — prints review URL and exits
 *
 * The Worker stores the job and sends a review notification. All the heavy
 * AI lifting happens here locally using your claude subscription.
 * The reviewer visits the printed URL to inspect content and approve.
 * Approval triggers a Cloudflare Workflow that commits to GitHub,
 * uploads devotions to Google Calendar. Drive upload happens here in step 10.5.
 *
 * Requirements:
 *   pnpm install  (inside sermon-pipeline/)
 *   ffmpeg, claude CLI (authenticated)
 *
 * Environment variables (in .env at website root, or sermon-pipeline/.env):
 *   VIMEO_TOKEN
 *   DEEPGRAM_API_KEY
 *   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   SERMON_PIPELINE_SECRET   shared secret for Worker auth
 *   SITE_URL                 defaults to https://familychurch.online
 */

import { spawnSync, spawn }                    from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, basename }             from 'node:path';
import { fileURLToPath }                       from 'node:url';
import { createInterface }                     from 'node:readline';
import { randomUUID }                          from 'node:crypto';

import matter                                  from 'gray-matter';
import { createClient as createDeepgram }      from '@deepgram/sdk';
import { S3Client, PutObjectCommand }          from '@aws-sdk/client-s3';
import { google }                              from 'googleapis';
import { parse as parseHtml }                  from 'node-html-parser';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename     = fileURLToPath(import.meta.url);
const __dirname      = dirname(__filename);
const PIPELINE_DIR   = __dirname;
const WEBSITE_DIR    = dirname(__dirname);
const PROMPTS_DIR    = join(PIPELINE_DIR, 'prompts');
const AUDIO_DIR      = join(PIPELINE_DIR, 'audio');
const SESSION_DIR    = join(PIPELINE_DIR, 'session');
const SESSION_FILE   = join(SESSION_DIR, 'current.json');
const SERMON_NOTES   = join(WEBSITE_DIR, 'src', 'content', 'sermon-notes', 'current.mdx');
const WHATS_NEXT_DIR = join(WEBSITE_DIR, 'src', 'content', 'whats-next');

for (const d of [AUDIO_DIR, SESSION_DIR]) mkdirSync(d, { recursive: true });

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

const VIMEO_TOKEN      = process.env.VIMEO_TOKEN || '';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const R2_ENDPOINT      = process.env.R2_ENDPOINT || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET        = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET        = process.env.R2_BUCKET || 'family-church-sermons';
const R2_PUBLIC_URL    = process.env.R2_AUDIO_PUBLIC_URL || process.env.R2_PUBLIC_URL || 'https://audio.familychurch.online';
const PIPELINE_SECRET  = process.env.SERMON_PIPELINE_SECRET || '';
const SITE_URL         = process.env.SITE_URL || 'https://familychurch.online';
const DEEPGRAM_MODEL   = 'nova-2';
const VOYAGE_API_KEY   = process.env.VOYAGE_API_KEY   || '';
const DATABASE_URL     = process.env.DATABASE_URL     || '';
const MAX_CHUNK_WORDS  = 600;

const READING_PLANS_CAL_ID = '9e339a64af832e22e2845990e12e5734996425604454b26ff45a86230c00d463@group.calendar.google.com';
const GOOGLE_CREDENTIALS_FILE = existsSync(join(PIPELINE_DIR, 'oauth_credentials.json'))
  ? join(PIPELINE_DIR, 'oauth_credentials.json') : join(process.env.HOME || '', '.config/sermon-pipeline/oauth_credentials.json');
const GOOGLE_TOKEN_FILE = existsSync(join(PIPELINE_DIR, 'oauth_token.json'))
  ? join(PIPELINE_DIR, 'oauth_token.json') : join(process.env.HOME || '', '.config/sermon-pipeline/oauth_token.json');

// ─── GUI mode ─────────────────────────────────────────────────────────────────

const GUI_MODE = process.argv.includes('--gui');
let _progressProc = null;

function zenityList(title, items) {
  const args = ['--list', `--title=${title}`, '--column=Video', '--width=660', '--height=380'];
  for (const item of items) args.push(item);
  const r = spawnSync('zenity', args, { encoding: 'utf8' });
  if (r.status !== 0) process.exit(0);
  return r.stdout.trim();
}

function zenityInfo(title, text) {
  spawnSync('zenity', ['--info', `--title=${title}`, `--text=${text}`, '--width=480', '--no-wrap'], { encoding: 'utf8' });
}

function zenityError(title, text) {
  spawnSync('zenity', ['--error', `--title=${title}`, `--text=${text}`, '--width=480'], { encoding: 'utf8' });
}

function zenityQuestion(title, text) {
  return spawnSync('zenity', ['--question', `--title=${title}`, `--text=${text}`, '--width=480'], { encoding: 'utf8' }).status === 0;
}

function startProgress(text = 'Starting…') {
  if (!GUI_MODE) return;
  _progressProc = spawn('zenity', ['--progress', '--pulsate', '--auto-kill', '--title=Sermon Pipeline', `--text=${text}`, '--width=500'], { stdio: ['pipe', 'ignore', 'ignore'] });
}

function progress(text) {
  if (GUI_MODE && _progressProc) {
    try { _progressProc.stdin.write(`# ${text}\n`); } catch {}
  }
}

function closeProgress() {
  if (!_progressProc) return;
  try { _progressProc.stdin.write('100\n'); _progressProc.stdin.end(); } catch {}
  _progressProc = null;
}

// ─── Readline helper ──────────────────────────────────────────────────────────

const rl = GUI_MODE ? null : createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  INFO      ${msg}`);
  progress(msg);
}
function warn(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  WARNING   ${msg}`);
  progress(`⚠ ${msg}`);
}

// ─── Claude CLI ───────────────────────────────────────────────────────────────

function loadPrompt(filename) {
  const path = join(PROMPTS_DIR, filename);
  if (!existsSync(path)) throw new Error(`Prompt not found: ${path}`);
  return readFileSync(path, 'utf8');
}

function runClaude(promptText, label, model = 'claude-opus-4-8', effort = null) {
  log(`Claude: ${label}...`);
  const args = [
    '-p', promptText,
    '--model', model,
    '--output-format', 'stream-json',
    '--verbose',
    '--disallowed-tools', 'Bash,Edit,Write,Read,WebFetch,WebSearch,NotebookEdit,Task',
  ];
  if (effort) args.push('--effort', effort);
  const result = spawnSync('claude', args, { timeout: 1_800_000, maxBuffer: 100 * 1024 * 1024, encoding: 'utf8' });

  if (result.status !== 0) throw new Error(`claude -p failed (${label}):\n${result.stderr || ''}`);

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
  log(`  ${label} — ${output.length} chars`);
  return output;
}

function stripJsonFences(raw) {
  if (!raw.startsWith('```')) return raw;
  let s = raw.split('```')[1];
  if (s.startsWith('json')) s = s.slice(4);
  return s.trim();
}

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Sermon Notes reader ──────────────────────────────────────────────────────

function readSermonNotes() {
  if (!existsSync(SERMON_NOTES)) { console.error(`Sermon notes not found: ${SERMON_NOTES}`); process.exit(1); }
  const raw = readFileSync(SERMON_NOTES, 'utf8');
  const { data } = matter(raw);
  const dateMatch = raw.match(/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m);
  const date = dateMatch ? dateMatch[1] : (data.date instanceof Date
    ? `${data.date.getFullYear()}-${String(data.date.getMonth()+1).padStart(2,'0')}-${String(data.date.getDate()).padStart(2,'0')}`
    : String(data.date || '').slice(0, 10));
  return {
    title:   (data.title   || '').trim(),
    speaker: (data.speaker || '').trim(),
    series:  (data.series  || '').trim(),
    image:   (data.image   || '').trim(),
    date,
  };
}

// ─── Next week's sermon notes ─────────────────────────────────────────────────

function findNextWhatsNext(afterDate) {
  if (!existsSync(WHATS_NEXT_DIR)) return null;
  const files = readdirSync(WHATS_NEXT_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.mdx$/.test(f)).sort();
  for (const file of files) {
    const fileDate = file.slice(0, 10);
    if (fileDate <= afterDate) continue;
    const raw = readFileSync(join(WHATS_NEXT_DIR, file), 'utf8');
    const { data } = matter(raw);
    const dateMatch = raw.match(/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m);
    return {
      date: dateMatch ? dateMatch[1] : fileDate,
      title:     (data.title    || '').trim(),
      speaker:   (data.speaker  || '').trim(),
      series:    (data.series   || '').trim(),
      scripture: (data.scripture || '').trim(),
    };
  }
  return null;
}

function buildNextSermonNotesMdx(next) {
  return [
    '---',
    `title: "${(next.title || '').replace(/"/g, "'")}"`,
    `date: "${next.date}T08:00:00.000+02:00"`,
    `speaker: "${next.speaker || ''}"`,
    `scripture: "${next.scripture || ''}"`,
    `series: "${next.series || ''}"`,
    'image: ""',
    '---', '',
  ].join('\n');
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
  let delay = 30000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
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
      return;
    } catch (err) {
      if (attempt === 5) throw err;
      warn(`Download failed (attempt ${attempt}/5): ${err.message} — retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 300000);
    }
  }
}

function convertToMp3(videoPath, mp3Path) {
  log('Converting to MP3...');
  const result = spawnSync('ffmpeg', ['-y', '-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-b:a', '64k', mp3Path], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(`ffmpeg failed:\n${result.stderr}`); process.exit(1); }
  log(`  MP3 saved: ${basename(mp3Path)} (${(statSync(mp3Path).size / 1048576).toFixed(1)} MB)`);
}

// ─── Transcription ────────────────────────────────────────────────────────────

async function transcribeAudio(audioPath) {
  if (!DEEPGRAM_API_KEY) { console.error('DEEPGRAM_API_KEY not set'); process.exit(1); }
  const deepgram = createDeepgram(DEEPGRAM_API_KEY);
  const audioBytes = readFileSync(audioPath);
  let delay = 60000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      log(`Transcribing via Deepgram Nova-2 (attempt ${attempt}/5)...`);
      const { result, error } = await deepgram.listen.prerecorded.transcribeFile(audioBytes, {
        model: DEEPGRAM_MODEL, language: 'en', punctuate: true, filler_words: true, paragraphs: true,
      });
      if (error) throw error;

      const alt          = result.results.channels[0].alternatives[0];
      const durationMins = Math.round(result.metadata.duration / 60 * 10) / 10;
      const paraData     = alt.paragraphs;

      let transcript;
      if (paraData?.paragraphs?.length) {
        transcript = paraData.paragraphs.map(para => {
          const mm = String(Math.floor(para.start / 60)).padStart(2, '0');
          const ss = String(Math.floor(para.start % 60)).padStart(2, '0');
          return `[${mm}:${ss}] ${para.sentences.map(s => s.text).join(' ')}`;
        }).join('\n\n');
      } else {
        transcript = alt.transcript || '';
      }

      log(`  ${transcript.split(/\s+/).filter(Boolean).length.toLocaleString()} words — ${durationMins} min`);
      return { transcript, durationMins };
    } catch (err) {
      const msg = String(err?.message || err).toLowerCase();
      const isRetryable = msg.includes('429') || msg.includes('rate limit') ||
        msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504');
      if (attempt === 5 || !isRetryable) throw err;
      warn(`Deepgram error (attempt ${attempt}/5): ${err.message} — retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 600000);
    }
  }
}

function ensureFirstTimestamp(rawTranscript, cleanedTranscript) {
  const firstTsMatch = rawTranscript.match(/\[\d{2}:\d{2}\]/);
  if (!firstTsMatch) return cleanedTranscript;
  const firstTs = firstTsMatch[0];
  if (cleanedTranscript.includes(firstTs)) return cleanedTranscript;
  // Claude dropped the first timestamp (often [00:00]) — re-inject it at the
  // first non-heading, non-empty line of the cleaned output.
  const lines = cleanedTranscript.split('\n');
  const idx = lines.findIndex(l => l.trim() && !l.startsWith('#'));
  if (idx === -1) return cleanedTranscript;
  warn(`First timestamp ${firstTs} was dropped by clean step — re-injecting`);
  lines[idx] = `${firstTs} ${lines[idx]}`;
  return lines.join('\n');
}

function cleanTranscript(rawTranscript) {
  const promptFile = join(PROMPTS_DIR, 'structure.txt');
  if (!existsSync(promptFile)) { warn('structure.txt not found — skipping clean'); return rawTranscript; }
  const cleaned = runClaude(`${loadPrompt('structure.txt')}\n\n---\n\nRAW TRANSCRIPT:\n\n${rawTranscript}`, 'clean transcript', 'claude-haiku-4-5-20251001');
  return ensureFirstTimestamp(rawTranscript, cleaned);
}

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

function generateTaxonomy(notes, transcript, postUrl) {
  const context = [
    'CONFIRMED IDENTITY (use verbatim — do not derive from transcript):',
    `TITLE: ${notes.title}`,
    `SPEAKER: ${notes.speaker || '(unknown)'}`,
    `SERIES: ${notes.series || '(none)'}`,
    `DATE: ${notes.date}`,
    `POST URL: ${postUrl}`,
    '',
    `TRANSCRIPT:\n\n${transcript}`,
  ].join('\n');
  const raw = runClaude(`${loadPrompt('taxonomy.txt')}\n\n---\n\n${context}`, 'taxonomy');
  return JSON.parse(stripJsonFences(raw));
}

// ─── Sermon block ─────────────────────────────────────────────────────────────

function generateSermonBlock(notes, transcript, taxonomy) {
  const transcriptMd = `---\ntitle: "${notes.title.replace(/"/g, "'")}"\ndate: ${notes.date}\nspeaker: "${notes.speaker || ''}"\n---\n\n## Transcript\n\n${transcript}`;
  const prompt = `${loadPrompt('sermon-block.txt')}\n\n---\n\nTRANSCRIPT (.md file):\n\n${transcriptMd}\n\nTAXONOMY (.json file):\n\n${JSON.stringify(taxonomy, null, 2)}`;
  const raw = runClaude(prompt, 'sermon block', 'claude-opus-4-8', 'max');
  return JSON.parse(stripJsonFences(raw));
}

// ─── SEO slug ─────────────────────────────────────────────────────────────────

function generateSeoSlug(notes, taxonomy, sermonBlock) {
  const prompt = [
    'You are an SEO expert for a church website.',
    "Given a sermon's big idea, main scripture, and original title, produce:",
    '1. An SEO-optimised title — compelling, searchable, under 65 characters; format EXACTLY as "Heading : Book Chapter:Verses" using " : " (space-colon-space) to separate the heading from the FULL scripture reference — never abbreviate to chapter alone, never use a dash or em-dash as separator',
    '2. A URL slug — lowercase, hyphens only; include every word from the title (do NOT drop prepositions, articles, or any other word); include an abbreviated scripture reference (e.g. john-3-16); under 70 characters total',
    '',
    `Original title: ${notes.title}`,
    `Main scripture: ${taxonomy.sermon_scripture}`,
    `Big idea: ${sermonBlock.bigIdea}`,
    '',
    'Return JSON only — no markdown fences: {"title": "...", "slug": "..."}',
  ].join('\n');
  const raw  = runClaude(prompt, 'seo slug', 'claude-haiku-4-5-20251001');
  const data = JSON.parse(stripJsonFences(raw));
  return { title: (data.title || notes.title).trim(), slug: slugify(data.slug || data.title || notes.title) };
}

// ─── Devotions ────────────────────────────────────────────────────────────────

function getNextMonday(afterDate) {
  const base = new Date(`${afterDate}T12:00:00+02:00`);
  const day  = base.getDay();
  const diff = day === 0 ? 1 : (8 - day) % 7 || 7;
  const mon  = new Date(base);
  mon.setDate(base.getDate() + diff);
  return mon;
}

function generateDevotions(notes, transcript, slug, imageUrl) {
  const postUrl  = `${SITE_URL}/sermons/${notes.date}-${slug}`;
  const transcriptMd = [
    '---',
    `title: "${notes.title.replace(/"/g, "'")}"`,
    `date: ${notes.date}`,
    `speaker: "${notes.speaker || ''}"`,
    `post_url: "${postUrl}"`,
    `image_url: "${imageUrl}"`,
    '---', '', '## Transcript', '', transcript,
  ].join('\n');

  const monday = getNextMonday(notes.date);
  const devotionDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getTime() + i * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  });

  const prompt = `${loadPrompt('devotions.txt')}\n\n---\n\nTRANSCRIPT FILE (.md):\n\n${transcriptMd}\n\nPOST URL: ${postUrl}\nIMAGE URL: ${imageUrl}`;
  const raw = runClaude(prompt, 'devotions', 'claude-opus-4-8', 'max');

  const devotions = [];
  for (const section of raw.split('===DEVOTION===')) {
    const s = section.trim();
    if (!s) continue;
    const titleM   = s.match(/^TITLE:\s*(.+?)[\r\n]/);
    const contentM = s.match(/^CONTENT:\s*[\r\n]([\s\S]*)/m);
    if (titleM && contentM) {
      const idx = devotions.length;
      devotions.push({ title: titleM[1].trim(), content: contentM[1].trim(), date: devotionDates[idx] ?? devotionDates[6] });
    }
  }
  if (devotions.length !== 7) {
    warn(`Expected 7 devotions, got ${devotions.length} — saving raw output for review`);
    return [{ title: 'Devotion Set', content: raw, parse_error: true, date: devotionDates[0] }];
  }
  return devotions;
}

// ─── R2 upload (temp location) ────────────────────────────────────────────────

async function uploadTempAudio(mp3Path, date) {
  const missing = [['R2_ENDPOINT',R2_ENDPOINT],['R2_ACCESS_KEY_ID',R2_ACCESS_KEY_ID],['R2_SECRET_ACCESS_KEY',R2_SECRET]].filter(([,v])=>!v).map(([k])=>k);
  if (missing.length) throw new Error(`R2 credentials not set: ${missing.join(', ')}`);

  const key  = `temp/${date}.mp3`;
  const bytes = statSync(mp3Path).size;
  log(`  Uploading temp audio to R2: ${key} (${(bytes/1048576).toFixed(1)} MB)...`);

  const s3 = new S3Client({ endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET }, region: 'auto' });
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: readFileSync(mp3Path), ContentType: 'audio/mpeg' }));
  log(`  Uploaded: ${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`);
  return key;
}

// ─── Worker POST ──────────────────────────────────────────────────────────────

async function postJobToWorker(payload) {
  if (!PIPELINE_SECRET) throw new Error('SERMON_PIPELINE_SECRET not set');
  const workerUrl = `${SITE_URL}/api/sermon/jobs`;
  log(`Posting job to ${workerUrl}...`);
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PIPELINE_SECRET}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`Worker POST failed: ${res.status} — ${text}`); }
  return await res.json();
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

async function getGoogleAuth() {
  if (!existsSync(GOOGLE_CREDENTIALS_FILE)) {
    warn(`Google credentials not found at ${GOOGLE_CREDENTIALS_FILE} — reading plans will be skipped`);
    return null;
  }
  const creds = JSON.parse(readFileSync(GOOGLE_CREDENTIALS_FILE, 'utf8'));
  const { client_id, client_secret } = creds.installed;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost');
  if (!existsSync(GOOGLE_TOKEN_FILE)) {
    warn('Google token not found — reading plans will be skipped');
    return null;
  }
  const token = JSON.parse(readFileSync(GOOGLE_TOKEN_FILE, 'utf8'));
  oauth2.setCredentials(token);
  oauth2.on('tokens', t => {
    const existing = existsSync(GOOGLE_TOKEN_FILE) ? JSON.parse(readFileSync(GOOGLE_TOKEN_FILE, 'utf8')) : {};
    writeFileSync(GOOGLE_TOKEN_FILE, JSON.stringify({ ...existing, ...t }, null, 2));
  });
  return oauth2;
}

// ─── Google Drive upload ──────────────────────────────────────────────────────

const DRIVE_FOLDER_ENRICHED     = '1w2ADe6xQ-_0Hz2KvAHbmMTSK_7WNkALO';
const DRIVE_FOLDER_COMP_TAX     = '19f02nUtBL9xNQaTsECgKvEWkcyefgixy';
const DRIVE_FOLDER_SERMON_BLOCK = '1rmr23NQsNHYFstSSW2cyB2U2XMBOt39l';

// Mirrors script2_content.py:_h — HTML-escape for safe interpolation
function _h(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Mirrors script2_content.py:_h_json — escapes </ so embedded JSON can't break out of a <script> tag
function _hJson(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

// Mirrors script2_content.py:_extract_transcript_body
function extractTranscriptBody(transcriptMd) {
  const parts = transcriptMd.split('## Transcript');
  return parts.length > 1 ? parts[1].trim() : transcriptMd.trim();
}

// Mirrors script2_content.py:_render_transcript_panel
function renderTranscriptPanel(transcriptMd) {
  const SPAN_STYLE = 'font-size:0.75em;opacity:0.55;margin-right:0.4em;font-variant-numeric:tabular-nums';
  const body = extractTranscriptBody(transcriptMd);
  const parts = body.split(/\n(?=### )/);
  const sections = [];
  let idx = 0;
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.trim().split('\n');
    const heading = lines[0].startsWith('### ') ? lines[0].replace(/^###\s*/, '') : '';
    const paragraphs = lines.slice(heading ? 1 : 0).join('\n').trim();
    const chunks = paragraphs.split(/(?=\[\d{2}:\d{2}\])/);
    const pHtml = [];
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^\[(\d{2}:\d{2})\]\s*([\s\S]*)/);
      if (!m) continue;
      const [, ts, text] = m;
      pHtml.push(`<p><span style="${SPAN_STYLE}">[${ts}]</span> ${_h(text.trim())}</p>`);
    }
    const tinted = idx % 2 ? ' sfc-transcript-section--tinted' : '';
    sections.push(
      `      <div class="sfc-transcript-section${tinted}">\n` +
      `        <div class="sfc-col-label">${_h(heading)}</div>\n` +
      pHtml.map(p => `        ${p}`).join('\n') +
      '\n      </div>'
    );
    idx++;
  }
  return sections.join('\n\n');
}

// Mirrors script2_content.py:build_sermon_block_html
function buildSermonBlockHtml(content, taxonomy, sermon, transcriptMd) {
  const title      = sermon.title || '';
  const speaker    = sermon.speaker || '';
  const series     = taxonomy.series || sermon.series || '';
  const scripture  = taxonomy.sermon_scripture || '';
  const translation = scripture ? scripture.split(' ').pop() : '';
  const dateStr    = sermon.date || '';
  let dateFmt = dateStr;
  try {
    const d = new Date(dateStr + 'T00:00:00');
    dateFmt = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {}
  const duration = sermon.durationMinutes ?? sermon.duration_minutes;
  const durationStr = duration ? `${Math.round(duration)} min` : '';
  const audioUrl = sermon.audioUrl || sermon.r2_audio_url || sermon.audio_url || '';
  const vimeoUrl = sermon.vimeoUrl || sermon.vimeo_url || '';
  const dlName = `${title}-${speaker}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

  const warnings = [];
  if (!audioUrl) warnings.push('<!-- WARNING: audio_url missing from sermon frontmatter -->');
  if (!vimeoUrl) warnings.push('<!-- WARNING: vimeo_url missing from sermon frontmatter -->');

  const li = items => (items || []).map(i => `          <li>${_h(i)}</li>`).join('\n');

  const scriptureEntries = (content.additionalScriptures || []).map(s =>
    `      <div class="sfc-scripture-entry">\n` +
    `        <span class="sfc-ref">${_h(s.ref || '')}</span>\n` +
    `        <span class="sfc-theme">${_h(s.theme || '')}</span>\n` +
    `      </div>`
  ).join('\n      <span class="sfc-sep">·</span>\n');

  const mainPointsHtml = (content.mainPoints || []).map(mp =>
    `          <li><strong>${_h(mp.title || '')}</strong> ${_h(mp.body || '')}</li>`
  ).join('\n');

  const illustrationBlock = content.keyIllustration ? `
      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">Key Illustration</div>
        <p>${_h(content.keyIllustration)}</p>
      </div>
` : '';

  return `<!--
SERMON DESCRIPTION
==================

SHORT DESCRIPTION (145-160 characters)
${scripture} · ${series} · ${durationStr}
${content.shortDescription || ''}

TAG LINE (10-18 words)
${content.tagLine || ''}
-->
${warnings.join('\n')}
<div class="sfc">
  <script type="application/json" id="sfc-data">${_hJson(content)}</script>

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
        <span class="sfc-primary-ref">${_h(scripture)}</span>
        <span class="sfc-primary-theme">${_h(content.primaryTheme || '')}</span>
      </span>
      <span class="sfc-duration">${_h(series)} &nbsp;·&nbsp; ${_h(dateFmt)} &nbsp;·&nbsp; ${_h(durationStr)} &nbsp;·&nbsp; ${_h(translation)}</span>
    </div>

    <div class="sfc-subtitle">
      <p>${_h(content.subtitle || '')}</p>
      <div class="sfc-pills">
        <span class="sfc-pill">${_h(content.style || '')}</span>
        <span class="sfc-pill">${_h(content.level || '')}</span>
      </div>
    </div>

    <div class="sfc-grid">
      <div class="sfc-col">
        <div class="sfc-col-label">What this is about</div>
        <p class="sfc-hook">${_h(content.hook || '')}</p>
      </div>
      <div class="sfc-col">
        <div class="sfc-col-label">What you'll take away</div>
        <ul class="sfc-tags">
${li(content.takeaways)}
        </ul>
      </div>
      <div class="sfc-col">
        <div class="sfc-col-label">This is for you if</div>
        <ul class="sfc-audience">
${li(content.audience)}
        </ul>
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
        <p>${_h(content.bigIdea || '')}</p>
      </div>

      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">Key Scripture</div>
        <blockquote class="sfc-notes-quote">
          <p>${_h(content.keyScriptureText || '')}</p>
          <cite>${_h(content.keyScriptureRef || '')}</cite>
        </blockquote>
      </div>

      <div class="sfc-notes-section">
        <div class="sfc-col-label">Main Points</div>
        <ol class="sfc-notes-list">
${mainPointsHtml}
        </ol>
      </div>
${illustrationBlock}
      <div class="sfc-notes-section">
        <div class="sfc-col-label">What This Means for Us</div>
        <ul class="sfc-notes-apply">
${li(content.application)}
        </ul>
      </div>

      <div class="sfc-notes-section sfc-notes-section--tinted">
        <div class="sfc-col-label">To Remember</div>
        <p class="sfc-notes-closing">${_h(content.toRemember || '')}</p>
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
      <span style="font-family:Arial,sans-serif;font-size:8.5pt;color:#2B4A6B;font-weight:700;">${_h(speaker)}</span>
    </div>
    <div class="sfc-audio-body">
      <audio controls preload="none">
        <source src="${_h(audioUrl)}" type="audio/mpeg">
      </audio>
      <a class="sfc-download" href="${_h(audioUrl)}" download="${_h(dlName)}.mp3">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 1v7M3 5.5l3 3 3-3M1 10h10" stroke="#2B4A6B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        MP3
      </a>
    </div>
  </div>

  <!-- ── VIDEO ── -->
  <div class="sfc-video-wrap">
    <div class="sfc-video-header">
      <span class="sfc-label">Video</span>
    </div>
    <div class="sfc-video-ratio">
      <iframe src="${_h(vimeoUrl)}"
        frameborder="0"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        title="${_h(title)} — ${_h(speaker)}">
      </iframe>
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
(function(){
  var tabs=document.querySelectorAll('.sfc-tab');
  tabs.forEach(function(btn){
    btn.addEventListener('click',function(){
      var target=btn.dataset.tab;
      tabs.forEach(function(t){t.classList.remove('sfc-tab--active');});
      document.querySelectorAll('.sfc-panel').forEach(function(p){p.classList.remove('sfc-panel--active');});
      btn.classList.add('sfc-tab--active');
      document.querySelector('.sfc-panel[data-panel="'+target+'"]').classList.add('sfc-panel--active');
    });
  });
})();
</script>`;
}

async function uploadFileToDrive(driveService, name, content, mimeType, folderId) {
  const { Readable } = await import('node:stream');
  const { data: list } = await driveService.files.list({
    q: `name = '${name}' and '${folderId}' in parents and trashed = false`,
    fields: 'files(id)',
  });
  const existing = list.files?.[0]?.id;
  const media = { mimeType, body: Readable.from([content]) };
  if (existing) {
    await driveService.files.update({ fileId: existing, media_body: media, requestBody: {} });
    log(`  Drive updated: ${name}`);
  } else {
    await driveService.files.create({ requestBody: { name, parents: [folderId] }, media, fields: 'id' });
    log(`  Drive uploaded: ${name}`);
  }
}

async function uploadSermonToDrive(auth, baseName, transcript, taxonomy, sermonBlock, metadata) {
  if (!auth) { warn('Drive upload skipped — no Google auth'); return; }
  const driveService = google.drive({ version: 'v3', auth });

  const title = (metadata.optimisedTitle || '').replace(/"/g, "'");
  const transcriptMd =
    `---\ntitle: "${title}"\ndate: ${metadata.date}\nspeaker: "${metadata.speaker || ''}"` +
    (metadata.series ? `\nseries: "${metadata.series}"` : '') +
    `\n---\n\n## Transcript\n\n${transcript}`;

  const sermon = {
    title: metadata.optimisedTitle || '',
    speaker: metadata.speaker || '',
    series: metadata.series || '',
    date: metadata.date,
    durationMinutes: metadata.durationMinutes,
    audioUrl: metadata.audioUrl || '',
    vimeoUrl: metadata.vimeoUrl || '',
  };
  const blockHtml = buildSermonBlockHtml(sermonBlock, taxonomy, sermon, transcriptMd);

  await uploadFileToDrive(driveService, `${baseName}-transcript.md`, transcriptMd, 'text/markdown', DRIVE_FOLDER_ENRICHED);
  await uploadFileToDrive(driveService, `${baseName}-taxonomy.json`, JSON.stringify(taxonomy, null, 2), 'application/json', DRIVE_FOLDER_COMP_TAX);
  await uploadFileToDrive(driveService, `${baseName}.html`, blockHtml, 'text/html', DRIVE_FOLDER_SERMON_BLOCK);
  log('Drive upload complete');
}

// ─── Reading Plans ────────────────────────────────────────────────────────────

// Mirrors script2_content.py:_build_reading_plans_html —
// wraps the raw Google Calendar description (flat <h3> sections) into
// <div class="rp-col"> containers so parseReadingPlansHtml can find them.
function buildReadingPlansHtml(description) {
  if (!description?.trim()) return '';
  const parts = description.split(
    /(?=<h3>(?:Connected Reading|Chronological Reading|ESV Literary Study Bible)<\/h3>)/
  );
  const cols = parts.filter(p => p.trim()).map(p => `<div class="rp-col">${p}</div>`).join('');
  return cols ? `<div class="reading-plans">${cols}</div>` : '';
}

// Mirrors script2_content.py:_parse_reading_plans_html
function parseReadingPlansHtml(html) {
  if (!html?.trim()) return {};
  const LABEL_MAP = {
    'old testament': 'ot', 'new testament': 'nt', 'wisdom': 'wisdom',
    'wisdom literature': 'wisdom', 'narrative': 'narrative',
    'history & prophecy': 'historyProphecy', 'history and prophecy': 'historyProphecy',
    'history': 'historyProphecy',
  };

  const linksFrom = (colHtml) => {
    const matches = [...colHtml.matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    return matches.map(m => ({ url: m[1], ref: m[2].replace(/<[^>]+>/g, '').trim() })).filter(l => l.ref);
  };

  const out = {};
  const colMatches = [...html.matchAll(/<div class="rp-col">([\s\S]*?)<\/div>/g)];
  for (const [, colHtml] of colMatches) {
    const h3M = colHtml.match(/<h3>(.*?)<\/h3>/);
    if (!h3M) continue;
    const title = h3M[1].toLowerCase();

    if (title.includes('connected')) {
      const connected = {};
      for (const [, bLabel, afterB] of colHtml.matchAll(/<b>(.*?)<\/b>([\s\S]*?)(?=<b>|$)/g)) {
        const key = LABEL_MAP[bLabel.toLowerCase().trim()];
        if (!key) continue;
        const ulM = afterB.match(/<ul>([\s\S]*?)<\/ul>/);
        if (ulM) { const links = linksFrom(ulM[1]); if (links.length) connected[key] = links; }
      }
      if (Object.keys(connected).length) out.connected = connected;
    } else if (title.includes('chronological')) {
      const ulM = colHtml.match(/<ul>([\s\S]*?)<\/ul>/);
      if (ulM) { const links = linksFrom(ulM[1]); if (links.length) out.chronological = links; }
    } else if (title.includes('literary') || title.includes('esv')) {
      const literary = {};
      for (const [, bLabel, afterB] of colHtml.matchAll(/<b>(.*?)<\/b>([\s\S]*?)(?=<b>|$)/g)) {
        const key = LABEL_MAP[bLabel.toLowerCase().trim()];
        if (!key) continue;
        const ulM = afterB.match(/<ul>([\s\S]*?)<\/ul>/);
        if (ulM) { const links = linksFrom(ulM[1]); if (links.length) literary[key] = links; }
      }
      if (Object.keys(literary).length) out.literary = literary;
    }
  }
  return out;
}

async function fetchReadingPlans(auth, monday) {
  log('Fetching Reading Plans from Google Calendar...');
  const calendar = google.calendar({ version: 'v3', auth });
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd   = new Date(monday.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  // html: the <div class="reading-plans"> block to append to devotion.content
  // parsed: structured JSON for MDX frontmatter
  const plans = {};

  try {
    const res = await calendar.events.list({
      calendarId: READING_PLANS_CAL_ID,
      timeMin: `${weekStart}T00:00:00+02:00`,
      timeMax: `${weekEnd}T00:00:00+02:00`,
      singleEvents: true,
      orderBy: 'startTime',
    });
    for (const item of res.data.items || []) {
      const date = item.start?.date;
      if (date) {
        const html = buildReadingPlansHtml(item.description || '');
        plans[date] = { html, parsed: parseReadingPlansHtml(html) };
      }
    }
  } catch (e) {
    warn(`Could not fetch reading plans: ${e.message}`);
    return null;
  }

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (!(d in plans)) warn(`  No reading plan found for ${d}`);
    else log(`  Reading plan ✓ ${d}`);
  }
  return plans;
}

// ─── Search ingestion (Voyage AI + Neon pgvector) ────────────────────────────

function _blockRowsFromHtml(html) {
  const root = parseHtml(html);
  const rows = [];
  for (const section of root.querySelectorAll('div.sfc-notes-section')) {
    const label = section.querySelector('.sfc-col-label')?.text.trim().toLowerCase() || '';
    if (label.includes('main points')) {
      for (const li of section.querySelectorAll('ol.sfc-notes-list li'))
        if (li.text.trim()) rows.push({ sectionType: 'main_point', content: li.text.trim() });
    }
  }
  for (const li of root.querySelectorAll('ul.sfc-tags li'))
    if (li.text.trim()) rows.push({ sectionType: 'take_away', content: li.text.trim() });
  for (const li of root.querySelectorAll('ul.sfc-audience li'))
    if (li.text.trim()) rows.push({ sectionType: 'audience_fit', content: li.text.trim() });
  for (const entry of root.querySelectorAll('div.sfc-scripture-entry')) {
    const ref   = entry.querySelector('.sfc-ref')?.text.trim() || '';
    const theme = entry.querySelector('.sfc-theme')?.text.trim() || '';
    if (ref && theme) rows.push({ sectionType: 'related_scripture', content: `${ref} — ${theme}` });
  }
  return rows;
}

function _chunkTranscript(transcript) {
  const text = transcript.trim();
  if (!/(?:^|\n)### /.test(text)) return null;
  const chunks = [];
  for (const part of text.split(/\n(?=### )/).filter(Boolean)) {
    const trimmed = part.trim();
    const tsMatch = trimmed.match(/\[(\d{2}):(\d{2})\]/);
    const startSeconds = tsMatch ? parseInt(tsMatch[1]) * 60 + parseInt(tsMatch[2]) : null;
    const clean = trimmed.replace(/\[\d{2}:\d{2}\]\s*/g, '').trim();
    if (clean.split(/\s+/).length <= MAX_CHUNK_WORDS) {
      chunks.push({ content: clean, startSeconds });
    } else {
      let current = [], count = 0;
      for (const s of clean.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"'])/)) {
        current.push(s);
        count += s.split(/\s+/).length;
        if (count >= MAX_CHUNK_WORDS) {
          chunks.push({ content: current.join(' '), startSeconds });
          current = []; count = 0;
        }
      }
      if (current.length) chunks.push({ content: current.join(' '), startSeconds });
    }
  }
  return chunks;
}

async function ingestToSearch(date, slug, speaker, taxonomy, sermonBlock, transcript) {
  if (!VOYAGE_API_KEY || !DATABASE_URL) {
    warn('Search ingestion skipped — VOYAGE_API_KEY or DATABASE_URL not set');
    return;
  }
  log('Ingesting sermon into search database...');

  const blockRows = _blockRowsFromHtml(sermonBlock);
  const txChunks  = _chunkTranscript(transcript) || [];
  const allTexts  = [...blockRows.map(r => r.content), ...txChunks.map(c => c.content)];
  if (!allTexts.length) { warn('  Nothing to embed — skipping'); return; }

  const { VoyageAIClient } = await import('voyageai');
  const pgMod              = await import('pg');
  const { Pool }           = pgMod.default ?? pgMod;

  const voyage   = new VoyageAIClient({ apiKey: VOYAGE_API_KEY });
  const response = await voyage.embed({ model: 'voyage-context-4', input: allTexts, inputType: 'document' });
  const embeddings = response.data.map(d => d.embedding);

  const pool   = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM sermon_chunks WHERE sermon_date = $1', [date]);
    const webUrl   = `${SITE_URL}/sermons/${date}-${slug}`;
    const audioUrl = `${R2_PUBLIC_URL}/sermons/${date}-${slug}.mp3`;
    for (let i = 0; i < allTexts.length; i++) {
      const isBlock     = i < blockRows.length;
      const sectionType = isBlock ? blockRows[i].sectionType : 'transcript';
      const startSecs   = isBlock ? null : txChunks[i - blockRows.length].startSeconds;
      await client.query(
        `INSERT INTO sermon_chunks
           (sermon_date, sermon_title, speaker, series, category, tags,
            sermon_scripture, section_type, content, embedding,
            audio_url, web_url, start_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11,$12,$13)`,
        [date, taxonomy.title || '', speaker || '', taxonomy.series || '',
         taxonomy.category || [], taxonomy.tags || [],
         taxonomy.sermon_scripture || '',
         sectionType, allTexts[i], `[${embeddings[i].join(',')}]`,
         audioUrl, webUrl, startSecs]
      );
    }
    log(`  Inserted ${allTexts.length} rows (${blockRows.length} block + ${txChunks.length} transcript chunks)`);
  } finally {
    client.release();
    await pool.end();
  }
}

// ─── Session (resume support) ─────────────────────────────────────────────────

function saveSession(data) {
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, 'utf8')); } catch { return null; }
}

function deleteSession() {
  if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!GUI_MODE) console.log('\n─── Family Church Sermon Pipeline ─────────────────────────────────\n');

  // 0. Pull latest from GitHub so TinaCMS changes (image uploads, sermon notes edits) are local
  {
    const r = spawnSync('git', ['pull', '--ff-only'], { cwd: WEBSITE_DIR, encoding: 'utf8' });
    if (r.status === 0) {
      log(`git pull: ${r.stdout.trim() || 'Already up to date.'}`);
    } else {
      warn(`git pull failed — continuing with local files:\n${(r.stderr || r.stdout || '').trim()}`);
    }
  }

  // 1. Read sermon notes
  const notes = readSermonNotes();
  if (!notes.title) {
    if (GUI_MODE) zenityError('Missing Sermon Notes', 'sermon-notes/current.mdx is missing a title.\nPlease fill it in before running the pipeline.');
    else console.error('\nERROR: sermon-notes/current.mdx is missing a title');
    process.exit(1);
  }
  if (!GUI_MODE) {
    console.log(`  Date:    ${notes.date}`);
    console.log(`  Title:   ${notes.title}`);
    console.log(`  Speaker: ${notes.speaker || '(not set)'}`);
    console.log(`  Series:  ${notes.series  || '(none)'}\n`);
  }

  // Session check — offer resume if a previous run exists for this date
  let session = loadSession();
  let resumeFrom = null;
  if (session?.notes?.date === notes.date) {
    const msg = `Found a saved session for ${notes.date} (last step: ${session.step}).`;
    const doResume = GUI_MODE
      ? zenityQuestion('Resume Session', `${msg}\nResume from where it left off?`)
      : (await ask(`\n  ${msg}\n  Resume? [Y/n]: `)).trim().toLowerCase() !== 'n';
    if (doResume) {
      resumeFrom = session.step;
      if (session.notes?.image) notes.image = session.notes.image;
      log(`[RESUME] Resuming from after "${resumeFrom}" step`);
    } else {
      deleteSession();
      session = { step: 'start', notes: { ...notes } };
      saveSession(session);
    }
  } else {
    if (session) warn(`Discarding stale session for ${session.notes?.date || 'unknown'}`);
    session = { step: 'start', notes: { ...notes } };
    saveSession(session);
  }
  const STEPS = ['start', 'download', 'transcript', 'taxonomy', 'sermonBlock', 'slug', 'devotions', 'readingPlans', 'r2'];
  const canSkip = name => resumeFrom != null && STEPS.indexOf(resumeFrom) >= STEPS.indexOf(name);

  // 1b. Record the source image path — normalisation happens after the slug is
  //     generated in step 7 so the filename includes the full scripture reference.
  let imageData = null;
  let imageMimeType = null;
  const imageSrcPath = notes.image
    ? join(WEBSITE_DIR, 'public', notes.image.replace(/^\//, ''))
    : null;

  if (!notes.image) {
    // No image set — ask before continuing
    const msg = 'No image set in sermon-notes/current.mdx.\nThe sermon will publish without an image.\nContinue anyway?';
    const proceed = GUI_MODE
      ? zenityQuestion('No Image Set', msg)
      : (await ask('\n  ⚠ No image set. Continue without one? [y/N]: ')).trim().toLowerCase() === 'y';
    if (!proceed) {
      if (GUI_MODE) zenityInfo('Cancelled', 'Add the image to sermon-notes/current.mdx, then run again.');
      else console.log('\n  Add the image to sermon-notes/current.mdx, then run again.\n');
      process.exit(0);
    }
  } else if (!existsSync(imageSrcPath)) {
    // Image path set but file not on disk — hard stop
    const msg = `Image file not found on disk:\n  ${imageSrcPath}\n\nCheck the path in sermon-notes/current.mdx and make sure the file exists locally.\n\nContinue WITHOUT the image?`;
    const proceed = GUI_MODE
      ? zenityQuestion('Image File Missing', msg)
      : (await ask(`\n  ✘ Image file not found: ${imageSrcPath}\n  Continue without it? [y/N]: `)).trim().toLowerCase() === 'y';
    if (!proceed) {
      if (GUI_MODE) zenityInfo('Cancelled', 'Fix the image path or add the file, then run again.');
      else console.log('\n  Fix the image path or add the file, then run again.\n');
      process.exit(0);
    }
    warn('Continuing without image — sermon will publish without one.');
  }

  // 2 + 3. Select Vimeo video + download + convert (skippable if MP3 is on disk)
  const mp3Path = join(AUDIO_DIR, `${notes.date}.mp3`);
  let vimeoUrl;

  if (canSkip('download') && existsSync(mp3Path) && session.vimeoUrl) {
    log(`[RESUME] Skipping download — MP3 already on disk: ${basename(mp3Path)}`);
    vimeoUrl = session.vimeoUrl;
  } else {
    if (!VIMEO_TOKEN) {
      if (GUI_MODE) zenityError('Configuration Error', 'VIMEO_TOKEN is not set.');
      else console.error('VIMEO_TOKEN not set');
      process.exit(1);
    }
    const videos = await fetchVimeoVideos();
    if (!videos.length) {
      if (GUI_MODE) zenityError('No Videos Found', 'No Vimeo videos found.');
      else console.error('No Vimeo videos found');
      process.exit(1);
    }

    let video;
    if (GUI_MODE) {
      const items = videos.map(v => `${v.name}  (${new Date(v.created_time).toLocaleDateString('en-ZA')})  ${v.status}`);
      const selected = zenityList(`Select video for: ${notes.title} — ${notes.date}`, items);
      const idx = items.indexOf(selected);
      if (idx === -1) process.exit(0);
      video = videos[idx];
    } else {
      console.log('Recent Vimeo videos:');
      videos.forEach((v, i) => {
        const date = new Date(v.created_time).toLocaleDateString('en-ZA');
        console.log(`  [${i + 1}] ${v.name}  (${date})  ${v.status}`);
      });
      console.log('');
      const choice = await ask(`Select video [1–${videos.length}] or press Enter for [1]: `);
      const idx    = choice.trim() ? parseInt(choice.trim()) - 1 : 0;
      if (isNaN(idx) || idx < 0 || idx >= videos.length) { console.error('Invalid selection'); process.exit(1); }
      video = videos[idx];
      console.log(`\nSelected: ${video.name}\n`);
    }

    vimeoUrl = getVimeoEmbedUrl(video);
    startProgress(`Downloading: ${video.name}`);

    const videoPath = join(AUDIO_DIR, `${notes.date}.mp4`);
    await downloadVideo(getSmallestDownload(video).link, videoPath);
    convertToMp3(videoPath, mp3Path);
    unlinkSync(videoPath);
    log('  Video file removed');

    session = { ...session, step: 'download', vimeoUrl };
    saveSession(session);
  }

  // 4. Transcribe + clean
  let rawTranscript, transcript, durationMins;
  if (canSkip('transcript') && session.transcript) {
    log('[RESUME] Using saved transcript');
    ({ rawTranscript, transcript, durationMins } = session);
  } else {
    startProgress('Transcribing…');
    ({ transcript: rawTranscript, durationMins } = await transcribeAudio(mp3Path));
    transcript = cleanTranscript(rawTranscript);
    session = { ...session, step: 'transcript', rawTranscript, transcript, durationMins };
    saveSession(session);
  }

  // 5. Taxonomy
  let taxonomy;
  if (canSkip('taxonomy') && session.taxonomy) {
    log('[RESUME] Using saved taxonomy');
    taxonomy = session.taxonomy;
  } else {
    startProgress('Generating taxonomy…');
    const pendingUrl = `${SITE_URL}/sermons/${notes.date}-pending`;
    taxonomy = generateTaxonomy(notes, transcript, pendingUrl);
    session = { ...session, step: 'taxonomy', taxonomy };
    saveSession(session);
  }
  if (taxonomy.review) console.log(`\n  ⚠  Taxonomy needs review: ${taxonomy.review_notes}\n`);

  // 6. Sermon block
  let sermonBlock;
  if (canSkip('sermonBlock') && session.sermonBlock) {
    log('[RESUME] Using saved sermon block');
    sermonBlock = session.sermonBlock;
  } else {
    startProgress('Generating sermon block…');
    sermonBlock = generateSermonBlock(notes, transcript, taxonomy);
    session = { ...session, step: 'sermonBlock', sermonBlock };
    saveSession(session);
  }

  // 7. SEO slug + title
  let slug, optimisedTitle;
  if (canSkip('slug') && session.slug) {
    log('[RESUME] Using saved slug');
    ({ slug, optimisedTitle } = session);
  } else {
    startProgress('Generating SEO slug…');
    ({ title: optimisedTitle, slug } = generateSeoSlug(notes, taxonomy, sermonBlock));
    session = { ...session, step: 'slug', slug, optimisedTitle };
    saveSession(session);
  }
  console.log(`\n  Slug:  ${slug}`);
  console.log(`  Title: ${optimisedTitle}\n`);

  // Update taxonomy URL now that we have the real slug
  taxonomy.url = `${SITE_URL}/sermons/${notes.date}-${slug}`;

  // 7b. Normalise image now that we have the full slug (title + scripture reference).
  //     Canonical name: YYYY-MM-DD-{slug}.webp in /images/sermons/
  const sourceImagePath = notes.image || null; // preserve original path before normalisation
  if (notes.image && imageSrcPath && existsSync(imageSrcPath)) {
    const canonicalRelative = `/images/sermons/${notes.date}-${slug}.webp`;
    const canonicalPath = join(WEBSITE_DIR, 'public', 'images', 'sermons', `${notes.date}-${slug}.webp`);
    mkdirSync(join(WEBSITE_DIR, 'public', 'images', 'sermons'), { recursive: true });
    if (imageSrcPath !== canonicalPath) {
      log(`Normalising image → ${canonicalRelative}`);
      const r = spawnSync('ffmpeg', ['-y', '-i', imageSrcPath, '-quality', '85', canonicalPath], { encoding: 'utf8' });
      if (r.status === 0) {
        notes.image = canonicalRelative;
        log(`  Saved: ${basename(canonicalPath)} (${(statSync(canonicalPath).size / 1024).toFixed(0)} KB)`);
      } else {
        warn(`Image conversion failed — using original path: ${notes.image}`);
      }
    }
    const finalPath = join(WEBSITE_DIR, 'public', notes.image.replace(/^\//, ''));
    if (existsSync(finalPath)) {
      imageMimeType = 'image/webp';
      imageData = readFileSync(finalPath).toString('base64');
      log(`Image ready for commit: ${(imageData.length * 3 / 4 / 1024).toFixed(0)} KB`);
    }
  }
  // Persist updated notes.image (may have changed to canonical path above)
  session = { ...session, notes: { ...session.notes, image: notes.image } };
  saveSession(session);

  // 8. Devotions
  let devotions;
  if (canSkip('devotions') && session.devotions) {
    log('[RESUME] Using saved devotions');
    devotions = session.devotions;
  } else {
    startProgress('Generating devotions…');
    const imageUrl = notes.image ? `https://familychurch.online${notes.image}` : '';
    devotions = generateDevotions(notes, transcript, slug, imageUrl);
    log(`  ${devotions.length}/7 devotions generated`);
    session = { ...session, step: 'devotions', devotions };
    saveSession(session);
  }

  // 9. Reading plans
  let readingPlans;
  if (canSkip('readingPlans') && 'readingPlans' in session) {
    log('[RESUME] Using saved reading plans');
    readingPlans = session.readingPlans;
  } else {
    const googleAuth = await getGoogleAuth();
    const monday = getNextMonday(notes.date);
    readingPlans = googleAuth ? await fetchReadingPlans(googleAuth, monday) : null;
    if (!readingPlans) warn('Reading plans unavailable — devotions will be committed without them');
    session = { ...session, step: 'readingPlans', readingPlans };
    saveSession(session);
  }

  // 9.5. Append reading plan HTML to each devotion's content
  //      Guard against double-append on resume (devotions already have RP HTML)
  if (readingPlans) {
    for (const dev of devotions) {
      if (!dev.content.includes('reading-plans')) {
        const rp = readingPlans[dev.date];
        if (rp?.html) dev.content = dev.content.trimEnd() + '\n\n' + rp.html;
        else warn(`  No reading plan HTML for devotion ${dev.date}`);
      }
    }
  }

  // 10. Upload audio to R2 temp
  let tempAudioKey;
  if (canSkip('r2') && session.tempAudioKey) {
    log('[RESUME] Using cached R2 temp key');
    tempAudioKey = session.tempAudioKey;
  } else {
    tempAudioKey = await uploadTempAudio(mp3Path, notes.date);
    session = { ...session, step: 'r2', tempAudioKey };
    saveSession(session);
  }

  // 10.5. Upload transcript/taxonomy/sermon-block to Google Drive (local OAuth —
  //       the Worker service account has no Drive storage quota on personal Drive)
  const baseName = `${notes.date}-${slug}`;
  try {
    const googleAuth = await getGoogleAuth();
    await uploadSermonToDrive(googleAuth, baseName, transcript, taxonomy, sermonBlock, {
      optimisedTitle,
      date: notes.date,
      speaker: notes.speaker,
      series: notes.series,
      vimeoUrl,
      durationMinutes: durationMins,
      // audioUrl not yet known (temp key only); Drive file will show a warning comment
    });
  } catch (err) {
    warn(`Drive upload failed (non-fatal): ${err.message}`);
  }

  // 10.6. Ingest into search database
  try {
    await ingestToSearch(notes.date, slug, notes.speaker, taxonomy, sermonBlock, transcript);
  } catch (err) {
    warn(`Search ingestion failed (non-fatal): ${err.message}`);
  }

  // 11. POST to Worker
  const guid = randomUUID();
  const { jobId, reviewUrl } = await postJobToWorker({
    transcript,
    metadata: { title: notes.title, speaker: notes.speaker, series: notes.series, date: notes.date, image: notes.image, vimeoUrl, durationMinutes: durationMins },
    imageData,
    imageMimeType,
    sourceImagePath: (sourceImagePath !== notes.image) ? sourceImagePath : null,
    taxonomy,
    sermonBlock,
    slug,
    optimisedTitle,
    guid,
    devotions,
    readingPlans: readingPlans
      ? Object.fromEntries(Object.entries(readingPlans).map(([d, v]) => [d, v.parsed]))
      : null,
    tempAudioKey,
  });

  deleteSession();
  closeProgress();

  if (GUI_MODE) {
    zenityInfo('Pipeline Complete', `Sermon submitted for review.\n\nReview URL:\n${reviewUrl}\n\nOpen the link, check the content, then click Approve &amp; Publish.`);
  } else {
    console.log('\n─────────────────────────────────────────────────────────────────────');
    console.log(`\n  ✓  Job submitted: ${jobId}`);
    console.log(`\n  Review URL:\n     ${reviewUrl}`);
    console.log('\n  Processing complete. Review the content at the URL above,');
    console.log("  then click 'Approve & Publish' to commit to the website.\n");
    console.log('─────────────────────────────────────────────────────────────────────\n');
  }

  // 12. Optionally prepare next week's sermon notes
  const prepNext = GUI_MODE
    ? zenityQuestion("Next Week's Notes", "Prepare next week's sermon-notes template now?")
    : (await ask("Prepare next week's sermon-notes template? [y/N]: ")).trim().toLowerCase() === 'y';
  if (prepNext) {
    const next = findNextWhatsNext(notes.date);
    if (next) {
      writeFileSync(SERMON_NOTES, buildNextSermonNotesMdx(next));
      if (GUI_MODE) {
        zenityInfo("Next Week Ready", `Notes updated for ${next.date}:\n${next.title || '(no title yet)'}\n\nRemember to add the sermon image before Sunday.`);
      } else {
        console.log(`\n  ✓  current.mdx updated for ${next.date}: ${next.title || '(no title yet)'}`);
        console.log('     Add the sermon image before Sunday.\n');
      }
    } else {
      warn('No whats-next entry found after ' + notes.date + ' — create one in the CMS first');
      if (GUI_MODE) zenityError("No Next Entry", `No whats-next entry found after ${notes.date}.\nCreate one in the CMS first.`);
    }
  }

  if (rl) rl.close();
}

main().catch(err => {
  closeProgress();
  if (GUI_MODE) zenityError('Pipeline Failed', err.message);
  console.error('\nFatal error:', err.message);
  if (rl) rl.close();
  process.exit(1);
});
