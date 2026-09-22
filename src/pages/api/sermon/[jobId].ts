export const prerender = false;

import type { APIRoute } from 'astro';
import { getJob } from '../../../lib/sermon-job';
import { getConfig } from '../../../lib/data';

export const GET: APIRoute = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) {
		return new Response('Unauthorized', { status: 401 });
	}

	// Check admin list membership
	const siteConfig = await getConfig();
	const adminListId = (siteConfig.data?.config?.auth as Record<string, unknown> | null | undefined)?.adminListId as string | undefined;
	if (adminListId && !user.lists.includes(adminListId)) {
		return new Response('Forbidden', { status: 403 });
	}

	const { jobId } = params as { jobId: string };
	const job = await getJob(jobId);

	if (!job) {
		return new Response(JSON.stringify({ error: 'Job not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Don't expose full transcript in status polls — saves bandwidth
	const { transcript: _t, ...jobWithoutTranscript } = job;
	return new Response(JSON.stringify(jobWithoutTranscript), {
		headers: { 'Content-Type': 'application/json' },
	});
};
