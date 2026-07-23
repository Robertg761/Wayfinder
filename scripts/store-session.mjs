// Launches a visible, CDP-controllable Chromium on the desktop for the
// Chrome Web Store submission. The user signs in and pays interactively;
// later automation connects via http://localhost:9222 to drive the forms.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const profile = join(homedir(), '.cache', 'wayfinder-store-profile');
await mkdir(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: false,
  viewport: null,
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--remote-debugging-port=9222',
    '--window-size=1400,950',
    '--disable-blink-features=AutomationControlled',
  ],
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://chrome.google.com/webstore/devconsole', { waitUntil: 'domcontentloaded' });
console.log('Store session browser is up; CDP on http://localhost:9222');
// Keep the process (and the window) alive until explicitly killed; exit
// cleanly if the user closes the browser window themselves.
context.on('close', () => process.exit(0));
setInterval(() => {}, 60_000);
