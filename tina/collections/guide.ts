import type { Collection } from 'tinacms';

export const GuideCollection: Collection = {
	name: 'guide',
	label: 'Guides',
	path: 'src/content/guides',
	format: 'mdx',
	ui: {
		router: ({ document }) => `/guides/${document._sys.filename}`,
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
			label: 'Image',
			type: 'image',
			ui: { uploadDir: () => '/images/guides' },
			description: 'Cover image shown on the listing page and at the top of the guide.',
		},
		{
			name: 'excerpt',
			label: 'Excerpt',
			type: 'string',
			ui: { component: 'textarea' },
			description: 'Short summary shown on the guides listing page.',
		},
		{
			name: 'body',
			label: 'Body',
			type: 'rich-text',
			isBody: true,
		},
	],
};
