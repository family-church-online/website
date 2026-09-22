import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { getJob, patchJob, type SermonJob, type SermonBlock, type Taxonomy, type Devotion } from '../lib/sermon-job';
import { getGoogleAccessToken } from '../lib/google-auth';

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

const DRIVE_ENRICHED     = '1w2ADe6xQ-_0Hz2KvAHbmMTSK_7WNkALO';
const DRIVE_COMP_TAX     = '19f02nUtBL9xNQaTsECgKvEWkcyefgixy';
const DRIVE_SERMON_BLOCK = '1rmr23NQsNHYFstSSW2cyB2U2XMBOt39l';
const DEVOTIONS_CAL_ID   = 'kalsva0235makn1pq3d52sko1k@group.calendar.google.com';

const GOOGLE_SCOPES = [
	'https://www.googleapis.com/auth/calendar',
	'https://www.googleapis.com/auth/drive',
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
	lines.push('review: false');
	lines.push('---', '');
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

function buildDevotionMdx(devotion: Devotion, imageLocal: string, sermonUrl: string): string {
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
	lines.push('readingPlans:');
	lines.push('  connected: {}');
	lines.push('  chronological: []');
	lines.push('  literary: {}');
	lines.push('---', '');
	return lines.join('\n');
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

async function commitFiles(token: string, files: Array<{ path: string; content: string }>, message: string): Promise<string> {
	// Get HEAD commit
	const ref = await githubApi(token, `/git/ref/heads/${GITHUB_BRANCH}`) as GitRef;
	const headSha = ref.object.sha;

	// Get tree SHA of HEAD commit
	const headCommit = await githubApi(token, `/git/commits/${headSha}`) as GitCommit;
	const treeSha = headCommit.tree.sha;

	// Create blobs for each file
	const treeItems = await Promise.all(files.map(async f => {
		const blob = await githubApi(token, '/git/blobs', 'POST', {
			content: btoa(unescape(encodeURIComponent(f.content))),
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

// ── Google Drive helpers ──────────────────────────────────────────────────────

async function uploadToDrive(token: string, name: string, content: string, mimeType: string, folderId: string): Promise<void> {
	// Check if file exists
	const q = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
	const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const listData = await listRes.json() as { files: Array<{ id: string }> };
	const existing = listData.files?.[0]?.id;

	const boundary = 'boundary_' + Math.random().toString(36).slice(2);
	const body = [
		`--${boundary}`,
		'Content-Type: application/json',
		'',
		JSON.stringify(existing ? {} : { name, parents: [folderId] }),
		`--${boundary}`,
		`Content-Type: ${mimeType}`,
		'',
		content,
		`--${boundary}--`,
	].join('\r\n');

	const url = existing
		? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=multipart`
		: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

	const res = await fetch(url, {
		method: existing ? 'PATCH' : 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': `multipart/related; boundary=${boundary}`,
		},
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Drive upload failed (${name}): ${res.status} — ${text}`);
	}
}

async function sendNotificationEmail(to: string, subject: string, html: string): Promise<void> {
	const resendKey = process.env.RESEND_API_KEY;
	if (!resendKey) return;
	await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from: 'Family Church Pipeline <noreply@familychurch.online>',
			to,
			subject,
			html,
		}),
	});
}

// ── Workflow ──────────────────────────────────────────────────────────────────

export class SermonPublishWorkflow extends WorkflowEntrypoint<CloudflareEnv, SermonPublishParams> {
	async run(event: WorkflowEvent<SermonPublishParams>, step: WorkflowStep): Promise<void> {
		const { jobId, edits } = event.payload;

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
				await patchJob(jobId, { ...patch, status: 'publishing', currentStep: 'build-mdx' });
			}
		} else {
			await patchJob(jobId, { status: 'publishing', currentStep: 'build-mdx' });
		}

		// ── Step 1: build-mdx ─────────────────────────────────────────────────────
		const { sermonMdx, sermonPath, devotionFiles } = await step.do('build-mdx', { retries: { limit: 2, delay: '5 seconds', backoff: 'linear' } }, async () => {
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);
			if (!job.taxonomy || !job.sermonBlock || !job.slug || !job.optimisedTitle) {
				throw new Error('Job is missing required fields (taxonomy, sermonBlock, slug, optimisedTitle)');
			}

			const sermonUrl = `${SITE_URL}/sermons/${job.metadata.date}-${job.slug}`;

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
				content: buildDevotionMdx(dev, job.metadata.image || '', sermonUrl),
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

			const files = [
				{ path: sermonPath, content: sermonMdx },
				...devotionFiles,
			];

			const sha = await commitFiles(
				githubToken,
				files,
				`feat: add sermon "${job.optimisedTitle}" (${job.metadata.date})\n\nAdds sermon MDX and ${devotionFiles.length} daily devotions.`,
			);
			return sha;
		});

		// ── Step 3: calendar ──────────────────────────────────────────────────────
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

		// ── Step 4: drive ─────────────────────────────────────────────────────────
		await step.do('drive', { retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' } }, async () => {
			await patchJob(jobId, { currentStep: 'drive' });
			const job = await getJob(jobId);
			if (!job || !job.taxonomy || !job.sermonBlock) return;

			const token = await getGoogleAccessToken(GOOGLE_SCOPES);
			const baseName = `${job.metadata.date}-${job.slug}`;

			// Transcript (.md)
			const transcriptMd = `---\ntitle: "${job.optimisedTitle?.replace(/"/g, "'")}"\ndate: ${job.metadata.date}\nspeaker: "${job.metadata.speaker || ''}"${job.metadata.series ? `\nseries: "${job.metadata.series}"` : ''}\n---\n\n## Transcript\n\n${job.transcript}`;
			await uploadToDrive(token, `${baseName}-transcript.md`, transcriptMd, 'text/markdown', DRIVE_ENRICHED);

			// Taxonomy JSON
			await uploadToDrive(token, `${baseName}-taxonomy.json`, JSON.stringify(job.taxonomy, null, 2), 'application/json', DRIVE_COMP_TAX);

			// Sermon block JSON
			await uploadToDrive(token, `${baseName}-sermon-block.json`, JSON.stringify(job.sermonBlock, null, 2), 'application/json', DRIVE_SERMON_BLOCK);
		});

		// ── Step 5: notify ────────────────────────────────────────────────────────
		await step.do('notify', { retries: { limit: 2, delay: '5 seconds', backoff: 'linear' } }, async () => {
			const job = await getJob(jobId);
			if (!job) return;

			const sermonUrl = `${SITE_URL}/sermons/${job.metadata.date}-${job.slug}`;
			await patchJob(jobId, { status: 'complete', currentStep: null });

			const notifyEmail = process.env.SERMON_NOTIFY_EMAIL;
			if (notifyEmail) {
				await sendNotificationEmail(
					notifyEmail,
					`Sermon published: ${job.optimisedTitle}`,
					`<p>The sermon "<strong>${job.optimisedTitle}</strong>" has been committed to GitHub.</p>
					<p>Commit: ${commitSha}</p>
					<p>Once the Cloudflare build completes, it will be live at:<br>
					<a href="${sermonUrl}">${sermonUrl}</a></p>`,
				);
			}
		});
	}
}

export { SermonPublishWorkflow as default };
