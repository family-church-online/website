#!/usr/bin/env node
/**
 * Download Pre-School Church lessons from the Squarespace JSON API.
 *
 * For each lesson, creates:
 *   scripts/lessons/kids-church/pre-school/{slug}/
 *     lesson.json          — title, date, slug, text blocks, asset inventory
 *     images/YYYY-MM-DD-{slug}-01.jpg  (thumbnail + body images/galleries)
 *     docs/YYYY-MM-DD-{slug}-01.pdf    (any PDF downloads linked in lesson)
 *
 * Videos (YouTube / Vimeo) are not downloaded — their IDs and URLs are
 * recorded in lesson.json under the "videos" array.
 *
 * Usage:
 *   node scripts/download-preschool-lessons.mjs            # download all missing
 *   node scripts/download-preschool-lessons.mjs --force    # re-download everything
 *   node scripts/download-preschool-lessons.mjs --slug moses  # one lesson only
 *   node scripts/download-preschool-lessons.mjs --check    # report without downloading
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname, extname }                                   from 'node:path';
import { fileURLToPath }                                            from 'node:url';
import { pipeline }                                                 from 'node:stream/promises';
import { Writable }                                                 from 'node:stream';
import https                                                        from 'node:https';
import http                                                         from 'node:http';
import { parse as parseUrl }                                        from 'node:url';
import { unescape as htmlUnescape }                                 from 'node:querystring';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT  = join(__dirname, 'lessons', 'kids-church', 'pre-school');
const BASE_URL  = 'https://familychurch.online';
const COLLECTION = '/pre-school-church';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const FORCE    = args.includes('--force');
const CHECK    = args.includes('--check');
const RENAME   = args.includes('--rename');
const slugIdx  = args.indexOf('--slug');
const ONLY_SLUG = slugIdx >= 0 ? args[slugIdx + 1] : null;

// ── Colour helpers ────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick   = `${c.green}✓${c.reset}`;
const cross  = `${c.red}✗${c.reset}`;
const skip   = `${c.dim}–${c.reset}`;
const bullet = `${c.cyan}·${c.reset}`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = parseUrl(url);
    const mod    = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; family-church-lesson-downloader/1.0)',
        Accept: 'application/json, text/html, */*',
        ...headers,
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location, headers));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

async function fetchJSON(url) {
  const { status, body } = await fetchText(url);
  if (status !== 200) throw new Error(`HTTP ${status} for ${url}`);
  return JSON.parse(body);
}

