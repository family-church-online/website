import type { PagesFunction } from './_lib/types';
import { getSessionToken, verifySession } from './_lib/session';
import manifest from './_access-manifest.json';

interface Env {
	SESSION_SECRET: string;
	SITE_URL: string;
}

// Static asset extensions — skip auth for these
const ASSET_EXT = /\.(?:js|mjs|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot|map|json|xml|txt|pdf)$/i;

function getRequiredListId(pathname: string): string | null {
	const routes = manifest as Record<string, string>;
	// Exact match
	if (routes[pathname]) return routes[pathname];
	// Prefix match — find the longest matching prefix
	let best: string | null = null;
	for (const prefix of Object.keys(routes)) {
		if (pathname.startsWith(prefix + '/') && (best === null || prefix.length > best.length)) {
			best = prefix;
		}
	}
	return best ? routes[best] : null;
}

export const onRequest: PagesFunction<Env> = async (context) => {
	const { request, env, next } = context;
	const url = new URL(request.url);
	const { pathname } = url;

	// Pass through static assets, auth endpoints, and public pages
	if (
		ASSET_EXT.test(pathname) ||
		pathname.startsWith('/_astro/') ||
		pathname.startsWith('/admin') ||
		pathname.startsWith('/auth/') ||
		pathname === '/login' ||
		pathname === '/denied'
	) {
		return next();
	}

	const requiredListId = getRequiredListId(pathname);
	if (!requiredListId) return next();

	const token = getSessionToken(request);
	if (!token) {
		return Response.redirect(`${url.origin}/login?redirect=${encodeURIComponent(pathname)}`);
	}

	const session = await verifySession(token, env.SESSION_SECRET);
	if (!session) {
		return Response.redirect(`${url.origin}/login?redirect=${encodeURIComponent(pathname)}`);
	}

	if (!session.lists.includes(requiredListId)) {
		return Response.redirect(`${url.origin}/denied`);
	}

	return next();
};
