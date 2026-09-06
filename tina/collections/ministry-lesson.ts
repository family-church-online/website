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
				name: 'mainScriptureText',
				label: 'Main Scripture Text',
				type: 'string',
				ui: { component: 'textarea' },
				description: 'The full text of the key scripture passage',
			},
			{
				name: 'additionalScriptures',
				label: 'Additional Scriptures',
				type: 'string',
				list: true,
			},
			{
				name: 'summary',
				label: 'Summary',
				type: 'string',
				ui: { component: 'textarea' },
			},
			{
				name: 'about',
				label: 'About',
				type: 'string',
				ui: { component: 'textarea' },
			},
			{
				name: 'takeaway',
				label: 'Takeaway',
				type: 'string',
				list: true,
			},
			{
				name: 'forYou',
				label: 'For You',
				type: 'string',
				list: true,
			},
			{
				name: 'keyScripture',
				label: 'Key Scripture (Notes)',
				type: 'string',
				ui: { component: 'textarea' },
				description: 'Full scripture text shown in the Notes tab',
			},
			{
				name: 'bigIdea',
				label: 'Big Idea',
				type: 'string',
				ui: { component: 'textarea' },
			},
			{
				name: 'mainPoints',
				label: 'Main Points',
				type: 'object',
				list: true,
				ui: {
					itemProps: (item: { heading?: string }) => ({ label: item.heading || 'Point' }),
				},
				fields: [
					{ name: 'heading', label: 'Heading', type: 'string' },
					{ name: 'text', label: 'Text', type: 'string', ui: { component: 'textarea' } },
				],
			},
			{
				name: 'keyIllustration',
				label: 'Key Illustration',
				type: 'string',
				ui: { component: 'textarea' },
			},
			{
				name: 'meansForUs',
				label: 'Means for Us',
				type: 'string',
				list: true,
			},
			{
				name: 'remember',
				label: 'Remember',
				type: 'string',
				ui: { component: 'textarea' },
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
					{ name: 'description', label: 'Description', type: 'string', ui: { component: 'textarea' } },
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
