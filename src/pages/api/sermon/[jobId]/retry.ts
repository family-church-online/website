export const prerender = false;

import type { APIRoute } from 'astro';
import { getJob, patchJob } from '../../../../lib/sermon-job';
import { getConfig } from '../../../../lib/data';

// Resets a failed publish job back to 'review' so the reviewer can approve again.

export const POST: APIRoute = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) return new Response('Unauthorized', { status: 401 });

	const siteConfig = await getConfig();
	const adminListId = (siteConfig.data?.config?.auth as Record<string, unknown> | null | undefined)?.adminListId as string | undefined;
	if (adminListId && !user.lists.includes(adminListId)) {
		return new Response('Forbidden', { status: 403 });
	}

	const { jobId } = params as { jobId: string };
	const job = await getJob(jobId);
	if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

	if (job.status !== 'failed') {
		return new Response(JSON.stringify({ error: `Job is not in failed state (current: ${job.status})` }), { status: 409, headers: { 'Content-Type': 'application/json' } });
	}

	await patchJob(jobId, { status: 'review', currentStep: null, error: null, failedStep: null });
	return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
