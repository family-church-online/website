/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />

interface CloudflareEnv {}

declare namespace App {
	interface Locals {
		user: import('./lib/auth').SessionUser | null;
	}
}
