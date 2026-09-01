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
				name: 'body',
				label: 'Content',
				type: 'string',
				isBody: true,
				ui: { component: 'textarea' },
			},
		],
	};
}
