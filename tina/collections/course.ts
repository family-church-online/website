import type { Collection } from 'tinacms';

export const CourseCollection: Collection = {
	name: 'course',
	label: 'Courses',
	path: 'src/content/courses',
	format: 'json',
	ui: {
		filename: {
			slugify: (values) =>
				values.title
					? values.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
					: 'untitled-course',
		},
	},
	fields: [
		{
			name: 'title',
			label: 'Course Title',
			type: 'string',
			isTitle: true,
			required: true,
			description: 'e.g. "Truth and Grace". The filename/slug is derived automatically.',
		},
		{
			name: 'description',
			label: 'Description',
			type: 'string',
			ui: { component: 'textarea' },
			description: 'Shown on the course index page.',
		},
		{
			name: 'requiredListId',
			label: 'Required PCO List ID',
			type: 'string',
			description: 'Planning Center list ID — only members of this list can access the course. Leave blank for public access.',
		},
		{
			name: 'chapters',
			label: 'Chapters',
			type: 'object',
			list: true,
			ui: {
				itemProps: (item) => ({ label: item.title ?? 'Chapter' }),
			},
			fields: [
				{
					name: 'slug',
					label: 'Slug',
					type: 'string',
					required: true,
					description: 'URL-safe ID matching the folder name, e.g. "the-son-of-god". Must be lowercase with hyphens.',
				},
				{
					name: 'title',
					label: 'Title',
					type: 'string',
					required: true,
					description: 'Display name, e.g. "The Son of God".',
				},
				{
					name: 'description',
					label: 'Description',
					type: 'string',
					ui: { component: 'textarea' },
				},
			],
		},
	],
};
