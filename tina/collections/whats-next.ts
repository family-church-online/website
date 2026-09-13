import type { Collection } from 'tinacms';

export const WhatsNextCollection: Collection = {
	name: 'whatsNext',
	label: "What's Next",
	path: 'src/content/whats-next',
	format: 'mdx',
	ui: {
		filename: {
			slugify: (values) =>
				values.date
					? new Date(values.date as string).toISOString().split('T')[0]
					: 'undated',
		},
	},
	fields: [
		{
			name: 'date',
			label: 'Date',
			type: 'datetime',
			required: true,
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
		},
		{
			name: 'scripture',
			label: 'Scripture',
			type: 'string',
			description: 'e.g. "Revelation 4:5-11 ESV"',
		},
		{
			name: 'series',
			label: 'Series',
			type: 'string',
		},
		{
			name: 'title',
			label: 'Sermon Title',
			type: 'string',
		},
		{
			name: 'speaker',
			label: 'Speaker',
			type: 'string',
		},
		{
			name: 'notes',
			label: 'Notes',
			type: 'string',
			ui: { component: 'textarea' },
		},
	],
};
