import type { Collection } from 'tinacms';

export const LiveVideoCollection: Collection = {
	name: 'liveVideo',
	label: 'Live',
	path: 'src/content/live-video',
	format: 'json',
	ui: {
		allowedActions: { create: false, delete: false },
	},
	fields: [
		{
			name: 'pageHeading',
			label: 'Page Heading',
			type: 'string',
			required: true,
		},
		{
			name: 'video',
			label: 'Video Section',
			type: 'object',
			fields: [
				{
					name: 'heading',
					label: 'Heading',
					type: 'string',
				},
				{
					name: 'embedUrl',
					label: 'Embed URL',
					description: 'The src URL from the Vimeo iframe embed code (e.g. https://vimeo.com/event/255155/embed).',
					type: 'string',
				},
			],
		},
		{
			name: 'audio',
			label: 'Audio Section',
			type: 'object',
			fields: [
				{
					name: 'heading',
					label: 'Heading',
					type: 'string',
				},
				{
					name: 'streamUrl',
					label: 'Stream URL',
					description: 'Direct audio stream URL (used as the HTML5 audio src and as a fallback link).',
					type: 'string',
				},
				{
					name: 'description',
					label: 'Description',
					description: 'Service time and data-usage info shown below the player.',
					type: 'string',
					ui: { component: 'textarea' },
				},
			],
		},
	],
};
