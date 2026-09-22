/**
 * Post-build: bundle Durable Object and Workflow classes into dist/server/,
 * then write a worker-entry.js that re-exports the Astro server handler
 * plus all named DO/Workflow exports.
 *
 * Cloudflare requires DO and Workflow classes to be named exports from the
 * worker's entry module. The Cloudflare Vite plugin builds the worker with
 * no_bundle: true and sets main to the actual Vite output file (e.g. "index.js").
 * We create a thin wrapper that re-exports from that file + adds the class
 * exports, then update wrangler.json's main to point at the wrapper.
 */

import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const root         = resolve(__dirname, '..');
const serverDir    = resolve(root, 'dist/server');
const wranglerPath = resolve(serverDir, 'wrangler.json');
const entryOut     = resolve(serverDir, 'worker-entry.js');

if (!existsSync(serverDir)) {
	console.error('bundle-do: dist/server/ not found — run astro build first');
	process.exit(1);
}

// Read the generated wrangler.json to find the Vite-bundled server entry.
const wranglerConfig = JSON.parse(readFileSync(wranglerPath, 'utf8'));
const originalMain = wranglerConfig.main;
if (!originalMain || originalMain === './worker-entry.js') {
	console.error(`bundle-do: unexpected main "${originalMain}" in wrangler.json`);
	process.exit(1);
}
const mainImport = originalMain.startsWith('./') ? originalMain : `./${originalMain}`;

const classes = [
	{ src: resolve(root, 'src/objects/StreamMonitor.ts'),         out: resolve(serverDir, 'StreamMonitor.js'),         name: 'StreamMonitor' },
	{ src: resolve(root, 'src/objects/SermonPublishWorkflow.ts'), out: resolve(serverDir, 'SermonPublishWorkflow.js'), name: 'SermonPublishWorkflow' },
];

// Bundle each class
for (const cls of classes) {
	await build({
		entryPoints: [cls.src],
		bundle: true,
		format: 'esm',
		outfile: cls.out,
		target: 'es2022',
	});
}

// Write worker-entry.js
const exports = [
	`export { default } from "${mainImport}";`,
	...classes.map(cls => `export { ${cls.name} } from "./${cls.name}.js";`),
].join('\n');

writeFileSync(entryOut, exports + '\n');

// Update wrangler.json to use the wrapper as the entry point
wranglerConfig.main = './worker-entry.js';
writeFileSync(wranglerPath, JSON.stringify(wranglerConfig, null, 2));

const names = classes.map(c => c.name).join(', ');
console.log(`bundle-do: worker-entry.js wraps "${originalMain}" + ${names} ✓`);
