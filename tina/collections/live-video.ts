import type { Collection } from 'tinacms';

export const LiveVideoCollection: Collection = {
	name: 'liveVideo',
	label: 'Live Video',
	path: 'src/content/live-video',
	format: 'json',
	ui: {
		allowedActions: { create: false, delete: false },
	},
	fields: [
		{
			name: 'heading',
			label: 'Heading',
			type: 'string',
			required: true,
		},
		{
			name: 'subheading',
			label: 'Subheading',
			type: 'string',
			ui: { component: 'textarea' },
		},
		{
			name: 'embedUrl',
			label: 'Embed URL',
			description: 'The src URL from the Vimeo iframe embed code (e.g. https://vimeo.com/event/255155/embed).',
			type: 'string',
			required: true,
		},
	],
};
