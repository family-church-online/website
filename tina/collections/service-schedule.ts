import type { Collection } from 'tinacms';

export const ServiceScheduleCollection: Collection = {
	name: 'serviceSchedule',
	label: 'Service Schedule',
	path: 'src/content/schedule',
	format: 'json',
	ui: {
		allowedActions: { create: false, delete: false },
		global: true,
	},
	fields: [
		{
			name: 'services',
			label: 'Services',
			type: 'object',
			list: true,
			ui: {
				itemProps: (item: Record<string, unknown>) => ({
					label: item?.scripture
						? `${String(item.date ?? '').slice(0, 10)} — ${String(item.scripture)}`
						: String(item?.date ?? '').slice(0, 10) || 'New Service',
				}),
			},
			fields: [
				{
					name: 'date',
					label: 'Date',
					type: 'datetime',
					required: true,
					ui: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
				},
				{
					name: 'scripture',
					label: 'Scripture',
					type: 'string',
					description: 'e.g. "Revelation 4:5-11 ESV"',
				},
				{
					name: 'series',
					label: 'Series',
					type: 'string',
				},
				{
					name: 'title',
					label: 'Sermon Title',
					type: 'string',
					description: 'Optional — leave blank if not yet decided.',
				},
				{
					name: 'speaker',
					label: 'Speaker',
					type: 'string',
				},
				{
					name: 'notes',
					label: 'Notes',
					type: 'string',
					ui: { component: 'textarea' },
					description: 'Anything else to show on the schedule (optional).',
				},
			],
		},
	],
};
