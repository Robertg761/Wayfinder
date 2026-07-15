import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extensionPath = resolve('apps/extension/.output/chrome-mv3');
const fixtureUrl = 'https://github.com/example/wayfinder-fixture';
const fixtureHtml = `<!doctype html>
  <html><body>
    <main>
      <h1><strong><a itemprop="name">wayfinder-fixture</a></strong></h1>
      <button data-hotkey="w">main</button>
      <table aria-label="Folders and files"><tbody><tr><td>src</td></tr></tbody></table>
      <article id="readme" class="markdown-body"><h2>Fixture README</h2></article>
    </main>
  </body></html>`;

let context: BrowserContext;
let page: Page;
let profile: string;

test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'wayfinder-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  page = context.pages()[0] ?? await context.newPage();
  await page.route('https://github.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml });
  });
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('survives repeated page reloads without damaging the host page', async () => {
  await page.goto(fixtureUrl);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(page.getByText('Fixture README')).toBeVisible();
    await expect(page.locator('#wayfinder-page-guide')).toBeAttached();
    await page.reload();
  }
});

test('captures contribution intent before dispatch and supports keyboard dismissal', async () => {
  await page.goto(fixtureUrl);
  await page.getByRole('button', { name: 'Ask Wayfinder' }).click();
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await expect(composer).toBeFocused();
  await page.getByRole('button', { name: 'Plan a contribution' }).click();
  await expect(composer).toHaveValue('I want to change [feature]. Plan my first contribution.');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => {
    const host = document.querySelector('#wayfinder-page-guide');
    return {
      document: document.activeElement?.id ?? document.activeElement?.tagName,
      shadow: host?.shadowRoot?.activeElement?.getAttribute('aria-label') ?? host?.shadowRoot?.activeElement?.tagName,
    };
  })).toEqual({ document: 'wayfinder-page-guide', shadow: 'Open Wayfinder helper' });
  await expect(composer).toBeHidden();
});

test('hides the helper outside repository routes', async () => {
  await page.goto('https://github.com/settings/profile');
  await expect(page.locator('#wayfinder-page-guide')).toBeHidden();
});

test('resets an open tour when GitHub changes the current file', async () => {
  await page.goto(fixtureUrl);
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository coordinates')).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/example/wayfinder-fixture/blob/main/src/index.ts');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByText('No visible landmarks yet.')).toBeVisible();
  await expect(page.getByText('Repository coordinates')).toBeHidden();
});

test('does not retain movement delays when reduced motion is requested', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository coordinates')).toBeVisible({ timeout: 700 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});
