/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />

interface CloudflareEnv {
	LESSON_PROGRESS: KVNamespace;
}

declare namespace App {
	interface Locals {
		user: import('./lib/auth').SessionUser | null;
	}
}
