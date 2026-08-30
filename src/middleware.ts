import { defineMiddleware } from 'astro:middleware';
import { readSession, getEnv } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
	const { cookies, locals } = context;
	const token = cookies.get('pco_session')?.value;
	if (token) {
		const { SESSION_SECRET } = getEnv(context as Parameters<typeof getEnv>[0]);
		const user = await readSession(token, SESSION_SECRET);
		locals.user = user;
		if (!user) cookies.delete('pco_session', { path: '/' });
	} else {
		locals.user = null;
	}
	return next();
});
