/**
 * Download sermon audio from Squarespace and upload to Cloudflare R2.
 *
 * Requires these vars in the project .env:
 *   R2_ENDPOINT=https://{account-id}.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID=...
 *   R2_SECRET_ACCESS_KEY=...
 *   R2_BUCKET=sermons
 *   R2_PUBLIC_URL=https://audio.familychurch.online
 *
 * Usage:
 *   node scripts/upload-audio.mjs              upload all missing
 *   node scripts/upload-audio.mjs --latest     upload most recent only
 *   node scripts/upload-audio.mjs --check      show status without uploading
 *   node scripts/upload-audio.mjs --force      re-download and re-upload all
 *
 * Downloads MP3s to scripts/audio/{slug}.mp3 (local cache).
 * Writes/updates scripts/r2-manifest.json with { url, bytes } per slug.
 */

import { S3Client, PutObjectCommand }         from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync,
         existsSync, mkdirSync,
         createWriteStream, readdirSync }     from 'fs';
import { join, dirname }                      from 'path';
import { fileURLToPath }                      from 'url';
import { pipeline }                           from 'stream/promises';
import { Readable }                           from 'stream';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '..');
const AUDIO_DIR    = join(__dirname, 'audio');
const ENRICHED_DIR = join(__dirname, 'drive', 'enriched');
const MANIFEST     = join(__dirname, 'r2-manifest.json');

// ─── Colour helpers ───────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;

// ─── Env ──────────────────────────────────────────────────────────────────────

try { process.loadEnvFile(join(ROOT, '.env')); } catch {}

function requireEnv() {
  const missing = [
    'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL',
  ].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n${cross} Missing env vars: ${missing.join(', ')}`);
    console.error('Add them to .env — see the header of this file for details.\n');
    process.exit(1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const loadManifest = () =>
  existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf-8')) : {};

const saveManifest = (m) =>
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n', 'utf-8');

// Extract audio_url from enriched MD frontmatter without a full parse
function extractAudioUrl(mdText) {
  const m = mdText.match(/^audio_url:\s*"?([^"\n]+)"?\s*$/m);
  return m ? m[1].trim() : null;
}

// List all importable sermons from the enriched cache, newest first
function listEnrichedSermons() {
  if (!existsSync(ENRICHED_DIR)) return [];
  return readdirSync(ENRICHED_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const slug     = f.replace(/\.md$/, '');
      const audioUrl = extractAudioUrl(readFileSync(join(ENRICHED_DIR, f), 'utf-8'));
      return { slug, audioUrl };
    })
    .filter(s => s.audioUrl)
    .sort((a, b) => b.slug.localeCompare(a.slug)); // newest first
}

// Stream-download a URL to a local file path
async function downloadTo(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

// Upload a local file to R2, return { url, bytes }
async function uploadToR2(s3, localPath, key) {
  const body  = readFileSync(localPath);
  const bytes = body.length;
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET,
    Key:         key,
    Body:        body,
    ContentType: 'audio/mpeg',
  }));
  const publicUrl = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
  return { url: `${publicUrl}/${key}`, bytes };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdCheck() {
  const sermons  = listEnrichedSermons();
  const manifest = loadManifest();

  console.log(`\n${c.bold}Audio Upload Status${c.reset}`);
  console.log('═'.repeat(60));

  let uploaded = 0, missing = 0;
  for (const { slug } of sermons) {
    if (manifest[slug]) {
      console.log(`${tick} ${c.dim}uploaded${c.reset}  ${slug}`);
      uploaded++;
    } else {
      console.log(`${cross} ${c.red}missing${c.reset}   ${slug}`);
      missing++;
    }
  }

  console.log('─'.repeat(60));
  console.log(`Sermons: ${sermons.length}   Uploaded: ${uploaded}   Missing: ${missing}`);
  if (missing > 0) {
    console.log(`\nRun ${c.cyan}node scripts/upload-audio.mjs${c.reset} to upload.\n`);
  } else {
    console.log(`\n${tick} All audio is on R2.\n`);
  }
}

async function cmdUpload({ latest = false, force = false } = {}) {
  requireEnv();

  const s3 = new S3Client({
    region:      'auto',
    endpoint:    process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  mkdirSync(AUDIO_DIR, { recursive: true });

  let sermons      = listEnrichedSermons();
  const manifest   = loadManifest();

  if (!force) sermons = sermons.filter(s => !manifest[s.slug]);
  if (latest) sermons = sermons.slice(0, 1);

  if (sermons.length === 0) {
    console.log(`\n${tick} Nothing to upload — all audio is already on R2.\n`);
    return;
  }

  console.log(`\n${c.bold}Uploading ${sermons.length} sermon${sermons.length !== 1 ? 's' : ''}${c.reset}\n`);

  let ok = 0, failed = 0;
  for (const { slug, audioUrl } of sermons) {
    const key       = `${slug}.mp3`;
    const localPath = join(AUDIO_DIR, key);

    console.log(`  ${slug}`);

    // 1. Download locally (skip if already cached)
    if (force || !existsSync(localPath)) {
      process.stdout.write(`    ${c.dim}↓ downloading …${c.reset} `);
      try {
        await downloadTo(audioUrl, localPath);
        process.stdout.write(`${tick}\n`);
      } catch (err) {
        process.stdout.write(`${cross}\n`);
        console.error(`    ${c.red}Download failed:${c.reset} ${err.message}`);
        failed++;
        continue;
      }
    } else {
      process.stdout.write(`    ${c.dim}↓ already cached locally${c.reset}\n`);
    }

    // 2. Upload to R2
    process.stdout.write(`    ${c.dim}↑ uploading to R2 …${c.reset} `);
    try {
      const { url, bytes } = await uploadToR2(s3, localPath, key);
      manifest[slug] = { url, bytes };
      saveManifest(manifest); // write after each success so progress isn't lost on abort
      process.stdout.write(`${tick}\n`);
      ok++;
    } catch (err) {
      process.stdout.write(`${cross}\n`);
      console.error(`    ${c.red}Upload failed:${c.reset} ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${c.bold}Done.${c.reset} ${ok} uploaded${failed ? `, ${failed} failed` : ''}.\n`);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}upload-audio${c.reset} — download sermon MP3s and upload to Cloudflare R2

  ${c.cyan}(no args)${c.reset}    upload all missing
  ${c.cyan}--latest${c.reset}     upload most recent sermon only
  ${c.cyan}--check${c.reset}      show status without uploading
  ${c.cyan}--force${c.reset}      re-download and re-upload all
  ${c.cyan}--help${c.reset}       show this message

Required in .env:
  R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
`);
  process.exit(0);
}

if (args.includes('--check')) {
  cmdCheck();
} else {
  await cmdUpload({
    latest: args.includes('--latest'),
    force:  args.includes('--force'),
  });
}
