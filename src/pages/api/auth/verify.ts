import type { APIRoute } from 'astro';
import { readSession, createSession } from '../../../lib/auth';

export const prerender = false;

const SESSION_DAYS = 7;

// Only ever redirect within our own site — reject absolute/protocol-relative
// targets so `redirect` can't be turned into an open redirect.
function safeReturnTo(raw: string): string {
	if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
	return '/courses';
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const token = url.searchParams.get('token') ?? '';
	const returnTo = safeReturnTo(url.searchParams.get('redirect') ?? '/courses');

	const user = await readSession(token);
	if (!user) return redirect('/auth/expired');

	const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
	const sessionToken = await createSession({ ...user, exp });

	cookies.set('pco_session', sessionToken, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: SESSION_DAYS * 24 * 60 * 60,
	});

	// Deliberately NOT an automatic redirect. Some mobile browsers don't
	// reliably carry a cookie set on this response into the very next
	// request if that next request is itself an automatic redirect hop.
	// Requiring a tap makes the next request a real user-initiated
	// navigation, which every browser handles correctly. Astro merges
	// the cookie set above into this Response automatically.
	const href = escapeHtml(returnTo);
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed in · Family Church</title>
<style>
	:root { color-scheme: light dark; }
	body {
		font-family: system-ui, -apple-system, sans-serif;
		display: flex;
		min-height: 100vh;
		align-items: center;
		justify-content: center;
		margin: 0;
		padding: 24px;
		background: #f8f7f2;
		color: #1c2a1f;
	}
	.card {
		max-width: 360px;
		text-align: center;
	}
	.check {
		width: 48px;
		height: 48px;
		border-radius: 999px;
		background: #2f6b3a;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		margin: 0 auto 16px;
	}
	h1 { font-size: 18px; margin: 0 0 8px; }
	p { font-size: 14px; opacity: 0.7; margin: 0 0 24px; }
	a.button {
		display: inline-block;
		background: #1a2f4b;
		color: #fff;
		text-decoration: none;
		font-weight: 600;
		font-size: 14px;
		padding: 12px 28px;
		border-radius: 999px;
	}
</style>
</head>
<body>
	<div class="card">
		<div class="check">&#10003;</div>
		<h1>You're signed in</h1>
		<p>Tap below to continue.</p>
		<a class="button" href="${href}">Continue</a>
	</div>
</body>
</html>`;

	return new Response(html, {
		status: 200,
		headers: {
			'content-type': 'text/html; charset=utf-8',
		},
	});
};
