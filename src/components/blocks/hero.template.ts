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
			type: 'string',
			label: 'Service Time & Location',
			name: 'serviceInfo',
			description: 'e.g. "Sundays 09:30 · Dainfern College, Johannesburg"',
		},
		{
			type: 'string',
			label: 'Eyebrow / Mission Text',
			name: 'eyebrow',
			description: 'Small text below the service info, e.g. "love, worship, honour & obey"',
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
			serviceInfo: 'Sundays 09:30 · Dainfern College, Johannesburg',
			eyebrow: 'love, worship, honour & obey',
			actions: [
				{ label: 'Plan a Visit', style: 'primary', link: '#' },
				{ label: 'Watch a Sermon', style: 'ghost', link: '#' },
			],
		},
	},
};
