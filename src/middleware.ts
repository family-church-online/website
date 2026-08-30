import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth';

export const onRequest = defineMiddleware(async ({ cookies, locals }, next) => {
	const token = cookies.get('pco_session')?.value;
	if (token) {
		const user = await readSession(token, import.meta.env.SESSION_SECRET);
		locals.user = user;
		if (!user) cookies.delete('pco_session', { path: '/' });
	} else {
		locals.user = null;
	}
	return next();
});
