import type { WayfinderMessage } from '@wayfinder/contracts';
import { parseGitHubUrl } from '@/lib/github-url';

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

  * { box-sizing: border-box; }

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

  .wf-helper {
    position: fixed;
    left: calc(100vw - 82px);
    top: calc(100vh - 86px);
    width: 56px;
    height: 64px;
    pointer-events: auto;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    filter: drop-shadow(0 9px 10px rgba(24, 22, 18, 0.24));
    transition: left 680ms cubic-bezier(.2,.84,.24,1.12), top 680ms cubic-bezier(.2,.84,.24,1.12), transform 180ms ease;
  }

  .wf-helper:hover { transform: translateY(-3px) rotate(-2deg); }
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

  .wf-bubble {
    position: fixed;
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

  @keyframes wf-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
  @keyframes wf-seek { 0%,100% { transform: rotate(-28deg) } 48% { transform: rotate(24deg) } 60% { transform: rotate(19deg) } }
  @keyframes wf-ping { 0% { box-shadow: 0 0 0 0 rgba(181,79,44,.45) } 70%,100% { box-shadow: 0 0 0 9px rgba(181,79,44,0) } }

  @media (prefers-reduced-motion: reduce) {
    .wf-helper, .wf-highlight, .wf-bubble { transition-duration: 0ms; }
    .wf-body, .wf-needle, .wf-ping { animation: none; }
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

function guideStops(): GuideStop[] {
  const location = parseGitHubUrl(window.location.href);
  if (!location) return [];

  const candidates: Array<Omit<GuideStop, 'target'> & { selectors: string[] }> = location.view === 'blob'
    ? [
        {
          label: 'Current coordinate',
          title: 'You are inside one file',
          explanation: 'This breadcrumb is your trail back through the repository. Each segment opens a wider part of the project.',
          selectors: ['nav[aria-label="Breadcrumbs"]', '[data-testid="breadcrumbs"]', '.react-code-file-contents + nav'],
        },
        {
          label: 'Source landmark',
          title: 'Read the shape before the details',
          explanation: 'This is the file Wayfinder brought you to. Scan exports, types, and top-level functions first, then follow the line markers.',
          selectors: ['[data-testid="code-viewer"]', '.react-code-file-contents', 'table.highlight'],
        },
        {
          label: 'Line coordinates',
          title: 'Every line is a shareable coordinate',
          explanation: 'Click a line number to pin it in the URL. Wayfinder uses these same coordinates when it cites evidence.',
          selectors: ['[data-line-number]', '.blob-num', 'td[id^="L"]'],
        },
      ]
    : [
        {
          label: 'Repository coordinates',
          title: `${location.owner} / ${location.repo}`,
          explanation: 'This is the project boundary. Wayfinder reads the public tree inside it and keeps every answer tied to this repository.',
          selectors: ['[itemprop="name"]', 'strong[itemprop="name"]', 'h1 strong a'],
        },
        {
          label: 'Branch marker',
          title: 'Choose the trail you are reading',
          explanation: 'The branch controls which version of every file you see. Start on the default branch unless an issue points somewhere else.',
          selectors: ['button[data-hotkey="w"]', '[data-testid="anchor-button"] span[data-component="text"]', 'summary[title*="Switch branches"]'],
        },
        {
          label: 'Terrain map',
          title: 'The file tree tells a story',
          explanation: 'Folders reveal the architecture. Start with field notes and package files, then follow source and tests as a pair.',
          selectors: ['table[aria-labelledby="folders-and-files"]', 'table[aria-label="Folders and files"]', 'div[role="grid"]'],
        },
        {
          label: 'Field notes',
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
  runAt: 'document_start',
  main() {
    let lastUrl = '';
    let scheduled = false;
    let stops: GuideStop[] = [];
    let activeStep = -1;
    let bubbleOpen = false;
    let welcomeShown = false;
    let movementTimer = 0;
    let viewportFrame = 0;

    const host = document.createElement('div');
    host.id = 'wayfinder-page-guide';
    host.setAttribute('data-wayfinder', 'page-guide');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${helperStyles}</style>
      <div class="wf-layer" aria-live="polite">
        <div class="wf-highlight" aria-hidden="true"></div>
        <button class="wf-helper" type="button" aria-label="Open Wayfinder helper" title="Wayfinder">
          <span class="wf-body"><span class="wf-face"></span><span class="wf-needle"></span></span>
          <span class="wf-feet"></span>
          <span class="wf-ping"></span>
        </button>
        <aside class="wf-bubble" aria-label="Wayfinder helper">
          <button class="wf-close" type="button" aria-label="Close helper">×</button>
          <div class="wf-copy"></div>
        </aside>
      </div>
    `;

    const helper = shadow.querySelector<HTMLButtonElement>('.wf-helper')!;
    const highlight = shadow.querySelector<HTMLDivElement>('.wf-highlight')!;
    const bubble = shadow.querySelector<HTMLElement>('.wf-bubble')!;
    const copy = shadow.querySelector<HTMLDivElement>('.wf-copy')!;
    const close = shadow.querySelector<HTMLButtonElement>('.wf-close')!;

    const setBubblePosition = () => {
      const helperRect = helper.getBoundingClientRect();
      const width = Math.min(326, window.innerWidth - 28);
      const left = Math.max(14, Math.min(window.innerWidth - width - 14, helperRect.right - width));
      const preferredTop = helperRect.top - Math.min(250, bubble.scrollHeight || 220) - 14;
      const top = preferredTop > 14 ? preferredTop : Math.min(window.innerHeight - 240, helperRect.bottom + 14);
      bubble.style.left = `${left}px`;
      bubble.style.top = `${Math.max(14, top)}px`;
    };

    const renderWelcome = () => {
      copy.innerHTML = `
        <div class="wf-kicker"><span>Wayfinder on the page</span><span class="wf-step-count">${stops.length} landmarks</span></div>
        <h2>I found a trail through this page.</h2>
        <p>I can float to the important parts, point them out, and explain what each one tells you about the repository.</p>
        <div class="wf-actions">
          <button class="primary" type="button" data-action="start">Show me around</button>
          <button type="button" data-action="panel">Ask the full guide</button>
        </div>
        <p class="wf-tip">Tip: click me anytime to bring the guide back.</p>
      `;
    };

    const renderStep = () => {
      const stop = stops[activeStep];
      if (!stop) return;
      copy.innerHTML = `
        <div class="wf-kicker"><span>${stop.label}</span><span class="wf-step-count">${activeStep + 1} / ${stops.length}</span></div>
        <h2>${stop.title}</h2>
        <p>${stop.explanation}</p>
        <div class="wf-actions">
          ${activeStep > 0 ? '<button type="button" data-action="previous">Back</button>' : ''}
          <button class="primary" type="button" data-action="next">${activeStep === stops.length - 1 ? 'Finish tour' : 'Next landmark'}</button>
          <button type="button" data-action="panel">Ask about this</button>
        </div>
      `;
    };

    const positionAtActiveStop = (settleBubble = false) => {
      const stop = stops[activeStep];
      if (!stop || !document.contains(stop.target)) return;
      const rect = stop.target.getBoundingClientRect();
      const helperX = rect.right + 16 + 56 < window.innerWidth ? rect.right + 16 : Math.max(14, rect.left - 70);
      const helperY = Math.max(14, Math.min(window.innerHeight - 78, rect.top + Math.min(18, rect.height / 3)));
      helper.style.left = `${helperX}px`;
      helper.style.top = `${helperY}px`;
      highlight.style.left = `${Math.max(4, rect.left - 5)}px`;
      highlight.style.top = `${Math.max(4, rect.top - 5)}px`;
      highlight.style.width = `${Math.min(window.innerWidth - Math.max(4, rect.left - 5) - 4, rect.width + 10)}px`;
      highlight.style.height = `${Math.min(window.innerHeight - Math.max(4, rect.top - 5) - 4, rect.height + 10)}px`;
      highlight.classList.add('visible');
      renderStep();
      setBubblePosition();
      if (settleBubble) window.setTimeout(setBubblePosition, 720);
      bubbleOpen = true;
      bubble.classList.add('open');
    };

    const moveToActiveStop = () => {
      const stop = stops[activeStep];
      if (!stop || !document.contains(stop.target)) return;
      stop.target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      window.clearTimeout(movementTimer);
      movementTimer = window.setTimeout(() => positionAtActiveStop(true), 520);
    };

    const syncViewport = () => {
      window.cancelAnimationFrame(viewportFrame);
      viewportFrame = window.requestAnimationFrame(() => {
        if (activeStep >= 0) positionAtActiveStop();
        else if (bubbleOpen) setBubblePosition();
      });
    };

    const endTour = () => {
      activeStep = -1;
      highlight.classList.remove('visible');
      helper.style.left = 'calc(100vw - 82px)';
      helper.style.top = 'calc(100vh - 86px)';
      copy.innerHTML = `
        <div class="wf-kicker"><span>Trail complete</span><span class="wf-step-count">Ready</span></div>
        <h2>You know the lay of the land.</h2>
        <p>Open the full guide when you want installation steps, a file coordinate, or a contribution plan grounded in this repository.</p>
        <div class="wf-actions"><button class="primary" type="button" data-action="panel">Open the full guide</button><button type="button" data-action="restart">Tour again</button></div>
      `;
      window.setTimeout(setBubblePosition, 700);
    };

    const openPanel = () => {
      const message: WayfinderMessage = { type: 'wayfinder:open-panel' };
      void browser.runtime.sendMessage(message).catch(() => undefined);
    };

    const showWelcome = () => {
      stops = guideStops();
      renderWelcome();
      bubbleOpen = true;
      bubble.classList.add('open');
      setBubblePosition();
    };

    copy.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'panel') return openPanel();
      if (action === 'start' || action === 'restart') {
        stops = guideStops();
        if (stops.length === 0) return;
        activeStep = 0;
        moveToActiveStop();
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

    helper.addEventListener('click', () => {
      if (bubbleOpen) {
        bubbleOpen = false;
        bubble.classList.remove('open');
        return;
      }
      if (activeStep >= 0) renderStep();
      else renderWelcome();
      bubbleOpen = true;
      bubble.classList.add('open');
      setBubblePosition();
    });

    close.addEventListener('click', () => {
      bubbleOpen = false;
      bubble.classList.remove('open');
    });

    const publishLocation = () => {
      scheduled = false;
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      activeStep = -1;
      highlight.classList.remove('visible');
      helper.style.left = 'calc(100vw - 82px)';
      helper.style.top = 'calc(100vh - 86px)';

      const message: WayfinderMessage = {
        type: 'wayfinder:context',
        context: parseGitHubUrl(lastUrl),
      };
      void browser.runtime.sendMessage(message).catch(() => undefined);

      window.setTimeout(() => {
        stops = guideStops();
        if (!welcomeShown && stops.length > 0) {
          welcomeShown = true;
          showWelcome();
        } else if (bubbleOpen) {
          renderWelcome();
          setBubblePosition();
        }
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

    let observer: MutationObserver | null = null;
    const mountHelper = () => {
      if (host.isConnected) return;
      (document.body ?? document.documentElement).append(host);
      publishLocation();
      observer = new MutationObserver(schedulePublish);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };

    if (document.body) mountHelper();
    else document.addEventListener('DOMContentLoaded', mountHelper, { once: true });

    return () => {
      window.clearTimeout(movementTimer);
      window.cancelAnimationFrame(viewportFrame);
      document.removeEventListener('DOMContentLoaded', mountHelper);
      window.removeEventListener('popstate', schedulePublish);
      document.removeEventListener('turbo:load', schedulePublish);
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('scroll', syncViewport, { capture: true });
      observer?.disconnect();
      host.remove();
    };
  },
});
