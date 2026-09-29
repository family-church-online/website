import type { ChunkCounts, SermonFrontmatter } from './types';

// ── Speaker / tag resolution ──────────────────────────────────────────────────

export async function resolveCanonicalSpeaker(db: D1Database, partial: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT DISTINCT speaker FROM sermons WHERE speaker LIKE '%' || ? || '%' COLLATE NOCASE AND speaker IS NOT NULL LIMIT 1")
    .bind(partial)
    .first<{ speaker: string }>();
  return row?.speaker ?? null;
}

export async function getSermonIdsByTag(db: D1Database, tag: string): Promise<string[]> {
  const rows = await db
    .prepare('SELECT sermon_id FROM sermon_tags WHERE tag = ?')
    .bind(tag)
    .all<{ sermon_id: string }>();
  return rows.results.map(r => r.sermon_id);
}

// ── list_sermons ──────────────────────────────────────────────────────────────

export interface ListSermonsOptions {
  series?: string;
  speaker?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface SermonListItem {
  id: string;
  title: string;
  date: string;
  speaker: string | null;
  series: string | null;
  scripture: string | null;
}

export async function listSermons(db: D1Database, opts: ListSermonsOptions): Promise<SermonListItem[]> {
  const { series, speaker, tag, limit = 20, offset = 0 } = opts;
  const params: unknown[] = [];
  const where: string[] = ['s.review = 0'];

  let sql = 'SELECT DISTINCT s.id, s.title, s.date, s.speaker, s.series, s.scripture FROM sermons s';

  if (tag) {
    sql += ' JOIN sermon_tags t ON t.sermon_id = s.id';
    where.push('t.tag = ?');
    params.push(tag);
  }
  if (speaker) {
    where.push("s.speaker LIKE '%' || ? || '%' COLLATE NOCASE");
    params.push(speaker);
  }
  if (series) {
    where.push("s.series LIKE '%' || ? || '%' COLLATE NOCASE");
    params.push(series);
  }

  sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY s.date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(sql).bind(...params).all<SermonListItem>();
  return rows.results;
}

// ── find_by_scripture ─────────────────────────────────────────────────────────

export interface ScriptureMatch {
  id: string;
  title: string;
  date: string;
  speaker: string | null;
  scripture: string | null;
  matched_via: 'primary' | 'additional';
  matched_text: string;
}

export async function findByScripture(db: D1Database, reference: string): Promise<ScriptureMatch[]> {
  const primary = await db
    .prepare(`
      SELECT id, title, date, speaker, scripture,
             'primary' as matched_via, scripture as matched_text
      FROM sermons
      WHERE scripture LIKE '%' || ? || '%' COLLATE NOCASE AND review = 0
      ORDER BY date DESC
    `)
    .bind(reference)
    .all<ScriptureMatch>();

  const additional = await db
    .prepare(`
      SELECT s.id, s.title, s.date, s.speaker, s.scripture,
             'additional' as matched_via, a.ref as matched_text
      FROM sermons s
      JOIN sermon_additional_scriptures a ON a.sermon_id = s.id
      WHERE a.ref LIKE '%' || ? || '%' COLLATE NOCASE AND s.review = 0
      ORDER BY s.date DESC
    `)
    .bind(reference)
    .all<ScriptureMatch>();

  return [...primary.results, ...additional.results];
}

// ── get_sermon ────────────────────────────────────────────────────────────────

export interface SermonFull {
  id: string;
  title: string;
  date: string;
  speaker: string | null;
  series: string | null;
  scripture: string | null;
  primary_theme: string | null;
  big_idea: string | null;
  key_scripture_ref: string | null;
  key_scripture_text: string | null;
  key_illustration: string | null;
  to_remember: string | null;
  closing_prayer: string | null;
  tag_line: string | null;
  short_description: string | null;
  subtitle: string | null;
  hook: string | null;
  style: string | null;
  level: string | null;
  image: string | null;
  audio_url: string | null;
  audio_size_bytes: number | null;
  vimeo_url: string | null;
  duration_minutes: number | null;
  guid: string | null;
  main_points: { title: string; body: string }[];
  application: string[];
  takeaways: string[];
  audience: string[];
  categories: string[];
  tags: string[];
  additional_scriptures: { ref: string; theme: string | null }[];
}

export async function getSermon(db: D1Database, id: string): Promise<SermonFull | null> {
  const row = await db
    .prepare('SELECT * FROM sermons WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const [tagsResult, additionalResult] = await Promise.all([
    db.prepare('SELECT tag FROM sermon_tags WHERE sermon_id = ? ORDER BY tag').bind(id).all<{ tag: string }>(),
    db.prepare('SELECT ref, theme FROM sermon_additional_scriptures WHERE sermon_id = ? ORDER BY id').bind(id).all<{ ref: string; theme: string | null }>(),
  ]);

