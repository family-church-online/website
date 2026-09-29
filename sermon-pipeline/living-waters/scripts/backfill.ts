#!/usr/bin/env tsx
/**
 * One-time backfill — ingest all existing sermon MDX files from GitHub into
 * the Living Waters D1 + Vectorize index.
 *
 * Prerequisites (run in the living-waters/ directory):
 *   1. wrangler d1 create living-waters
 *      → update wrangler.jsonc database_id
 *   2. wrangler vectorize create sermon-chunks \
 *        --dimensions 1024 --metric cosine \
 *        --metadata-index chunk_type \
 *        --metadata-index speaker \
 *        --metadata-index sermon_id
 *   3. pnpm schema   (applies schema.sql to the remote D1 DB)
 *   4. wrangler secret put VOYAGE_API_KEY
 *      wrangler secret put INGEST_SECRET
 *   5. wrangler deploy
 *   6. Set env vars below (or in shell), then: pnpm backfill
 *
 * Environment variables:
 *   WORKER_URL       Deployed Worker URL, e.g. https://living-waters.YOUR.workers.dev
 *   INGEST_SECRET    Same secret as the Worker's INGEST_SECRET
 *   GITHUB_TOKEN     Personal access token with repo read scope
 */

const WORKER_URL = process.env.WORKER_URL ?? '';
const INGEST_SECRET = process.env.INGEST_SECRET ?? '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined; // e.g. LIMIT=3 for a test run
const GITHUB_OWNER = 'family-church-online';
const GITHUB_REPO = 'website';
const SERMONS_PATH = 'src/content/sermons';
const DELAY_MS = 500; // throttle between sermons to avoid hammering Voyage API

if (!WORKER_URL) throw new Error('WORKER_URL env var required');
if (!INGEST_SECRET) throw new Error('INGEST_SECRET env var required');
if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN env var required');

async function githubGet(path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'living-waters-backfill/1.0',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchSermonFiles(): Promise<{ name: string; download_url: string }[]> {
  const files = (await githubGet(`/contents/${SERMONS_PATH}`)) as {
    name: string;
    download_url: string;
    type: string;
  }[];
  return files.filter(f => f.type === 'file' && f.name.endsWith('.mdx'));
}

async function downloadFile(download_url: string): Promise<string> {
  const res = await fetch(download_url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Download failed ${download_url} → ${res.status}`);
  return res.text();
}

async function ingestFile(filename: string, mdx: string): Promise<{ sermon_id: string; chunk_count: number }> {
  const res = await fetch(`${WORKER_URL}/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INGEST_SECRET}`,
    },
    body: JSON.stringify({ mdx, filename }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest ${filename} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ sermon_id: string; chunk_count: number }>;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('Fetching sermon list from GitHub…');
  const files = await fetchSermonFiles();
  console.log(`Found ${files.length} sermon files\n`);

  let ok = 0, skipped = 0, failed = 0;
  const total = LIMIT !== undefined ? Math.min(LIMIT, files.length) : files.length;
  if (LIMIT !== undefined) console.log(`LIMIT=${LIMIT} — testing with first ${total} sermon(s)\n`);

  for (let i = 0; i < total; i++) {
    const file = files[i];
    process.stdout.write(`[${i + 1}/${total}] ${file.name} … `);
    try {
      const mdx = await downloadFile(file.download_url);
      const result = await ingestFile(file.name, mdx);
      console.log(`✓  ${result.chunk_count} chunks`);
      ok++;
    } catch (err) {
      const msg = String(err);
      if (msg.includes('review: true')) {
        console.log('skipped (review: true)');
        skipped++;
      } else {
        console.log(`FAILED: ${msg}`);
        failed++;
      }
    }

    if (i < total - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone — ${ok} ingested, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
