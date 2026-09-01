/**
 * Re-encode sermon audio to 16kHz / 48kbps mono MP3.
 *
 * Reads from:  scripts/audio/{slug}.mp3
 * Writes to:   scripts/audio-encoded/{slug}.mp3
 *
 * Requires ffmpeg to be installed and on PATH.
 *
 * Usage:
 *   node scripts/reencode-audio.mjs            encode all missing
 *   node scripts/reencode-audio.mjs --latest   encode most recent only
 *   node scripts/reencode-audio.mjs --check    show status without encoding
 *   node scripts/reencode-audio.mjs --force    re-encode all
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname }                                from 'path';
import { fileURLToPath }                                from 'url';
import { execFile }                                     from 'child_process';
import { promisify }                                    from 'util';

const execFileAsync = promisify(execFile);

const __dirname     = dirname(fileURLToPath(import.meta.url));
const IN_DIR        = join(__dirname, 'audio');
const OUT_DIR       = join(__dirname, 'audio-encoded');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;

function mb(filePath) {
  return (statSync(filePath).size / 1_048_576).toFixed(1);
}

async function checkFfmpeg() {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    console.error(`\n${cross} ffmpeg not found — install it first:\n  sudo apt install ffmpeg\n  brew install ffmpeg\n`);
    process.exit(1);
  }
}

function listSourceFiles() {
  if (!existsSync(IN_DIR)) return [];
  return readdirSync(IN_DIR)
    .filter(f => f.endsWith('.mp3'))
    .map(f => f.replace(/\.mp3$/, ''))
    .sort((a, b) => b.localeCompare(a));
}

async function encode(slug) {
  const inPath  = join(IN_DIR,  `${slug}.mp3`);
  const outPath = join(OUT_DIR, `${slug}.mp3`);
  await execFileAsync('ffmpeg', [
    '-i', inPath,
    '-ar', '16000',   // 16 kHz sample rate
    '-b:a', '48k',    // 48 kbps bitrate
    '-ac', '1',       // mono
    '-y',             // overwrite without asking
    outPath,
  ]);
  return outPath;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const force  = args.includes('--force');
const check  = args.includes('--check');
const latest = args.includes('--latest');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}reencode-audio${c.reset} — re-encode sermon MP3s to 16kHz / 48kbps mono

  ${c.cyan}(no args)${c.reset}   encode all missing
  ${c.cyan}--latest${c.reset}    encode most recent only
  ${c.cyan}--check${c.reset}     show status without encoding
  ${c.cyan}--force${c.reset}     re-encode all

Input:  scripts/audio/{slug}.mp3
Output: scripts/audio-encoded/{slug}.mp3
`);
  process.exit(0);
}

if (!check) await checkFfmpeg();

mkdirSync(OUT_DIR, { recursive: true });

let slugs = listSourceFiles();

if (slugs.length === 0) {
  console.log(`\n${cross} No files found in scripts/audio/ — run sermons:audio:download first.\n`);
  process.exit(1);
}

if (latest) slugs = slugs.slice(0, 1);

console.log(`\n${c.bold}Audio Re-encode${c.reset} ${c.dim}(16kHz / 48kbps mono)${c.reset}`);
console.log('═'.repeat(60));
console.log(`${c.dim}${slugs.length} source files found${c.reset}\n`);

let ok = 0, skipped = 0, failed = 0;

for (const slug of slugs) {
  const outPath = join(OUT_DIR, `${slug}.mp3`);
  const inPath  = join(IN_DIR,  `${slug}.mp3`);

  if (!force && existsSync(outPath)) {
    if (check) {
      console.log(`${tick} ${c.dim}done${c.reset}     ${slug} ${c.dim}(${mb(outPath)} MB)${c.reset}`);
    }
    skipped++;
    continue;
  }

  if (check) {
    const sizeMb = existsSync(inPath) ? `${mb(inPath)} MB source` : 'source missing';
    console.log(`${cross} ${c.yellow}pending${c.reset}  ${slug} ${c.dim}(${sizeMb})${c.reset}`);
    failed++;
    continue;
  }

  const sizeBefore = existsSync(inPath) ? mb(inPath) : '?';
  process.stdout.write(`  ${slug} ${c.dim}(${sizeBefore} MB)${c.reset} … `);
  try {
    await encode(slug);
    const sizeAfter = mb(outPath);
    process.stdout.write(`${tick} ${c.dim}→ ${sizeAfter} MB${c.reset}\n`);
    ok++;
  } catch (err) {
    process.stdout.write(`${cross}\n`);
    console.error(`    ${c.red}${err.message}${c.reset}`);
    failed++;
  }
}

console.log('─'.repeat(60));
if (check) {
  console.log(`Done: ${skipped}   Pending: ${failed}`);
  if (failed > 0) console.log(`\nRun ${c.cyan}node scripts/reencode-audio.mjs${c.reset} to encode.\n`);
} else {
  console.log(`Encoded: ${ok}   Already done: ${skipped}${failed ? `   Failed: ${failed}` : ''}\n`);
}
