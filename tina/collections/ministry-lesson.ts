import type { Collection } from 'tinacms';

export function ministryLessonCollection(opts: {
	name: string;
	label: string;
	path: string;
	route: string;
}): Collection {
	return {
		name: opts.name,
		label: opts.label,
		path: opts.path,
		format: 'mdx',
		ui: {
			router: ({ document }) => `${opts.route}/${document._sys.filename}`,
			filename: {
				slugify: (values) =>
					values.date
						? new Date(values.date).toISOString().split('T')[0]
						: 'undated',
			},
		},
		fields: [
			{
				name: 'title',
				label: 'Title',
				type: 'string',
				isTitle: true,
				required: true,
			},
			{
				name: 'date',
				label: 'Date',
				type: 'datetime',
				required: true,
				ui: { dateFormat: 'YYYY-MM-DD', timeFormat: false },
			},
			{
				name: 'scripture',
				label: 'Key Scripture',
				type: 'string',
				description: 'Reference shown at the top of the lesson, e.g. "John 3:16"',
			},
			{
				name: 'image',
				label: 'Lesson Image',
				type: 'image',
				ui: { uploadDir: () => '/images/lessons' },
			},
			{
				name: 'body',
				label: 'Content',
				type: 'rich-text',
				isBody: true,
				templates: [
					{
						name: 'YouTube',
						label: 'YouTube Video',
						fields: [
							{ name: 'id', label: 'Video ID', type: 'string' },
							{ name: 'title', label: 'Title (optional)', type: 'string' },
						],
					},
					{
						name: 'Scripture',
						label: 'Scripture Callout',
						fields: [
							{ name: 'ref', label: 'Reference', type: 'string', description: 'e.g. "John 3:16"' },
							{ name: 'text', label: 'Text', type: 'string', ui: { component: 'textarea' } },
						],
					},
					{
						name: 'Download',
						label: 'Download',
						fields: [
							{ name: 'url', label: 'File URL', type: 'string' },
							{ name: 'label', label: 'Button Label', type: 'string' },
						],
					},
					{
						name: 'Timeline',
						label: 'Timeline',
						fields: [
							{
								name: 'steps',
								label: 'Steps',
								type: 'object',
								list: true,
								ui: {
									itemProps: (item: { time?: string; label?: string }) => ({
										label: [item.time, item.label].filter(Boolean).join(' — ') || 'Step',
									}),
								},
								fields: [
									{ name: 'time', label: 'Time', type: 'string' },
									{ name: 'label', label: 'Label', type: 'string' },
									{ name: 'content', label: 'Content', type: 'string', ui: { component: 'textarea' } },
								],
							},
						],
					},
				],
			},
		],
	};
}
