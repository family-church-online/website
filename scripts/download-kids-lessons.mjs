#!/usr/bin/env node
/**
 * Download Kids Church lessons from the Squarespace JSON API.
 *
 * Covers three collections, each saved to its own folder:
 *   scripts/lessons/kids-church/pre-school/   ← /pre-school-church
 *   scripts/lessons/kids-church/junior/        ← /junior-prep-church
 *   scripts/lessons/kids-church/senior/        ← /senior-prep-church
 *
 * Per lesson:
 *   {folder}/{slug}/lesson.json          — title, date, slug, text, asset inventory
 *   {folder}/{slug}/images/YYYY-MM-DD-{slug}-thumbnail.jpg
 *   {folder}/{slug}/images/YYYY-MM-DD-{slug}-01.jpg …
 *   {folder}/{slug}/docs/YYYY-MM-DD-{slug}-01-name.pdf …
 *
 * Videos (YouTube / Vimeo) are recorded in lesson.json but not downloaded.
 *
 * Usage:
 *   node scripts/download-kids-lessons.mjs                        # all three collections
 *   node scripts/download-kids-lessons.mjs --collection junior    # one collection
 *   node scripts/download-kids-lessons.mjs --slug moses           # one lesson (all collections)
 *   node scripts/download-kids-lessons.mjs --force                # re-download everything
 *   node scripts/download-kids-lessons.mjs --check                # dry-run report
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname }                                   from 'node:path';
import { fileURLToPath }                                            from 'node:url';
import https                                                        from 'node:https';
import http                                                         from 'node:http';
import { parse as parseUrl }                                        from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT  = join(__dirname, 'lessons', 'kids-church');
const BASE_URL  = 'https://familychurch.online';

const COLLECTIONS = {
  'pre-school': { path: '/pre-school-church', folder: 'pre-school' },
  'junior':     { path: '/junior-prep-church', folder: 'junior' },
  'senior':     { path: '/senior-prep-church', folder: 'senior' },
};

// ── CLI args ──────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const FORCE   = args.includes('--force');
const CHECK   = args.includes('--check');

const colIdx  = args.indexOf('--collection');
const colArg  = colIdx >= 0 ? args[colIdx + 1] : null;

const slugIdx    = args.indexOf('--slug');
const ONLY_SLUG  = slugIdx >= 0 ? args[slugIdx + 1] : null;

if (colArg && !COLLECTIONS[colArg]) {
  console.error(`Unknown collection "${colArg}". Choose from: ${Object.keys(COLLECTIONS).join(', ')}`);
  process.exit(1);
}

const selectedCollections = colArg
  ? { [colArg]: COLLECTIONS[colArg] }
  : COLLECTIONS;

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

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const parsed = parseUrl(url);
    const mod    = parsed.protocol === 'https:' ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; family-church-lesson-downloader/1.0)',
        Accept: 'application/json, text/html, */*',
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
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
  const d = new Date(ms + 2 * 60 * 60 * 1000); // UTC+2, no DST
  return d.toISOString().slice(0, 10);
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Scripture extractor ───────────────────────────────────────────────────────

// All 66 canonical book names, alternation ordered longest-first to avoid
// partial matches (e.g. "John" before "1 John").
const BOOK_PATTERN = String.raw`(?:(?:1|2|3)\s+)?(?:` + [
  'Song of Solomon', 'Song of Songs',
  '1 Thessalonians', '2 Thessalonians',
  '1 Corinthians',   '2 Corinthians',
  '1 Chronicles',    '2 Chronicles',
  'Lamentations', 'Deuteronomy', 'Ecclesiastes', 'Philippians',
  'Revelation', 'Colossians', 'Habakkuk', 'Zephaniah', 'Nehemiah',
  'Galatians', 'Ephesians', 'Zechariah', 'Proverbs', 'Numbers',
  'Obadiah', 'Philemon', 'Jeremiah', 'Leviticus', 'Timothy',
  'Matthew', 'Hebrews', 'Genesis', 'Ezekiel', 'Malachi',
  'Isaiah', 'Romans', 'Joshua', 'Judges', 'Samuel', 'Titus',
  'Peter', 'Daniel', 'Psalms', 'Psalm',
  'Kings', 'Hosea', 'James', 'Nahum', 'Amos', 'Joel', 'Micah',
  'John', 'Acts', 'Luke', 'Mark', 'Ruth', 'Ezra', 'Jude',
  'Job', 'Jonah', 'Hannah',
  'Esther', 'Exodus', 'Haggai',
].join('|') + `)`;

