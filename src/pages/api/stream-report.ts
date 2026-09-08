export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

function getKV(): KVNamespace | null {
	try { return (env as unknown as CloudflareEnv).STREAM_REPORTS ?? null; } catch { return null; }
}

function getDO(): DurableObjectNamespace | null {
	try { return (env as unknown as CloudflareEnv).STREAM_MONITOR ?? null; } catch { return null; }
}

const BUTTONS = ['No Sound', 'Low Volume', 'Sound Quality', 'No Picture', 'Picture Quality'] as const;
type Button = typeof BUTTONS[number];

export const POST: APIRoute = async ({ request }) => {
	const body = await request.json() as { button?: string };
	if (!body.button || !BUTTONS.includes(body.button as Button)) {
		return new Response('Invalid button', { status: 400 });
	}

	const ip        = request.headers.get('CF-Connecting-IP')
	               ?? request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
	               ?? 'unknown';
	const timestamp = new Date().toISOString();
	const hex       = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
	const key       = `report:${timestamp}:${hex}`;
	const report    = { type: 'report' as const, button: body.button, ip, timestamp };

	const kv = getKV();
	if (kv) {
		await kv.put(key, JSON.stringify(report), { expirationTtl: 60 * 60 * 24 * 7 });
	}

	const doNs = getDO();
	if (doNs) {
		const stub = doNs.get(doNs.idFromName('global'));
		stub.fetch('https://do/notify', {
			method: 'POST',
			body: JSON.stringify(report),
			headers: { 'Content-Type': 'application/json' },
		}).catch(() => {/* non-blocking */});
	}

	return new Response(JSON.stringify({ ok: true }), {
		headers: { 'Content-Type': 'application/json' },
	});
};
