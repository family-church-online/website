import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Env } from './types';
import * as db from './db';
import type { FramingContext, AudienceSituationRow } from './db';
import { embedQuery, rerank } from './vectorize';

const CANDIDATE_POOL = 30;          // wide Vectorize retrieval before Voyage rerank
const STAGE_A_SHORTLIST_SIZE = 150; // find_for_situation: Stage A shortlist per sermon
const RERANK_MAX_DOCS = 900;        // Voyage rerank API batch limit
const R2_PUBLIC_URL = 'https://audio.familychurch.online';
const CLIP_BASE_URL = 'https://mcp.familychurch.online';

// Build an enriched rerank document matching the old Lambda design:
//   title — series
//   Main points: X / Y
//   Key takeaways: A / B
//   For someone who: ...
//   [chunk content]
// The reranker needs this context to judge relevance of a transcript chunk
// against the sermon's actual purpose — bare chunk text alone is insufficient.
function buildRerankDocument(framing: FramingContext | undefined, content: string): string {
  const parts: string[] = [];
  if (framing) {
    parts.push(framing.series ? `${framing.title} — ${framing.series}` : framing.title);
    if (framing.main_points.length) {
      const pts = framing.main_points.map(p => p.title || p.body).filter(Boolean);
      if (pts.length) parts.push('Main points: ' + pts.join(' / '));
    }
    if (framing.takeaways.length) {
      parts.push('Key takeaways: ' + framing.takeaways.join(' / '));
    }
    if (framing.audience.length) {
      parts.push('For someone who: ' + framing.audience.join(' / '));
    }
  }
  parts.push(content);
  return parts.join('\n');
}

