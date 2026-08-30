import type { APIRoute } from 'astro';
import { generatePkce, pcoAuthUrl } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const returnTo = url.searchParams.get('return') ?? '/';
	const state = crypto.randomUUID();
	const { verifier, challenge } = await generatePkce();

	const opts = {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax' as const,
		maxAge: 600, // 10 minutes — long enough to complete login
	};
	cookies.set('pco_pkce', verifier, opts);
	cookies.set('pco_state', state, opts);
	cookies.set('pco_return', returnTo, opts);

	return redirect(
		pcoAuthUrl(
			import.meta.env.PCO_CLIENT_ID,
			import.meta.env.PCO_REDIRECT_URI,
			state,
			challenge,
		),
	);
};
