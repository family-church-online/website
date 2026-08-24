import type { Template } from 'tinacms';

export const heroBlockSchema: Template = {
	name: 'hero',
	label: 'Hero',
	fields: [
		{
			type: 'image',
			label: 'Background Photo',
			name: 'backgroundImage',
		},
		{
			type: 'object',
			label: 'Logo',
			name: 'logo',
			fields: [
				{ name: 'src', label: 'Image', type: 'image' },
				{ name: 'alt', label: 'Alt Text', type: 'string' },
			],
		},
		{
			type: 'string',
			label: 'Tagline',
			name: 'tagline',
			ui: { component: 'textarea' },
		},
		{
			type: 'object',
			label: 'Buttons',
			name: 'actions',
			list: true,
			ui: {
				defaultItem: { label: 'Plan a Visit', style: 'primary', link: '/' },
				itemProps: (i: { label?: string }) => ({ label: i.label ?? '' }),
			},
			fields: [
				{ type: 'string', label: 'Label', name: 'label' },
				{ type: 'string', label: 'Link', name: 'link' },
				{
					type: 'string',
					label: 'Style',
					name: 'style',
					options: [
						{ label: 'Primary (green)', value: 'primary' },
						{ label: 'Ghost (outlined)', value: 'ghost' },
					],
				},
			],
		},
	],
	ui: {
		defaultItem: {
			tagline: 'A community walking together — in faith, in family, in everyday life.',
			actions: [
				{ label: 'Plan a Visit', style: 'primary', link: '#' },
				{ label: 'Watch a Sermon', style: 'ghost', link: '#' },
			],
		},
	},
};
