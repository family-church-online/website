// Patches dist/server/wrangler.json after every Astro CF adapter build.
// The adapter generates a fresh config that strips several things we need:
//   - nodejs_compat_populate_process_env (for process.env Variables)
//   - keep_vars (to prevent wrangler wiping dashboard Variables on deploy)
//   - kv_namespaces (object bindings defined in wrangler.jsonc)
import { readFileSync, writeFileSync } from 'fs';

// Parse wrangler.jsonc (strip // line comments before JSON.parse)
const source = JSON.parse(
	readFileSync('wrangler.jsonc', 'utf8').replace(/\/\/[^\n]*/g, '')
);

const path = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf8'));

// Restore compatibility flags
const flags = config.compatibility_flags ?? [];
if (!flags.includes('nodejs_compat_populate_process_env')) {
	flags.push('nodejs_compat_populate_process_env');
}
config.compatibility_flags = flags;

// Prevent wrangler from wiping dashboard Variables on deploy
config.keep_vars = true;
delete config.vars;

// Copy KV namespace bindings (drop `remote` — that's a local-dev-only flag)
if (source.kv_namespaces?.length) {
	config.kv_namespaces = source.kv_namespaces.map(({ remote: _r, ...ns }) => ns);
}

writeFileSync(path, JSON.stringify(config, null, 2));
console.log('[patch-wrangler] patched dist/server/wrangler.json');
