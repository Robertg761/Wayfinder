# Wayfinder

Wayfinder is a context-aware repository guide that lives beside GitHub. It helps someone understand an unfamiliar codebase, install and run it, locate important files, and move through the repository with confidence. Deterministic repository tools provide a useful free baseline, while an optional GPT-5.6 synthesis layer turns verified evidence into a more natural explanation.

## Product documentation

- [Product plan](PRODUCT_PLAN.md): product vision, user journeys, agent tools, free mode, model mode, acceptance criteria, and roadmap
- [Build week plan](BUILD_WEEK_PLAN.md): implementation order, ship gates, demo story, verification matrix, and cut lines
- [Architecture](docs/ARCHITECTURE.md): runtime flow, trust boundary, model path, and fallback behavior
- [Demo script](docs/DEMO_SCRIPT.md): timed primary demo and free-mode backup
- [Devpost submission draft](docs/DEVPOST_SUBMISSION.md): paste-ready story, technology list, and truth checks
- [Ship checklist](docs/SHIP_CHECKLIST.md): completed evidence and remaining submission gates
- [Verification matrix](docs/VERIFICATION_MATRIX.md): live results across five repository shapes
- [Privacy](PRIVACY.md): data flow, local caching, model processing, and retention boundaries
- [Contributing](CONTRIBUTING.md): local development, checks, and public smoke testing

## Current slice

- WXT and React Chrome extension with an MV3 side panel
- GitHub URL parsing for repository, tree, and blob views
- GitHub single-page navigation detection
- Cloudflare Worker with `GET /health` and `POST /map`
- Free deterministic tour engine exposed through `POST /tour`
- Evidence-backed installation guide exposed through `POST /guide/install`
- Context-aware natural-language file finder exposed through `POST /find`
- Deterministic agent router exposed through `POST /agent`
- Optional GPT-5.6 synthesis through the OpenAI Responses API
- Strict structured model output with exact-path validation and automatic free-mode fallback
- Filtered GitHub tree, README, metadata, language, and star count
- Package-manager, runtime, setup-command, and environment evidence detection
- Clickable tour stops that open real files and line ranges on GitHub
- Installation checklist with documented and inferred confidence labels
- Ranked file matches with reasons, confidence, content evidence, and direct navigation
- Unified question composer with a persistent evidence timeline and suggested follow-ups
- Commit-aware repository and answer caching in `chrome.storage.local`
- Friendly rate-limit, private-repository, authentication, and offline states
- Manual repository refresh and active GitHub context sync controls
- Shared TypeScript contracts across the extension and Worker
- Editorial field-guide interface with loading, empty, ready, and error states
- Unit tests for URL parsing, repository filtering, installation guidance, and file finding

The deterministic engine uses repository conventions, file roles, aliases, test relationships, content symbols, current-directory context, and language signals. The agent router classifies each question as orientation, installation, or file discovery, then renders the appropriate typed tool result in one timeline. Recent maps and answers remain available during temporary GitHub or network failures, with visible cache timestamps and manual refresh controls.

## Workspace

```text
apps/extension     Chrome extension and side panel
apps/api           Cloudflare Worker API
packages/contracts Shared request and response types
PRODUCT_PLAN.md    Product source of truth
BUILD_WEEK_PLAN.md Build-week execution plan
```

## Local setup

Prerequisites: Node.js 22 or newer and pnpm 10.

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Add a GitHub token to `apps/api/.dev.vars` for a higher API rate limit. Public repositories also work without one at GitHub's unauthenticated rate limit.

Add an OpenAI API key to the same file to enable GPT-5.6 synthesis. The key stays in the Worker and is never exposed to the extension. Without it, the deterministic agent remains fully functional.

Start the Worker:

```bash
pnpm dev:api
```

In a second terminal, start the extension:

```bash
pnpm dev:extension
```

WXT opens a development browser with the unpacked extension installed. Visit a public GitHub repository and open Wayfinder from the Chrome toolbar.

## API smoke test

```bash
curl http://localhost:8787/health

curl -X POST http://localhost:8787/map \
  -H 'Content-Type: application/json' \
  -d '{"owner":"openai","repo":"openai-node"}'
```

`POST /agent` accepts a repository map, a natural-language question, and an optional current path. It routes the question through the tour, installation guide, or file finder. When an OpenAI key is configured, GPT-5.6 receives the typed tool result and produces a structured synthesis. Any unverified path, invalid response, API failure, or missing key returns the deterministic answer instead.

GitHub access errors use typed response codes so the extension can distinguish a public API rate limit from a private or missing repository. A GitHub token remains optional for public repositories and can be added to `apps/api/.dev.vars` for a higher rate limit.

The public Worker is deployed at [wayfinder-api.hopit-robert.workers.dev](https://wayfinder-api.hopit-robert.workers.dev/health). Production extension builds use this origin automatically, while development builds use `http://localhost:8787` unless `WXT_WAYFINDER_API_URL` is set.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

The extension build is written to `apps/extension/.output/chrome-mv3`. The Worker dry-run bundle is written to `apps/api/dist`.

Create the Chrome submission archive with:

```bash
pnpm --filter @wayfinder/extension zip
```
