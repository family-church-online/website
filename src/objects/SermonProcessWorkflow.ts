import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { env } from 'cloudflare:workers';
import { putJob, patchJob, getJob, type SermonJob, type Taxonomy, type SermonBlock, type Devotion } from '../lib/sermon-job';

export interface SermonProcessParams {
	jobId: string;
}

const SITE_URL = 'https://familychurch.online';

const DEVOTIONS_CAL_ID = 'kalsva0235makn1pq3d52sko1k@group.calendar.google.com';

const TAXONOMY_PROMPT = `You are a sermon taxonomy analyser. For each sermon you receive, output a single valid JSON object — nothing else. No markdown fences, no explanation, no preamble.

RULES:

The CONFIRMED IDENTITY block above the transcript provides title, speaker, series, date, and url
verbatim — use those values exactly as given. Do not derive or override them from the transcript.
Your job is to derive sermon_scripture, category, tags, and the review flag.

SCHEMA:
{
  "title": "string",
  "speaker": "string | null",
  "date": "YYYY-MM-DD",
  "url": "string",
  "series": "string | null",
  "sermon_scripture": "string",
  "category": ["string"],
  "tags": ["string"],
  "review": false,
  "review_notes": "string"
}

FIELD RULES:
- title: use exactly as given in CONFIRMED IDENTITY.
- speaker: use exactly as given in CONFIRMED IDENTITY (may be null if not known).
- date: use exactly as given — do not alter it.
- url: use exactly as given — do not alter it.
- series: use exactly as given in CONFIRMED IDENTITY (may be null).
- sermon_scripture: single passage most extensively quoted and expounded.
  Full ref e.g. "Joel 2:28-31 ESV". If no dominant passage, set review: true
  and record best candidate.
- category: 1 or 2 only if both substantially represented. Listener entry
  point, not theological content. Values: Faith & Doubt | Life &
  Relationships | Identity & Purpose | Suffering & Hope | Sin & Redemption |
  Prayer & Worship | Mission & Witness | Scripture & Doctrine | Bible
  Exploration
- review: true if sermon_scripture required inference beyond a confident
  direct reading. Always include review_notes when review is true.

TAGS (derived exclusively from transcript):
- "Book: Bookname Chapter" — mandatory, exactly one, from sermon_scripture
  book+chapter only
- "Ref: Bookname Chapter" — one per additional passage meaningfully
  quoted/expounded (not merely mentioned)
- Theological theme: plain value, 2–5 tags, dominant ideas e.g. "Second
  Coming", "Day of the Lord"
- Pastoral: plain value, 1–3 tags, human need addressed e.g.
  "Perseverance", "Grief"
- Application: plain value, 1–3 tags, concrete call to action e.g.
  "Building the Church", "Stewardship"
- Seasonal: plain value, only if explicitly preached for a season.
  Permitted only: "Easter" "Ascension" "Pentecost" "Christmas"

FINAL CHECK before outputting:
- Remove any tag that restates an assigned category
- Remove any tag that duplicates another in substance or phrasing`;

