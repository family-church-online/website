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
				name: 'scriptures',
				label: 'Scriptures',
				type: 'object',
				list: true,
				ui: { itemProps: (item: { ref?: string }) => ({ label: item.ref ?? 'Scripture' }) },
				fields: [
					{ name: 'ref', label: 'Reference', type: 'string', description: 'e.g. "John 3:16"' },
					{ name: 'text', label: 'Text', type: 'string', ui: { component: 'textarea' } },
				],
			},
			{
				name: 'paragraphs',
				label: 'Paragraphs',
				type: 'object',
				list: true,
				fields: [
					{ name: 'content', label: 'Content', type: 'string', ui: { component: 'textarea' } },
				],
			},
			{
				name: 'images',
				label: 'Images',
				type: 'object',
				list: true,
				ui: { itemProps: (item: { description?: string }) => ({ label: item.description ?? 'Image' }) },
				fields: [
					{ name: 'image', label: 'Image', type: 'image', ui: { uploadDir: () => '/images/lessons' } },
					{ name: 'description', label: 'Description', type: 'string' },
				],
			},
			{
				name: 'videos',
				label: 'Videos',
				type: 'object',
				list: true,
				ui: { itemProps: (item: { url?: string }) => ({ label: item.url ?? 'Video' }) },
				fields: [
					{ name: 'url', label: 'Video URL', type: 'string' },
					{ name: 'description', label: 'Description', type: 'string', ui: { component: 'textarea' } },
				],
			},
		],
	};
}
