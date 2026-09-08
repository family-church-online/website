export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

function getDO(): DurableObjectNamespace | null {
	try { return (env as unknown as CloudflareEnv).STREAM_MONITOR ?? null; } catch { return null; }
}

export const GET: APIRoute = async ({ request }) => {
	if (request.headers.get('Upgrade') !== 'websocket') {
		return new Response('Expected WebSocket upgrade', { status: 426 });
	}

	const doNs = getDO();
	if (!doNs) {
		return new Response('Stream monitor unavailable', { status: 503 });
	}

	const stub = doNs.get(doNs.idFromName('global'));
	return stub.fetch(new Request('https://do/ws', request));
};
