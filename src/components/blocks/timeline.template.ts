import type { Template } from 'tinacms';

export const timelineBlockSchema: Template = {
	name: 'timeline',
	label: 'Service Timeline',
	fields: [
		{ name: 'label', label: 'Section Label', type: 'string', description: 'Small text above the heading, e.g. "Sundays · 09:30"' },
		{ name: 'heading', label: 'Heading', type: 'string' },
		{ name: 'intro', label: 'Intro Text', type: 'string', ui: { component: 'textarea' } },
		{
			name: 'items',
			label: 'Timeline Items',
			type: 'object',
			list: true,
			ui: {
				itemProps: (item) => ({ label: `${item.time ?? ''} — ${item.heading ?? ''}` }),
			},
			fields: [
				{ name: 'time', label: 'Time', type: 'string', description: 'e.g. 9:30 AM or ~9:45 AM' },
				{ name: 'heading', label: 'Heading', type: 'string' },
				{ name: 'body', label: 'Description', type: 'string', ui: { component: 'textarea' } },
			],
		},
		{ name: 'locationName', label: 'Location Name', type: 'string' },
		{ name: 'locationNote', label: 'Location Note', type: 'string', ui: { component: 'textarea' } },
		{ name: 'ctaText', label: 'CTA Text', type: 'string' },
		{ name: 'ctaEmail', label: 'CTA Email', type: 'string' },
	],
	ui: {
		defaultItem: {
			label: 'Sundays · 09:30',
			heading: 'Plan a Visit',
			intro: "Here's what a Sunday morning looks like. Come as you are.",
			items: [
				{ time: '9:30 AM', heading: 'Worship begins', body: 'We sing four or five songs — a mix of hymns and modern worship.' },
				{ time: '~9:45 AM', heading: 'Teaching from the Bible', body: 'Our pastor walks through a passage of Scripture.' },
				{ time: '~10:45 AM', heading: 'Coffee & fellowship', body: "Stick around afterward. We'd love to get to know you." },
			],
			locationName: 'Dainfern College, Johannesburg',
			locationNote: 'Parking is available on site.',
			ctaText: 'Got a question before you come?',
			ctaEmail: 'connect@familychurch.online',
		},
	},
};
