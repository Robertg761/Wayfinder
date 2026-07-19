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
  const releaseAssets = `<a href="/${owner}/${repo}/releases/download/v1.0.0/Wayfinder-macos-arm64.dmg">Wayfinder-macos-arm64.dmg</a>
         <a href="/${owner}/${repo}/releases/download/v1.0.0/Wayfinder-macos-x64.dmg">Wayfinder-macos-x64.dmg</a>
         <a href="/${owner}/${repo}/releases/download/v1.0.0/Wayfinder-windows-x64.exe">Wayfinder-windows-x64.exe</a>
         <a href="/${owner}/${repo}/releases/download/v1.0.0/Wayfinder-linux-x86_64.AppImage">Wayfinder-linux-x86_64.AppImage</a>`;
  const olderReleaseAssets = `<a href="/${owner}/${repo}/releases/download/v0.9.0/Wayfinder-macos-universal.dmg">Wayfinder-macos-universal.dmg</a>`;
  const delayedReleaseAssets = repo === 'wayfinder-delayed-assets';
  const fileSurface = parsed.pathname.includes('/releases')
    ? `<section data-testid="release-card" style="margin-top: 1200px">
         <h2>Wayfinder v1.0.0</h2>
         <div id="release-assets">${delayedReleaseAssets ? '' : releaseAssets}</div>
       </section>
       <section data-testid="release-card"><h2>Wayfinder v0.9.0</h2>${olderReleaseAssets}</section>
       ${delayedReleaseAssets ? `<script>setTimeout(() => { document.querySelector('#release-assets').innerHTML = ${JSON.stringify(releaseAssets)}; }, 2600);</script>` : ''}`
    : parsed.pathname.includes('/blob/')
    ? `<nav aria-label="Breadcrumbs">${repo} / src / index.ts</nav>
       <div data-testid="code-viewer"><span data-line-number="1">1</span><pre>export const fixture = true;</pre></div>`
    : `<table aria-label="Folders and files"><tbody><tr><td>src</td></tr></tbody></table>
       <article id="readme" class="markdown-body"><h2>Fixture README</h2></article>
       <aside class="Layout-sidebar" style="margin-top: 900px"><a href="/${owner}/${repo}/releases">Releases</a></aside>`;
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
      { path: 'src/client.ts', type: 'blob' },
      { path: 'src/consumer.ts', type: 'blob' },
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
    runtimeEntryPoint: { path: 'src/index.ts', why: 'Primary runtime entry point.' },
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
      { order: 1, title: 'Install dependencies', command: 'pnpm install', evidence: { path: 'package.json', lines: [1, 12] }, confidence: 'documented' },
      { order: 2, title: 'Run the tests', command: 'pnpm test', evidence: { path: 'package.json', lines: [6, 10] }, confidence: 'documented' },
    ],
    warnings: [],
    generatedAt: '2026-07-15T12:00:00.000Z',
  };
}

