import type { PagesFunction } from '../_lib/types';

interface Env {
	PC_CLIENT_ID: string;
	SITE_URL: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
	const url = new URL(request.url);
	const redirect = url.searchParams.get('redirect') ?? '/';

	// Random state for CSRF protection; encode the post-login redirect into it
	const stateData = { nonce: b64url(crypto.getRandomValues(new Uint8Array(16))), redirect };
	const state = btoa(JSON.stringify(stateData));

	const authorizeUrl = new URL('https://api.planningcenteronline.com/oauth/authorize');
	authorizeUrl.searchParams.set('client_id', env.PC_CLIENT_ID);
	authorizeUrl.searchParams.set('redirect_uri', `${env.SITE_URL}/auth/callback`);
	authorizeUrl.searchParams.set('response_type', 'code');
	authorizeUrl.searchParams.set('scope', 'people');
	authorizeUrl.searchParams.set('state', state);

	return new Response(null, {
		status: 302,
		headers: {
			Location: authorizeUrl.toString(),
			// Store state in a short-lived cookie for verification at callback
			'Set-Cookie': `__fc_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`,
		},
	});
};

function b64url(buf: Uint8Array): string {
	return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
