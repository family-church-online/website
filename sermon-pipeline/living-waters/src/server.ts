import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Env } from './types';
import * as db from './db';
import type { AudienceSituationRow } from './db';
import { embedQuery, rerank, getByIdsBatched } from './vectorize';
import { makeChunkId } from './utils';

const RETRIEVE_POOL = 100;     // wide Vectorize retrieval (requires returnMetadata:'indexed')
const PER_SERMON_CAP = 3;      // max chunks from one sermon before reranking
const CANDIDATE_POOL = 30;     // rerank input cap
const RERANK_MAX_DOCS = 900;   // Voyage rerank API batch limit
const R2_PUBLIC_URL = 'https://audio.familychurch.online';
const CLIP_BASE_URL = 'https://cflw.familychurch.online';

// ── Per-sermon diversity cap ──────────────────────────────────────────────────

// Keep at most perSermonCap matches per sermon_id, preserving similarity order,
// then truncate to totalCap. Matches must have metadata with sermon_id (returned
// by returnMetadata:'indexed').
function capPerSermon(
  matches: VectorizeMatch[],
  perSermonCap: number,
  totalCap: number,
): VectorizeMatch[] {
  const countPerSermon = new Map<string, number>();
  const result: VectorizeMatch[] = [];
  for (const match of matches) {
    const sermonId = (match.metadata as Record<string, unknown> | undefined)?.sermon_id as string | undefined;
    if (!sermonId) continue;
    const count = countPerSermon.get(sermonId) ?? 0;
    if (count >= perSermonCap) continue;
    countPerSermon.set(sermonId, count + 1);
    result.push(match);
    if (result.length >= totalCap) break;
  }
  return result;
}

// ── Rerank document builders ──────────────────────────────────────────────────

// Build the document the reranker sees for a search() chunk.
// Titles are unreliable for older sermons — never include them here.
// RERANK_CONTEXT variants:
//   'none' (default): bare chunk content.
//   'big_idea':       "Big idea: {big_idea}\n{content}" — one high-signal sentence.
function buildRerankDocument(
  rerankContext: string,
  bigIdea: string | null | undefined,
  content: string,
): string {
  if (rerankContext === 'big_idea' && bigIdea) {
    return `Big idea: ${bigIdea}\n${content}`;
  }
  return content;
}

// Build rerank document for a full sermon in find_for_situation Stage B.
// No title/series — unreliable for older sermons. Analysis fields only.
function buildSermonRerankDocument(s: AudienceSituationRow): string {
  const parts: string[] = [];
  if (s.main_points.length) {
    const pts = s.main_points.map(p => p.title || p.body).filter(Boolean);
    if (pts.length) parts.push('Main points: ' + pts.join(' / '));
  }
  if (s.takeaways.length) {
    parts.push('Key takeaways: ' + s.takeaways.join(' / '));
  }
  if (s.audience.length) {
    parts.push('For someone who: ' + s.audience.join(' / '));
  }
  return parts.join('\n');
}

