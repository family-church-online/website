import type { Template } from 'tinacms';

export const pageHeaderBlockSchema: Template = {
	name: 'pageHeader',
	label: 'Page Header',
	fields: [
		{ type: 'string', label: 'Label (small eyebrow)', name: 'label' },
		{ type: 'string', label: 'Heading', name: 'heading' },
		{ type: 'rich-text', label: 'Intro', name: 'body' },
	],
	ui: {
		defaultItem: {
			label: 'About',
			heading: 'Who we are',
			intro: 'Add an intro paragraph here.',
		},
	},
};
