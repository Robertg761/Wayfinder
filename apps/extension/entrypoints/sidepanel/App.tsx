import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentAnswer,
  InstallEvidence,
  RepoLocation,
  RepoMap,
  RepoTour,
  TourStop,
  WayfinderErrorCode,
  WayfinderErrorResponse,
  WayfinderMessage,
} from '@wayfinder/contracts';
import {
  agentCacheTtl,
  agentResponseCacheKey,
  getCached,
  repositoryCacheKey,
  repositoryCacheTtl,
  setCached,
  type CacheStorage,
} from '@/lib/cache';
import { parseGitHubUrl } from '@/lib/github-url';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; map: RepoMap; tour: RepoTour; source: 'live' | 'cache'; cachedAt: string; notice?: string }
  | { status: 'error'; message: string; code: WayfinderErrorCode; resetAt?: string };

type AgentTurn =
  | { id: string; question: string; status: 'loading' }
  | { id: string; question: string; status: 'ready'; answer: AgentAnswer; source: 'live' | 'cache'; cachedAt: string; notice?: string }
  | { id: string; question: string; status: 'error'; message: string };

interface RepositoryBundle {
  map: RepoMap;
  tour: RepoTour;
}

const apiUrl = import.meta.env.WXT_WAYFINDER_API_URL ?? 'http://localhost:8787';
const extensionBrowser = typeof browser !== 'undefined' && browser.runtime?.id ? browser : null;
const extensionCache = extensionBrowser
  ? extensionBrowser.storage.local as unknown as CacheStorage
  : null;

class WayfinderRequestError extends Error {
  constructor(
    public readonly code: WayfinderErrorCode,
    message: string,
    public readonly resetAt?: string,
  ) {
    super(message);
    this.name = 'WayfinderRequestError';
  }
}

async function responseError(response: Response, fallback: string): Promise<WayfinderRequestError> {
  const body = await response.json().catch(() => null) as Partial<WayfinderErrorResponse> | null;
  return new WayfinderRequestError(
    body?.code ?? 'request-failed',
    body?.message ?? fallback,
    body?.resetAt,
  );
}

function requestError(error: unknown, fallback: string): WayfinderRequestError {
  if (error instanceof WayfinderRequestError) return error;
  if (error instanceof TypeError) {
    return new WayfinderRequestError(
      'upstream-unavailable',
      'Wayfinder could not reach the guide service. Check the connection and try again.',
    );
  }
  return new WayfinderRequestError('request-failed', error instanceof Error ? error.message : fallback);
}

function errorHeading(code: WayfinderErrorCode): string {
  if (code === 'github-rate-limited') return 'GitHub asked us to pause.';
  if (code === 'repository-unavailable') return 'This trail is not public.';
  if (code === 'github-auth-failed') return 'The GitHub token was declined.';
  if (code === 'upstream-unavailable') return 'The map desk cannot be reached.';
  return 'The survey was interrupted.';
}

