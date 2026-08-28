import type { Collection } from 'tinacms';

export const StatementOfFaithCollection: Collection = {
	name: 'statementOfFaith',
	label: 'Statement of Faith',
	path: 'src/content/statement-of-faith',
	format: 'json',
	ui: {
		allowedActions: { create: false, delete: false },
	},
	fields: [
		{
			name: 'articles',
			label: 'Articles',
			type: 'object',
			list: true,
			ui: {
				itemProps: (item) => ({ label: `${item.number ?? '?'}. ${item.title ?? 'Untitled'}` }),
			},
			fields: [
				{
					name: 'number',
					label: 'Number',
					type: 'number',
				},
				{
					name: 'title',
					label: 'Title',
					type: 'string',
					required: true,
				},
				{
					name: 'summary',
					label: 'Summary',
					description: 'Short statement always visible in the collapsed accordion.',
					type: 'string',
					ui: { component: 'textarea' },
				},
				{
					name: 'statement',
					label: 'Full Statement',
					description: 'The numbered clauses shown when the article is expanded.',
					type: 'string',
					ui: { component: 'textarea' },
				},
				{
					name: 'scriptures',
					label: 'Scripture References',
					description: 'One group of references per numbered line.',
					type: 'string',
					list: true,
				},
			],
		},
	],
};
