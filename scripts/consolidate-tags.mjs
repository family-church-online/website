/**
 * Consolidate sermon tags in scripts/drive/comp-tax/*.json
 *
 * - Merges near-duplicate tags into canonical forms
 * - Drops tags that appear fewer than MIN_COUNT times across the corpus
 * - Strips Ref:, Book:, Series: prefixed tags (handled elsewhere)
 * - Writes cleaned tags back into each JSON file in place
 *
 * Run after: node scripts/download-sermons.mjs
 * Run before: node scripts/import-sermons.mjs
 *
 * Usage:
 *   node scripts/consolidate-tags.mjs           apply consolidation
 *   node scripts/consolidate-tags.mjs --dry-run  preview without writing
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMP_TAX  = join(__dirname, 'drive', 'comp-tax');
const MIN_COUNT = 5;
const DRY_RUN   = process.argv.includes('--dry-run');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

// ─── Merge map: old tag → canonical tag ──────────────────────────────────────
// Tags not in this map and with MIN_COUNT+ occurrences are kept as-is.
// Tags not in this map and below MIN_COUNT are dropped.

const MERGE = {
  // Trust
  'Trusting God':              'Trust in God',
  'Dependence on God':         'Trust in God',
  'Trusting God in Suffering': 'Trust in God',

  // Sovereignty
  "God's Sovereignty":         'Sovereignty of God',
  'Power of God':              'Sovereignty of God',

  // Providence
  'Providence of God':         'Providence',

  // Grace
  'Grace Alone':               'Grace',
  'Grace and Law':             'Grace',

  // Gospel & Salvation
  'Law and Gospel':            'Gospel',
  'Justification by Faith':    'Salvation',
  'Assurance of Salvation':    'Salvation',
  'Eternal Life':              'Salvation',

  // Scripture
  'Word of God':               'Scripture',
  'Authority of Scripture':    'Scripture',

  // Mission & Evangelism
  'Evangelism':                'Mission & Evangelism',
  'Sharing Faith':             'Mission & Evangelism',
  'Gospel Proclamation':       'Mission & Evangelism',
  'Sharing the Gospel':        'Mission & Evangelism',
  'Making Disciples':          'Mission & Evangelism',
  'Great Commission':          'Mission & Evangelism',
  'Witness':                   'Mission & Evangelism',
  'Testimony':                 'Mission & Evangelism',

  // Holiness
  'Sanctification':            'Holiness',

  // Incarnation
  'Christmas':                 'Incarnation',

  // Spiritual Warfare
  'Armor of God':              'Spiritual Warfare',

  // Prayer
  'Intercession':              'Prayer',
  'Intercession of Christ':    'Prayer',

  // Second Coming
  'Day of the Lord':           'Second Coming',
  'Rapture':                   'Second Coming',
  'Readiness':                 'Second Coming',

  // Community
  'Building the Church':       'Community',
  'Body of Christ':            'Community',
  'Belonging':                 'Community',

  // Serving
  'Serving Others':            'Serving',
  'Serving the Church':        'Serving',

  // Surrender
  'Surrender to God':          'Surrender',

  // Faithfulness
  'Faithfulness of God':       'Faithfulness',

  // Suffering
  'Grief':                     'Suffering',
  'Persecution':               'Suffering',

  // Anxiety & Fear
  'Anxiety':                   'Anxiety & Fear',
  'Overcoming Fear':           'Anxiety & Fear',

  // Perseverance
  'Standing Firm':             'Perseverance',

  // Easter
  'Palm Sunday':               'Easter',

  // Holy Spirit
  'Fruit of the Spirit':       'Holy Spirit',

  // Drop these by mapping to null (filtered out below)
  'Melchizedek':               null,
  'New Year':                  null,
  'Faith':                     null,
};

// ─── Pass 1: count all topic tags across corpus ───────────────────────────────

const files = readdirSync(COMP_TAX)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

const globalCounts = new Map();

for (const fname of files) {
  const data = JSON.parse(readFileSync(join(COMP_TAX, fname), 'utf-8'));
  for (const raw of (data.tags ?? [])) {
    if (/^(Ref|Book|Series):/.test(raw)) continue;
    const canonical = raw in MERGE ? MERGE[raw] : raw;
    if (canonical === null) continue;
    globalCounts.set(canonical, (globalCounts.get(canonical) ?? 0) + 1);
  }
}

const kept = new Set([...globalCounts.entries()].filter(([, n]) => n >= MIN_COUNT).map(([t]) => t));

// ─── Pass 2: rewrite each file ────────────────────────────────────────────────

let totalFiles = 0, totalDropped = 0, totalMerged = 0;
const mergeReport = new Map();
const dropReport  = new Map();

for (const fname of files) {
  const path = join(COMP_TAX, fname);
  const data = JSON.parse(readFileSync(path, 'utf-8'));

  const rawTags = (data.tags ?? []).filter(t => !/^(Ref|Book|Series):/.test(t));
  const seen    = new Set();
  const cleaned = [];

  for (const raw of rawTags) {
    const canonical = raw in MERGE ? MERGE[raw] : raw;

    if (canonical === null || !kept.has(canonical)) {
      dropReport.set(raw, (dropReport.get(raw) ?? 0) + 1);
      totalDropped++;
      continue;
    }

    if (MERGE[raw]) {
      mergeReport.set(raw, canonical);
      totalMerged++;
    }

    if (!seen.has(canonical)) {
      seen.add(canonical);
      cleaned.push(canonical);
    }
  }

  // Preserve Ref:/Book: tags — the import script uses them for scripture display
  const preserved = (data.tags ?? []).filter(t => /^(Ref|Book|Series):/.test(t));
  const newTags   = [...cleaned, ...preserved];

  if (!DRY_RUN) {
    writeFileSync(path, JSON.stringify({ ...data, tags: newTags }, null, 2));
  }
  totalFiles++;
}

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(`\n${c.bold}Tag Consolidation${c.reset}  ${DRY_RUN ? c.yellow + '(dry run — no files written)' + c.reset : ''}`);
console.log('═'.repeat(60));
console.log(`Files processed: ${c.cyan}${totalFiles}${c.reset}`);
console.log(`Tags merged:     ${c.cyan}${totalMerged}${c.reset} instances`);
console.log(`Tags dropped:    ${c.cyan}${totalDropped}${c.reset} instances (< ${MIN_COUNT} occurrences)`);

console.log(`\n${c.bold}Canonical tag set (${kept.size} tags):${c.reset}`);
const sorted = [...kept].sort((a, b) =>
  (globalCounts.get(b) ?? 0) - (globalCounts.get(a) ?? 0)
);
for (const tag of sorted) {
  console.log(`  ${String(globalCounts.get(tag) ?? 0).padStart(4)}  ${tag}`);
}

console.log(`\n${c.bold}Merges applied:${c.reset}`);
const uniqueMerges = [...new Set(Object.entries(MERGE).map(([k, v]) => `${k} → ${v}`))];
for (const m of uniqueMerges.sort()) {
  console.log(`  ${c.dim}${m}${c.reset}`);
}

if (!DRY_RUN) {
  console.log(`\n${c.green}✓${c.reset} Written to ${c.cyan}scripts/drive/comp-tax/${c.reset}`);
  console.log(`  Next: ${c.cyan}node scripts/import-sermons.mjs${c.reset}\n`);
} else {
  console.log(`\n  Run without ${c.cyan}--dry-run${c.reset} to apply.\n`);
}