function fileContextFor(map: ReturnType<typeof mapFor>, query: string, currentPath: string) {
  const documentation = /\.md$/i.test(currentPath);
  const focus = /if i change|change impact|implementation and verification/i.test(query)
    ? 'impact'
    : /paired with|find (?:its|the) tests?/i.test(query)
      ? 'tests'
      : /which files.*(?:import|call)|callers?|used by/i.test(query)
        ? 'callers'
        : /depend on|dependencies|read next/i.test(query)
          ? 'dependencies'
          : 'summary';
  const empty = (relationQuery: string, warnings: string[] = []) => ({
    repo: map.repo,
    sha: map.sha,
    query: relationQuery,
    currentPath,
    results: [],
    warnings,
    generatedAt: '2026-07-16T12:00:00.000Z',
  });
  const callers = !documentation && (focus === 'callers' || focus === 'impact')
    ? {
        ...empty('index import usage caller'),
        results: [{ path: 'src/consumer.ts', score: 0.9, confidence: 'strong', reason: 'The inspected import references index.', signals: ['content'], lines: [1, 3] }],
      }
    : empty('readme import usage caller');
  const tests = !documentation && (focus === 'tests' || focus === 'impact')
    ? {
        ...empty('index paired tests specs'),
        results: [{ path: 'tests/index.test.ts', score: 0.85, confidence: 'likely', reason: 'The filename directly matches index.', signals: ['filename', 'test-pair'], lines: [1, 4] }],
      }
    : empty('readme paired tests specs');
  const warnings = documentation && focus !== 'summary'
    ? ['Non-source files are not forced through the source caller/test graph.']
    : [];
  const summary = documentation
    ? focus === 'summary'
      ? 'README.md is the primary repository guide for “Wayfinder Fixture”.'
      : focus === 'callers'
        ? 'README.md is documentation, not an executable source module, so no source callers were claimed.'
        : focus === 'tests'
          ? 'README.md is documentation, so no source-test pairing was claimed.'
          : `Changing README.md affects the primary repository guide; Wayfinder did not invent source callers or paired tests for documentation.`
    : focus === 'summary'
      ? `${currentPath} is the source module for ${currentPath.split('/').at(-1)?.replace(/\.[^.]+$/, '')}. Its visible declarations include fixture.`
      : focus === 'dependencies'
        ? `${currentPath} references 1 import, with 1 resolved to an exact repository path.`
        : focus === 'callers'
          ? `${currentPath} has 1 caller candidate with target-specific evidence; the strongest is src/consumer.ts.`
          : focus === 'tests'
            ? `${currentPath} has 1 test candidate with target-specific evidence; the strongest is tests/index.test.ts.`
            : `For ${currentPath}, Wayfinder verified 1 local dependency, 1 caller candidate, and 1 paired test candidate.`;

  return {
    repo: map.repo,
    sha: map.sha,
    query,
    intent: 'file-context',
    mode: 'free',
    summary,
    explanation: documentation
      ? 'File type is part of the evidence boundary: documentation is not treated as an ordinary source module.'
      : 'Relationship results require target-specific evidence; structural guesses are discarded.',
    suggestions: [],
    generatedAt: '2026-07-16T12:00:00.000Z',
    currentPath,
    focus,
    fileKind: documentation ? 'documentation' : 'source',
    fileRole: documentation ? 'Primary repository guide' : 'Source entry or export surface',
    highlights: documentation ? ['Wayfinder Fixture', 'Install', 'Usage'] : ['fixture'],
    contentAvailable: true,
    imports: documentation ? [] : ['./client'],
    relatedPaths: documentation ? [] : ['src/client.ts'],
    callers,
    tests,
    warnings,
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
    const currentPath = typeof body?.currentPath === 'string' ? body.currentPath : null;
    api.requests.push({ path: '/agent', repo: map.repo, query });
    if (api.agentFailures > 0) {
      api.agentFailures -= 1;
      await route.fulfill({ status: 503, json: { code: 'upstream-unavailable', message: 'Fixture agent unavailable.' } }).catch(() => undefined);
      return;
    }
    const guide = developGuide(map);
    if (/how do i install it/i.test(query)) {
      await route.fulfill({ json: {
        repo: map.repo, sha: map.sha, query, intent: 'installation', mode: 'free',
        summary: 'I found one sourced setup step.', suggestions: [], evidencePaths: ['package.json'], generatedAt: '2026-07-15T12:00:00.000Z',
        guide: {
          ...guide,
          audience: 'use',
          steps: [{ ...guide.steps[1], title: 'Install the published package', command: 'npm install wayfinder-fixture', confidence: 'inferred' }],
          warnings: ['The package command was inferred from the root package name.'],
        },
      } });
      return;
    }
    if (/use this project/i.test(query)) {
      await route.fulfill({ json: {
        repo: map.repo, sha: map.sha, query, intent: 'installation', mode: 'free',
        summary: 'I found one consumer installation command.', suggestions: [], evidencePaths: ['package.json'], generatedAt: '2026-07-15T12:00:00.000Z',
        guide: { ...guide, audience: 'use', steps: [{ ...guide.steps[1], title: 'Install the published package', command: 'pnpm add wayfinder-fixture' }] },
      } });
      return;
    }
    if (currentPath) {
      await route.fulfill({ json: fileContextFor(map, query, currentPath) });
      return;
    }
    await route.fulfill({ json: {
      repo: map.repo, sha: map.sha, query, intent: 'orientation', mode: /ai provenance/i.test(query) ? 'gpt-5.6' : 'free',
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

test('keeps the close control clear of the compact experience switch', async () => {
  await page.goto(fixtureUrl);
  for (const mode of ['Guided', 'Quick'] as const) {
    await selectMode(mode);
    const closeBox = await page.getByRole('button', { name: 'Close helper' }).boundingBox();
    const modeBox = await page.getByRole('group', { name: 'Wayfinder experience mode' }).boundingBox();

    expect(closeBox).not.toBeNull();
    expect(modeBox).not.toBeNull();
    expect(closeBox!.x - (modeBox!.x + modeBox!.width)).toBeGreaterThanOrEqual(8);
  }
});

test('captures contribution intent before dispatch and supports keyboard dismissal', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await expect(page.getByRole('button', { name: 'Quick', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'What will my change affect?' }).click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('I want to change [feature]. Plan my contribution.');
  await page.keyboard.press('Escape');
  await expect.poll(activeShadowLabel).toBe('Open Wayfinder helper');
  await expect(composer).toBeHidden();
});

test('keeps editor keystrokes away from host-page shortcuts', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await expect(page.locator('html')).toHaveAttribute('data-wayfinder-keyboard-guard', 'ready');
  await page.evaluate(() => {
    document.addEventListener('keydown', (event) => {
      if (document.documentElement.dataset.wayfinderFirstKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const active = target?.shadowRoot?.activeElement;
      document.documentElement.dataset.wayfinderFirstKey = [
        target?.id ?? 'no-target',
        active?.nodeName ?? 'no-active',
        String(target?.isContentEditable ?? false),
      ].join(':');
    }, true);
    document.addEventListener('keydown', (event) => {
      // Mirror @github/hotkey's isFormField guard. Events from Wayfinder's
      // open shadow root are retargeted to the helper host at document.
      if (event.target instanceof HTMLElement) {
        const name = event.target.nodeName.toLowerCase();
        const type = event.target.getAttribute('type')?.toLowerCase() ?? '';
        const formField = name === 'select'
          || name === 'textarea'
          || (name === 'input' && !['submit', 'reset', 'checkbox', 'radio', 'file'].includes(type))
          || event.target.isContentEditable;
        if (formField) return;
      }
      if (!['g', 't', '?'].includes(event.key.toLowerCase())) return;
      document.body.dataset.hostShortcut = event.key;
      document.querySelector<HTMLElement>('[data-hotkey="w"]')?.focus();
    });
  });

  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.focus();
  await page.keyboard.type('test target?');

  await expect(page.locator('html')).toHaveAttribute('data-wayfinder-first-key', 'wayfinder-page-guide:TEXTAREA:true');
  await expect(page.locator('body')).not.toHaveAttribute('data-host-shortcut');
  await expect(composer).toHaveValue('test target?');
  await expect(composer).toBeFocused();
});

test('preserves an in-progress question across harmless Turbo refreshes', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.fill('Where is the parser built?');
  await composer.focus();

  await page.evaluate(() => document.dispatchEvent(new Event('turbo:load')));
  await page.waitForTimeout(1_300);

  await expect(composer).toHaveValue('Where is the parser built?');
  await expect(composer).toBeFocused();
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
  await expect(page.getByText('Repository name', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/example/wayfinder-fixture/blob/main/src/index.ts');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByRole('heading', { name: 'Getting this page into focus.' })).toBeVisible();
  await expect(page.getByText('Repository name', { exact: true })).toBeHidden();
});

test('recovers when GitHub renders landmarks after the first guided snapshot', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.evaluate(() => {
    document.querySelector('main')!.replaceChildren();
    history.pushState({}, '', '/example/late-render');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByRole('heading', { name: 'Getting this page into focus.' })).toBeVisible();

  await page.evaluate(() => {
    document.querySelector('main')!.innerHTML = `
      <h1><strong><a itemprop="name">example / late-render</a></strong></h1>
      <button data-hotkey="w">main</button>
      <table aria-label="Folders and files"><tbody><tr><td>src</td></tr></tbody></table>
      <article id="readme" class="markdown-body"><h2>Late README</h2></article>
    `;
  });

  await expect(page.getByRole('heading', { name: 'Learn this repository one landmark at a time.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show me around' })).toBeVisible();

  await page.evaluate(() => {
    document.querySelector('main')!.replaceChildren();
    history.pushState({}, '', '/example/late-render-while-closed');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByRole('heading', { name: 'Getting this page into focus.' })).toBeVisible();
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.evaluate(() => {
    document.querySelector('main')!.innerHTML = `
      <h1><strong><a itemprop="name">example / late-render-while-closed</a></strong></h1>
      <button data-hotkey="w">main</button>
      <table aria-label="Folders and files"><tbody><tr><td>src</td></tr></tbody></table>
    `;
  });
  await page.waitForTimeout(500);
  await openHelper();
  await expect(page.getByRole('heading', { name: 'Learn this repository one landmark at a time.' })).toBeVisible();
});

test('recovers the repository landmark after leaving and returning to a modern GitHub subpage', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Close helper' }).click();

  await page.evaluate(() => {
    history.pushState({}, '', '/settings/profile');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.locator('#wayfinder-page-guide')).toBeHidden();

  await page.evaluate(() => {
    document.querySelector('main')!.innerHTML = `
      <nav aria-label="Breadcrumbs">
        <a href="/example">example</a>
        <a href="/example/wayfinder-fixture">wayfinder-fixture</a>
      </nav>
      <h1>Releases: example/wayfinder-fixture</h1>
      <section data-testid="release-card"><h2>Wayfinder v1.0.0</h2></section>
    `;
    history.pushState({}, '', '/example/wayfinder-fixture/releases');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await page.waitForTimeout(1_300);

  await openHelper();
  await expect(page.getByRole('heading', { name: 'Learn this repository one landmark at a time.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Getting this page into focus.' })).toBeHidden();
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository name', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'example / wayfinder-fixture' })).toBeVisible();
});

test('finds guided landmarks outside the initial viewport', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await page.locator('main').evaluate((main) => { main.style.marginTop = '1500px'; });
  await page.waitForTimeout(1_300);

  await selectMode('Guided');
  await expect(page.getByRole('button', { name: 'Show me around' })).toBeVisible();
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository name', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('does not retain movement delays when reduced motion is requested', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Guided');
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(page.getByText('Repository name', { exact: true })).toBeVisible({ timeout: 700 });
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
  for (const label of [
    'What does this project do?',
    'How is this project organized?',
    'Where is a feature built?',
    'Where are the tests?',
    'How do I install or run it?',
    'What will my change affect?',
  ]) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Answer ready.');
  await expect(page.getByText('TypeScript, Node.js')).toBeVisible();
  await expect(page.getByText(`main at ${shaFor('example/wayfinder-fixture').slice(0, 12)}`)).toBeVisible();
  await expect(page.getByText('pnpm install · pnpm test')).toBeVisible();
});

test('describes AI output as synthesis while limiting verification to evidence links', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.fill('Show AI provenance');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('AI synthesis', { exact: true })).toBeVisible();
  await expect(page.getByText('Evidence links verified', { exact: true })).toBeVisible();
  await expect(page.getByText('Repository evidence verified', { exact: true })).toBeHidden();
});

test('asks whether setup means using or developing the project', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'How do I install or run it?' }).click();
  await expect(page.getByRole('heading', { name: 'How do you want to get started?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'I want to use or install it' })).toBeFocused();
  await page.getByRole('button', { name: 'I want to use or install it' }).click();
  await expect.poll(() => api.requests.findLast((request) => request.path === '/agent')?.query).toBe(
    'Help me install or use this project as a consumer or published application',
  );
  await expect(page.getByRole('button', { name: 'Copy command: pnpm add wayfinder-fixture' })).toBeVisible();
});

test('navigates to Releases, scrolls, and points at the current-platform download', async () => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Macintosh; arm64 Mac OS X) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    platform: 'MacIntel',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.fill('How do I install it?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start with GitHub Releases' })).toBeVisible();
  await expect(page.getByText('Step 1 of 2', { exact: true })).toBeVisible();
  await expect(page.getByText('npm install wayfinder-fixture', { exact: true })).toBeHidden();
  await expect(page).toHaveURL(fixtureUrl);
  await expect.poll(() => page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')?.shadowRoot;
    return shadow?.querySelector('.wf-highlight')?.classList.contains('visible') ?? false;
  })).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Open Releases' }).click();
  await expect(page).toHaveURL(`${fixtureUrl}/releases`);
  await expect(page.getByRole('heading', { name: 'Wayfinder-macos-arm64.dmg' })).toBeVisible();
  await expect(page.getByText('Step 2 of 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download this file' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')?.shadowRoot;
    return shadow?.querySelector('.wf-highlight')?.classList.contains('visible') ?? false;
  })).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
});

