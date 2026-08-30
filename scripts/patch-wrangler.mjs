// Adds nodejs_compat_populate_process_env to the generated dist/server/wrangler.json
// since the Astro CF adapter strips it out on every build.
import { readFileSync, writeFileSync } from 'fs';

const path = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf8'));

const flags = config.compatibility_flags ?? [];
if (!flags.includes('nodejs_compat_populate_process_env')) {
	flags.push('nodejs_compat_populate_process_env');
}
config.compatibility_flags = flags;

delete config.vars;

writeFileSync(path, JSON.stringify(config, null, 2));
console.log('[patch-wrangler] patched dist/server/wrangler.json');
