import type { APIRoute } from 'astro';
import { generatePkce, pcoAuthUrl, getEnv } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const { url, cookies, redirect } = context;
	const { PCO_CLIENT_ID, PCO_REDIRECT_URI } = getEnv(context);

	const returnTo = url.searchParams.get('return') ?? '/';
	const state = crypto.randomUUID();
	const { verifier, challenge } = await generatePkce();

	const opts = {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax' as const,
		maxAge: 600,
	};
	cookies.set('pco_pkce', verifier, opts);
	cookies.set('pco_state', state, opts);
	cookies.set('pco_return', returnTo, opts);

	return redirect(pcoAuthUrl(PCO_CLIENT_ID, PCO_REDIRECT_URI, state, challenge));
};
