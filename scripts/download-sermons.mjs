/**
 * Mirror the three sermon Drive folders to local cache under scripts/drive/.
 *
 * Usage:
 *   node scripts/download-sermons.mjs            download everything missing
 *   node scripts/download-sermons.mjs --force    re-download all files
 *   node scripts/download-sermons.mjs --check    show Drive vs local status only
 *
 * Auth: reuses scripts/.google-credentials.json and scripts/.google-token.json
 * (same as import-sermons.mjs — run that with --auth first if needed).
 *
 * Output folders:
 *   scripts/drive/comp-tax/       *.json
 *   scripts/drive/enriched/       *.md
 *   scripts/drive/sermon-blocks/  *.html
 */

import { google }                                        from 'googleapis';
import { readFileSync, writeFileSync, existsSync,
         mkdirSync, readdirSync }                        from 'fs';
import { join, dirname }                                 from 'path';
import { fileURLToPath }                                 from 'url';
import { createServer }                                  from 'http';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CREDS_FILE = join(__dirname, '.google-credentials.json');
const TOKEN_FILE = join(__dirname, '.google-token.json');
const CACHE_DIR  = join(__dirname, 'drive');
const AUTH_PORT  = 3333;
const SCOPES     = ['https://www.googleapis.com/auth/drive.readonly'];

const FOLDERS = {
  compTax:      { id: '19f02nUtBL9xNQaTsECgKvEWkcyefgixy', dir: 'comp-tax' },
  enriched:     { id: '1w2ADe6xQ-_0Hz2KvAHbmMTSK_7WNkALO', dir: 'enriched' },
  sermonBlocks: { id: '1rmr23NQsNHYFstSSW2cyB2U2XMBOt39l', dir: 'sermon-blocks' },
};

// ─── Colour helpers ───────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const tick  = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;
const skip  = `${c.dim}–${c.reset}`;

// ─── Auth (identical to import-sermons.mjs) ───────────────────────────────────

async function getAuth() {
  if (!existsSync(CREDS_FILE)) {
    console.error(`\n${cross} Missing ${CREDS_FILE}`);
    console.error('Run: node scripts/import-sermons.mjs --auth\n');
    process.exit(1);
  }

  const raw   = JSON.parse(readFileSync(CREDS_FILE, 'utf-8'));
  const creds = raw.installed ?? raw.web;
  const auth  = new google.auth.OAuth2(
    creds.client_id, creds.client_secret, `http://localhost:${AUTH_PORT}`
  );

  if (existsSync(TOKEN_FILE)) {
    const token = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
    auth.setCredentials(token);
    if (token.expiry_date && token.expiry_date < Date.now() + 60_000) {
      const { credentials } = await auth.refreshAccessToken();
      auth.setCredentials(credentials);
      writeFileSync(TOKEN_FILE, JSON.stringify(credentials, null, 2));
    }
    return auth;
  }

  // First-time OAuth2 flow
  const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log(`\n${c.bold}Open this URL in your browser:${c.reset}\n`);
  console.log(authUrl + '\n');
  console.log(`${c.dim}Waiting for callback on http://localhost:${AUTH_PORT} …${c.reset}\n`);

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const qs = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authenticated ✓ — you can close this tab.</h1>');
      server.close();
      if (qs.code) resolve(qs.code);
      else reject(new Error('No code in callback: ' + req.url));
    });
    server.listen(AUTH_PORT);
    server.on('error', reject);
  });

  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log(`${tick} Token saved.\n`);
  return auth;
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

async function listFolder(drive, folderId) {
  const all = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q:         `'${folderId}' in parents and trashed = false`,
      fields:    'nextPageToken, files(id, name, modifiedTime)',
      orderBy:   'name desc',
      pageSize:  1000,
      pageToken,
    });
    all.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

async function downloadFile(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args  = process.argv.slice(2);
const force = args.includes('--force');
const check = args.includes('--check');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${c.bold}download-sermons${c.reset} — mirror Drive sermon folders to scripts/drive/

  ${c.cyan}(no args)${c.reset}    download files not yet cached locally
  ${c.cyan}--force${c.reset}      re-download all files (overwrite existing)
  ${c.cyan}--check${c.reset}      show status without downloading
  ${c.cyan}--help${c.reset}       show this message

Output: scripts/drive/{comp-tax,enriched,sermon-blocks}/
`);
  process.exit(0);
}

const auth  = await getAuth();
const drive = google.drive({ version: 'v3', auth });

// Ensure local cache folders exist
for (const { dir } of Object.values(FOLDERS)) {
  mkdirSync(join(CACHE_DIR, dir), { recursive: true });
}

console.log(`\n${c.bold}Sermon Drive Mirror${c.reset}  ${force ? c.yellow + '(--force: re-downloading all)' + c.reset : ''}`);
console.log('═'.repeat(60));

let totalDrive = 0, totalNew = 0, totalSkipped = 0, totalFailed = 0;

for (const [key, { id, dir }] of Object.entries(FOLDERS)) {
  const localDir = join(CACHE_DIR, dir);
  const files    = await listFolder(drive, id);

  console.log(`\n${c.bold}${dir}/${c.reset}  (${files.length} files on Drive)`);

  for (const file of files) {
    totalDrive++;
    const localName = dir === 'sermon-blocks'
      ? file.name.replace(/^sermon-block-/, '')
      : file.name;
    const dest = join(localDir, localName);

    if (!force && existsSync(dest)) {
      if (check) console.log(`  ${skip} ${localName}`);
      totalSkipped++;
      continue;
    }

    if (check) {
      console.log(`  ${cross} ${c.red}missing${c.reset}  ${localName}`);
      continue;
    }

    process.stdout.write(`  ${c.dim}↓${c.reset} ${localName} … `);
    try {
      const buf = await downloadFile(drive, file.id);
      writeFileSync(dest, buf);
      process.stdout.write(`${tick}\n`);
      totalNew++;
    } catch (err) {
      process.stdout.write(`${cross}\n`);
      console.error(`    ${c.red}${err.message}${c.reset}`);
      totalFailed++;
    }
  }
}

console.log('\n' + '─'.repeat(60));

if (check) {
  const missing = totalDrive - totalSkipped;
  console.log(`Drive: ${totalDrive} files   Cached: ${totalSkipped}   Missing: ${missing}`);
  if (missing > 0) {
    console.log(`\nRun ${c.cyan}node scripts/download-sermons.mjs${c.reset} to download missing files.\n`);
  } else {
    console.log(`\n${tick} All Drive files are cached locally.\n`);
  }
} else {
  console.log(`Downloaded: ${totalNew}   Skipped (already local): ${totalSkipped}${totalFailed ? `   Failed: ${totalFailed}` : ''}`);
  console.log(`\n${tick} Cache at ${c.cyan}scripts/drive/${c.reset}\n`);
}
