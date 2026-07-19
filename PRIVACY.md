# Wayfinder Privacy

Wayfinder is designed for public GitHub repositories. It does not provide private-repository authentication, user accounts, advertising, or analytics.

## Data the extension reads

The Chrome extension reads the URL of the active GitHub tab to identify:

- repository owner and name
- branch or commit reference
- current directory or file path
- GitHub view type

The extension does not read unrelated tabs and does not request Chrome's `tabs` permission. Its content scripts run only on `github.com`, and evidence links navigate the current GitHub tab.

## Data sent to the Worker

The extension sends the public repository identity, current GitHub path, and user question to the Wayfinder Cloudflare Worker. The Worker requests public metadata and selected public file contents from the GitHub REST API.

The Worker does not store repository maps, questions, answers, or model responses in a database or Cloudflare KV. To reduce GitHub API usage, unauthenticated public GitHub responses use Cloudflare's edge cache. Mutable repository responses are eligible for five minutes of edge caching. File responses addressed by a full commit SHA are eligible for 24 hours because that evidence is immutable. Authenticated GitHub requests always bypass the shared cache.

A SQLite-backed Cloudflare Durable Object stores only aggregate model-budget accounting: conservative reservation amounts, reconciled spend, and timestamps. It does not store questions, repository contents, model output, IP addresses, or user identity.

Questions, generated answers, and model responses are not cached by the Worker. Cloudflare may retain operational request metadata according to the account and platform logging configuration.

## Local cache

Repository maps and recent answers are cached in `chrome.storage.local` to make reopening faster and to provide a temporary offline fallback. Cache identity includes the repository commit SHA.

Pending evidence and release navigation is stored briefly in the GitHub tab's `sessionStorage`. This keeps the trail scoped to that tab and expires it after five minutes.

Removing the extension clears its local storage through Chrome. Users can also clear extension data through Chrome's site and extension storage controls.

## Optional GPT-5.6 processing

When the Worker has an OpenAI API key configured, it sends the user question and deterministic repository evidence to the OpenAI Responses API for synthesis.

- The API key remains in the Worker and is never sent to the extension.
- Requests set `store: false`.
- The model receives selected public repository evidence, not a full repository clone.
- Every returned evidence path is validated against deterministic tool output.
- Path-like model prose and shell commands are rejected unless the same path or command exists in deterministic evidence.
- A missing key, unavailable API, or invalid response falls back to the Worker's deterministic answer.

For public API and model rate limiting, the Worker uses Cloudflare's connecting-IP value as a short-lived limiter key. The key is not sent to GitHub or OpenAI and is not written to Wayfinder storage. Public deterministic routes and optional model calls use separate allowances. If the model allowance is exhausted or its protection is unavailable, the deterministic answer is returned.

The current public Worker reports whether model processing is configured through `GET /health`.

## Third-party services

Wayfinder communicates with:

- GitHub, to read public repository data
- Cloudflare Workers, to run repository tools
- OpenAI, only when optional GPT-5.6 synthesis is configured

Those services process data under their respective terms and privacy policies.

## Contact

Report a non-sensitive privacy concern through the
[Wayfinder issue tracker](https://github.com/Robertg761/Wayfinder/issues). For a
vulnerability or sensitive report, follow [SECURITY.md](SECURITY.md) instead of
posting the details publicly.
