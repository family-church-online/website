import type { Template } from 'tinacms';

export const announcementsBlockSchema: Template = {
	name: 'announcements',
	label: 'Announcements',
	fields: [
		{
			type: 'string',
			label: 'Heading',
			name: 'heading',
			description: 'Optional. Leave blank to show no heading.',
		},
	],
	ui: {
		defaultItem: {
			heading: 'Announcements',
		},
	},
};
