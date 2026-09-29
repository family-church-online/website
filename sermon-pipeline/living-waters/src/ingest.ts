import yaml from 'js-yaml';
import type { Env, SermonFrontmatter, TranscriptSection, ChunkToEmbed, ChunkCounts } from './types';
import { getChunkCounts, upsertSermon, upsertTags, upsertAdditionalScriptures } from './db';
import { embedChunks, deleteSermonVectors, insertVectors } from './vectorize';
import { makeChunkId } from './utils';

// ── Frontmatter parsing ───────────────────────────────────────────────────────

function parseMdxFrontmatter(content: string): { data: SermonFrontmatter; body: string } {
  const endIdx = content.indexOf('\n---\n', 4);
  if (!content.startsWith('---\n') || endIdx === -1) {
    return { data: {} as SermonFrontmatter, body: content };
  }
  const yamlStr = content.slice(4, endIdx);
  const body = content.slice(endIdx + 5);
  const data = (yaml.load(yamlStr) ?? {}) as SermonFrontmatter;
  // js-yaml converts unquoted YYYY-MM-DD values to JS Date objects; normalise to string
  if (data.date && typeof (data.date as unknown) !== 'string') {
    data.date = new Date(data.date as unknown as string | number).toISOString().slice(0, 10);
  }
  return { data, body };
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function parseTimestamp(mmss: string): number {
  const parts = mmss.split(':');
  return Number(parts[0]) * 60 + Number(parts[1] ?? 0);
}

function extractMarkers(text: string): { time: number; charOffset: number }[] {
  const markers: { time: number; charOffset: number }[] = [];
  const re = /\[(\d+:\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    markers.push({ time: parseTimestamp(m[1]), charOffset: m.index });
  }
  return markers;
}

// ── Chunk splitting ───────────────────────────────────────────────────────────

const MAX_CHUNK_WORDS = 600;

// Split a section that exceeds MAX_CHUNK_WORDS on sentence boundaries.
function splitOversizedSection(text: string): string[] {
  const words = text.split(/\s+/);
  if (words.length <= MAX_CHUNK_WORDS) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const parts: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).length;
    if (currentWords + sentenceWords > MAX_CHUNK_WORDS && current.length > 0) {
      parts.push(current.join('').trim());
      current = [];
      currentWords = 0;
    }
    current.push(sentence);
    currentWords += sentenceWords;
  }
  if (current.length > 0) parts.push(current.join('').trim());
  return parts;
}

// ── Transcript section parsing ────────────────────────────────────────────────

