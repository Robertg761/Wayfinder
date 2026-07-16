import { expect, test, chromium, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extensionPath = resolve('apps/extension/.output/chrome-mv3');
const fixtureUrl = 'https://github.com/example/wayfinder-fixture';

type ApiState = {
  mapDelayByRepo: Record<string, number>;
  mapFailures: number;
  tourFailures: number;
  agentFailures: number;
  requests: Array<{ path: string; repo?: string; query?: string }>;
};

let context: BrowserContext;
let page: Page;
let profile: string;
let api: ApiState;

function fixtureHtml(url: string): string {
  const parsed = new URL(url);
  const [, owner = 'example', repo = 'wayfinder-fixture'] = parsed.pathname.split('/');
  const fileSurface = parsed.pathname.includes('/blob/')
    ? `<nav aria-label="Breadcrumbs">${repo} / src / index.ts</nav>
       <div data-testid="code-viewer"><span data-line-number="1">1</span><pre>export const fixture = true;</pre></div>`
    : `<table aria-label="Folders and files"><tbody><tr><td>src</td></tr></tbody></table>
       <article id="readme" class="markdown-body"><h2>Fixture README</h2></article>`;
  return `<!doctype html>
    <html><body>
      <main>
        <h1><strong><a itemprop="name">${owner} / ${repo}</a></strong></h1>
        <button data-hotkey="w">main</button>
        ${fileSurface}
      </main>
    </body></html>`;
}

function shaFor(repo: string): string {
  const digit = (([...repo].reduce((total, character) => total + character.charCodeAt(0), 0) % 15) + 1).toString(16);
  return digit.repeat(40);
}

function mapFor(owner: string, repo: string, ref: string | null = null) {
  const identity = `${owner}/${repo}`;
  return {
    repo: identity,
    sha: shaFor(identity),
    requestedRef: ref,
    resolvedRef: ref ?? 'main',
    defaultBranch: 'main',
    description: `A fixture repository for ${identity}.`,
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
}

function tourFor(map: ReturnType<typeof mapFor>) {
  return {
    repo: map.repo,
    sha: map.sha,
    summary: map.description,
    stack: ['TypeScript', 'Node.js'],
    entryPoints: [{ path: 'src/index.ts', why: 'Primary entry point.' }],
    stops: [{ order: 1, title: 'Start here', path: 'src/index.ts', lines: [1, 40], explanation: 'Primary entry point.', lookFor: 'Exports.' }],
  };
}

function developGuide(map: ReturnType<typeof mapFor>) {
  return {
    repo: map.repo,
    sha: map.sha,
    audience: 'develop',
    packageManager: 'pnpm',
    runtimes: ['Node.js >=22'],
    prerequisites: [{ text: 'Use Node.js 22.', evidence: { path: 'package.json', lines: [1, 12] }, confidence: 'documented' }],
    steps: [
      { order: 1, title: 'Run the tests', command: 'pnpm test', evidence: { path: 'package.json', lines: [6, 10] }, confidence: 'documented' },
      { order: 2, title: 'Install dependencies', command: 'pnpm install', evidence: { path: 'package.json', lines: [1, 12] }, confidence: 'documented' },
    ],
    warnings: [],
    generatedAt: '2026-07-15T12:00:00.000Z',
  };
}

async function handleApi(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const body = route.request().postDataJSON() as Record<string, unknown> | null;
  if (url.pathname === '/map') {
    const owner = String(body?.owner ?? 'example');
    const repo = String(body?.repo ?? 'wayfinder-fixture');
    const ref = typeof body?.ref === 'string' ? body.ref : null;
    const identity = `${owner}/${repo}`;
    api.requests.push({ path: '/map', repo: identity });
    const delay = api.mapDelayByRepo[identity] ?? 0;
    if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    if (api.mapFailures > 0) {
      api.mapFailures -= 1;
      await route.fulfill({ status: 503, json: { code: 'upstream-unavailable', message: 'Fixture map unavailable.' } }).catch(() => undefined);
      return;
    }
    await route.fulfill({ json: mapFor(owner, repo, ref) }).catch(() => undefined);
    return;
  }
  if (url.pathname === '/tour') {
    const map = body?.map as ReturnType<typeof mapFor>;
    api.requests.push({ path: '/tour', repo: map.repo });
    if (api.tourFailures > 0) {
      api.tourFailures -= 1;
      await route.fulfill({ status: 503, json: { code: 'upstream-unavailable', message: 'Fixture tour unavailable.' } }).catch(() => undefined);
      return;
    }
    await route.fulfill({ json: tourFor(map) }).catch(() => undefined);
    return;
  }
  if (url.pathname === '/agent') {
    const map = body?.map as ReturnType<typeof mapFor>;
    const query = String(body?.query ?? '');
    api.requests.push({ path: '/agent', repo: map.repo, query });
    if (api.agentFailures > 0) {
      api.agentFailures -= 1;
      await route.fulfill({ status: 503, json: { code: 'upstream-unavailable', message: 'Fixture agent unavailable.' } }).catch(() => undefined);
      return;
    }
    const guide = developGuide(map);
    if (/use this project/i.test(query)) {
      await route.fulfill({ json: {
        repo: map.repo, sha: map.sha, query, intent: 'installation', mode: 'free',
        summary: 'I found one consumer installation command.', suggestions: [], evidencePaths: ['package.json'], generatedAt: '2026-07-15T12:00:00.000Z',
        guide: { ...guide, audience: 'use', steps: [{ ...guide.steps[1], title: 'Install the published package', command: 'pnpm add wayfinder-fixture' }] },
      } });
      return;
    }
    await route.fulfill({ json: {
      repo: map.repo, sha: map.sha, query, intent: 'orientation', mode: 'free',
      summary: `${map.repo} orientation`, explanation: 'A detailed fixture explanation used to exercise the expanded answer surface.',
      suggestions: ['Where are the tests?'], evidencePaths: ['src/index.ts'], generatedAt: '2026-07-15T12:00:00.000Z',
      tour: tourFor(map), guide,
      brief: [
        { title: 'Read the entry point', action: 'Inspect the exported surface.', evidencePath: 'src/index.ts' },
        { title: 'Pair it with tests', action: 'Confirm behavior in the test suite.', evidencePath: 'tests/index.test.ts' },
      ],
    } });
    return;
  }
  await route.fulfill({ status: 404, json: { error: 'not_found' } });
}

async function openHelper(): Promise<void> {
  const launcher = page.locator('#wayfinder-page-guide').getByRole('button', { name: /Wayfinder helper/ }).first();
  if (await launcher.getAttribute('aria-expanded') !== 'true') {
    await page.getByRole('button', { name: 'Open Wayfinder helper' }).click();
  }
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Close helper' })).toBeVisible();
}

async function selectMode(mode: 'Guided' | 'Quick'): Promise<void> {
  await openHelper();
  await page.getByRole('button', { name: /^(Guide me|Quick map|Guided|Quick)$/ }).first().waitFor({ state: 'visible' });
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
  const switchButton = page.getByRole('button', { name: mode, exact: true });
  if (await switchButton.getAttribute('aria-pressed') !== 'true') await switchButton.click();
}

async function activeShadowLabel(): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.querySelector('#wayfinder-page-guide')?.shadowRoot?.activeElement;
    return active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? active?.tagName ?? null;
  });
}