// Rerank in batches (Voyage limit: 900 docs/call), merge and sort by score.
async function rerankBatched(
  query: string,
  documents: string[],
  apiKey: string,
): Promise<{ index: number; score: number }[]> {
  const scored: { index: number; score: number }[] = [];
  for (let start = 0; start < documents.length; start += RERANK_MAX_DOCS) {
    const batch = documents.slice(start, start + RERANK_MAX_DOCS);
    const results = await rerank(query, batch, apiKey, batch.length);
    for (const r of results) {
      scored.push({ index: start + r.index, score: r.score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// createServer returns a factory (() => McpServer) for createMcpHandler.
export function createServer(env: Env): () => McpServer {
  return () => {
    const server = new McpServer({ name: 'Living Waters', version: '1.0.0' });

    // ─── search ────────────────────────────────────────────────────────────
    server.registerTool(
      'search',
      {
        description:
          'Semantic search across sermon transcripts, main points, and illustrations. ' +
          'Returns the most relevant passages with content, relevance scores, and time codes for transcript hits. ' +
          'Use find_for_situation() instead when the query is about who a sermon is for. ' +
          'Pass sermon_ids (from find_by_scripture() or list_sermons()) to restrict to a pre-selected set.',
        inputSchema: {
          query: z.string().describe('Search query'),
          top_k: z.number().int().min(1).max(20).default(5).describe('Number of results'),
          speaker: z.string().optional().describe('Filter by speaker — partial match OK ("Pete" → "Peter Stoffberg")'),
          tag: z.string().optional().describe('Filter by exact topic tag, e.g. "Topic:Faith"'),
          sermon_ids: z
            .array(z.string())
            .optional()
            .describe('Restrict to specific sermon IDs — compose with find_by_scripture() or list_sermons()'),
          chunk_type: z
            .enum(['transcript_section', 'main_point', 'key_illustration', 'big_idea', 'practical_application'])
            .optional()
            .describe('Limit to one chunk type; defaults to all five'),
        },
      },
      async ({ query, top_k = 5, speaker, tag, sermon_ids, chunk_type }) => {
        let canonicalSpeaker: string | undefined;
        if (speaker) {
          canonicalSpeaker = (await db.resolveCanonicalSpeaker(env.DB, speaker)) ?? undefined;
          if (!canonicalSpeaker) return { content: [{ type: 'text', text: '[]' }] };
        }

        let sermonIdFilter: string[] | undefined;
        if (tag) {
          const tagIds = await db.getSermonIdsByTag(env.DB, tag);
          if (!tagIds.length) return { content: [{ type: 'text', text: '[]' }] };
          sermonIdFilter = sermon_ids ? tagIds.filter(id => sermon_ids.includes(id)) : tagIds;
          if (!sermonIdFilter.length) return { content: [{ type: 'text', text: '[]' }] };
        } else if (sermon_ids?.length) {
          sermonIdFilter = sermon_ids;
        }

        const isSingleSermon = (sermonIdFilter?.length ?? 0) === 1;

        const embedding = await embedQuery(query, env.VOYAGE_API_KEY);

        const filter = {
          chunk_type: chunk_type
            ? { $eq: chunk_type }
            : { $in: ['transcript_section', 'main_point', 'key_illustration', 'big_idea', 'practical_application'] },
          ...(canonicalSpeaker && { speaker: { $eq: canonicalSpeaker } }),
          ...(sermonIdFilter && { sermon_id: { $in: sermonIdFilter } }),
        } as unknown as VectorizeVectorMetadataFilter;

        // Retrieve wide pool with indexed metadata only (returnMetadata:'all' caps at topK=20).
        // sermon_id, chunk_type, speaker are metadata-indexed so available with 'indexed'.
        const rawMatches = await env.VECTORIZE.query(embedding, {
          topK: RETRIEVE_POOL,
          filter,
          returnMetadata: 'indexed',
        });

        if (!rawMatches.matches.length) return { content: [{ type: 'text', text: '[]' }] };

        // Cap chunks per sermon to ensure diversity, unless the filter already resolves
        // to a single sermon (single sermon_ids entry, or tag that yielded one sermon).
        const cappedMatches = isSingleSermon
          ? rawMatches.matches.slice(0, CANDIDATE_POOL)
          : capPerSermon(rawMatches.matches, PER_SERMON_CAP, CANDIDATE_POOL);

        // Load full metadata (content, markers, title, etc.) for surviving chunks.
        const survivorIds = cappedMatches.map(m => m.id);
        const fullVectors = await getByIdsBatched(env.VECTORIZE,survivorIds);
        const vectorById = new Map(fullVectors.map(v => [v.id, v]));

        // Reconstruct ordered matches with full metadata; drop any that failed to load.
        type EnrichedMatch = { id: string; score: number; metadata: Record<string, unknown> };
        const enrichedMatches: EnrichedMatch[] = cappedMatches
          .map(m => {
            const full = vectorById.get(m.id);
            if (!full?.metadata) return null;
            return { id: m.id, score: m.score, metadata: full.metadata as Record<string, unknown> };
          })
          .filter((m): m is EnrichedMatch => m !== null);

        if (!enrichedMatches.length) return { content: [{ type: 'text', text: '[]' }] };

        const rerankContext = env.RERANK_CONTEXT ?? 'none';

        // Only hit D1 for framing when RERANK_CONTEXT requires it.
        let framingMap: Map<string, { big_idea: string | null }> | undefined;
        if (rerankContext === 'big_idea') {
          const sermonIds = [...new Set(enrichedMatches.map(m => m.metadata.sermon_id as string))];
          framingMap = await db.getFramingContext(env.DB, sermonIds);
        }

        const documents = enrichedMatches.map(m => {
          const framing = framingMap?.get(m.metadata.sermon_id as string);
          return buildRerankDocument(rerankContext, framing?.big_idea, m.metadata.content as string ?? '');
        });

        const reranked = await rerank(query, documents, env.VOYAGE_API_KEY, top_k);

        const results = reranked.map(r => {
          const m = enrichedMatches[r.index];
          return {
            sermon_id: m.metadata.sermon_id,
            title: m.metadata.title,
            speaker: m.metadata.speaker,
            date: m.metadata.date,
            scripture: m.metadata.scripture,
            chunk_type: m.metadata.chunk_type,
            content: m.metadata.content,
            relevance_score: r.score,
            ...(m.metadata.chunk_type === 'transcript_section'
              ? { time_range_start: m.metadata.time_range_start, time_range_end: m.metadata.time_range_end }
              : {}),
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      },
    );

    // ─── get_sermon ────────────────────────────────────────────────────────
    server.registerTool(
      'get_sermon',
      {
        description:
          'Full structured record for a sermon — all fields, tags, additional scriptures. ' +
          'Use after search() to get complete context around a result.',
        inputSchema: {
          sermon_id: z.string().describe('Sermon ID (filename slug without .mdx)'),
        },
      },
      async ({ sermon_id }) => {
        const sermon = await db.getSermon(env.DB, sermon_id);
        if (!sermon)
          return { content: [{ type: 'text', text: 'Sermon not found' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(sermon) }] };
      },
    );

    // ─── get_summary ───────────────────────────────────────────────────────
    server.registerTool(
      'get_summary',
      {
        description:
          'Condensed sermon overview — big idea, main points, key illustration, and takeaway. ' +
          'Faster than get_sermon() when you only need the outline.',
        inputSchema: {
          sermon_id: z.string().describe('Sermon ID'),
        },
      },
      async ({ sermon_id }) => {
        const summary = await db.getSermonSummary(env.DB, sermon_id);
        if (!summary)
          return { content: [{ type: 'text', text: 'Sermon not found' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
      },
    );

    // ─── list_sermons ──────────────────────────────────────────────────────
    server.registerTool(
      'list_sermons',
      {
        description:
          'Browse sermons without a search query — filterable by series, speaker, or tag, with pagination. ' +
          'Use for inventory questions ("what have we got on X") or to narrow a set before calling search().',
        inputSchema: {
          series: z.string().optional().describe('Filter by series name (partial match)'),
          speaker: z.string().optional().describe('Filter by speaker name (partial match)'),
          tag: z.string().optional().describe('Filter by exact topic tag'),
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        },
      },
      async ({ series, speaker, tag, limit = 20, offset = 0 }) => {
        const sermons = await db.listSermons(env.DB, { series, speaker, tag, limit, offset });
        return { content: [{ type: 'text', text: JSON.stringify(sermons) }] };
      },
    );

    // ─── find_by_scripture ─────────────────────────────────────────────────
    server.registerTool(
      'find_by_scripture',
      {
        description:
          "Find sermons that cite a specific passage — matched against the primary scripture and all cross-references. " +
          '"Isaiah 41" matches any Isaiah 41 verse. matched_via tells you if it\'s the main text or a cross-reference.',
        inputSchema: {
          reference: z
            .string()
            .describe('Passage reference, e.g. "Isaiah 41:10", "Romans 8", "John 3"'),
        },
      },
      async ({ reference }) => {
        const results = await db.findByScripture(env.DB, reference);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      },
    );

    // ─── find_for_situation ────────────────────────────────────────────────
    server.registerTool(
      'find_for_situation',
      {
        description:
          'Find sermons written for a specific kind of person or life situation. ' +
          'Searches the curated "this sermon is for you if..." audience descriptions — ' +
          'better than search() for "something for someone who feels spiritually stagnant" style queries. ' +
          'Two-stage rerank: Stage A narrows on bare audience text; Stage B re-ranks enriched sermon context.',
        inputSchema: {
          description: z
            .string()
            .describe('Person or situation, e.g. "someone going through grief" or "feeling spiritually stuck"'),
          top_k: z.number().int().min(1).max(20).default(5),
          speaker: z.string().optional().describe('Optionally restrict to a specific speaker'),
        },
      },
      async ({ description, top_k = 5, speaker }) => {
        let canonicalSpeaker: string | undefined;
        if (speaker) {
          canonicalSpeaker = (await db.resolveCanonicalSpeaker(env.DB, speaker)) ?? undefined;
          if (!canonicalSpeaker) return { content: [{ type: 'text', text: '[]' }] };
        }

        const allSermons = await db.getAllAudienceSituations(env.DB, canonicalSpeaker);
        if (!allSermons.length) return { content: [{ type: 'text', text: '[]' }] };

        const candidates: { sermonIdx: number; text: string }[] = [];
        for (let i = 0; i < allSermons.length; i++) {
          for (const text of allSermons[i].audience) {
            candidates.push({ sermonIdx: i, text });
          }
        }

        const STAGE_A_SHORTLIST_SIZE = 150;
        const stageADocs = candidates.map(c => c.text);
        const stageAScored = await rerankBatched(description, stageADocs, env.VOYAGE_API_KEY);

        const shortlist: AudienceSituationRow[] = [];
        const seenIndices = new Set<number>();
        for (const { index } of stageAScored) {
          const sermonIdx = candidates[index].sermonIdx;
          if (!seenIndices.has(sermonIdx)) {
            seenIndices.add(sermonIdx);
            shortlist.push(allSermons[sermonIdx]);
            if (shortlist.length >= STAGE_A_SHORTLIST_SIZE) break;
          }
        }

        // Stage B: rerank using analysis fields only — no title/series.
        const stageBDocs = shortlist.map(buildSermonRerankDocument);
        const stageBScored = await rerankBatched(description, stageBDocs, env.VOYAGE_API_KEY);

        const results = stageBScored.slice(0, top_k).map(({ index, score }) => {
          const s = shortlist[index];
          return {
            sermon_id: s.sermon_id,
            title: s.title,
            speaker: s.speaker,
            date: s.date,
            scripture: s.scripture,
            score,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      },
    );

    // ─── get_clip ──────────────────────────────────────────────────────────
    server.registerTool(
      'get_clip',
      {
        description:
          'Get a shareable URL for a short audio clip of a specific part of a sermon. ' +
          'Provide start/end in seconds, or a quote string to locate the segment automatically. ' +
          'Returns a URL that streams just that portion.',
        inputSchema: {
          sermon_id: z.string().describe('Sermon ID'),
          start: z.number().optional().describe('Start time in seconds'),
          end: z.number().optional().describe('End time in seconds'),
          quote: z
            .string()
            .optional()
            .describe('A quote from the sermon — clip boundaries are located from inline timestamps'),
        },
      },
      async ({ sermon_id, start, end, quote }) => {
        const row = await env.DB.prepare(
          'SELECT audio_url, chunk_counts FROM sermons WHERE id = ?',
        )
          .bind(sermon_id)
          .first<{ audio_url: string | null; chunk_counts: string | null }>();

        if (!row) {
          return { content: [{ type: 'text', text: 'Sermon not found' }], isError: true };
        }

        let clipStart = start ?? 0;
        let clipEnd = end ?? clipStart + 60;
        let located: 'requested' | 'quote' | 'chunk' = 'requested';

        if (quote && (start === undefined || end === undefined)) {
          located = await locateQuote(env, sermon_id, row.chunk_counts, quote)
            .then(r => {
              clipStart = r.start;
              clipEnd = r.end;
              return r.located;
            })
            .catch(() => 'chunk' as const);
        }

        // Enforce minimum clip length of 20 seconds.
        if (clipEnd - clipStart < 20) clipEnd = clipStart + 20;

        const audioUrl = row.audio_url;
        if (!audioUrl?.startsWith(R2_PUBLIC_URL)) {
          const fallback = audioUrl ? `${audioUrl}#t=${clipStart},${clipEnd}` : null;
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ url: fallback, start: clipStart, end: clipEnd, located, fallback: true }),
            }],
          };
        }

        const clipUrl = `${CLIP_BASE_URL}/clip?sermon_id=${encodeURIComponent(sermon_id)}&start=${clipStart}&end=${clipEnd}`;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ url: clipUrl, start: clipStart, end: clipEnd, located, fallback: false }),
          }],
        };
      },
    );

    return server;
  };
}

// ── get_clip helpers ──────────────────────────────────────────────────────────

function normaliseText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Map a character offset in normalised text back to the original string.
// Punctuation is stripped in normalised form, so each normalised char maps to
// one or more original chars; spaces collapse.
function normOffsetToOrig(original: string, normTarget: number): number {
  let normCount = 0;
  let lastWasSpace = true; // treat start-of-string as a space boundary
  for (let i = 0; i < original.length; i++) {
    if (normCount >= normTarget) return i;
    const c = original[i];
    if (/[a-z0-9]/i.test(c)) {
      normCount++;
      lastWasSpace = false;
    } else if (/\s/.test(c)) {
      if (!lastWasSpace) {
        normCount++; // collapsed space counts as one normalised char
        lastWasSpace = true;
      }
      // else: consecutive whitespace, skip
    }
    // punctuation: skip (doesn't contribute to normalised length)
  }
  return original.length;
}

type LocateResult = { start: number; end: number; located: 'quote' | 'chunk' };

type TranscriptChunk = {
  id: string;
  idx: number;
  content: string;
  markers: { time: number; charOffset: number }[];
  time_range_start: number;
  time_range_end: number;
};

async function locateQuote(
  env: Env,
  sermon_id: string,
  chunkCountsJson: string | null,
  quote: string,
): Promise<LocateResult> {
  // Build IDs for all transcript_section chunks in this sermon.
  const chunkCounts = chunkCountsJson ? JSON.parse(chunkCountsJson) : {};
  const transcriptCount: number = chunkCounts.transcript_section ?? 0;

  let chunks: TranscriptChunk[] = [];

  if (transcriptCount > 0) {
    const ids = Array.from({ length: transcriptCount }, (_, i) =>
      makeChunkId(sermon_id, 'transcript_section', i),
    );
    const vectors = await getByIdsBatched(env.VECTORIZE,ids);
    chunks = vectors
      .map(v => {
        if (!v.metadata) return null;
        const m = v.metadata as Record<string, unknown>;
        const idx = ids.indexOf(v.id);
        return {
          id: v.id,
          idx,
          content: (m.content as string) ?? '',
          markers: JSON.parse((m.markers as string) ?? '[]') as { time: number; charOffset: number }[],
          time_range_start: (m.time_range_start as number) ?? 0,
          time_range_end: (m.time_range_end as number) ?? 0,
        };
      })
      .filter((c): c is TranscriptChunk => c !== null)
      .sort((a, b) => a.idx - b.idx);
  }

  // Search every chunk for the quote — try original text first, then normalised.
  const normQuote = normaliseText(quote).slice(0, 30);
  const quotePrefix = quote.slice(0, 30);

  let matchChunk: TranscriptChunk | null = null;
  let quoteOffset = -1;

  for (const chunk of chunks) {
    // Primary: original text indexOf (exact punctuation match)
    const origIdx = chunk.content.indexOf(quotePrefix);
    if (origIdx !== -1) {
      matchChunk = chunk;
      quoteOffset = origIdx;
      break;
    }
    // Secondary: normalised match
    const normContent = normaliseText(chunk.content);
    const normIdx = normContent.indexOf(normQuote);
    if (normIdx !== -1) {
      matchChunk = chunk;
      quoteOffset = normOffsetToOrig(chunk.content, normIdx);
      break;
    }
  }

  if (matchChunk) {
    const { markers, time_range_start, time_range_end, idx } = matchChunk;

    const beforeMarker = markers.filter(m => m.charOffset <= quoteOffset).pop();
    const afterMarker = markers.find(m => m.charOffset > quoteOffset);

    const clipStart = Math.max(0, (beforeMarker?.time ?? time_range_start) - 1);

    let clipEnd: number;
    if (afterMarker) {
      clipEnd = afterMarker.time + 1;
    } else {
      // No later marker in this chunk — use next chunk's start time if available.
      const nextChunk = chunks.find(c => c.idx === idx + 1);
      clipEnd = nextChunk ? nextChunk.time_range_start : time_range_end + 60;
    }

    return { start: clipStart, end: clipEnd, located: 'quote' };
  }

  // Fallback: top-3 vector search, check all three chunks.
  const queryEmbedding = await embedQuery(quote, env.VOYAGE_API_KEY);
  const vectorMatches = await env.VECTORIZE.query(queryEmbedding, {
    topK: 3,
    filter: {
      chunk_type: { $eq: 'transcript_section' },
      sermon_id: { $eq: sermon_id },
    } as unknown as VectorizeVectorMetadataFilter,
    returnMetadata: 'indexed',
  });

  if (vectorMatches.matches.length > 0) {
    const matchIds = vectorMatches.matches.map(m => m.id);
    const fullVectors = await getByIdsBatched(env.VECTORIZE,matchIds);
    const firstWithMeta = fullVectors.find(v => v.metadata);
    if (firstWithMeta?.metadata) {
      const m = firstWithMeta.metadata as Record<string, unknown>;
      return {
        start: Math.max(0, (m.time_range_start as number ?? 0) - 1),
        end: (m.time_range_end as number ?? 60) + 1,
        located: 'chunk',
      };
    }
  }

  // Last resort: start=0, end=60.
  return { start: 0, end: 60, located: 'chunk' };
}
