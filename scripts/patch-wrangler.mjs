// Patches dist/server/wrangler.json after each build:
// 1. Adds nodejs_compat_populate_process_env so process.env is populated at runtime
// 2. Declares auth var keys as empty strings so dashboard Variables are not wiped on deploy
import { readFileSync, writeFileSync } from 'fs';

const path = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf8'));

const flags = config.compatibility_flags ?? [];
if (!flags.includes('nodejs_compat_populate_process_env')) {
	flags.push('nodejs_compat_populate_process_env');
}
config.compatibility_flags = flags;

config.vars = {
	SESSION_SECRET: '',
	PCO_CLIENT_ID: '',
	PCO_REDIRECT_URI: '',
	PCO_CLIENT_SECRET: '',
	PCO_APP_TOKEN: '',
	PCO_APP_SECRET: '',
	PCO_TRACKED_LIST_IDS: '',
};

writeFileSync(path, JSON.stringify(config, null, 2));
console.log('[patch-wrangler] patched dist/server/wrangler.json');