async function downloadFile(url, destPath) {
  const parsed = parseUrl(url);
  const mod    = parsed.protocol === 'https:' ? https : http;
  await new Promise((resolve, reject) => {
    mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; family-church-lesson-downloader/1.0)' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadFile(res.headers.location, destPath));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const out = createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Date / slug helpers ───────────────────────────────────────────────────────

function msToSADate(ms) {
  // UTC+2 (South Africa Standard Time, no DST)
  const d = new Date(ms + 2 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function filePrefix(date, slug) {
  return `${date}-${slug}`;
}

// ── HTML parsers ──────────────────────────────────────────────────────────────

/**
 * Squarespace HTML unescape: the body JSON has normal HTML but some
 * embedded attributes are HTML-entity-escaped. This handles both layers.
 */
function unescHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Extract plain text from an HTML fragment, collapsing whitespace.
 */
function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse a lesson's HTML body into structured blocks:
 *   { type: 'text',    html, text }
 *   { type: 'image',   url, alt }
 *   { type: 'video',   provider, id, url, title }
 *   { type: 'pdf',     href, filename }
 */
function parseBody(html) {
  const blocks = [];

  // ── Text blocks ─────────────────────────────────────────────────────────────
  // data-sqsp-text-block-content holds the editable HTML fragment
  const textRe = /data-sqsp-text-block-content[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = textRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    const text = htmlToText(raw);
    if (!text) continue;
    // Extract any PDF links inside this text block
    const pdfRe = /href="(\/s\/[^"]+\.pdf)"/gi;
    let pm;
    while ((pm = pdfRe.exec(raw)) !== null) {
      blocks.push({ type: 'pdf', href: pm[1], filename: pm[1].split('/').pop() });
    }
    blocks.push({ type: 'text', html: raw, text });
  }

  // ── Images (image-classic + gallery) ────────────────────────────────────────
  // Both block types use data-src="..." on <img> tags
  const imgRe = /data-src="(https:\/\/images\.squarespace-cdn\.com\/[^"?]+)"/g;
  const imgAltRe = /<img[^>]+data-src="https:\/\/images\.squarespace-cdn\.com\/[^"?]+"[^>]*alt="([^"]*)"/g;
  const seenImages = new Set();
  while ((m = imgRe.exec(html)) !== null) {
    const url = m[1];
    if (seenImages.has(url)) continue;
    seenImages.add(url);
    // Try to find alt text for this image
    const altM = /<img[^>]+data-src="([^"]+)"[^>]*alt="([^"]*)"/.exec(html.slice(m.index, m.index + 800));
    const alt = altM ? altM[2] : '';
    blocks.push({ type: 'image', url, alt });
  }

  // ── Videos ──────────────────────────────────────────────────────────────────
  // Video blocks encode the iframe in a data-html attribute (entity-escaped)
  const videoBlockRe = /data-sqsp-block="video"[\s\S]*?data-html="([^"]+)"/g;
  while ((m = videoBlockRe.exec(html)) !== null) {
    const iframe = unescHtml(m[1]);

    // YouTube (direct embed or embedly wrapper)
    const ytM = /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/.exec(iframe);
    if (ytM) {
      blocks.push({
        type: 'video',
        provider: 'youtube',
        id: ytM[1],
        url: `https://www.youtube.com/watch?v=${ytM[1]}`,
        title: unescHtml((/title="([^"]+)"/.exec(iframe) || [])[1] || ''),
      });
      continue;
    }

    // Vimeo
    const viM = /player\.vimeo\.com\/video\/(\d+)/.exec(iframe);
    if (viM) {
      // Preserve the full player URL (includes hash for private videos)
      const playerSrc = ((/src="([^"]+)"/.exec(iframe) || [])[1] || '').replace(/&amp;/g, '&');
      blocks.push({
        type: 'video',
        provider: 'vimeo',
        id: viM[1],
        url: `https://vimeo.com/${viM[1]}`,
        playerUrl: playerSrc,
        title: unescHtml((/title="([^"]+)"/.exec(iframe) || [])[1] || ''),
      });
      continue;
    }
  }

  // ── Also catch native Squarespace video blocks (provider in data attribute) ──
  // These may appear as data-provider-name + data-html in newer block format
  const nativeVidRe = /data-provider-name="([^"]+)"[^>]*data-html="([^"]+)"/g;
  while ((m = nativeVidRe.exec(html)) !== null) {
    const provider = m[1].toLowerCase();
    const iframe   = unescHtml(m[2]);
    const ytM = /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/.exec(iframe);
    const viM = /player\.vimeo\.com\/video\/(\d+)/.exec(iframe);
    if (ytM && !blocks.find(b => b.type === 'video' && b.id === ytM[1])) {
      blocks.push({ type: 'video', provider: 'youtube', id: ytM[1], url: `https://www.youtube.com/watch?v=${ytM[1]}`, title: '' });
    } else if (viM && !blocks.find(b => b.type === 'video' && b.id === viM[1])) {
      const playerSrc = (/src="([^"]+)"/.exec(iframe) || [])[1] || '';
      blocks.push({ type: 'video', provider: 'vimeo', id: viM[1], url: `https://vimeo.com/${viM[1]}`, playerUrl: playerSrc, title: '' });
    }
  }

  return blocks;
}

// ── Fetch all lesson summaries (paginated) ────────────────────────────────────

