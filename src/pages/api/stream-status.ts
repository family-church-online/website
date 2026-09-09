import type { APIRoute } from 'astro';

export const prerender = false;

async function checkIcecast(): Promise<boolean> {
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
		return isLive;
	} catch {
		return false;
	}
}

async function checkVimeo(eventId: string): Promise<boolean> {
	const token = process.env.VIMEO_TOKEN;
	if (!token) return false;

	try {
		const listRes = await fetch(
			`https://api.vimeo.com/me/videos?filter=live_event&live_event_id=${eventId}&fields=uri&per_page=1&sort=date&direction=desc`,
			{
				headers: { 'Authorization': `bearer ${token}` },
				signal: AbortSignal.timeout(5000),
			}
		);
		if (!listRes.ok) return false;

		const listData = await listRes.json() as { data?: Array<{ uri: string }> };
		const videoId = listData.data?.[0]?.uri?.split('/').pop();
		if (!videoId) return false;

		const statusRes = await fetch(
			`https://vimeo.com/live_event/status?clip_id=${videoId}`,
			{
				headers: { 'Authorization': `bearer ${token}` },
				signal: AbortSignal.timeout(5000),
			}
		);
		if (!statusRes.ok) return false;

		const statusData = await statusRes.json() as { ingest?: { status?: number } };
		return statusData.ingest?.status === 4;
	} catch {
		return false;
	}
}

export const GET: APIRoute = async ({ url }) => {
	const eventId = url.searchParams.get('vimeoEventId');
	const cache = typeof caches !== 'undefined' ? caches.default : null;
	const cacheKey = new Request(url.toString());

	const cached = await cache?.match(cacheKey);
	if (cached) return cached;

	const checks: Promise<boolean>[] = [checkIcecast()];
	if (eventId) checks.push(checkVimeo(eventId));

	const results = await Promise.all(checks);
	const live = results.some(Boolean);

	const response = new Response(JSON.stringify({ live }), {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=30' },
	});

	cache?.put(cacheKey, response.clone());
	return response;
};
