import type { Collection } from 'tinacms';

export const MemorialCollection: Collection = {
	name: 'memorial',
	label: 'Memorial',
	path: 'src/content/memorial',
	format: 'mdx',
	ui: {
		router: ({ document }) => `/memorial/${document._sys.filename}`,
		filename: {
			slugify: (values) => {
				const title = (values.title ?? '')
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '');
				return title || 'memorial';
			},
		},
	},
	fields: [
		{
			name: 'title',
			label: 'Headline',
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
			label: 'Image',
			type: 'image',
			ui: { uploadDir: () => '/images/memorial' },
		},
		{
			name: 'vimeoUrl',
			label: 'Vimeo URL',
			type: 'string',
			description: 'e.g. https://vimeo.com/123456789',
		},
		{
			name: 'pdfs',
			label: 'Downloads',
			type: 'object',
			list: true,
			ui: {
				itemProps: (item: { label?: string }) => ({ label: item.label || 'Download' }),
			},
			fields: [
				{ name: 'file', label: 'File', type: 'image', ui: { uploadDir: () => '/images/memorial' } },
				{ name: 'label', label: 'Label', type: 'string', description: 'e.g. "Order of Service"' },
			],
		},
	],
};
