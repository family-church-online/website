import type { PagesFunction } from './_lib/types';

// Redirects /today → /devotion/YYYY-MM-DD using South African time (UTC+2).
// Cached at the Cloudflare edge until midnight SA so the function only runs
// once per edge location per day.
export const onRequestGet: PagesFunction = async () => {
	const saNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
	const dateKey = saNow.toISOString().split('T')[0];

	const [y, mo, d] = dateKey.split('-').map(Number);
	const midnightSaUtc = Date.UTC(y, mo - 1, d, 22, 0, 0);
	const ttl = Math.max(60, Math.floor((midnightSaUtc - Date.now()) / 1000));

	return new Response(null, {
		status: 302,
		headers: {
			Location: `/devotion/${dateKey}`,
			'Cache-Control': `public, s-maxage=${ttl}`,
		},
	});
};
