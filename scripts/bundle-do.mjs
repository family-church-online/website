/**
 * Post-build: bundle the StreamMonitor Durable Object class and inject it as a
 * named export into dist/_worker.js so Cloudflare Workers can find it.
 *
 * Cloudflare requires DO classes to be named exports from the worker's entry
 * module. Astro's Cloudflare adapter only emits a default export, so we patch
 * the output here after every build.
 */

import { build } from 'esbuild';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const root       = resolve(__dirname, '..');
const serverDir  = resolve(root, 'dist/server');
const doSrc      = resolve(root, 'src/objects/StreamMonitor.ts');
const doOut      = resolve(serverDir, 'StreamMonitor.js');
const entryOut   = resolve(serverDir, 'worker-entry.js');

if (!existsSync(serverDir)) {
	console.error('bundle-do: dist/server/ not found — run astro build first');
	process.exit(1);
}

// Bundle the Durable Object class into dist/server/StreamMonitor.js
await build({
	entryPoints: [doSrc],
	bundle: true,
	format: 'esm',
	outfile: doOut,
	target: 'es2022',
});

// Write a custom worker entry that re-exports both the Astro server handler
// and the DO class — this becomes the `main` field in wrangler.json
writeFileSync(entryOut, [
	'export { default } from "@astrojs/cloudflare/entrypoints/server";',
	'export { StreamMonitor } from "./StreamMonitor.js";',
].join('\n') + '\n');

console.log('bundle-do: worker-entry.js written with StreamMonitor export ✓');
