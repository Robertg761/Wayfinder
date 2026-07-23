import { agentAnswerSchema, type AgentAnswer, type InstallStep, type RepoLocation, type RepoMap, type RepoTour } from '@wayfinder/contracts';
import {
  parseRepositoryBundle,
  requestAgentAnswer,
  requestErrorLabels,
  requestRepositoryMap,
  requestRepositoryTour,
  WayfinderRequestError,
  type RepositoryBundle,
} from '@/lib/api-client';
import {
  agentCacheTtl,
  agentResponseCacheKey,
  getCached,
  reconcileCacheIndex,
  repositoryCacheKey,
  repositoryCacheTtl,
  setCached,
  trailCacheKey,
  trailCacheTtl,
  type CacheStorage,
} from '@/lib/cache';
import { copyText } from '@/lib/copy-text';
import { helperStyles } from '@/lib/helper-styles';
import { parseGitHubUrl } from '@/lib/github-url';
import {
  agentStarters,
  detectArchitectureFamily,
  detectPlatformFamily,
  landmarkDetail,
  measuredBubbleHeight,
  placeBubble,
  preferredReleaseAsset,
  releaseArchitectureChoices,
  resolveAnswerDepth,
  type AnswerDepth,
  type ArchitectureFamily,
  type ExperienceMode,
  type PlatformFamily,
} from '@/lib/helper-ui';

interface WayfinderPreferences {
  mode: ExperienceMode | null;
  seenRepos: string[];
  answerDepth?: AnswerDepth;
}

interface SavedTrail {
  question: string;
  answer: AgentAnswer;
  savedAt: string;
}

const preferencesKey = 'wayfinder:preferences:v1';
const answerDepthKey = 'wayfinder:answer-depth:v1';
const pendingGuideKey = 'wayfinder:pending-guide:v1';

interface PendingGuide {
  repo: string;
  kind: 'file' | 'releases';
  path?: string;
  platform?: PlatformFamily;
  architecture?: ArchitectureFamily;
  href: string;
  createdAt: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!);
}

function fileUrl(map: RepoMap, path: string, lines?: [number, number]): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const fragment = lines ? `#L${lines[0]}-L${lines[1]}` : '';
  return `https://github.com/${map.repo}/blob/${map.sha}/${encodedPath}${fragment}`;
}

function releasesUrl(repo: string): string {
  return `https://github.com/${repo}/releases`;
}

type GuideStop = {
  label: string;
  title: string;
  explanation: string;
  target: Element;
  progressLabel?: string;
  primaryAction?: { action: string; label: string };
  secondaryAction?: { action: string; label: string };
};

function firstPresent(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const match = Array.from(document.querySelectorAll(selector)).find((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 8 && rect.height > 8
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity) > 0;
    });
    if (match) return match;
  }
  return null;
}

