import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outDir = resolve('docs/assets/store');
await mkdir(outDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'wayfinder-store-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${resolve('apps/extension/.output/chrome-mv3')}`, `--load-extension=${resolve('apps/extension/.output/chrome-mv3')}`],
});
const page = context.pages()[0] ?? await context.newPage();
const shot = (name) => page.screenshot({ path: join(outDir, name) });
const inHelper = (selector) => page.locator('#wayfinder-page-guide');

try {
  await page.goto('https://github.com/Robertg761/Wayfinder', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#wayfinder-page-guide').waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(1200);

  // 1. First-run choice (the helper may have auto-opened its onboarding)
  const launcher = page.locator('#wayfinder-page-guide').getByRole('button', { name: /Wayfinder helper/ }).first();
  if (await launcher.getAttribute('aria-expanded') !== 'true') {
    await launcher.click();
  }
  await page.getByRole('button', { name: 'Quick map' }).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);
  await shot('01-choose-your-pace.png');

  // 2. Quick map dispatches the overview question against the live worker
  await page.getByRole('button', { name: 'Quick map' }).click();
  await page.getByText(/orientation|entry point|repository/i).first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1500);
  await shot('02-overview-answer.png');

  // 3. Ask an installation question via the suggested follow-up
  const followUp = page.getByRole('button', { name: /install and run/i }).first();
  await followUp.scrollIntoViewIfNeeded();
  await followUp.click();
  // Repos with releases route to the guided release journey; others show
  // copyable setup commands. Accept either surface.
  await page.getByRole('button', { name: /Copy command/i })
    .or(page.getByRole('button', { name: 'Open Releases' }))
    .first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1200);
  await shot('03-install-guide.png');

  // 4. Dark mode of the same surface
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(600);
  await shot('04-dark-mode.png');

  console.log('done');
} catch (error) {
  console.error('FAILED:', error.message);
  await shot('99-debug.png').catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
