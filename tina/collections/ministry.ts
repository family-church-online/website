import type { Collection } from 'tinacms';

export const MinistryCollection: Collection = {
	name: 'ministry',
	label: 'Ministries',
	path: 'src/content/ministries',
	format: 'mdx',
	ui: {
		filename: {
			slugify: (values) => values.title
				? values.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
				: 'untitled',
		},
	},
	fields: [
		{ name: 'title', label: 'Title', type: 'string', isTitle: true, required: true },
		{ name: 'image', label: 'Image', type: 'image', ui: { uploadDir: () => '/ministries' } },
		{
			name: 'link',
			label: 'Link',
			type: 'object',
			fields: [
				{ name: 'label', label: 'Label', type: 'string' },
				{ name: 'url',   label: 'URL',   type: 'string' },
			],
		},
		{ name: 'body', label: 'Body', type: 'rich-text', isBody: true },
	],
};
