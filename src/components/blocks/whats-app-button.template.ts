import type { Template } from 'tinacms';

export const whatsAppButtonBlockSchema: Template = {
	name: 'whatsAppButton',
	label: 'WhatsApp Button',
	fields: [
		{
			name: 'message',
			label: 'Pre-filled Message',
			type: 'string',
			description: 'The message pre-filled in WhatsApp when a visitor taps the button.',
			ui: { defaultValue: 'Hi! I have a question about Family Church.' },
		},
	],
	ui: {
		defaultItem: {
			message: 'Hi! I have a question about Family Church.',
		},
	},
};
