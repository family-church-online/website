import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { getJob, patchJob, type SermonJob, type SermonBlock, type Taxonomy, type Devotion, type ReadingPlanDay, type ReadingPlanLink } from '../lib/sermon-job';
import { getGoogleAccessToken } from '../lib/google-auth';
// (google-auth used only for Calendar — Drive upload is done by local pipeline)

export interface SermonPublishParams {
	jobId: string;
	/** Reviewer-submitted edits merged over the KV job before publishing */
	edits?: Partial<{
		optimisedTitle: string;
		slug: string;
		taxonomy: Partial<import('../lib/sermon-job').Taxonomy>;
		sermonBlock: Partial<import('../lib/sermon-job').SermonBlock>;
		devotions: import('../lib/sermon-job').Devotion[];
	}>;
}

const GITHUB_OWNER = 'family-church-online';
const GITHUB_REPO  = 'website';
const GITHUB_BRANCH = 'master';
const SITE_URL = 'https://familychurch.online';
const R2_PUBLIC_URL = 'https://audio.familychurch.online';

const DEVOTIONS_CAL_ID = 'kalsva0235makn1pq3d52sko1k@group.calendar.google.com';

const GOOGLE_SCOPES = [
	'https://www.googleapis.com/auth/calendar',
];

// ── YAML helpers ──────────────────────────────────────────────────────────────

