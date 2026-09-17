import type { Template } from 'tinacms';

export const pageHeaderBlockSchema: Template = {
	name: 'pageHeader',
	label: 'Page Header',
	fields: [
		{ type: 'string', label: 'Label (small eyebrow)', name: 'label' },
		{ type: 'string', label: 'Heading', name: 'heading' },
		{ type: 'string', label: 'Subtitle (centered, under heading)', name: 'subtitle', ui: { component: 'textarea' } },
		{
			type: 'string', label: 'Background', name: 'background',
			options: [
				{ label: 'Default (white)', value: 'default' },
				{ label: 'Navy', value: 'navy' },
				{ label: 'Accent (green border)', value: 'accent' },
			],
		},
		{
			type: 'object', label: 'Links', name: 'links', list: true,
			ui: { itemProps: (i: { label?: string }) => ({ label: i.label ?? 'Link' }) },
			fields: [
				{ name: 'label', label: 'Label', type: 'string' },
				{ name: 'href',  label: 'URL',   type: 'string' },
				{
					name: 'style', label: 'Style', type: 'string',
					options: [
						{ label: 'Ghost (outlined)', value: 'ghost' },
						{ label: 'Primary (green)', value: 'primary' },
					],
				},
			],
		},
		{ type: 'rich-text', label: 'Body', name: 'body' },
	],
	ui: {
		defaultItem: {
			label: 'About',
			heading: 'Who we are',
			intro: 'Add an intro paragraph here.',
		},
	},
};
