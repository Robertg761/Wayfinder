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
    const markEditorHost = (event: KeyboardEvent) => {
      const host = event.target;
      if (!(host instanceof HTMLElement) || host.id !== helperHostId || !editorIsFocused(host)) return;

      // Open-shadow keyboard events are retargeted to the host by the time
      // GitHub's document listener sees them. @github/hotkey calls
      // target.isContentEditable to decide whether to ignore a keystroke. An
      // own JS property gives that guard the correct answer without making the
      // host an actual editing surface or changing textarea input behavior.
      Object.defineProperty(host, 'isContentEditable', { configurable: true, value: true });
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
