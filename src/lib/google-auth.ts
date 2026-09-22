/**
 * Google Service Account JWT auth using Web Crypto (works in CF Workers).
 * GOOGLE_SERVICE_ACCOUNT env var must be the full JSON credentials as a string.
 */

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
}

function b64url(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let str = '';
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function signRS256(payload: string, privateKeyPem: string): Promise<string> {
	const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).buffer as ArrayBuffer);
	const body   = b64url(new TextEncoder().encode(payload).buffer as ArrayBuffer);
	const signingInput = `${header}.${body}`;

	// Strip PEM armor and decode
	const pemContents = privateKeyPem
		.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
	const keyBytes = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

	const cryptoKey = await crypto.subtle.importKey(
		'pkcs8',
		keyBytes.buffer as ArrayBuffer,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign'],
	);

	const sig = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		cryptoKey,
		new TextEncoder().encode(signingInput).buffer as ArrayBuffer,
	);

	return `${signingInput}.${b64url(sig)}`;
}

export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
	const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
	if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT not set');

	const sa = JSON.parse(saJson) as ServiceAccountKey;
	const now = Math.floor(Date.now() / 1000);

	const claimSet = JSON.stringify({
		iss: sa.client_email,
		scope: scopes.join(' '),
		aud: 'https://oauth2.googleapis.com/token',
		iat: now,
		exp: now + 3600,
	});

	const jwt = await signRS256(claimSet, sa.private_key);

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Google token exchange failed: ${res.status} — ${text}`);
	}

	const data = (await res.json()) as { access_token: string };
	return data.access_token;
}
