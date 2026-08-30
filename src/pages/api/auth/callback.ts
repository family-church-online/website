import type { APIRoute } from 'astro';
import { exchangeCode, parseIdToken, fetchListMemberships, createSession, getEnv } from '../../../lib/auth';

export const prerender = false;

const SESSION_DAYS = 30;

export const GET: APIRoute = async (context) => {
	const { url, cookies, redirect } = context;
	const {
		PCO_CLIENT_ID,
		PCO_CLIENT_SECRET,
		PCO_REDIRECT_URI,
		PCO_APP_TOKEN,
		PCO_APP_SECRET,
		PCO_TRACKED_LIST_IDS,
		SESSION_SECRET,
	} = getEnv(context);

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
		const tokens = await exchangeCode(code, verifier, PCO_CLIENT_ID, PCO_CLIENT_SECRET, PCO_REDIRECT_URI);
		const { sub, name, email } = parseIdToken(tokens.id_token);

		const trackedIds = (PCO_TRACKED_LIST_IDS ?? '')
			.split(',')
			.map((s: string) => s.trim())
			.filter(Boolean);

		const lists = await fetchListMemberships(sub, trackedIds, PCO_APP_TOKEN, PCO_APP_SECRET);

		if (lists.length === 0) return redirect('/auth/denied');

		const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
		const token = await createSession({ sub, name, email, lists, exp }, SESSION_SECRET);

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
