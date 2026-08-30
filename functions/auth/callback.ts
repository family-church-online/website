import type { PagesFunction } from '../_lib/types';
import { createSession, sessionCookie } from '../_lib/session';
import manifest from '../_access-manifest.json';

interface Env {
	PC_CLIENT_ID: string;
	PC_CLIENT_SECRET: string;
	SESSION_SECRET: string;
	SITE_URL: string;
}

interface TokenResponse { access_token: string }
interface MeResponse { data: { id: string; attributes: { first_name: string; last_name: string; primary_email_address: string } } }
interface ListMembersResponse { data: unknown[] }

const PC_TOKEN_URL = 'https://api.planningcenteronline.com/oauth/token';
const PC_API = 'https://api.planningcenteronline.com/people/v2';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (!code || !state) {
		return errorRedirect(env.SITE_URL, 'Missing code or state from Planning Center.');
	}

	// Verify state matches the cookie set at /auth/login
	const cookieState = getCookie(request, '__fc_state');
	if (!cookieState || cookieState !== state) {
		return errorRedirect(env.SITE_URL, 'Invalid state — possible CSRF attempt.');
	}

	let redirect = '/';
	try {
		const stateData = JSON.parse(atob(state));
		redirect = sanitizeRedirect(stateData.redirect, env.SITE_URL);
	} catch {
		// bad state payload; use default redirect
	}

	// Exchange code for access token
	const tokenResp = await fetch(PC_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: env.PC_CLIENT_ID,
			client_secret: env.PC_CLIENT_SECRET,
			redirect_uri: `${env.SITE_URL}/auth/callback`,
		}),
	});

	if (!tokenResp.ok) {
		return errorRedirect(env.SITE_URL, 'Failed to exchange authorization code.');
	}

	const { access_token: accessToken } = (await tokenResp.json()) as TokenResponse;

	// Get person info
	const meResp = await fetch(`${PC_API}/me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!meResp.ok) {
		return errorRedirect(env.SITE_URL, 'Failed to fetch your Planning Center profile.');
	}

	const { data: person } = (await meResp.json()) as MeResponse;
	const personId = person.id;
	const name = [person.attributes.first_name, person.attributes.last_name].filter(Boolean).join(' ');
	const email = person.attributes.primary_email_address ?? '';

	// Check membership in all lists referenced by the access manifest
	const allListIds = [...new Set(Object.values(manifest as Record<string, string>))];

	const memberLists = (
		await Promise.all(
			allListIds.map(async (listId) => {
				const resp = await fetch(
					`${PC_API}/lists/${listId}/list_members?where[person_id]=${personId}&per_page=1`,
					{ headers: { Authorization: `Bearer ${accessToken}` } },
				);
				if (!resp.ok) return null;
				const body = (await resp.json()) as ListMembersResponse;
				return body.data?.length > 0 ? listId : null;
			}),
		)
	).filter((id): id is string => id !== null);

	const token = await createSession({ sub: personId, name, email, lists: memberLists }, env.SESSION_SECRET);

	return new Response(null, {
		status: 302,
		headers: {
			Location: redirect,
			'Set-Cookie': [
				sessionCookie(token),
				'__fc_state=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0',
			].join(', '),
		},
	});
};

function getCookie(request: Request, name: string): string | null {
	const cookie = request.headers.get('Cookie') ?? '';
	for (const part of cookie.split(';')) {
		const [k, ...v] = part.trim().split('=');
		if (k === name) return v.join('=');
	}
	return null;
}

function sanitizeRedirect(redirect: unknown, siteUrl: string): string {
	if (typeof redirect !== 'string') return '/';
	if (redirect.startsWith('/') && !redirect.startsWith('//')) return redirect;
	try {
		const u = new URL(redirect);
		if (u.origin === new URL(siteUrl).origin) return u.pathname + u.search;
	} catch {
		// ignore
	}
	return '/';
}

function errorRedirect(siteUrl: string, message: string): Response {
	return new Response(null, {
		status: 302,
		headers: { Location: `${siteUrl}/login?error=${encodeURIComponent(message)}` },
	});
}
