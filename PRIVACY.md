# Wayfinder Privacy

Wayfinder is designed for public GitHub repositories. It does not provide private-repository authentication, user accounts, advertising, or analytics.

## Data the extension reads

The Chrome extension reads the URL of the active GitHub tab to identify:

- repository owner and name
- branch or commit reference
- current directory or file path
- GitHub view type

The extension does not read unrelated tabs. The `tabs` permission is used to follow and open GitHub evidence in the active tab.

## Data sent to the Worker

The extension sends the public repository identity, current GitHub path, and user question to the Wayfinder Cloudflare Worker. The Worker requests public metadata and selected public file contents from the GitHub REST API.

The Worker does not use a database or Cloudflare KV. To reduce GitHub API usage, unauthenticated public GitHub responses use Cloudflare's edge cache. Mutable repository responses are eligible for five minutes of edge caching. File responses addressed by a full commit SHA are eligible for 24 hours because that evidence is immutable. Authenticated GitHub requests always bypass the shared cache.

Questions, generated answers, and model responses are not cached by the Worker. Cloudflare may retain operational request metadata according to the account and platform logging configuration.

## Local cache

Repository maps and recent answers are cached in `chrome.storage.local` to make reopening faster and to provide a temporary offline fallback. Cache identity includes the repository commit SHA.

Removing the extension clears its local storage through Chrome. Users can also clear extension data through Chrome's site and extension storage controls.

## Optional GPT-5.6 processing

When the Worker has an OpenAI API key configured, it sends the user question and deterministic repository evidence to the OpenAI Responses API for synthesis.

- The API key remains in the Worker and is never sent to the extension.
- Requests set `store: false`.
- The model receives selected public repository evidence, not a full repository clone.
- Every returned evidence path is validated against deterministic tool output.
- A missing key, unavailable API, or invalid response falls back to the Worker's deterministic answer.

The current public Worker reports whether model processing is configured through `GET /health`.

## Third-party services

Wayfinder communicates with:

- GitHub, to read public repository data
- Cloudflare Workers, to run repository tools
- OpenAI, only when optional GPT-5.6 synthesis is configured

Those services process data under their respective terms and privacy policies.

## Contact

Report a privacy or security concern through the source repository's issue tracker after the repository is published.
