export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getJob } from '../../../../lib/sermon-job';
import { getConfig } from '../../../../lib/data';
import type { SermonPublishParams } from '../../../../objects/SermonPublishWorkflow';

function getWorkflow() {
	try { return (env as unknown as CloudflareEnv).SERMON_PUBLISH_WORKFLOW ?? null; } catch { return null; }
}

export const POST: APIRoute = async ({ params, locals, request }) => {
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

	if (job.status !== 'review') {
		return new Response(JSON.stringify({ error: `Job is not in review state (current: ${job.status})` }), {
			status: 409,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	let edits: SermonPublishParams['edits'];
	try {
		const body = await request.json() as SermonPublishParams['edits'];
		edits = body;
	} catch {
		// No edits is fine — publish as-is
	}

	const workflow = getWorkflow();
	if (!workflow) {
		return new Response('SERMON_PUBLISH_WORKFLOW binding not available', { status: 503 });
	}

	const workflowId = `publish-${jobId}`;
	const wfParams: SermonPublishParams = { jobId, edits };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (workflow as any).create({ id: workflowId, params: wfParams });

	return new Response(JSON.stringify({ ok: true, workflowId }), {
		headers: { 'Content-Type': 'application/json' },
	});
};
