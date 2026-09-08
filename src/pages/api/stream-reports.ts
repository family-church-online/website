export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

function getKV(): KVNamespace | null {
	try { return (env as unknown as CloudflareEnv).STREAM_REPORTS ?? null; } catch { return null; }
}

interface Report { button: string; ip: string; timestamp: string; }

export const GET: APIRoute = async () => {
	const kv = getKV();
	if (!kv) {
		return json({ counts: {}, recent: {} });
	}

	const list = await kv.list({ prefix: 'report:' });
	const now  = Date.now();
	const counts: Record<string, number> = {};
	const recent: Record<string, number> = {};

	await Promise.all(list.keys.map(async ({ name }) => {
		const raw = await kv.get(name);
		if (!raw) return;
		try {
			const r = JSON.parse(raw) as Report;
			counts[r.button]  = (counts[r.button]  ?? 0) + 1;
			const age = now - new Date(r.timestamp).getTime();
			if (age < 60 * 60 * 1000) {
				recent[r.button] = (recent[r.button] ?? 0) + 1;
			}
		} catch { /* skip malformed */ }
	}));

	return json({ counts, recent });
};

function json(data: unknown) {
	return new Response(JSON.stringify(data), {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
