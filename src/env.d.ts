/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />

interface CloudflareEnv {
	LESSON_PROGRESS: KVNamespace;
	STREAM_REPORTS: KVNamespace;
	STREAM_MONITOR: DurableObjectNamespace;
	SERMON_JOBS: KVNamespace;
	SERMON_AUDIO: R2Bucket;
	SERMON_PUBLISH_WORKFLOW: Workflow;
}

declare namespace App {
	interface Locals {
		user: import('./lib/auth').SessionUser | null;
	}
}
