import type { Collection } from 'tinacms';

export function courseLessonCollection(opts: {
	name: string;
	label: string;
	courseSlug: string;
	chapterSlug: string;
}): Collection {
	return {
		name: opts.name,
		label: opts.label,
		path: `src/content/courses/${opts.courseSlug}/${opts.chapterSlug}`,
		format: 'mdx',
		ui: {
			filename: {
				slugify: (values) =>
					values.lesson
						? values.lesson.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
						: 'untitled',
			},
		},
		fields: [
			{ name: 'course',          label: 'Course',           type: 'string' },
			{ name: 'chapter',         label: 'Chapter',          type: 'string' },
			{ name: 'lesson',          label: 'Lesson Title',     type: 'string', isTitle: true, required: true },
			{ name: 'statementNumber', label: 'Statement Number', type: 'number' },
			{ name: 'pointNumber',     label: 'Point Number',     type: 'number' },
			{ name: 'statement',       label: 'Statement',        type: 'string', ui: { component: 'textarea' } },
			{ name: 'point',           label: 'Point Summary',    type: 'string', ui: { component: 'textarea' } },
			{
				name: 'sections',
				label: 'Sections',
				type: 'object',
				list: true,
				ui: {
					itemProps: (item: { heading?: string; id?: string }) => ({
						label: item.heading ?? item.id ?? 'Section',
					}),
				},
				fields: [
					{ name: 'id',      label: 'ID',      type: 'string' },
					{ name: 'heading', label: 'Heading', type: 'string' },
					{
						name: 'scriptures',
						label: 'Scriptures',
						type: 'object',
						list: true,
						ui: {
							itemProps: (item: { ref?: string }) => ({ label: item.ref ?? 'Scripture' }),
						},
						fields: [
							{ name: 'ref',  label: 'Reference', type: 'string' },
							{ name: 'text', label: 'Text',      type: 'string', ui: { component: 'textarea' } },
						],
					},
					{ name: 'commentary', label: 'Commentary', type: 'string', ui: { component: 'textarea' } },
					{
						name: 'questions',
						label: 'Questions',
						type: 'object',
						list: true,
						ui: {
							itemProps: (item: { type?: string }) => ({ label: item.type ?? 'Question' }),
						},
						fields: [
							{
								name: 'type',
								label: 'Question Type',
								type: 'string',
								options: ['Comprehension', 'Faith and Life'],
							},
							{ name: 'question', label: 'Question', type: 'string', ui: { component: 'textarea' } },
							{
								name: 'options',
								label: 'Options',
								type: 'object',
								list: true,
								ui: {
									itemProps: (item: { label?: string }) => ({ label: item.label ?? 'Option' }),
								},
								fields: [
									{ name: 'label', label: 'Label (a/b/c/d)', type: 'string' },
									{ name: 'text',  label: 'Text',            type: 'string', ui: { component: 'textarea' } },
								],
							},
							{ name: 'answer', label: 'Correct Answer (a/b/c/d)', type: 'string' },
						],
					},
				],
			},
			{
				name: 'takeaways',
				label: 'Key Takeaways',
				type: 'string',
				list: true,
			},
		],
	};
}