function yamlStr(value: string | null | undefined): string {
	if (!value) return '""';
	if (value.includes('\n')) {
		const body = value.split('\n').map(l => '  ' + l).join('\n');
		return `|\n${body}`;
	}
	if (/[:{}&*!,[\]|>'"#@`]/.test(value) || /^[-?]/.test(value) || value.includes('\\')) {
		return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}
	return value;
}

function strOrNull(v: string | null | undefined): string {
	return v ? yamlStr(v) : 'null';
}

function listField(items: string[]): string {
	if (!items?.length) return '[]';
	return '\n' + items.map(i => `  - ${yamlStr(String(i))}`).join('\n');
}

// ── Sermon MDX builder ────────────────────────────────────────────────────────

function buildSermonMdx(job: SermonJob, taxonomy: Taxonomy, block: SermonBlock, slug: string, optimisedTitle: string, audioUrl: string, audioSizeBytes: number): string {
	const lines: string[] = ['---', '# ── IDENTITY ─────────────────────────────────────────────────────'];
	lines.push(`title: ${yamlStr(optimisedTitle)}`);
	lines.push(`date: "${job.metadata.date}"`);
	lines.push(`speaker: ${yamlStr(job.metadata.speaker || '')}`);
	if (job.metadata.series) lines.push(`series: ${yamlStr(job.metadata.series)}`);

	lines.push('', '# ── SCRIPTURE ────────────────────────────────────────────────────');
	lines.push(`scripture: ${yamlStr(taxonomy.sermon_scripture || '')}`);
	if (block.primaryTheme) lines.push(`primaryTheme: ${yamlStr(block.primaryTheme)}`);
	if (block.additionalScriptures?.length) {
		lines.push('additionalScriptures:');
		for (const s of block.additionalScriptures) {
			lines.push(`  - ref: ${yamlStr(s.ref || '')}`, `    theme: ${yamlStr(s.theme || '')}`);
		}
	}

	lines.push('', '# ── MEDIA ────────────────────────────────────────────────────────');
	lines.push(`image: ${strOrNull(job.metadata.image)}`);
	lines.push(`audioUrl: ${strOrNull(audioUrl)}`);
	lines.push(`audioSizeBytes: ${audioSizeBytes ?? 'null'}`);
	lines.push(`vimeoUrl: ${strOrNull(job.metadata.vimeoUrl || '')}`);
	lines.push(`durationMinutes: ${job.metadata.durationMinutes ?? 'null'}`);

	lines.push('', '# ── PRESENTATION COPY ────────────────────────────────────────────');
	lines.push(`tagLine: ${strOrNull(block.tagLine)}`);
	lines.push(`shortDescription: ${strOrNull(block.shortDescription)}`);
	lines.push(`subtitle: ${strOrNull(block.subtitle)}`);
	lines.push(`hook: ${strOrNull(block.hook)}`);
	if (block.takeaways?.length) { lines.push('takeaways:'); block.takeaways.forEach(t => lines.push(`  - ${yamlStr(t)}`)); }
	if (block.audience?.length) { lines.push('audience:'); block.audience.forEach(a => lines.push(`  - ${yamlStr(a)}`)); }
	lines.push(`bigIdea: ${strOrNull(block.bigIdea)}`);
	lines.push(`keyScriptureText: ${strOrNull(block.keyScriptureText)}`);
	lines.push(`keyScriptureRef: ${strOrNull(block.keyScriptureRef)}`);
	if (block.mainPoints?.length) {
		lines.push('mainPoints:');
		for (const mp of block.mainPoints) {
			lines.push(`  - title: ${yamlStr(mp.title || '')}`, `    body: ${yamlStr(mp.body || '')}`);
		}
	}
	lines.push(`keyIllustration: ${strOrNull(block.keyIllustration)}`);
	if (block.application?.length) { lines.push('application:'); block.application.forEach(a => lines.push(`  - ${yamlStr(a)}`)); }
	lines.push(`toRemember: ${strOrNull(block.toRemember)}`);
	lines.push(`style: ${strOrNull(block.style)}`);
	lines.push(`level: ${strOrNull(block.level)}`);

	lines.push('', '# ── TAXONOMY ─────────────────────────────────────────────────────');
	if (taxonomy.category?.length) {
		lines.push('category:');
		taxonomy.category.forEach(c => lines.push(`  - ${yamlStr(c)}`));
	}
	if (taxonomy.tags?.length) {
		lines.push('tags:');
		taxonomy.tags.forEach(t => lines.push(`  - ${yamlStr(t)}`));
	}

	lines.push('', '# ── FLAGS ───────────────────────────────────────────────────────');
	lines.push(`guid: ${strOrNull(job.guid)}`);
	lines.push('review: false');
	lines.push('transcribedBy: deepgram-nova-2');
	lines.push(`wordCount: ${job.transcript ? job.transcript.split(/\s+/).filter(Boolean).length : 0}`);
	lines.push('---', '');

	const title = optimisedTitle.split(' : ')[0].trim();
	lines.push(`# ${title}`, '', '## Transcript', '', job.transcript, '');

	return lines.join('\n');
}

// ── Devotion HTML parser ──────────────────────────────────────────────────────

interface ParsedDevotion {
	keyRef: string;
	keyText: string;
	reflection: string;
	supportingScriptures: Array<{ ref: string; text: string }>;
	lifeApplication: string;
	prayer: string;
}

function parseDevotionHtml(html: string): ParsedDevotion {
	const SECTION_NAMES = new Set(['Reflection', 'Supporting Scriptures', 'Life Application', 'Prayer', 'Links']);
	// Strip the leading image tag
	const content = html.replace(/^<a[^>]*><img[^>]*><\/a>\s*/i, '');
	const parts = content.split(/<h3>(.*?)<\/h3>/s);

	let keyRef = '', keyText = '', reflection = '', lifeApp = '', prayer = '';
	const supporting: Array<{ ref: string; text: string }> = [];

	for (let i = 1; i < parts.length - 1; i += 2) {
		const label   = parts[i].trim();
		const body    = parts[i + 1] ?? '';

		if (label === 'Reflection') {
			reflection = body
				.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
				.replace(/<[^>]+>/g, '')
				.replace(/\n{3,}/g, '\n\n')
				.trim();
		} else if (label === 'Supporting Scriptures') {
			for (const [, refHtml, bqHtml] of body.matchAll(/<b>(.*?)<\/b>.*?<blockquote>(.*?)<\/blockquote>/gs)) {
				const ref = refHtml.replace(/<[^>]+>/g, '').trim();
				const txt = bqHtml.replace(/<[^>]+>/g, '').trim().replace(/^["""']+|["""']+$/g, '');
				if (ref) supporting.push({ ref, text: txt });
			}
		} else if (label === 'Life Application') {
			lifeApp = body
				.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
				.replace(/<[^>]+>/g, '')
				.replace(/\n{3,}/g, '\n\n')
				.trim();
		} else if (label === 'Prayer') {
			const prayerSection = body.split(/<hr\s*\/?>/i)[0];
			prayer = prayerSection
				.replace(/<br\s*\/?>/gi, '\n')
				.replace(/<[^>]+>/g, '')
				.replace(/\n{3,}/g, '\n\n')
				.trim();
		} else if (!SECTION_NAMES.has(label) && !keyRef) {
			keyRef = label;
			const bqM = body.match(/<blockquote>([\s\S]*?)<\/blockquote>/i);
			if (bqM) {
				keyText = bqM[1]
					.replace(/<b>.*?<\/b>\s*\n?/gs, '')
					.replace(/<[^>]+>/g, '')
					.trim()
					.replace(/^["""']+|["""']+$/g, '');
			}
		}
	}

	return { keyRef, keyText, reflection, supportingScriptures: supporting, lifeApplication: lifeApp, prayer };
}

function buildDevotionMdx(devotion: Devotion, imageLocal: string, sermonUrl: string, rp?: ReadingPlanDay): string {
	const parsed = parseDevotionHtml(devotion.content);
	const lines: string[] = ['---'];
	lines.push(`title: ${yamlStr(devotion.title)}`);
	lines.push(`date: ${devotion.date}T00:00:00.000Z`);
	lines.push(`image: ${yamlStr(imageLocal)}`);
	lines.push(`sermonUrl: ${yamlStr(sermonUrl)}`);
	lines.push('keyScripture:');
	lines.push(`  ref: ${yamlStr(parsed.keyRef)}`);
	lines.push(`  text: ${yamlStr(parsed.keyText)}`);
	lines.push(`reflection: ${yamlStr(parsed.reflection)}`);
	if (parsed.supportingScriptures.length) {
		lines.push('supportingScriptures:');
		for (const s of parsed.supportingScriptures) {
			lines.push(`  - ref: ${yamlStr(s.ref)}`, `    text: ${yamlStr(s.text)}`);
		}
	} else {
		lines.push('supportingScriptures: []');
	}
	lines.push(`lifeApplication: ${yamlStr(parsed.lifeApplication)}`);
	lines.push(`prayer: ${yamlStr(parsed.prayer)}`);

	const rpLinks = (links: ReadingPlanLink[] | undefined) =>
		(links ?? []).map(l => `      - ref: ${yamlStr(l.ref)}\n        url: ${yamlStr(l.url)}`).join('\n');

	lines.push('readingPlans:');
	const conn = rp?.connected;
	if (conn && Object.keys(conn).length) {
		lines.push('  connected:');
		if (conn.ot?.length)     lines.push(`    ot:\n${rpLinks(conn.ot)}`);
		if (conn.nt?.length)     lines.push(`    nt:\n${rpLinks(conn.nt)}`);
		if (conn.wisdom?.length) lines.push(`    wisdom:\n${rpLinks(conn.wisdom)}`);
	} else {
		lines.push('  connected: {}');
	}
	const chron = rp?.chronological;
	if (chron?.length) {
		lines.push(`  chronological:\n${rpLinks(chron)}`);
	} else {
		lines.push('  chronological: []');
	}
	const lit = rp?.literary;
	if (lit && Object.keys(lit).length) {
		lines.push('  literary:');
		if (lit.wisdom?.length)         lines.push(`    wisdom:\n${rpLinks(lit.wisdom)}`);
		if (lit.narrative?.length)      lines.push(`    narrative:\n${rpLinks(lit.narrative)}`);
		if (lit.historyProphecy?.length) lines.push(`    historyProphecy:\n${rpLinks(lit.historyProphecy)}`);
		if (lit.nt?.length)             lines.push(`    nt:\n${rpLinks(lit.nt)}`);
	} else {
		lines.push('  literary: {}');
	}

	lines.push('---', '');
	return lines.join('\n');
}

// ── Related sermons ───────────────────────────────────────────────────────────

function topicTags(tags: string[]): string[] {
	return tags.filter(t => !/^(Book|Ref|Series):/.test(t));
}

function jaccard(a: string[], b: string[]): number {
	const sa = new Set(a), sb = new Set(b);
	if (sa.size === 0 && sb.size === 0) return 0;
	let intersection = 0;
	for (const t of sa) if (sb.has(t)) intersection++;
	return intersection / (sa.size + sb.size - intersection);
}

async function buildRelatedFiles(
	token: string,
	newSlug: string,
	newTags: string[],
): Promise<{ tagsContent: string; relatedContent: string }> {
	// Fetch current sermon-tags.json from GitHub
	let tagsMap: Record<string, string[]> = {};
	try {
		const res = await githubApi(token, '/contents/src/data/sermon-tags.json');
		const raw = atob((res as { content: string }).content.replace(/\n/g, ''));
		tagsMap = JSON.parse(raw);
	} catch {
		// File may not exist yet — start fresh
	}

	// Add / overwrite new sermon
	tagsMap[newSlug] = topicTags(newTags);

	// Recompute related for every sermon
	const slugs = Object.keys(tagsMap);
	const related: Record<string, string[]> = {};
	for (const slug of slugs) {
		const scores = slugs
			.filter(s => s !== slug)
			.map(s => ({ slug: s, score: jaccard(tagsMap[slug], tagsMap[s]) }))
			.filter(x => x.score > 0)
			.sort((a, b) => b.score - a.score);
		related[slug] = scores.slice(0, 3).map(s => s.slug);
	}

	return {
		tagsContent: JSON.stringify(tagsMap, null, 2),
		relatedContent: JSON.stringify(related, null, 2),
	};
}

// ── GitHub Git Data API ───────────────────────────────────────────────────────

async function githubApi(token: string, path: string, method = 'GET', body?: unknown) {
	const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json',
			'User-Agent': 'family-church-sermon-pipeline/1.0',
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API ${method} ${path}: ${res.status} — ${text}`);
	}
	return res.json();
}

interface GitBlob { sha: string }
interface GitRef { object: { sha: string } }
interface GitCommit { sha: string; tree: { sha: string } }
interface GitTree { sha: string }
interface GitNewCommit { sha: string }

async function commitFiles(token: string, files: Array<{ path: string; content: string; isBase64?: boolean }>, message: string): Promise<string> {
	// Get HEAD commit
	const ref = await githubApi(token, `/git/ref/heads/${GITHUB_BRANCH}`) as GitRef;
	const headSha = ref.object.sha;

	// Get tree SHA of HEAD commit
	const headCommit = await githubApi(token, `/git/commits/${headSha}`) as GitCommit;
	const treeSha = headCommit.tree.sha;

	// Create blobs for each file
	const treeItems = await Promise.all(files.map(async f => {
		const blob = await githubApi(token, '/git/blobs', 'POST', {
			// isBase64=true means content is already base64 (binary files like images)
			content: f.isBase64 ? f.content : btoa(unescape(encodeURIComponent(f.content))),
			encoding: 'base64',
		}) as GitBlob;
		return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
	}));

	// Create tree
	const newTree = await githubApi(token, '/git/trees', 'POST', {
		base_tree: treeSha,
		tree: treeItems,
	}) as GitTree;

	// Create commit
	const newCommit = await githubApi(token, '/git/commits', 'POST', {
		message,
		tree: newTree.sha,
		parents: [headSha],
	}) as GitNewCommit;

	// Update branch ref
	await githubApi(token, `/git/refs/heads/${GITHUB_BRANCH}`, 'PATCH', {
		sha: newCommit.sha,
		force: false,
	});

	return newCommit.sha;
}

// ── Google Calendar helpers ───────────────────────────────────────────────────

async function createCalendarEvent(token: string, calendarId: string, summary: string, description: string, date: string): Promise<void> {
	const nextDay = new Date(new Date(date).getTime() + 86400 * 1000).toISOString().slice(0, 10);
	const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			summary,
			description,
			start: { date },
			end: { date: nextDay },
		}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Calendar insert failed (${date}): ${res.status} — ${text}`);
	}
}

async function sendNotificationEmail(email: SendEmail, to: string, subject: string, html: string, text: string): Promise<void> {
	await email.send({
		from: { email: 'noreply@familychurch.online', name: 'Family Church Pipeline' },
		to,
		subject,
		html,
		text,
	});
}

// ── Workflow ──────────────────────────────────────────────────────────────────

export class SermonPublishWorkflow extends WorkflowEntrypoint<CloudflareEnv, SermonPublishParams> {
	async run(event: WorkflowEvent<SermonPublishParams>, step: WorkflowStep): Promise<void> {
		const { jobId, edits } = event.payload;

		try {
			await this.publish(jobId, edits, step);
		} catch (err) {
			const currentJob = await getJob(jobId).catch(() => null);
			await patchJob(jobId, {
				status: 'failed',
				error: String(err),
				failedStep: currentJob?.currentStep ?? 'unknown',
			}).catch(() => {});
			throw err;
		}
	}

	private async publish(jobId: string, edits: SermonPublishParams['edits'], step: WorkflowStep): Promise<void> {
		// Apply any reviewer edits to the job first
		if (edits) {
			const job = await getJob(jobId);
			if (job) {
				const patch: Partial<import('../lib/sermon-job').SermonJob> = {};
				if (edits.optimisedTitle) patch.optimisedTitle = edits.optimisedTitle;
				if (edits.slug) patch.slug = edits.slug;
				if (edits.taxonomy && job.taxonomy) patch.taxonomy = { ...job.taxonomy, ...edits.taxonomy };
				if (edits.sermonBlock && job.sermonBlock) patch.sermonBlock = { ...job.sermonBlock, ...edits.sermonBlock };
				if (edits.devotions) patch.devotions = edits.devotions;
				await patchJob(jobId, { ...patch, status: 'publishing', currentStep: 'move-audio' });
			}
		} else {
			await patchJob(jobId, { status: 'publishing', currentStep: 'move-audio' });
		}

		// ── Step 0: move-audio ────────────────────────────────────────────────────
		// Copies temp/{date}.mp3 → sermons/{date}-{slug}.mp3 in R2, then patches the job
		// with the permanent audioUrl and audioSizeBytes so build-mdx can embed them.
		// Idempotent: if audioUrl is already set (manually fixed), skips the R2 move.
		const { audioUrl, audioSizeBytes } = await step.do('move-audio', { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } }, async () => {
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			if (job.audioUrl && job.audioSizeBytes) {
				return { audioUrl: job.audioUrl, audioSizeBytes: job.audioSizeBytes };
			}

			const r2 = this.env.SERMON_AUDIO;
			const tempKey = job.tempAudioKey;
			const permanentKey = `sermons/${job.metadata.date}-${job.slug}.mp3`;

			const tempObj = await r2.get(tempKey);
			if (!tempObj) throw new Error(`Temp audio not found in R2: ${tempKey}`);

			const bytes = await tempObj.arrayBuffer();
			await r2.put(permanentKey, bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
			await r2.delete(tempKey);

			const url = `${R2_PUBLIC_URL}/sermons/${job.metadata.date}-${job.slug}.mp3`;
			const sizeBytes = bytes.byteLength;
			await patchJob(jobId, { audioUrl: url, audioSizeBytes: sizeBytes, currentStep: 'build-mdx' });
			return { audioUrl: url, audioSizeBytes: sizeBytes };
		});

		// ── Step 1: build-mdx ─────────────────────────────────────────────────────
		const { sermonMdx, sermonPath, devotionFiles } = await step.do('build-mdx', { retries: { limit: 2, delay: '5 seconds', backoff: 'linear' } }, async () => {
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);
			if (!job.taxonomy || !job.sermonBlock || !job.slug || !job.optimisedTitle) {
				throw new Error('Job is missing required fields (taxonomy, sermonBlock, slug, optimisedTitle)');
			}

			const sermonUrl = `${SITE_URL}/sermons/${job.slug}`;

			// Sermon MDX
			const mdx = buildSermonMdx(
				job,
				job.taxonomy,
				job.sermonBlock,
				job.slug,
				job.optimisedTitle,
				job.audioUrl ?? '',
				job.audioSizeBytes ?? 0,
			);
			const path = `src/content/sermons/${job.slug}.mdx`;

			// Devotion MDX files
			const devFiles = (job.devotions ?? []).map(dev => ({
				path: `src/content/devotion/${dev.date}.mdx`,
				content: buildDevotionMdx(dev, job.metadata.image || '', sermonUrl, job.readingPlans?.[dev.date]),
			}));

			return { sermonMdx: mdx, sermonPath: path, devotionFiles: devFiles };
		});

		// ── Step 2: commit ────────────────────────────────────────────────────────
		const commitSha = await step.do('commit', { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } }, async () => {
			await patchJob(jobId, { currentStep: 'commit' });
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			const githubToken = process.env.GITHUB_TOKEN;
			if (!githubToken) throw new Error('GITHUB_TOKEN not set');

			const { tagsContent, relatedContent } = await buildRelatedFiles(
				githubToken,
				job.slug!,
				job.taxonomy!.tags ?? [],
			);

			const files: Array<{ path: string; content: string; isBase64?: boolean }> = [
				{ path: sermonPath, content: sermonMdx },
				...devotionFiles,
				{ path: 'src/data/sermon-tags.json', content: tagsContent },
				{ path: 'src/data/related-sermons.json', content: relatedContent },
			];

			// Commit the image file if the pipeline included it (i.e. it was a local file not yet in GitHub)
			if (job.imageData && job.imageMimeType && job.metadata.image) {
				files.push({
					path: `public${job.metadata.image}`,
					content: job.imageData,
					isBase64: true,
				});
			}

			const sha = await commitFiles(
				githubToken,
				files,
				`feat: add sermon "${job.optimisedTitle}" (${job.metadata.date})\n\nAdds sermon MDX, ${devotionFiles.length} daily devotions, and rebuilds related sermons.`,
			);
			return sha;
		});

		// ── Step 3: ingest-search ─────────────────────────────────────────────────
		// Index the published sermon in Living Waters (D1 + Vectorize) so it's
		// immediately searchable. Uses a Service Binding — no external HTTP call.
		// Soft-fail: errors are caught inside the step so the Workflow continues
		// and the sermon goes live regardless of search-index status.
		await step.do('ingest-search', async () => {
			if (!this.env.LIVING_WATERS) return; // binding not configured — skip silently

			const secret = process.env.LIVING_WATERS_INGEST_SECRET;
			if (!secret) return; // secret not configured — skip silently

			const job = await getJob(jobId);
			if (!job?.slug) return;

			try {
				const res = await this.env.LIVING_WATERS.fetch(
					new Request('https://living-waters/ingest', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${secret}`,
						},
						body: JSON.stringify({ mdx: sermonMdx, filename: `${job.slug}.mdx` }),
					}),
				);
				if (!res.ok) {
					console.error(`[ingest-search] failed: ${res.status} — ${await res.text()}`);
				}
			} catch (err) {
				console.error('[ingest-search] error (non-fatal):', err);
			}
		});

		// ── Step 4: calendar ──────────────────────────────────────────────────────
		await step.do('calendar', { retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' } }, async () => {
			await patchJob(jobId, { currentStep: 'calendar' });
			const job = await getJob(jobId);
			if (!job || !job.devotions?.length) return;

			const token = await getGoogleAccessToken(GOOGLE_SCOPES);
			for (const dev of job.devotions) {
				await createCalendarEvent(token, DEVOTIONS_CAL_ID, dev.title, dev.content, dev.date);
				await new Promise(r => setTimeout(r, 300));
			}
		});

		// Drive upload is handled by the local pipeline (step 10.5 in pipeline.mjs) because
		// Cloudflare Worker service accounts have no Drive storage quota on personal Google Drive.

		// ── Step 5: notify ────────────────────────────────────────────────────────
		await step.do('notify', { retries: { limit: 2, delay: '5 seconds', backoff: 'linear' } }, async () => {
			const job = await getJob(jobId);
			if (!job) return;

			const sermonUrl = `${SITE_URL}/sermons/${job.slug}`;
			await patchJob(jobId, { status: 'complete', currentStep: null });

			const notifyEmail = process.env.SERMON_NOTIFY_EMAIL;
			if (notifyEmail && this.env.EMAIL) {
				await sendNotificationEmail(
					this.env.EMAIL,
					notifyEmail,
					`Sermon published: ${job.optimisedTitle}`,
					`<p>The sermon "<strong>${job.optimisedTitle}</strong>" has been committed to GitHub.</p>
					<p>Commit: ${commitSha}</p>
					<p>Once the Cloudflare build completes, it will be live at:<br>
					<a href="${sermonUrl}">${sermonUrl}</a></p>`,
					`The sermon "${job.optimisedTitle}" has been committed to GitHub.\n\nCommit: ${commitSha}\n\nOnce the Cloudflare build completes, it will be live at: ${sermonUrl}`,
				);
			}
		});
	}
}

export { SermonPublishWorkflow as default };
