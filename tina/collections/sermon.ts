import type { Collection } from 'tinacms';

export const SermonCollection: Collection = {
	name: 'sermon',
	label: 'Sermons',
	path: 'src/content/sermons',
	format: 'mdx',
	ui: {
		router: ({ document }) => `/sermons/${document._sys.filename}`,
		filename: {
			slugify: (values) => {
				const date = values.date
					? new Date(values.date).toISOString().split('T')[0]
					: 'undated';
				const slug = values.title
					? values.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
					: 'untitled';
				return `${date}-${slug}`;
			},
		},
	},
	fields: [
		// ── IDENTITY ──────────────────────────────────────────────────────────
		{
			name: 'title',
			label: 'Title',
			type: 'string',
			isTitle: true,
			required: true,
		},
		{
			name: 'date',
			label: 'Date',
			type: 'datetime',
			required: true,
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: false },
		},
		{
			name: 'speaker',
			label: 'Speaker',
			type: 'string',
			required: true,
		},
		{
			name: 'series',
			label: 'Series',
			type: 'string',
		},

		// ── SCRIPTURE ─────────────────────────────────────────────────────────
		{
			name: 'scripture',
			label: 'Primary Scripture',
			type: 'string',
			required: true,
			description: 'Reference and translation together, e.g. "Habakkuk 3:17-19 ESV"',
		},
		{
			name: 'primaryTheme',
			label: 'Primary Theme',
			type: 'string',
			description: 'Short phrase describing the central theme, e.g. "Choosing joy when everything fails"',
		},
		{
			name: 'additionalScriptures',
			label: 'Additional Scriptures',
			type: 'object',
			list: true,
			ui: {
				itemProps: (item) => ({ label: item.ref ?? 'Scripture' }),
			},
			fields: [
				{ name: 'ref', label: 'Reference', type: 'string' },
				{ name: 'theme', label: 'Theme', type: 'string', ui: { component: 'textarea' } },
			],
		},

		// ── MEDIA ─────────────────────────────────────────────────────────────
		{
			name: 'image',
			label: 'Sermon Image',
			type: 'image',
		},
		{
			name: 'audioUrl',
			label: 'Audio URL',
			type: 'string',
			description: 'Direct link to the MP3 file (R2 URL after upload).',
		},
		{
			name: 'audioSizeBytes',
			label: 'Audio File Size (bytes)',
			type: 'number',
			description: 'Populated by upload-audio.mjs — required for podcast RSS enclosure tag.',
		},
		{
			name: 'vimeoUrl',
			label: 'Vimeo URL',
			type: 'string',
			description: 'Vimeo player embed URL, e.g. "https://player.vimeo.com/video/123456"',
		},
		{
			name: 'durationMinutes',
			label: 'Duration (minutes)',
			type: 'number',
		},

		// ── PRESENTATION COPY ─────────────────────────────────────────────────
		{
			name: 'tagLine',
			label: 'Tag Line',
			type: 'string',
			description: '10–18 words. The punchy hook used on listing pages and social cards.',
			ui: { component: 'textarea' },
		},
		{
			name: 'shortDescription',
			label: 'Short Description',
			type: 'string',
			description: '40–60 words. Used for search results, social previews, and listing cards.',
			ui: { component: 'textarea' },
		},
		{
			name: 'subtitle',
			label: 'Subtitle',
			type: 'string',
			description: 'One sentence shown below the scripture reference on the sermon page.',
			ui: { component: 'textarea' },
		},
		{
			name: 'hook',
			label: 'Hook',
			type: 'string',
			description: '"What this is about" — a paragraph-length question or tension that frames the sermon for a visitor.',
			ui: { component: 'textarea' },
		},

		// ── STYLE ─────────────────────────────────────────────────────────────
		{
			name: 'style',
			label: 'Preaching Style',
			type: 'string',
			options: ['Expository', 'Pastoral', 'Topical', 'Evangelistic'],
		},
		{
			name: 'level',
			label: 'Level',
			type: 'string',
			options: ['Introductory', 'Intermediate', 'Advanced'],
		},

		// ── ABOUT LISTS ───────────────────────────────────────────────────────
		{
			name: 'takeaways',
			label: "What You'll Take Away",
			type: 'string',
			list: true,
			description: 'Bullet list of concrete things listeners will learn or be equipped to do.',
		},
		{
			name: 'audience',
			label: 'This Is For You If…',
			type: 'string',
			list: true,
			description: 'Bullet list of situations or feelings that describe the target listener.',
		},

		// ── SERMON NOTES ──────────────────────────────────────────────────────
		{
			name: 'bigIdea',
			label: 'The Big Idea',
			type: 'string',
			description: "One sentence capturing the sermon's single central claim.",
			ui: { component: 'textarea' },
		},
		{
			name: 'keyScriptureRef',
			label: 'Key Scripture Reference',
			type: 'string',
			description: 'e.g. "Habakkuk 3:17-19 ESV"',
		},
		{
			name: 'keyScriptureText',
			label: 'Key Scripture Text',
			type: 'string',
			description: 'The full quoted text of the key scripture passage.',
			ui: { component: 'textarea' },
		},
		{
			name: 'mainPoints',
			label: 'Main Points',
			type: 'object',
			list: true,
			ui: {
				itemProps: (item) => ({ label: item.title ?? 'Point' }),
			},
			fields: [
				{ name: 'title', label: 'Title', type: 'string' },
				{ name: 'body', label: 'Body', type: 'string', ui: { component: 'textarea' } },
			],
		},
		{
			name: 'keyIllustration',
			label: 'Key Illustration',
			type: 'string',
			description: 'The main illustration or analogy from the sermon, summarised in a paragraph.',
			ui: { component: 'textarea' },
		},
		{
			name: 'application',
			label: 'What This Means for Us',
			type: 'string',
			list: true,
			description: 'Practical take-home action points.',
		},
		{
			name: 'toRemember',
			label: 'To Remember',
			type: 'string',
			description: 'A single memorable closing statement.',
			ui: { component: 'textarea' },
		},
		{
			name: 'closingPrayer',
			label: 'Closing Prayer',
			type: 'string',
			ui: { component: 'textarea' },
		},

		// ── TAXONOMY ──────────────────────────────────────────────────────────
		{
			name: 'categories',
			label: 'Categories',
			type: 'string',
			list: true,
			options: [
				'Suffering & Hope',
				'Prayer & Worship',
				'Gospel & Salvation',
				'Discipleship',
				'Church & Community',
				'Family & Relationships',
				'Faith & Trust',
				'Prophecy & Revelation',
			],
			description: 'Broad thematic categories for filtering and navigation.',
		},
		{
			name: 'tags',
			label: 'Tags',
			type: 'string',
			list: true,
			description: 'Thematic tags only — series, book, and scripture refs are captured in dedicated fields above.',
		},

		// ── METADATA ──────────────────────────────────────────────────────────
		{
			name: 'guid',
			label: 'Podcast GUID',
			type: 'string',
			description: 'Squarespace permalink preserved as the podcast episode GUID. Leave blank for new sermons — the page URL will be used.',
		},
		{
			name: 'review',
			label: 'Needs Review',
			type: 'boolean',
			description: 'Flag this sermon for editorial review before it goes live.',
		},
		{
			name: 'transcribedBy',
			label: 'Transcribed By',
			type: 'string',
			description: 'The service that generated the transcript, e.g. "deepgram-nova-2".',
		},
		{
			name: 'wordCount',
			label: 'Word Count',
			type: 'number',
			description: 'Auto-populated by the import script — do not edit manually.',
		},

		// ── TRANSCRIPT ────────────────────────────────────────────────────────
		{
			name: 'body',
			label: 'Transcript',
			type: 'string',
			isBody: true,
			ui: { component: 'textarea' },
		},
	],
};