test('asks for the operating system when the browser cannot identify it, then highlights that asset', async () => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Wayfinder test browser', platform: 'Unknown' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.fill('How do I install it?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start with GitHub Releases' })).toBeVisible();
  await expect(page.getByText('I cannot tell which operating system you use yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Open Releases' }).click();
  await expect(page).toHaveURL(`${fixtureUrl}/releases`);
  await expect(page.getByRole('heading', { name: 'Which computer are you using?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /macOS/ })).toBeFocused();
  await page.getByRole('button', { name: /Windows —/ }).click();
  await expect(page.getByRole('heading', { name: 'Which processor does this computer use?' })).toBeVisible();
  await page.getByRole('button', { name: /x64 —/ }).click();
  await expect(page.getByRole('heading', { name: 'Wayfinder-windows-x64.exe' })).toBeVisible();
  await expect(page.getByText('Download this highlighted file for Windows.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')?.shadowRoot;
    return shadow?.querySelector('.wf-highlight')?.classList.contains('visible') ?? false;
  })).toBe(true);
});

test('waits for GitHub release assets that render after navigation before choosing a download', async () => {
  const delayedFixtureUrl = 'https://github.com/example/wayfinder-delayed-assets';
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    platform: 'MacIntel',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(delayedFixtureUrl);
  await selectMode('Quick');
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.fill('How do I install it?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('button', { name: 'Open Releases' }).click();
  await expect(page).toHaveURL(`${delayedFixtureUrl}/releases`);
  await expect(page.getByRole('heading', { name: 'Which processor does this computer use?' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Intel —/ }).click();
  await expect(page.getByRole('heading', { name: 'Wayfinder-macos-x64.dmg' })).toBeVisible();
  await expect(page.getByText('Step 2 of 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download this file' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wayfinder-macos-universal.dmg' })).toBeHidden();
});

test('keeps pending navigation guides isolated to the tab that created them', async () => {
  const releaseUrl = `${fixtureUrl}/releases`;
  await page.goto(fixtureUrl);
  await page.evaluate((href) => {
    sessionStorage.setItem('wayfinder:pending-guide:v1', JSON.stringify({
      repo: 'example/wayfinder-fixture',
      kind: 'releases',
      platform: 'macos',
      architecture: 'arm64',
      href,
      createdAt: new Date().toISOString(),
    }));
  }, releaseUrl);

  const second = await context.newPage();
  await second.route('https://github.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml(route.request().url()) });
  });
  await second.route(/^(?:http:\/\/localhost:8787|https:\/\/wayfinder-api\.hopit-robert\.workers\.dev)\//, handleApi);

  await Promise.all([page.goto(releaseUrl), second.goto(releaseUrl)]);
  await expect(page.getByRole('heading', { name: 'Wayfinder-macos-arm64.dmg' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Wayfinder-macos-arm64.dmg' })).toBeHidden();
  await second.close();
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
  await expect(page.getByRole('button', { name: 'What does this project do?' })).toBeVisible();
});

test('keeps the expanded agent surface reachable in a narrow viewport', async () => {
  await page.setViewportSize({ width: 360, height: 500 });
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  const state = await bubbleState();
  expect(state.maxHeight).toBeLessThanOrEqual(472);
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question for Wayfinder' })).toBeVisible();
  const responsiveLayout = await page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')!.shadowRoot!;
    return {
      questionColumns: getComputedStyle(shadow.querySelector('.wf-question-grid')!).gridTemplateColumns.split(' ').length,
      composerColumns: getComputedStyle(shadow.querySelector('.wf-composer')!).gridTemplateColumns.split(' ').length,
    };
  });
  expect(responsiveLayout).toEqual({ questionColumns: 1, composerColumns: 1 });
  await expect.poll(() => page.evaluate(() => {
    const shadow = document.querySelector('#wayfinder-page-guide')!.shadowRoot!;
    const active = shadow.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const bubble = shadow.querySelector('.wf-bubble')!.getBoundingClientRect();
    const focused = active.getBoundingClientRect();
    return focused.bottom > bubble.top + 8 && focused.top < bubble.bottom - 8;
  })).toBe(true);
});

test('shows a visible keyboard focus treatment on task and composer controls', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await expect(page.getByRole('button', { name: 'Quick', exact: true })).toBeFocused();
  const task = page.getByRole('button', { name: 'What does this project do?' });
  await page.keyboard.press('Tab');
  await expect(task).toBeFocused();
  const taskOutline = await task.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(taskOutline.style).not.toBe('none');
  expect(taskOutline.width).toBeGreaterThanOrEqual(2);

  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  for (let step = 0; step < 6; step += 1) await page.keyboard.press('Tab');
  await expect(composer).toBeFocused();
  const composerFocus = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineWidth: Number.parseFloat(style.outlineWidth),
      shadow: style.boxShadow,
    };
  });
  expect(composerFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(composerFocus.shadow).not.toBe('none');
});

test('keeps an open answer on screen while the viewport is resized', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
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
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.waitForTimeout(900);
  await openHelper();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
});

test('ignores stale repository responses after SPA navigation', async () => {
  api.mapDelayByRepo['alpha/one'] = 2_000;
  await page.goto('https://github.com/alpha/one');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  await page.evaluate(() => {
    history.pushState({}, '', '/beta/two');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await page.waitForTimeout(1_300);
  await openHelper();
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  await expect(page.getByText('beta/two orientation')).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByText('alpha/one orientation')).toBeHidden();
});

test('guards saved-trail restoration across repository navigation', async () => {
  await page.goto('https://github.com/alpha/one');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
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
  await expect(page.getByRole('button', { name: 'Continue my last task' })).toBeHidden();
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
  await expect(page.getByText('Repository name', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Repository name', { exact: true })).toBeVisible();
  await expect(page.getByText('In this project')).toBeHidden();
});

test('focuses and announces an agent error before allowing retry', async () => {
  api.agentFailures = 1;
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  await expect.poll(activeShadowLabel).toBe('Wayfinder helper');
  await expect(page.getByRole('status')).toContainText('Connection interrupted');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
});

test('keeps a saved answer paired with its original question after a later failure', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await page.getByRole('button', { name: '← New question' }).click();
  api.agentFailures = 1;
  const composer = page.getByRole('textbox', { name: 'Question for Wayfinder' });
  await composer.fill('This request should fail');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connection interrupted' })).toBeVisible();
  await page.getByRole('button', { name: 'New question' }).click();
  await page.getByRole('button', { name: 'Continue my last task' }).click();
  await expect(page.getByText('example/wayfinder-fixture orientation')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh ↻' }).click();
  await expect.poll(() => api.requests.filter((request) => request.path === '/agent').at(-1)?.query).toBe('Give me a 60-second overview of this repository');
});

test('persists answer depth with stateful controls and mode defaults', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  const concise = page.getByRole('button', { name: 'Concise', exact: true });
  const expanded = page.getByRole('button', { name: 'Expanded', exact: true });
  await expect(concise).toHaveAttribute('aria-pressed', 'true');
  await expanded.click();
  await expect(expanded).toHaveAttribute('aria-pressed', 'true');
  await expect(expanded).toBeFocused();
  await page.getByRole('button', { name: 'Close helper' }).click();
  await page.reload();
  await openHelper();
  await page.getByRole('button', { name: 'What does this project do?' }).click();
  await expect(page.getByRole('button', { name: 'Expanded', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Guided', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expanded', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Quick', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Concise', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('renders branch-pinned semantic evidence links with line fragments', async () => {
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
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
  await page.getByRole('button', { name: 'How do I install or run it?' }).click();
  await page.getByRole('button', { name: 'I want to use or install it' }).click();
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
  await page.getByRole('button', { name: 'How do I install or run it?' }).click();
  await page.getByRole('button', { name: 'I want to use or install it' }).click();
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
  await expect(page.getByText('Repository name', { exact: true })).toBeVisible();
  await expect(page.getByText('1 / 1')).toBeVisible();
  await expect(page.getByText('README', { exact: true })).toBeHidden();
  await expect(page.getByText('File tree', { exact: true })).toBeHidden();
});

test('treats tree routes as repository context rather than source files', async () => {
  await page.goto('https://github.com/example/wayfinder-fixture/tree/main/src');
  await selectMode('Quick');
  await expect(page.getByRole('heading', { name: 'Get the answer, then the evidence.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'What does this project do?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'What does this file do?' })).toBeHidden();
});

test('treats README as documentation and refuses invented source relationships', async () => {
  await page.goto('https://github.com/example/wayfinder-fixture/blob/main/README.md');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this file do?' }).click();
  await expect(page.getByText('README.md is the primary repository guide for “Wayfinder Fixture”.')).toBeVisible();
  await expect(page.getByText('documentation', { exact: true })).toBeVisible();
  await expect(page.getByText('Primary repository guide', { exact: true })).toBeVisible();
  await expect(page.getByText('Evidence-backed caller candidates')).toBeHidden();
  await expect(page.getByText('Direct imports')).toBeHidden();
  await expect(page.getByText('Pinned repository evidence')).toBeVisible();

  await page.getByRole('button', { name: /New question/ }).click();
  await page.getByRole('button', { name: 'What uses this file?' }).click();
  await expect(page.getByText('README.md is documentation, not an executable source module, so no source callers were claimed.')).toBeVisible();
  await expect(page.getByText('Evidence-backed caller candidates')).toBeVisible();
  await expect(page.getByText('No caller had enough target-specific evidence to claim a relationship.')).toBeVisible();
  await expect(page.getByText('Non-source files are not forced through the source caller/test graph.')).toBeVisible();
  await expect(page.getByText('babel.config.js', { exact: true })).toBeHidden();
});

test('renders only the evidence section requested by each source-file action', async () => {
  await page.goto('https://github.com/example/wayfinder-fixture/blob/main/src/index.ts');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this file use?' }).click();
  await expect(page.getByText('Direct imports')).toBeVisible();
  await expect(page.getByText('Resolved local dependencies')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open src/client.ts' })).toBeVisible();
  await expect(page.getByText('Evidence-backed caller candidates')).toBeHidden();
  await expect(page.getByText('Evidence-backed paired tests')).toBeHidden();

  await page.getByRole('button', { name: /New question/ }).click();
  await page.getByRole('button', { name: "Where are this file's tests?" }).click();
  await expect(page.getByText('Evidence-backed paired tests')).toBeVisible();
  await expect(page.getByText('tests/index.test.ts', { exact: true })).toBeVisible();
  await expect(page.getByText('Direct imports')).toBeHidden();
  await expect(page.getByText('Evidence-backed caller candidates')).toBeHidden();
});

test('replaces a previous file answer with the new file context after SPA navigation', async () => {
  await page.goto('https://github.com/example/wayfinder-fixture/blob/main/src/one.ts');
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this file do?' }).click();
  await expect(page.getByText('src/one.ts is the source module for one. Its visible declarations include fixture.')).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/example/wayfinder-fixture/blob/main/src/two.ts');
    document.dispatchEvent(new Event('turbo:load'));
  });
  await expect(page.getByText('Starting from src/two.ts.')).toBeVisible();
  await expect(page.getByText('src/one.ts is the source module for one. Its visible declarations include fixture.')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Continue my last task' })).toBeVisible();
});

test('keeps an in-flight request alive across a fragment-only navigation', async () => {
  api.mapDelayByRepo['example/wayfinder-fixture'] = 800;
  await page.goto(fixtureUrl);
  await selectMode('Quick');
  await page.getByRole('button', { name: 'What does this project do?' }).click();
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
  await page.evaluate(() => {
    document.body.style.minHeight = '3200px';
    window.scrollTo(0, 1800);
  });
  await expect.poll(() => page.getByRole('button', { name: 'feature/navigation' }).evaluate((button) => button.getBoundingClientRect().bottom)).toBeLessThan(0);
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
