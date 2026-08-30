/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />

interface CloudflareEnv {
	PCO_CLIENT_ID: string;
	PCO_CLIENT_SECRET: string;
	PCO_REDIRECT_URI: string;
	PCO_APP_TOKEN: string;
	PCO_APP_SECRET: string;
	PCO_TRACKED_LIST_IDS: string;
	SESSION_SECRET: string;
}

declare namespace App {
	interface Locals {
		user: import('./lib/auth').SessionUser | null;
		runtime: import('@astrojs/cloudflare').Runtime<CloudflareEnv>;
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
