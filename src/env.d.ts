/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		user: import('./lib/auth').SessionUser | null;
	}
}

interface ImportMetaEnv {
	readonly PCO_CLIENT_ID: string;
	readonly PCO_CLIENT_SECRET: string;
	readonly PCO_REDIRECT_URI: string;
	readonly PCO_APP_TOKEN: string;
	readonly PCO_APP_SECRET: string;
	readonly PCO_TRACKED_LIST_IDS: string;
	readonly SESSION_SECRET: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
