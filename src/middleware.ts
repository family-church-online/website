import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.user = null;
	if (!context.isPrerendered) {
		const token = context.cookies.get('pco_session')?.value;
		if (token) {
			const user = await readSession(token);
			context.locals.user = user;
			if (!user) context.cookies.delete('pco_session', { path: '/' });
		}
	}
	return next();
});
