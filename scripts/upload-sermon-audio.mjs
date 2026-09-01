/**
 * Upload re-encoded sermon audio to Cloudflare R2 and update MDX audioUrl fields.
 *
 * Reads from:   scripts/audio-encoded/{slug}.mp3
 * Uploads to:   R2 bucket at key sermons/{slug}.mp3
 * Public URL:   https://audio.familychurch.online/sermons/{slug}.mp3
 * Updates:      src/content/sermons/{slug}.mdx  audioUrl: field
 *
 * Requires in .env:
 *   R2_ENDPOINT            https://{account-id}.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   R2_AUDIO_PUBLIC_URL    https://audio.familychurch.online
 *
 * Usage:
 *   node scripts/upload-sermon-audio.mjs            upload all missing
 *   node scripts/upload-sermon-audio.mjs --latest   upload most recent only
 *   node scripts/upload-sermon-audio.mjs --check    show status without uploading
 *   node scripts/upload-sermon-audio.mjs --force    re-upload all
 */

import { S3Client, PutObjectCommand }   from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync,
         existsSync, statSync,
         readdirSync }                   from 'fs';
import { join, dirname }                 from 'path';
import { fileURLToPath }                 from 'url';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '..');
const ORIGINAL_DIR = join(__dirname, 'audio');
const ENCODED_DIR  = join(__dirname, 'audio-encoded');
const SERMONS_DIR  = join(ROOT, 'src', 'content', 'sermons');
const MANIFEST     = join(__dirname, 'r2-audio-manifest.json');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;

// ─── Env ──────────────────────────────────────────────────────────────────────

try { process.loadEnvFile(join(ROOT, '.env')); } catch {}
try { process.loadEnvFile(join(ROOT, '.env.vars')); } catch {}

function requireEnv() {
  const missing = [
    'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET', 'R2_AUDIO_PUBLIC_URL',
  ].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n${cross} Missing env vars: ${missing.join(', ')}`);
    console.error('Add them to .env — see the header of this file.\n');
    process.exit(1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const loadManifest = () =>
  existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf-8')) : {};

const saveManifest = m =>
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n', 'utf-8');

/** Pick the smaller of the original and re-encoded file. Returns { path, source }. */
function bestAudio(slug) {
  const original = join(ORIGINAL_DIR, `${slug}.mp3`);
  const encoded  = join(ENCODED_DIR,  `${slug}.mp3`);
  const hasOrig  = existsSync(original);
  const hasEnc   = existsSync(encoded);

  if (hasOrig && hasEnc) {
    const origSize = statSync(original).size;
    const encSize  = statSync(encoded).size;
    return encSize <= origSize
      ? { path: encoded, source: 'encoded' }
      : { path: original, source: 'original' };
  }
  if (hasEnc)  return { path: encoded,  source: 'encoded'  };
  if (hasOrig) return { path: original, source: 'original' };
  return null;
}

/** List all slugs that have at least one audio file, newest first. */
function listSlugs() {
  const all = new Set([
    ...(existsSync(ENCODED_DIR)  ? readdirSync(ENCODED_DIR)  : []),
    ...(existsSync(ORIGINAL_DIR) ? readdirSync(ORIGINAL_DIR) : []),
  ].filter(f => f.endsWith('.mp3')).map(f => f.replace(/\.mp3$/, '')));
  return [...all].sort((a, b) => b.localeCompare(a));
}

/** Find the MDX file for a slug (handles slugs with or without date prefix). */
function findMdx(slug) {
  const direct = join(SERMONS_DIR, `${slug}.mdx`);
  if (existsSync(direct)) return direct;
  // Slug from audio-encoded might just be the slug part — scan for matching date-slug file
  const match = readdirSync(SERMONS_DIR).find(f => f.endsWith(`-${slug}.mdx`) || f === `${slug}.mdx`);
  return match ? join(SERMONS_DIR, match) : null;
}

async function uploadToR2(s3, localPath, slug) {
  const key  = `sermons/${slug}.mp3`;
  const body = readFileSync(localPath);

  await s3.send(new PutObjectCommand({
    Bucket:       process.env.R2_BUCKET,
    Key:          key,
    Body:         body,
    ContentType:  'audio/mpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const base = process.env.R2_AUDIO_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/${key}`;
}

