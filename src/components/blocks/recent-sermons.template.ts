import type { Template } from 'tinacms';

export const recentSermonsBlockSchema: Template = {
	name: 'recentSermons',
	label: 'Recent Sermons',
	fields: [
		{ type: 'string', label: 'Heading', name: 'heading' },
		{
			type: 'number',
			label: 'Number of sermons to show',
			name: 'count',
			description: 'Defaults to 5 if left blank.',
		},
	],
	ui: {
		defaultItem: {
			heading: 'Recent Sermons',
			count: 5,
		},
	},
};
