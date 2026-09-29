import { createMcpHandler } from 'agents/mcp/server';
import type { Env } from './types';
import { createServer } from './server';
import { ingestSermon, ingestSermonMetadata } from './ingest';

// Sermon audio is 64kbps CBR mono MP3 — byte-range math is exact.
const CBR_BYTES_PER_SECOND = 8000;
const R2_PUBLIC_URL = 'https://audio.familychurch.online';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── Public: audio clip byte-range serving ────────────────────────────
    if (url.pathname === '/clip') {
      return handleClip(request, env);
    }

    // ── Internal: per-sermon ingestion (called by SermonPublishWorkflow) ─
    if (url.pathname === '/ingest' && request.method === 'POST') {
      return handleIngest(request, env);
    }

    // ── Internal: metadata-only refresh (backfill after ingest.ts changes) ──
    if (url.pathname === '/ingest-metadata' && request.method === 'POST') {
      return handleIngestMetadata(request, env);
    }

    // All other paths only valid at /mcp
    if (url.pathname !== '/mcp') {
      return new Response('Not Found', { status: 404 });
    }

    // ── MCP endpoint: requires per-leader Bearer token auth ──────────────
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://claude.ai',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    };

    // CORS preflight — must respond before auth check (no credentials in OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

// Claude.ai sends the token raw (no "Bearer " prefix); accept both forms
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    const leader = await env.DB.prepare(
      'SELECT leader_name FROM leader_tokens WHERE token = ? AND revoked = 0',
    )
      .bind(token)
      .first<{ leader_name: string }>();

    if (!leader) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    const mcpResponse = await createMcpHandler(createServer(env))(request, env, ctx);
    const response = new Response(mcpResponse.body, mcpResponse);
    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  },
} satisfies ExportedHandler<Env>;

// ── /clip ─────────────────────────────────────────────────────────────────────

async function handleClip(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sermon_id = url.searchParams.get('sermon_id');
  const start = Number(url.searchParams.get('start') ?? '0');
  const end = Number(url.searchParams.get('end') ?? String(start + 60));

  if (!sermon_id) return new Response('Missing sermon_id', { status: 400 });
  if (isNaN(start) || isNaN(end) || end <= start)
    return new Response('Invalid start/end', { status: 400 });

  const row = await env.DB.prepare('SELECT audio_url, audio_size_bytes, duration_minutes FROM sermons WHERE id = ?')
    .bind(sermon_id)
    .first<{ audio_url: string | null; audio_size_bytes: number | null; duration_minutes: number | null }>();

  if (!row?.audio_url) return new Response('Sermon not found', { status: 404 });
  if (!row.audio_url.startsWith(R2_PUBLIC_URL)) return new Response('Audio not in R2', { status: 404 });

  // Strip base URL prefix to get R2 key: "sermons/YYYY-MM-DD-slug.mp3"
  const r2Key = row.audio_url.slice(R2_PUBLIC_URL.length).replace(/^\//, '');

  // Resolve the real file size: use D1 value if present, otherwise HEAD R2
  // (cheap metadata-only call, no body). Required for accurate byte math and
  // to clamp the range so we never overshoot the file.
  const fileSize: number | null = row.audio_size_bytes
    ?? (await env.AUDIO_BUCKET.head(r2Key))?.size
    ?? null;

  if (!fileSize) return new Response('Audio not found in R2', { status: 404 });

  // Derive bytes-per-second from real size + duration; fall back to 64kbps CBR.
  const bytesPerSecond = row.duration_minutes
    ? fileSize / (row.duration_minutes * 60)
    : CBR_BYTES_PER_SECOND;

  const byteStart = Math.floor(start * bytesPerSecond);
  const byteLength = Math.min(
    Math.ceil((end - start) * bytesPerSecond),
    fileSize - byteStart,
  );
  if (byteLength <= 0) return new Response('Start is beyond end of audio', { status: 416 });

  const obj = await env.AUDIO_BUCKET.get(r2Key, {
    range: { offset: byteStart, length: byteLength },
  });

  if (!obj) return new Response('Audio object missing from R2', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `attachment; filename="${sermon_id}-clip-${start}-${end}.mp3"`,
      'Content-Length': String(byteLength),
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── /ingest ───────────────────────────────────────────────────────────────────

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token !== env.INGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { mdx: string; filename: string };
  try {
    body = await request.json() as { mdx: string; filename: string };
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.mdx || !body.filename) {
    return new Response('Missing mdx or filename', { status: 400 });
  }

  try {
    const result = await ingestSermon(env, body.mdx, body.filename);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// ── /ingest-metadata ──────────────────────────────────────────────────────────

async function handleIngestMetadata(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token !== env.INGEST_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { mdx: string; filename: string };
  try {
    body = await request.json() as { mdx: string; filename: string };
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.mdx || !body.filename) {
    return new Response('Missing mdx or filename', { status: 400 });
  }

  try {
    const result = await ingestSermonMetadata(env, body.mdx, body.filename);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