// (?<![#\d]) prevents matching section labels like "#1Exodus" or "3Exodus"
const SCRIPTURE_RE = new RegExp(
  `(?<![#\\d])(${BOOK_PATTERN})\\s+(\\d+)(?::(\\d+)(?:[–\\-](\\d+))?)?`,
  'gi'
);

// Labels that signal the "main" or memory scripture for the lesson.
// Capture group 1 is the matched label text.
const MAIN_LABELS = /\b(memory\s+verses?|key\s+verses?|today['']?s?\s+verse|bible\s+verse|main\s+verse|our\s+verse|anchor\s+verse)\b/i;

// Normalise a matched label to title-case (e.g. "KEY VERSES" → "Key Verses")
function normaliseLabel(raw) {
  return raw.replace(/\s+/g, ' ').trim()
    .replace(/\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function normaliseRef(raw) {
  return raw.replace(/\s+/g, ' ').trim();
}

function extractScriptures(textBlocks) {
  const all            = [];
  const seen           = new Set();
  let   mainScripture  = null;
  let   mainScriptureLabel = null;

  for (const block of textBlocks) {
    const text = typeof block === 'string' ? block : (block.text ?? '');
    if (!text) continue;

    // Does this block announce a key/memory verse?
    const labelMatch = MAIN_LABELS.exec(text);

    // Find all refs in this block
    const refs = [];
    SCRIPTURE_RE.lastIndex = 0;
    let m;
    while ((m = SCRIPTURE_RE.exec(text)) !== null) {
      const ref = normaliseRef(m[0]);
      refs.push(ref);
      if (!seen.has(ref)) { seen.add(ref); all.push(ref); }
    }

    // First ref in a key/memory block → main scripture (first such block wins)
    if (labelMatch && refs.length > 0 && !mainScripture) {
      mainScripture      = refs[0];
      mainScriptureLabel = normaliseLabel(labelMatch[1]);
    }
  }

  // Fallback: first scripture found anywhere, no label
  if (!mainScripture && all.length > 0) mainScripture = all[0];

  return { scriptures: all, mainScripture, mainScriptureLabel };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function unescHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

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
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Body parser ───────────────────────────────────────────────────────────────

function parseBody(html) {
  const blocks = [];
  let m;

  // Text blocks
  const textRe = /data-sqsp-text-block-content[^>]*>([\s\S]*?)<\/div>/g;
  while ((m = textRe.exec(html)) !== null) {
    const raw  = m[1].trim();
    if (!raw) continue;
    const text = htmlToText(raw);
    if (!text) continue;
    // PDF links embedded in text blocks
    const pdfRe = /href="(\/s\/[^"]+\.pdf)"/gi;
    let pm;
    while ((pm = pdfRe.exec(raw)) !== null) {
      blocks.push({ type: 'pdf', href: pm[1], filename: pm[1].split('/').pop() });
    }
    blocks.push({ type: 'text', text });
  }

  // Images (image-classic + gallery both use data-src)
  const seenImages = new Set();
  const imgRe = /data-src="(https:\/\/images\.squarespace-cdn\.com\/[^"?]+)"/g;
  while ((m = imgRe.exec(html)) !== null) {
    const url = m[1];
    if (seenImages.has(url)) continue;
    seenImages.add(url);
    const altM = /<img[^>]+data-src="[^"]+"[^>]*alt="([^"]*)"/.exec(html.slice(m.index, m.index + 800));
    blocks.push({ type: 'image', url, alt: altM ? altM[1] : '' });
  }

  // Video blocks — iframe is entity-escaped inside data-html
  const seenVideos = new Set();

  function addVideo(iframe) {
    const ytM = /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/.exec(iframe);
    if (ytM && !seenVideos.has(ytM[1])) {
      seenVideos.add(ytM[1]);
      blocks.push({
        type: 'video', provider: 'youtube',
        id: ytM[1], url: `https://www.youtube.com/watch?v=${ytM[1]}`,
        title: unescHtml((/title="([^"]+)"/.exec(iframe) || [])[1] || ''),
      });
      return;
    }
    const viM = /player\.vimeo\.com\/video\/(\d+)/.exec(iframe);
    if (viM && !seenVideos.has(viM[1])) {
      seenVideos.add(viM[1]);
      const playerSrc = ((/src="([^"]+)"/.exec(iframe) || [])[1] || '').replace(/&amp;/g, '&');
      blocks.push({
        type: 'video', provider: 'vimeo',
        id: viM[1], url: `https://vimeo.com/${viM[1]}`,
        playerUrl: playerSrc,
        title: unescHtml((/title="([^"]+)"/.exec(iframe) || [])[1] || ''),
      });
    }
  }

  const videoBlockRe = /data-sqsp-block="video"[\s\S]*?data-html="([^"]+)"/g;
  while ((m = videoBlockRe.exec(html)) !== null) addVideo(unescHtml(m[1]));

  const nativeVidRe = /data-provider-name="[^"]+"[^>]*data-html="([^"]+)"/g;
  while ((m = nativeVidRe.exec(html)) !== null) addVideo(unescHtml(m[1]));

  return blocks;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchAllLessons(collectionPath) {
  const lessons = [];
  let url = `${BASE_URL}${collectionPath}?format=json`;
  while (url) {
    process.stdout.write(`${bullet} ${url}\n`);
    const data = await fetchJSON(url);
    lessons.push(...(data.past || []), ...(data.upcoming || []));
    const next = data.pagination?.nextPageUrl;
    url = next ? `${BASE_URL}${next}&format=json` : null;
  }
  return lessons;
}

async function fetchLessonBody(collectionPath, slug) {
  const data = await fetchJSON(`${BASE_URL}${collectionPath}/${slug}?format=json`);
  return data.item?.body ?? '';
}

// ── Download a single lesson ──────────────────────────────────────────────────

async function downloadLesson(lesson, collectionPath, outDir) {
  const slug      = lesson.urlId;
  const title     = lesson.title;
  const date      = msToSADate(lesson.startDate);
  const prefix    = `${date}-${slugify(title)}`;
  const lessonDir = join(outDir, slug);
  const imgDir    = join(lessonDir, 'images');
  const docDir    = join(lessonDir, 'docs');
  const jsonPath  = join(lessonDir, 'lesson.json');

  if (existsSync(jsonPath) && !FORCE) {
    console.log(`${skip}  ${slug}  ${c.dim}(already downloaded)${c.reset}`);
    return 'skipped';
  }

  console.log(`\n${c.bold}${c.cyan}↓  ${title}${c.reset}  ${c.dim}(${date})${c.reset}`);

  if (CHECK) {
    console.log(`   → ${lessonDir}`);
    return 'checked';
  }

  mkdirSync(imgDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });

  const body   = await fetchLessonBody(collectionPath, slug);
  const parsed = parseBody(body);

  // Thumbnail
  let thumbnail = null;
  if (lesson.assetUrl) {
    const filename = `${prefix}-thumbnail.jpg`;
    const destPath = join(imgDir, filename);
    if (!existsSync(destPath) || FORCE) {
      try {
        const dlUrl = lesson.assetUrl.includes('?') ? lesson.assetUrl : `${lesson.assetUrl}?format=2500w`;
        await downloadFile(dlUrl, destPath);
        console.log(`  ${tick} thumbnail → ${filename}`);
      } catch (e) {
        console.log(`  ${cross} thumbnail: ${e.message}`);
      }
    } else {
      console.log(`  ${skip} thumbnail (exists)`);
    }
    thumbnail = filename;
  }

  // Body images
  const imageBlocks = parsed.filter(b => b.type === 'image');
  const imageAssets = thumbnail ? [thumbnail] : [];
  let   imgN = 1;

  for (const img of imageBlocks) {
    const ext      = extname(img.url.split('?')[0]) || '.jpg';
    const filename = `${prefix}-${String(imgN).padStart(2, '0')}${ext}`;
    const destPath = join(imgDir, filename);
    if (!existsSync(destPath) || FORCE) {
      try {
        await downloadFile(`${img.url}?format=2500w`, destPath);
        console.log(`  ${tick} image ${imgN} → ${filename}`);
      } catch (e) {
        console.log(`  ${cross} image ${imgN}: ${e.message}`);
      }
    } else {
      console.log(`  ${skip} image ${imgN} (exists)`);
    }
    imageAssets.push(filename);
    imgN++;
  }

  // PDFs
  const pdfBlocks = parsed.filter(b => b.type === 'pdf');
  const docAssets = [];
  let   docN = 1;

  for (const pdf of pdfBlocks) {
    const filename = `${prefix}-${String(docN).padStart(2, '0')}-${pdf.filename}`;
    const destPath = join(docDir, filename);
    if (!existsSync(destPath) || FORCE) {
      try {
        await downloadFile(`${BASE_URL}${pdf.href}`, destPath);
        console.log(`  ${tick} doc → ${filename}`);
      } catch (e) {
        console.log(`  ${cross} doc (${pdf.href}): ${e.message}`);
      }
    } else {
      console.log(`  ${skip} doc (exists)`);
    }
    docAssets.push({ filename, originalHref: pdf.href });
    docN++;
  }

  // Videos (log only)
  const videoBlocks = parsed.filter(b => b.type === 'video');
  for (const v of videoBlocks) {
    console.log(`  ${bullet} video (${v.provider}) ${v.id}  ${v.title || ''}`);
  }

  // Write lesson.json
  const textBlocks = parsed.filter(b => b.type === 'text').map(b => b.text);
  const { scriptures, mainScripture, mainScriptureLabel } = extractScriptures(textBlocks);

  if (mainScripture) {
    const labelStr = mainScriptureLabel ? ` (${mainScriptureLabel})` : '';
    console.log(`  ${bullet} ${mainScripture}${labelStr}`);
  }
  if (scriptures.length > 1) console.log(`  ${bullet} all refs: ${scriptures.join(', ')}`);

  const record = {
    title,
    slug,
    date,
    squarespaceUrl: `${BASE_URL}${lesson.fullUrl}`,
    mainScripture,
    mainScriptureLabel,
    scriptures,
    assets: {
      thumbnail,
      images: imageAssets,
      videos: videoBlocks.map(v => ({
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
  return 'downloaded';
}

// ── Main ──────────────────────────────────────────────────────────────────────

let totalDownloaded = 0, totalSkipped = 0, totalFailed = 0;

for (const [name, col] of Object.entries(selectedCollections)) {
  const outDir = join(OUT_ROOT, col.folder);
  mkdirSync(outDir, { recursive: true });

  console.log(`\n${c.bold}${c.yellow}━━  ${name.toUpperCase()}  ━━${c.reset}`);

  let lessons;
  try {
    lessons = await fetchAllLessons(col.path);
  } catch (e) {
    console.error(`${cross} Failed to fetch ${name} index: ${e.message}`);
    totalFailed++;
    continue;
  }

  console.log(`${c.bold}Found ${lessons.length} lessons${c.reset}`);

  const toProcess = ONLY_SLUG ? lessons.filter(l => l.urlId === ONLY_SLUG) : lessons;

  if (ONLY_SLUG && toProcess.length === 0) {
    console.log(`${skip} Lesson "${ONLY_SLUG}" not found in ${name}`);
    continue;
  }

  for (const lesson of toProcess) {
    try {
      const result = await downloadLesson(lesson, col.path, outDir);
      if (result === 'downloaded') totalDownloaded++;
      else if (result === 'skipped') totalSkipped++;
    } catch (e) {
      console.error(`${cross} Failed ${lesson.urlId}: ${e.message}`);
      totalFailed++;
    }
  }
}

console.log(`\n${c.bold}Done.${c.reset}  ${totalDownloaded} downloaded  ${totalSkipped} skipped  ${totalFailed} failed`);
if (CHECK) console.log(`(dry-run — nothing written)`);
process.exit(totalFailed > 0 ? 1 : 0);
