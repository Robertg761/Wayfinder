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
const fixtureMap = {
  repo: 'example/wayfinder-fixture',
  sha: 'a'.repeat(40),
  requestedRef: null,
  resolvedRef: 'main',
  defaultBranch: 'main',
  description: 'A fixture repository for Wayfinder.',
  homepage: null,
  language: 'TypeScript',
  stars: 1,
  readme: '# Fixture',
  tree: [
    { path: 'src', type: 'tree' },
    { path: 'tests', type: 'tree' },
    { path: 'README.md', type: 'blob' },
    { path: 'package.json', type: 'blob' },
    { path: 'src/index.ts', type: 'blob' },
    { path: 'tests/index.test.ts', type: 'blob' },
  ],
  setupFiles: ['package.json', 'pnpm-lock.yaml'],
  truncated: false,
  generatedAt: '2026-07-15T12:00:00.000Z',
};
const fixtureTour = {
  repo: fixtureMap.repo,
  sha: fixtureMap.sha,
  summary: fixtureMap.description,
  stack: ['TypeScript', 'Node.js'],
  entryPoints: [{ path: 'src/index.ts', why: 'Primary entry point.' }],
  stops: [{ order: 1, title: 'Start here', path: 'src/index.ts', lines: [1, 40], explanation: 'Primary entry point.', lookFor: 'Exports.' }],
};
const developGuide = {
  repo: fixtureMap.repo,
  sha: fixtureMap.sha,
  audience: 'develop',
  packageManager: 'pnpm',
  runtimes: ['Node.js >=22'],
  prerequisites: [],
  steps: [
    { order: 1, title: 'Run the tests', command: 'pnpm test', evidence: { path: 'package.json' }, confidence: 'documented' },
    { order: 2, title: 'Install dependencies', command: 'pnpm install', evidence: { path: 'package.json' }, confidence: 'documented' },
  ],
  warnings: [],
  generatedAt: '2026-07-15T12:00:00.000Z',
};

let context: BrowserContext;
let page: Page;
let profile: string;

async function openHelper(): Promise<void> {
  const close = page.getByRole('button', { name: 'Close helper' });
  if (await close.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'Open Wayfinder helper' }).click();
}

async function selectMode(mode: 'Guided' | 'Quick'): Promise<void> {
  await openHelper();
  const firstRun = page.getByRole('button', { name: mode === 'Guided' ? 'Guide me' : 'Quick map' });
  if (await firstRun.isVisible().catch(() => false)) {
    if (mode === 'Quick') {
      await page.getByRole('button', { name: 'Guide me' }).click();
      await page.getByRole('button', { name: 'Quick', exact: true }).click();
    } else {
      await firstRun.click();
    }
    return;
  }
  await page.getByRole('button', { name: mode, exact: true }).click();
}

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
  await page.route(/^(?:http:\/\/localhost:8787|https:\/\/wayfinder-api\.hopit-robert\.workers\.dev)\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/map') return route.fulfill({ json: fixtureMap });
    if (url.pathname === '/tour') return route.fulfill({ json: fixtureTour });
    if (url.pathname === '/agent') {
      const request = route.request().postDataJSON() as { query: string };
      if (/use this project/i.test(request.query)) {
        return route.fulfill({ json: {
          repo: fixtureMap.repo, sha: fixtureMap.sha, query: request.query, intent: 'installation', mode: 'free',
          summary: 'I found one consumer installation command.', suggestions: [], generatedAt: '2026-07-15T12:00:00.000Z',
          guide: { ...developGuide, audience: 'use', steps: [{ ...developGuide.steps[1], title: 'Install the published package', command: 'pnpm add wayfinder-fixture' }] },
        } });
      }
      return route.fulfill({ json: {
        repo: fixtureMap.repo, sha: fixtureMap.sha, query: request.query, intent: 'orientation', mode: 'free',
        summary: fixtureTour.summary, suggestions: [], generatedAt: '2026-07-15T12:00:00.000Z', tour: fixtureTour, guide: developGuide,
      } });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
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
  await selectMode('Quick');
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await expect(composer).toBeFocused();
  await page.getByRole('button', { name: 'Map a change' }).click();
  await expect(composer).toHaveValue('I want to change [feature]. Plan my contribution.');
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
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository name')).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/example/wayfinder-fixture/blob/main/src/index.ts');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByText('No visible landmarks yet.')).toBeVisible();
  await expect(page.getByText('Repository name')).toBeHidden();
});

test('does not retain movement delays when reduced motion is requested', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository name')).toBeVisible({ timeout: 700 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('reopens with the final repository after rapid closed-state navigation', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.evaluate(() => {
    history.pushState({}, '', '/old/repository');
    document.dispatchEvent(new Event('turbo:load'));
    history.pushState({}, '', '/final/repository');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await page.waitForTimeout(1_300);
  await openHelper();
  await expect(page.getByText('Learn this repository one landmark at a time.')).toBeVisible();
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByRole('heading', { name: 'final / repository' })).toBeVisible();
});

test('persists quick mode and reopens without repeating first-run onboarding', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open Wayfinder helper' }).click();
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guide me' })).toBeHidden();
});

test('opens and closes with the keyboard shortcut', async () => {
  await page.goto(fixtureUrl);
  await page.keyboard.press('Alt+Shift+W');
  await expect(page.getByRole('button', { name: 'Close helper' })).toBeVisible();
  await page.keyboard.press('Alt+Shift+W');
  await expect(page.getByRole('button', { name: 'Close helper' })).toBeHidden();
});

test('renders a compact quick snapshot with setup commands in workflow order', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByText('A fixture repository for Wayfinder.').first()).toBeVisible();
  await expect(page.getByText('TypeScript, Node.js')).toBeVisible();
  await expect(page.getByText('main at aaaaaaaaaaaa')).toBeVisible();
  await expect(page.getByText('pnpm install · pnpm test')).toBeVisible();
});

test('asks whether setup means using or developing the project', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Use or develop this project' }).click();
  await expect(page.getByRole('heading', { name: 'What are you setting up?' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this project' }).click();
  await expect(page.getByRole('button', { name: 'pnpm add wayfinder-fixture' })).toBeVisible();
});