const SERMON_BLOCK_PROMPT = `You are a Sermon Content Generator for Family Church Online.

You will receive two files per sermon:
1. A .md file — the cleaned, headed sermon transcript.
2. A .json file — taxonomy / classification metadata (title, speaker,
   series, category, tags, sermon_scripture, url).

Your job is to generate the curated presentation content for this sermon —
NOT the transcript, and NOT any HTML. A separate program builds all HTML
(including the full transcript display) from your JSON output and the
taxonomy file directly. Do not attempt to reproduce, summarise, or
reference the transcript's raw text in your output beyond what these
fields ask for.

## CRITICAL OUTPUT RULES — never break these

- Output ONLY a single valid JSON object. No markdown fences, no
  explanatory text, preamble, or commentary before or after it.
- Do not include a transcript field of any kind.
- Do not include any HTML markup anywhere in your output.

## SCHEMA

{
  "shortDescription": "string",
  "tagLine": "string",
  "primaryTheme": "string",
  "subtitle": "string",
  "style": "string",
  "level": "string",
  "hook": "string",
  "takeaways": ["string", "..."],
  "audience": ["string", "..."],
  "additionalScriptures": [
    { "ref": "string", "theme": "string" }
  ],
  "bigIdea": "string",
  "keyScriptureText": "string",
  "keyScriptureRef": "string",
  "mainPoints": [
    { "title": "string", "body": "string" }
  ],
  "keyIllustration": "string | null",
  "application": ["string", "..."],
  "toRemember": "string"
}

## FIELD-BY-FIELD RULES

### shortDescription
- Aim for 145–160 characters. Count carefully.
- Lead with the tension or core insight. No preamble ("In this sermon...", "Join us as...").
- Second person ("you", "your") throughout.
- Plain language over insider language.
- Never include speaker name or church name.

### tagLine
- One sentence, 10–18 words exactly.
- A hook, not a summary. A stranger should find it interesting.

### primaryTheme
- Short descriptive phrase for the main scripture passage.

### subtitle
- One concise sentence capturing the sermon's core argument.

### style / level
- style: Teaching / Evangelistic / Devotional / Pastoral
- level: Introductory / Intermediate / In-depth

### hook
- 1–2 sentences naming the central dramatic or theological tension.

### takeaways
- 4–5 concrete, specific outcomes. Avoid generic phrases.

### audience
- 3–4 felt-need statements starting with "You…"

### additionalScriptures
- 4–5 entries from the transcript. Mix OT and NT.

### bigIdea
- One sentence — what the congregation most needed to believe or do.

### keyScriptureText / keyScriptureRef
- The single most important verse, quoted in full, with reference.

### mainPoints
- 2–4 points. Short title + one sentence body.

### keyIllustration
- Memorable story/illustration briefly described, or null.

### application
- 1–3 practical implications.

### toRemember
- One closing sentence worth carrying through the week.

## VOICE & THEOLOGY
- Write about the message, not the messenger. Do not name the preacher.
- Capitalise all divine pronouns: He, Him, His, You, Your (when referring to God/Jesus/Holy Spirit).
- Do not introduce ideas not present in the transcript.`;

const DEVOTIONS_PROMPT = `DEVOTION CREATION INSTRUCTIONS
================================

Each week a .md file will be provided. It contains a YAML front matter block at the top (between --- markers) and a transcript body below. Extract the following from the file:
- Sermon title — from the title: field
- Sermon page URL — from the post_url: field
- Sermon image — from the image_url: field
- Transcript — everything below the ## Transcript heading

Create seven daily devotions (Monday to Sunday) from the transcript. Follow these instructions exactly.


CONTENT STRUCTURE FOR EACH DEVOTION
-------------------------------------
- Open with the relevant Bible verse
- Reflection on that verse drawing from the transcript themes
- Supporting scriptures for the point
- Everyday life application
- Several prayer points


WRITING APPROACH
-----------------
Each devotion must be built outward from the most vivid, specific, concrete moment or image in the sermon that is relevant to that day's theme — a physical detail, a scene, an observation, an experience described in the transcript. Open the reflection inside that moment. Let the reader arrive there before any spiritual point is made. The theological truth should emerge from the image, not precede it. The concrete image or scene must remain the living thread that runs through the reflection, the application, and the prayer — it should not be introduced and then abandoned.

Do not open with doctrine, theology, or a statement about God. Open with the scene.

The pivot from the concrete image to the spiritual application must feel earned and natural — growing out of the story rather than being imported from outside it. Place the devotion's central insight near the end of the reflection, not at the beginning.


WRITING STYLE
--------------
- Write in a warm, intimate pastoral voice — personal and reflective, as if writing a letter to a friend. Avoid academic language, heavy structure, or numbered lists. Each devotion should feel hand-crafted, not templated. Do not mirror the conversational register of the sermon transcript; instead, draw from it thematically and transform it into something quieter and more personal.
- All divine pronouns (He, His, Him, You, Your, Me, My) must be capitalised
- Devotions must stand entirely on their own. Do not reference the sermon, the preacher, or the fact that a sermon was preached. A reader who has never heard the sermon should find the devotion complete and self-contained


HTML FORMATTING FOR CALENDAR DESCRIPTIONS
-------------------------------------------
- <h3> for all headings (verse reference, Reflection, Supporting Scriptures, Life Application, Prayer, Links)
- <blockquote> for all scripture text
- <b> for scripture verse references
- Each scripture reference and its blockquote must start on a new line
- <br><br> between prose paragraphs (Reflection, Life Application body text)
- <br> for line breaks within prayer points (each prayer point on its own line)
- <a href="..."> for links
- No markdown, no <html>, <head>, or <body> tags


SERMON IMAGE
-------------
Place the following HTML at the very top of each devotion, above the opening verse heading:

<a href="[post_url]"><img src="[image_url]" style="max-width:100%;"></a>


OUTPUT FORMAT
-------------
Output all 7 devotions using this exact delimiter format. No preamble, no commentary, nothing before the first ===DEVOTION=== or after the last devotion's CONTENT block.

===DEVOTION===
TITLE: The devotion headline (used as calendar event title)
CONTENT:
<full HTML content of the devotion>

===DEVOTION===
TITLE: ...
CONTENT:
...

(7 devotions total, Monday through Sunday)`;

