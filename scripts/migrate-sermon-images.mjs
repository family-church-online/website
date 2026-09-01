/**
 * Download Squarespace images to public/images/{collection}/ and update
 * the image: field in each MDX file to the local path.
 *
 * Usage:
 *   node scripts/migrate-sermon-images.mjs                        migrate sermons (default)
 *   node scripts/migrate-sermon-images.mjs --collection sermons   migrate sermons
 *   node scripts/migrate-sermon-images.mjs --collection threeminutes
 *   node scripts/migrate-sermon-images.mjs --latest               migrate most recent only
 *   node scripts/migrate-sermon-images.mjs --check                show status without downloading
 *   node scripts/migrate-sermon-images.mjs --force                re-download and re-update all
 */

import { readFileSync, writeFileSync, existsSync,
         mkdirSync, readdirSync, createWriteStream } from 'fs';
import { join, dirname }                             from 'path';
import { fileURLToPath }                             from 'url';
import { pipeline }                                  from 'stream/promises';
import { Readable }                                  from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

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

/** Read all MDX files in a content dir that have a Squarespace image URL. */
function listContent(contentDir) {
  return readdirSync(contentDir)
    .filter(f => f.endsWith('.mdx'))
    .map(f => {
      const slug    = f.replace(/\.mdx$/, '');
      const mdxPath = join(contentDir, f);
      const text    = readFileSync(mdxPath, 'utf-8');
      const m       = text.match(/^image:\s*["'](https?:\/\/[^"']*squarespace[^"']+)["']\s*$/m);
      return { slug, mdxPath, text, imageUrl: m?.[1] ?? null };
    })
    .filter(s => s.imageUrl)
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

function alreadyDownloaded(outDir, slug) {
  return ['.jpg', '.png', '.webp', '.gif'].find(
    ext => existsSync(join(outDir, `${slug}${ext}`))
  );
}

async function downloadImage(imageUrl, outDir, slug) {
  const res = await fetch(imageUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct  = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const ext = EXT_MAP[ct] ?? '.jpg';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(join(outDir, `${slug}${ext}`)));
  return ext;
}

function updateMdxImage(mdxPath, text, localPath) {
  const updated = text.replace(
    /^(image:\s*)["'][^"']*["'](\s*)$/m,
    `$1"${localPath}"$2`,
  );
  writeFileSync(mdxPath, updated, 'utf-8');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const force      = args.includes('--force');
const check      = args.includes('--check');
const latest     = args.includes('--latest');
const colIdx     = args.indexOf('--collection');
const collection = colIdx !== -1 ? args[colIdx + 1] : 'sermons';

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}migrate-sermon-images${c.reset} — download Squarespace images and update MDX

  ${c.cyan}--collection <name>${c.reset}   content collection (default: sermons)
  ${c.cyan}--latest${c.reset}             migrate most recent item only
  ${c.cyan}--check${c.reset}              show status without downloading
  ${c.cyan}--force${c.reset}              re-download and re-update all
`);
  process.exit(0);
}

const CONTENT_DIR = join(ROOT, 'src', 'content', collection);
const OUT_DIR     = join(ROOT, 'public', 'images', collection);

if (!existsSync(CONTENT_DIR)) {
  console.error(`\n${cross} Content directory not found: ${CONTENT_DIR}\n`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

let items = listContent(CONTENT_DIR);
if (latest) items = items.slice(0, 1);

console.log(`\n${c.bold}Image Migration — ${collection}${c.reset}`);
console.log('═'.repeat(60));
console.log(`${c.dim}${items.length} items with Squarespace image URLs${c.reset}\n`);

let ok = 0, skipped = 0, failed = 0;

for (const { slug, mdxPath, text, imageUrl } of items) {
  const cached = alreadyDownloaded(OUT_DIR, slug);

  if (!force && cached) {
    const localPath = `/images/${collection}/${slug}${cached}`;
    if (check) {
      console.log(`${tick} ${c.dim}cached${c.reset}   ${slug}`);
    } else if (!text.includes(localPath)) {
      updateMdxImage(mdxPath, text, localPath);
      console.log(`${tick} ${c.dim}fixed MDX${c.reset} ${slug}`);
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
    const ext       = await downloadImage(imageUrl, OUT_DIR, slug);
    const localPath = `/images/${collection}/${slug}${ext}`;
    updateMdxImage(mdxPath, text, localPath);
    process.stdout.write(`${tick} → ${localPath}\n`);
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
  if (failed > 0) console.log(`\nRun ${c.cyan}node scripts/migrate-sermon-images.mjs --collection ${collection}${c.reset} to migrate.\n`);
} else {
  console.log(`Migrated: ${ok}   Already done: ${skipped}${failed ? `   Failed: ${failed}` : ''}\n`);
}
