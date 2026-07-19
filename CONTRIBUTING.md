# Contributing to Wayfinder

## Prerequisites

- Node.js 22 or newer
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
OPENAI_REASONING_EFFORT=low
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
pnpm test:browser
pnpm build
```

For extension interface changes, also run the repository's unpacked-extension
runtime verification described in `apps/extension/.claude/skills/verify` and
inspect the light, dark, narrow, and failure-state screenshots it produces.

When the compass artwork changes, regenerate every Chrome icon size from the
tracked SVG source:

```bash
pnpm icons:extension
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
2. Repository-wide setup comes from root or explicitly named setup documents; nested subsystem READMEs do not leak into it.
3. Consumer installation commands name the mapped project, and inferred setup steps are labeled as inferred.
4. File answers include reasons, match signals, and confidence.
5. Model prose cannot introduce a repository path or shell command absent from deterministic evidence.
6. Free mode remains useful when no OpenAI key is configured.
7. New ranking or setup behavior includes a focused regression test.

## Pull requests

- Keep changes scoped to a concrete repository task or reliability boundary.
- Include before-and-after screenshots for visible interface changes.
- Link a public repository or deterministic fixture that demonstrates the task.
- Never commit `.dev.vars`, tokens, private repository content, generated build
  output, or browser profiles.
- By contributing, you agree that your contribution is licensed under the
  repository's [MIT License](LICENSE).

## Commit style

Use short conventional commit messages such as:

```text
feat: add repository context control
fix: prefer implementation files over fixtures
docs: record public verification matrix
```
