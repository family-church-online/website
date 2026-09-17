#!/usr/bin/env node
/**
 * Precomputes top-3 related sermons for every sermon using Jaccard similarity
 * on canonical topic tags, then writes src/data/related-sermons.json.
 *
 * Run this after tag changes (e.g. after pnpm sermons:import).
 * The JSON is committed and imported at build time by [slug].astro —
 * no Jaccard scoring happens during the Astro/Worker build.
 *
 * Usage: node scripts/build-related-sermons.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERMONS_DIR = join(__dirname, '..', 'src', 'content', 'sermons');
const OUT_FILE    = join(__dirname, '..', 'src', 'data', 'related-sermons.json');

// ── parse tags from MDX frontmatter ───────────────────────────────────────

function parseFrontmatter(content) {
  const parts = content.split(/^---$/m);
  if (parts.length < 3) return {};
  const fm = parts[1];

  const result = {};

  // review: true/false
  const rev = fm.match(/^review:\s*(true|false)/m);
  result.review = rev?.[1] === 'true';

  // tags block: `tags:\n  - item\n  - item` or `tags: []`
  const tagsInline = fm.match(/^tags:\s*\[\s*\]/m);
  if (tagsInline) {
    result.tags = [];
    return result;
  }

  const tagsBlock = fm.match(/^tags:\n((?:[ \t]+-.+\n?)*)/m);
  if (tagsBlock) {
    result.tags = [...tagsBlock[1].matchAll(/^\s+-\s+"?([^"\n]+)"?\s*$/gm)]
      .map(m => m[1].trim());
  } else {
    result.tags = [];
  }

  return result;
}

function topicTags(tags) {
  return new Set(tags.filter(t => !/^(Book|Ref|Series):/.test(t)));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// ── load sermons ──────────────────────────────────────────────────────────

const sermons = readdirSync(SERMONS_DIR)
  .filter(f => f.endsWith('.mdx'))
  .map(f => {
    const slug = f.replace('.mdx', '');
    const content = readFileSync(join(SERMONS_DIR, f), 'utf-8');
    const { tags, review } = parseFrontmatter(content);
    return { slug, tags: tags ?? [], review: review ?? false };
  })
  .filter(s => !s.review);

// Precompute topic tag sets
const tagSets = sermons.map(s => topicTags(s.tags));

// ── compute related ───────────────────────────────────────────────────────

const related = {};

for (let i = 0; i < sermons.length; i++) {
  const scores = [];
  for (let j = 0; j < sermons.length; j++) {
    if (i === j) continue;
    const score = jaccard(tagSets[i], tagSets[j]);
    if (score > 0) scores.push({ slug: sermons[j].slug, score });
  }
  scores.sort((a, b) => b.score - a.score);
  related[sermons[i].slug] = scores.slice(0, 3).map(s => s.slug);
}

// ── write output ──────────────────────────────────────────────────────────

mkdirSync(join(__dirname, '..', 'src', 'data'), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(related, null, 2));
console.log(`Written: ${OUT_FILE} (${sermons.length} sermons)`);
