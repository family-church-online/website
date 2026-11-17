import type { Collection } from 'tinacms';

export const WorshipNotesCollection: Collection = {
	name: 'worshipNotes',
	label: 'Sunday Worship Notes',
	path: 'src/content/worship-notes',
	format: 'mdx',
	ui: {
		allowedActions: { create: false, delete: false },
		router: () => '/worship-notes',
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
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: false },
		},
		{
			name: 'image',
			label: 'Banner Image',
			type: 'image',
			ui: { uploadDir: () => '/images/tmp' },
		},
		{
			name: 'body',
			label: 'Worship Notes',
			type: 'rich-text',
			isBody: true,
		},
	],
};
