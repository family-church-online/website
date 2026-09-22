export const prerender = false;

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { putJob, type SermonJob, type SermonJobMetadata } from '../../../lib/sermon-job';

function getWorkflow() {
	try { return (env as unknown as CloudflareEnv).SERMON_PROCESS_WORKFLOW ?? null; } catch { return null; }
}

function randomId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const POST: APIRoute = async ({ request }) => {
	// Bearer token auth — checked against SERMON_PIPELINE_SECRET
	const authHeader = request.headers.get('authorization') ?? '';
	const secret = process.env.SERMON_PIPELINE_SECRET;
	if (!secret || authHeader !== `Bearer ${secret}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	let body: {
		transcript: string;
		metadata: SermonJobMetadata;
		tempAudioKey: string;
	};

	try {
		body = await request.json() as typeof body;
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	if (!body.transcript || !body.metadata?.date || !body.tempAudioKey) {
		return new Response('Missing required fields: transcript, metadata.date, tempAudioKey', { status: 400 });
	}

	const jobId = randomId();
	const job: SermonJob = {
		jobId,
		status: 'processing',
		currentStep: 'queued',
		createdAt: new Date().toISOString(),
		metadata: body.metadata,
		transcript: body.transcript,
		tempAudioKey: body.tempAudioKey,
		taxonomy: null,
		sermonBlock: null,
		slug: null,
		optimisedTitle: null,
		audioUrl: null,
		audioSizeBytes: null,
		devotions: null,
		error: null,
		failedStep: null,
	};

	await putJob(job);

	const workflow = getWorkflow();
	if (!workflow) {
		return new Response('SERMON_PROCESS_WORKFLOW binding not available', { status: 503 });
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (workflow as any).create({ id: jobId, params: { jobId } });

	const reviewUrl = `${new URL(request.url).origin}/sermon-admin/${jobId}`;
	return new Response(JSON.stringify({ jobId, reviewUrl }), {
		status: 201,
		headers: { 'Content-Type': 'application/json' },
	});
};
