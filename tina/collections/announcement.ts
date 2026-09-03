import type { Collection } from 'tinacms';

export const AnnouncementCollection: Collection = {
	name: 'announcement',
	label: 'Announcements',
	path: 'src/content/announcements',
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
		{
			name: 'expiryDate',
			label: 'Expiry Date',
			type: 'datetime',
			description: 'Announcement stops showing after this date. Leave blank to show indefinitely.',
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: false },
		},
		{ name: 'link',      label: 'Link URL',   type: 'string' },
		{ name: 'linkLabel', label: 'Link Label',  type: 'string', description: 'Button text, e.g. "Sign up". Defaults to "Learn more".' },
		{ name: 'body',      label: 'Body',        type: 'rich-text', isBody: true },
	],
};
