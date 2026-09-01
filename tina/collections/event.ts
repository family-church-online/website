import type { Collection } from 'tinacms';

export const EventCollection: Collection = {
	name: 'event',
	label: 'Events',
	path: 'src/content/events',
	format: 'mdx',
	ui: {
		router: ({ document }) => `/events/${document._sys.filename}`,
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
			label: 'Start Date & Time',
			type: 'datetime',
			required: true,
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
		},
		{
			name: 'endDate',
			label: 'End Date & Time',
			type: 'datetime',
			description: 'Optional — leave blank for single-time events.',
			ui: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
		},
		{
			name: 'location',
			label: 'Location',
			type: 'string',
			description: 'e.g. "Main Hall" or "Online via Zoom"',
		},
		{
			name: 'image',
			label: 'Image',
			type: 'image',
			ui: { uploadDir: () => '/images/events' },
		},
		{
			name: 'description',
			label: 'Short Description',
			type: 'string',
			description: 'Shown on listing cards and social previews (1–2 sentences).',
			ui: { component: 'textarea' },
		},
		{
			name: 'registrationUrl',
			label: 'Registration / Info Link',
			type: 'string',
			description: 'Optional external link for sign-ups or more information.',
		},
		{
			name: 'body',
			label: 'Full Details',
			type: 'rich-text',
			isBody: true,
		},
	],
};