  return {
    id: row.id as string,
    title: row.title as string,
    date: row.date as string,
    speaker: row.speaker as string | null,
    series: row.series as string | null,
    scripture: row.scripture as string | null,
    primary_theme: row.primary_theme as string | null,
    big_idea: row.big_idea as string | null,
    key_scripture_ref: row.key_scripture_ref as string | null,
    key_scripture_text: row.key_scripture_text as string | null,
    key_illustration: row.key_illustration as string | null,
    to_remember: row.to_remember as string | null,
    closing_prayer: row.closing_prayer as string | null,
    tag_line: row.tag_line as string | null,
    short_description: row.short_description as string | null,
    subtitle: row.subtitle as string | null,
    hook: row.hook as string | null,
    style: row.style as string | null,
    level: row.level as string | null,
    image: row.image as string | null,
    audio_url: row.audio_url as string | null,
    audio_size_bytes: row.audio_size_bytes as number | null,
    vimeo_url: row.vimeo_url as string | null,
    duration_minutes: row.duration_minutes as number | null,
    guid: row.guid as string | null,
    main_points: JSON.parse(row.main_points as string || '[]'),
    application: JSON.parse(row.application as string || '[]'),
    takeaways: JSON.parse(row.takeaways as string || '[]'),
    audience: JSON.parse(row.audience as string || '[]'),
    categories: JSON.parse(row.categories as string || '[]'),
    tags: tagsResult.results.map(t => t.tag),
    additional_scriptures: additionalResult.results,
  };
}

// ── get_summary ───────────────────────────────────────────────────────────────

export interface SermonSummary {
  id: string;
  title: string;
  date: string;
  speaker: string | null;
  scripture: string | null;
  big_idea: string | null;
  main_points: { title: string; body: string }[];
  to_remember: string | null;
  key_illustration: string | null;
}

