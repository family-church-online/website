export const prerender = false;

import type { APIRoute } from 'astro';
import { patchJob, getJob } from '../../../../lib/sermon-job';

export const POST: APIRoute = async ({ params, request }) => {
	const authHeader = request.headers.get('authorization') ?? '';
	const secret = process.env.SERMON_PIPELINE_SECRET;
	if (!secret || authHeader !== `Bearer ${secret}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	const { jobId } = params as { jobId: string };
	const job = await getJob(jobId);
	if (!job) return new Response('Job not found', { status: 404 });

	let body: { imagePath: string; imageData: string; imageMimeType: string };
	try {
		body = await request.json() as typeof body;
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	if (!body.imagePath) return new Response('imagePath required', { status: 400 });

	await patchJob(jobId, {
		metadata: { ...job.metadata, image: body.imagePath },
		imageData: body.imageData ?? null,
		imageMimeType: body.imageMimeType ?? null,
	});

	return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
