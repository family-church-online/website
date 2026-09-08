/**
 * Post-build: bundle the StreamMonitor Durable Object class and inject it as a
 * named export into dist/_worker.js so Cloudflare Workers can find it.
 *
 * Cloudflare requires DO classes to be named exports from the worker's entry
 * module. Astro's Cloudflare adapter only emits a default export, so we patch
 * the output here after every build.
 */

import { build } from 'esbuild';
import { appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');
const workerJs  = resolve(root, 'dist/server/_worker.js');
const doSrc     = resolve(root, 'src/objects/StreamMonitor.ts');
const doOut     = resolve(root, 'dist/server/StreamMonitor.js');

if (!existsSync(workerJs)) {
	console.error('bundle-do: dist/_worker.js not found — run astro build first');
	process.exit(1);
}

await build({
	entryPoints: [doSrc],
	bundle: true,
	format: 'esm',
	outfile: doOut,
	target: 'es2022',
});

appendFileSync(workerJs, '\nexport { StreamMonitor } from "./StreamMonitor.js";\n');
console.log('bundle-do: StreamMonitor exported from dist/_worker.js ✓');
