import type { Template } from 'tinacms';

export const teamBlockSchema: Template = {
	name: 'team',
	label: 'Team / People',
	fields: [
		{ type: 'string', label: 'Heading', name: 'title' },
		{ type: 'string', label: 'Description', name: 'description', ui: { component: 'textarea' } },
		{
			type: 'object', label: 'Members', name: 'members', list: true,
			ui: {
				itemProps: (item: { name?: string }) => ({ label: item.name ?? 'Person' }),
				defaultItem: { name: 'Name', role: 'Elder', bio: '', photo: '' },
			},
			fields: [
				{ type: 'image', label: 'Photo', name: 'photo' },
				{ type: 'string', label: 'Name', name: 'name' },
				{ type: 'string', label: 'Role / Title', name: 'role' },
				{ type: 'string', label: 'Short Bio', name: 'bio', ui: { component: 'textarea' } },
			],
		},
	],
	ui: {
		defaultItem: {
			title: 'Our People',
			description: 'Meet the team serving Family Church.',
			members: [],
		},
	},
};
