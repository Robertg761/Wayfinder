# Wayfinder Architecture

Wayfinder separates repository facts from language-model prose. Deterministic tools decide what files, commands, lines, and confidence labels are supported. GPT-5.6 can explain those results, but it cannot add a repository coordinate that the tools did not provide.

```mermaid
flowchart LR
  G["GitHub page"] --> CS["Context script"]
  CS --> P["Floating page agent"]
  P --> W["Cloudflare Worker"]
  W --> M["Repository mapper"]
  M --> GH["GitHub REST API"]
  W --> R["Intent router"]
  R --> T["Tour tool"]
  R --> I["Install tool"]
  R --> F["File finder"]
  R --> CO["Contribution orchestrator"]
  CO --> T
  CO --> I
  CO --> F
  T --> E["Typed evidence"]
  I --> E
  F --> E
  E --> O{"OpenAI key configured?"}
  O -->|"No"| D["Free evidence answer"]
  O -->|"Yes"| X["GPT-5.6 Responses API"]
  X --> V["Schema and path validator"]
  V -->|"Valid"| S["Grounded synthesis"]
  V -->|"Invalid or unavailable"| D
  D --> P
  S --> P
  P --> N["Open exact GitHub evidence"]
```

## Extension

The WXT Manifest V3 extension reads the active GitHub repository, branch or commit, directory, file, and view. It uses GitHub's visible branch label to preserve branch names that contain slashes. The requested ref is sent to the Worker, resolved into an immutable tree SHA, and shown in answer provenance. A Shadow DOM page agent stays isolated from GitHub styles, discovers visible landmarks, moves beside them only during a contextual tour, and expands in place for deeper questions. Every answer card can open its evidence at the mapped commit, including line fragments when available.

The page helper mounts after `DOMContentLoaded` so it cannot interfere with GitHub's parser. It watches Turbo navigation, recalculates valid targets for repository and blob views, respects reduced-motion preferences, caches maps and answers in extension storage, and calls the Worker directly from the active GitHub page. The character and bubble share one positioned dock, so opening, closing, asking, and changing answer content cannot separate them. Route changes cancel any in-progress dock transition. Agent interactions keep the dock stationary. Landmark tours scroll first, move the complete dock with a 1.2-second non-overshooting transition, and reveal the explanation only after it arrives.

Preferences store Guided or Quick mode and repositories already introduced to the user. Quick mode does not auto-open on repeat visits. Saved trails retain the last answer and question for each repository, allowing evidence navigation to return to the same task. A ref change invalidates the in-memory map and answer unless the navigation is to the answer's own pinned SHA.

Recent repository maps and answers are cached in `chrome.storage.local`. Repository cache keys include the requested ref, and answer cache keys include the resolved SHA, so evidence from one revision is not silently reused for another.

The Worker also asks Cloudflare to edge-cache unauthenticated GitHub subrequests. Mutable metadata, README, and branch tree responses use a five-minute TTL. File responses addressed by a full commit SHA use a 24-hour TTL. Error responses are excluded, and any request carrying a GitHub token explicitly bypasses shared caching.

## Worker tools

The Cloudflare Worker exposes six routes:

- `GET /health` reports service and model configuration state.
- `POST /map` resolves an optional requested ref, then reads metadata, README content, setup landmarks, and a filtered repository tree from that version.
- `POST /tour` builds a deterministic reading route.
- `POST /guide/install` extracts either consumer or contributor setup commands with confidence labels.
- `POST /find` ranks paths, then inspects only the strongest small text candidates for content and symbols.
- `POST /agent` classifies the question, runs one typed tool for focused questions, separates current-file summary, dependency, caller, test, and impact actions, or orchestrates tour, install, implementation, and verification evidence for a contribution goal. Current-file analysis classifies source, test, documentation, configuration, data, and other files before extracting evidence. It then optionally requests GPT-5.6 synthesis for contribution plans only.

