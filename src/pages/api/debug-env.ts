import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';

export const prerender = false;

export const GET: APIRoute = async () => {
	let cfEnvKeys: string[] = [];
	let cfEnvError = '';
	let getSecretResult = '';
	let processEnvKeys: string[] = [];

	try {
		const cf = await import('cloudflare:workers');
		cfEnvKeys = Object.keys(cf.env as object);
	} catch (e) {
		cfEnvError = String(e);
	}

	try {
		const v = getSecret('PCO_CLIENT_ID');
		getSecretResult = v ? `SET (${v.slice(0, 4)}...)` : 'undefined';
	} catch (e) {
		getSecretResult = `THREW: ${e}`;
	}

	try {
		processEnvKeys = Object.keys(process.env).filter(k =>
			k.startsWith('PCO') || k.startsWith('SESSION') || k.startsWith('TINA')
		);
	} catch {}

	return new Response(JSON.stringify({
		cfEnvKeys,
		cfEnvError,
		getSecretResult,
		processEnvKeys,
	}, null, 2), {
		headers: { 'Content-Type': 'application/json' },
	});
};
