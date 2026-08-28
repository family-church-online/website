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

		// Abort the body immediately — we only needed the headers
		res.body?.cancel();

		return new Response(JSON.stringify({ live: isLive }), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			},
		});
	} catch {
		return new Response(JSON.stringify({ live: false }), {
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	}
};