// Split on ### headers. Works for both 2023-era (straight ### ) and 2026-era
// (with # Title / ## Transcript wrapper before the first ### ) files.
function parseTranscriptSections(body: string): TranscriptSection[] {
  const parts = body.split(/(?=^### )/m);
  const sections: TranscriptSection[] = [];
  let lastKnownTime = 0;

  for (const part of parts) {
    const headingMatch = part.match(/^### (.+)$/m);
    if (!headingMatch) continue;

    const heading = headingMatch[1].trim();
    const text = part.slice(headingMatch.index! + headingMatch[0].length).trim();
    if (!text) continue;

    for (const subText of splitOversizedSection(text)) {
      const markers = extractMarkers(subText);
      const start = markers[0]?.time ?? lastKnownTime;
      const end = markers[markers.length - 1]?.time ?? lastKnownTime;
      if (end > lastKnownTime) lastKnownTime = end;
      sections.push({ heading, text: subText, time_range_start: start, time_range_end: end, markers });
    }
  }

  return sections;
}

// ── Chunk builder ─────────────────────────────────────────────────────────────

export function buildChunks(
  sermon_id: string,
  fm: SermonFrontmatter,
  body: string,
): { chunks: ChunkToEmbed[]; counts: ChunkCounts } {
  const baseMeta = {
    sermon_id,
    speaker: fm.speaker ?? '',
    date: fm.date ?? '',
    title: fm.title ?? '',
    scripture: fm.scripture ?? '',
  };

  const chunks: ChunkToEmbed[] = [];

  // 1. Transcript sections
  const sections = parseTranscriptSections(body);
  if (sections.length === 0) {
    console.error(
      `[ingest] WARNING: sermon "${sermon_id}" has no ### transcript headers — ` +
      'zero transcript_section chunks will be produced. Ingestion is continuing, ' +
      'but this sermon will not be searchable by transcript content.',
    );
  }
  sections.forEach((sec, idx) => {
    chunks.push({
      id: makeChunkId(sermon_id, 'transcript_section', idx),
      chunk_type: 'transcript_section',
      text: sec.text,
      metadata: {
        ...baseMeta,
        chunk_type: 'transcript_section',
        content: sec.text.slice(0, 2000),
        time_range_start: sec.time_range_start,
        time_range_end: sec.time_range_end,
        markers: JSON.stringify(sec.markers),
      },
    });
  });

  // 2. Main points
  (fm.mainPoints ?? []).forEach((mp, idx) => {
    const text = mp.title ? `${mp.title}: ${mp.body}` : mp.body;
    chunks.push({
      id: makeChunkId(sermon_id, 'main_point', idx),
      chunk_type: 'main_point',
      text,
      metadata: { ...baseMeta, chunk_type: 'main_point', content: text.slice(0, 2000) },
    });
  });

  // 3. Audience situations (second-person situational language — primary signal for find_for_situation)
  (fm.audience ?? []).forEach((aud, idx) => {
    chunks.push({
      id: makeChunkId(sermon_id, 'audience_situation', idx),
      chunk_type: 'audience_situation',
      text: aud,
      metadata: { ...baseMeta, chunk_type: 'audience_situation', content: aud.slice(0, 2000) },
    });
  });

  // 4. Key illustration (leaders often recall sermons by anecdote, not doctrine)
  if (fm.keyIllustration) {
    chunks.push({
      id: makeChunkId(sermon_id, 'key_illustration', 0),
      chunk_type: 'key_illustration',
      text: fm.keyIllustration,
      metadata: {
        ...baseMeta,
        chunk_type: 'key_illustration',
        content: fm.keyIllustration.slice(0, 2000),
      },
    });
  }

  // 5. Big idea — short high-signal statement, valuable to match directly against queries
  if (fm.bigIdea) {
    chunks.push({
      id: makeChunkId(sermon_id, 'big_idea', 0),
      chunk_type: 'big_idea',
      text: fm.bigIdea,
      metadata: {
        ...baseMeta,
        chunk_type: 'big_idea',
        content: fm.bigIdea.slice(0, 2000),
      },
    });
  }

  // 6. Practical application — one chunk per takeaway/application item
  const appItems = [
    ...(fm.takeaways ?? []),
    ...(fm.application ?? []),
  ];
  appItems.forEach((item, idx) => {
    chunks.push({
      id: makeChunkId(sermon_id, 'practical_application', idx),
      chunk_type: 'practical_application',
      text: item,
      metadata: { ...baseMeta, chunk_type: 'practical_application', content: item.slice(0, 2000) },
    });
  });

  const counts: ChunkCounts = {
    transcript_section: sections.length,
    main_point: (fm.mainPoints ?? []).length,
    audience_situation: (fm.audience ?? []).length,
    key_illustration: fm.keyIllustration ? 1 : 0,
    big_idea: fm.bigIdea ? 1 : 0,
    practical_application: appItems.length,
  };

  return { chunks, counts };
}

// ── Full ingest pipeline ──────────────────────────────────────────────────────

// Called by both the /ingest Worker endpoint and (with a local env adapter)
// the backfill script. Handles delete-before-reindex on re-ingestion.
export async function ingestSermon(
  env: { DB: D1Database; VECTORIZE: VectorizeIndex; VOYAGE_API_KEY: string },
  mdxContent: string,
  filename: string,
): Promise<{ sermon_id: string; chunk_count: number }> {
  const sermon_id = filename.replace(/\.mdx$/, '');
  const { data: fm, body } = parseMdxFrontmatter(mdxContent);

  if (fm.review === true) {
    throw new Error(`Sermon ${sermon_id} has review: true — skipping unstaged content`);
  }

  const { chunks, counts } = buildChunks(sermon_id, fm, body);

  // Delete existing vectors before writing new ones. The deterministic ID
  // scheme means shrinking arrays (e.g. mainPoints going 4→3) would leave a
  // stale vector behind without this explicit delete step.
  const existingCounts = await getChunkCounts(env.DB, sermon_id);
  if (existingCounts) {
    const total = Object.values(existingCounts).reduce((s, n) => s + n, 0);
    if (total > 0) await deleteSermonVectors(env.VECTORIZE, sermon_id, existingCounts);
  }

  const embeddings = await embedChunks(chunks, env.VOYAGE_API_KEY);
  await insertVectors(env.VECTORIZE, chunks, embeddings);
  await upsertSermon(env.DB, sermon_id, fm, counts);
  await upsertTags(env.DB, sermon_id, fm.tags ?? []);
  await upsertAdditionalScriptures(env.DB, sermon_id, fm.additionalScriptures ?? []);

  return { sermon_id, chunk_count: chunks.length };
}
