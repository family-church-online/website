/**
 * Download sermon images from Squarespace to public/images/sermons/{slug}.{ext}
 *
 * Run before import-sermons.mjs so the local paths are available.
 *
 * Usage:
 *   node scripts/download-images.mjs            download all missing
 *   node scripts/download-images.mjs --latest   download most recent only
 *   node scripts/download-images.mjs --check    show status without downloading
 *   node scripts/download-images.mjs --force    re-download all
 */

import { readFileSync, writeFileSync, existsSync,
         mkdirSync, readdirSync, createWriteStream } from 'fs';
import { join, dirname }                             from 'path';
import { fileURLToPath }                             from 'url';
import { pipeline }                                  from 'stream/promises';
import { Readable }                                  from 'stream';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '..');
const ENRICHED_DIR = join(__dirname, 'drive', 'enriched');
const OUT_DIR      = join(ROOT, 'public', 'images', 'sermons');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;

const EXT_MAP = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg',
  'image/png':  '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};

function extractImageUrl(mdText) {
  const m = mdText.match(/^image_url:\s*"?([^"\n]+)"?\s*$/m);
  return m ? m[1].trim() : null;
}

function listEnrichedSermons() {
  if (!existsSync(ENRICHED_DIR)) return [];
  return readdirSync(ENRICHED_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const slug     = f.replace(/\.md$/, '');
      const imageUrl = extractImageUrl(readFileSync(join(ENRICHED_DIR, f), 'utf-8'));
      return { slug, imageUrl };
    })
    .filter(s => s.imageUrl)
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

function localPath(slug, ext) {
  return join(OUT_DIR, `${slug}${ext}`);
}

function alreadyDownloaded(slug) {
  return ['.jpg', '.png', '.webp', '.gif'].some(ext => existsSync(localPath(slug, ext)));
}

async function downloadImage(imageUrl, slug) {
  const res = await fetch(imageUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct  = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const ext = EXT_MAP[ct] ?? '.jpg';
  const dest = localPath(slug, ext);

  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return ext;
}

const args   = process.argv.slice(2);
const force  = args.includes('--force');
const check  = args.includes('--check');
const latest = args.includes('--latest');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}download-images${c.reset} — download sermon images to public/images/sermons/

  ${c.cyan}(no args)${c.reset}   download all missing
  ${c.cyan}--latest${c.reset}    download most recent sermon only
  ${c.cyan}--check${c.reset}     show status without downloading
  ${c.cyan}--force${c.reset}     re-download all
`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

let sermons = listEnrichedSermons();
if (latest) sermons = sermons.slice(0, 1);

console.log(`\n${c.bold}Sermon Image Download${c.reset}`);
console.log('═'.repeat(60));

let ok = 0, skipped = 0, failed = 0;

for (const { slug, imageUrl } of sermons) {
  if (!force && alreadyDownloaded(slug)) {
    if (check) console.log(`${tick} ${c.dim}cached${c.reset}   ${slug}`);
    skipped++;
    continue;
  }

  if (check) {
    console.log(`${cross} ${c.red}missing${c.reset}  ${slug}`);
    failed++;
    continue;
  }

  process.stdout.write(`  ${c.dim}↓${c.reset} ${slug} … `);
  try {
    const ext = await downloadImage(imageUrl, slug);
    process.stdout.write(`${tick} (${ext})\n`);
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
} else {
  console.log(`Downloaded: ${ok}   Already cached: ${skipped}${failed ? `   Failed: ${failed}` : ''}\n`);
}
