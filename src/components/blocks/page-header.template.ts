import type { Template } from 'tinacms';

export const pageHeaderBlockSchema: Template = {
	name: 'pageHeader',
	label: 'Page Header',
	fields: [
		{ type: 'string', label: 'Label (small eyebrow)', name: 'label' },
		{ type: 'string', label: 'Heading', name: 'heading' },
		{ type: 'string', label: 'Intro paragraph', name: 'intro', ui: { component: 'textarea' } },
	],
	ui: {
		defaultItem: {
			label: 'About',
			heading: 'Who we are',
			intro: 'Add an intro paragraph here.',
		},
	},
};