async function callClaude(prompt: string, model = 'claude-opus-4-8'): Promise<string> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			model,
			max_tokens: 8192,
			messages: [{ role: 'user', content: prompt }],
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Claude API error: ${res.status} — ${text}`);
	}

	const data = await res.json() as { content: Array<{ type: string; text: string }> };
	const text = data.content.find(b => b.type === 'text')?.text ?? '';
	return text.trim();
}

function stripJsonFences(raw: string): string {
	if (!raw.startsWith('```')) return raw;
	let s = raw.split('```')[1];
	if (s.startsWith('json')) s = s.slice(4);
	return s.trim();
}

function slugify(text: string): string {
	return text.toLowerCase().trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function getNextMonday(afterDate: string): Date {
	// afterDate: YYYY-MM-DD (sermon date)
	const base = new Date(`${afterDate}T12:00:00+02:00`);
	const day  = base.getDay(); // 0=Sun, 0 means sermon is on Sunday — next Monday is +1
	const diff = day === 0 ? 1 : (8 - day) % 7 || 7;
	const mon  = new Date(base);
	mon.setDate(base.getDate() + diff);
	mon.setHours(0, 0, 0, 0);
	return mon;
}

interface VoyageEmbedResponse {
	data: Array<{ embedding: number[] }>;
}

async function embedAndStore(jobId: string, transcript: string, taxonomy: Taxonomy, slug: string): Promise<void> {
	const voyageKey = process.env.VOYAGE_API_KEY;
	const dbUrl = process.env.DATABASE_URL;
	if (!voyageKey || !dbUrl) return; // skip silently if not configured

	const MAX_CHUNK_WORDS = 600;
	const words = transcript.split(/\s+/).filter(Boolean);
	const chunks: string[] = [];
	for (let i = 0; i < words.length; i += MAX_CHUNK_WORDS) {
		chunks.push(words.slice(i, i + MAX_CHUNK_WORDS).join(' '));
	}

	const res = await fetch('https://api.voyageai.com/v1/embeddings', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${voyageKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ model: 'voyage-context-4', input: chunks }),
	});

	if (!res.ok) throw new Error(`Voyage API error: ${res.status}`);
	const data = await res.json() as VoyageEmbedResponse;

	// Store via Neon HTTP API
	const sermonUrl = `${SITE_URL}/sermons/${taxonomy.date}-${slug}`;
	for (let i = 0; i < chunks.length; i++) {
		const embedding = data.data[i]?.embedding;
		if (!embedding) continue;
		const pgRes = await fetch(dbUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: `INSERT INTO sermon_chunks (job_id, sermon_url, title, chunk_index, chunk_text, embedding)
				        VALUES ($1, $2, $3, $4, $5, $6)
				        ON CONFLICT (job_id, chunk_index) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding`,
				params: [jobId, sermonUrl, taxonomy.title, i, chunks[i], JSON.stringify(embedding)],
			}),
		});
		if (!pgRes.ok) throw new Error(`Neon insert failed: ${pgRes.status}`);
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

