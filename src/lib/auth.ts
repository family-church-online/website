import type { AstroGlobal } from 'astro';
import { getSecret } from 'astro:env/server';

// In CF Workers production: nodejs_compat_populate_process_env fills process.env
// with all worker secrets/bindings before any module runs.
// In Vite dev: process.env may not have vars, so getSecret() reads from .env.
function secret(key: string): string {
	const v = process.env[key] ?? getSecret(key);
	if (!v) throw new Error(`Missing required env var: ${key}`);
	return v;
}

export interface SessionUser {
	sub: string;
	name: string;
	email: string;
	lists: string[];
	exp: number;
}

// ── Base64url helpers ────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let str = '';
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str: string): string {
	const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
	const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
	return atob(padded);
}

function b64urlToBytes(str: string): Uint8Array {
	const bin = b64urlDecode(str);
	const buf = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
	return buf;
}

// ── HMAC-SHA256 session signing (Web Crypto — works in Cloudflare Workers) ──

async function hmacKey(s: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(s),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify'],
	);
}

export async function createSession(user: SessionUser): Promise<string> {
	const payload = btoa(JSON.stringify(user));
	const key = await hmacKey(secret('SESSION_SECRET'));
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
	return `${payload}.${b64url(sig)}`;
}

export async function readSession(token: string): Promise<SessionUser | null> {
	const dot = token.lastIndexOf('.');
	if (dot === -1) return null;
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	try {
		const key = await hmacKey(secret('SESSION_SECRET'));
		const valid = await crypto.subtle.verify(
			'HMAC',
			key,
			b64urlToBytes(sig).buffer as ArrayBuffer,
			new TextEncoder().encode(payload),
		);
		if (!valid) return null;
		const user: SessionUser = JSON.parse(atob(payload));
		if (user.exp < Date.now()) return null;
		return user;
	} catch {
		return null;
	}
}

// ── PCO People API — look up a person by email address ───────────────────────

export async function lookupPersonByEmail(
	email: string,
): Promise<{ pcoId: string; name: string } | null> {
	const auth = btoa(`${secret('PCO_APP_TOKEN')}:${secret('PCO_APP_SECRET')}`);
	const res = await fetch(
		`https://api.planningcenteronline.com/people/v2/emails?where[address]=${encodeURIComponent(email)}&include=person&per_page=1`,
		{ headers: { Authorization: `Basic ${auth}` } },
	);
	if (!res.ok) return null;
	const json = (await res.json()) as {
		data: Array<{ relationships: { person: { data: { id: string } } } }>;
		included: Array<{ id: string; attributes: { name: string } }>;
	};
	if (json.data.length === 0) return null;
	const pcoId = json.data[0].relationships.person.data.id;
	const person = json.included.find((r) => r.id === pcoId);
	return { pcoId, name: person?.attributes.name ?? email };
}

// ── Magic link email via Resend ───────────────────────────────────────────────

export interface MagicLinkEmailConfig {
	subject?: string | null;
	intro?: string | null;
	linkText?: string | null;
	footer?: string | null;
}

export async function sendMagicLink(to: string, verifyUrl: string, emailConfig?: MagicLinkEmailConfig): Promise<void> {
	const from = 'Family Church <noreply@familychurch.online>';
	const subject = emailConfig?.subject ?? 'Your sign-in link for Family Church';
	const intro = emailConfig?.intro ?? 'Click the link below to sign in. It expires in 10 minutes.';
	const linkText = emailConfig?.linkText ?? 'Sign in to Family Church';
	const footer = emailConfig?.footer ?? "If you didn't request this, you can ignore this email.";

	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${secret('RESEND_API_KEY')}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			from,
			to,
			subject,
			html: `
				<p>${intro}</p>
				<p><a href="${verifyUrl}" style="font-size:16px;font-weight:bold">${linkText}</a></p>
				<p style="color:#666;font-size:13px">${footer}</p>
			`,
			text: `${linkText}:\n\n${verifyUrl}\n\nThis link expires in 10 minutes. ${footer}`,
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Resend failed: ${res.status} — ${body}`);
	}
}

// ── PCO list membership (server-side PAT check) ───────────────────────────────

export async function fetchListMemberships(
	pcoId: string,
	trackedIds: string[],
): Promise<string[]> {
	if (trackedIds.length === 0) return [];
	const auth = btoa(`${secret('PCO_APP_TOKEN')}:${secret('PCO_APP_SECRET')}`);
	const results = await Promise.all(
		trackedIds.map(async (id) => {
			const res = await fetch(
				`https://api.planningcenteronline.com/people/v2/lists/${id}/people?where[id]=${pcoId}&per_page=1`,
				{ headers: { Authorization: `Basic ${auth}` } },
			);
			if (!res.ok) return null;
			const json = (await res.json()) as { data: unknown[] };
			return json.data.length > 0 ? id : null;
		}),
	);
	return results.filter((id): id is string => id !== null);
}

export function getTrackedListIds(): string[] {
	return ((process.env['PCO_TRACKED_LIST_IDS'] ?? getSecret('PCO_TRACKED_LIST_IDS')) ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

// ── Page helpers ──────────────────────────────────────────────────────────────

export function requireAuth(
	astro: AstroGlobal,
	listId?: string | string[],
): SessionUser | Response {
	const user = astro.locals.user;
	if (!user) {
		const ret = encodeURIComponent(astro.url.pathname + astro.url.search);
		return astro.redirect(`/login?redirect=${ret}`);
	}
	if (listId) {
		const required = Array.isArray(listId) ? listId : [listId];
		if (!required.some((id) => user.lists.includes(id))) {
			return astro.redirect('/auth/denied');
		}
	}
	return user;
}

export function getUser(astro: AstroGlobal): SessionUser | null {
	return astro.locals.user ?? null;
}