async function bubbleState() {
  return page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')?.shadowRoot;
    const bubble = shadow?.querySelector<HTMLElement>('.wf-bubble');
    const copy = shadow?.querySelector<HTMLElement>('.wf-copy');
    return {
      maxHeight: Number.parseFloat(bubble?.style.maxHeight ?? '0'),
      scrollTop: bubble?.scrollTop ?? -1,
      scrollHeight: bubble?.scrollHeight ?? 0,
      clientHeight: bubble?.clientHeight ?? 0,
      ariaLiveOnCopy: copy?.hasAttribute('aria-live') ?? true,
    };
  });
}

test.beforeEach(async () => {
  api = { mapDelayByRepo: {}, mapFailures: 0, tourFailures: 0, agentFailures: 0, requests: [] };
  profile = await mkdtemp(join(tmpdir(), 'wayfinder-browser-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  page = context.pages()[0] ?? await context.newPage();
  await page.route('https://github.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml(route.request().url()) });
  });
  await page.route(/^(?:http:\/\/localhost:8787|https:\/\/wayfinder-api\.hopit-robert\.workers\.dev)\//, handleApi);
});

test.afterEach(async () => {
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
  await expect(page.getByRole('button', { name: 'Quick', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Map a change' }).click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('I want to change [feature]. Plan my contribution.');
  await page.keyboard.press('Escape');
  await expect.poll(activeShadowLabel).toBe('Open Wayfinder helper');
  await expect(composer).toBeHidden();
});

test('hides the helper outside repository routes and leaves the shortcut untouched', async () => {
  await page.goto('https://github.com/settings/profile');
  await expect(page.locator('#wayfinder-page-guide')).toBeHidden();
  const dispatched = await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'w', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
  })));
  expect(dispatched).toBe(true);
});

test('resets an open tour when GitHub changes the current file', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector('#wayfinder-page-guide')!.shadowRoot!.querySelector('.wf-dock')!).transitionDuration);
  expect(duration).toBe('0s');
});

