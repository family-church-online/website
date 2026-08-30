/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />

// Typed Cloudflare env bindings — used by @astrojs/cloudflare to type
// `locals.runtime.env` (deprecated in Astro v6) and `cloudflare:workers`.
// Auth variables are now declared in astro.config.mjs env.schema instead.
interface CloudflareEnv {}

declare namespace App {
	interface Locals {
		user: import('./lib/auth').SessionUser | null;
	}
}
