import type { Collection } from 'tinacms';

export const SermonNotesCollection: Collection = {
	name: 'sermonNotes',
	label: 'Sunday Sermon Notes',
	path: 'src/content/sermon-notes',
	format: 'mdx',
	ui: {
		allowedActions: { create: false, delete: false },
		router: () => '/sermon-notes',
	},
	fields: [
		{
			name: 'title',
			label: 'Sermon Title',
			type: 'string',
			isTitle: true,
			required: true,
		},
		{
			name: 'date',
			label: 'Date',
			type: 'datetime',
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: false },
		},
		{
			name: 'speaker',
			label: 'Speaker',
			type: 'string',
		},
		{
			name: 'series',
			label: 'Series',
			type: 'string',
		},
		{
			name: 'image',
			label: 'Sermon Image',
			type: 'image',
			ui: { uploadDir: () => '/images/sermons' },
		},
		{
			name: 'body',
			label: 'Sermon Notes',
			type: 'rich-text',
			isBody: true,
		},
	],
};
