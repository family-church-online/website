import type { Template } from 'tinacms';

export const upcomingEventsBlockSchema: Template = {
	name: 'upcomingEvents',
	label: 'Upcoming Events',
	fields: [
		{ type: 'string', label: 'Heading', name: 'heading' },
		{
			type: 'number',
			label: 'Number of events to show',
			name: 'count',
			description: 'Defaults to 3 if left blank.',
		},
		{
			type: 'boolean',
			label: 'Show "All events" link',
			name: 'showViewAll',
		},
	],
	ui: {
		defaultItem: {
			heading: 'Upcoming Events',
			count: 3,
			showViewAll: true,
		},
	},
};