// Build an enriched rerank document for a full sermon (find_for_situation Stage B).
function buildSermonRerankDocument(s: AudienceSituationRow): string {
  const parts: string[] = [s.series ? `${s.title} — ${s.series}` : s.title];
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
// Returns all documents scored — caller slices to top_k.
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
// env is captured via closure so tools can access D1/Vectorize without
// the factory needing to accept context arguments.
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

        // Build sermon ID filter: intersection of tag filter and sermon_ids param
        let sermonIdFilter: string[] | undefined;
        if (tag) {
          const tagIds = await db.getSermonIdsByTag(env.DB, tag);
          if (!tagIds.length) return { content: [{ type: 'text', text: '[]' }] };
          sermonIdFilter = sermon_ids
            ? tagIds.filter(id => sermon_ids.includes(id))
            : tagIds;
          if (!sermonIdFilter.length) return { content: [{ type: 'text', text: '[]' }] };
        } else if (sermon_ids?.length) {
          sermonIdFilter = sermon_ids;
        }

        const embedding = await embedQuery(query, env.VOYAGE_API_KEY);

        const filter = {
          chunk_type: chunk_type
            ? { $eq: chunk_type }
            : { $in: ['transcript_section', 'main_point', 'key_illustration', 'big_idea', 'practical_application'] },
          ...(canonicalSpeaker && { speaker: { $eq: canonicalSpeaker } }),
          ...(sermonIdFilter && { sermon_id: { $in: sermonIdFilter } }),
        } as unknown as VectorizeVectorMetadataFilter;

        const matches = await env.VECTORIZE.query(embedding, {
          topK: CANDIDATE_POOL,
          filter,
          returnMetadata: 'all',
        });

        if (!matches.matches.length) return { content: [{ type: 'text', text: '[]' }] };

        // Batch-fetch framing (main_points, takeaways, audience) for all candidate sermons
        // so the reranker sees each chunk in the context of its sermon's purpose.
        const sermonIds = [...new Set(
          matches.matches.map(m => (m.metadata as Record<string, unknown>).sermon_id as string),
        )];
        const framingMap = await db.getFramingContext(env.DB, sermonIds);

        const documents = matches.matches.map(m => {
          const meta = m.metadata as Record<string, unknown>;
          const framing = framingMap.get(meta.sermon_id as string);
          return buildRerankDocument(framing, meta.content as string ?? '');
        });

        const reranked = await rerank(query, documents, env.VOYAGE_API_KEY, top_k);

        const results = reranked.map(r => {
          const match = matches.matches[r.index];
          const meta = match.metadata as Record<string, unknown>;
          return {
            sermon_id: meta.sermon_id,
            title: meta.title,
            speaker: meta.speaker,
            date: meta.date,
            scripture: meta.scripture,
            chunk_type: meta.chunk_type,
            content: meta.content,
            relevance_score: r.score,
            ...(meta.chunk_type === 'transcript_section'
              ? { time_range_start: meta.time_range_start, time_range_end: meta.time_range_end }
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

        // Fetch all audience situations directly from D1 — bypass Vectorize.
        // Raw cosine distance buries strong matches for short curated blurbs
        // because they're phrased close to how users ask, inflating weaker matches.
        const allSermons = await db.getAllAudienceSituations(env.DB, canonicalSpeaker);
        if (!allSermons.length) return { content: [{ type: 'text', text: '[]' }] };

        // Flatten: one entry per audience blurb per sermon, tracking source sermon index
        const candidates: { sermonIdx: number; text: string }[] = [];
        for (let i = 0; i < allSermons.length; i++) {
          for (const text of allSermons[i].audience) {
            candidates.push({ sermonIdx: i, text });
          }
        }

        // Stage A: rerank bare audience texts, shortlist top unique sermons
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

        // Stage B: enrich shortlisted sermons with main_points + takeaways and rerank again
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
        const row = await env.DB.prepare('SELECT audio_url FROM sermons WHERE id = ?')
          .bind(sermon_id)
          .first<{ audio_url: string | null }>();

        if (!row) {
          return { content: [{ type: 'text', text: 'Sermon not found' }], isError: true };
        }

        let clipStart = start ?? 0;
        let clipEnd = end ?? clipStart + 60;

        if (quote && (start === undefined || end === undefined)) {
          // Find the transcript_section chunk closest to the quote and use
          // its precomputed markers array (stored at ingestion) to locate the
          // clip boundaries without re-parsing the full transcript.
          const embedding = await embedQuery(quote, env.VOYAGE_API_KEY);
          const matches = await env.VECTORIZE.query(embedding, {
            topK: 3,
            filter: { chunk_type: { $eq: 'transcript_section' }, sermon_id: { $eq: sermon_id } } as unknown as VectorizeVectorMetadataFilter,
            returnMetadata: 'all',
          });

          if (matches.matches.length > 0) {
            const meta = matches.matches[0].metadata as Record<string, unknown>;
            const markers: { time: number; charOffset: number }[] = JSON.parse(
              (meta.markers as string) ?? '[]',
            );
            const content = (meta.content as string) ?? '';
            const quoteOffset = content.indexOf(quote.slice(0, 30));

            if (markers.length > 0 && quoteOffset !== -1) {
              const before = markers.filter(m => m.charOffset <= quoteOffset).pop();
              const after = markers.find(m => m.charOffset > quoteOffset);
              clipStart = Math.max(0, (before?.time ?? (meta.time_range_start as number) ?? 0) - 1);
              clipEnd = (after?.time ?? (meta.time_range_end as number) ?? clipStart + 60) + 1;
            } else {
              clipStart = (meta.time_range_start as number) ?? 0;
              clipEnd = (meta.time_range_end as number) ?? clipStart + 60;
            }
          }
        }

        const audioUrl = row.audio_url;
        if (!audioUrl?.startsWith(R2_PUBLIC_URL)) {
          // Audio isn't in R2 — return a fragment URL as fallback
          const fallback = audioUrl ? `${audioUrl}#t=${clipStart},${clipEnd}` : null;
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ url: fallback, start: clipStart, end: clipEnd, fallback: true }),
            }],
          };
        }

        const clipUrl = `${CLIP_BASE_URL}/clip?sermon_id=${encodeURIComponent(sermon_id)}&start=${clipStart}&end=${clipEnd}`;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ url: clipUrl, start: clipStart, end: clipEnd, fallback: false }),
          }],
        };
      },
    );

    return server;
  };
}
