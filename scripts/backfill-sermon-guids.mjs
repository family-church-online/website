/**
 * Backfill Squarespace GUIDs into sermon MDX files that still have `guid: null`.
 *
 * Squarespace GUIDs are opaque IDs that podcast apps (Spotify, Apple) use to
 * track episodes. Once an app indexes an episode under a GUID, changing that
 * GUID creates a duplicate. We must preserve the original Squarespace GUIDs for
 * all historical sermons.
 *
 * Strategy:
 *   1. Paginate the Squarespace JSON API to build a complete date → GUID map.
 *   2. For each sermon MDX with `guid: null`, extract the date from the filename
 *      (YYYY-MM-DD prefix) and look it up in the map.
 *   3. Replace `guid: null` with `guid: "..."` in-place.
 *
 * Usage:
 *   node scripts/backfill-sermon-guids.mjs            # patch files
 *   node scripts/backfill-sermon-guids.mjs --dry-run  # preview only, no writes
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname }                            from 'node:path';
import { fileURLToPath }                            from 'node:url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const SERMONS_DIR = join(__dirname, '..', 'src', 'content', 'sermons');

const SQS_SITE_ID = '5e78a619d1740b512626df1a';
const BASE_URL    = 'https://familychurch.online/sermons/?format=json-pretty';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Colour helpers ────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;
const info  = `${c.cyan}·${c.reset}`;

// ── Step 1: fetch all Squarespace sermons via cursor pagination ───────────────

async function fetchAllItems() {
  const items = [];
  let url = BASE_URL;
  let page = 1;

  while (url) {
    process.stdout.write(`  ${info} Fetching page ${page}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const data = await res.json();

    const batch = data.items ?? [];
    items.push(...batch);
    process.stdout.write(` ${batch.length} items\n`);

    const next = data.pagination?.nextPageUrl;
    // nextPageUrl is a path like "/sermons?offset=123" — make it absolute.
    url = next ? `https://familychurch.online${next}&format=json-pretty` : null;
    page++;

    // Safety valve — Squarespace has ~334 sermons, 20/page ≈ 18 pages max.
    if (page > 30) { console.warn('  Stopping at 30 pages to avoid runaway loop'); break; }
  }

  return items;
}

// ── Step 2: build date → GUID map ────────────────────────────────────────────

function buildGuidMap(items) {
  const map = new Map(); // "YYYY-MM-DD" → guid string

  for (const item of items) {
    const { id, collectionId, publishOn } = item;
    if (!id || !collectionId || !publishOn) continue;

    const date = new Date(publishOn).toISOString().slice(0, 10);
    const guid = `${SQS_SITE_ID}:${collectionId}:${id}`;

    if (map.has(date)) {
      // Two sermons on the same date — can't disambiguate by date alone.
      console.warn(`  ${c.yellow}⚠${c.reset}  Duplicate date ${date} — skipping both to avoid wrong GUID assignment`);
      map.set(date, null); // null sentinel = skip this date
    } else {
      map.set(date, guid);
    }
  }

  // Remove sentinel entries
  for (const [k, v] of map) if (v === null) map.delete(k);

  return map;
}

// ── Step 3: patch MDX files ───────────────────────────────────────────────────

function patchSermons(guidMap) {
  const files = readdirSync(SERMONS_DIR)
    .filter(f => f.endsWith('.mdx'))
    .sort();

  let matched   = 0;
  let skipped   = 0;  // already has a real GUID
  let unmatched = 0;  // guid: null but no date in map

  for (const file of files) {
    const filePath = join(SERMONS_DIR, file);
    const content  = readFileSync(filePath, 'utf-8');

    // Only process files that still have `guid: null`
    if (!/^guid:\s*null\s*$/m.test(content)) {
      skipped++;
      continue;
    }

    // Date is the YYYY-MM-DD prefix of the filename
    const date = file.slice(0, 10);
    const guid = guidMap.get(date);

    if (!guid) {
      console.log(`  ${cross} ${file}  ${c.dim}(no Squarespace entry for ${date})${c.reset}`);
      unmatched++;
      continue;
    }

    const patched = content.replace(/^guid:\s*null\s*$/m, `guid: "${guid}"`);

    if (!DRY_RUN) {
      writeFileSync(filePath, patched, 'utf-8');
    }

    console.log(`  ${tick} ${file}`);
    matched++;
  }

  return { matched, skipped, unmatched, total: files.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${c.bold}Backfill Squarespace GUIDs${c.reset}${DRY_RUN ? `  ${c.yellow}[DRY RUN]${c.reset}` : ''}\n`);

console.log(`${c.bold}Fetching sermons from Squarespace…${c.reset}`);
const items = await fetchAllItems();
console.log(`  → ${items.length} total items fetched\n`);

const guidMap = buildGuidMap(items);
console.log(`${c.bold}GUID map built:${c.reset} ${guidMap.size} unique dates\n`);

console.log(`${c.bold}Patching MDX files…${c.reset}`);
const { matched, skipped, unmatched, total } = patchSermons(guidMap);

console.log(`
${c.bold}Summary${c.reset}
  Total sermons : ${total}
  Already set   : ${skipped}
  ${tick} Patched     : ${matched}${DRY_RUN ? `  ${c.yellow}(dry run — not written)${c.reset}` : ''}
  ${cross} No match    : ${unmatched}
`);

if (unmatched > 0) {
  console.log(`${c.yellow}Note:${c.reset} ${unmatched} sermon(s) had no matching Squarespace entry.`);
  console.log(`These may be sermons imported before they were published on Squarespace,`);
  console.log(`or dates that don't align (UTC vs SA time). Their GUIDs will stay null.\n`);
}
