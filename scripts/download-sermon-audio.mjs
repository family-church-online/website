/**
 * Download sermon audio from Squarespace to scripts/audio/{slug}.mp3
 *
 * Does NOT update MDX files or upload to R2 — download only.
 * Resample the files here before running the R2 upload step.
 *
 * Usage:
 *   node scripts/download-sermon-audio.mjs            download all missing
 *   node scripts/download-sermon-audio.mjs --latest   download most recent only
 *   node scripts/download-sermon-audio.mjs --check    show status without downloading
 *   node scripts/download-sermon-audio.mjs --force    re-download all
 */

import { readFileSync, writeFileSync, existsSync,
         mkdirSync, readdirSync, createWriteStream } from 'fs';
import { join, dirname }                             from 'path';
import { fileURLToPath }                             from 'url';
import { pipeline }                                  from 'stream/promises';
import { Readable }                                  from 'stream';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const SERMONS_DIR = join(ROOT, 'src', 'content', 'sermons');
const AUDIO_DIR   = join(__dirname, 'audio');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;

/** List all sermon MDX files with a Squarespace audioUrl, newest first. */
function listSermons() {
  return readdirSync(SERMONS_DIR)
    .filter(f => f.endsWith('.mdx'))
    .map(f => {
      const slug    = f.replace(/\.mdx$/, '');
      const text    = readFileSync(join(SERMONS_DIR, f), 'utf-8');
      const m       = text.match(/^audioUrl:\s*["'](https?:\/\/[^"']*squarespace[^"']+)["']\s*$/m);
      return { slug, audioUrl: m?.[1] ?? null };
    })
    .filter(s => s.audioUrl)
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

function localPath(slug) {
  return join(AUDIO_DIR, `${slug}.mp3`);
}

async function downloadAudio(audioUrl, slug) {
  const dest = localPath(slug);
  const res  = await fetch(audioUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = parseInt(res.headers.get('content-length') ?? '0', 10);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const mb = (existsSync(dest) ? readFileSync(dest).length : 0) / 1_048_576;
  return mb;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const force  = args.includes('--force');
const check  = args.includes('--check');
const latest = args.includes('--latest');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}download-sermon-audio${c.reset} — download Squarespace sermon audio to scripts/audio/

  ${c.cyan}(no args)${c.reset}   download all missing
  ${c.cyan}--latest${c.reset}    download most recent sermon only
  ${c.cyan}--check${c.reset}     show status without downloading
  ${c.cyan}--force${c.reset}     re-download all

Files are saved as scripts/audio/{slug}.mp3
MDX files are not updated — resample then run the R2 upload step separately.
`);
  process.exit(0);
}

mkdirSync(AUDIO_DIR, { recursive: true });

let sermons = listSermons();
if (latest) sermons = sermons.slice(0, 1);

console.log(`\n${c.bold}Sermon Audio Download${c.reset}`);
console.log('═'.repeat(60));
console.log(`${c.dim}${sermons.length} sermons with Squarespace audio URLs${c.reset}\n`);

let ok = 0, skipped = 0, failed = 0;

for (const { slug, audioUrl } of sermons) {
  const cached = !force && existsSync(localPath(slug));

  if (cached) {
    if (check) {
      const mb = readFileSync(localPath(slug)).length / 1_048_576;
      console.log(`${tick} ${c.dim}cached${c.reset}   ${slug} ${c.dim}(${mb.toFixed(1)} MB)${c.reset}`);
    }
    skipped++;
    continue;
  }

  if (check) {
    console.log(`${cross} ${c.yellow}missing${c.reset}  ${slug}`);
    failed++;
    continue;
  }

  process.stdout.write(`  ${c.dim}↓${c.reset} ${slug} … `);
  try {
    const mb = await downloadAudio(audioUrl, slug);
    process.stdout.write(`${tick} ${c.dim}(${mb.toFixed(1)} MB)${c.reset}\n`);
    ok++;
  } catch (err) {
    process.stdout.write(`${cross}\n`);
    console.error(`    ${c.red}${err.message}${c.reset}`);
    failed++;
  }
}

console.log('─'.repeat(60));
if (check) {
  console.log(`Cached: ${skipped}   Missing: ${failed}`);
  if (failed > 0) console.log(`\nRun ${c.cyan}node scripts/download-sermon-audio.mjs${c.reset} to download.\n`);
} else {
  console.log(`Downloaded: ${ok}   Already cached: ${skipped}${failed ? `   Failed: ${failed}` : ''}\n`);
}
