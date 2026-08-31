import type { Collection } from 'tinacms';

export const ThreeMinutesCollection: Collection = {
	name: 'threeminutes',
	label: 'Three Minutes',
	path: 'src/content/threeminutes',
	format: 'mdx',
	ui: {
		router: ({ document }) => `/threeminutes/${document._sys.filename}`,
		filename: {
			slugify: (values) =>
				(values.title ?? 'untitled')
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/(^-|-$)/g, ''),
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
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: false },
		},
		{
			name: 'image',
			label: 'Image URL',
			type: 'string',
			description: 'Full URL of the article image.',
		},
		{
			name: 'description',
			label: 'Description',
			type: 'string',
			description: 'Short excerpt shown on listing cards and social previews.',
			ui: { component: 'textarea' },
		},
		{
			name: 'body',
			label: 'Body',
			type: 'rich-text',
			isBody: true,
		},
	],
};
