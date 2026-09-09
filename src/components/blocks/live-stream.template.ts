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
		{
			type: 'string',
			label: 'Report Widget Text',
			name: 'reportDescription',
			ui: { component: 'textarea' },
			description: 'Text shown above the problem-report icons when the stream is live.',
		},
		{
			type: 'string',
			label: 'Vimeo Event ID',
			name: 'vimeoEventId',
			description: 'Numeric ID from your Vimeo live event URL — e.g. for vimeo.com/event/255155 enter 255155. Used to detect when the stream is live.',
		},
	],
	ui: {
		defaultItem: {
			heading: 'Watch & Listen Live',
			subheading: 'Join us for our live Sunday service — watch the stream or listen in with minimal data.',
			reportDescription: "Let us know if you're experiencing technical issues. Clicking on the relevant icon below will alert our technicians immediately.",
			vimeoEventId: '255155',
		},
	},
};
