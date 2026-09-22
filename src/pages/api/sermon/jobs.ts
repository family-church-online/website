export const prerender = false;

import type { APIRoute } from 'astro';
import { putJob, type SermonJob, type SermonJobMetadata, type Taxonomy, type SermonBlock, type Devotion, type ReadingPlanDay } from '../../../lib/sermon-job';

function randomId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function sendNotificationEmail(reviewUrl: string, title: string): Promise<void> {
	const resendKey = process.env.RESEND_API_KEY;
	const notifyEmail = process.env.SERMON_NOTIFY_EMAIL;
	if (!resendKey || !notifyEmail) return;
	await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from: 'Family Church Pipeline <noreply@familychurch.online>',
			to: notifyEmail,
			subject: `Sermon ready for review: ${title}`,
			html: `<p>The sermon "<strong>${title}</strong>" has been processed and is ready for review.</p><p><a href="${reviewUrl}">Review and approve →</a></p>`,
		}),
	});
}

export const POST: APIRoute = async ({ request }) => {
	const authHeader = request.headers.get('authorization') ?? '';
	const secret = process.env.SERMON_PIPELINE_SECRET;
	if (!secret || authHeader !== `Bearer ${secret}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	let body: {
		transcript: string;
		metadata: SermonJobMetadata;
		tempAudioKey: string;
		taxonomy: Taxonomy;
		sermonBlock: SermonBlock;
		slug: string;
		optimisedTitle: string;
		devotions: Devotion[];
		readingPlans?: Record<string, ReadingPlanDay> | null;
	};

	try {
		body = await request.json() as typeof body;
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	if (!body.transcript || !body.metadata?.date || !body.tempAudioKey || !body.taxonomy || !body.sermonBlock || !body.slug) {
		return new Response('Missing required fields', { status: 400 });
	}

	const jobId = randomId();
	const job: SermonJob = {
		jobId,
		status: 'review',
		currentStep: null,
		createdAt: new Date().toISOString(),
		metadata: body.metadata,
		transcript: body.transcript,
		tempAudioKey: body.tempAudioKey,
		taxonomy: body.taxonomy,
		sermonBlock: body.sermonBlock,
		slug: body.slug,
		optimisedTitle: body.optimisedTitle,
		audioUrl: null,
		audioSizeBytes: null,
		devotions: body.devotions ?? [],
		readingPlans: body.readingPlans ?? null,
		error: null,
		failedStep: null,
	};

	await putJob(job);

	const reviewUrl = `${new URL(request.url).origin}/sermon-admin/${jobId}`;
	// non-blocking — don't fail the request if email fails
	sendNotificationEmail(reviewUrl, body.optimisedTitle || body.metadata.title).catch(() => {});

	return new Response(JSON.stringify({ jobId, reviewUrl }), {
		status: 201,
		headers: { 'Content-Type': 'application/json' },
	});
};