test('reopens with the final repository after rapid closed-state navigation', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await openHelper();
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guide me' })).toBeHidden();
});

test('dispatches the first-run Quick map action directly', async () => {
  await page.goto(fixtureUrl);
  await openHelper();
  await page.getByRole('button', { name: 'Quick map' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quick', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(api.requests.some((request) => request.path === '/agent' && request.query === 'Give me a 60-second overview of this repository')).toBe(true);
});

test('opens and closes with the keyboard shortcut', async () => {
  await page.goto(fixtureUrl);
  await page.keyboard.press('Alt+Shift+W');
  await expect(page.getByRole('button', { name: 'Close helper' })).toBeVisible();
  await page.keyboard.press('Alt+Shift+W');
  await expect(page.getByRole('button', { name: 'Close helper' })).toBeHidden();
  await expect.poll(activeShadowLabel).toBe('Open Wayfinder helper');
});

test('renders a compact quick snapshot with setup commands in workflow order', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Answer ready.');
  await expect(page.getByText('TypeScript, Node.js')).toBeVisible();
  await expect(page.getByText(`main at ${shaFor('example/wayfinder-fixture').slice(0, 12)}`)).toBeVisible();
  await expect(page.getByText('pnpm install · pnpm test')).toBeVisible();
});

test('asks whether setup means using or developing the project', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Use or develop this project' }).click();
  await expect(page.getByRole('heading', { name: 'What are you setting up?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use this project' })).toBeFocused();
  await page.getByRole('button', { name: 'Use this project' }).click();
  await expect(page.getByRole('button', { name: 'Copy command: pnpm add wayfinder-fixture' })).toBeVisible();
});

test('expands from onboarding to the agent surface without retaining stale scroll', async () => {
  await page.goto(fixtureUrl);
  await openHelper();
  await expect.poll(async () => (await bubbleState()).maxHeight).toBeGreaterThan(0);
  const compact = await bubbleState();
  await page.getByRole('button', { name: 'Guide me' }).click();
  await page.getByRole('button', { name: 'Quick', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  const expanded = await bubbleState();
  expect(expanded.maxHeight).toBeGreaterThan(compact.maxHeight);
  expect(expanded.scrollTop).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Question for Wayfinder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repository snapshot' })).toBeVisible();
});

test('keeps the expanded agent surface reachable in a narrow viewport', async () => {
  await page.setViewportSize({ width: 360, height: 500 });
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  const state = await bubbleState();
  expect(state.maxHeight).toBeLessThanOrEqual(472);
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question for Wayfinder' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')!.shadowRoot!;
    const active = shadow.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const bubble = shadow.querySelector('.wf-bubble')!.getBoundingClientRect();
    const focused = active.getBoundingClientRect();
    return focused.bottom > bubble.top + 8 && focused.top < bubble.bottom - 8;
  })).toBe(true);
});

