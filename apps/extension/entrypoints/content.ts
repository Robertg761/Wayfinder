import type { AgentAnswer, RepoLocation, RepoMap, RepoTour, WayfinderErrorResponse } from '@wayfinder/contracts';
import {
  agentCacheTtl,
  agentResponseCacheKey,
  clearRepositoryCache,
  getCached,
  repositoryCacheKey,
  repositoryCacheTtl,
  setCached,
  type CacheStorage,
} from '@/lib/cache';
import { parseGitHubUrl } from '@/lib/github-url';
import { agentStarters, landmarkDetail, measuredBubbleHeight, placeBubble } from '@/lib/helper-ui';

interface RepositoryBundle {
  map: RepoMap;
  tour: RepoTour;
}

type ExperienceMode = 'guided' | 'quick';
type AnswerDepth = 'concise' | 'expanded';

interface WayfinderPreferences {
  mode: ExperienceMode | null;
  seenRepos: string[];
}

interface SavedTrail {
  question: string;
  answer: AgentAnswer;
  savedAt: string;
}

const preferencesKey = 'wayfinder:preferences:v1';

function trailKey(repo: string): string {
  return `wayfinder:trail:${repo.toLowerCase()}`;
}

class WayfinderRequestError extends Error {
  constructor(
    message: string,
    readonly code: WayfinderErrorResponse['code'] = 'request-failed',
    readonly resetAt?: string,
  ) {
    super(message);
  }
}

const apiUrl = import.meta.env.WXT_WAYFINDER_API_URL
  ?? (import.meta.env.PROD ? 'https://wayfinder-api.hopit-robert.workers.dev' : 'http://localhost:8787');

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

type GuideStop = {
  label: string;
  title: string;
  explanation: string;
  target: Element;
};

