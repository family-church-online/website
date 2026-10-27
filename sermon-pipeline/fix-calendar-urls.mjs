#!/usr/bin/env node
// One-shot script: fix broken sermon URLs in the Oct 2026 devotion calendar events.
// The pipeline incorrectly built URLs as /sermons/{date}-{slug}; correct form is /sermons/{slug}.
// Run: node sermon-pipeline/fix-calendar-urls.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const PIPELINE_DIR = dirname(fileURLToPath(import.meta.url));

const DEVOTIONS_CAL_ID = 'kalsva0235makn1pq3d52sko1k@group.calendar.google.com';

const CREDENTIALS_FILE = existsSync(join(PIPELINE_DIR, 'oauth_credentials.json'))
  ? join(PIPELINE_DIR, 'oauth_credentials.json')
  : join(process.env.HOME || '', '.config/sermon-pipeline/oauth_credentials.json');
const TOKEN_FILE = existsSync(join(PIPELINE_DIR, 'oauth_token.json'))
  ? join(PIPELINE_DIR, 'oauth_token.json')
  : join(process.env.HOME || '', '.config/sermon-pipeline/oauth_token.json');

if (!existsSync(CREDENTIALS_FILE)) { console.error('oauth_credentials.json not found'); process.exit(1); }
if (!existsSync(TOKEN_FILE))       { console.error('oauth_token.json not found — run the pipeline first to authenticate'); process.exit(1); }

const creds = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'));
const { client_id, client_secret } = creds.installed;
const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost');
const token = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
oauth2.setCredentials(token);
oauth2.on('tokens', t => {
  const existing = existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) : {};
  writeFileSync(TOKEN_FILE, JSON.stringify({ ...existing, ...t }, null, 2));
});

const calendar = google.calendar({ version: 'v3', auth: oauth2 });

// Search events in the week of Oct 7–13 2026
const timeMin = '2026-10-05T00:00:00Z';
const timeMax = '2026-10-12T00:00:00Z';

const res = await calendar.events.list({
  calendarId: DEVOTIONS_CAL_ID,
  timeMin,
  timeMax,
  singleEvents: true,
  maxResults: 20,
});

const events = res.data.items ?? [];
console.log(`Found ${events.length} event(s) in range ${timeMin.slice(0, 10)} → ${timeMax.slice(0, 10)}`);

// Regex: match /sermons/YYYY-MM-DD-{slug} and capture just the slug part
const BAD_URL = /https?:\/\/familychurch\.online\/sermons\/\d{4}-\d{2}-\d{2}-([^"'\s<]+)/g;

let fixed = 0;
for (const event of events) {
  const desc = event.description ?? '';
  if (!BAD_URL.test(desc)) continue;
  BAD_URL.lastIndex = 0;

  const newDesc = desc.replace(BAD_URL, (_, slug) => `https://familychurch.online/sermons/${slug}`);
  console.log(`  Patching: "${event.summary}" (${event.start?.date})`);

  await calendar.events.patch({
    calendarId: DEVOTIONS_CAL_ID,
    eventId: event.id,
    requestBody: { description: newDesc },
  });
  fixed++;
}

console.log(`\nDone — patched ${fixed} event(s).`);