async function fetchAllLessons() {
  const lessons = [];
  let url = `${BASE_URL}${COLLECTION}?format=json`;
  while (url) {
    process.stdout.write(`${bullet} Fetching index page… ${url}\n`);
    const data = await fetchJSON(url);
    lessons.push(...(data.past || []), ...(data.upcoming || []));
    const next = data.pagination?.nextPageUrl;
    url = next ? `${BASE_URL}${next}&format=json` : null;
  }
  return lessons;
}

// ── Fetch full lesson body ────────────────────────────────────────────────────

async function fetchLessonBody(slug) {
  const data = await fetchJSON(`${BASE_URL}${COLLECTION}/${slug}?format=json`);
  return data.item?.body ?? '';
}

// ── Download a single lesson ──────────────────────────────────────────────────

async function downloadLesson(lesson) {
  const slug      = lesson.urlId;
  const title     = lesson.title;
  const date      = msToSADate(lesson.startDate);
  const prefix    = filePrefix(date, slugify(title));
  const lessonDir = join(OUT_ROOT, prefix);
  const imgDir    = join(lessonDir, 'images');
  const docDir    = join(lessonDir, 'docs');
  const jsonPath  = join(lessonDir, 'lesson.json');

  const alreadyDone = existsSync(jsonPath);
  if (alreadyDone && !FORCE) {
    console.log(`${skip}  ${slug}  ${c.dim}(skip — already downloaded)${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}${c.cyan}↓  ${title}${c.reset}  ${c.dim}(${date})${c.reset}`);

  if (CHECK) {
    console.log(`   would download to ${lessonDir}`);
    return;
  }

  mkdirSync(imgDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });

  // Fetch full body HTML
  const body   = await fetchLessonBody(slug);
  const parsed = parseBody(body);

  // ── Download thumbnail ────────────────────────────────────────────────────
  const assetUrl = lesson.assetUrl;
  let thumbnail  = null;
  if (assetUrl) {
    const ext      = '.jpg';
    const filename = `${prefix}-thumbnail${ext}`;
    const destPath = join(imgDir, filename);
    if (!existsSync(destPath) || FORCE) {
      try {
        // Request the highest quality version
        const dlUrl = assetUrl.includes('?') ? assetUrl : `${assetUrl}?format=2500w`;
        await downloadFile(dlUrl, destPath);
        console.log(`  ${tick} thumbnail → images/${filename}`);
      } catch (e) {
        console.log(`  ${cross} thumbnail failed: ${e.message}`);
      }
    } else {
      console.log(`  ${skip} thumbnail (exists)`);
    }
    thumbnail = filename;
  }

  // ── Download body images ──────────────────────────────────────────────────
  const imageBlocks = parsed.filter(b => b.type === 'image');
  const imageAssets = thumbnail ? [thumbnail] : [];
  let   imgCounter  = 1;

  for (const img of imageBlocks) {
    const ext      = extname(img.url.split('?')[0]) || '.jpg';
    const filename = `${prefix}-${String(imgCounter).padStart(2, '0')}${ext}`;
    const destPath = join(imgDir, filename);

    if (!existsSync(destPath) || FORCE) {
      try {
        const dlUrl = `${img.url}?format=2500w`;
        await downloadFile(dlUrl, destPath);
        console.log(`  ${tick} image ${imgCounter} → images/${filename}`);
      } catch (e) {
        console.log(`  ${cross} image ${imgCounter} (${img.url.slice(-40)}): ${e.message}`);
      }
    } else {
      console.log(`  ${skip} image ${imgCounter} (exists)`);
    }

    imageAssets.push(filename);
    imgCounter++;
  }

  // ── Download PDFs ─────────────────────────────────────────────────────────
  const pdfBlocks  = parsed.filter(b => b.type === 'pdf');
  const docAssets  = [];
  let   docCounter = 1;

  for (const pdf of pdfBlocks) {
    const srcUrl   = `${BASE_URL}${pdf.href}`;
    const filename = `${prefix}-${String(docCounter).padStart(2, '0')}-${pdf.filename}`;
    const destPath = join(docDir, filename);

    if (!existsSync(destPath) || FORCE) {
      try {
        await downloadFile(srcUrl, destPath);
        console.log(`  ${tick} doc → docs/${filename}`);
      } catch (e) {
        console.log(`  ${cross} doc (${pdf.href}): ${e.message}`);
      }
    } else {
      console.log(`  ${skip} doc (exists)`);
    }

    docAssets.push({ filename, originalHref: pdf.href });
    docCounter++;
  }

  // ── Collect videos ────────────────────────────────────────────────────────
  const videoBlocks = parsed.filter(b => b.type === 'video');
  for (const v of videoBlocks) {
    console.log(`  ${bullet} video (${v.provider}) ${v.id}  ${v.title || ''}`);
  }

  // ── Write lesson.json ─────────────────────────────────────────────────────
  const textBlocks = parsed
    .filter(b => b.type === 'text')
    .map(b => ({ html: b.html, text: b.text }));

  const record = {
    title,
    slug,
    date,
    squarespaceUrl: `${BASE_URL}${lesson.fullUrl}`,
    assets: {
      thumbnail,
      images:  imageAssets,
      videos:  videoBlocks.map(v => ({
        provider:  v.provider,
        id:        v.id,
        url:       v.url,
        playerUrl: v.playerUrl ?? null,
        title:     v.title,
      })),
      docs: docAssets,
    },
    textBlocks,
  };

  writeFileSync(jsonPath, JSON.stringify(record, null, 2) + '\n');
  console.log(`  ${tick} lesson.json written`);
}