Current-file relationship searches fail closed. Caller candidates must contain the distinctive target term in inspected content, paired tests must carry target-specific path or content evidence, and `possible` matches are discarded. Non-source files never enter the source caller/test graph. Content fetch failures and truncated repository maps remain visible as warnings, and the extension cache key is versioned when the answer contract changes so stale claims do not survive a deployment.

Plain installation questions are treated as end-user requests unless they explicitly mention development, contribution, building locally, or running from source. In the extension, end-user answers first move to and highlight the repository's Releases link, then persist that page trail across navigation. On the Releases page, the content script uses the detected desktop OS when reliable, asks the user to choose macOS, Windows, or Linux when it is not, rejects source archives and cross-platform mismatches, scrolls to the strongest packaged asset, and reuses the landmark movement/highlight system to point at it. Evidence links use the same persisted navigation mechanism for repository files.

This edge layer reduces repeated GitHub quota use without caching user questions, generated answers, or authenticated repository data.

## Public request boundary

Repository maps posted back by the extension are treated as untrusted input. The Worker revalidates repository identities, hexadecimal commit SHAs, timestamps, text sizes, tree counts, file sizes, and every repository path before running a tool. Paths must be normalized relative paths without empty, control, `.` or `..` segments. Malformed JSON and contract violations return a client error before any repository tool runs.

A missing README is an allowed repository shape. GitHub rate limits, authentication failures, malformed upstream responses, and network failures are not converted into a missing README, so the extension can show the correct retry or fallback state.

The content script mounts at document idle and checks URL identity without observing GitHub's entire document tree. Every navigation invalidates the active request token, aborts in-flight network work, clears tour state, and rebuilds the open helper surface from the new repository or file context. This prevents an older response or tour control from being applied to a newer GitHub page.

## GPT-5.6 boundary

The OpenAI key exists only in the Worker environment. The model request uses the Responses API with:

- model fixed to `gpt-5.6-luna`
- low reasoning effort by default, with medium and high available for controlled evaluation
- paid synthesis only for contribution Trail Plans
- strict JSON Schema output
- `store: false`
- the deterministic answer as the only repository evidence
- a maximum of five evidence paths
- a maximum of four ordered field-brief actions
- a Cloudflare rate-limit allowance before any paid request
- a serialized global budget reservation before any paid request

The Worker parses the structured result and rejects the entire synthesis if any model citation or field-brief path is absent from the credible tool output. Paths backed only by a `possible` match are excluded from the allow-list. The prompt also distinguishes a pinned repository path from a verified relationship. Wayfinder falls back when the key is missing, the API is unavailable, the response is refused or malformed, or local validation fails.

Successful model answers include token counts, latency, reasoning tokens, and an estimated Luna API cost. Focused orientation, installation, and file-location questions never request a model allowance. Their deterministic tools already answer the job directly.

Paid synthesis is fail-closed behind `MODEL_RATE_LIMITER` and `MODEL_BUDGET`. The rate-limit binding permits 10 attempts per connecting-IP key per minute in each Cloudflare location. The SQLite-backed Durable Object serializes all paid requests globally and persists its ledger across Worker deployments. Before a request leaves the Worker, it reserves a conservative cost based on request bytes, output limits, protocol overhead, and a safety multiplier. A successful response reconciles that reservation to reported Luna token usage. Missing usage or failed reconciliation keeps the larger reservation.

The lifetime budget is the full `$100` event credit balance, including the verified pre-guard evaluation spend. When the budget is exhausted or either protection is unavailable, Wayfinder returns the completed deterministic answer. `GET /health` reports rate-limit protection, budget protection, effective model enablement, spent budget, reserved budget, and remaining budget.

## Deployment

- Worker: `https://wayfinder-api.hopit-robert.workers.dev`
- Chrome archive: `apps/extension/.output/wayfinderextension-0.1.0-chrome.zip`
- Local Worker: `http://localhost:8787`
- Local extension server: `http://localhost:3000`

Production builds select the public Worker automatically. Development builds use the local Worker unless `WXT_WAYFINDER_API_URL` overrides it.
