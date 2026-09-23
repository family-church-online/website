#!/usr/bin/env node
// Installs a .desktop shortcut on the user's desktop pointing at the sermon pipeline.

import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const launchSh   = join(__dirname, '..', 'sermon-pipeline', 'launch.sh');
const desktopDir = join(homedir(), 'Desktop');
const outFile    = join(desktopDir, 'Sermon Pipeline.desktop');

if (!existsSync(desktopDir)) mkdirSync(desktopDir, { recursive: true });

const content = `[Desktop Entry]
Version=1.0
Type=Application
Name=Sermon Pipeline
Comment=Process and publish Sunday sermon
Exec=${launchSh}
Icon=media-record
Terminal=false
Categories=AudioVideo;
`;

writeFileSync(outFile, content);
chmodSync(outFile, 0o755);
console.log(`Shortcut installed: ${outFile}`);
console.log('Right-click it on the desktop and choose "Allow Launching" if prompted.');
