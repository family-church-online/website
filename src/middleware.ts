import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.user = null;
	try {
		const token = context.cookies.get('pco_session')?.value;
		if (token) {
			const user = await readSession(token);
			context.locals.user = user;
			if (!user) context.cookies.delete('pco_session', { path: '/' });
		}
	} catch {
		// Prerendered pages have no request context — skip auth silently
	}
	return next();
});
