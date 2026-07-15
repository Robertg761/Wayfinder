# Wayfinder

Wayfinder is a context-aware repository guide that lives directly on GitHub. A small animated compass helper travels to important landmarks on the page, highlights them, explains what they reveal, and expands into a complete repository agent. It helps someone understand an unfamiliar codebase, install and run it, locate important files, and plan a first contribution with confidence. Deterministic repository tools provide a useful free baseline, while GPT-5.6 Luna can turn a verified contribution trail into a practical field brief.

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

- WXT and TypeScript Chrome extension with one floating on-page agent
- Persistent Guided and Quick experience modes with first-run pace selection
- GitHub URL parsing for repository, tree, blob, branch, tag, and commit views
- Requested-ref mapping with slash-containing branch support and commit-pinned evidence
- GitHub single-page navigation detection
- Cloudflare Worker with `GET /health` and `POST /map`
- Free deterministic tour engine exposed through `POST /tour`
- Evidence-backed installation guide exposed through `POST /guide/install`
- Separate published-project and repository-development setup paths
- Context-aware natural-language file finder exposed through `POST /find`
- Deterministic agent router exposed through `POST /agent`
- Multi-tool Trail Plan for contribution goals, setup, implementation, and verification
- Budget-controlled GPT-5.6 Luna synthesis for contribution Trail Plans through the OpenAI Responses API
- Strict structured model output with evidence-grounded action plans, exact-path validation, and automatic free-mode fallback
- Persistent global `$100` Luna budget cap with conservative pre-call reservations and actual-cost reconciliation
- Filtered GitHub tree, README, metadata, language, and star count
- Package-manager, runtime, setup-command, and environment evidence detection
- Clickable tour stops that open real files and line ranges on GitHub
- Animated page landmarks that move the helper to repository controls, file trees, READMEs, and code regions
- Installation checklist with documented and inferred confidence labels
- One-click copying for sourced installation commands
- Ranked file matches with reasons, confidence, content evidence, and direct navigation
- Current-file import extraction, local dependency resolution, likely-caller search, and paired-test ranking
- Compact repository snapshot with purpose, stack, package manager, ref, key directories, entry point, and local commands
- Unified question composer with saved per-repository trails and suggested follow-ups
- Saved answer continuity across evidence navigation with a Back to saved trail action
- Quick or expanded answer depth controls and `Alt + Shift + W` keyboard access
- Commit-aware repository and answer caching in `chrome.storage.local`
- Edge-cached public GitHub responses with longer retention for immutable commit evidence
- Friendly rate-limit, private-repository, authentication, and offline states
- Bounded public request validation with normalized repository paths
- Manual repository refresh and active GitHub context sync controls
- Shared TypeScript contracts across the extension and Worker
- Editorial field-guide interface with loading, empty, ready, and error states
- Unit tests for URL parsing, caching, clipboard behavior, repository filtering, installation guidance, and file finding
- Browser regression tests for reload safety, GitHub context changes, keyboard dismissal, reduced motion, and non-repository routes

The deterministic engine uses repository conventions, file roles, aliases, test relationships, content symbols, current-directory context, language signals, and direct imports. The agent router classifies each question as orientation, installation, file discovery, current-file context, or contribution planning. Setup starts by distinguishing use of a published project from local repository development. Development answers omit consumer-only and placeholder commands, while consumer answers avoid workspace setup. Both expose confidence, evidence, and warnings. A contribution request runs several tools and combines the repository route, sourced setup commands, likely implementation, and related verification path. Recent maps, answers, preferences, and saved trails remain available during temporary GitHub or network failures.

Guided mode is patient and project-specific. It moves only during an explicit landmark tour, teaches the real GitHub term, and adds a fact about the repository at each stop. Quick mode stays quiet until opened, keeps the helper stationary, and leads with a compact repository snapshot and focused developer actions. Users can switch modes at any time without changing the underlying evidence or model policy.

## Workspace

```text
apps/extension     Chrome extension and floating page agent
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

Add an OpenAI API key to the same file to enable GPT-5.6 Luna synthesis for contribution Trail Plans. The key stays in the Worker and is never exposed to the extension. Without it, the deterministic agent remains fully functional. Luna is fixed in source, reasoning defaults to `low`, and `OPENAI_REASONING_EFFORT` can temporarily select `medium` or `high` for controlled evaluation.

The Worker requires both its Cloudflare per-client rate-limit binding and its global Durable Object budget before it enables paid synthesis. The rate limiter allows 10 model attempts per client per minute in each Cloudflare location. The persistent budget reserves a conservative worst-case amount before each request and reconciles it to actual token cost afterward. It stops paid synthesis at the full `$100` event credit balance. Exhausted or unavailable protection returns the deterministic answer instead of failing the request.

Start the Worker:

```bash
pnpm dev:api
```

In a second terminal, start the extension:

```bash
pnpm dev:extension
```

WXT opens a development browser with the unpacked extension installed. Visit a public GitHub repository and Wayfinder appears on the page. Choose "Guide me" for a visual, project-specific landmark tour or "Quick map" for a compact developer workflow. The selection is remembered and can be changed from the helper header.

## API smoke test

```bash
curl http://localhost:8787/health

curl -X POST http://localhost:8787/map \
  -H 'Content-Type: application/json' \
  -d '{"owner":"openai","repo":"openai-node","ref":"master"}'
```

`POST /agent` accepts a repository map, a natural-language question, and an optional current path. It routes a focused question through the tour, installation guide, or file finder. Contribution goals invoke all three capabilities to build a Trail Plan. When an OpenAI key is configured, Luna receives that typed contribution evidence and produces a structured synthesis plus an ordered field brief. Focused questions stay deterministic and free. Any unverified path, invalid response, API failure, exhausted allowance, or missing key returns the deterministic answer instead.

GitHub access errors use typed response codes so the extension can distinguish a public API rate limit from a private or missing repository. A GitHub token remains optional for public repositories and can be added to `apps/api/.dev.vars` for a higher rate limit.

The public Worker is deployed at [wayfinder-api.hopit-robert.workers.dev](https://wayfinder-api.hopit-robert.workers.dev/health). Production extension builds use this origin automatically, while development builds use `http://localhost:8787` unless `WXT_WAYFINDER_API_URL` is set.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm eval:luna
```

The live Luna evaluation is opt-in and requires `OPENAI_API_KEY`. It runs three representative contribution cases at low reasoning by default. See [Luna evaluation](docs/LUNA_EVALUATION.md) before increasing the reasoning level.

The extension build is written to `apps/extension/.output/chrome-mv3`. The Worker dry-run bundle is written to `apps/api/dist`.

Create the Chrome submission archive with:

```bash
pnpm --filter @wayfinder/extension zip
```
