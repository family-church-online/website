import type { Collection } from 'tinacms';

export const GroupCollection: Collection = {
	name: 'group',
	label: 'Groups',
	path: 'src/content/groups',
	format: 'mdx',
	ui: {
		filename: {
			slugify: (values) =>
				values.name
					? String(values.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
					: 'group',
		},
		defaultItem: { open: true, frequency: 'Weekly', gender: 'Mixed', lifeStage: 'All Ages' },
	},
	fields: [
		{
			name: 'name',
			label: 'Group Name',
			type: 'string',
			isTitle: true,
			required: true,
		},
		{
			name: 'day',
			label: 'Day',
			type: 'string',
			required: true,
			options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
		},
		{
			name: 'time',
			label: 'Time',
			type: 'string',
			required: true,
			description: '24-hour format, e.g. "18:30"',
		},
		{
			name: 'type',
			label: 'Type',
			type: 'string',
			options: ['Bible Study', 'Prayer', 'Worship', 'Mixed'],
		},
		{
			name: 'area',
			label: 'Area',
			type: 'string',
			description: 'Suburb or area, e.g. "Fourways"',
		},
		{
			name: 'frequency',
			label: 'Frequency',
			type: 'string',
			options: ['Weekly', 'Bi-weekly', 'Monthly', '1st of month', '1st & 3rd', '2nd & 4th'],
		},
		{
			name: 'gender',
			label: 'Gender',
			type: 'string',
			options: ['Mixed', 'Men Only', 'Women Only'],
		},
		{
			name: 'lifeStage',
			label: 'Life Stage',
			type: 'string',
			options: ['All Ages', 'Young Adults', 'Couples', 'Families', 'Seniors'],
		},
		{
			name: 'contact',
			label: 'Contact Name',
			type: 'string',
		},
		{
			name: 'open',
			label: 'Open (accepting new members)',
			type: 'boolean',
		},
	],
};
