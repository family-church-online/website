import type { APIRoute } from 'astro';
import { lookupPersonByEmail, fetchListMemberships, getTrackedListIds, createSession, sendMagicLink } from '../../../lib/auth';
import { getSecret } from 'astro:env/server';

export const prerender = false;

// Bundled at build time — used to resolve which list ID a path requires.
const registryMods = import.meta.glob<{ requiredListId?: string }>(
	'../../../content/courses/*.json',
	{ eager: true },
);

function resolveRequiredListId(redirectPath: string): string | undefined {
	const m = redirectPath.match(/^\/courses\/([^/]+)/);
	if (!m) return undefined;
	const courseSlug = m[1];
	const entry = Object.entries(registryMods).find(([p]) => p.endsWith(`/${courseSlug}.json`));
	return entry?.[1]?.requiredListId;
}

export const POST: APIRoute = async ({ request, redirect }) => {
	let email = '';
	let returnTo = '/courses';

	try {
		const data = await request.formData();
		email = (data.get('email')?.toString() ?? '').trim().toLowerCase();
		returnTo = data.get('redirect')?.toString() ?? '/courses';
	} catch {
		return redirect('/login?error=invalid');
	}

	if (!email || !email.includes('@')) {
		return redirect(`/login?error=email&redirect=${encodeURIComponent(returnTo)}`);
	}

	// Always show the same response — don't leak whether email/list matched.
	const sendAndRedirect = async () => {
		try {
			const requiredListId = resolveRequiredListId(returnTo);
			const person = await lookupPersonByEmail(email);
			if (!person) return;

			const trackedIds = getTrackedListIds();
			const lists = await fetchListMemberships(person.pcoId, trackedIds);
			if (lists.length === 0) return;
			if (requiredListId && !lists.includes(requiredListId)) return;

			const exp = Date.now() + 10 * 60 * 1000;
			const token = await createSession({ sub: person.pcoId, name: person.name, email, lists, exp });

			const siteUrl = (process.env['SITE_URL'] ?? getSecret('SITE_URL') ?? '').replace(/\/$/, '');
			const verifyUrl = `${siteUrl}/api/auth/verify?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(returnTo)}`;

			await sendMagicLink(email, verifyUrl);
		} catch (err) {
			console.error('[auth/login]', err);
		}
	};

	await sendAndRedirect();

	return redirect('/auth/check-email');
};
