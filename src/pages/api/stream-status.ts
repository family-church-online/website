import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		const res = await fetch('https://familychurchon.radioca.st/live', {
			headers: { 'Accept': 'audio/mpeg, audio/*', 'Icy-MetaData': '1' },
			signal: AbortSignal.timeout(5000),
		});

		const contentType = res.headers.get('content-type') ?? '';
		const isLive = res.ok && (
			contentType.startsWith('audio/') ||
			contentType.includes('mpeg') ||
			contentType.includes('ogg') ||
			contentType.includes('aac')
		);

		res.body?.cancel();

		return new Response(JSON.stringify({
			live: isLive,
			debug: { status: res.status, contentType },
		}), {
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ live: false, debug: { error: String(err) } }), {
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	}
};
