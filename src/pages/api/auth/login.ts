import type { APIRoute } from 'astro';
import { lookupPersonByEmail, fetchListMemberships, createSession, sendMagicLink } from '../../../lib/auth';
import { getConfig } from '../../../lib/data';

export const prerender = false;

// Bundled at build time — single source of truth for all gated list IDs.
const registryMods = import.meta.glob<{ requiredListId?: string }>(
	'../../../content/courses/*.json',
	{ eager: true },
);

// Admin list — must be tracked so requireAuth() can find it in user.lists
const ADMIN_LIST_IDS = ['5358919'];

const trackedListIds: string[] = [
	...new Set([
		...ADMIN_LIST_IDS,
		...Object.values(registryMods)
			.map(r => r.requiredListId)
			.filter((id): id is string => Boolean(id)),
	]),
];

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

	const [siteConfig] = await Promise.all([getConfig()]);
	const emailConfig = siteConfig.data?.config?.auth?.email ?? undefined;

	// Always show the same response — don't leak whether email/list matched.
	const sendAndRedirect = async () => {
		try {
			const requiredListId = resolveRequiredListId(returnTo);
			const person = await lookupPersonByEmail(email);
			if (!person) return;

			const lists = await fetchListMemberships(person.pcoId, trackedListIds);

			const exp = Date.now() + 10 * 60 * 1000;
			const token = await createSession({ sub: person.pcoId, name: person.name, email, lists, exp });

			const origin = new URL(request.url).origin;
			const verifyUrl = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(returnTo)}`;

			await sendMagicLink(email, verifyUrl, emailConfig);
		} catch (err) {
			console.error('[auth/login]', err);
		}
	};

	await sendAndRedirect();

	return redirect('/auth/check-email');
};
