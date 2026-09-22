#!/usr/bin/env node
/**
 * Family Church Online — Sermon Pipeline (Phase 1)
 *
 * Run by AV crew after Sunday's sermon. Takes ~15 minutes:
 *   1. Read sermon identity from TinaCMS sermon-notes (current.mdx)
 *   2. Select and download the Vimeo recording
 *   3. Convert to MP3 with ffmpeg
 *   4. Transcribe with Deepgram, clean with Claude Haiku
 *   5. Upload MP3 to temp R2 location
 *   6. POST job to Cloudflare Worker — prints review URL and exits
 *
 * All remaining AI processing (taxonomy, sermon block, devotions, embeddings)
 * runs autonomously in Cloudflare Workflows. The reviewer visits the printed
 * URL to inspect content and approve publication.
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

import { spawnSync }                          from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, basename }             from 'node:path';
import { fileURLToPath }                       from 'node:url';
import { createInterface }                     from 'node:readline';

import matter                                  from 'gray-matter';
import { createClient as createDeepgram }      from '@deepgram/sdk';
import { S3Client, PutObjectCommand }          from '@aws-sdk/client-s3';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = dirname(__filename);
const PIPELINE_DIR = __dirname;
const WEBSITE_DIR  = dirname(__dirname);
const PROMPTS_DIR  = join(PIPELINE_DIR, 'prompts');
const AUDIO_DIR    = join(PIPELINE_DIR, 'audio');
const SERMON_NOTES = join(WEBSITE_DIR, 'src', 'content', 'sermon-notes', 'current.mdx');
const WHATS_NEXT_DIR = join(WEBSITE_DIR, 'src', 'content', 'whats-next');

for (const d of [AUDIO_DIR]) mkdirSync(d, { recursive: true });

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

// ─── Readline helper ──────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  INFO      ${msg}`);
}
function warn(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  WARNING   ${msg}`);
}

// ─── Sermon Notes reader ──────────────────────────────────────────────────────

function readSermonNotes() {
  if (!existsSync(SERMON_NOTES)) {
    console.error(`Sermon notes not found: ${SERMON_NOTES}`);
    process.exit(1);
  }
  const raw = readFileSync(SERMON_NOTES, 'utf8');
  const { data } = matter(raw);
  // Extract date as a string from raw YAML to avoid UTC conversion bugs.
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
    .filter(f => /^\d{4}-\d{2}-\d{2}\.mdx$/.test(f))
    .sort();
  for (const file of files) {
    const fileDate = file.slice(0, 10);
    if (fileDate <= afterDate) continue;
    const raw = readFileSync(join(WHATS_NEXT_DIR, file), 'utf8');
    const { data } = matter(raw);
    const dateMatch = raw.match(/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m);
    const date = dateMatch ? dateMatch[1] : fileDate;
    return {
      date,
      title:     (data.title    || '').trim(),
      speaker:   (data.speaker  || '').trim(),
      series:    (data.series   || '').trim(),
      scripture: (data.scripture || '').trim(),
    };
  }
  return null;
}

function buildNextSermonNotesMdx(next) {
  const isoDate = `${next.date}T08:00:00.000+02:00`;
  return [
    '---',
    `title: "${(next.title || '').replace(/"/g, "'")}"`,
    `date: "${isoDate}"`,
    `speaker: "${next.speaker || ''}"`,
    `scripture: "${next.scripture || ''}"`,
    `series: "${next.series || ''}"`,
    'image: ""',
    '---',
    '',
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

  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  log(`  ${wordCount.toLocaleString()} words — ${durationMins} min`);
  return { transcript, durationMins };
}

function cleanTranscript(rawTranscript) {
  const promptFile = join(PROMPTS_DIR, 'structure.txt');
  if (!existsSync(promptFile)) { warn('structure.txt not found — skipping clean'); return rawTranscript; }
  const prompt = readFileSync(promptFile, 'utf8');
  log('Cleaning transcript with Claude Haiku...');
  const result = spawnSync('claude', [
    '-p', `${prompt}\n\n---\n\nRAW TRANSCRIPT:\n\n${rawTranscript}`,
    '--model', 'claude-haiku-4-5-20251001',
    '--output-format', 'stream-json',
    '--verbose',
    '--disallowed-tools', 'Bash,Edit,Write,Read,WebFetch,WebSearch,NotebookEdit,Task',
  ], { timeout: 300_000, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' });

  if (result.status !== 0) {
    warn(`claude -p failed — using raw transcript\n${result.stderr || ''}`);
    return rawTranscript;
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
  log(`  Cleaned: ${output.split(/\s+/).filter(Boolean).length.toLocaleString()} words`);
  return output;
}

// ─── R2 upload (temp location) ────────────────────────────────────────────────

async function uploadTempAudio(mp3Path, date) {
  const missing = [['R2_ENDPOINT',R2_ENDPOINT],['R2_ACCESS_KEY_ID',R2_ACCESS_KEY_ID],['R2_SECRET_ACCESS_KEY',R2_SECRET]].filter(([,v])=>!v).map(([k])=>k);
  if (missing.length) throw new Error(`R2 credentials not set: ${missing.join(', ')}`);

  const key       = `temp/${date}.mp3`;
  const publicUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  const bytes     = statSync(mp3Path).size;
  log(`  Uploading temp audio to R2: ${key} (${(bytes/1048576).toFixed(1)} MB)...`);

  const s3 = new S3Client({
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET },
    region: 'auto',
  });
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: readFileSync(mp3Path),
    ContentType: 'audio/mpeg',
  }));
  log(`  Uploaded: ${publicUrl}`);
  return { key, publicUrl, bytes };
}

// ─── Worker POST ──────────────────────────────────────────────────────────────

async function postJobToWorker(metadata, transcript, tempAudioKey) {
  if (!PIPELINE_SECRET) throw new Error('SERMON_PIPELINE_SECRET not set');
  const workerUrl = `${SITE_URL}/api/sermon/jobs`;
  log(`Posting job to ${workerUrl}...`);
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PIPELINE_SECRET}`,
    },
    body: JSON.stringify({ transcript, metadata, tempAudioKey }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Worker POST failed: ${res.status} — ${text}`);
  }
  return await res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n─── Family Church Sermon Pipeline (Phase 1) ───────────────────────\n');

  // 1. Read sermon notes
  const notes = readSermonNotes();
  console.log(`  Date:    ${notes.date}`);
  console.log(`  Title:   ${notes.title || '(not set)'}`);
  console.log(`  Speaker: ${notes.speaker || '(not set)'}`);
  console.log(`  Series:  ${notes.series  || '(none)'}`);
  if (!notes.title) { console.error('\nERROR: sermon-notes/current.mdx is missing a title'); process.exit(1); }
  console.log('');

  // 2. Select Vimeo video
  if (!VIMEO_TOKEN) { console.error('VIMEO_TOKEN not set'); process.exit(1); }
  const videos = await fetchVimeoVideos();
  if (!videos.length) { console.error('No Vimeo videos found'); process.exit(1); }

  console.log('Recent Vimeo videos:');
  videos.forEach((v, i) => {
    const date = new Date(v.created_time).toLocaleDateString('en-ZA');
    console.log(`  [${i + 1}] ${v.name}  (${date})  ${v.status}`);
  });
  console.log('');

  const choice = await ask(`Select video [1–${videos.length}] or press Enter for [1]: `);
  const idx    = choice.trim() ? parseInt(choice.trim()) - 1 : 0;
  if (isNaN(idx) || idx < 0 || idx >= videos.length) {
    console.error('Invalid selection'); process.exit(1);
  }
  const video    = videos[idx];
  const vimeoUrl = getVimeoEmbedUrl(video);
  console.log(`\nSelected: ${video.name}`);

  const download = getSmallestDownload(video);
  const videoPath = join(AUDIO_DIR, `${notes.date}.mp4`);
  const mp3Path   = join(AUDIO_DIR, `${notes.date}.mp3`);

  // 3. Download and convert
  await downloadVideo(download.link, videoPath);
  convertToMp3(videoPath, mp3Path);

  // 4. Transcribe + clean
  const { transcript: raw, durationMins } = await transcribeAudio(mp3Path);
  const transcript = cleanTranscript(raw);

  // 5. Upload to R2 temp
  const { key: tempAudioKey } = await uploadTempAudio(mp3Path, notes.date);

  // 6. POST to Worker
  const metadata = {
    title:           notes.title,
    speaker:         notes.speaker,
    series:          notes.series,
    date:            notes.date,
    image:           notes.image,
    vimeoUrl,
    durationMinutes: durationMins,
  };

  const { jobId, reviewUrl } = await postJobToWorker(metadata, transcript, tempAudioKey);

  // 7. Print result
  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log(`\n  ✓  Job submitted: ${jobId}`);
  console.log(`\n  Review URL:\n     ${reviewUrl}`);
  console.log('\n  Processing in the cloud — you can pack up now.');
  console.log('  You\'ll receive an email when the sermon is ready for review.\n');
  console.log('─────────────────────────────────────────────────────────────────────\n');

  // 8. Optionally prepare next week's sermon notes template
  const prepNext = await ask('Prepare next week\'s sermon-notes template? [y/N]: ');
  if (prepNext.trim().toLowerCase() === 'y') {
    const next = findNextWhatsNext(notes.date);
    if (next) {
      writeFileSync(SERMON_NOTES, buildNextSermonNotesMdx(next));
      console.log(`\n  ✓  current.mdx updated for ${next.date}: ${next.title || '(no title yet)'}`);
      console.log('     Don\'t forget to add the sermon image before Sunday.\n');
    } else {
      warn('No whats-next entry found after ' + notes.date + ' — create one in the CMS first');
    }
  }

  rl.close();
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  rl.close();
  process.exit(1);
});
