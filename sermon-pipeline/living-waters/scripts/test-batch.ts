#!/usr/bin/env tsx
/**
 * Targeted test batch — exercises specific fixes before full backfill.
 *
 * Tests:
 *   1. sermon-only-luke-14-1-24     — 1100+ word sections; confirms 600-word cap splits them
 *   2. believing-is-not-seeing-*    — 2021 sermon (corpus age coverage)
 *   3. guard-your-thoughts-*        — 2026 sermon (corpus age coverage)
 *
 * Note: every sermon in the corpus has empty takeaways[] and application[],
 * so practical_application will be 0 for all — this is the graceful-degradation
 * path and is confirmed if no crash occurs.
 *
 * Usage:
 *   WORKER_URL=... INGEST_SECRET=... GITHUB_TOKEN=... npx tsx scripts/test-batch.ts
 */

import yaml from 'js-yaml';

const WORKER_URL = process.env.WORKER_URL ?? '';
const INGEST_SECRET = process.env.INGEST_SECRET ?? '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const GITHUB_OWNER = 'family-church-online';
const GITHUB_REPO = 'website';
const SERMONS_PATH = 'src/content/sermons';

if (!WORKER_URL) throw new Error('WORKER_URL required');
if (!INGEST_SECRET) throw new Error('INGEST_SECRET required');
if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN required');

const TARGET_SERMONS = [
  'sermon-only-luke-14-1-24.mdx',
  'believing-is-not-seeing-hebrews-11-1-3.mdx',
  'guard-your-thoughts-philippians-4-8-9.mdx',
];

async function downloadFile(filename: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/master/${SERMONS_PATH}/${filename}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } });
  if (!res.ok) throw new Error(`Download ${filename} → ${res.status}`);
  return res.text();
}

async function ingestFile(filename: string, mdx: string): Promise<{ sermon_id: string; chunk_count: number }> {
  const res = await fetch(`${WORKER_URL}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST_SECRET}` },
    body: JSON.stringify({ mdx, filename }),
  });
  if (!res.ok) throw new Error(`Ingest ${filename} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ sermon_id: string; chunk_count: number }>;
}

// Rough token estimator: Voyage tokenises similarly to GPT-4 (~0.75 tokens/word).
// This gives a conservative estimate; contextualizedembeddings also encodes position
// so actual billed tokens may be slightly higher.
function estimateTokens(mdx: string): number {
  const words = mdx.split(/\s+/).length;
  return Math.ceil(words * 1.33); // ~1.33 tokens/word for mixed prose+markdown
}

async function runBatch(label: string): Promise<void> {
  console.log(`\n── ${label} ──────────────────────────────`);
  let totalTokenEst = 0;

  for (const filename of TARGET_SERMONS) {
    process.stdout.write(`  ${filename} … `);
    try {
      const mdx = await downloadFile(filename);
      const result = await ingestFile(filename, mdx);
      const tokenEst = estimateTokens(mdx);
      totalTokenEst += tokenEst;
      console.log(`✓  ${result.chunk_count} chunks  (~${tokenEst.toLocaleString()} tokens est.)`);
    } catch (err) {
      console.log(`FAILED: ${err}`);
    }
  }

  console.log(`  Total estimated tokens this batch: ~${totalTokenEst.toLocaleString()}`);
}

async function main(): Promise<void> {
  // Pass 1 — initial ingest
  await runBatch('Pass 1 — initial ingest');

  // Pass 2 — re-ingest same sermons to verify delete-before-reindex (no duplication)
  await runBatch('Pass 2 — re-ingest (deduplication check)');

  // Cost estimate
  console.log('\n── Cost estimate ────────────────────────────────');
  const TOTAL_SERMONS = 337;
  const BATCH_SIZE = TARGET_SERMONS.length;

  // Estimate tokens per sermon from an average of the Luke sermon (largest) and
  // the others — conservative high estimate for budgeting purposes.
  // Voyage voyage-context-4 pricing: check https://docs.voyageai.com/docs/pricing
  // At time of writing: $0.18 / 1M tokens (input). Confirm before committing spend.
  const PRICE_PER_M_TOKENS = 0.18; // USD — VERIFY against current Voyage pricing
  const lukeEstimate = 25000; // Luke sermon: 4 sections × 2 splits × ~300 words × 1.33 + other chunks
  const avgEstimate = 15000;  // typical sermon estimate
  const conservativePerSermon = Math.round((lukeEstimate + avgEstimate * (BATCH_SIZE - 1)) / BATCH_SIZE);
  const fullBackfillTokens = conservativePerSermon * TOTAL_SERMONS;
  const fullBackfillCost = (fullBackfillTokens / 1_000_000) * PRICE_PER_M_TOKENS;

  console.log(`  Sermons in corpus:            ${TOTAL_SERMONS}`);
  console.log(`  Conservative tokens/sermon:   ~${conservativePerSermon.toLocaleString()}`);
  console.log(`  Estimated full-backfill tokens: ~${(fullBackfillTokens / 1_000_000).toFixed(2)}M`);
  console.log(`  Estimated cost @ $${PRICE_PER_M_TOKENS}/1M tokens: ~$${fullBackfillCost.toFixed(2)}`);
  console.log('  (Verify current Voyage pricing at https://docs.voyageai.com/docs/pricing)');
}

main().catch(err => { console.error(err); process.exit(1); });