// ── Rename existing folders to date-slug format ───────────────────────────────

function renameExistingFolders() {
  const entries = readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory());

  let renamed = 0, alreadyCorrect = 0, failed = 0;

  for (const entry of entries) {
    const jsonPath = join(OUT_ROOT, entry.name, 'lesson.json');
    if (!existsSync(jsonPath)) continue;

    let record;
    try { record = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { continue; }

    const expected = `${record.date}-${slugify(record.title)}`;
    if (entry.name === expected) { alreadyCorrect++; continue; }

    const oldPath = join(OUT_ROOT, entry.name);
    const newPath = join(OUT_ROOT, expected);
    if (existsSync(newPath)) {
      console.log(`${cross} ${entry.name}  →  ${expected}  ${c.dim}(target exists, skipped)${c.reset}`);
      failed++;
      continue;
    }
    try {
      renameSync(oldPath, newPath);
      console.log(`${tick} ${entry.name}  →  ${expected}`);
      renamed++;
    } catch (e) {
      console.error(`${cross} ${entry.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${renamed} renamed  ${alreadyCorrect} already correct  ${failed} failed`);
  return failed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (RENAME) {
  mkdirSync(OUT_ROOT, { recursive: true });
  const failed = renameExistingFolders();
  process.exit(failed > 0 ? 1 : 0);
}

mkdirSync(OUT_ROOT, { recursive: true });

const allLessons = await fetchAllLessons();
console.log(`\n${c.bold}Found ${allLessons.length} lessons${c.reset}\n`);

const toProcess = ONLY_SLUG
  ? allLessons.filter(l => l.urlId === ONLY_SLUG)
  : allLessons;

if (ONLY_SLUG && toProcess.length === 0) {
  console.error(`${cross} Lesson not found: ${ONLY_SLUG}`);
  process.exit(1);
}

let downloaded = 0, skipped = 0, failed = 0;

for (const lesson of toProcess) {
  try {
    const jsonPath = join(OUT_ROOT, lesson.urlId, 'lesson.json');
    const exists   = existsSync(jsonPath);
    if (exists && !FORCE) { skipped++; }
    await downloadLesson(lesson);
    if (!exists || FORCE) downloaded++;
  } catch (e) {
    console.error(`${cross} Failed ${lesson.urlId}: ${e.message}`);
    failed++;
  }
}

console.log(`\n${c.bold}Done.${c.reset}  ${downloaded} downloaded  ${skipped} skipped  ${failed} failed`);
if (CHECK) console.log(`(dry-run — nothing written)`);