test('keeps an open answer on screen while the viewport is resized', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 500 });
  await expect.poll(() => page.evaluate(() => {
    const bubble = document.querySelector('#wayfinder-page-guide')!.shadowRoot!.querySelector('.wf-bubble')!.getBoundingClientRect();
    return bubble.left >= 0 && bubble.top >= 0 && bubble.right <= innerWidth && bubble.bottom <= innerHeight;
  })).toBe(true);
});

test('moves focus deterministically through guided and agent render transitions', async () => {
  api.mapDelayByRepo['example/wayfinder-fixture'] = 250;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await openHelper();
  await expect(page.getByRole('button', { name: 'Guide me' })).toBeFocused();
  await page.getByRole('button', { name: 'Guide me' }).click();
  await expect(page.getByRole('button', { name: 'Show me around' })).toBeFocused();
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect.poll(activeShadowLabel).toBe('Wayfinder helper');
  await expect(page.getByRole('button', { name: 'Next landmark' })).toBeFocused();
  await page.getByRole('button', { name: 'Explain this' }).click();
  await expect(page.getByRole('button', { name: 'Ask a follow-up' })).toBeFocused();
  await page.getByRole('button', { name: 'Continue tour' }).click();
  for (let step = 0; step < 3; step += 1) {
    const next = page.getByRole('button', { name: step === 2 ? 'Finish tour' : 'Next landmark' });
    await expect(next).toBeFocused();
    await next.click();
  }
  await expect(page.getByRole('button', { name: 'Ask Wayfinder' })).toBeFocused();
  await page.getByRole('button', { name: 'Ask Wayfinder' }).click();
  await expect(page.getByRole('textbox', { name: 'Question for Wayfinder' })).toBeFocused();
  await page.getByRole('button', { name: 'Map it in 60 seconds' }).click();
  await expect.poll(activeShadowLabel).toBe('Wayfinder helper');
});

test('cancels movement on Escape and restores focus for every dismissal path', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2_300);
  await expect(page.getByRole('button', { name: 'Close helper' })).toBeHidden();
  await expect.poll(activeShadowLabel).toBe('Open Wayfinder helper');
  const tourState = await page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')!.shadowRoot!;
    return {
      highlight: shadow.querySelector('.wf-highlight')!.classList.contains('visible'),
      dockLeft: (shadow.querySelector('.wf-dock') as HTMLElement).style.left,
    };
  });
  expect(tourState).toEqual({ highlight: false, dockLeft: '' });
  await openHelper();
  await page.getByRole('button', { name: 'Close Wayfinder helper' }).click();
  await expect.poll(activeShadowLabel).toBe('Open Wayfinder helper');
  await openHelper();
  await page.getByRole('button', { name: 'Close helper' }).click();
  await expect.poll(activeShadowLabel).toBe('Open Wayfinder helper');
});

test('lets an agent request finish while the helper is temporarily closed', async () => {
  api.mapDelayByRepo['example/wayfinder-fixture'] = 600;
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.waitForTimeout(900);
  await openHelper();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
});

test('ignores stale repository responses after SPA navigation', async () => {
  api.mapDelayByRepo['alpha/one'] = 2_000;
  await page.goto('https://github.com/alpha/one');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await page.evaluate(() => {
    history.pushState({}, '', '/beta/two');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await page.waitForTimeout(1_300);
  await openHelper();
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByText('beta/two orientation')).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByText('alpha/one orientation')).toBeHidden();
});

