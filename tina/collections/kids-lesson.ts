import type { Collection } from 'tinacms';

export function kidsLessonCollection(opts: {
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
				slugify: (values) => {
					const date = values.date
						? new Date(values.date).toISOString().split('T')[0]
						: 'undated';
					const title = (values.title ?? '')
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, '-')
						.replace(/^-|-$/g, '');
					return title ? `${date}-${title}` : date;
				},
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
				name: 'image',
				label: 'Hero Image',
				type: 'image',
				ui: { uploadDir: () => '/images/lessons' },
			},
			{
				name: 'paragraphs',
				label: 'Paragraphs',
				type: 'object',
				list: true,
				ui: {
					itemProps: (item: { heading?: string }) => ({ label: item.heading || 'Paragraph' }),
				},
				fields: [
					{ name: 'heading', label: 'Heading', type: 'string' },
					{ name: 'content', label: 'Content', type: 'string', ui: { component: 'textarea' } },
				],
			},
			{
				name: 'images',
				label: 'Images',
				type: 'object',
				list: true,
				ui: {
					itemProps: (item: { description?: string }) => ({ label: item.description || 'Image' }),
				},
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
				ui: {
					itemProps: (item: { url?: string; description?: string }) => ({ label: item.description || item.url || 'Video' }),
				},
				fields: [
					{ name: 'url', label: 'URL', type: 'string' },
					{ name: 'description', label: 'Description', type: 'string' },
				],
			},
			{
				name: 'pdfs',
				label: 'PDFs',
				type: 'object',
				list: true,
				ui: {
					itemProps: (item: { label?: string }) => ({ label: item.label || 'PDF' }),
				},
				fields: [
					{ name: 'file', label: 'File', type: 'image', ui: { uploadDir: () => '/images/lessons' } },
					{ name: 'label', label: 'Label', type: 'string', description: 'e.g. "Activity Sheet"' },
				],
			},
		],
	};
}
