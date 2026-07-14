import type { WayfinderMessage } from '@wayfinder/contracts';
import { parseGitHubUrl } from '@/lib/github-url';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_start',
  main() {
    let lastUrl = '';
    let scheduled = false;

    const publishLocation = () => {
      scheduled = false;
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;

      const message: WayfinderMessage = {
        type: 'wayfinder:context',
        context: parseGitHubUrl(lastUrl),
      };

      void browser.runtime.sendMessage(message).catch(() => undefined);
    };

    const schedulePublish = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(publishLocation);
    };

    publishLocation();
    window.addEventListener('popstate', schedulePublish);
    document.addEventListener('turbo:load', schedulePublish);

    const observer = new MutationObserver(schedulePublish);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('popstate', schedulePublish);
      document.removeEventListener('turbo:load', schedulePublish);
      observer.disconnect();
    };
  },
});
