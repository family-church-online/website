import type { ChunkCounts, ChunkToEmbed } from './types';
import { makeChunkId } from './utils';

const EMBED_MODEL = 'voyage-context-4';
const RERANK_MODEL = 'rerank-2.5-lite';
// Max chunks per contextualized_embed group call. Voyage's docs specify per-call
// limits by token count, not item count — 128 is a conservative item cap.
const EMBED_GROUP_LIMIT = 128;
const INSERT_BATCH_SIZE = 500; // Vectorize recommended batch size

// ── Voyage embedding ──────────────────────────────────────────────────────────

// Embed chunks using voyage-context-4 contextual embedding.
// All chunks passed here are assumed to be from a single sermon (one document),
// so they are sent as one group — Voyage contextualises each chunk against its
// siblings rather than against a synthetic metadata string.
//
// Response shape (empirically inferred from the pair-based format — verify on
// a real grouped call if behaviour seems wrong):
//   { data: [{ index: 0, data: [{ embedding: [...], index: 0 }, ...] }] }
//   data[0].data[i].embedding = embedding for the i-th text in the group.
export async function embedChunks(chunks: ChunkToEmbed[], apiKey: string): Promise<number[][]> {
  if (!chunks.length) return [];

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < chunks.length; i += EMBED_GROUP_LIMIT) {
    const group = chunks.slice(i, i + EMBED_GROUP_LIMIT);

    const res = await fetch('https://api.voyageai.com/v1/contextualizedembeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBED_MODEL,
        // One outer group = one document's chunks; Voyage contextualises each
        // chunk against the others in the same group.
        inputs: [group.map((c) => c.text)],
        input_type: 'document',
      }),
    });
    if (!res.ok) throw new Error(`Voyage embed error ${res.status}: ${await res.text()}`);

    const body = await res.json() as {
      data: { index: number; data: { embedding: number[]; index: number }[] }[];
    };
    // data[0] = the single group; data[0].data = one embedding per chunk, in order.
    const groupEmbeddings = body.data[0].data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
    allEmbeddings.push(...groupEmbeddings);
  }

  return allEmbeddings;
}

// Embed a single query string.
export async function embedQuery(query: string, apiKey: string): Promise<number[]> {
  // For queries: single plain string (no context), same endpoint + model for embedding space consistency
  const res = await fetch('https://api.voyageai.com/v1/contextualizedembeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, inputs: [query], input_type: 'query' }),
  });
  if (!res.ok) throw new Error(`Voyage embed error ${res.status}: ${await res.text()}`);

  const body = await res.json() as {
    data: { index: number; data: { embedding: number[]; index: number }[] }[];
  };
  return body.data[0].data[0].embedding;
}

// ── Voyage reranking ──────────────────────────────────────────────────────────

export async function rerank(
  query: string,
  documents: string[],
  apiKey: string,
  topK: number,
): Promise<{ index: number; score: number }[]> {
  if (!documents.length) return [];

  const res = await fetch('https://api.voyageai.com/v1/rerank', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: RERANK_MODEL,
      query,
      documents,
      top_k: Math.min(topK, documents.length),
      return_documents: false,
    }),
  });
  if (!res.ok) throw new Error(`Voyage rerank error ${res.status}: ${await res.text()}`);

  const data = await res.json() as { data: { relevance_score: number; index: number }[] };
  return data.data.map(d => ({ index: d.index, score: d.relevance_score }));
}

// ── Vectorize writes ──────────────────────────────────────────────────────────

// Delete all vectors for a sermon using the deterministic ID scheme.
// The stored chunk_counts lets us reconstruct every ID without scanning.
export async function deleteSermonVectors(
  vectorize: VectorizeIndex,
  sermon_id: string,
  counts: ChunkCounts,
): Promise<void> {
  const ids: string[] = [];
  for (const [type, count] of Object.entries(counts) as [keyof ChunkCounts, number][]) {
    for (let i = 0; i < count; i++) {
      ids.push(makeChunkId(sermon_id, type, i));
    }
  }
  if (ids.length > 0) await vectorize.deleteByIds(ids);
}

export async function insertVectors(
  vectorize: VectorizeIndex,
  chunks: ChunkToEmbed[],
  embeddings: number[][],
): Promise<void> {
  const vectors = chunks.map((c, i) => ({
    id: c.id,
    values: embeddings[i],
    metadata: c.metadata as unknown as Record<string, VectorizeVectorMetadataValue>,
  }));

  for (let i = 0; i < vectors.length; i += INSERT_BATCH_SIZE) {
    await vectorize.insert(vectors.slice(i, i + INSERT_BATCH_SIZE));
  }
}
