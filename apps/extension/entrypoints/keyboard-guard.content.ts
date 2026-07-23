const helperHostId = 'wayfinder-page-guide';
const readyAttribute = 'data-wayfinder-keyboard-guard';

function editorIsFocused(host: HTMLElement): boolean {
  const active = host.shadowRoot?.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  const name = active.nodeName.toLowerCase();
  return name === 'textarea'
    || name === 'select'
    || (name === 'input' && !['submit', 'reset', 'checkbox', 'radio', 'file'].includes(active.getAttribute('type')?.toLowerCase() ?? ''))
    || active.isContentEditable;
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const guardedHosts = new WeakSet<HTMLElement>();
    const markEditorHost = (event: KeyboardEvent) => {
      const host = event.target;
      if (!(host instanceof HTMLElement) || host.id !== helperHostId || guardedHosts.has(host)) return;

      // Open-shadow keyboard events are retargeted to the host by the time
      // GitHub's document listener sees them. @github/hotkey calls
      // target.isContentEditable to decide whether to ignore a keystroke. A
      // getter recomputes the answer from the live focus state on every
      // keystroke — a latched `true` would permanently disable GitHub's
      // hotkeys after the first time the helper's editor took focus.
      guardedHosts.add(host);
      Object.defineProperty(host, 'isContentEditable', {
        configurable: true,
        get: () => editorIsFocused(host),
      });
    };

    let readyObserver: MutationObserver | null = null;
    const markReady = () => {
      if (!document.documentElement) return false;
      document.documentElement.setAttribute(readyAttribute, 'ready');
      return true;
    };
    if (!markReady()) {
      readyObserver = new MutationObserver(() => {
        if (!markReady()) return;
        readyObserver?.disconnect();
        readyObserver = null;
      });
      readyObserver.observe(document, { childList: true });
    }

    document.addEventListener('keydown', markEditorHost, true);

    return () => {
      readyObserver?.disconnect();
      document.removeEventListener('keydown', markEditorHost, true);
      document.documentElement?.removeAttribute(readyAttribute);
    };
  },
});
