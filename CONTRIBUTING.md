# Contributing to Wayfinder

## Prerequisites

- Node.js 20 or newer
- pnpm 10
- Chrome or another Chromium browser for extension testing

## Local setup

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Both tokens are optional for local public-repository development:

```text
GITHUB_TOKEN=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6
```

Start the Worker:

```bash
pnpm dev:api
```

Start the extension in another terminal:

```bash
pnpm dev:extension
```

## Required checks

Run these before committing:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Create the Chrome archive with:

```bash
pnpm --filter @wayfinder/extension zip
```

## Public smoke tests

The deployed-service matrix is intentionally separate from unit tests because it calls GitHub and the public Worker.

```bash
pnpm smoke:public node python rust go monorepo
```

Individual case names are `node`, `python`, `rust`, `go`, and `monorepo`.

## Evidence rules

Changes must preserve these product guardrails:

1. Every displayed command has a repository source.
2. Inferred setup steps are labeled as inferred.
3. File answers include reasons, match signals, and confidence.
4. Model prose cannot introduce a repository path absent from deterministic evidence.
5. Free mode remains useful when no OpenAI key is configured.
6. New ranking behavior includes a focused regression test.

## Commit style

Use short conventional commit messages such as:

```text
feat: add repository context control
fix: prefer implementation files over fixtures
docs: record public verification matrix
```
