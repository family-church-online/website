export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

function getDO(): DurableObjectNamespace | null {
	try { return (env as unknown as CloudflareEnv).STREAM_MONITOR ?? null; } catch { return null; }
}

export const GET: APIRoute = async () => {
	const doNs = getDO();
	if (!doNs) return new Response('DO unavailable', { status: 503 });
	const stub = doNs.get(doNs.idFromName('global'));
	return stub.fetch('https://do/debug');
};