function cacheLabel(cachedAt: string): string {
  const time = new Date(cachedAt);
  return Number.isNaN(time.getTime()) ? 'recently' : time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

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

function AgentAnswerView({
  map,
  answer,
  source,
  cachedAt,
  notice,
  onAsk,
  onRefresh,
}: {
  map: RepoMap;
  answer: AgentAnswer;
  source: 'live' | 'cache';
  cachedAt: string;
  notice?: string;
  onAsk: (question: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className={`agent-answer ${answer.intent}`}>
      <header className="answer-heading">
        <span>{answer.intent === 'file-find' ? 'coordinates' : answer.intent}</span>
        <div>
          <small>{source === 'cache' ? `Cached ${cacheLabel(cachedAt)}` : 'Fresh evidence'}</small>
          <button type="button" onClick={onRefresh} aria-label="Refresh this answer">↻</button>
        </div>
      </header>
      {notice && <p className="cache-notice">{notice}</p>}
      <div className={`answer-mode ${answer.mode === 'gpt-5.6' ? 'model' : 'free'}`}>
        <span>{answer.mode === 'gpt-5.6' ? 'GPT-5.6 synthesis' : 'Deterministic route'}</span>
        <small>{answer.mode === 'gpt-5.6' ? 'Grounded in verified repository evidence' : 'Works without model credits'}</small>
      </div>
      <p className="answer-summary">{answer.summary}</p>
      {answer.explanation && <p className="answer-explanation">{answer.explanation}</p>}

      {answer.evidencePaths && answer.evidencePaths.length > 0 && (
        <div className="model-evidence" aria-label="Evidence used by the model">
          <small>Verified evidence</small>
          {answer.evidencePaths.map((path) => (
            <button key={path} type="button" onClick={() => void openFile(map, path)}>{path}<i aria-hidden="true">↗</i></button>
          ))}
        </div>
      )}

      {answer.intent === 'orientation' && (
        <div className="orientation-answer">
          {answer.tour.stack.length > 0 && (
            <div className="answer-stack">
              {answer.tour.stack.map((item) => <span key={item}>{item}</span>)}
            </div>
          )}
          <ol className="answer-route">
            {answer.tour.stops.slice(0, 4).map((stop) => (
              <li key={stop.path}>
                <button type="button" onClick={() => void openStop(map, stop)}>
                  <span>{String(stop.order).padStart(2, '0')}</span>
                  <div><strong>{stop.title}</strong><small>{stop.path}</small></div>
                  <i aria-hidden="true">↗</i>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {answer.intent === 'installation' && (
        <div className="installation-answer">
          <div className="guide-meta">
            <span><small>Package manager</small>{answer.guide.packageManager ?? 'Not detected'}</span>
            <span><small>Runtime</small>{answer.guide.runtimes.join(', ') || 'Not specified'}</span>
          </div>

          {answer.guide.prerequisites.length > 0 && (
            <section className="prerequisites">
              <p className="eyebrow">Before you begin</p>
              <ul>
                {answer.guide.prerequisites.map((item) => (
                  <li key={item.text}>
                    <div>
                      <span className={`confidence ${item.confidence}`}>{item.confidence}</span>
                      <p>{item.text}</p>
                    </div>
                    <EvidenceLink map={map} evidence={item.evidence} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ol className="install-steps">
            {answer.guide.steps.map((step) => (
              <li key={`${step.order}-${step.command}`}>
                <span className="step-number">{String(step.order).padStart(2, '0')}</span>
                <div className="step-body">
                  <div className="step-title">
                    <strong>{step.title}</strong>
                    <span className={`confidence ${step.confidence}`}>{step.confidence}</span>
                  </div>
                  <code>{step.command}</code>
                  <EvidenceLink map={map} evidence={step.evidence} />
                </div>
              </li>
            ))}
          </ol>

          {answer.guide.warnings.length > 0 && (
            <div className="guide-warnings">
              <p className="eyebrow">Field notes</p>
              {answer.guide.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
        </div>
      )}

      {answer.intent === 'file-find' && (
        <div className="coordinate-answer">
          <ol>
            {answer.finder.results.map((result, index) => (
              <li key={result.path}>
                <div className="result-rank">{String(index + 1).padStart(2, '0')}</div>
                <div className="result-body">
                  <div className="result-heading">
                    <strong>{result.path}</strong>
                    <span className={`match-confidence ${result.confidence}`}>{result.confidence}</span>
                  </div>
                  <p>{result.reason}</p>
                  {result.snippet && <code>{result.snippet}</code>}
                  <div className="result-signals">
                    {result.signals.slice(0, 4).map((signal) => <span key={signal}>{signal}</span>)}
                  </div>
                  <button type="button" className="result-open" onClick={() => void openFile(map, result.path, result.lines)}>
                    Open coordinate <i aria-hidden="true">↗</i>
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {answer.finder.warnings.length > 0 && (
            <div className="finder-warnings">
              {answer.finder.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
        </div>
      )}

      <div className="answer-followups" aria-label="Suggested follow-up questions">
        {answer.suggestions.map((suggestion) => (
          <button key={suggestion} type="button" onClick={() => onAsk(suggestion)}>{suggestion}</button>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [location, setLocation] = useState<RepoLocation | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [selectedStop, setSelectedStop] = useState(0);
  const [agentQuery, setAgentQuery] = useState('');
  const [agentTurns, setAgentTurns] = useState<AgentTurn[]>([]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [contextSyncing, setContextSyncing] = useState(false);
  const forceRefresh = useRef(false);

  const syncActiveContext = async () => {
    if (!extensionBrowser) return;
    setContextSyncing(true);
    try {
      const tabs = await extensionBrowser.tabs.query({ active: true, currentWindow: true });
      setLocation(parseGitHubUrl(tabs[0]?.url ?? ''));
    } finally {
      setContextSyncing(false);
    }
  };

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
    setSelectedStop(0);
    setAgentQuery('');
    setAgentTurns([]);
  }, [location?.owner, location?.repo]);

  useEffect(() => {
    if (!location) {
      setLoadState({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    const cacheKey = repositoryCacheKey(location.owner, location.repo);
    const repoName = `${location.owner}/${location.repo}`;
    const bypassCache = forceRefresh.current;
    forceRefresh.current = false;
    setLoadState({ status: 'loading' });

    void (async () => {
      const cached = await getCached<RepositoryBundle>(extensionCache, cacheKey).catch(() => null);
      if (cached && !bypassCache) {
        setLoadState({
          status: 'ready',
          map: cached.value.map,
          tour: cached.value.tour,
          source: 'cache',
          cachedAt: cached.cachedAt,
        });
        return;
      }

      try {
        const mapResponse = await fetch(apiUrl + '/map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner: location.owner, repo: location.repo }),
          signal: controller.signal,
        });
        if (!mapResponse.ok) throw await responseError(mapResponse, 'Repository map could not be loaded.');
        const map = (await mapResponse.json()) as RepoMap;

        const tourResponse = await fetch(apiUrl + '/tour', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map }),
          signal: controller.signal,
        });
        if (!tourResponse.ok) throw await responseError(tourResponse, 'Repository tour could not be assembled.');
        const tour = (await tourResponse.json()) as RepoTour;
        const cachedAt = new Date().toISOString();
        await setCached(extensionCache, cacheKey, repoName, 'repository', { map, tour }, repositoryCacheTtl).catch(() => undefined);
        setLoadState({ status: 'ready', map, tour, source: 'live', cachedAt });
      } catch (error) {
        if (controller.signal.aborted) return;
        const failure = requestError(error, 'Repository map could not be loaded.');
        const stale = cached ?? await getCached<RepositoryBundle>(extensionCache, cacheKey, Date.now(), true).catch(() => null);
        if (stale) {
          setLoadState({
            status: 'ready',
            map: stale.value.map,
            tour: stale.value.tour,
            source: 'cache',
            cachedAt: stale.cachedAt,
            notice: failure.message,
          });
          return;
        }
        setLoadState({
          status: 'error',
          message: failure.message,
          code: failure.code,
          ...(failure.resetAt ? { resetAt: failure.resetAt } : {}),
        });
      }
    })();

    return () => controller.abort();
  }, [location?.owner, location?.repo, reloadNonce]);

  const activeStop = useMemo(
    () => (loadState.status === 'ready' ? loadState.tour.stops[selectedStop] ?? null : null),
    [loadState, selectedStop],
  );

  const askAgent = async (map: RepoMap, question: string, retryId?: string, bypassCache = false) => {
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length < 2) return;
    const id = retryId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const currentPath = location?.path ?? null;
    const cacheKey = agentResponseCacheKey(map.repo, map.sha, trimmedQuestion, currentPath);
    setAgentQuery('');
    setAgentTurns((turns) => retryId
      ? turns.map((turn) => turn.id === retryId ? { id, question: trimmedQuestion, status: 'loading' } : turn)
      : [...turns.slice(-5), { id, question: trimmedQuestion, status: 'loading' }]);

    try {
      const cached = await getCached<AgentAnswer>(extensionCache, cacheKey).catch(() => null);
      if (cached && !bypassCache) {
        setAgentTurns((turns) => turns.map((turn) => turn.id === id
          ? {
            id,
            question: trimmedQuestion,
            status: 'ready',
            answer: cached.value,
            source: 'cache',
            cachedAt: cached.cachedAt,
          }
          : turn));
        return;
      }

      const response = await fetch(apiUrl + '/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map, query: trimmedQuestion, currentPath }),
      });
      if (!response.ok) throw await responseError(response, 'The guide could not complete that dispatch.');
      const answer = (await response.json()) as AgentAnswer;
      const cachedAt = new Date().toISOString();
      await setCached(extensionCache, cacheKey, map.repo, 'agent', answer, agentCacheTtl).catch(() => undefined);
      setAgentTurns((turns) => turns.map((turn) => turn.id === id
        ? { id, question: trimmedQuestion, status: 'ready', answer, source: 'live', cachedAt }
        : turn));
    } catch (error) {
      const failure = requestError(error, 'The guide could not complete that dispatch.');
      const stale = await getCached<AgentAnswer>(extensionCache, cacheKey, Date.now(), true).catch(() => null);
      if (stale) {
        setAgentTurns((turns) => turns.map((turn) => turn.id === id
          ? {
            id,
            question: trimmedQuestion,
            status: 'ready',
            answer: stale.value,
            source: 'cache',
            cachedAt: stale.cachedAt,
            notice: failure.message,
          }
          : turn));
        return;
      }
      setAgentTurns((turns) => turns.map((turn) => turn.id === id
        ? { id, question: trimmedQuestion, status: 'error', message: failure.message }
        : turn));
    }
  };

  const refreshRepository = () => {
    forceRefresh.current = true;
    setReloadNonce((value) => value + 1);
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
            <div className="coordinate-tools">
              <span>{locationLabel(location)}</span>
              {extensionBrowser && (
                <button type="button" onClick={() => void syncActiveContext()} disabled={contextSyncing} aria-label="Refresh GitHub context">
                  {contextSyncing ? '...' : '↻'}
                </button>
              )}
            </div>
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
              <h2>{errorHeading(loadState.code)}</h2>
              <p>{loadState.message}</p>
              {loadState.resetAt && <small>GitHub expects to reopen the trail around {cacheLabel(loadState.resetAt)}.</small>}
              <button type="button" className="retry-survey" onClick={refreshRepository}>Retry survey</button>
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
                  <div className="orientation-tools">
                    <span className="sha">{loadState.map.sha.slice(0, 7)}</span>
                    <span className={`cache-source ${loadState.source}`}>{loadState.source === 'cache' ? `Cached ${cacheLabel(loadState.cachedAt)}` : 'Fresh map'}</span>
                    <button type="button" onClick={refreshRepository} aria-label="Refresh repository map">↻</button>
                  </div>
                </div>

                {loadState.notice && <p className="cache-notice map-notice">{loadState.notice}</p>}

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
                    <h3>Field dispatches</h3>
                  </div>
                  <span>02</span>
                </div>

                {agentTurns.length > 0 && (
                  <ol className="agent-timeline" aria-live="polite">
                    {agentTurns.map((turn, index) => (
                      <li key={turn.id} className={`agent-turn ${turn.status}`}>
                        <div className="dispatch-question">
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <p>{turn.question}</p>
                        </div>

                        {turn.status === 'loading' && (
                          <div className="dispatch-loading">
                            <span className="locator-pulse" aria-hidden="true" />
                            <div><strong>Consulting the field notes</strong><small>Choosing an evidence route for this question</small></div>
                          </div>
                        )}

                        {turn.status === 'error' && (
                          <div className="install-error" role="alert">
                            <p>{turn.message}</p>
                            <button type="button" onClick={() => void askAgent(loadState.map, turn.question, turn.id)}>Retry dispatch</button>
                          </div>
                        )}

                        {turn.status === 'ready' && (
                          <AgentAnswerView
                            map={loadState.map}
                            answer={turn.answer}
                            source={turn.source}
                            cachedAt={turn.cachedAt}
                            notice={turn.notice}
                            onAsk={(question) => void askAgent(loadState.map, question)}
                            onRefresh={() => void askAgent(loadState.map, turn.question, turn.id, true)}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                )}

                <form
                  className="agent-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void askAgent(loadState.map, agentQuery);
                  }}
                >
                  <label htmlFor="wayfinder-query">Ask about this repository</label>
                  <div className="composer-field">
                    <textarea
                      id="wayfinder-query"
                      value={agentQuery}
                      onChange={(event) => setAgentQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void askAgent(loadState.map, agentQuery);
                        }
                      }}
                      placeholder="How do I run it? Where is authentication? What should I read first?"
                      rows={2}
                      minLength={2}
                    />
                    <button type="submit" disabled={agentQuery.trim().length < 2}>
                      Dispatch <i aria-hidden="true">↗</i>
                    </button>
                  </div>
                  {location.path && <small className="context-hint">Current context: {location.path}</small>}
                  <div className="agent-prompts" aria-label="Suggested repository questions">
                    {['What does this project do?', 'How do I install and run it?', 'Where are the tests?'].map((prompt) => (
                      <button key={prompt} type="button" onClick={() => void askAgent(loadState.map, prompt)}>{prompt}</button>
                    ))}
                  </div>
                </form>
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
                <span>Evidence first</span>
                <p>Deterministic repository tools with optional GPT-5.6 synthesis.</p>
              </footer>
            </>
          )}
        </>
      )}
    </main>
  );
}

export default App;
