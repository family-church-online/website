/**
 * Post-build: bundle the StreamMonitor Durable Object class into dist/server/,
 * then write a worker-entry.js that re-exports both the Astro server handler
 * and the DO class as named exports.
 *
 * Cloudflare requires DO classes to be named exports from the worker's entry
 * module. The Cloudflare Vite plugin builds the worker with no_bundle: true
 * and sets main to the actual Vite output file (e.g. "index.js"). We create
 * a thin wrapper that re-exports from that file + adds the StreamMonitor
 * export, then update wrangler.json's main to point at the wrapper.
 */

import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const root         = resolve(__dirname, '..');
const serverDir    = resolve(root, 'dist/server');
const wranglerPath = resolve(serverDir, 'wrangler.json');
const doSrc        = resolve(root, 'src/objects/StreamMonitor.ts');
const doOut        = resolve(serverDir, 'StreamMonitor.js');
const entryOut     = resolve(serverDir, 'worker-entry.js');

if (!existsSync(serverDir)) {
	console.error('bundle-do: dist/server/ not found — run astro build first');
	process.exit(1);
}

// Read the generated wrangler.json to find the Vite-bundled server entry.
// patch-wrangler.mjs has already run but leaves main unchanged, so this
// still holds the original filename (e.g. "index.js") from the Vite build.
const wranglerConfig = JSON.parse(readFileSync(wranglerPath, 'utf8'));
const originalMain = wranglerConfig.main;
if (!originalMain || originalMain === './worker-entry.js') {
	console.error(`bundle-do: unexpected main "${originalMain}" in wrangler.json`);
	process.exit(1);
}
const mainImport = originalMain.startsWith('./') ? originalMain : `./${originalMain}`;

// Bundle the Durable Object class into dist/server/StreamMonitor.js
await build({
	entryPoints: [doSrc],
	bundle: true,
	format: 'esm',
	outfile: doOut,
	target: 'es2022',
});

// Write a wrapper entry that re-exports the Astro handler (from the real
// pre-bundled file) and adds the StreamMonitor named export. With
// no_bundle: true the CF Workers runtime resolves these as ESModule imports
// within the uploaded file set — no npm resolution happens at deploy time.
writeFileSync(entryOut, [
	`export { default } from "${mainImport}";`,
	'export { StreamMonitor } from "./StreamMonitor.js";',
].join('\n') + '\n');

// Update wrangler.json to use the wrapper as the entry point
wranglerConfig.main = './worker-entry.js';
writeFileSync(wranglerPath, JSON.stringify(wranglerConfig, null, 2));

console.log(`bundle-do: worker-entry.js wraps "${originalMain}" + StreamMonitor ✓`);
