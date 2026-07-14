import { useEffect, useMemo, useState } from 'react';
import type {
  InstallEvidence,
  InstallGuide,
  RepoLocation,
  RepoMap,
  RepoTour,
  TourStop,
  WayfinderMessage,
} from '@wayfinder/contracts';
import { parseGitHubUrl } from '@/lib/github-url';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; map: RepoMap; tour: RepoTour }
  | { status: 'error'; message: string };

type InstallState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; guide: InstallGuide }
  | { status: 'error'; message: string };

const apiUrl = import.meta.env.WXT_WAYFINDER_API_URL ?? 'http://localhost:8787';
const extensionBrowser = typeof browser !== 'undefined' && browser.runtime?.id ? browser : null;

function formatCount(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function locationLabel(location: RepoLocation): string {
  if (location.view === 'blob') return location.path ?? 'File';
  if (location.view === 'tree') return location.path ?? 'Directory';
  if (location.view === 'other') return location.path ?? 'Repository area';
  return 'Repository root';
}

function githubFileUrl(map: RepoMap, path: string, lines?: [number, number]): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const lineFragment = lines ? `#L${lines[0]}-L${lines[1]}` : '';
  return `https://github.com/${map.repo}/blob/${map.sha}/${encodedPath}${lineFragment}`;
}

async function openFile(map: RepoMap, path: string, lines?: [number, number]): Promise<void> {
  const url = githubFileUrl(map, path, lines);
  if (!extensionBrowser) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  const tabs = await extensionBrowser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (activeTab?.id !== undefined) await extensionBrowser.tabs.update(activeTab.id, { url });
}

async function openStop(map: RepoMap, stop: TourStop): Promise<void> {
  await openFile(map, stop.path, stop.lines);
}

function EvidenceLink({ map, evidence }: { map: RepoMap; evidence: InstallEvidence }) {
  return (
    <button type="button" className="evidence-link" onClick={() => void openFile(map, evidence.path, evidence.lines)}>
      <span>{evidence.path}</span>
      {evidence.lines && <small>L{evidence.lines[0]}</small>}
      <i aria-hidden="true">↗</i>
    </button>
  );
}

