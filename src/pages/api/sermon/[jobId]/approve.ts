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
		return new Response(JSON.stringify({ error: 'Unauthorized — please log in again' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const siteConfig = await getConfig();
	const adminListId = (siteConfig.data?.config?.auth as Record<string, unknown> | null | undefined)?.adminListId as string | undefined;
	if (adminListId && !user.lists.includes(adminListId)) {
		return new Response(JSON.stringify({ error: 'Forbidden — admin access required' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		});
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
		return new Response(JSON.stringify({ error: 'SERMON_PUBLISH_WORKFLOW binding not available — check Cloudflare dashboard' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const wfParams: SermonPublishParams = { jobId, edits };
	let workflowId = `publish-${jobId}`;
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await (workflow as any).create({ id: workflowId, params: wfParams });
	} catch (err) {
		const msg = String(err);
		if (msg.includes('already_exists')) {
			// Previous attempt left a workflow with this ID (likely failed). Create a fresh one.
			workflowId = `publish-${jobId}-${Date.now()}`;
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				await (workflow as any).create({ id: workflowId, params: wfParams });
			} catch (err2) {
				return new Response(JSON.stringify({ error: `Workflow create failed: ${String(err2)}` }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		} else {
			return new Response(JSON.stringify({ error: `Workflow create failed: ${msg}` }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}

	return new Response(JSON.stringify({ ok: true, workflowId }), {
		headers: { 'Content-Type': 'application/json' },
	});
};
