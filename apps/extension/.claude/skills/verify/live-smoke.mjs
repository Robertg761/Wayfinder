import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const profile = await mkdtemp(join(tmpdir(), 'wayfinder-live-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${resolve('apps/extension/.output/chrome-mv3')}`, `--load-extension=${resolve('apps/extension/.output/chrome-mv3')}`],
});
const page = context.pages()[0] ?? await context.newPage();
const result = { console: [], errors: [] };
page.on('console', m => result.console.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', e => result.errors.push(e.message));
try {
  await page.goto('https://github.com/anthropics/anthropic-sdk-typescript', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#wayfinder-page-guide').waitFor({ state: 'attached', timeout: 15000 });
  await page.getByRole('button', { name: 'Open Wayfinder helper' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/private/tmp/wayfinder-live-smoke.png', fullPage: true });
  result.title = await page.title();
  result.url = page.url();
  result.text = await page.locator('#wayfinder-page-guide').evaluate(host => host.shadowRoot?.querySelector('.wf-bubble')?.textContent?.trim().replace(/\s+/g, ' '));
  result.rect = await page.locator('#wayfinder-page-guide').evaluate(host => {
    const b = host.shadowRoot?.querySelector('.wf-bubble'); if (!b) return null;
    const r = b.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,scrollHeight:b.scrollHeight,clientHeight:b.clientHeight };
  });
} catch (e) { result.fatal = e.stack || String(e); }
console.log(JSON.stringify(result, null, 2));
await context.close();
await rm(profile, { recursive: true, force: true });
