import type { Template } from 'tinacms';

export const liveStreamBlockSchema: Template = {
	name: 'liveStream',
	label: 'Live Stream',
	fields: [
		{ type: 'string', label: 'Heading', name: 'heading' },
		{
			type: 'string',
			label: 'Subheading',
			name: 'subheading',
			ui: { component: 'textarea' },
		},
		{
			type: 'string',
			label: 'Audio Stream URL',
			name: 'streamUrl',
			description: 'Direct URL used as the HTML5 audio src.',
		},
		{
			type: 'string',
			label: 'Description',
			name: 'description',
			ui: { component: 'textarea' },
			description: 'Service time and data-usage info shown below the player.',
		},
	],
	ui: {
		defaultItem: {
			heading: 'Watch & Listen Live',
			subheading: 'Join us for our live Sunday service — watch the stream or listen in with minimal data.',
		},
	},
};
