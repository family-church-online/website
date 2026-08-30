export interface SessionPayload {
	sub: string;      // Planning Center person ID
	name: string;
	email: string;
	lists: string[];  // PC list IDs this person is a member of
	exp: number;      // Unix timestamp (seconds)
}

const COOKIE_NAME = '__fc_session';
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days in seconds
const ALG = { name: 'HMAC', hash: 'SHA-256' };

function b64url(buf: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(buf)))
		.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function importKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALG, false, ['sign', 'verify']);
}

export async function createSession(payload: Omit<SessionPayload, 'exp'>, secret: string): Promise<string> {
	const data = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_DURATION }));
	const key = await importKey(secret);
	const sig = b64url(await crypto.subtle.sign(ALG, key, new TextEncoder().encode(data)));
	return `${data}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
	const dot = token.lastIndexOf('.');
	if (dot === -1) return null;
	const data = token.slice(0, dot);
	const sig = token.slice(dot + 1);

	const key = await importKey(secret);
	// Reconstruct the signature for constant-time comparison
	const expected = b64url(await crypto.subtle.sign(ALG, key, new TextEncoder().encode(data)));
	if (sig !== expected) return null;

	try {
		const payload: SessionPayload = JSON.parse(atob(data));
		if (payload.exp < Math.floor(Date.now() / 1000)) return null;
		return payload;
	} catch {
		return null;
	}
}

export function sessionCookie(value: string, maxAge = SESSION_DURATION): string {
	return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
	return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function getSessionToken(request: Request): string | null {
	const cookie = request.headers.get('Cookie') ?? '';
	for (const part of cookie.split(';')) {
		const [k, ...v] = part.trim().split('=');
		if (k === COOKIE_NAME) return v.join('=');
	}
	return null;
}
