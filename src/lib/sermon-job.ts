import { env } from 'cloudflare:workers';

export type JobStatus = 'processing' | 'review' | 'publishing' | 'complete' | 'failed';

export interface AdditionalScripture {
	ref: string;
	theme: string;
}

export interface MainPoint {
	title: string;
	body: string;
}

export interface Taxonomy {
	title: string;
	speaker: string | null;
	date: string;
	url: string;
	series: string | null;
	sermon_scripture: string;
	category: string[];
	tags: string[];
	review: boolean;
	review_notes: string;
}

export interface SermonBlock {
	shortDescription: string;
	tagLine: string;
	primaryTheme: string;
	subtitle: string;
	style: string;
	level: string;
	hook: string;
	takeaways: string[];
	audience: string[];
	additionalScriptures: AdditionalScripture[];
	bigIdea: string;
	keyScriptureText: string;
	keyScriptureRef: string;
	mainPoints: MainPoint[];
	keyIllustration: string | null;
	application: string[];
	toRemember: string;
}

export interface Devotion {
	title: string;
	content: string;
	date: string;
}

export interface SermonJobMetadata {
	title: string;
	speaker: string;
	series: string;
	date: string;
	image: string;
	vimeoUrl: string;
	durationMinutes: number;
}

export interface SermonJob {
	jobId: string;
	status: JobStatus;
	currentStep: string | null;
	createdAt: string;
	metadata: SermonJobMetadata;
	transcript: string;
	tempAudioKey: string;
	// populated by SermonProcessWorkflow
	taxonomy: Taxonomy | null;
	sermonBlock: SermonBlock | null;
	slug: string | null;
	optimisedTitle: string | null;
	audioUrl: string | null;
	audioSizeBytes: number | null;
	devotions: Devotion[] | null;
	// error state
	error: string | null;
	failedStep: string | null;
}

function getKV(): KVNamespace | null {
	try { return (env as unknown as CloudflareEnv).SERMON_JOBS ?? null; } catch { return null; }
}

const JOB_TTL = 60 * 60 * 24 * 30; // 30 days

export async function getJob(jobId: string): Promise<SermonJob | null> {
	const kv = getKV();
	if (!kv) return null;
	const raw = await kv.get(`sermon-job:${jobId}`);
	if (!raw) return null;
	return JSON.parse(raw) as SermonJob;
}

export async function putJob(job: SermonJob): Promise<void> {
	const kv = getKV();
	if (!kv) throw new Error('SERMON_JOBS KV not available');
	await kv.put(`sermon-job:${job.jobId}`, JSON.stringify(job), { expirationTtl: JOB_TTL });
}

export async function patchJob(jobId: string, patch: Partial<SermonJob>): Promise<SermonJob> {
	const existing = await getJob(jobId);
	if (!existing) throw new Error(`Job not found: ${jobId}`);
	const updated = { ...existing, ...patch };
	await putJob(updated);
	return updated;
}
