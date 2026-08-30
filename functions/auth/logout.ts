import type { PagesFunction } from '../_lib/types';
import { clearSessionCookie } from '../_lib/session';

export const onRequestGet: PagesFunction = async () => {
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/',
			'Set-Cookie': clearSessionCookie(),
		},
	});
};