export class SermonProcessWorkflow extends WorkflowEntrypoint<CloudflareEnv, SermonProcessParams> {
	async run(event: WorkflowEvent<SermonProcessParams>, step: WorkflowStep): Promise<void> {
		const { jobId } = event.payload;

		// ── Step 1: taxonomy ──────────────────────────────────────────────────────
		const taxonomy = await step.do('taxonomy', { retries: { limit: 1, delay: '10 seconds', backoff: 'linear' } }, async () => {
			await patchJob(jobId, { currentStep: 'taxonomy' });
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			const postUrl = `${SITE_URL}/sermons/${job.metadata.date}-pending`;
			const context = [
				'CONFIRMED IDENTITY (use verbatim — do not derive from transcript):',
				`TITLE: ${job.metadata.title}`,
				`SPEAKER: ${job.metadata.speaker || '(unknown)'}`,
				`SERIES: ${job.metadata.series || '(none)'}`,
				`DATE: ${job.metadata.date}`,
				`POST URL: ${postUrl}`,
				'',
				`TRANSCRIPT:\n\n${job.transcript}`,
			].join('\n');

			const raw = await callClaude(`${TAXONOMY_PROMPT}\n\n---\n\n${context}`);
			const tax = JSON.parse(stripJsonFences(raw)) as Taxonomy;
			tax.url = postUrl;
			await patchJob(jobId, { taxonomy: tax });
			return tax;
		});

		// ── Step 2: sermon-block ──────────────────────────────────────────────────
		const sermonBlock = await step.do('sermon-block', { retries: { limit: 1, delay: '10 seconds', backoff: 'linear' } }, async () => {
			await patchJob(jobId, { currentStep: 'sermon-block' });
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			const transcriptMd = `---\ntitle: "${job.metadata.title.replace(/"/g, "'")}"\ndate: ${job.metadata.date}\nspeaker: "${job.metadata.speaker || ''}"\n---\n\n## Transcript\n\n${job.transcript}`;
			const prompt = `${SERMON_BLOCK_PROMPT}\n\n---\n\nTRANSCRIPT (.md file):\n\n${transcriptMd}\n\nTAXONOMY (.json file):\n\n${JSON.stringify(taxonomy, null, 2)}`;
			const raw = await callClaude(prompt);
			const block = JSON.parse(stripJsonFences(raw)) as SermonBlock;
			await patchJob(jobId, { sermonBlock: block });
			return block;
		});

		// ── Step 3: optimise-slug ─────────────────────────────────────────────────
		const { slug, optimisedTitle } = await step.do('optimise-slug', { retries: { limit: 1, delay: '5 seconds', backoff: 'linear' } }, async () => {
			await patchJob(jobId, { currentStep: 'optimise-slug' });
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			const prompt = [
				'You are an SEO expert for a church website.',
				"Given a sermon's big idea, main scripture, and original title, produce:",
				'1. An SEO-optimised title — compelling, searchable, under 65 characters; format EXACTLY as "Heading : Book Chapter:Verses" using " : " (space-colon-space) to separate the heading from the FULL scripture reference — never abbreviate to chapter alone, never use a dash or em-dash as separator',
				'2. A URL slug — lowercase, hyphens only; include every word from the title (do NOT drop prepositions, articles, or any other word); include an abbreviated scripture reference (e.g. john-3-16); under 70 characters total',
				'',
				`Original title: ${job.metadata.title}`,
				`Main scripture: ${taxonomy.sermon_scripture}`,
				`Big idea: ${sermonBlock.bigIdea}`,
				'',
				'Return JSON only — no markdown fences: {"title": "...", "slug": "..."}',
			].join('\n');

			const raw = await callClaude(prompt, 'claude-haiku-4-5-20251001');
			const data = JSON.parse(stripJsonFences(raw)) as { title: string; slug: string };
			const finalSlug = slugify(data.slug || data.title);
			const finalTitle = (data.title || job.metadata.title).trim();
			await patchJob(jobId, { slug: finalSlug, optimisedTitle: finalTitle });
			return { slug: finalSlug, optimisedTitle: finalTitle };
		});

		// ── Step 4: move-audio ────────────────────────────────────────────────────
		const { audioUrl, audioSizeBytes } = await step.do('move-audio', { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } }, async () => {
			await patchJob(jobId, { currentStep: 'move-audio' });
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			const r2 = (env as unknown as CloudflareEnv).SERMON_AUDIO;
			const destKey = `sermons/${job.metadata.date}-${slug}.mp3`;

			const tempObj = await r2.get(job.tempAudioKey);
			if (!tempObj) throw new Error(`Temp audio not found in R2: ${job.tempAudioKey}`);

			const audioBytes = await tempObj.arrayBuffer();
			await r2.put(destKey, audioBytes, { httpMetadata: { contentType: 'audio/mpeg' } });
			await r2.delete(job.tempAudioKey);

			const R2_PUBLIC_URL = process.env.R2_AUDIO_PUBLIC_URL || 'https://audio.familychurch.online';
			const publicUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${destKey}`;
			const sizeBytes = audioBytes.byteLength;

			await patchJob(jobId, { audioUrl: publicUrl, audioSizeBytes: sizeBytes });
			return { audioUrl: publicUrl, audioSizeBytes: sizeBytes };
		});

		// ── Step 5: devotions ─────────────────────────────────────────────────────
		const devotions = await step.do('devotions', { retries: { limit: 1, delay: '30 seconds', backoff: 'linear' } }, async () => {
			await patchJob(jobId, { currentStep: 'devotions' });
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			const imageUrl = job.metadata.image
				? `https://familychurch.online${job.metadata.image}`
				: '';
			const postUrl = `${SITE_URL}/sermons/${job.metadata.date}-${slug}`;

			const transcriptMd = `---\ntitle: "${job.metadata.title.replace(/"/g, "'")}"` +
				`\ndate: ${job.metadata.date}` +
				`\nspeaker: "${job.metadata.speaker || ''}"` +
				`\npost_url: "${postUrl}"` +
				`\nimage_url: "${imageUrl}"` +
				`\n---\n\n## Transcript\n\n${job.transcript}`;

			const monday = getNextMonday(job.metadata.date);
			const devotionDates: string[] = [];
			for (let i = 0; i < 7; i++) {
				const d = new Date(monday.getTime() + i * 86400 * 1000);
				devotionDates.push(d.toISOString().slice(0, 10));
			}

			const fullPrompt = `${DEVOTIONS_PROMPT}\n\n---\n\nTRANSCRIPT FILE (.md):\n\n${transcriptMd}\n\nPOST URL: ${postUrl}\nIMAGE URL: ${imageUrl}`;
			const raw = await callClaude(fullPrompt, 'claude-opus-4-8');

			const devotionList: Devotion[] = [];
			for (const section of raw.split('===DEVOTION===')) {
				const s = section.trim();
				if (!s) continue;
				const titleM   = s.match(/^TITLE:\s*(.+?)[\r\n]/);
				const contentM = s.match(/^CONTENT:\s*[\r\n]([\s\S]*)/m);
				if (titleM && contentM) {
					const idx = devotionList.length;
					devotionList.push({
						title:   titleM[1].trim(),
						content: contentM[1].trim(),
						date:    devotionDates[idx] ?? devotionDates[6],
					});
				}
			}

			await patchJob(jobId, { devotions: devotionList });
			return devotionList;
		});

