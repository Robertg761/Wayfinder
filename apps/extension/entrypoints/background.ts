export default defineBackground(() => {
  const chromeBrowser = browser as typeof browser & {
    sidePanel?: {
      setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
    };
  };

  void chromeBrowser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
});
