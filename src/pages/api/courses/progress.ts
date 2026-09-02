export const prerender = false;

import type { APIRoute } from 'astro';

export interface LessonProgress {
	score: number;
	total: number;
	durationSecs: number;
	completedAt: string;
}

function kvKey(email: string, course: string, chapter: string, lesson: string) {
	return `lesson:${email}:${course}:${chapter}:${lesson}`;
}

function getKV(locals: App.Locals): KVNamespace | null {
	return locals.runtime?.env?.LESSON_PROGRESS ?? null;
}

// GET /api/courses/progress?course=X&chapter=Y&lesson=Z
// Returns the user's previous completion record, or null.
export const GET: APIRoute = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) return new Response('Unauthorized', { status: 401 });

	const course  = url.searchParams.get('course');
	const chapter = url.searchParams.get('chapter');
	const lesson  = url.searchParams.get('lesson');
	if (!course || !chapter || !lesson) {
		return new Response('Missing params', { status: 400 });
	}

	const kv = getKV(locals);
	if (!kv) return json(null); // dev mode without wrangler — degrade gracefully

	const raw = await kv.get(kvKey(user.email, course, chapter, lesson));
	return json(raw ? JSON.parse(raw) : null);
};

// POST /api/courses/progress
// Body: { course, chapter, lesson, score, total, durationSecs }
// Records a completed lesson. Always overwrites so retakes update the record.
export const POST: APIRoute = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) return new Response('Unauthorized', { status: 401 });

	const kv = getKV(locals);
	if (!kv) return new Response('KV unavailable', { status: 503 });

	const body = await request.json() as {
		course: string;
		chapter: string;
		lesson: string;
		score: number;
		total: number;
		durationSecs: number;
	};

	if (!body.course || !body.chapter || !body.lesson) {
		return new Response('Missing fields', { status: 400 });
	}

	const record: LessonProgress = {
		score:       body.score,
		total:       body.total,
		durationSecs: body.durationSecs,
		completedAt: new Date().toISOString(),
	};

	await kv.put(
		kvKey(user.email, body.course, body.chapter, body.lesson),
		JSON.stringify(record),
	);

	return json({ ok: true });
};

function json(data: unknown) {
	return new Response(JSON.stringify(data), {
		headers: { 'Content-Type': 'application/json' },
	});
}