function App() {
  const [location, setLocation] = useState<RepoLocation | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [selectedStop, setSelectedStop] = useState(0);
  const [installState, setInstallState] = useState<InstallState>({ status: 'idle' });

  useEffect(() => {
    if (!extensionBrowser) {
      const previewUrl = new URLSearchParams(window.location.search).get('preview');
      setLocation(parseGitHubUrl(previewUrl ?? 'https://github.com/openai/openai-node'));
      return;
    }

    const readActiveTab = async () => {
      const tabs = await extensionBrowser.tabs.query({ active: true, currentWindow: true });
      setLocation(parseGitHubUrl(tabs[0]?.url ?? ''));
    };

    const onMessage = (message: WayfinderMessage) => {
      if (message.type === 'wayfinder:context') setLocation(message.context);
    };

    void readActiveTab();
    extensionBrowser.runtime.onMessage.addListener(onMessage);
    extensionBrowser.tabs.onActivated.addListener(readActiveTab);
    extensionBrowser.tabs.onUpdated.addListener(readActiveTab);

    return () => {
      extensionBrowser.runtime.onMessage.removeListener(onMessage);
      extensionBrowser.tabs.onActivated.removeListener(readActiveTab);
      extensionBrowser.tabs.onUpdated.removeListener(readActiveTab);
    };
  }, []);

  useEffect(() => {
    if (!location) {
      setLoadState({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    setLoadState({ status: 'loading' });

    void fetch(apiUrl + '/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: location.owner, repo: location.repo }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Repository map could not be loaded.');
        return (await response.json()) as RepoMap;
      })
      .then(async (map) => {
        const response = await fetch(apiUrl + '/tour', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Repository tour could not be assembled.');
        return { map, tour: (await response.json()) as RepoTour };
      })
      .then(({ map, tour }) => {
        setSelectedStop(0);
        setInstallState({ status: 'idle' });
        setLoadState({ status: 'ready', map, tour });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Repository map could not be loaded.',
        });
      });

    return () => controller.abort();
  }, [location?.owner, location?.repo]);

  const activeStop = useMemo(
    () => (loadState.status === 'ready' ? loadState.tour.stops[selectedStop] ?? null : null),
    [loadState, selectedStop],
  );

  const loadInstallGuide = async (map: RepoMap) => {
    setInstallState({ status: 'loading' });
    try {
      const response = await fetch(apiUrl + '/guide/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map }),
      });
      if (!response.ok) throw new Error('Installation evidence could not be assembled.');
      setInstallState({ status: 'ready', guide: (await response.json()) as InstallGuide });
    } catch (error) {
      setInstallState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Installation evidence could not be assembled.',
      });
    }
  };

  return (
    <main className="field-guide">
      <div className="topographic-lines" aria-hidden="true" />

      <header className="masthead">
        <div className="compass" aria-hidden="true">
          <span>N</span>
          <i />
        </div>
        <div>
          <p className="eyebrow">Repository field guide</p>
          <h1>Wayfinder</h1>
        </div>
        <span className="edition">BW.26</span>
      </header>

      {!location ? (
        <section className="empty-state">
          <div className="empty-mark" aria-hidden="true">↗</div>
          <p className="plate-number">Plate 00</p>
          <h2>Choose unfamiliar ground.</h2>
          <p>Open any public GitHub repository. Wayfinder will read the terrain and mark a path through it.</p>
          <div className="instruction">
            <span>01</span>
            <p>Navigate to github.com/owner/repository</p>
          </div>
        </section>
      ) : (
        <>
          <section className="location-strip" aria-label="Current GitHub location">
            <div>
              <p className="eyebrow">Current coordinates</p>
              <strong>{location.owner} / {location.repo}</strong>
            </div>
            <span>{locationLabel(location)}</span>
          </section>

          {loadState.status === 'loading' && (
            <section className="reading-state" aria-live="polite">
              <div className="survey-line"><i /></div>
              <p className="plate-number">Survey in progress</p>
              <h2>Reading the tree</h2>
              <ol>
                <li className="complete">Repository located</li>
                <li className="active">Filtering the terrain</li>
                <li>Marking likely entry points</li>
              </ol>
            </section>
          )}

          {loadState.status === 'error' && (
            <section className="error-card" role="alert">
              <p className="plate-number">Survey interrupted</p>
              <h2>The map desk is offline.</h2>
              <p>{loadState.message}</p>
              <small>Start the Wayfinder Worker locally, then reload this panel.</small>
            </section>
          )}

          {loadState.status === 'ready' && (
            <>
              <section className="orientation-card">
                <div className="card-heading">
                  <div>
                    <p className="plate-number">Orientation 01</p>
                    <h2>{loadState.map.repo}</h2>
                  </div>
                  <span className="sha">{loadState.map.sha.slice(0, 7)}</span>
                </div>

                <p className="summary">{loadState.tour.summary}</p>

                {loadState.tour.stack.length > 0 && (
                  <div className="stack-strip" aria-label="Detected stack">
                    {loadState.tour.stack.map((item) => <span key={item}>{item}</span>)}
                  </div>
                )}

                <div className="specimens" aria-label="Repository facts">
                  <span><small>Primary language</small>{loadState.map.language ?? 'Mixed'}</span>
                  <span><small>Stars</small>{formatCount(loadState.map.stars)}</span>
                  <span><small>Mapped entries</small>{formatCount(loadState.map.tree.length)}</span>
                </div>
              </section>

              <section className="agent-actions">
                <div className="section-title compact">
                  <div>
                    <p className="eyebrow">Ask the guide</p>
                    <h3>Prepare an expedition</h3>
                  </div>
                  <span>02</span>
                </div>

                {installState.status === 'idle' && (
                  <button type="button" className="install-trigger" onClick={() => void loadInstallGuide(loadState.map)}>
                    <span>
                      <small>Suggested question</small>
                      How do I install and run this?
                    </span>
                    <i aria-hidden="true">→</i>
                  </button>
                )}

                {installState.status === 'loading' && (
                  <div className="install-loading" aria-live="polite">
                    <div className="survey-line"><i /></div>
                    <p className="plate-number">Checking supplies</p>
                    <strong>Reading setup evidence</strong>
                    <small>Documentation, manifests, toolchains, and environment examples</small>
                  </div>
                )}

                {installState.status === 'error' && (
                  <div className="install-error" role="alert">
                    <p>{installState.message}</p>
                    <button type="button" onClick={() => void loadInstallGuide(loadState.map)}>Try again</button>
                  </div>
                )}

                {installState.status === 'ready' && (
                  <article className="install-guide" aria-live="polite">
                    <header className="guide-heading">
                      <div>
                        <p className="plate-number">Field checklist</p>
                        <h3>Installation route</h3>
                      </div>
                      <button type="button" onClick={() => void loadInstallGuide(loadState.map)} aria-label="Refresh installation guide">↻</button>
                    </header>

                    <div className="guide-meta">
                      <span><small>Package manager</small>{installState.guide.packageManager ?? 'Not detected'}</span>
                      <span><small>Runtime</small>{installState.guide.runtimes.join(', ') || 'Not specified'}</span>
                    </div>

                    {installState.guide.prerequisites.length > 0 && (
                      <section className="prerequisites">
                        <p className="eyebrow">Before you begin</p>
                        <ul>
                          {installState.guide.prerequisites.map((item) => (
                            <li key={item.text}>
                              <div>
                                <span className={`confidence ${item.confidence}`}>{item.confidence}</span>
                                <p>{item.text}</p>
                              </div>
                              <EvidenceLink map={loadState.map} evidence={item.evidence} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    <ol className="install-steps">
                      {installState.guide.steps.map((step) => (
                        <li key={`${step.order}-${step.command}`}>
                          <span className="step-number">{String(step.order).padStart(2, '0')}</span>
                          <div className="step-body">
                            <div className="step-title">
                              <strong>{step.title}</strong>
                              <span className={`confidence ${step.confidence}`}>{step.confidence}</span>
                            </div>
                            <code>{step.command}</code>
                            <EvidenceLink map={loadState.map} evidence={step.evidence} />
                          </div>
                        </li>
                      ))}
                    </ol>

                    {installState.guide.warnings.length > 0 && (
                      <div className="guide-warnings">
                        <p className="eyebrow">Field notes</p>
                        {installState.guide.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                      </div>
                    )}
                  </article>
                )}
              </section>

              <section className="trail-section">
                <div className="section-title">
                  <div>
                    <p className="eyebrow">Suggested route</p>
                    <h3>Follow the trail</h3>
                  </div>
                  <span>{loadState.tour.stops.length.toString().padStart(2, '0')}</span>
                </div>

                {loadState.tour.stops.length ? (
                  <ol className="trail-list">
                    {loadState.tour.stops.map((stop, index) => (
                      <li key={stop.path} className={index === selectedStop ? 'active' : ''}>
                        <button type="button" onClick={() => setSelectedStop(index)}>
                          <span>{String(stop.order).padStart(2, '0')}</span>
                          <div>
                            <strong>{stop.title}</strong>
                            <small>{stop.path}</small>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="quiet-note">No readable source landmarks were found in this repository.</p>
                )}
              </section>

              {activeStop && (
                <article className="stop-card" aria-live="polite">
                  <header>
                    <p className="plate-number">Trail marker {String(activeStop.order).padStart(2, '0')}</p>
                    <span>{activeStop.lines[0]} to {activeStop.lines[1]}</span>
                  </header>
                  <h3>{activeStop.title}</h3>
                  <code>{activeStop.path}</code>
                  <p>{activeStop.explanation}</p>
                  <div className="look-for">
                    <small>Look for</small>
                    <p>{activeStop.lookFor}</p>
                  </div>
                  <button type="button" className="open-file" onClick={() => void openStop(loadState.map, activeStop)}>
                    Open this landmark
                    <span aria-hidden="true">↗</span>
                  </button>
                </article>
              )}

              <footer className="panel-footer">
                <span>Free route</span>
                <p>Generated locally from repository structure. No model credits used.</p>
              </footer>
            </>
          )}
        </>
      )}
    </main>
  );
}

export default App;
