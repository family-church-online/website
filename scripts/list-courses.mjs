#!/usr/bin/env node
/**
 * List all defined courses and their chapters from the TinaCMS registry.
 * Usage: pnpm lesson:list-courses
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const coursesDir = join(ROOT, 'src', 'content', 'courses');

const files = readdirSync(coursesDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.log('No courses defined yet. Create one in TinaCMS (admin → Courses).');
  process.exit(0);
}

for (const file of files) {
  const slug = file.replace('.json', '');
  const data = JSON.parse(readFileSync(join(coursesDir, file), 'utf8'));
  console.log(`\n${data.title}  (--course ${slug})`);
  if (data.description) console.log(`  ${data.description}`);
  for (const ch of data.chapters ?? []) {
    console.log(`  └ ${ch.title}  (--chapter ${ch.slug})`);
  }
}
console.log('');
