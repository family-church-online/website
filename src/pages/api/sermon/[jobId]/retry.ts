export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getJob, patchJob } from '../../../../lib/sermon-job';
import { getConfig } from '../../../../lib/data';

function getWorkflow() {
	try { return (env as unknown as CloudflareEnv).SERMON_PROCESS_WORKFLOW ?? null; } catch { return null; }
}

export const POST: APIRoute = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) {
		return new Response('Unauthorized', { status: 401 });
	}

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

	if (job.status !== 'failed') {
		return new Response(JSON.stringify({ error: `Job is not in failed state (current: ${job.status})` }), {
			status: 409,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	await patchJob(jobId, { status: 'processing', currentStep: 'queued', error: null, failedStep: null });

	const workflow = getWorkflow();
	if (!workflow) {
		return new Response('SERMON_PROCESS_WORKFLOW binding not available', { status: 503 });
	}

	const retryId = `retry-${jobId}-${Date.now().toString(36)}`;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (workflow as any).create({ id: retryId, params: { jobId } });

	return new Response(JSON.stringify({ ok: true, workflowId: retryId }), {
		headers: { 'Content-Type': 'application/json' },
	});
};