export async function getSermonSummary(db: D1Database, id: string): Promise<SermonSummary | null> {
  const row = await db
    .prepare('SELECT id, title, date, speaker, scripture, big_idea, main_points, to_remember, key_illustration FROM sermons WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;

  return {
    id: row.id as string,
    title: row.title as string,
    date: row.date as string,
    speaker: row.speaker as string | null,
    scripture: row.scripture as string | null,
    big_idea: row.big_idea as string | null,
    main_points: JSON.parse(row.main_points as string || '[]'),
    to_remember: row.to_remember as string | null,
    key_illustration: row.key_illustration as string | null,
  };
}

// ── Framing context (enriched reranking) ─────────────────────────────────────

export interface FramingContext {
  title: string;
  series: string | null;
  main_points: { title: string; body: string }[];
  takeaways: string[];
  audience: string[];
}

export async function getFramingContext(
  db: D1Database,
  sermonIds: string[],
): Promise<Map<string, FramingContext>> {
  if (!sermonIds.length) return new Map();
  const placeholders = sermonIds.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT id, title, series, main_points, takeaways, audience FROM sermons WHERE id IN (${placeholders})`,
    )
    .bind(...sermonIds)
    .all<{ id: string; title: string; series: string | null; main_points: string; takeaways: string; audience: string }>();

  const map = new Map<string, FramingContext>();
  for (const row of rows.results) {
    map.set(row.id, {
      title: row.title,
      series: row.series,
      main_points: JSON.parse(row.main_points || '[]'),
      takeaways: JSON.parse(row.takeaways || '[]'),
      audience: JSON.parse(row.audience || '[]'),
    });
  }
  return map;
}

// For find_for_situation: full table of audience situations with sermon framing.
// Bypasses Vectorize entirely — raw cosine distance buries strong matches for
// short curated audience blurbs, which are phrased close to how users ask.
export interface AudienceSituationRow {
  sermon_id: string;
  title: string;
  series: string | null;
  speaker: string | null;
  date: string;
  scripture: string | null;
  audience: string[];
  main_points: { title: string; body: string }[];
  takeaways: string[];
}

export async function getAllAudienceSituations(
  db: D1Database,
  speaker?: string,
): Promise<AudienceSituationRow[]> {
  let sql = `SELECT id, title, series, speaker, date, scripture, audience, main_points, takeaways
             FROM sermons WHERE review = 0 AND audience IS NOT NULL AND audience != '[]'`;
  const params: unknown[] = [];

  if (speaker) {
    sql += " AND speaker LIKE '%' || ? || '%' COLLATE NOCASE";
    params.push(speaker);
  }
  sql += ' ORDER BY date DESC';

  const rows = await db
    .prepare(sql)
    .bind(...params)
    .all<{
      id: string; title: string; series: string | null; speaker: string | null;
      date: string; scripture: string | null; audience: string; main_points: string; takeaways: string;
    }>();

  return rows.results.map(row => ({
    sermon_id: row.id,
    title: row.title,
    series: row.series,
    speaker: row.speaker,
    date: row.date,
    scripture: row.scripture,
    audience: JSON.parse(row.audience || '[]'),
    main_points: JSON.parse(row.main_points || '[]'),
    takeaways: JSON.parse(row.takeaways || '[]'),
  }));
}

// ── chunk_counts (for delete-before-reindex) ──────────────────────────────────

export async function getChunkCounts(db: D1Database, sermon_id: string): Promise<ChunkCounts | null> {
  const row = await db
    .prepare('SELECT chunk_counts FROM sermons WHERE id = ?')
    .bind(sermon_id)
    .first<{ chunk_counts: string }>();
  if (!row) return null;
  return JSON.parse(row.chunk_counts || '{}') as ChunkCounts;
}

// ── ingestion writes ──────────────────────────────────────────────────────────

export async function upsertSermon(
  db: D1Database,
  sermon_id: string,
  fm: SermonFrontmatter,
  chunk_counts: ChunkCounts,
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO sermons (
        id, title, date, speaker, series, scripture, primary_theme,
        big_idea, key_scripture_ref, key_scripture_text, key_illustration,
        to_remember, closing_prayer, tag_line, short_description, subtitle,
        hook, style, level, image, audio_url, audio_size_bytes, vimeo_url,
        duration_minutes, guid, transcribed_by, word_count, review,
        main_points, application, takeaways, audience, categories, chunk_counts,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        title              = excluded.title,
        date               = excluded.date,
        speaker            = excluded.speaker,
        series             = excluded.series,
        scripture          = excluded.scripture,
        primary_theme      = excluded.primary_theme,
        big_idea           = excluded.big_idea,
        key_scripture_ref  = excluded.key_scripture_ref,
        key_scripture_text = excluded.key_scripture_text,
        key_illustration   = excluded.key_illustration,
        to_remember        = excluded.to_remember,
        closing_prayer     = excluded.closing_prayer,
        tag_line           = excluded.tag_line,
        short_description  = excluded.short_description,
        subtitle           = excluded.subtitle,
        hook               = excluded.hook,
        style              = excluded.style,
        level              = excluded.level,
        image              = excluded.image,
        audio_url          = excluded.audio_url,
        audio_size_bytes   = excluded.audio_size_bytes,
        vimeo_url          = excluded.vimeo_url,
        duration_minutes   = excluded.duration_minutes,
        guid               = excluded.guid,
        transcribed_by     = excluded.transcribed_by,
        word_count         = excluded.word_count,
        review             = excluded.review,
        main_points        = excluded.main_points,
        application        = excluded.application,
        takeaways          = excluded.takeaways,
        audience           = excluded.audience,
        categories         = excluded.categories,
        chunk_counts       = excluded.chunk_counts,
        updated_at         = excluded.updated_at
    `)
    .bind(
      sermon_id,
      fm.title,
      fm.date,
      fm.speaker ?? null,
      fm.series ?? null,
      fm.scripture ?? null,
      fm.primaryTheme ?? null,
      fm.bigIdea ?? null,
      fm.keyScriptureRef ?? null,
      fm.keyScriptureText ?? null,
      fm.keyIllustration ?? null,
      fm.toRemember ?? null,
      fm.closingPrayer ?? null,
      fm.tagLine ?? null,
      fm.shortDescription ?? null,
      fm.subtitle ?? null,
      fm.hook ?? null,
      fm.style ?? null,
      fm.level ?? null,
      (fm.image?.trim()) ? fm.image : null,
      fm.audioUrl ?? null,
      fm.audioSizeBytes ?? null,
      fm.vimeoUrl ?? null,
      fm.durationMinutes ?? null,
      fm.guid ?? null,
      fm.transcribedBy ?? null,
      fm.wordCount ?? null,
      fm.review ? 1 : 0,
      JSON.stringify(fm.mainPoints ?? []),
      JSON.stringify(fm.application ?? []),
      JSON.stringify(fm.takeaways ?? []),
      JSON.stringify(fm.audience ?? []),
      JSON.stringify(fm.categories ?? []),
      JSON.stringify(chunk_counts),
    )
    .run();
}

export async function upsertTags(db: D1Database, sermon_id: string, tags: string[]): Promise<void> {
  await db.prepare('DELETE FROM sermon_tags WHERE sermon_id = ?').bind(sermon_id).run();
  if (!tags.length) return;
  await db.batch(
    tags.map(tag =>
      db.prepare('INSERT INTO sermon_tags (sermon_id, tag) VALUES (?, ?)').bind(sermon_id, tag),
    ),
  );
}

export async function upsertAdditionalScriptures(
  db: D1Database,
  sermon_id: string,
  scriptures: { ref: string; theme?: string }[],
): Promise<void> {
  await db
    .prepare('DELETE FROM sermon_additional_scriptures WHERE sermon_id = ?')
    .bind(sermon_id)
    .run();
  if (!scriptures.length) return;
  await db.batch(
    scriptures.map(s =>
      db
        .prepare('INSERT INTO sermon_additional_scriptures (sermon_id, ref, theme) VALUES (?, ?, ?)')
        .bind(sermon_id, s.ref, s.theme ?? null),
    ),
  );
}