const helperStyles = `
  :host {
    --wf-ink: #25231f;
    --wf-paper: #fffaf0;
    --wf-gold: #e8a72f;
    --wf-rust: #b54f2c;
    --wf-moss: #42694f;
    --wf-line: rgba(37, 35, 31, 0.18);
    all: initial;
    color: var(--wf-ink);
    font-family: Georgia, 'Times New Roman', serif;
  }

  :host([hidden]) { display: none !important; }

  * { box-sizing: border-box; }
  .wf-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  .wf-layer {
    position: fixed;
    inset: 0;
    z-index: 2147483600;
    pointer-events: none;
  }

  .wf-highlight {
    position: fixed;
    border: 2px solid var(--wf-gold);
    border-radius: 10px;
    box-shadow: 0 0 0 4px rgba(232, 167, 47, 0.16), 0 12px 36px rgba(37, 35, 31, 0.16);
    opacity: 0;
    transition: left 520ms cubic-bezier(.2,.8,.2,1), top 520ms cubic-bezier(.2,.8,.2,1), width 520ms cubic-bezier(.2,.8,.2,1), height 520ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease;
  }

  .wf-highlight.visible { opacity: 1; }

  .wf-dock {
    position: fixed;
    left: calc(100vw - 82px);
    top: calc(100vh - 86px);
    width: 56px;
    height: 64px;
    pointer-events: none;
    transition: left 1200ms cubic-bezier(.22,.61,.36,1), top 1200ms cubic-bezier(.22,.61,.36,1);
  }
  .wf-dock.settled { transition: none; }

  .wf-helper {
    position: absolute;
    inset: 0;
    width: 56px;
    height: 64px;
    pointer-events: auto;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    filter: drop-shadow(0 9px 10px rgba(24, 22, 18, 0.24));
    transition: transform 180ms ease;
  }

  .wf-helper:hover { transform: translateY(-3px) rotate(-2deg); }
  .wf-helper.stationed:hover { transform: none; }
  .wf-helper.stationed .wf-body { animation: none; }
  .wf-helper:focus-visible { outline: 3px solid #58a6ff; outline-offset: 5px; border-radius: 50%; }

  .wf-body {
    position: absolute;
    left: 3px;
    top: 0;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: var(--wf-paper);
    border: 2px solid var(--wf-ink);
    box-shadow: inset 0 0 0 4px var(--wf-gold), inset 0 0 0 6px var(--wf-ink);
    animation: wf-bob 3.2s ease-in-out infinite;
  }

  .wf-face {
    position: absolute;
    left: 15px;
    top: 18px;
    width: 5px;
    height: 6px;
    border-radius: 50%;
    background: var(--wf-ink);
    box-shadow: 14px 0 0 var(--wf-ink);
  }

  .wf-face::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 8px;
    width: 8px;
    height: 4px;
    border-bottom: 2px solid var(--wf-ink);
    border-radius: 50%;
  }

  .wf-needle {
    position: absolute;
    left: 23px;
    top: 5px;
    width: 4px;
    height: 18px;
    border-radius: 4px;
    background: linear-gradient(to bottom, var(--wf-rust) 0 50%, var(--wf-ink) 50%);
    transform-origin: 2px 20px;
    animation: wf-seek 4.8s ease-in-out infinite;
  }

  .wf-feet::before,
  .wf-feet::after {
    content: '';
    position: absolute;
    top: 49px;
    width: 17px;
    height: 10px;
    border: 2px solid var(--wf-ink);
    border-top: 0;
    border-radius: 0 0 12px 12px;
    background: var(--wf-gold);
  }
  .wf-feet::before { left: 7px; transform: rotate(8deg); }
  .wf-feet::after { right: 7px; transform: rotate(-8deg); }

  .wf-ping {
    position: absolute;
    right: -3px;
    top: -3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--wf-rust);
    border: 2px solid var(--wf-paper);
    animation: wf-ping 2.4s ease-out infinite;
  }
  :host([data-mode="quick"]) .wf-ping,
  :host([data-seen="true"]) .wf-ping { display: none; }

  .wf-bubble {
    position: absolute;
    left: 0;
    top: 0;
    width: min(326px, calc(100vw - 28px));
    max-height: min(430px, calc(100vh - 28px));
    overflow: auto;
    pointer-events: auto;
    padding: 18px;
    border: 1px solid var(--wf-ink);
    border-radius: 18px 18px 5px 18px;
    background:
      radial-gradient(circle at 90% 10%, rgba(232, 167, 47, 0.22), transparent 34%),
      var(--wf-paper);
    box-shadow: 7px 7px 0 rgba(37, 35, 31, 0.18), 0 18px 50px rgba(20, 18, 14, 0.18);
    opacity: 0;
    transform: translateY(10px) scale(.97);
    transform-origin: 100% 100%;
    visibility: hidden;
    transition: opacity 180ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), visibility 180ms;
  }

  .wf-bubble.open { opacity: 1; transform: none; visibility: visible; }
  .wf-bubble.agent { width: min(430px, calc(100vw - 28px)); max-height: min(610px, calc(100vh - 28px)); border-radius: 18px 18px 5px 18px; }

  .wf-kicker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    color: var(--wf-rust);
    font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .16em;
    text-transform: uppercase;
  }

  .wf-step-count { color: var(--wf-moss); }

  .wf-bubble h2 {
    margin: 0 26px 7px 0;
    color: var(--wf-ink);
    font: 600 23px/1.05 Georgia, 'Times New Roman', serif;
    letter-spacing: -.025em;
  }

  .wf-bubble p {
    margin: 0;
    color: #554f45;
    font: 15px/1.48 Georgia, 'Times New Roman', serif;
  }

  .wf-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 15px;
  }

  .wf-actions button,
  .wf-close {
    appearance: none;
    border: 1px solid var(--wf-ink);
    border-radius: 999px;
    background: transparent;
    color: var(--wf-ink);
    cursor: pointer;
    font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .04em;
  }

  .wf-actions button { min-height: 34px; padding: 0 13px; }
  .wf-actions .primary { background: var(--wf-ink); color: var(--wf-paper); }
  .wf-actions button:hover { transform: translateY(-1px); box-shadow: 0 3px 0 rgba(37,35,31,.16); }
  .wf-actions button:focus-visible, .wf-close:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }

  .wf-close {
    position: absolute;
    right: 12px;
    top: 12px;
    width: 28px;
    height: 28px;
    padding: 0;
    border-color: transparent;
    font-size: 16px;
  }

  .wf-tip {
    margin-top: 13px !important;
    padding-top: 11px;
    border-top: 1px dashed var(--wf-line);
    color: #756d61 !important;
    font-size: 12px !important;
  }

  .wf-agent-head { padding-right: 30px; }
  .wf-mode-switch { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--wf-line); border-radius: 999px; background: rgba(255,255,255,.52); }
  .wf-mode-switch button { padding: 5px 8px; border: 0; border-radius: 999px; background: transparent; color: #756d61; cursor: pointer; font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em; text-transform: uppercase; }
  .wf-mode-switch button.active { background: var(--wf-ink); color: var(--wf-paper); }
  .wf-mode-switch button:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
  .wf-agent-head h2 { margin-bottom: 5px; }
  .wf-agent-head p { font-size: 13px; }
  .wf-agent-home { display: grid; gap: 12px; }
  .wf-question-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .wf-question-grid button {
    min-height: 58px;
    padding: 9px 10px;
    border: 1px solid var(--wf-line);
    border-radius: 10px;
    background: rgba(255,255,255,.46);
    color: var(--wf-ink);
    cursor: pointer;
    text-align: left;
    font: 700 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .wf-question-grid button:hover { border-color: var(--wf-gold); background: rgba(232,167,47,.1); }
  .wf-composer { display: grid; grid-template-columns: 1fr auto; gap: 7px; padding-top: 11px; border-top: 1px dashed var(--wf-line); }
  .wf-composer textarea {
    min-height: 58px;
    resize: vertical;
    padding: 10px 11px;
    border: 1px solid var(--wf-line);
    border-radius: 10px;
    background: #fffef9;
    color: var(--wf-ink);
    font: 13px/1.35 Georgia, 'Times New Roman', serif;
  }
  .wf-composer button {
    align-self: stretch;
    padding: 0 13px;
    border: 0;
    border-radius: 10px;
    background: var(--wf-ink);
    color: var(--wf-paper);
    cursor: pointer;
    font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .wf-loading { display: grid; place-items: center; min-height: 190px; text-align: center; }
  .wf-loading-mark { width: 42px; height: 42px; margin-bottom: 15px; border: 2px solid var(--wf-line); border-top-color: var(--wf-rust); border-radius: 50%; animation: wf-spin 900ms linear infinite; }
  .wf-answer { display: grid; gap: 13px; }
  .wf-answer-mode { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--wf-line); border-radius: 9px; background: rgba(66,105,79,.08); color: var(--wf-moss); font: 700 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .09em; text-transform: uppercase; }
  .wf-answer-mode.model { background: rgba(232,167,47,.13); color: #7a4b00; }
  .wf-cache-note { color: #756d61 !important; font: 700 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace !important; letter-spacing: .04em; }
  .wf-confidence { display: inline-flex; margin-top: 7px; padding: 3px 6px; border-radius: 999px; background: rgba(66,105,79,.1); color: var(--wf-moss); font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
  .wf-warning-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .wf-warning-list li { padding: 8px 10px; border-left: 3px solid var(--wf-gold); background: rgba(232,167,47,.1); color: #62543b; font: 12px/1.4 Georgia, 'Times New Roman', serif; }
  .wf-answer-summary { color: var(--wf-ink) !important; font-size: 17px !important; line-height: 1.4 !important; }
  .wf-answer-explanation { font-size: 13px !important; }
  .wf-result-list, .wf-route-list, .wf-brief { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .wf-result, .wf-route-list li, .wf-brief li { padding: 10px; border: 1px solid var(--wf-line); border-radius: 10px; background: rgba(255,255,255,.48); }
  .wf-result strong, .wf-route-list strong, .wf-brief strong { display: block; color: var(--wf-ink); font: 700 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .wf-result p, .wf-route-list p, .wf-brief p { margin-top: 5px; font-size: 12px; }
  .wf-snapshot { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .wf-fact { min-width: 0; padding: 10px; border: 1px solid var(--wf-line); border-radius: 10px; background: rgba(255,255,255,.5); }
  .wf-fact.wide { grid-column: 1 / -1; }
  .wf-fact span { display: block; margin-bottom: 5px; color: #756d61; font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; text-transform: uppercase; }
  .wf-fact strong { display: block; color: var(--wf-ink); font: 700 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .wf-signal-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
  .wf-signal { padding: 3px 5px; border-radius: 999px; background: rgba(66,105,79,.09); color: var(--wf-moss); font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wf-project-fact { margin-top: 12px; padding: 10px; border-left: 3px solid var(--wf-moss); background: rgba(66,105,79,.08); }
  .wf-project-fact strong { display: block; margin-bottom: 3px; color: var(--wf-moss); font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
  .wf-boundary { padding: 9px 10px; border: 1px solid rgba(232,167,47,.4); border-radius: 9px; background: rgba(232,167,47,.09); color: #62543b; font: 12px/1.4 Georgia, 'Times New Roman', serif; }
  .wf-detail-toggle { display: flex; gap: 5px; }
  .wf-detail-toggle button { padding: 5px 7px; border: 1px solid var(--wf-line); border-radius: 999px; background: transparent; color: var(--wf-moss); cursor: pointer; font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
  .wf-answer.concise .wf-detail { display: none; }
  details.wf-detail { padding: 8px 10px; border: 1px solid var(--wf-line); border-radius: 10px; }
  details.wf-detail summary { cursor: pointer; color: var(--wf-moss); font: 700 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wf-open, .wf-copy-command {
    width: 100%; margin-top: 8px; padding: 8px 10px; border: 1px solid var(--wf-ink); border-radius: 8px; background: transparent; color: var(--wf-ink); cursor: pointer; text-align: left; font: 700 10px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .wf-copy-command { background: var(--wf-ink); color: var(--wf-paper); overflow-wrap: anywhere; }
  .wf-evidence { display: flex; flex-wrap: wrap; gap: 6px; }
  .wf-evidence button, .wf-followups button { padding: 7px 9px; border: 1px solid var(--wf-line); border-radius: 999px; background: transparent; color: var(--wf-moss); cursor: pointer; font: 700 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .wf-followups { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 10px; border-top: 1px dashed var(--wf-line); }
  .wf-answer-nav { display: flex; justify-content: space-between; gap: 8px; }
  .wf-answer-nav button { padding: 7px 10px; border: 0; background: transparent; color: var(--wf-rust); cursor: pointer; font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wf-error { padding: 13px; border: 1px solid rgba(181,79,44,.35); border-radius: 10px; background: rgba(181,79,44,.08); }
  .wf-error p { font-size: 13px; }
  @keyframes wf-spin { to { transform: rotate(360deg); } }

  @keyframes wf-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
  @keyframes wf-seek { 0%,100% { transform: rotate(-28deg) } 48% { transform: rotate(24deg) } 60% { transform: rotate(19deg) } }
  @keyframes wf-ping { 0% { box-shadow: 0 0 0 0 rgba(181,79,44,.45) } 70%,100% { box-shadow: 0 0 0 9px rgba(181,79,44,0) } }

  @media (prefers-reduced-motion: reduce) {
    .wf-dock, .wf-helper, .wf-highlight, .wf-bubble { transition-duration: 0ms; }
    .wf-body, .wf-needle, .wf-ping { animation: none; }
    .wf-loading-mark { animation: none; }
  }
`;