		// ── Step 6: embed ─────────────────────────────────────────────────────────
		await step.do('embed', { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' } }, async () => {
			await patchJob(jobId, { currentStep: 'embed' });
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);
			// embedAndStore is a no-op if VOYAGE_API_KEY / DATABASE_URL not set
			await embedAndStore(jobId, job.transcript, taxonomy, slug);
		});

		// ── Step 7: notify ────────────────────────────────────────────────────────
		await step.do('notify', { retries: { limit: 2, delay: '5 seconds', backoff: 'linear' } }, async () => {
			const job = await getJob(jobId);
			if (!job) throw new Error(`Job not found: ${jobId}`);

			const reviewUrl = `${SITE_URL}/sermon-admin/${jobId}`;
			await patchJob(jobId, { status: 'review', currentStep: null });

			const notifyEmail = process.env.SERMON_NOTIFY_EMAIL;
			if (notifyEmail) {
				await sendNotificationEmail(
					notifyEmail,
					`Sermon ready for review: ${optimisedTitle}`,
					`<p>The sermon "<strong>${optimisedTitle}</strong>" (${job.metadata.date}) has been processed and is ready for review.</p>
					<p><a href="${reviewUrl}">Review and approve</a></p>
					<ul>
					<li>Scripture: ${taxonomy.sermon_scripture}</li>
					<li>Slug: ${slug}</li>
					<li>Devotions: ${devotions.length}/7</li>
					</ul>`,
				);
			}
		});
	}
}

// Error handler — runs if any unhandled step error propagates
// We need a wrapper to catch workflow-level failures
export { SermonProcessWorkflow as default };
