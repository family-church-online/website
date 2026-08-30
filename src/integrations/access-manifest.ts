/**
 * Astro integration that generates functions/_access-manifest.json at build time.
 *
 * The manifest maps URL path prefixes to Planning Center list IDs, sourced from
 * the optional `requiredListId` field on course and guide TinaCMS records.
 * The Pages Function middleware imports this file at module level so access checks
 * have zero per-request latency.
 *
 * To lock a section: set `requiredListId` in TinaCMS on the course or guide,
 * commit, and redeploy. To unlock: clear the field.
 */

import type { AstroIntegration } from 'astro';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Extracts frontmatter value from raw MDX text without a full parse. */
function extractFrontmatterField(content: string, field: string): string | undefined {
	const match = content.match(new RegExp(`^${field}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm'));
	return match?.[1]?.trim() || undefined;
}

export function accessManifest(): AstroIntegration {
	return {
		name: 'access-manifest',
		hooks: {
			'astro:build:done': () => {
				const root = process.cwd();
				const manifest: Record<string, string> = {};

				// --- Courses (JSON files) ---
				const coursesDir = join(root, 'src/content/courses');
				try {
					for (const file of readdirSync(coursesDir)) {
						if (!file.endsWith('.json')) continue;
						const slug = file.replace(/\.json$/, '');
						const data = JSON.parse(readFileSync(join(coursesDir, file), 'utf-8'));
						if (data.requiredListId && typeof data.requiredListId === 'string' && data.requiredListId.trim()) {
							manifest[`/courses/${slug}`] = data.requiredListId.trim();
						}
					}
				} catch {
					// courses dir may not exist yet
				}

				// --- Guides (MDX files) ---
				const guidesDir = join(root, 'src/content/guides');
				try {
					for (const file of readdirSync(guidesDir)) {
						if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
						// filename is YYYY-MM-DD-slug.mdx; slug = everything after the date prefix
						const slugMatch = file.match(/^\d{4}-\d{2}-\d{2}-(.+)\.(mdx?|md)$/);
						if (!slugMatch) continue;
						const slug = slugMatch[1];
						const content = readFileSync(join(guidesDir, file), 'utf-8');
						const listId = extractFrontmatterField(content, 'requiredListId');
						if (listId) {
							manifest[`/guides/${slug}`] = listId;
						}
					}
				} catch {
					// guides dir may not exist yet
				}

				// Write manifest into functions/ so Pages Functions can import it
				const functionsDir = join(root, 'functions');
				mkdirSync(functionsDir, { recursive: true });
				writeFileSync(
					join(functionsDir, '_access-manifest.json'),
					JSON.stringify(manifest, null, 2),
				);

				const count = Object.keys(manifest).length;
				console.log(`[access-manifest] wrote ${count} protected route${count !== 1 ? 's' : ''} to functions/_access-manifest.json`);
			},
		},
	};
}
