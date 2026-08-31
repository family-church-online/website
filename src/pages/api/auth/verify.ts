import type { APIRoute } from 'astro';
import { readSession, createSession } from '../../../lib/auth';

export const prerender = false;

const SESSION_DAYS = 7;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const token = url.searchParams.get('token') ?? '';
	const returnTo = url.searchParams.get('redirect') ?? '/courses';

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

	return redirect(returnTo);
};
