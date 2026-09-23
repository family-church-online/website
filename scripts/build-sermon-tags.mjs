#!/usr/bin/env node
/**
 * Generates src/data/sermon-tags.json — a precomputed map of slug → topic tags.
 * Also rebuilds src/data/related-sermons.json.
 *
 * Run once to bootstrap, then the sermon pipeline maintains both files on publish.
 * Also called by pnpm sermons:import via the existing build-related-sermons.mjs hook.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const SERMONS_DIR = join(__dirname, '..', 'src', 'content', 'sermons');
const DATA_DIR    = join(__dirname, '..', 'src', 'data');
const TAGS_FILE   = join(DATA_DIR, 'sermon-tags.json');
const RELATED_FILE = join(DATA_DIR, 'related-sermons.json');

function parseFrontmatter(content) {
  const parts = content.split(/^---$/m);
  if (parts.length < 3) return {};
  const fm = parts[1];
  const rev = fm.match(/^review:\s*(true|false)/m);
  const tagsInline = fm.match(/^tags:\s*\[\s*\]/m);
  if (tagsInline) return { review: rev?.[1] === 'true', tags: [] };
  const tagsBlock = fm.match(/^tags:\n((?:[ \t]+-.+\n?)*)/m);
  const tags = tagsBlock
    ? [...tagsBlock[1].matchAll(/^\s+-\s+"?([^"\n]+)"?\s*$/gm)].map(m => m[1].trim())
    : [];
  return { review: rev?.[1] === 'true', tags };
}

function topicTags(tags) {
  return tags.filter(t => !/^(Book|Ref|Series):/.test(t));
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  return intersection / (sa.size + sb.size - intersection);
}

mkdirSync(DATA_DIR, { recursive: true });

const sermons = readdirSync(SERMONS_DIR)
  .filter(f => f.endsWith('.mdx'))
  .map(f => {
    const slug = f.replace('.mdx', '');
    const { tags, review } = parseFrontmatter(readFileSync(join(SERMONS_DIR, f), 'utf-8'));
    return { slug, tags: topicTags(tags ?? []), review: review ?? false };
  })
  .filter(s => !s.review);

// sermon-tags.json: slug → topic tags[]
const tagsMap = Object.fromEntries(sermons.map(s => [s.slug, s.tags]));
writeFileSync(TAGS_FILE, JSON.stringify(tagsMap, null, 2));

// related-sermons.json: slug → top-3 related slugs
const related = {};
for (let i = 0; i < sermons.length; i++) {
  const scores = sermons
    .map((s, j) => i === j ? null : { slug: s.slug, score: jaccard(sermons[i].tags, s.tags) })
    .filter(x => x && x.score > 0)
    .sort((a, b) => b.score - a.score);
  related[sermons[i].slug] = scores.slice(0, 3).map(s => s.slug);
}
writeFileSync(RELATED_FILE, JSON.stringify(related, null, 2));

console.log(`sermon-tags.json: ${sermons.length} sermons`);
console.log(`related-sermons.json: rebuilt`);