test('guards saved-trail restoration across repository navigation', async () => {
  await page.goto('https://github.com/alpha/one');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByText('alpha/one orientation')).toBeVisible();
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.evaluate(() => {
    history.pushState({}, '', '/beta/two');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await page.waitForTimeout(1_300);
  api.mapDelayByRepo['alpha/one'] = 2_000;
  await page.evaluate(() => {
    history.pushState({}, '', '/alpha/one');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await page.waitForTimeout(1_300);
  await page.evaluate(() => {
    history.pushState({}, '', '/beta/two');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await page.waitForTimeout(2_300);
  await openHelper();
  await expect(page.getByRole('button', { name: 'Back to saved trail' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
});

test('offers Retry after a guided repository failure', async () => {
  api.mapFailures = 1;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Repository name')).toBeVisible();
  await expect(page.getByText('In this project')).toBeVisible();
});

test('continues a guided tour without claiming unavailable project facts', async () => {
  api.mapFailures = 1;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByRole('button', { name: 'Continue without project facts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue without project facts' }).click();
  await expect(page.getByText('Repository name')).toBeVisible();
  await expect(page.getByText('In this project')).toBeHidden();
});

test('focuses and announces an agent error before allowing retry', async () => {
  api.agentFailures = 1;
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  await expect.poll(activeShadowLabel).toBe('Wayfinder helper');
  await expect(page.getByRole('status')).toContainText('Connection interrupted');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
});

test('keeps a saved answer paired with its original question after a later failure', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await page.getByRole('button', { name: '← New question' }).click();
  api.agentFailures = 1;
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.fill('This request should fail');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  await page.getByRole('button', { name: 'New question' }).click();
  await page.getByRole('button', { name: 'Back to saved trail' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh ↻' }).click();
  await expect.poll(() => api.requests.filter((request) => request.path === '/agent').at(-1)?.query).toBe('Give me a 60-second overview of this repository');
});

test('persists answer depth with stateful controls and mode defaults', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  const concise = page.getByRole('button', { name: 'Concise', exact: true });
  const expanded = page.getByRole('button', { name: 'Expanded', exact: true });
  await expect(concise).toHaveAttribute('aria-pressed', 'true');
  await expanded.click();
  await expect(expanded).toHaveAttribute('aria-pressed', 'true');
  await expect(expanded).toBeFocused();
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.reload();
  await openHelper();
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await expect(page.getByRole('button', { name: 'Expanded', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Guided', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expanded', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Quick', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Concise', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('renders branch-pinned semantic evidence links with line fragments', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await page.getByRole('button', { name: 'Expanded', exact: true }).click();
  await page.getByText('Recommended reading route').click();
  const link = page.getByRole('link', { name: 'Open src/index.ts, lines 1 through 40' });
  await expect(link).toHaveAttribute('href', `https://github.com/example/wayfinder-fixture/blob/${shaFor('example/wayfinder-fixture')}/src/index.ts#L1-L40`);
  await expect(page.getByRole('link', { name: 'Open src/index.ts' }).first()).toBeVisible();
});

test('uses a dedicated live status and keeps copy labels stable through rapid activation', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://github.com' });
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Use or develop this project' }).click();
  await page.getByRole('button', { name: 'Use this project' }).click();
  const copyButton = page.getByRole('button', { name: 'Copy command: pnpm add wayfinder-fixture' });
  const before = await copyButton.textContent();
  await copyButton.dblclick();
  await expect(page.getByRole('status')).toHaveText('Command copied to clipboard.');
  expect(await copyButton.textContent()).toBe(before);
  await expect(copyButton).toHaveAttribute('data-copy-state', 'Copied');
  await expect(copyButton).toHaveAttribute('aria-busy', 'false');
  expect((await bubbleState()).ariaLiveOnCopy).toBe(false);
});

test('reports copy failure and permits a later retry without mutating the command', async () => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setPermission', {
    permission: { name: 'clipboard-write' },
    setting: 'denied',
    origin: 'https://github.com',
  });
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Use or develop this project' }).click();
  await page.getByRole('button', { name: 'Use this project' }).click();
  const copyButton = page.getByRole('button', { name: 'Copy command: pnpm add wayfinder-fixture' });
  const label = await copyButton.textContent();
  await copyButton.click();
  await expect(page.getByRole('status')).toHaveText('Copy failed. Try again.');
  await expect(copyButton).toHaveAttribute('data-copy-state', 'Copy failed');
  expect(await copyButton.textContent()).toBe(label);
  await cdp.send('Browser.setPermission', {
    permission: { name: 'clipboard-write' },
    setting: 'granted',
    origin: 'https://github.com',
  });
  await expect(copyButton).toHaveAttribute('aria-busy', 'false');
  await copyButton.click();
  await expect(page.getByRole('status')).toHaveText('Command copied to clipboard.');
  expect(await copyButton.textContent()).toBe(label);
});

test('does not treat issue content as repository file-tree landmarks', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('https://github.com/example/wayfinder-fixture/issues/1');
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository name')).toBeVisible();
  await expect(page.getByText('1 / 1')).toBeVisible();
  await expect(page.getByText('README', { exact: true })).toBeHidden();
  await expect(page.getByText('File tree', { exact: true })).toBeHidden();
});

test('treats tree routes as repository context rather than source files', async () => {
  await page.goto('https://github.com/example/wayfinder-fixture/tree/main/src');
  await selectMode('Quick');
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repository snapshot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Summarize this file' })).toBeHidden();
});

test('replaces a previous file answer with the new file context after SPA navigation', async () => {
  await page.goto('https://github.com/example/wayfinder-fixture/blob/main/src/one.ts');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Summarize this file' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/example/wayfinder-fixture/blob/main/src/two.ts');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByText('Starting from src/two.ts.')).toBeVisible();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back to saved trail' })).toBeVisible();
});

test('keeps an in-flight request alive across a fragment-only navigation', async () => {
  api.mapDelayByRepo['example/wayfinder-fixture'] = 800;
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'Repository snapshot' }).click();
  await page.evaluate(() => {
    history.pushState({}, '', '#readme');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
});

test('reparses slash-containing refs when the branch control settles', async () => {
  await page.goto('https://github.com/example/wayfinder-fixture/blob/feature/navigation/src/index.ts');
  await selectMode('Quick');
  await expect(page.getByText('Starting from navigation/src/index.ts.')).toBeVisible();
  await page.getByRole('button', { name: 'main' }).evaluate((button) => { button.textContent = 'feature/navigation'; });
  await page.evaluate(() => document.dispatchEvent(new Event('turbo:load')));
  await expect(page.getByText('Starting from src/index.ts.')).toBeVisible();
});

test('remounts the helper after a same-document Turbo replacement removes it', async () => {
  await page.goto(fixtureUrl);
  await page.locator('#wayfinder-page-guide').evaluate((host) => host.remove());
  await page.evaluate(() => document.dispatchEvent(new Event('turbo:load')));
  await expect(page.locator('#wayfinder-page-guide')).toBeAttached();
  await openHelper();
});

test('does not steal host-page focus during automatic onboarding', async () => {
  await page.goto(fixtureUrl);
  const branch = page.getByRole('button', { name: 'main' });
  await branch.focus();
  await page.waitForTimeout(1_300);
  await expect(branch).toBeFocused();
  await expect(page.getByRole('button', { name: 'Guide me' })).toBeVisible();
});

test('activates dark tokens while retaining reduced-motion behavior', async () => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await openHelper();
  const theme = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#wayfinder-page-guide')!;
    const shadow = host.shadowRoot!;
    return {
      scheme: getComputedStyle(host).colorScheme,
      panel: getComputedStyle(host).getPropertyValue('--wf-surface-panel').trim(),
      text: getComputedStyle(host).getPropertyValue('--wf-ink').trim(),
      bubbleTransition: getComputedStyle(shadow.querySelector('.wf-bubble')!).transitionDuration,
      spinnerAnimation: getComputedStyle(shadow.querySelector('.wf-body')!).animationName,
    };
  });
  expect(theme.scheme).toContain('dark');
  expect(theme.panel).toBe('#171512');
  expect(theme.text).toBe('#f4ead8');
  expect(theme.bubbleTransition).toBe('0s');
  expect(theme.spinnerAnimation).toBe('none');

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  const lightSurfaces = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#wayfinder-page-guide')!;
    return {
      input: getComputedStyle(host).getPropertyValue('--wf-surface-input').trim(),
      card: getComputedStyle(host).getPropertyValue('--wf-surface-card').trim(),
    };
  });
  expect(lightSurfaces.input).toBe('#fffef9');
  expect(lightSurfaces.card).toBe('rgba(255,255,255,.52)');
});
