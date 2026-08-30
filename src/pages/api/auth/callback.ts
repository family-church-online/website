import type { APIRoute } from 'astro';
import { exchangeCode, parseIdToken, fetchListMemberships, createSession, getTrackedListIds } from '../../../lib/auth';

export const prerender = false;

const SESSION_DAYS = 30;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get('pco_state')?.value;
	const verifier = cookies.get('pco_pkce')?.value;
	const returnTo = cookies.get('pco_return')?.value ?? '/';

	for (const name of ['pco_pkce', 'pco_state', 'pco_return']) {
		cookies.delete(name, { path: '/' });
	}

	if (!code || !state || state !== storedState || !verifier) {
		return redirect('/auth/denied');
	}

	try {
		const tokens = await exchangeCode(code, verifier);
		const { sub, name, email } = parseIdToken(tokens.id_token);

		const trackedIds = getTrackedListIds();
		const lists = await fetchListMemberships(sub, trackedIds);

		if (lists.length === 0) return redirect('/auth/denied');

		const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
		const token = await createSession({ sub, name, email, lists, exp });

		cookies.set('pco_session', token, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: SESSION_DAYS * 24 * 60 * 60,
		});

		return redirect(returnTo);
	} catch (err) {
		console.error('[auth/callback]', err);
		return redirect('/auth/denied');
	}
};
