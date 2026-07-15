export default defineBackground(() => {
  const chromeBrowser = browser as typeof browser & {
    sidePanel?: {
      setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
      open(options: { tabId: number }): Promise<void>;
    };
  };

  void chromeBrowser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'wayfinder:open-panel' || sender.tab?.id === undefined) return;
    void chromeBrowser.sidePanel?.open({ tabId: sender.tab.id });
  });
});