function updateMdxAudio(mdxPath, publicUrl) {
  const text    = readFileSync(mdxPath, 'utf-8');
  const updated = text.replace(
    /^(audioUrl:\s*)["']?[^'"\n]*["']?(\s*)$/m,
    `$1"${publicUrl}"$2`,
  );
  if (updated === text) {
    // Field missing — shouldn't happen but warn rather than silently skip
    console.warn(`    ${c.yellow}warn${c.reset} audioUrl field not found in ${mdxPath}`);
    return false;
  }
  writeFileSync(mdxPath, updated, 'utf-8');
  return true;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const force  = args.includes('--force');
const check  = args.includes('--check');
const latest = args.includes('--latest');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}upload-sermon-audio${c.reset} — upload re-encoded MP3s to R2 and update MDX

  ${c.cyan}(no args)${c.reset}   upload all missing
  ${c.cyan}--latest${c.reset}    upload most recent only
  ${c.cyan}--check${c.reset}     show status without uploading
  ${c.cyan}--force${c.reset}     re-upload all

Input:   scripts/audio-encoded/{slug}.mp3
Uploads: R2 → sermons/{slug}.mp3
Updates: src/content/sermons/{slug}.mdx  audioUrl field
`);
  process.exit(0);
}

const manifest = loadManifest();
let   slugs    = listSlugs();

if (slugs.length === 0) {
  console.error(`\n${cross} No audio files found in scripts/audio/ or scripts/audio-encoded/.\n`);
  process.exit(1);
}

if (latest) slugs = slugs.slice(0, 1);

console.log(`\n${c.bold}Sermon Audio Upload → R2${c.reset}`);
console.log('═'.repeat(60));
console.log(`${c.dim}${slugs.length} audio files found${c.reset}\n`);

if (check) {
  let done = 0, pending = 0;
  for (const slug of slugs) {
    if (manifest[slug]) {
      console.log(`${tick} ${c.dim}uploaded${c.reset}  ${slug}`);
      done++;
    } else {
      console.log(`${cross} ${c.yellow}pending${c.reset}   ${slug}`);
      pending++;
    }
  }
  console.log('─'.repeat(60));
  console.log(`Uploaded: ${done}   Pending: ${pending}`);
  if (pending > 0) console.log(`\nRun ${c.cyan}node scripts/upload-sermon-audio.mjs${c.reset} to upload.\n`);
  process.exit(0);
}

requireEnv();

const s3 = new S3Client({
  region:   'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

let ok = 0, skipped = 0, failed = 0;

for (const slug of slugs) {
  if (!force && manifest[slug]) {
    skipped++;
    continue;
  }

  const mdxPath = findMdx(slug);
  if (!mdxPath) {
    console.log(`${cross} ${c.yellow}no MDX${c.reset}    ${slug}`);
    failed++;
    continue;
  }

  const best = bestAudio(slug);
  if (!best) {
    console.log(`${cross} ${c.yellow}no file${c.reset}   ${slug}`);
    failed++;
    continue;
  }

  console.log(`  ${slug} ${c.dim}(${best.source})${c.reset}`);

  // 1. Upload to R2
  process.stdout.write(`    ${c.dim}↑ uploading …${c.reset} `);
  let publicUrl;
  try {
    publicUrl = await uploadToR2(s3, best.path, slug);
    process.stdout.write(`${tick}\n`);
  } catch (err) {
    process.stdout.write(`${cross}\n`);
    console.error(`    ${c.red}${err.message}${c.reset}`);
    failed++;
    continue;
  }

  // 2. Update MDX
  process.stdout.write(`    ${c.dim}✎ updating MDX …${c.reset} `);
  try {
    updateMdxAudio(mdxPath, publicUrl);
    process.stdout.write(`${tick}\n`);
  } catch (err) {
    process.stdout.write(`${cross}\n`);
    console.error(`    ${c.red}${err.message}${c.reset}`);
    failed++;
    continue;
  }

  manifest[slug] = { url: publicUrl };
  saveManifest(manifest);
  ok++;
}

console.log('─'.repeat(60));
console.log(`Uploaded: ${ok}   Already done: ${skipped}${failed ? `   Failed: ${failed}` : ''}\n`);
