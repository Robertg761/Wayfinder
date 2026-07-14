# Wayfinder

Wayfinder is a context-aware repository guide that lives beside GitHub. It helps someone understand an unfamiliar codebase, install and run it, locate important files, and move through the repository with confidence. The current build provides free repository mapping and a clickable reading route without requiring model credits.

## Product documentation

- [Product plan](PRODUCT_PLAN.md): product vision, user journeys, agent tools, free mode, model mode, acceptance criteria, and roadmap
- [Build week plan](BUILD_WEEK_PLAN.md): implementation order, ship gates, demo story, verification matrix, and cut lines

## Current slice

- WXT and React Chrome extension with an MV3 side panel
- GitHub URL parsing for repository, tree, and blob views
- GitHub single-page navigation detection
- Cloudflare Worker with `GET /health` and `POST /map`
- Free deterministic tour engine exposed through `POST /tour`
- Evidence-backed installation guide exposed through `POST /guide/install`
- Filtered GitHub tree, README, metadata, language, and star count
- Package-manager, runtime, setup-command, and environment evidence detection
- Clickable tour stops that open real files and line ranges on GitHub
- Installation checklist with documented and inferred confidence labels
- Shared TypeScript contracts across the extension and Worker
- Editorial field-guide interface with loading, empty, ready, and error states
- Unit tests for URL parsing and repository filtering

The deterministic engine uses repository conventions, file roles, depth, and language signals. The tour and installation guide are tools in the broader repository agent. File discovery and the conversational agent shell are the next implementation phases.

## Workspace

```text
apps/extension     Chrome extension and side panel
apps/api           Cloudflare Worker API
packages/contracts Shared request and response types
PRODUCT_PLAN.md    Product source of truth
BUILD_WEEK_PLAN.md Build-week execution plan
```

## Local setup

Prerequisites: Node.js 20 or newer and pnpm 10.

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Add a GitHub token to `apps/api/.dev.vars` for a higher API rate limit. Public repositories also work without one at GitHub's unauthenticated rate limit.

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

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

The extension build is written to `apps/extension/.output/chrome-mv3`. The Worker dry-run bundle is written to `apps/api/dist`.