function findRepositoryIdentity(repo: string): HTMLAnchorElement | null {
  const expectedPath = `/${repo}`.replace(/\/$/, '').toLowerCase();
  const [owner = '', name = ''] = repo.split('/');
  const expectedLabels = new Set([
    name.toLowerCase(),
    `${owner}/${name}`.toLowerCase(),
    `${owner} / ${name}`.toLowerCase(),
  ]);
  const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((anchor) => {
    try {
      const path = new URL(anchor.href, window.location.href).pathname.replace(/\/$/, '').toLowerCase();
      if (path !== expectedPath) return false;
      const rect = anchor.getBoundingClientRect();
      const style = window.getComputedStyle(anchor);
      return rect.width > 8 && rect.height > 8
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity) > 0;
    } catch {
      return false;
    }
  });

  const score = (anchor: HTMLAnchorElement): number => {
    const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const accessibleLabel = (anchor.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    let value = expectedLabels.has(text) ? 80 : expectedLabels.has(accessibleLabel) ? 70 : 0;
    if (anchor.closest('nav[aria-label*="breadcrumb" i], [data-testid*="breadcrumb" i], [data-component*="breadcrumb" i]')) value += 50;
    if (anchor.closest('header, [role="banner"], nav')) value += 20;
    if (anchor.getAttribute('aria-current') === 'page') value += 10;
    if (anchor.closest('article, .markdown-body, [data-testid*="issue" i], [data-testid*="comment" i]')) value -= 120;
    return value;
  };

  const ranked = candidates
    .map((anchor) => ({ anchor, score: score(anchor) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.anchor ?? null;
}

function findReleasesLink(repo: string): HTMLAnchorElement | null {
  const expectedPath = `/${repo}/releases`.toLowerCase();
  const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((anchor) => {
    try {
      const path = new URL(anchor.href, window.location.href).pathname.replace(/\/$/, '').toLowerCase();
      if (path !== expectedPath) return false;
      const rect = anchor.getBoundingClientRect();
      const style = window.getComputedStyle(anchor);
      return rect.width > 8 && rect.height > 8 && style.display !== 'none' && style.visibility !== 'hidden';
    } catch {
      return false;
    }
  });

  const score = (anchor: HTMLAnchorElement): number => {
    const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    let value = text === 'releases' ? 50 : text.includes('release') ? 25 : 0;
    if (anchor.closest('aside, .Layout-sidebar, [data-testid*="sidebar"]')) value += 20;
    if (anchor.closest('#readme, .markdown-body')) value -= 30;
    return value;
  };

  return candidates.sort((left, right) => score(right) - score(left))[0] ?? null;
}

type ReleaseAssetLink = {
  name: string;
  href: string;
  anchor: HTMLAnchorElement;
};

function releaseAssetLinks(repo: string): ReleaseAssetLink[] {
  const latestReleaseCard = document.querySelector(
    '[data-testid="release-card"], [data-testid*="release-card"], section[aria-labelledby*="release" i], article[data-test-selector*="release" i]',
  );
  const releaseRoot: ParentNode = latestReleaseCard ?? document;
  // Only genuine GitHub release-asset URLs for this repository qualify. A
  // README or comment can contain look-alike links to any host; those must
  // never become a highlighted download stop.
  const expectedPathPrefix = `/${repo}/releases/download/`.toLowerCase();
  const links = Array.from(releaseRoot.querySelectorAll<HTMLAnchorElement>('a[href*="/releases/download/"]')).flatMap((anchor) => {
    let fileName = '';
    let releaseTag = '';
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.hostname !== 'github.com') return [];
      if (!url.pathname.toLowerCase().startsWith(expectedPathPrefix)) return [];
      const segments = url.pathname.split('/').filter(Boolean);
      fileName = decodeURIComponent(segments.at(-1) ?? '');
      const downloadIndex = segments.findIndex((segment, index) => segment === 'download' && segments[index - 1] === 'releases');
      releaseTag = downloadIndex >= 0 ? decodeURIComponent(segments[downloadIndex + 1] ?? '') : '';
    } catch {
      return [];
    }
    return [{
      name: fileName || anchor.textContent?.replace(/\s+/g, ' ').trim() || 'download',
      href: anchor.href,
      anchor,
      releaseTag,
    }];
  });
  // When GitHub has an explicit newest-release card, an empty list means that
  // card is still rendering or has no assets. Never fall through to an older
  // card merely because its links appeared first.
  if (latestReleaseCard) return links.map(({ releaseTag: _releaseTag, ...link }) => link);
  const latestTag = links.find((link) => link.releaseTag)?.releaseTag;
  return links
    .filter((link) => !latestTag || link.releaseTag === latestTag)
    .map(({ releaseTag: _releaseTag, ...link }) => link);
}

function commandCautionNote(step: Pick<InstallStep, 'caution'>): string {
  if (!step.caution) return '';
  const shape = step.caution === 'elevated-privileges'
    ? 'It requests elevated privileges'
    : step.caution === 'pipe-to-shell'
      ? 'It pipes downloaded content into a shell'
      : 'It downloads from outside GitHub';
  return `<span class="wf-command-note">${escapeHtml(`${shape} and comes from the repo's own README — review before running.`)}</span>`;
}

function platformName(platform: PlatformFamily): string {
  if (platform === 'macos') return 'macOS';
  if (platform === 'windows') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return 'your operating system';
}

function runtimeEntryPointPath(tour: RepoTour): string | null {
  return tour.runtimeEntryPoint?.path
    ?? tour.entryPoints.find((entry) => !/(^|\/)(readme[^/]*\.md|package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i.test(entry.path))?.path
    ?? null;
}

function visibleBranchRef(): string | null {
  const element = firstPresent([
    'button[data-hotkey="w"] span[data-component="text"]',
    'button[data-hotkey="w"]',
    'summary[title*="Switch branches"] span',
  ]);
  return element?.textContent?.trim().split(/\s*\n\s*/)[0] || null;
}

function guideStops(knownRefs: Array<string | null | undefined> = []): GuideStop[] {
  const location = parseGitHubUrl(window.location.href, visibleBranchRef(), knownRefs);
  if (!location) return [];

  const candidates: Array<Omit<GuideStop, 'target'> & { selectors: string[] }> = location.view === 'blob'
    ? [
        {
          label: 'File breadcrumb',
          title: 'See where this file lives',
          explanation: 'This breadcrumb is your trail back through the repository. Each segment opens a wider part of the project.',
          selectors: ['nav[aria-label="Breadcrumbs"]', '[data-testid="breadcrumbs"]', '.react-code-file-contents + nav'],
        },
        {
          label: 'Source file',
          title: 'Read the shape before the details',
          explanation: 'This is the file Wayfinder brought you to. Scan exports, types, and top-level functions first, then follow the line markers.',
          selectors: ['[data-testid="code-viewer"]', '.react-code-file-contents', 'table.highlight'],
        },
        {
          label: 'Line numbers',
          title: 'Every line is a shareable reference',
          explanation: 'Click a line number to pin it in the URL. Wayfinder uses these same coordinates when it cites evidence.',
          selectors: ['[data-line-number]', '.blob-num', 'td[id^="L"]'],
        },
      ]
    : [
        {
          label: 'Repository name',
          title: `${location.owner} / ${location.repo}`,
          explanation: 'This is the project boundary. Wayfinder reads the public tree inside it and keeps every answer tied to this repository.',
          selectors: ['[itemprop="name"]', 'strong[itemprop="name"]', 'h1 strong a'],
        },
        {
          label: 'Current branch',
          title: 'Choose the version you are reading',
          explanation: 'The branch controls which version of every file you see. Start on the default branch unless an issue points somewhere else.',
          selectors: ['button[data-hotkey="w"]', 'summary[title*="Switch branches"]'],
        },
        {
          label: 'File tree',
          title: 'Folders reveal the project shape',
          explanation: 'Folders reveal the architecture. Start with field notes and package files, then follow source and tests as a pair.',
          selectors: ['table[aria-labelledby="folders-and-files"]', 'table[aria-label="Folders and files"]', 'div[role="grid"]'],
        },
        {
          label: 'README',
          title: 'Begin with the README',
          explanation: 'This is the project narrative: what it does, how to install it, and the vocabulary you will see in the code.',
          selectors: ['#readme', '[data-testid="readme"]', 'article.markdown-body'],
        },
      ];

  const scopedCandidates = location.view === 'other'
    ? candidates.filter((candidate) => candidate.label === 'Repository name')
    : candidates;

  return scopedCandidates.flatMap(({ selectors, ...stop }) => {
    // A tour target does not need to start inside the viewport. The guide moves
    // to each target with scrollIntoView, so excluding off-screen landmarks can
    // incorrectly make a fully rendered repository look empty.
    const target = location.view === 'other' && stop.label === 'Repository name'
      ? findRepositoryIdentity(`${location.owner}/${location.repo}`) ?? firstPresent(selectors)
      : firstPresent(selectors);
    return target ? [{ ...stop, target }] : [];
  });
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let scheduled = false;
    let forceScheduled = false;
    let publishTimer = 0;
    let navigationGeneration = 0;
    let stops: GuideStop[] = [];
    let activeStep = -1;
    let bubbleOpen = false;
    let welcomeShown = false;
    let movementTimer = 0;
    let arrivalTimer = 0;
    let dockSettleTimer = 0;
    let landmarkRefreshTimer = 0;
    let landmarkRefreshAttempts = 0;
    let viewportFrame = 0;
    let renderGeneration = 0;
    let announcementGeneration = 0;
    let tourMoving = false;
    let surface: 'welcome' | 'tour' | 'agent' | 'context' | 'complete' = 'welcome';
    let currentLocation: RepoLocation | null = null;
    let repository: RepositoryBundle | null = null;
    // Refs Wayfinder has already resolved for this repository; they let the
    // URL parser split slash-containing branch names correctly when the
    // visible branch control has not rendered yet.
    const knownRepositoryRefs = (): Array<string | null | undefined> => [
      repository?.map.requestedRef,
      repository?.map.resolvedRef,
      repository?.map.defaultBranch,
      repository?.map.sha,
    ];
    let activeQuestion = '';
    let repositoryCachedAt: string | null = null;
    let answerCachedAt: string | null = null;
    let repositoryCacheState: 'fresh' | 'cached' | 'stale' = 'fresh';
    let experienceMode: ExperienceMode | null = null;
    let answerDepth: AnswerDepth = 'concise';
    let preferencesLoaded = false;
    let preferencesDirty = false;
    let preferenceWrite = Promise.resolve();
    let seenRepos: string[] = [];
    let activeAnswer: AgentAnswer | null = null;
    let pendingGuide: PendingGuide | null = null;
    let installPlatform: PlatformFamily = 'unknown';
    let installArchitecture: ArchitectureFamily = 'unknown';
    let beginReleaseInstallGuide = (): boolean => false;
    type OperationKind = 'agent' | 'guided' | 'restore';
    type Operation = {
      kind: OperationKind;
      controller: AbortController;
      location: RepoLocation;
    };
    const activeOperations = new Map<OperationKind, Operation>();
    const requestSignal = (operation: Operation, timeoutMs = 30_000): AbortSignal =>
      AbortSignal.any([operation.controller.signal, AbortSignal.timeout(timeoutMs)]);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const storage = browser.storage.local as unknown as CacheStorage;

    const loadPreferences = async () => {
      if (preferencesLoaded) return;
      const values: Record<string, unknown> = await storage.get([preferencesKey, answerDepthKey]).catch(() => ({}));
      const stored = values[preferencesKey] as Partial<WayfinderPreferences> | undefined;
      const separateDepth = values[answerDepthKey];
      const storedDepth = separateDepth === 'concise' || separateDepth === 'expanded' ? separateDepth : stored?.answerDepth;
      if (!preferencesDirty) {
        experienceMode = stored?.mode === 'guided' || stored?.mode === 'quick' ? stored.mode : null;
        answerDepth = resolveAnswerDepth(storedDepth, experienceMode);
      }
      const storedRepos = Array.isArray(stored?.seenRepos) ? stored.seenRepos.filter((repo): repo is string => typeof repo === 'string') : [];
      seenRepos = [...new Set([...seenRepos, ...storedRepos])].slice(0, 100);
      preferencesLoaded = true;
      if (experienceMode) host.dataset.mode = experienceMode;
    };

    const savePreferences = (changes: Partial<WayfinderPreferences> = {}) => {
      preferencesDirty = true;
      if (experienceMode) host.dataset.mode = experienceMode;
      if (changes.mode !== undefined || changes.answerDepth !== undefined) {
        const nextDepth = changes.answerDepth ?? answerDepth;
        return storage.set({
          [preferencesKey]: {
            mode: changes.mode === undefined ? experienceMode : changes.mode,
            answerDepth: nextDepth,
            seenRepos: changes.seenRepos ?? seenRepos,
          } satisfies WayfinderPreferences,
          [answerDepthKey]: nextDepth,
        }).catch(() => undefined);
      }
      preferenceWrite = preferenceWrite.catch(() => undefined).then(async () => {
        const values: Record<string, unknown> = await storage.get([preferencesKey, answerDepthKey]).catch(() => ({}));
        const stored = values[preferencesKey] as Partial<WayfinderPreferences> | undefined;
        const storedMode = stored?.mode === 'guided' || stored?.mode === 'quick' ? stored.mode : experienceMode;
        const separateDepth = values[answerDepthKey];
        const storedDepth = separateDepth === 'concise' || separateDepth === 'expanded'
          ? separateDepth
          : resolveAnswerDepth(stored?.answerDepth, storedMode);
        const storedRepos = Array.isArray(stored?.seenRepos) ? stored.seenRepos.filter((repo): repo is string => typeof repo === 'string') : [];
        const nextRepos = [...new Set([...(changes.seenRepos ?? seenRepos), ...storedRepos])].slice(0, 100);
        await storage.set({
          [preferencesKey]: { mode: storedMode, answerDepth: storedDepth, seenRepos: nextRepos } satisfies WayfinderPreferences,
        }).catch(() => undefined);
      });
      return preferenceWrite;
    };

    const rememberRepo = (persist = true) => {
      if (!currentLocation) return;
      const repo = `${currentLocation.owner}/${currentLocation.repo}`.toLowerCase();
      seenRepos = [repo, ...seenRepos.filter((candidate) => candidate !== repo)].slice(0, 100);
      host.dataset.seen = 'true';
      if (persist) void savePreferences({ seenRepos });
    };

    // Trails live in the shared LRU cache index, so saving a trail evicts the
    // oldest entries instead of accumulating one orphaned key per repository.
    const saveTrail = async () => {
      if (!activeAnswer) return;
      const trail: SavedTrail = {
        question: activeQuestion,
        answer: activeAnswer,
        savedAt: new Date().toISOString(),
      };
      await setCached(storage, trailCacheKey(activeAnswer.repo), activeAnswer.repo.toLowerCase(), 'trail', trail, trailCacheTtl)
        .catch(() => undefined);
    };

    const loadTrail = async (repo: string): Promise<SavedTrail | null> => {
      const cached = await getCached<SavedTrail>(storage, trailCacheKey(repo)).catch(() => null);
      const stored = cached?.value;
      if (!stored?.answer || stored.answer.repo.toLowerCase() !== repo.toLowerCase()) return null;
      return stored;
    };

    const savePendingGuide = async (guide: PendingGuide) => {
      pendingGuide = guide;
      try {
        window.sessionStorage.setItem(pendingGuideKey, JSON.stringify(guide));
      } catch {
        // The in-memory copy still supports same-document GitHub navigation.
      }
    };

    const readPendingGuide = async (): Promise<PendingGuide | null> => {
      let stored: PendingGuide | null = null;
      try {
        const serialized = window.sessionStorage.getItem(pendingGuideKey);
        stored = serialized ? JSON.parse(serialized) as PendingGuide : null;
      } catch {
        stored = null;
      }
      if (!stored?.repo || !stored.href || !stored.createdAt || (stored.kind !== 'file' && stored.kind !== 'releases')) return null;
      if (Date.now() - Date.parse(stored.createdAt) > 5 * 60_000) {
        try { window.sessionStorage.removeItem(pendingGuideKey); } catch { /* Session storage may be unavailable. */ }
        return null;
      }
      return stored;
    };

    const clearPendingGuide = async () => {
      pendingGuide = null;
      try { window.sessionStorage.removeItem(pendingGuideKey); } catch { /* Session storage may be unavailable. */ }
    };

    const host = document.createElement('div');
    host.id = 'wayfinder-page-guide';
    host.setAttribute('data-wayfinder', 'page-guide');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${helperStyles}</style>
      <div class="wf-layer">
        <div class="wf-highlight" aria-hidden="true"></div>
        <div class="wf-dock">
          <button class="wf-helper" type="button" aria-label="Open Wayfinder helper" title="Wayfinder">
            <span class="wf-body"><span class="wf-face"></span><span class="wf-needle"></span></span>
            <span class="wf-feet"></span>
            <span class="wf-ping"></span>
          </button>
          <aside class="wf-bubble" role="dialog" aria-modal="false" aria-label="Wayfinder helper" tabindex="-1">
            <button class="wf-close" type="button" aria-label="Close helper">×</button>
            <div class="wf-copy"></div>
            <div class="wf-status wf-sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
          </aside>
        </div>
      </div>
    `;

    const dock = shadow.querySelector<HTMLDivElement>('.wf-dock')!;
    const helper = shadow.querySelector<HTMLButtonElement>('.wf-helper')!;
    const highlight = shadow.querySelector<HTMLDivElement>('.wf-highlight')!;
    const bubble = shadow.querySelector<HTMLElement>('.wf-bubble')!;
    const copy = shadow.querySelector<HTMLDivElement>('.wf-copy')!;
    const status = shadow.querySelector<HTMLDivElement>('.wf-status')!;
    const close = shadow.querySelector<HTMLButtonElement>('.wf-close')!;
    const openStateObserver = new MutationObserver(() => {
      const open = bubble.classList.contains('open');
      helper.setAttribute('aria-expanded', String(open));
      helper.setAttribute('aria-label', open ? 'Close Wayfinder helper' : 'Open Wayfinder helper');
    });
    helper.setAttribute('aria-expanded', 'false');
    openStateObserver.observe(bubble, { attributes: true, attributeFilter: ['class'] });

    const sameLocation = (left: RepoLocation | null, right: RepoLocation | null) => left === right || Boolean(left && right
      && left.owner === right.owner
      && left.repo === right.repo
      && left.ref === right.ref
      && left.path === right.path
      && left.view === right.view);

    const startOperation = (kind: OperationKind): Operation => {
      if (!currentLocation) throw new WayfinderRequestError('Open a public GitHub repository before asking Wayfinder.', 'repository-unavailable');
      abortOperations();
      const operation: Operation = {
        kind,
        controller: new AbortController(),
        location: { ...currentLocation },
      };
      activeOperations.set(kind, operation);
      return operation;
    };

    const operationIsCurrent = (operation: Operation) => activeOperations.get(operation.kind) === operation
      && !operation.controller.signal.aborted
      && sameLocation(currentLocation, operation.location);

    const assertOperationCurrent = (operation: Operation) => {
      if (!operationIsCurrent(operation)) throw new DOMException('The operation was superseded.', 'AbortError');
    };

    const finishOperation = (operation: Operation) => {
      if (activeOperations.get(operation.kind) === operation) activeOperations.delete(operation.kind);
    };

    const abortOperations = () => {
      for (const operation of activeOperations.values()) operation.controller.abort();
      activeOperations.clear();
    };

    const setBubblePosition = () => {
      const dockRect = dock.getBoundingClientRect();
      const agentSurface = bubble.classList.contains('agent');
      const width = Math.min(agentSurface ? 430 : 326, window.innerWidth - 28);
      const designCap = agentSurface ? 610 : 430;
      const height = measuredBubbleHeight(
        bubble.getBoundingClientRect().height,
        bubble.scrollHeight,
        window.innerHeight,
        designCap,
      );
      const placement = placeBubble(dockRect, width, height, window.innerWidth, window.innerHeight);
      bubble.dataset.side = placement.side;
      bubble.style.left = `${placement.left}px`;
      bubble.style.top = `${placement.top}px`;
      bubble.style.maxHeight = `${placement.maxHeight}px`;
    };

    const announce = (message: string) => {
      if (host.hidden || !bubbleOpen || !bubble.classList.contains('open')) return;
      const generation = ++announcementGeneration;
      status.textContent = '';
      window.requestAnimationFrame(() => {
        if (generation !== announcementGeneration || host.hidden || !bubbleOpen) return;
        status.textContent = message;
      });
    };

    type CommitBubbleOptions = {
      resetScroll?: boolean;
      focus?: 'dialog' | string | null;
      announce?: string;
      open?: boolean;
    };

    const commitBubbleView = (markup: string, options: CommitBubbleOptions = {}) => {
      const generation = ++renderGeneration;
      announcementGeneration += 1;
      copy.innerHTML = markup;
      copy.querySelector<HTMLElement>('.wf-kicker')?.classList.add('wf-top-kicker');
      status.textContent = '';
      if (options.open !== false) {
        bubbleOpen = true;
        bubble.classList.add('open');
      }
      if (options.resetScroll !== false) bubble.scrollTop = 0;
      window.requestAnimationFrame(() => {
        if (generation !== renderGeneration || !copy.isConnected || host.hidden) return;
        setBubblePosition();
        if (options.announce) announce(options.announce);
        if (options.open === false || options.focus === null) return;
        const focusTarget = options.focus === 'dialog' || !options.focus
          ? bubble
          : shadow.querySelector<HTMLElement>(options.focus);
        const focusAndReveal = () => {
          if (!focusTarget?.isConnected || generation !== renderGeneration || host.hidden || !bubbleOpen) return;
          const active = shadow.activeElement;
          if (active && active !== focusTarget && active !== bubble && bubble.contains(active)) {
            // The user reached another control before this deferred focus ran.
            // Respect that newer intent instead of stealing focus back to the
            // control selected by an older render.
            return;
          }
          focusTarget.focus({ preventScroll: true });
          if (focusTarget === bubble) return;
          const targetRect = focusTarget.getBoundingClientRect();
          const bubbleRect = bubble.getBoundingClientRect();
          if (targetRect.top < bubbleRect.top) bubble.scrollTop -= bubbleRect.top - targetRect.top + 8;
          else if (targetRect.bottom > bubbleRect.bottom) bubble.scrollTop += targetRect.bottom - bubbleRect.bottom + 8;
        };
        focusAndReveal();
        window.setTimeout(() => {
          if (shadow.activeElement !== focusTarget) focusAndReveal();
        }, 0);
      });
    };

    const settleDock = () => {
      window.clearTimeout(dockSettleTimer);
      dock.classList.add('settled');
      dock.style.left = '';
      dock.style.top = '';
      dockSettleTimer = window.setTimeout(() => dock.classList.remove('settled'), 1_250);
    };

    const cancelTourMotion = (settle = true) => {
      const shouldSettle = settle && (tourMoving || Boolean(dock.style.left) || Boolean(dock.style.top));
      window.clearTimeout(movementTimer);
      window.clearTimeout(arrivalTimer);
      movementTimer = 0;
      arrivalTimer = 0;
      if (tourMoving) window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: 'auto' });
      tourMoving = false;
      highlight.classList.remove('visible');
      helper.classList.add('stationed');
      if (shouldSettle) settleDock();
    };

    const dismissHelper = () => {
      const guided = activeOperations.get('guided');
      const restore = activeOperations.get('restore');
      const hadTourOperation = Boolean(guided || restore);
      guided?.controller.abort();
      restore?.controller.abort();
      activeOperations.delete('guided');
      activeOperations.delete('restore');
      renderGeneration += 1;
      announcementGeneration += 1;
      cancelTourMotion();
      bubbleOpen = false;
      bubble.classList.remove('open');
      status.textContent = '';
      if (surface === 'tour' || surface === 'context' || hadTourOperation) {
        activeStep = -1;
        surface = 'welcome';
        copy.replaceChildren();
      }
      window.requestAnimationFrame(() => {
        if (host.isConnected) helper.focus({ preventScroll: true });
      });
    };

    const modeSwitch = () => experienceMode ? `
      <div class="wf-mode-switch" role="group" aria-label="Wayfinder experience mode">
        <button type="button" data-mode="guided" class="${experienceMode === 'guided' ? 'active' : ''}" aria-pressed="${experienceMode === 'guided'}">Guided</button>
        <button type="button" data-mode="quick" class="${experienceMode === 'quick' ? 'active' : ''}" aria-pressed="${experienceMode === 'quick'}">Quick</button>
      </div>
    ` : '';

    const depthSwitch = () => `
      <div class="wf-detail-toggle" role="group" aria-label="Answer detail">
        <button type="button" data-depth="concise" class="${answerDepth === 'concise' ? 'active' : ''}" aria-pressed="${answerDepth === 'concise'}">Concise</button>
        <button type="button" data-depth="expanded" class="${answerDepth === 'expanded' ? 'active' : ''}" aria-pressed="${answerDepth === 'expanded'}">Expanded</button>
      </div>
    `;

    const contextActions = (currentPath: string | null): Array<[string, string | null]> => {
      if (currentPath) {
        return [
          ['What does this file do?', `Summarize the role of ${currentPath} and its important public surface`],
          ['What uses this file?', `Which files likely import or call ${currentPath}?`],
          ["Where are this file's tests?", `Find the tests paired with ${currentPath}`],
          ['What does this file use?', `What does ${currentPath} depend on and where should I read next?`],
          ['What could this change affect?', `If I change ${currentPath}, what implementation and verification files should I inspect?`],
        ];
      }
      return experienceMode === 'quick'
        ? [
            ['What does this project do?', 'Give me a 60-second overview of this repository'],
            ['How is this project organized?', 'Give me an architecture tour of this repository'],
            ['Where is a feature built?', 'Find the primary implementation for [feature]'],
            ['Where are the tests?', 'Where are the tests for [feature]?'],
            ['How do I install or run it?', null],
            ['What will my change affect?', 'I want to change [feature]. Plan my contribution.'],
          ]
        : agentStarters.map((starter) => [starter.label, starter.question] as [string, string]);
    };

    const renderAgentHome = (prefill = '', focus: string | null = '#wf-question') => {
      const currentPath = currentLocation?.view === 'blob' ? currentLocation.path : null;
      surface = 'agent';
      activeStep = -1;
      activeOperations.get('guided')?.controller.abort();
      cancelTourMotion();
      helper.classList.add('stationed');
      bubble.classList.add('agent');
      const actions = contextActions(currentPath ?? null);
      const boundary = currentLocation?.view === 'other'
        ? '<div class="wf-boundary">This GitHub page is not a source path. I will use repository-level evidence and will not treat the issue or pull request number as a folder.</div>'
        : '';
      const trailAction = activeAnswer
        ? '<div class="wf-actions"><button type="button" data-action="back-to-trail">Continue my last task</button></div>'
        : '';
      commitBubbleView(`
        <div class="wf-agent-home">
          <div class="wf-agent-head">
            <div class="wf-kicker"><span>${experienceMode === 'quick' ? 'Quick map' : 'Ask Wayfinder'}</span>${modeSwitch()}</div>
            <h2>${currentPath ? 'What do you need from this file?' : experienceMode === 'quick' ? 'Get the answer, then the evidence.' : 'What are you trying to do?'}</h2>
            <p>${currentPath ? `Starting from ${escapeHtml(currentPath)}.` : experienceMode === 'quick' ? 'Compact repository intelligence with branch-pinned evidence.' : 'I will explain the repository one useful step at a time.'}</p>
          </div>
          ${boundary}
          <div class="wf-question-grid">
            ${actions.map(([label, question]) => question === null
              ? `<button type="button" data-action="setup-choice">${escapeHtml(label)}</button>`
              : `<button type="button" ${question.includes('[feature]') ? 'data-prefill' : 'data-question'}="${escapeHtml(question)}">${escapeHtml(label)}</button>`).join('')}
          </div>
          ${trailAction}
          <form class="wf-composer">
            <label class="wf-sr-only" for="wf-question">Question for Wayfinder</label>
            <textarea id="wf-question" name="question" minlength="2" required placeholder="${currentPath ? `Ask about ${escapeHtml(currentPath)}` : 'Ask about this repository'}">${escapeHtml(prefill)}</textarea>
            <button type="submit">Ask</button>
          </form>
          <p class="wf-tip">Shortcut: Alt + Shift + W</p>
        </div>
      `, { focus });
    };

    const renderLoading = (question: string, settle = true) => {
      surface = 'agent';
      activeStep = -1;
      cancelTourMotion(settle);
      helper.classList.add('stationed');
      bubble.classList.add('agent');
      commitBubbleView(`
        <div class="wf-loading">
          <div class="wf-loading-mark" aria-hidden="true"></div>
          <div><div class="wf-kicker"><span>Survey in progress</span><span class="wf-step-count">Live repository</span></div><h2>Reading the terrain</h2><p>${escapeHtml(question)}</p></div>
        </div>
      `, { focus: 'dialog', announce: 'Reading repository evidence.' });
    };

    const renderSetupChoice = () => {
      surface = 'agent';
      helper.classList.add('stationed');
      bubble.classList.add('agent');
      commitBubbleView(`
        <div class="wf-agent-home">
          <div class="wf-agent-head">
            <div class="wf-kicker"><span>Setup intent</span>${modeSwitch()}</div>
            <h2>How do you want to get started?</h2>
            <p>Using or installing the project needs different steps from working on its code.</p>
          </div>
          <div class="wf-question-grid">
            <button type="button" data-question="Help me install or use this project as a consumer or published application">I want to use or install it</button>
            <button type="button" data-question="Help me develop this repository locally">I want to work on the code</button>
          </div>
          <div class="wf-actions"><button type="button" data-action="agent-home">Back</button></div>
        </div>
      `, { focus: '[data-question="Help me install or use this project as a consumer or published application"]' });
    };

    const ensureRepository = async (operation: Operation, forceRefresh = false): Promise<RepositoryBundle> => {
      assertOperationCurrent(operation);
      const location = operation.location;
      const expectedRepo = `${location.owner}/${location.repo}`.toLowerCase();
      const matchesCapturedLocation = (bundle: RepositoryBundle) => bundle.map.repo.toLowerCase() === expectedRepo
        && bundle.tour.repo.toLowerCase() === expectedRepo
        && bundle.tour.sha === bundle.map.sha
        && (!location.ref
          || bundle.map.requestedRef === location.ref
          || bundle.map.resolvedRef === location.ref
          || bundle.map.sha === location.ref);
      if (repository && !forceRefresh && matchesCapturedLocation(repository)) return repository;

      const key = repositoryCacheKey(location.owner, location.repo, location.ref);
      const cachedEntry = await getCached<unknown>(storage, key).catch(() => null);
      assertOperationCurrent(operation);
      const staleEntry = cachedEntry ?? await getCached<unknown>(storage, key, Date.now(), true).catch(() => null);
      assertOperationCurrent(operation);
      const cachedBundle = cachedEntry ? parseRepositoryBundle(cachedEntry.value) : null;
      const stale = staleEntry
        ? (() => {
            const bundle = parseRepositoryBundle(staleEntry.value);
            return bundle ? { value: bundle, cachedAt: staleEntry.cachedAt } : null;
          })()
        : null;
      if (cachedBundle && !forceRefresh && matchesCapturedLocation(cachedBundle)) {
        repository = cachedBundle;
        repositoryCachedAt = cachedEntry?.cachedAt ?? null;
        repositoryCacheState = 'cached';
        return repository;
      }

      try {
        const map = await requestRepositoryMap(location, requestSignal(operation));
        assertOperationCurrent(operation);
        const tour = await requestRepositoryTour(map, requestSignal(operation));
        assertOperationCurrent(operation);
        const bundle = { map, tour };
        if (!matchesCapturedLocation(bundle)) {
          throw new WayfinderRequestError('Wayfinder received repository evidence for a different project or revision.', 'request-failed');
        }
        await setCached(storage, key, map.repo, 'repository', bundle, repositoryCacheTtl).catch(() => undefined);
        assertOperationCurrent(operation);
        repository = bundle;
        repositoryCachedAt = new Date().toISOString();
        repositoryCacheState = 'fresh';
        return bundle;
      } catch (error) {
        if (!operationIsCurrent(operation)) throw error;
        if (stale && matchesCapturedLocation(stale.value)) {
          repository = stale.value;
          repositoryCachedAt = stale.cachedAt;
          repositoryCacheState = 'stale';
          return repository;
        }
        if (error instanceof WayfinderRequestError) throw error;
        throw new WayfinderRequestError('Wayfinder cannot reach the repository service. Check your connection and try again.', 'upstream-unavailable');
      }
    };

    const cacheNote = () => {
      if (answerCachedAt) return `<p class="wf-cache-note">Cached answer from ${escapeHtml(new Date(answerCachedAt).toLocaleString())}</p>`;
      if (repositoryCacheState === 'fresh' || !repositoryCachedAt) return '<p class="wf-cache-note">Fresh repository evidence</p>';
      const label = repositoryCacheState === 'stale' ? 'Offline repository cache from' : 'Cached repository evidence from';
      return `<p class="wf-cache-note">${label} ${escapeHtml(new Date(repositoryCachedAt).toLocaleString())}</p>`;
    };

    const pathLink = (path: string, label = path, lines?: [number, number]) => {
      if (!repository) return '';
      const range = lines ? `, lines ${lines[0]} through ${lines[1]}` : '';
      const accessibleName = `Open ${path}${range}`;
      return `<a class="wf-open" data-guide-kind="file" data-guide-path="${escapeHtml(path)}" href="${escapeHtml(fileUrl(repository.map, path, lines))}" aria-label="${escapeHtml(accessibleName)}">${escapeHtml(label)} ↗</a>`;
    };

    const repositorySnapshot = (bundle: RepositoryBundle, guide?: Extract<AgentAnswer, { intent: 'orientation' }>['guide']) => {
      const { map, tour } = bundle;
      const rootFiles = new Set(map.setupFiles.filter((path) => !path.includes('/')).map((path) => path.toLowerCase()));
      const packageManager = rootFiles.has('pnpm-lock.yaml') ? 'pnpm'
        : rootFiles.has('yarn.lock') ? 'yarn'
          : rootFiles.has('bun.lock') || rootFiles.has('bun.lockb') ? 'bun'
            : rootFiles.has('package-lock.json') ? 'npm'
              : rootFiles.has('uv.lock') ? 'uv'
                : rootFiles.has('poetry.lock') ? 'poetry'
                  : rootFiles.has('package.json') ? 'Node package manager' : 'Not detected';
      const directories = map.tree
        .filter((entry) => entry.type === 'tree' && !entry.path.includes('/'))
        .map((entry) => entry.path)
        .sort((left, right) => {
          const priority = (path: string) => /^(src|app|lib|packages?)$/i.test(path) ? 0 : /^(test|tests|__tests__)$/i.test(path) ? 1 : /^(docs?|examples?)$/i.test(path) ? 2 : 3;
          return priority(left) - priority(right) || left.localeCompare(right);
        })
        .slice(0, 6);
      const entryPoint = runtimeEntryPointPath(tour) ?? 'Not confidently detected';
      const commands = guide ? [...guide.steps]
        .sort((left, right) => {
          const priority = (title: string) => /\binstall\b/i.test(title) ? 0 : /start/i.test(title) ? 1 : /test/i.test(title) ? 2 : /build/i.test(title) ? 3 : 4;
          return priority(left.title) - priority(right.title) || left.order - right.order;
        })
        .slice(0, 4)
        .map((step) => step.command) : [];
      return `
        <div class="wf-snapshot">
          <div class="wf-fact wide"><span>Purpose</span><strong>${escapeHtml(tour.summary)}</strong></div>
          <div class="wf-fact"><span>Stack</span><strong>${escapeHtml(tour.stack.join(', ') || map.language || 'Not detected')}</strong></div>
          <div class="wf-fact"><span>Package manager</span><strong>${escapeHtml(packageManager)}</strong></div>
          <div class="wf-fact wide"><span>Viewed version</span><strong>${escapeHtml(map.resolvedRef)} at ${escapeHtml(map.sha.slice(0, 12))}</strong></div>
          <div class="wf-fact wide"><span>Key directories</span><strong>${escapeHtml(directories.join(', ') || 'Repository root')}</strong></div>
          <div class="wf-fact wide"><span>Likely entry point</span><strong>${escapeHtml(entryPoint)}</strong>${entryPoint !== 'Not confidently detected' ? pathLink(entryPoint, 'Open entry point') : ''}</div>
          <div class="wf-fact wide"><span>Local workflow</span><strong>${escapeHtml(commands.join(' · ') || 'No trustworthy setup commands found')}</strong></div>
        </div>
      `;
    };

    const renderAnswer = (answer: AgentAnswer, focus: 'dialog' | string | null = 'dialog') => {
      const bundle = repository;
      if (!bundle) return;
      surface = 'agent';
      const shouldSaveTrail = activeAnswer !== answer || activeQuestion !== answer.query;
      activeAnswer = answer;
      activeQuestion = answer.query;
      if (shouldSaveTrail) void saveTrail();
      const sections: string[] = [];
      const consumerReleaseFlow = answer.intent === 'installation'
        && answer.guide.audience === 'use'
        && !answer.guide.steps.some((step) => step.confidence === 'documented');
      const displayedSummary = consumerReleaseFlow
        ? 'No documented consumer install command was found. Check the latest GitHub Release for a packaged download before attempting source setup.'
        : answer.summary;

      if (answer.brief?.length) {
        sections.push(`<ol class="wf-brief">${answer.brief.map((step, index) => `<li><strong>${String(index + 1).padStart(2, '0')} ${escapeHtml(step.title)}</strong><p>${escapeHtml(step.action)}</p>${step.evidencePath ? pathLink(step.evidencePath) : ''}</li>`).join('')}</ol>`);
      }

      if (answer.intent === 'orientation') {
        sections.push(repositorySnapshot(bundle, answer.guide));
        sections.push(`<details class="wf-detail" ${experienceMode === 'guided' ? 'open' : ''}><summary>Recommended reading route</summary><ol class="wf-route-list">${answer.tour.stops.slice(0, 5).map((stop) => `<li><strong>${String(stop.order).padStart(2, '0')} ${escapeHtml(stop.path)}</strong><p>${escapeHtml(stop.explanation)}</p>${pathLink(stop.path, 'Open file', stop.lines)}</li>`).join('')}</ol></details>`);
      }

      if (answer.intent === 'installation') {
        if (consumerReleaseFlow) {
          installPlatform = detectPlatformFamily(navigator.userAgent, navigator.platform);
          installArchitecture = detectArchitectureFamily(navigator.userAgent, navigator.platform);
        }
        const platformHint = installPlatform === 'unknown'
          ? 'I cannot reliably tell which operating system this browser is using, so I will ask on the Releases page.'
          : `This looks like ${platformName(installPlatform)}, so I will point to the matching download.`;
        const releaseRoute = consumerReleaseFlow
          ? `<div class="wf-result"><strong>Check the latest release</strong><p>A packaged download may be available in GitHub Releases. If the latest release has no compatible installer, return to the repository's source setup instructions. ${escapeHtml(platformHint)}</p><button class="primary" type="button" data-action="open-releases">Check Releases</button></div>`
          : '';
        const meta = consumerReleaseFlow ? '' : `<div class="wf-answer-mode"><span>${escapeHtml(answer.guide.packageManager ?? 'Package manager not detected')}</span><span>${escapeHtml(answer.guide.runtimes.join(', ') || 'Runtime not specified')}</span></div>`;
        const prerequisites = answer.guide.prerequisites.length
          ? `<ol class="wf-route-list">${answer.guide.prerequisites.map((item) => `<li><strong>Prerequisite</strong><p>${escapeHtml(item.text)}</p><span class="wf-confidence">${escapeHtml(item.confidence)}</span>${pathLink(item.evidence.path, item.evidence.path, item.evidence.lines)}</li>`).join('')}</ol>`
          : '';
        const steps = (consumerReleaseFlow ? [] : answer.guide.steps).map((step) => `<li><strong>${String(step.order).padStart(2, '0')} ${escapeHtml(step.title)}</strong><span class="wf-confidence">${escapeHtml(step.confidence)}</span><button type="button" class="wf-copy-command" data-command="${escapeHtml(step.command)}" aria-label="Copy command: ${escapeHtml(step.command)}">${escapeHtml(step.command)}</button>${commandCautionNote(step)}${pathLink(step.evidence.path, step.evidence.path, step.evidence.lines)}</li>`).join('');
        const warnings = !consumerReleaseFlow && answer.guide.warnings.length ? `<ul class="wf-warning-list">${answer.guide.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : '';
        const commandRoute = consumerReleaseFlow ? '' : `<ol class="wf-route-list">${steps || '<li><p>No trustworthy package command was found.</p></li>'}</ol>`;
        sections.push(`${releaseRoute}${meta}${warnings}${consumerReleaseFlow ? '' : prerequisites}${commandRoute}`);
      }

      if (answer.intent === 'file-find') {
        sections.push(`<div class="wf-result-list">${answer.finder.results.slice(0, 6).map((result) => `<article class="wf-result"><strong>${escapeHtml(result.path)}</strong><span class="wf-confidence">${escapeHtml(result.confidence)} match</span><p>${escapeHtml(result.reason)}</p><div class="wf-signal-list">${result.signals.map((signal) => `<span class="wf-signal">${escapeHtml(signal.replaceAll('-', ' '))}</span>`).join('')}</div>${result.snippet ? `<p class="wf-detail"><code>${escapeHtml(result.snippet)}</code></p>` : ''}${pathLink(result.path, 'Open coordinate', result.lines)}</article>`).join('') || '<div class="wf-error"><p>No credible coordinate was found. Try a filename, symbol, or narrower feature description.</p></div>'}</div>`);
      }

      if (answer.intent === 'file-context') {
        const identity = `<div class="wf-snapshot"><div class="wf-fact wide"><span>Current file</span><strong>${escapeHtml(answer.currentPath)}</strong></div><div class="wf-fact"><span>File type</span><strong>${escapeHtml(answer.fileKind)}</strong></div><div class="wf-fact"><span>Role</span><strong>${escapeHtml(answer.fileRole)}</strong></div></div>`;
        const highlights = answer.highlights.length
          ? `<div><div class="wf-kicker"><span>${answer.fileKind === 'documentation' ? 'Visible outline' : answer.fileKind === 'test' ? 'Visible test surface' : 'Visible declarations'}</span></div><ol class="wf-route-list">${answer.highlights.map((highlight) => `<li><strong>${escapeHtml(highlight)}</strong></li>`).join('')}</ol></div>`
          : '<div class="wf-boundary">No headings or declarations were confidently extracted from the inspected file.</div>';
        const imports = answer.imports.length
          ? `<div class="wf-fact wide"><span>Direct imports</span><strong>${answer.imports.map(escapeHtml).join(' · ')}</strong></div>`
          : '<div class="wf-fact wide"><span>Direct imports</span><strong>No supported imports were extracted</strong></div>';
        const related = answer.relatedPaths.length
          ? `<ol class="wf-route-list">${answer.relatedPaths.map((path) => `<li><strong>${escapeHtml(path)}</strong>${pathLink(path, 'Open dependency')}</li>`).join('')}</ol>`
          : '<div class="wf-boundary">No exact local dependency path was resolved. External package imports may point outside the repository.</div>';
        const tests = answer.tests.results.slice(0, 4).map((result) => `<article class="wf-result"><strong>${escapeHtml(result.path)}</strong><span class="wf-confidence">${escapeHtml(result.confidence)} match</span><p>${escapeHtml(result.reason)}</p>${pathLink(result.path, 'Open test', result.lines)}</article>`).join('');
        const callers = answer.callers.results.slice(0, 4).map((result) => `<article class="wf-result"><strong>${escapeHtml(result.path)}</strong><span class="wf-confidence">${escapeHtml(result.confidence)} match</span><p>${escapeHtml(result.reason)}</p>${pathLink(result.path, 'Open likely caller', result.lines)}</article>`).join('');
        const dependencySection = `<div class="wf-snapshot">${imports}</div><div><div class="wf-kicker"><span>Resolved local dependencies</span></div>${related}</div>`;
        const callerSection = `<div><div class="wf-kicker"><span>Evidence-backed caller candidates</span></div><div class="wf-result-list">${callers || '<div class="wf-boundary">No caller had enough target-specific evidence to claim a relationship.</div>'}</div></div>`;
        const testSection = `<div><div class="wf-kicker"><span>Evidence-backed paired tests</span></div><div class="wf-result-list">${tests || '<div class="wf-boundary">No test had enough target-specific evidence to claim a pairing.</div>'}</div></div>`;
        const warnings = answer.warnings.length
          ? `<ul class="wf-warning-list">${answer.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
          : '';
        const focused = answer.focus === 'summary'
          ? `${identity}${highlights}`
          : answer.focus === 'dependencies'
            ? `${identity}${dependencySection}`
            : answer.focus === 'callers'
              ? `${identity}${callerSection}`
              : answer.focus === 'tests'
                ? `${identity}${testSection}`
                : `${identity}${dependencySection}${callerSection}${testSection}`;
        sections.push(`${warnings}${focused}`);
      }

      if (answer.intent === 'contribution' && !answer.brief?.length) {
        const setup = answer.trail.guide.steps.slice(0, 2).map((step) => `<button type="button" class="wf-copy-command" data-command="${escapeHtml(step.command)}" aria-label="Copy command: ${escapeHtml(step.command)}">${escapeHtml(step.command)}</button>${commandCautionNote(step)}`).join('');
        const implementation = answer.trail.implementation.results[0];
        const verification = answer.trail.verification.results[0];
        sections.push(`<ol class="wf-route-list"><li><strong>01 Establish a baseline</strong>${setup || '<p>Review the field notes before changing the repository.</p>'}</li><li><strong>02 Open the likely implementation</strong><p>${escapeHtml(implementation?.reason ?? 'No strong implementation coordinate was found.')}</p>${implementation ? pathLink(implementation.path, implementation.path, implementation.lines) : ''}</li><li><strong>03 Follow the verification path</strong><p>${escapeHtml(verification?.reason ?? 'No related verification coordinate was found.')}</p>${verification ? pathLink(verification.path, verification.path, verification.lines) : ''}</li></ol>`);
      }

      const evidence = !consumerReleaseFlow && answer.evidencePaths?.length
        ? `<div class="wf-evidence">${answer.evidencePaths.map((path) => pathLink(path)).join('')}</div>`
        : '';
      const followups = answer.suggestions.length
        ? `<div class="wf-followups">${answer.suggestions.map((suggestion) => `<button type="button" data-question="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`).join('')}</div>`
        : '';
      const refWarning = bundle.map.requestedRef && bundle.map.requestedRef !== bundle.map.resolvedRef
        ? `<ul class="wf-warning-list"><li>You opened ${escapeHtml(bundle.map.requestedRef)}, but the repository map resolved ${escapeHtml(bundle.map.resolvedRef)}. Verify the branch before acting on this answer.</li></ul>`
        : '';
      const provenance = answer.mode === 'model'
        ? ['AI synthesis', 'Evidence links verified']
        : ['Pinned repository evidence', `${bundle.map.resolvedRef} · ${bundle.map.sha.slice(0, 8)}`];

      bubble.classList.add('agent');
      commitBubbleView(`
        <div class="wf-answer ${answerDepth === 'concise' ? 'concise' : ''}">
          <div class="wf-answer-nav"><button type="button" data-action="agent-home">← New question</button>${modeSwitch()}</div>
          <div class="wf-kicker"><span>${escapeHtml(answer.intent.replace('-', ' '))}</span><span class="wf-step-count">${escapeHtml(bundle.map.repo)}</span></div>
          <div class="wf-answer-mode ${answer.mode === 'model' ? 'model' : ''}"><span>${escapeHtml(provenance[0])}</span><span>${escapeHtml(provenance[1])}</span></div>
          ${refWarning}
          ${cacheNote()}
          <h2 class="wf-sr-only">Wayfinder trail report</h2>
          <p class="wf-answer-summary">${escapeHtml(displayedSummary)}</p>
          ${answer.explanation ? `<p class="wf-answer-explanation">${escapeHtml(answer.explanation)}</p>` : ''}
          ${sections.join('')}
          ${evidence}
          ${followups}
          <div class="wf-answer-nav">${depthSwitch()}<button type="button" data-action="refresh-answer">Refresh ↻</button></div>
        </div>
      `, { focus, resetScroll: true, announce: 'Answer ready.', open: bubbleOpen });
      if (consumerReleaseFlow) {
        queueMicrotask(() => {
          if (activeAnswer === answer && currentLocation && bubbleOpen) beginReleaseInstallGuide();
        });
      }
    };

    const renderAgentError = (error: WayfinderRequestError) => {
      surface = 'agent';
      const [title, recovery] = requestErrorLabels(error);
      commitBubbleView(`<div class="wf-answer"><div class="wf-kicker"><span>Trail interrupted</span><span class="wf-step-count">${escapeHtml(error.code.replaceAll('-', ' '))}</span></div><h2>${escapeHtml(title)}</h2><div class="wf-error"><p>${escapeHtml(error.message)}</p><p>${escapeHtml(recovery)}</p></div><div class="wf-actions"><button class="primary" type="button" data-action="retry-answer">Try again</button><button type="button" data-action="agent-home">New question</button></div></div>`, {
        focus: 'dialog',
        announce: `${title}. ${recovery}`,
        open: bubbleOpen,
      });
    };

    const askAgent = async (question: string, forceRefresh = false) => {
      const trimmed = question.trim();
      if (trimmed.length < 2) return;
      let operation: Operation;
      try {
        operation = startOperation('agent');
      } catch (error) {
        renderAgentError(error instanceof WayfinderRequestError
          ? error
          : new WayfinderRequestError('The guide could not complete that dispatch.', 'repository-unavailable'));
        return;
      }
      activeQuestion = trimmed;
      answerCachedAt = null;
      renderLoading(trimmed);
      let fallbackAnswer: { value: AgentAnswer; cachedAt: string; expiresAt: string } | null = null;
      try {
        const bundle = await ensureRepository(operation, forceRefresh);
        assertOperationCurrent(operation);
        const key = agentResponseCacheKey(bundle.map.repo, bundle.map.sha, trimmed, operation.location.view === 'blob' ? operation.location.path ?? null : null);
        const fallbackEntry = await getCached<unknown>(storage, key, Date.now(), true).catch(() => null);
        assertOperationCurrent(operation);
        if (fallbackEntry) {
          const parsedFallback = agentAnswerSchema.safeParse(fallbackEntry.value);
          fallbackAnswer = parsedFallback.success
            ? { value: parsedFallback.data, cachedAt: fallbackEntry.cachedAt, expiresAt: fallbackEntry.expiresAt }
            : null;
        }
        if (!forceRefresh) {
          const cached = fallbackAnswer && Date.parse(fallbackAnswer.expiresAt) > Date.now() ? fallbackAnswer : null;
          if (cached && cached.value.repo === bundle.map.repo && cached.value.sha === bundle.map.sha) {
            answerCachedAt = cached.cachedAt;
            renderAnswer(cached.value);
            return;
          }
        }
        const answer = await requestAgentAnswer(
          bundle.map,
          trimmed,
          operation.location.view === 'blob' ? operation.location.path ?? null : null,
          requestSignal(operation),
        );
        assertOperationCurrent(operation);
        if (answer.repo !== bundle.map.repo || answer.sha !== bundle.map.sha) {
          throw new WayfinderRequestError('Wayfinder received an answer for a different repository revision.', 'request-failed');
        }
        await setCached(storage, key, bundle.map.repo, 'agent', answer, agentCacheTtl).catch(() => undefined);
        assertOperationCurrent(operation);
        answerCachedAt = null;
        renderAnswer(answer);
      } catch (error) {
        if (!operationIsCurrent(operation)) return;
        if (fallbackAnswer
          && fallbackAnswer.value.repo.toLowerCase() === `${operation.location.owner}/${operation.location.repo}`.toLowerCase()
          && repository?.map.sha === fallbackAnswer.value.sha) {
          answerCachedAt = fallbackAnswer.cachedAt;
          renderAnswer(fallbackAnswer.value);
          return;
        }
        renderAgentError(error instanceof WayfinderRequestError
          ? error
          : new WayfinderRequestError('The guide could not complete that dispatch.', 'upstream-unavailable'));
      } finally {
        finishOperation(operation);
      }
    };

    const renderWelcome = (focus?: string | null) => {
      surface = 'welcome';
      bubble.classList.remove('agent');
      if (!experienceMode) {
        commitBubbleView(`
          <div class="wf-kicker"><span>Wayfinder</span><span class="wf-step-count">Choose your pace</span></div>
          <h2>How should I help?</h2>
          <p>Choose a guided explanation or a compact project map. You can switch anytime.</p>
          <div class="wf-actions">
            <button class="primary" type="button" data-action="choose-guided">Guide me</button>
            <button type="button" data-action="choose-quick">Quick map</button>
          </div>
          <p class="wf-tip">Guided explains GitHub as you go. Quick stays quiet and leads with the answer.</p>
        `, { focus: focus === undefined ? '[data-action="choose-guided"]' : focus });
        return;
      }
      if (experienceMode === 'quick') {
        renderAgentHome('', focus === undefined ? '#wf-question' : focus);
        return;
      }
      if (stops.length === 0) {
        commitBubbleView(`
          <div class="wf-kicker"><span>Wayfinder on the page</span><span class="wf-step-count">Finding landmarks</span></div>
          <h2>Getting this page into focus.</h2>
          <p>GitHub has not exposed a tour stop yet. I will keep watching as the page finishes rendering, and you can still ask about the repository now.</p>
          <div class="wf-actions">
            <button class="primary" type="button" data-action="refresh-landmarks">Look again</button>
            <button type="button" data-action="agent-home">Ask about this repository</button>
          </div>
        `, { focus: focus === undefined ? '[data-action="refresh-landmarks"]' : focus });
        return;
      }
      commitBubbleView(`
        <div class="wf-kicker"><span>Guided mode</span>${modeSwitch()}</div>
        <h2>Learn this repository one landmark at a time.</h2>
        <p>I will move only when pointing something out, explain the GitHub term, and connect it to a fact about this project.</p>
        <div class="wf-actions">
          <button class="primary" type="button" data-action="start">Show me around</button>
          <button type="button" data-action="agent-home">Ask a question</button>
        </div>
        <p class="wf-tip">Click me anytime or press Alt + Shift + W.</p>
      `, { focus: focus === undefined ? '[data-action="start"]' : focus });
    };

    const scheduleLandmarkRefresh = () => {
      window.clearTimeout(landmarkRefreshTimer);
      if (!currentLocation || stops.length > 0 || landmarkRefreshAttempts >= 20) return;
      const expectedGeneration = navigationGeneration;
      const expectedUrl = window.location.href;
      landmarkRefreshTimer = window.setTimeout(() => {
        landmarkRefreshTimer = 0;
        if (expectedGeneration !== navigationGeneration || expectedUrl !== window.location.href || !currentLocation) return;
        landmarkRefreshAttempts += 1;
        const refreshedStops = guideStops(knownRepositoryRefs());
        if (refreshedStops.length > 0) {
          stops = refreshedStops;
          landmarkRefreshAttempts = 0;
          if (bubbleOpen && surface === 'welcome') renderWelcome(null);
          return;
        }
        scheduleLandmarkRefresh();
      }, 400);
    };

    const projectFact = (stop: GuideStop): string | null => {
      if (!repository) return null;
      const { map, tour } = repository;
      if (stop.label === 'Repository name') return map.description || tour.summary;
      if (stop.label === 'Current branch') return `${map.resolvedRef} is the version Wayfinder mapped at commit ${map.sha.slice(0, 12)}. The default branch is ${map.defaultBranch}.`;
      if (stop.label === 'File tree') return `Detected stack: ${tour.stack.join(', ') || map.language || 'not confidently detected'}. Likely entry point: ${runtimeEntryPointPath(tour) ?? 'not confidently detected'}.`;
      if (stop.label === 'README') return tour.summary;
      if (currentLocation?.view === 'blob' && currentLocation.path) return `Current file: ${currentLocation.path}. Wayfinder will use it as the starting context for questions.`;
      return null;
    };

    const renderStep = () => {
      const stop = stops[activeStep];
      if (!stop) return;
      surface = 'tour';
      bubble.classList.remove('agent');
      const fact = projectFact(stop);
      const primaryAction = stop.primaryAction
        ? `<button class="primary" type="button" data-action="${escapeHtml(stop.primaryAction.action)}">${escapeHtml(stop.primaryAction.label)}</button>`
        : `<button class="primary" type="button" data-action="next">${activeStep === stops.length - 1 ? 'Finish tour' : 'Next landmark'}</button>`;
      const secondaryAction = stop.secondaryAction
        ? `<button type="button" data-action="${escapeHtml(stop.secondaryAction.action)}">${escapeHtml(stop.secondaryAction.label)}</button>`
        : '<button type="button" data-action="ask-highlight">Explain this</button>';
      commitBubbleView(`
        <div class="wf-kicker"><span>${stop.label}</span><span class="wf-step-count">${escapeHtml(stop.progressLabel ?? `${activeStep + 1} / ${stops.length}`)}</span></div>
        <h2>${escapeHtml(stop.title)}</h2>
        <p>${escapeHtml(stop.explanation)}</p>
        ${fact ? `<div class="wf-project-fact"><strong>In this project</strong><p>${escapeHtml(fact)}</p></div>` : ''}
        <div class="wf-actions">
          ${!stop.primaryAction && activeStep > 0 ? '<button type="button" data-action="previous">Back</button>' : ''}
          ${primaryAction}
          ${secondaryAction}
        </div>
      `, { focus: `[data-action="${stop.primaryAction?.action ?? 'next'}"]`, announce: `${stop.label}. ${stop.progressLabel ?? `Landmark ${activeStep + 1} of ${stops.length}`}.` });
    };

    const renderHighlightedAnswer = (stop: GuideStop) => {
      surface = 'context';
      tourMoving = false;
      helper.classList.add('stationed');
      const excerpt = (stop.target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
      bubble.classList.remove('agent');
      commitBubbleView(`
        <div class="wf-answer">
          <div class="wf-kicker"><span>About this landmark</span><span class="wf-step-count">${escapeHtml(stop.label)}</span></div>
          <h2>${escapeHtml(stop.title)}</h2>
          <p class="wf-answer-summary">${escapeHtml(stop.explanation)}</p>
          <p class="wf-answer-explanation">${escapeHtml(landmarkDetail(stop.label))}</p>
          ${excerpt ? `<div class="wf-result"><strong>What is highlighted</strong><p>${escapeHtml(excerpt)}</p></div>` : ''}
          <div class="wf-actions">
            <button class="primary" type="button" data-action="context-followup">Ask a follow-up</button>
            <button type="button" data-action="next">Continue tour</button>
          </div>
        </div>
      `, { focus: '[data-action="context-followup"]' });
    };

    const positionAtActiveStop = () => {
      const stop = stops[activeStep];
      if (!stop || !document.contains(stop.target)) return;
      const rect = stop.target.getBoundingClientRect();
      const helperX = rect.right + 16 + 56 < window.innerWidth ? rect.right + 16 : Math.max(14, rect.left - 70);
      const helperY = Math.max(14, Math.min(window.innerHeight - 78, rect.top + Math.min(18, rect.height / 3)));
      dock.style.left = `${helperX}px`;
      dock.style.top = `${helperY}px`;
      highlight.style.left = `${Math.max(4, rect.left - 5)}px`;
      highlight.style.top = `${Math.max(4, rect.top - 5)}px`;
      highlight.style.width = `${Math.min(window.innerWidth - Math.max(4, rect.left - 5) - 4, rect.width + 10)}px`;
      highlight.style.height = `${Math.min(window.innerHeight - Math.max(4, rect.top - 5) - 4, rect.height + 10)}px`;
      highlight.classList.add('visible');
    };

    const revealActiveStop = () => {
      positionAtActiveStop();
      renderStep();
    };

    const moveToActiveStop = () => {
      const stop = stops[activeStep];
      if (!stop || !document.contains(stop.target)) return;
      tourMoving = true;
      surface = 'tour';
      renderGeneration += 1;
      helper.classList.remove('stationed');
      bubbleOpen = false;
      bubble.classList.remove('open', 'agent');
      highlight.classList.remove('visible');
      stop.target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
      window.clearTimeout(movementTimer);
      window.clearTimeout(arrivalTimer);
      if (reducedMotion.matches) {
        tourMoving = false;
        revealActiveStop();
        return;
      }
      movementTimer = window.setTimeout(() => {
        positionAtActiveStop();
        arrivalTimer = window.setTimeout(() => {
          tourMoving = false;
          revealActiveStop();
        }, 1_220);
      }, 850);
    };

    const renderPlatformChoice = (message = 'I cannot reliably identify this computer from the browser. Choose the operating system you use, and I will point to the right file.') => {
      surface = 'context';
      activeStep = -1;
      cancelTourMotion(false);
      helper.classList.add('stationed');
      bubble.classList.add('agent');
      commitBubbleView(`
        <div class="wf-agent-home">
          <div class="wf-agent-head">
            <div class="wf-kicker"><span>Installation</span><span class="wf-step-count">Step 2 of 2</span></div>
            <h2>Which computer are you using?</h2>
            <p>${escapeHtml(message)}</p>
          </div>
          <div class="wf-question-grid" role="group" aria-label="Choose your operating system">
            <button type="button" data-platform="macos">macOS — MacBook, iMac, or Mac mini</button>
            <button type="button" data-platform="windows">Windows — Windows laptop or desktop</button>
            <button type="button" data-platform="linux">Linux — Ubuntu, Fedora, and others</button>
          </div>
          <p class="wf-tip">Wayfinder will never choose a source-code archive as the beginner download.</p>
        </div>
      `, { focus: '[data-platform="macos"]', announce: 'Choose macOS, Windows, or Linux.' });
    };

    const renderArchitectureChoice = (platform: Exclude<PlatformFamily, 'unknown'>) => {
      installPlatform = platform;
      surface = 'context';
      activeStep = -1;
      cancelTourMotion(false);
      helper.classList.add('stationed');
      bubble.classList.add('agent');
      const armLabel = platform === 'macos' ? 'Apple silicon — M1, M2, M3, M4, or newer' : 'ARM64 — ARM-based computer';
      const x64Label = platform === 'macos' ? 'Intel — Intel-based Mac' : 'x64 — Intel or AMD computer';
      commitBubbleView(`
        <div class="wf-agent-home">
          <div class="wf-agent-head">
            <div class="wf-kicker"><span>Installation</span><span class="wf-step-count">Step 2 of 2</span></div>
            <h2>Which processor does this computer use?</h2>
            <p>The latest release has separate ${escapeHtml(platformName(platform))} installers, and the browser does not expose a trustworthy architecture signal.</p>
          </div>
          <div class="wf-question-grid" role="group" aria-label="Choose your processor architecture">
            <button type="button" data-architecture="arm64">${escapeHtml(armLabel)}</button>
            <button type="button" data-architecture="x64">${escapeHtml(x64Label)}</button>
          </div>
          <p class="wf-tip">Wayfinder will only highlight an installer from the latest release and the architecture you choose.</p>
        </div>
      `, { focus: '[data-architecture="arm64"]', announce: 'Choose ARM64 or x64 architecture.' });
    };

    const guideToReleaseAsset = (
      platform: Exclude<PlatformFamily, 'unknown'>,
      showFallback = true,
      architecture?: ArchitectureFamily,
    ): boolean => {
      if (!currentLocation) return false;
      installPlatform = platform;
      installArchitecture = architecture ?? detectArchitectureFamily(navigator.userAgent, navigator.platform);
      const assets = releaseAssetLinks(`${currentLocation.owner}/${currentLocation.repo}`);
      let recommendation = preferredReleaseAsset(assets, platform, navigator.userAgent, installArchitecture);
      // An explicit Apple-silicon pick with no arm64 or universal build is
      // not a dead end: the Intel installer runs through Rosetta 2.
      let rosettaFallback = false;
      if (!recommendation && platform === 'macos' && installArchitecture === 'arm64') {
        recommendation = preferredReleaseAsset(assets, platform, navigator.userAgent, 'x64');
        rosettaFallback = Boolean(recommendation);
      }
      const target = recommendation
        ? assets.find((asset) => asset.href === recommendation.href)?.anchor ?? null
        : null;
      if (!recommendation || !target) {
        if (showFallback) {
          bubbleOpen = true;
          const architectureChoices = releaseArchitectureChoices(assets, platform);
          if (installArchitecture === 'unknown' && architectureChoices.length > 0) renderArchitectureChoice(platform);
          else renderPlatformChoice(`I could not find a compatible ${platformName(platform)} installer in the latest visible release. Choose another operating system, or return to the repository's source setup instructions.`);
        }
        return false;
      }

      stops = [{
        label: 'Installation',
        progressLabel: 'Step 2 of 2',
        title: recommendation.name,
        explanation: rosettaFallback
          ? 'The latest release has no Apple-silicon build, so this is the Intel (x64) installer. Modern Macs run it automatically through Rosetta 2.'
          : `Download this highlighted file for ${platformName(platform)}. It is a packaged app, not the source-code archive.`,
        target,
        primaryAction: { action: 'download-release', label: 'Download this file' },
        secondaryAction: { action: 'choose-platform', label: 'Different OS' },
      }];
      activeStep = 0;
      bubbleOpen = true;
      moveToActiveStop();
      return true;
    };

    beginReleaseInstallGuide = (): boolean => {
      if (!currentLocation) return false;
      const repo = `${currentLocation.owner}/${currentLocation.repo}`;
      const href = releasesUrl(repo);
      const releasePath = new URL(href).pathname.replace(/\/$/, '');
      const currentPath = window.location.pathname.replace(/\/$/, '');
      installPlatform = detectPlatformFamily(navigator.userAgent, navigator.platform);
      installArchitecture = detectArchitectureFamily(navigator.userAgent, navigator.platform);

      if (currentPath === releasePath) {
        if (installPlatform === 'unknown') renderPlatformChoice();
        else guideToReleaseAsset(installPlatform);
        return true;
      }

      const target = findReleasesLink(repo);
      if (!target) return false;
      const guide: PendingGuide = {
        repo,
        kind: 'releases',
        platform: installPlatform,
        architecture: installArchitecture,
        href,
        createdAt: new Date().toISOString(),
      };
      // Save before the user clicks either the highlighted GitHub link or the
      // bubble action so the guide can resume after cross-page navigation.
      void savePendingGuide(guide);
      const platformHint = installPlatform === 'unknown'
        ? 'I cannot tell which operating system you use yet. Open Releases, and I will ask before choosing a file.'
        : `I detected ${platformName(installPlatform)}. Open Releases, and I will point to the matching download.`;
      stops = [{
        label: 'Installation',
        progressLabel: 'Step 1 of 2',
        title: 'Start with GitHub Releases',
        explanation: `${platformHint} This highlighted link is where finished, downloadable versions live.`,
        target,
        primaryAction: { action: 'open-releases', label: 'Open Releases' },
        secondaryAction: { action: 'agent-home', label: 'Ask something else' },
      }];
      activeStep = 0;
      bubbleOpen = true;
      moveToActiveStop();
      return true;
    };

    const resumePendingGuide = async () => {
      const inMemoryGuide = pendingGuide;
      const guide = inMemoryGuide ?? await readPendingGuide();
      if (!guide || !currentLocation || guide.repo.toLowerCase() !== `${currentLocation.owner}/${currentLocation.repo}`.toLowerCase()) return false;
      const expectedPath = new URL(guide.href).pathname.replace(/\/$/, '');
      const currentPath = window.location.pathname.replace(/\/$/, '');
      const locationMatches = guide.kind === 'file'
        ? Boolean(guide.path && currentLocation.path === guide.path)
        : currentPath === expectedPath;
      if (!locationMatches) return false;
      const guideAge = Date.now() - Date.parse(guide.createdAt);
      const retryWhenPageSettles = () => {
        pendingGuide = guide;
        window.setTimeout(() => schedulePublish(true), 700);
      };

      let stop: GuideStop | null = null;
      if (guide.kind === 'file') {
        const target = firstPresent(['[data-testid="code-viewer"]', '.react-code-file-contents', 'table.highlight', 'nav[aria-label="Breadcrumbs"]']);
        if (target) stop = {
          label: 'Source file',
          title: guide.path ?? 'Requested file',
          explanation: 'This is the file from the answer. Wayfinder kept the repository revision pinned, navigated here, and marked the evidence on the page.',
          target,
        };
      } else {
        installPlatform = guide.platform ?? detectPlatformFamily(navigator.userAgent, navigator.platform);
        installArchitecture = guide.architecture ?? detectArchitectureFamily(navigator.userAgent, navigator.platform);
        if (installPlatform === 'unknown') {
          await clearPendingGuide();
          bubbleOpen = true;
          renderPlatformChoice();
          return true;
        }
        const visibleAssets = releaseAssetLinks(guide.repo);
        if (installArchitecture === 'unknown' && releaseArchitectureChoices(visibleAssets, installPlatform).length > 0) {
          await clearPendingGuide();
          bubbleOpen = true;
          renderArchitectureChoice(installPlatform);
          return true;
        }
        if (guideToReleaseAsset(installPlatform, false, installArchitecture)) {
          await clearPendingGuide();
          return true;
        }
        if (guideAge < 12_000) {
          retryWhenPageSettles();
          return true;
        }
        await clearPendingGuide();
        guideToReleaseAsset(installPlatform, true, installArchitecture);
        return true;
      }

      if (!stop) {
        if (guideAge < 12_000) {
          retryWhenPageSettles();
          return true;
        }
        await clearPendingGuide();
        return false;
      }
      await clearPendingGuide();
      stops = [stop];
      activeStep = 0;
      bubbleOpen = true;
      moveToActiveStop();
      return true;
    };

    const syncViewport = () => {
      window.cancelAnimationFrame(viewportFrame);
      viewportFrame = window.requestAnimationFrame(() => {
        if (surface === 'tour' && activeStep >= 0 && !tourMoving) {
          positionAtActiveStop();
          if (bubbleOpen) setBubblePosition();
        }
        else if (bubbleOpen) setBubblePosition();
      });
    };

    const syncResize = () => {
      settleDock();
      syncViewport();
    };

    const endTour = () => {
      surface = 'complete';
      activeStep = -1;
      highlight.classList.remove('visible');
      helper.classList.add('stationed');
      commitBubbleView(`
        <div class="wf-kicker"><span>Trail complete</span><span class="wf-step-count">Ready</span></div>
        <h2>You know the lay of the land.</h2>
        <p>Ask me for installation steps, a file coordinate, or a contribution plan grounded in this repository.</p>
        <div class="wf-actions"><button class="primary" type="button" data-action="agent-home">Ask Wayfinder</button><button type="button" data-action="restart">Tour again</button></div>
      `, { focus: '[data-action="agent-home"]' });
    };

    const showWelcome = (focus?: string | null) => {
      stops = guideStops(knownRepositoryRefs());
      renderWelcome(focus);
      if (experienceMode === 'guided' && stops.length === 0) scheduleLandmarkRefresh();
    };

    const beginGuidedTour = () => {
      if (stops.length === 0) return;
      activeStep = 0;
      moveToActiveStop();
    };

    const renderGuidedWarning = (error: WayfinderRequestError) => {
      const [title, recovery] = requestErrorLabels(error);
      surface = 'welcome';
      bubble.classList.remove('agent');
      commitBubbleView(`
        <div class="wf-kicker"><span>Project facts unavailable</span><span class="wf-step-count">${escapeHtml(error.code.replaceAll('-', ' '))}</span></div>
        <h2>${escapeHtml(title)}</h2>
        <div class="wf-error"><p>${escapeHtml(error.message)}</p><p>${escapeHtml(recovery)}</p></div>
        <p class="wf-tip">The landmark tour can continue with generic GitHub explanations, but it will not claim facts about this project.</p>
        <div class="wf-actions">
          <button class="primary" type="button" data-action="retry-guided">Retry</button>
          <button type="button" data-action="continue-guided">Continue without project facts</button>
          <button type="button" data-action="cancel-guided">Cancel</button>
        </div>
      `, { focus: '[data-action="retry-guided"]', announce: `Project facts unavailable. ${recovery}` });
    };

    const startGuidedTour = async (forceRefresh = false) => {
      stops = guideStops(knownRepositoryRefs());
      if (stops.length === 0) {
        showWelcome();
        return;
      }
      let operation: Operation;
      try {
        operation = startOperation('guided');
      } catch {
        return;
      }
      renderLoading('Mapping project facts for the guided tour', false);
      try {
        await ensureRepository(operation, forceRefresh);
        assertOperationCurrent(operation);
        stops = guideStops(knownRepositoryRefs());
        if (stops.length === 0) {
          renderWelcome();
          return;
        }
        rememberRepo();
        beginGuidedTour();
      } catch (error) {
        if (!operationIsCurrent(operation)) return;
        renderGuidedWarning(error instanceof WayfinderRequestError
          ? error
          : new WayfinderRequestError('Wayfinder could not load project facts for this tour.', 'upstream-unavailable'));
      } finally {
        finishOperation(operation);
      }
    };

    copy.addEventListener('click', (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-guide-kind="file"]');
      if (link && currentLocation) {
        // Modified clicks (new tab, new window, download) keep the browser's
        // native behavior; only a plain left click becomes a guided step.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const guide: PendingGuide = {
          repo: `${currentLocation.owner}/${currentLocation.repo}`,
          kind: 'file',
          path: link.dataset.guidePath,
          href: link.href,
          createdAt: new Date().toISOString(),
        };
        void savePendingGuide(guide).then(() => window.location.assign(link.href));
        return;
      }
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (!button) return;
      const selectedArchitecture = button.dataset.architecture as ArchitectureFamily | undefined;
      if ((selectedArchitecture === 'arm64' || selectedArchitecture === 'x64') && installPlatform !== 'unknown') {
        guideToReleaseAsset(installPlatform, true, selectedArchitecture);
        return;
      }
      const selectedPlatform = button.dataset.platform as PlatformFamily | undefined;
      if (selectedPlatform === 'macos' || selectedPlatform === 'windows' || selectedPlatform === 'linux') {
        installArchitecture = 'unknown';
        guideToReleaseAsset(selectedPlatform);
        return;
      }
      const selectedMode = button.dataset.mode as ExperienceMode | undefined;
      if (selectedMode === 'guided' || selectedMode === 'quick') {
        if (selectedMode === experienceMode) {
          button.focus({ preventScroll: true });
          return;
        }
        experienceMode = selectedMode;
        answerDepth = resolveAnswerDepth(undefined, selectedMode);
        rememberRepo(false);
        void savePreferences({ mode: experienceMode, answerDepth, seenRepos });
        const focus = `[data-mode="${selectedMode}"]`;
        if (activeAnswer && repository) renderAnswer(activeAnswer, focus);
        else if (selectedMode === 'guided') showWelcome(focus);
        else renderAgentHome('', focus);
        return;
      }
      const selectedDepth = button.dataset.depth as AnswerDepth | undefined;
      if ((selectedDepth === 'concise' || selectedDepth === 'expanded') && activeAnswer) {
        if (selectedDepth === answerDepth) {
          button.focus({ preventScroll: true });
          return;
        }
        answerDepth = selectedDepth;
        void savePreferences({ answerDepth });
        renderAnswer(activeAnswer, `[data-depth="${selectedDepth}"]`);
        return;
      }
      const question = button.dataset.question;
      if (question) {
        void askAgent(question);
        return;
      }
      const prefill = button.dataset.prefill;
      if (prefill) {
        renderAgentHome(prefill);
        return;
      }
      const command = button.dataset.command;
      if (command) {
        if (button.getAttribute('aria-busy') === 'true') return;
        button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-disabled', 'true');
        void copyText(command).then((copied) => {
          if (!button.isConnected) return;
          button.dataset.copyState = copied ? 'Copied' : 'Copy failed';
          announce(copied ? 'Command copied to clipboard.' : 'Copy failed. Try again.');
          window.setTimeout(() => {
            if (!button.isConnected) return;
            button.setAttribute('aria-busy', 'false');
            button.setAttribute('aria-disabled', 'false');
          }, copied ? 650 : 300);
          window.setTimeout(() => {
            if (button.isConnected) delete button.dataset.copyState;
          }, 1_400);
        });
        return;
      }
      const action = button.dataset.action;
      if (action === 'agent-home') {
        void clearPendingGuide();
        renderAgentHome();
        return;
      }
      if (action === 'back-to-trail' && activeAnswer) {
        const savedAnswer = activeAnswer;
        const operation = startOperation('restore');
        void ensureRepository(operation, false).then((bundle) => {
          assertOperationCurrent(operation);
          if (bundle.map.repo.toLowerCase() !== savedAnswer.repo.toLowerCase() || bundle.map.sha !== savedAnswer.sha) {
            activeAnswer = null;
            renderAgentHome();
            return;
          }
          renderAnswer(savedAnswer);
        }).catch(() => {
          if (operationIsCurrent(operation)) renderAgentHome();
        }).finally(() => finishOperation(operation));
        return;
      }
      if (action === 'setup-choice') {
        renderSetupChoice();
        return;
      }
      if (action === 'refresh-landmarks') {
        landmarkRefreshAttempts = 0;
        showWelcome();
        return;
      }
      if (action === 'open-releases' && currentLocation) {
        const href = releasesUrl(`${currentLocation.owner}/${currentLocation.repo}`);
        const platform = installPlatform === 'unknown'
          ? detectPlatformFamily(navigator.userAgent, navigator.platform)
          : installPlatform;
        const guide: PendingGuide = {
          repo: `${currentLocation.owner}/${currentLocation.repo}`,
          kind: 'releases',
          platform,
          architecture: installArchitecture,
          href,
          createdAt: new Date().toISOString(),
        };
        void savePendingGuide(guide).then(() => window.location.assign(href));
        return;
      }
      if (action === 'choose-platform') {
        renderPlatformChoice();
        return;
      }
      if (action === 'download-release') {
        const target = stops[activeStep]?.target;
        if (target instanceof HTMLAnchorElement && target.href) window.location.assign(target.href);
        return;
      }
      if (action === 'choose-guided') {
        experienceMode = 'guided';
        answerDepth = resolveAnswerDepth(undefined, experienceMode);
        rememberRepo(false);
        void savePreferences({ mode: experienceMode, answerDepth, seenRepos });
        showWelcome();
        return;
      }
      if (action === 'choose-quick') {
        experienceMode = 'quick';
        answerDepth = resolveAnswerDepth(undefined, experienceMode);
        rememberRepo(false);
        void savePreferences({ mode: experienceMode, answerDepth, seenRepos });
        void askAgent('Give me a 60-second overview of this repository');
        return;
      }
      if (action === 'ask-highlight') {
        const stop = stops[activeStep];
        if (stop) renderHighlightedAnswer(stop);
        return;
      }
      if (action === 'context-followup') {
        const stop = stops[activeStep];
        renderAgentHome(stop ? `Tell me more about the ${stop.label.toLowerCase()} that was highlighted` : '');
        return;
      }
      if (action === 'refresh-answer') {
        announce('Refreshing repository evidence.');
        void askAgent(activeQuestion, true);
        return;
      }
      if (action === 'retry-answer') {
        announce('Retrying request.');
        void askAgent(activeQuestion);
        return;
      }
      if (action === 'retry-guided') {
        announce('Retrying project facts.');
        void startGuidedTour(true);
        return;
      }
      if (action === 'continue-guided') {
        repository = null;
        rememberRepo();
        beginGuidedTour();
        return;
      }
      if (action === 'cancel-guided') {
        showWelcome();
        return;
      }
      if (action === 'start' || action === 'restart') {
        void startGuidedTour();
      } else if (action === 'previous') {
        activeStep = Math.max(0, activeStep - 1);
        moveToActiveStop();
      } else if (action === 'next') {
        if (activeStep >= stops.length - 1) endTour();
        else {
          activeStep += 1;
          moveToActiveStop();
        }
      }
    });

    copy.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      const question = new FormData(form).get('question');
      if (typeof question === 'string') void askAgent(question);
    });

    helper.addEventListener('click', () => {
      if (bubbleOpen) {
        dismissHelper();
        return;
      }
      if (!preferencesLoaded) {
        // A real loading view keeps the bubble positioned and announced while
        // preferences load, instead of an empty panel toggled open.
        commitBubbleView(
          '<div class="wf-answer" aria-busy="true"><div class="wf-kicker"><span>Wayfinder</span></div><p class="wf-tip">Preparing your guide…</p></div>',
          { focus: null, announce: 'Preparing Wayfinder.' },
        );
        void loadPreferences().then(() => {
          if (!bubbleOpen || host.hidden) return;
          welcomeShown = true;
          showWelcome();
        });
        return;
      }
      if (!copy.hasChildNodes()) {
        welcomeShown = true;
        showWelcome();
        return;
      }
      if (surface === 'welcome' && copy.querySelector('[data-action="refresh-landmarks"]')) {
        landmarkRefreshAttempts = 0;
        showWelcome();
        return;
      }
      bubbleOpen = true;
      bubble.classList.add('open');
      const generation = ++renderGeneration;
      window.requestAnimationFrame(() => {
        if (generation !== renderGeneration || host.hidden || !bubbleOpen) return;
        setBubblePosition();
        const composer = shadow.querySelector<HTMLTextAreaElement>('#wf-question');
        (composer ?? bubble).focus({ preventScroll: true });
      });
    });

    close.addEventListener('click', dismissHelper);

    const closeOnEscape = (event: KeyboardEvent) => {
      // event.code identifies the physical key: on macOS, Option+Shift+W
      // produces a special character in event.key and would never match 'w'.
      if (event.altKey && event.shiftKey && event.code === 'KeyW') {
        if (host.hidden || !currentLocation) return;
        event.preventDefault();
        helper.click();
        return;
      }
      if (event.key !== 'Escape' || (!bubbleOpen && !tourMoving && activeStep < 0)) return;
      // Escape belongs to whichever surface owns focus. When the user is in
      // GitHub's own UI (a dialog, the command palette, a file filter), the
      // page keeps its Escape behavior. Wayfinder claims the key while focus
      // is inside its shadow root, and also while nothing holds focus at all
      // (body/null) — a moving tour replaces its trigger button, dropping
      // focus to the body, and Escape must still cancel that tour.
      const activeElement = document.activeElement;
      const focusInHelper = shadow.activeElement !== null || activeElement === host;
      const focusUnclaimed = !activeElement || activeElement === document.body || activeElement === document.documentElement;
      if (!focusInHelper && !focusUnclaimed) return;
      event.preventDefault();
      dismissHelper();
    };
    document.addEventListener('keydown', closeOnEscape, true);

    const publishLocation = (force = false) => {
      scheduled = false;
      const publishedUrl = window.location.href;
      const nextLocation = parseGitHubUrl(publishedUrl, visibleBranchRef(), knownRepositoryRefs());
      const locationChanged = !sameLocation(currentLocation, nextLocation);
      if (!force && !locationChanged) {
        return;
      }

      const previousLocation = currentLocation;
      const previousRepo = previousLocation ? `${previousLocation.owner}/${previousLocation.repo}` : null;
      const previousRef = previousLocation?.ref ?? null;
      const nextRepo = nextLocation ? `${nextLocation.owner}/${nextLocation.repo}` : null;
      const repoChanged = previousRepo !== nextRepo;
      const pinnedEvidenceNavigation = Boolean(nextLocation?.ref && repository?.map.sha === nextLocation.ref);
      const returningFromPinnedEvidence = Boolean(
        previousRef
        && repository?.map.sha === previousRef
        && (!nextLocation?.ref || [repository.map.requestedRef, repository.map.resolvedRef, repository.map.defaultBranch].includes(nextLocation.ref)),
      );
      const refChanged = !repoChanged
        && previousRef !== nextLocation?.ref
        && !pinnedEvidenceNavigation
        && !returningFromPinnedEvidence;
      const pathChanged = !repoChanged && !refChanged
        && (previousLocation?.path !== nextLocation?.path || previousLocation?.view !== nextLocation?.view);

      currentLocation = nextLocation;
      host.hidden = !nextLocation;

      if (locationChanged) {
        abortOperations();
        window.clearTimeout(landmarkRefreshTimer);
        landmarkRefreshTimer = 0;
        landmarkRefreshAttempts = 0;
        renderGeneration += 1;
        announcementGeneration += 1;
        answerCachedAt = null;
        activeStep = -1;
        cancelTourMotion();
        stops = [];
        if (repoChanged || refChanged) {
          repository = null;
          repositoryCachedAt = null;
          repositoryCacheState = 'fresh';
          activeAnswer = null;
        }
      } else if (force && (surface === 'tour' || surface === 'context')) {
        activeStep = -1;
        cancelTourMotion();
        stops = [];
        if (bubbleOpen) showWelcome(null);
      }

      if (!nextLocation) {
        bubbleOpen = false;
        bubble.classList.remove('open');
        copy.replaceChildren();
      } else if (bubbleOpen && locationChanged) {
        if (surface === 'agent') renderAgentHome('', null);
        else showWelcome(null);
      } else if (!bubbleOpen && locationChanged) {
        copy.replaceChildren();
      }

      const publishedRenderGeneration = renderGeneration;
      const generation = ++navigationGeneration;
      window.clearTimeout(publishTimer);
      publishTimer = window.setTimeout(() => {
        if (generation !== navigationGeneration || window.location.href !== publishedUrl) return;
        void loadPreferences().then(async () => {
          if (generation !== navigationGeneration || window.location.href !== publishedUrl) return;
          const settledLocation = parseGitHubUrl(publishedUrl, visibleBranchRef(), knownRepositoryRefs());
          if (!sameLocation(currentLocation, settledLocation)) {
            schedulePublish(true);
            return;
          }
          stops = guideStops(knownRepositoryRefs());
          if (experienceMode === 'guided' && stops.length === 0) scheduleLandmarkRefresh();
          const normalizedRepo = nextRepo?.toLowerCase() ?? null;
          const seen = normalizedRepo ? seenRepos.includes(normalizedRepo) : false;
          host.dataset.seen = String(seen);
          if (activeOperations.size > 0) return;
          if (repoChanged && nextRepo && !activeAnswer) {
            const saved = await loadTrail(nextRepo);
            if (generation !== navigationGeneration || window.location.href !== publishedUrl || activeOperations.size > 0) return;
            if (saved && !activeAnswer) {
              activeAnswer = saved.answer;
              activeQuestion = saved.question;
            }
          }
          if (renderGeneration !== publishedRenderGeneration) return;
          if (await resumePendingGuide()) return;
          if (!welcomeShown && stops.length > 0 && (!experienceMode || (experienceMode === 'guided' && !seen))) {
            welcomeShown = true;
            showWelcome(null);
          } else if (bubbleOpen && nextLocation) {
            // Delayed initial/Turbo renders can settle after the user has
            // already opened the composer. The synchronous navigation branch
            // above handles real path changes, so never replace a live editor
            // here: doing so erases its draft and steals focus mid-keystroke.
            if (surface === 'agent' && shadow.querySelector('#wf-question')) return;
            if (surface === 'agent' && activeAnswer && repository && !pathChanged) renderAnswer(activeAnswer, null);
            else if (surface === 'agent') renderAgentHome('', null);
            else renderWelcome(null);
          } else if (!bubbleOpen) {
            copy.replaceChildren();
          }
        });
      }, 1_200);
    };

    const schedulePublish = (force = false) => {
      forceScheduled ||= force;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        const shouldForce = forceScheduled;
        forceScheduled = false;
        publishLocation(shouldForce);
      });
    };

    const handlePopState = () => schedulePublish(true);
    const handleTurboLoad = () => {
      if (!host.isConnected) document.body.append(host);
      schedulePublish(true);
    };
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('turbo:load', handleTurboLoad);
    window.addEventListener('resize', syncResize);
    window.addEventListener('scroll', syncViewport, { passive: true, capture: true });

    let locationTimer = 0;
    const mountHelper = () => {
      if (!host.isConnected) document.body.append(host);
      publishLocation(true);
      if (!locationTimer) {
        locationTimer = window.setInterval(() => {
          if (!host.isConnected) document.body.append(host);
          schedulePublish();
        }, 500);
      }
    };

    mountHelper();

    // Reconcile the cache index once the page has settled: orphaned
    // wayfinder:* keys (crashed writes, legacy trails, retired hash formats)
    // are removed so extension storage stays bounded.
    const reconcileTimer = window.setTimeout(() => {
      void reconcileCacheIndex(storage).catch(() => undefined);
    }, 4_000);

    const teardown = () => {
      window.clearTimeout(reconcileTimer);
      window.clearTimeout(movementTimer);
      window.clearTimeout(arrivalTimer);
      window.clearTimeout(dockSettleTimer);
      window.clearTimeout(publishTimer);
      window.clearTimeout(landmarkRefreshTimer);
      window.clearInterval(locationTimer);
      abortOperations();
      renderGeneration += 1;
      announcementGeneration += 1;
      openStateObserver.disconnect();
      window.cancelAnimationFrame(viewportFrame);
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('turbo:load', handleTurboLoad);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', syncResize);
      window.removeEventListener('scroll', syncViewport, { capture: true });
      host.remove();
    };
    // WXT never invokes a content script's returned value; the context's
    // invalidation callback is the only teardown hook that actually fires
    // (when the extension is updated, reloaded, or disabled).
    ctx.onInvalidated(teardown);
  },
});