function firstVisible(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector));
    const match = candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 16 && rect.height > 8;
    });
    if (match) return match;
  }
  return null;
}

function visibleBranchRef(): string | null {
  const element = firstVisible([
    'button[data-hotkey="w"] span[data-component="text"]',
    'button[data-hotkey="w"]',
    'summary[title*="Switch branches"] span',
  ]);
  return element?.textContent?.trim().split(/\s*\n\s*/)[0] || null;
}

function guideStops(): GuideStop[] {
  const location = parseGitHubUrl(window.location.href, visibleBranchRef());
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
          selectors: ['button[data-hotkey="w"]', '[data-testid="anchor-button"] span[data-component="text"]', 'summary[title*="Switch branches"]'],
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

  return candidates.flatMap(({ selectors, ...stop }) => {
    const target = firstVisible(selectors);
    return target ? [{ ...stop, target }] : [];
  });
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main() {
    let lastUrl = '';
    let scheduled = false;
    let stops: GuideStop[] = [];
    let activeStep = -1;
    let bubbleOpen = false;
    let welcomeShown = false;
    let movementTimer = 0;
    let arrivalTimer = 0;
    let viewportFrame = 0;
    let tourMoving = false;
    let surface: 'welcome' | 'tour' | 'agent' | 'context' | 'complete' = 'welcome';
    let currentLocation: RepoLocation | null = null;
    let repository: RepositoryBundle | null = null;
    let activeQuestion = '';
    let repositoryCachedAt: string | null = null;
    let answerCachedAt: string | null = null;
    let repositoryCacheState: 'fresh' | 'cached' | 'stale' = 'fresh';
    let experienceMode: ExperienceMode | null = null;
    let answerDepth: AnswerDepth = 'concise';
    let preferencesLoaded = false;
    let seenRepos: string[] = [];
    let activeAnswer: AgentAnswer | null = null;
    let requestVersion = 0;
    let activeRequest: AbortController | null = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const storage = browser.storage.local as unknown as CacheStorage;

    const loadPreferences = async () => {
      if (preferencesLoaded) return;
      const values: Record<string, unknown> = await storage.get(preferencesKey).catch(() => ({}));
      const stored = values[preferencesKey] as Partial<WayfinderPreferences> | undefined;
      experienceMode = stored?.mode === 'guided' || stored?.mode === 'quick' ? stored.mode : null;
      seenRepos = Array.isArray(stored?.seenRepos) ? stored.seenRepos.filter((repo): repo is string => typeof repo === 'string').slice(0, 100) : [];
      preferencesLoaded = true;
      if (experienceMode) host.dataset.mode = experienceMode;
    };

    const savePreferences = async () => {
      if (experienceMode) host.dataset.mode = experienceMode;
      await storage.set({ [preferencesKey]: { mode: experienceMode, seenRepos } satisfies WayfinderPreferences }).catch(() => undefined);
    };

    const rememberRepo = () => {
      if (!currentLocation) return;
      const repo = `${currentLocation.owner}/${currentLocation.repo}`.toLowerCase();
      seenRepos = [repo, ...seenRepos.filter((candidate) => candidate !== repo)].slice(0, 100);
      host.dataset.seen = 'true';
      void savePreferences();
    };

    const saveTrail = async () => {
      if (!activeAnswer) return;
      await storage.set({
        [trailKey(activeAnswer.repo)]: {
          question: activeQuestion,
          answer: activeAnswer,
          savedAt: new Date().toISOString(),
        } satisfies SavedTrail,
      }).catch(() => undefined);
    };

    const loadTrail = async (repo: string) => {
      const key = trailKey(repo);
      const values: Record<string, unknown> = await storage.get(key).catch(() => ({}));
      const stored = values[key] as SavedTrail | undefined;
      if (!stored?.answer || stored.answer.repo.toLowerCase() !== repo.toLowerCase()) return;
      activeAnswer = stored.answer;
      activeQuestion = stored.question;
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
            <div class="wf-copy" aria-live="polite"></div>
          </aside>
        </div>
      </div>
    `;

    const dock = shadow.querySelector<HTMLDivElement>('.wf-dock')!;
    const helper = shadow.querySelector<HTMLButtonElement>('.wf-helper')!;
    const highlight = shadow.querySelector<HTMLDivElement>('.wf-highlight')!;
    const bubble = shadow.querySelector<HTMLElement>('.wf-bubble')!;
    const copy = shadow.querySelector<HTMLDivElement>('.wf-copy')!;
    const close = shadow.querySelector<HTMLButtonElement>('.wf-close')!;
    const openStateObserver = new MutationObserver(() => {
      const open = bubble.classList.contains('open');
      helper.setAttribute('aria-expanded', String(open));
      helper.setAttribute('aria-label', open ? 'Close Wayfinder helper' : 'Open Wayfinder helper');
    });
    helper.setAttribute('aria-expanded', 'false');
    openStateObserver.observe(bubble, { attributes: true, attributeFilter: ['class'] });

    const setBubblePosition = () => {
      const dockRect = dock.getBoundingClientRect();
      const width = Math.min(bubble.classList.contains('agent') ? 430 : 326, window.innerWidth - 28);
      const height = measuredBubbleHeight(bubble.getBoundingClientRect().height, bubble.scrollHeight, window.innerHeight);
      const placement = placeBubble(dockRect, width, height, window.innerWidth, window.innerHeight);
      bubble.dataset.side = placement.side;
      bubble.style.left = `${placement.left}px`;
      bubble.style.top = `${placement.top}px`;
      bubble.style.maxHeight = `${placement.maxHeight}px`;
    };

    const focusComposer = () => {
      window.setTimeout(() => shadow.querySelector<HTMLTextAreaElement>('#wf-question')?.focus(), 0);
    };

    const modeSwitch = () => experienceMode ? `
      <div class="wf-mode-switch" aria-label="Wayfinder experience mode">
        <button type="button" data-mode="guided" class="${experienceMode === 'guided' ? 'active' : ''}" aria-pressed="${experienceMode === 'guided'}">Guided</button>
        <button type="button" data-mode="quick" class="${experienceMode === 'quick' ? 'active' : ''}" aria-pressed="${experienceMode === 'quick'}">Quick</button>
      </div>
    ` : '';

    const contextActions = (currentPath: string | null) => {
      if (currentPath) {
        return [
          ['Summarize this file', `Summarize the role of ${currentPath} and its important public surface`],
          ['Find likely callers', `Which files likely import or call ${currentPath}?`],
          ['Find its tests', `Find the tests paired with ${currentPath}`],
          ['Trace dependencies', `What does ${currentPath} depend on and where should I read next?`],
          ['Map change impact', `If I change ${currentPath}, what implementation and verification files should I inspect?`],
        ];
      }
      return experienceMode === 'quick'
        ? [
            ['Repository snapshot', 'Give me a 60-second overview of this repository'],
            ['Understand architecture', 'Give me an architecture tour of this repository'],
            ['Find implementation', 'Find the primary implementation for [feature]'],
            ['Find tests', 'Where are the tests for [feature]?'],
            ['Set up locally', 'Help me develop this repository locally'],
            ['Map a change', 'I want to change [feature]. Plan my contribution.'],
          ]
        : agentStarters.map((starter) => [starter.label, starter.question] as [string, string]);
    };

    const renderAgentHome = (prefill = '') => {
      surface = 'agent';
      activeStep = -1;
      tourMoving = false;
      window.clearTimeout(movementTimer);
      window.clearTimeout(arrivalTimer);
      dock.classList.add('settled');
      window.setTimeout(() => dock.classList.remove('settled'), 1_250);
      highlight.classList.remove('visible');
      helper.classList.add('stationed');
      bubble.classList.add('agent');
      const currentPath = currentLocation?.path;
      const actions = contextActions(currentPath ?? null);
      const boundary = currentLocation?.view === 'other'
        ? '<div class="wf-boundary">This GitHub page is not a source path. I will use repository-level evidence and will not treat the issue or pull request number as a folder.</div>'
        : '';
      const trailAction = activeAnswer
        ? '<button type="button" data-action="back-to-trail">Back to saved trail</button>'
        : '';
      copy.innerHTML = `
        <div class="wf-agent-home">
          <div class="wf-agent-head">
            <div class="wf-kicker"><span>${experienceMode === 'quick' ? 'Quick map' : 'Ask Wayfinder'}</span>${modeSwitch()}</div>
            <h2>${currentPath ? 'What do you need from this file?' : experienceMode === 'quick' ? 'Get the answer, then the evidence.' : 'What are you trying to do?'}</h2>
            <p>${currentPath ? `Starting from ${escapeHtml(currentPath)}.` : experienceMode === 'quick' ? 'Compact repository intelligence with branch-pinned evidence.' : 'I will explain the repository one useful step at a time.'}</p>
          </div>
          ${boundary}
          <div class="wf-question-grid">
            ${actions.map(([label, question]) => `<button type="button" ${question.includes('[feature]') ? 'data-prefill' : 'data-question'}="${escapeHtml(question)}">${escapeHtml(label)}</button>`).join('')}
            ${trailAction}
          </div>
          ${!currentPath ? '<div class="wf-actions"><button type="button" data-action="setup-choice">Use or develop this project</button></div>' : ''}
          <form class="wf-composer">
            <label class="wf-sr-only" for="wf-question">Question for Wayfinder</label>
            <textarea id="wf-question" name="question" minlength="2" required placeholder="${currentPath ? `Ask about ${escapeHtml(currentPath)}` : 'Ask about this repository'}">${escapeHtml(prefill)}</textarea>
            <button type="submit">Ask</button>
          </form>
          <p class="wf-tip">Shortcut: Alt + Shift + W</p>
        </div>
      `;
      bubbleOpen = true;
      bubble.classList.add('open');
      window.setTimeout(setBubblePosition, 40);
      focusComposer();
    };

    const renderLoading = (question: string) => {
      surface = 'agent';
      activeStep = -1;
      tourMoving = false;
      window.clearTimeout(movementTimer);
      window.clearTimeout(arrivalTimer);
      helper.classList.add('stationed');
      highlight.classList.remove('visible');
      bubble.classList.add('agent');
      copy.innerHTML = `
        <div class="wf-loading">
          <div class="wf-loading-mark" aria-hidden="true"></div>
          <div><div class="wf-kicker"><span>Survey in progress</span><span class="wf-step-count">Live repository</span></div><h2>Reading the terrain</h2><p>${escapeHtml(question)}</p></div>
        </div>
      `;
      setBubblePosition();
    };

    const renderSetupChoice = () => {
      surface = 'agent';
      helper.classList.add('stationed');
      bubble.classList.add('agent', 'open');
      bubbleOpen = true;
      copy.innerHTML = `
        <div class="wf-agent-home">
          <div class="wf-agent-head">
            <div class="wf-kicker"><span>Setup intent</span>${modeSwitch()}</div>
            <h2>What are you setting up?</h2>
            <p>These are different paths, so I will not mix published-package commands with contributor setup.</p>
          </div>
          <div class="wf-question-grid">
            <button type="button" data-question="Help me use this project as a consumer or published package">Use this project</button>
            <button type="button" data-question="Help me develop this repository locally">Develop this repository</button>
          </div>
          <div class="wf-actions"><button type="button" data-action="agent-home">Back</button></div>
        </div>
      `;
      setBubblePosition();
    };

    const ensureRepository = async (forceRefresh = false, signal?: AbortSignal): Promise<RepositoryBundle> => {
      if (repository && !forceRefresh) return repository;
      if (!currentLocation) throw new WayfinderRequestError('Open a public GitHub repository before asking Wayfinder.', 'repository-unavailable');
      const key = repositoryCacheKey(currentLocation.owner, currentLocation.repo, currentLocation.ref);
      const cached = await getCached<RepositoryBundle>(storage, key).catch(() => null);
      const stale = cached ?? await getCached<RepositoryBundle>(storage, key, Date.now(), true).catch(() => null);
      if (cached && !forceRefresh) {
        repository = cached.value;
        repositoryCachedAt = cached.cachedAt;
        repositoryCacheState = 'cached';
        return repository;
      }

      try {
        const mapResponse = await fetch(`${apiUrl}/map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner: currentLocation.owner, repo: currentLocation.repo, ref: currentLocation.ref }),
          signal,
        });
        if (!mapResponse.ok) {
          const failure = await mapResponse.json().catch(() => null) as Partial<WayfinderErrorResponse> | null;
          throw new WayfinderRequestError(
            failure?.message ?? 'Wayfinder could not map this repository.',
            failure?.code ?? 'request-failed',
            failure?.resetAt,
          );
        }
        const map = await mapResponse.json() as RepoMap;
        const tourResponse = await fetch(`${apiUrl}/tour`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map }),
          signal,
        });
        if (!tourResponse.ok) throw new WayfinderRequestError('Wayfinder could not assemble the repository route.', 'upstream-unavailable');
        const tour = await tourResponse.json() as RepoTour;
        repository = { map, tour };
        repositoryCachedAt = new Date().toISOString();
        repositoryCacheState = 'fresh';
        if (forceRefresh) await clearRepositoryCache(storage, map.repo).catch(() => undefined);
        await setCached(storage, key, map.repo, 'repository', repository, repositoryCacheTtl).catch(() => undefined);
        return repository;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (stale) {
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

    const pathButton = (path: string, label = path, lines?: [number, number]) => {
      const lineData = lines ? ` data-lines="${lines[0]},${lines[1]}"` : '';
      return `<button type="button" class="wf-open" data-path="${escapeHtml(path)}"${lineData}>${escapeHtml(label)} ↗</button>`;
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
      const entryPoint = tour.entryPoints[0]?.path ?? 'Not confidently detected';
      const commands = guide ? [...guide.steps]
        .sort((left, right) => {
          const priority = (title: string) => /install dependencies/i.test(title) ? 0 : /start/i.test(title) ? 1 : /test/i.test(title) ? 2 : /build/i.test(title) ? 3 : 4;
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
          <div class="wf-fact wide"><span>Likely entry point</span><strong>${escapeHtml(entryPoint)}</strong>${entryPoint !== 'Not confidently detected' ? pathButton(entryPoint, 'Open entry point') : ''}</div>
          <div class="wf-fact wide"><span>Local workflow</span><strong>${escapeHtml(commands.join(' · ') || 'No trustworthy setup commands found')}</strong></div>
        </div>
      `;
    };

    const renderAnswer = (answer: AgentAnswer) => {
      const bundle = repository;
      if (!bundle) return;
      surface = 'agent';
      activeAnswer = answer;
      void saveTrail();
      const sections: string[] = [];

      if (answer.brief?.length) {
        sections.push(`<ol class="wf-brief">${answer.brief.map((step, index) => `<li><strong>${String(index + 1).padStart(2, '0')} ${escapeHtml(step.title)}</strong><p>${escapeHtml(step.action)}</p>${step.evidencePath ? pathButton(step.evidencePath) : ''}</li>`).join('')}</ol>`);
      }

      if (answer.intent === 'orientation') {
        sections.push(repositorySnapshot(bundle, answer.guide));
        sections.push(`<details class="wf-detail" ${experienceMode === 'guided' ? 'open' : ''}><summary>Recommended reading route</summary><ol class="wf-route-list">${answer.tour.stops.slice(0, 5).map((stop) => `<li><strong>${String(stop.order).padStart(2, '0')} ${escapeHtml(stop.path)}</strong><p>${escapeHtml(stop.explanation)}</p>${pathButton(stop.path, 'Open file', stop.lines)}</li>`).join('')}</ol></details>`);
      }

      if (answer.intent === 'installation') {
        const meta = `<div class="wf-answer-mode"><span>${escapeHtml(answer.guide.packageManager ?? 'Package manager not detected')}</span><span>${escapeHtml(answer.guide.runtimes.join(', ') || 'Runtime not specified')}</span></div>`;
        const prerequisites = answer.guide.prerequisites.length
          ? `<ol class="wf-route-list">${answer.guide.prerequisites.map((item) => `<li><strong>Prerequisite</strong><p>${escapeHtml(item.text)}</p><span class="wf-confidence">${escapeHtml(item.confidence)}</span>${pathButton(item.evidence.path, item.evidence.path, item.evidence.lines)}</li>`).join('')}</ol>`
          : '';
        const steps = answer.guide.steps.map((step) => `<li><strong>${String(step.order).padStart(2, '0')} ${escapeHtml(step.title)}</strong><span class="wf-confidence">${escapeHtml(step.confidence)}</span><button type="button" class="wf-copy-command" data-command="${escapeHtml(step.command)}">${escapeHtml(step.command)}</button>${pathButton(step.evidence.path, step.evidence.path, step.evidence.lines)}</li>`).join('');
        const warnings = answer.guide.warnings.length ? `<ul class="wf-warning-list">${answer.guide.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : '';
        sections.push(`${meta}${warnings}${prerequisites}<ol class="wf-route-list">${steps || '<li><p>No trustworthy contributor setup command was found.</p></li>'}</ol>`);
      }

      if (answer.intent === 'file-find') {
        sections.push(`<div class="wf-result-list">${answer.finder.results.slice(0, 6).map((result) => `<article class="wf-result"><strong>${escapeHtml(result.path)}</strong><span class="wf-confidence">${escapeHtml(result.confidence)} match</span><p>${escapeHtml(result.reason)}</p><div class="wf-signal-list">${result.signals.map((signal) => `<span class="wf-signal">${escapeHtml(signal.replaceAll('-', ' '))}</span>`).join('')}</div>${result.snippet ? `<p class="wf-detail"><code>${escapeHtml(result.snippet)}</code></p>` : ''}${pathButton(result.path, 'Open coordinate', result.lines)}</article>`).join('') || '<div class="wf-error"><p>No credible coordinate was found. Try a filename, symbol, or narrower feature description.</p></div>'}</div>`);
      }

      if (answer.intent === 'file-context') {
        const imports = answer.imports.length
          ? `<div class="wf-fact wide"><span>Direct imports</span><strong>${answer.imports.map(escapeHtml).join(' · ')}</strong></div>`
          : '<div class="wf-fact wide"><span>Direct imports</span><strong>No imports were confidently extracted</strong></div>';
        const related = answer.relatedPaths.length
          ? `<ol class="wf-route-list">${answer.relatedPaths.map((path) => `<li><strong>${escapeHtml(path)}</strong>${pathButton(path, 'Open dependency')}</li>`).join('')}</ol>`
          : '<div class="wf-boundary">No local dependency path could be resolved from this file. Package imports may point outside the repository.</div>';
        const tests = answer.tests.results.slice(0, 4).map((result) => `<article class="wf-result"><strong>${escapeHtml(result.path)}</strong><span class="wf-confidence">${escapeHtml(result.confidence)} match</span><p>${escapeHtml(result.reason)}</p>${pathButton(result.path, 'Open test', result.lines)}</article>`).join('');
        const callers = answer.callers.results.slice(0, 4).map((result) => `<article class="wf-result"><strong>${escapeHtml(result.path)}</strong><span class="wf-confidence">${escapeHtml(result.confidence)} match</span><p>${escapeHtml(result.reason)}</p>${pathButton(result.path, 'Open likely caller', result.lines)}</article>`).join('');
        sections.push(`<div class="wf-snapshot"><div class="wf-fact wide"><span>Current file</span><strong>${escapeHtml(answer.currentPath)}</strong></div>${imports}</div><div class="wf-detail"><div class="wf-kicker"><span>Local dependencies</span></div>${related}</div><div><div class="wf-kicker"><span>Likely callers</span></div><div class="wf-result-list">${callers || '<div class="wf-boundary">No credible caller was found in the bounded evidence search.</div>'}</div></div><div><div class="wf-kicker"><span>Likely paired tests</span></div><div class="wf-result-list">${tests || '<div class="wf-boundary">No credible paired test was found.</div>'}</div></div>`);
      }

      if (answer.intent === 'contribution' && !answer.brief?.length) {
        const setup = answer.trail.guide.steps.slice(0, 2).map((step) => `<button type="button" class="wf-copy-command" data-command="${escapeHtml(step.command)}">${escapeHtml(step.command)}</button>`).join('');
        const implementation = answer.trail.implementation.results[0];
        const verification = answer.trail.verification.results[0];
        sections.push(`<ol class="wf-route-list"><li><strong>01 Establish a baseline</strong>${setup || '<p>Review the field notes before changing the repository.</p>'}</li><li><strong>02 Open the likely implementation</strong><p>${escapeHtml(implementation?.reason ?? 'No strong implementation coordinate was found.')}</p>${implementation ? pathButton(implementation.path, implementation.path, implementation.lines) : ''}</li><li><strong>03 Follow the verification path</strong><p>${escapeHtml(verification?.reason ?? 'No related verification coordinate was found.')}</p>${verification ? pathButton(verification.path, verification.path, verification.lines) : ''}</li></ol>`);
      }

      const evidence = answer.evidencePaths?.length
        ? `<div class="wf-evidence">${answer.evidencePaths.map((path) => `<button type="button" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join('')}</div>`
        : '';
      const followups = answer.suggestions.length
        ? `<div class="wf-followups">${answer.suggestions.map((suggestion) => `<button type="button" data-question="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`).join('')}</div>`
        : '';
      const refWarning = bundle.map.requestedRef && bundle.map.requestedRef !== bundle.map.resolvedRef
        ? `<ul class="wf-warning-list"><li>You opened ${escapeHtml(bundle.map.requestedRef)}, but the repository map resolved ${escapeHtml(bundle.map.resolvedRef)}. Verify the branch before acting on this answer.</li></ul>`
        : '';
      const provenance = answer.mode === 'gpt-5.6'
        ? ['AI-assisted plan', 'Repository evidence verified']
        : ['Verified repository map', `${bundle.map.resolvedRef} · ${bundle.map.sha.slice(0, 8)}`];

      copy.innerHTML = `
        <div class="wf-answer ${answerDepth === 'concise' ? 'concise' : ''}">
          <div class="wf-answer-nav"><button type="button" data-action="agent-home">← New question</button>${modeSwitch()}</div>
          <div class="wf-kicker"><span>${escapeHtml(answer.intent.replace('-', ' '))}</span><span class="wf-step-count">${escapeHtml(bundle.map.repo)}</span></div>
          <div class="wf-answer-mode ${answer.mode === 'gpt-5.6' ? 'model' : ''}"><span>${escapeHtml(provenance[0])}</span><span>${escapeHtml(provenance[1])}</span></div>
          ${refWarning}
          ${cacheNote()}
          <h2 class="wf-sr-only">Wayfinder trail report</h2>
          <p class="wf-answer-summary">${escapeHtml(answer.summary)}</p>
          ${answer.explanation ? `<p class="wf-answer-explanation">${escapeHtml(answer.explanation)}</p>` : ''}
          ${sections.join('')}
          ${evidence}
          ${followups}
          <div class="wf-answer-nav"><div class="wf-detail-toggle"><button type="button" data-depth="concise">Make concise</button><button type="button" data-depth="expanded">Explain more</button></div><button type="button" data-action="refresh-answer">Refresh ↻</button></div>
        </div>
      `;
      bubble.classList.add('agent');
      bubble.scrollTop = 0;
      setBubblePosition();
      bubble.focus({ preventScroll: true });
    };

    const renderAgentError = (error: WayfinderRequestError) => {
      surface = 'agent';
      const labels: Record<WayfinderErrorResponse['code'], [string, string]> = {
        'github-rate-limited': ['GitHub rate limit reached', error.resetAt ? `Try again after ${new Date(error.resetAt).toLocaleString()}.` : 'Wait a few minutes, then try again.'],
        'repository-unavailable': ['Repository unavailable', 'The repository may be private, missing, or inaccessible without authentication.'],
        'github-auth-failed': ['GitHub authentication failed', 'The repository service could not authenticate with GitHub.'],
        'upstream-unavailable': ['Connection interrupted', 'Check your connection. A cached answer will be used automatically when one is available.'],
        'request-failed': ['Survey interrupted', 'Try the request again or ask a narrower question.'],
      };
      const [title, recovery] = labels[error.code];
      copy.innerHTML = `<div class="wf-answer"><div class="wf-kicker"><span>Trail interrupted</span><span class="wf-step-count">${escapeHtml(error.code.replaceAll('-', ' '))}</span></div><h2>${escapeHtml(title)}</h2><div class="wf-error"><p>${escapeHtml(error.message)}</p><p>${escapeHtml(recovery)}</p></div><div class="wf-actions"><button class="primary" type="button" data-action="retry-answer">Try again</button><button type="button" data-action="agent-home">New question</button></div></div>`;
      setBubblePosition();
      bubble.focus({ preventScroll: true });
    };

    const askAgent = async (question: string, forceRefresh = false) => {
      const trimmed = question.trim();
      if (trimmed.length < 2) return;
      const version = ++requestVersion;
      activeRequest?.abort();
      activeRequest = new AbortController();
      const { signal } = activeRequest;
      activeQuestion = trimmed;
      answerCachedAt = null;
      renderLoading(trimmed);
      let fallbackAnswer: { value: AgentAnswer; cachedAt: string; expiresAt: string } | null = null;
      try {
        const bundle = await ensureRepository(forceRefresh, signal);
        if (version !== requestVersion || signal.aborted) return;
        const key = agentResponseCacheKey(bundle.map.repo, bundle.map.sha, trimmed, currentLocation?.path ?? null);
        fallbackAnswer = await getCached<AgentAnswer>(storage, key, Date.now(), true).catch(() => null);
        if (!forceRefresh) {
          const cached = fallbackAnswer && Date.parse(fallbackAnswer.expiresAt) > Date.now() ? fallbackAnswer : null;
          if (cached) {
            answerCachedAt = cached.cachedAt;
            return renderAnswer(cached.value);
          }
        }
        const response = await fetch(`${apiUrl}/agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map: bundle.map, query: trimmed, currentPath: currentLocation?.path ?? null }),
          signal,
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => null) as Partial<WayfinderErrorResponse> | null;
          throw new WayfinderRequestError(failure?.message ?? 'The guide could not complete that dispatch.', failure?.code ?? 'request-failed', failure?.resetAt);
        }
        const answer = await response.json() as AgentAnswer;
        if (version !== requestVersion || signal.aborted) return;
        await setCached(storage, key, bundle.map.repo, 'agent', answer, agentCacheTtl).catch(() => undefined);
        answerCachedAt = null;
        renderAnswer(answer);
      } catch (error) {
        if (signal.aborted || version !== requestVersion) return;
        if (fallbackAnswer) {
          answerCachedAt = fallbackAnswer.cachedAt;
          renderAnswer(fallbackAnswer.value);
          return;
        }
        renderAgentError(error instanceof WayfinderRequestError
          ? error
          : new WayfinderRequestError('The guide could not complete that dispatch.', 'upstream-unavailable'));
      }
    };

    const renderWelcome = () => {
      surface = 'welcome';
      bubble.classList.remove('agent');
      if (!experienceMode) {
        copy.innerHTML = `
          <div class="wf-kicker"><span>Wayfinder</span><span class="wf-step-count">Choose your pace</span></div>
          <h2>How should I help?</h2>
          <p>Choose a guided explanation or a compact project map. You can switch anytime.</p>
          <div class="wf-actions">
            <button class="primary" type="button" data-action="choose-guided">Guide me</button>
            <button type="button" data-action="choose-quick">Quick map</button>
          </div>
          <p class="wf-tip">Guided explains GitHub as you go. Quick stays quiet and leads with the answer.</p>
        `;
        return;
      }
      if (experienceMode === 'quick') {
        renderAgentHome();
        return;
      }
      if (stops.length === 0) {
        copy.innerHTML = `
          <div class="wf-kicker"><span>Wayfinder on the page</span><span class="wf-step-count">Repository context</span></div>
          <h2>No visible landmarks yet.</h2>
          <p>This may be an empty, unavailable, or still-loading repository page. I can still try to map its public files.</p>
          <div class="wf-actions"><button class="primary" type="button" data-action="agent-home">Ask Wayfinder</button></div>
        `;
        return;
      }
      copy.innerHTML = `
        <div class="wf-kicker"><span>Guided mode</span>${modeSwitch()}</div>
        <h2>Learn this repository one landmark at a time.</h2>
        <p>I will move only when pointing something out, explain the GitHub term, and connect it to a fact about this project.</p>
        <div class="wf-actions">
          <button class="primary" type="button" data-action="start">Show me around</button>
          <button type="button" data-action="agent-home">Ask a question</button>
        </div>
        <p class="wf-tip">Click me anytime or press Alt + Shift + W.</p>
      `;
    };

    const projectFact = (stop: GuideStop): string | null => {
      if (!repository) return null;
      const { map, tour } = repository;
      if (stop.label === 'Repository name') return map.description || tour.summary;
      if (stop.label === 'Current branch') return `${map.resolvedRef} is the version Wayfinder mapped at commit ${map.sha.slice(0, 12)}. The default branch is ${map.defaultBranch}.`;
      if (stop.label === 'File tree') return `Detected stack: ${tour.stack.join(', ') || map.language || 'not confidently detected'}. Likely entry point: ${tour.entryPoints[0]?.path ?? 'not confidently detected'}.`;
      if (stop.label === 'README') return tour.summary;
      if (currentLocation?.path) return `Current file: ${currentLocation.path}. Wayfinder will use it as the starting context for questions.`;
      return null;
    };

    const renderStep = () => {
      const stop = stops[activeStep];
      if (!stop) return;
      surface = 'tour';
      const fact = projectFact(stop);
      copy.innerHTML = `
        <div class="wf-kicker"><span>${stop.label}</span><span class="wf-step-count">${activeStep + 1} / ${stops.length}</span></div>
        <h2>${stop.title}</h2>
        <p>${stop.explanation}</p>
        ${fact ? `<div class="wf-project-fact"><strong>In this project</strong><p>${escapeHtml(fact)}</p></div>` : ''}
        <div class="wf-actions">
          ${activeStep > 0 ? '<button type="button" data-action="previous">Back</button>' : ''}
          <button class="primary" type="button" data-action="next">${activeStep === stops.length - 1 ? 'Finish tour' : 'Next landmark'}</button>
          <button type="button" data-action="ask-highlight">Explain this</button>
        </div>
      `;
    };

    const renderHighlightedAnswer = (stop: GuideStop) => {
      surface = 'context';
      tourMoving = false;
      helper.classList.add('stationed');
      const excerpt = (stop.target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
      copy.innerHTML = `
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
      `;
      bubble.classList.remove('agent');
      bubbleOpen = true;
      bubble.classList.add('open');
      setBubblePosition();
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
      setBubblePosition();
      bubbleOpen = true;
      bubble.classList.add('open');
    };

    const moveToActiveStop = () => {
      const stop = stops[activeStep];
      if (!stop || !document.contains(stop.target)) return;
      tourMoving = true;
      surface = 'tour';
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

    const endTour = () => {
      surface = 'complete';
      activeStep = -1;
      highlight.classList.remove('visible');
      helper.classList.add('stationed');
      copy.innerHTML = `
        <div class="wf-kicker"><span>Trail complete</span><span class="wf-step-count">Ready</span></div>
        <h2>You know the lay of the land.</h2>
        <p>Ask me for installation steps, a file coordinate, or a contribution plan grounded in this repository.</p>
        <div class="wf-actions"><button class="primary" type="button" data-action="agent-home">Ask Wayfinder</button><button type="button" data-action="restart">Tour again</button></div>
      `;
      window.setTimeout(setBubblePosition, 700);
    };

    const showWelcome = () => {
      stops = guideStops();
      renderWelcome();
      bubbleOpen = true;
      bubble.classList.add('open');
      setBubblePosition();
    };

    const startGuidedTour = async () => {
      stops = guideStops();
      if (stops.length === 0) return;
      rememberRepo();
      renderLoading('Mapping project facts for the guided tour');
      await ensureRepository(false).catch(() => null);
      activeStep = 0;
      moveToActiveStop();
    };

    copy.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (!button) return;
      const selectedMode = button.dataset.mode as ExperienceMode | undefined;
      if (selectedMode === 'guided' || selectedMode === 'quick') {
        experienceMode = selectedMode;
        answerDepth = selectedMode === 'quick' ? 'concise' : 'expanded';
        rememberRepo();
        void savePreferences();
        if (activeAnswer && repository) renderAnswer(activeAnswer);
        else if (selectedMode === 'guided') showWelcome();
        else renderAgentHome();
        return;
      }
      const selectedDepth = button.dataset.depth as AnswerDepth | undefined;
      if ((selectedDepth === 'concise' || selectedDepth === 'expanded') && activeAnswer) {
        answerDepth = selectedDepth;
        renderAnswer(activeAnswer);
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
      const path = button.dataset.path;
      if (path && repository) {
        const lineParts = button.dataset.lines?.split(',').map(Number);
        const lines = lineParts?.length === 2 ? [lineParts[0], lineParts[1]] as [number, number] : undefined;
        window.location.href = fileUrl(repository.map, path, lines);
        return;
      }
      const command = button.dataset.command;
      if (command) {
        void navigator.clipboard.writeText(command).then(() => {
          const original = button.textContent;
          button.textContent = 'Copied to clipboard';
          window.setTimeout(() => { button.textContent = original; }, 1_400);
        }).catch(() => { button.textContent = 'Copy failed'; });
        return;
      }
      const action = button.dataset.action;
      if (action === 'agent-home') {
        renderAgentHome();
        return;
      }
      if (action === 'back-to-trail' && activeAnswer) {
        const savedAnswer = activeAnswer;
        void ensureRepository(false).then((bundle) => {
          if (bundle.map.sha !== savedAnswer.sha) {
            activeAnswer = null;
            renderAgentHome();
            return;
          }
          renderAnswer(savedAnswer);
        }).catch(() => renderAgentHome());
        return;
      }
      if (action === 'setup-choice') {
        renderSetupChoice();
        return;
      }
      if (action === 'choose-guided') {
        experienceMode = 'guided';
        answerDepth = 'expanded';
        rememberRepo();
        void savePreferences();
        showWelcome();
        return;
      }
      if (action === 'choose-quick') {
        experienceMode = 'quick';
        answerDepth = 'concise';
        rememberRepo();
        void savePreferences();
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
        void askAgent(activeQuestion, true);
        return;
      }
      if (action === 'retry-answer') {
        void askAgent(activeQuestion);
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
        bubbleOpen = false;
        bubble.classList.remove('open');
        return;
      }
      if (!copy.hasChildNodes()) renderWelcome();
      bubbleOpen = true;
      bubble.classList.add('open');
      setBubblePosition();
      const composer = shadow.querySelector<HTMLTextAreaElement>('#wf-question');
      if (composer) composer.focus({ preventScroll: true });
      else bubble.focus({ preventScroll: true });
    });

    close.addEventListener('click', () => {
      bubbleOpen = false;
      bubble.classList.remove('open');
      helper.focus({ preventScroll: true });
    });

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        helper.click();
        return;
      }
      if (event.key !== 'Escape' || !bubbleOpen) return;
      event.preventDefault();
      bubbleOpen = false;
      bubble.classList.remove('open');
      window.setTimeout(() => helper.focus({ preventScroll: true }), 50);
    };
    document.addEventListener('keydown', closeOnEscape, true);

    const publishLocation = () => {
      scheduled = false;
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      requestVersion += 1;
      activeRequest?.abort();
      activeRequest = null;
      answerCachedAt = null;
      activeStep = -1;
      tourMoving = false;
      window.clearTimeout(movementTimer);
      window.clearTimeout(arrivalTimer);
      dock.classList.add('settled');
      window.setTimeout(() => dock.classList.remove('settled'), 1_250);
      highlight.classList.remove('visible');
      helper.classList.add('stationed');
      const nextLocation = parseGitHubUrl(lastUrl, visibleBranchRef());
      const previousRepo = currentLocation ? `${currentLocation.owner}/${currentLocation.repo}` : null;
      const previousRef = currentLocation?.ref ?? null;
      const nextRepo = nextLocation ? `${nextLocation.owner}/${nextLocation.repo}` : null;
      const repoChanged = previousRepo !== nextRepo;
      const pinnedEvidenceNavigation = Boolean(nextLocation?.ref && repository?.map.sha === nextLocation.ref);
      const refChanged = !repoChanged && previousRef !== nextLocation?.ref && !pinnedEvidenceNavigation;
      currentLocation = nextLocation;
      const publishedUrl = lastUrl;
      host.hidden = !nextLocation;
      if (!nextLocation) {
        bubbleOpen = false;
        bubble.classList.remove('open');
      }
      if (repoChanged || refChanged) {
        repository = null;
        repositoryCachedAt = null;
        repositoryCacheState = 'fresh';
        activeAnswer = null;
      }
      if (!bubbleOpen) copy.replaceChildren();

      window.setTimeout(() => {
        if (window.location.href !== publishedUrl || lastUrl !== publishedUrl) return;
        void loadPreferences().then(async () => {
          if (window.location.href !== publishedUrl || lastUrl !== publishedUrl) return;
          stops = guideStops();
          const normalizedRepo = nextRepo?.toLowerCase() ?? null;
          const seen = normalizedRepo ? seenRepos.includes(normalizedRepo) : false;
          host.dataset.seen = String(seen);
          if (repoChanged && nextRepo) await loadTrail(nextRepo);
          if (!welcomeShown && stops.length > 0 && (!experienceMode || (experienceMode === 'guided' && !seen))) {
            welcomeShown = true;
            showWelcome();
          } else if (bubbleOpen && nextLocation) {
            if (surface === 'agent' && activeAnswer && repository) renderAnswer(activeAnswer);
            else if (surface === 'agent') renderAgentHome();
            else renderWelcome();
            setBubblePosition();
          } else if (!bubbleOpen) {
            copy.replaceChildren();
          }
        });
      }, 1_200);
    };

    const schedulePublish = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(publishLocation);
    };

    window.addEventListener('popstate', schedulePublish);
    document.addEventListener('turbo:load', schedulePublish);
    window.addEventListener('resize', syncViewport);
    window.addEventListener('scroll', syncViewport, { passive: true, capture: true });

    let locationTimer = 0;
    const mountHelper = () => {
      if (host.isConnected) return;
      document.body.append(host);
      publishLocation();
      locationTimer = window.setInterval(schedulePublish, 500);
    };

    mountHelper();

    return () => {
      window.clearTimeout(movementTimer);
      window.clearTimeout(arrivalTimer);
      window.clearInterval(locationTimer);
      activeRequest?.abort();
      openStateObserver.disconnect();
      window.cancelAnimationFrame(viewportFrame);
      document.removeEventListener('DOMContentLoaded', mountHelper);
      window.removeEventListener('popstate', schedulePublish);
      document.removeEventListener('turbo:load', schedulePublish);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('scroll', syncViewport, { capture: true });
      host.remove();
    };
  },
});
