import type { Collection } from 'tinacms';

const scriptureLink = [
	{ name: 'ref', label: 'Reference', type: 'string' as const },
	{ name: 'url', label: 'URL', type: 'string' as const },
];

const linkList = (name: string, label: string) => ({
	name,
	label,
	type: 'object' as const,
	list: true,
	ui: { itemProps: (item: { ref?: string }) => ({ label: item.ref ?? label }) },
	fields: scriptureLink,
});

export const DevotionCollection: Collection = {
	name: 'devotion',
	label: 'Devotions',
	path: 'src/content/devotion',
	format: 'mdx',
	ui: {
		router: ({ document }) => `/devotion/${document._sys.filename}`,
		filename: {
			slugify: (values) =>
				values.date
					? new Date(values.date).toISOString().split('T')[0]
					: 'undated',
		},
	},
	fields: [
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
			name: 'image',
			label: 'Sermon Image URL',
			type: 'string',
			description: 'Populated by script2 from the calendar event.',
		},
		{
			name: 'sermonUrl',
			label: 'Sermon URL',
			type: 'string',
			description: 'Link back to the full sermon page.',
		},

		// ── KEY SCRIPTURE ─────────────────────────────────────────────────────
		{
			name: 'keyScripture',
			label: 'Key Scripture',
			type: 'object',
			fields: [
				{ name: 'ref', label: 'Reference', type: 'string', description: 'e.g. "Luke 5:8"' },
				{ name: 'text', label: 'Text', type: 'string', ui: { component: 'textarea' } },
			],
		},

		// ── BODY SECTIONS ─────────────────────────────────────────────────────
		{
			name: 'reflection',
			label: 'Reflection',
			type: 'string',
			ui: { component: 'textarea' },
			description: 'Separate paragraphs with a blank line.',
		},
		{
			name: 'supportingScriptures',
			label: 'Supporting Scriptures',
			type: 'object',
			list: true,
			ui: { itemProps: (item: { ref?: string }) => ({ label: item.ref ?? 'Scripture' }) },
			fields: [
				{ name: 'ref', label: 'Reference', type: 'string' },
				{ name: 'text', label: 'Text', type: 'string', ui: { component: 'textarea' } },
			],
		},
		{
			name: 'lifeApplication',
			label: 'Life Application',
			type: 'string',
			ui: { component: 'textarea' },
			description: 'Separate paragraphs with a blank line.',
		},
		{
			name: 'prayer',
			label: 'Prayer',
			type: 'string',
			ui: { component: 'textarea' },
		},

		// ── READING PLANS ─────────────────────────────────────────────────────
		{
			name: 'readingPlans',
			label: 'Reading Plans',
			type: 'object',
			fields: [
				{
					name: 'connected',
					label: 'Connected Reading',
					type: 'object',
					fields: [
						linkList('ot', 'Old Testament'),
						linkList('nt', 'New Testament'),
						linkList('wisdom', 'Wisdom'),
					],
				},
				linkList('chronological', 'Chronological Reading'),
				{
					name: 'literary',
					label: 'ESV Literary Study Bible',
					type: 'object',
					fields: [
						linkList('wisdom', 'Wisdom'),
						linkList('narrative', 'Narrative'),
						linkList('historyProphecy', 'History & Prophecy'),
						linkList('nt', 'New Testament'),
					],
				},
			],
		},
	],
};
