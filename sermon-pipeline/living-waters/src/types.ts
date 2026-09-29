export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AUDIO_BUCKET: R2Bucket;
  VOYAGE_API_KEY: string;
  INGEST_SECRET: string;
  // Controls what the reranker reads for each chunk in search():
  //   'none' (default): bare chunk content only — no framing context D1 lookup.
  //   'big_idea': prepends "Big idea: {big_idea}\n" to the chunk content.
  RERANK_CONTEXT?: string;
}

// Frontmatter shape from sermon MDX files
export interface SermonFrontmatter {
  title: string;
  date: string;                          // YYYY-MM-DD
  speaker?: string;
  series?: string;
  scripture?: string;
  primaryTheme?: string;
  additionalScriptures?: { ref: string; theme?: string }[];
  image?: string;
  audioUrl?: string;
  audioSizeBytes?: number;
  vimeoUrl?: string;
  durationMinutes?: number;
  tagLine?: string;
  shortDescription?: string;
  subtitle?: string;
  hook?: string;
  style?: string;
  level?: string;
  takeaways?: string[];
  audience?: string[];
  bigIdea?: string;
  keyScriptureRef?: string;
  keyScriptureText?: string;
  mainPoints?: { title: string; body: string }[];
  keyIllustration?: string;
  application?: string[];
  toRemember?: string;
  closingPrayer?: string;
  categories?: string[];
  tags?: string[];
  guid?: string;
  review?: boolean;
  transcribedBy?: string;
  wordCount?: number;
}

// A transcript section parsed from the MDX body
export interface TranscriptSection {
  heading: string;
  text: string;
  time_range_start: number;  // seconds (0 if no [MM:SS] markers found)
  time_range_end: number;
  markers: { time: number; charOffset: number }[];
}

// Chunk counts per type — stored in D1 for delete-before-reindex
export interface ChunkCounts {
  transcript_section: number;
  main_point: number;
  audience_situation: number;
  key_illustration: number;
  big_idea: number;
  practical_application: number;
}

// Vectorize metadata — all values must be string | number | boolean
export interface VectorMetadata {
  sermon_id: string;
  chunk_type: string;
  speaker: string;
  date: string;
  title: string;
  scripture: string;
  content: string;            // the chunk text, stored for self-contained search results
  // transcript_section only:
  time_range_start?: number;
  time_range_end?: number;
  markers?: string;           // JSON-stringified {time: number, charOffset: number}[]
}

export type ChunkType =
  | 'transcript_section'
  | 'main_point'
  | 'audience_situation'
  | 'key_illustration'
  | 'big_idea'
  | 'practical_application';

// A chunk ready to embed and insert into Vectorize
export interface ChunkToEmbed {
  id: string;
  chunk_type: ChunkType;
  text: string;
  metadata: VectorMetadata;
}
