# Public Verification Matrix

Updated July 13, 2026.

Endpoint: `https://wayfinder-api.hopit-robert.workers.dev`

Worker version: `caa4fe63-2c93-46a0-85f7-f35c328d6613`

The matrix runs through the public Worker without an OpenAI key or GitHub token. Each case maps the current default-branch commit, requests orientation, requests installation guidance, asks one file-discovery question, and verifies representative evidence through `raw.githubusercontent.com`.

## Results

| Shape | Repository and commit | Tour | Install | File question | Strongest coordinate | Result |
|---|---|---:|---:|---|---|---|
| TypeScript SDK | `openai/openai-node@1cdc0196b4341ee641ec6839e08744b2771250e4` | 6 stops | 8 steps | Where is pagination implemented? | `src/core/pagination.ts` | Pass, strong |
| Python framework | `pallets/flask@36e4a824f340fdee7ed50937ba8e7f6bc7d17f81` | 6 stops | 1 step | Where is request routing implemented? | `src/flask/sansio/app.py` | Pass, strong |
| Rust CLI | `BurntSushi/ripgrep@d5b85d44057ff729a89be9c6549958c45d95aa99` | 6 stops | 12 steps | Which file defines the command line executable? | `crates/core/main.rs` | Pass, strong |
| Go CLI | `cli/cli@c14cbaa24a75272958161751240fd538a68e6c04` | 6 stops | 2 steps | Where is authentication handled? | `pkg/cmd/auth/login/login.go` | Pass, strong |
| Truncated monorepo | `vercel/next.js@1ecd8f1b63a29ccda8c4febb51e1dfa148a9c1dc` | 6 stops | 10 steps | Where is routing implemented? | `packages/next/src/shared/lib/router/routes/app.ts` | Pass, likely |

Flask and GitHub CLI correctly warn that their inspected setup instructions are structural inferences rather than explicit contributor commands. The warning is part of the expected result.

## Defects found and fixed

The matrix caught concrete errors that smaller fixtures did not expose:

1. A deprecated pagination re-export outranked the core implementation.
2. Test files outranked production source for implementation questions.
3. Markdown issue templates matched code questions through generic words.
4. Go `_test.go` files were not recognized as tests.
5. A Rust CLI helper outranked the literal `main.rs` executable entry.
6. Next.js eval, example, and benchmark code outranked framework router source.

Each fix now has regression coverage in `apps/api/test/find.test.ts`.

## Repeat the matrix

Run all cases:

```bash
pnpm smoke:public node python rust go monorepo
```

Run one repository shape:

```bash
pnpm smoke:public rust
```

Override the target service when testing a local or preview Worker:

```bash
WAYFINDER_API_URL=http://localhost:8787 pnpm smoke:public node
```

The script exits nonzero when routing selects the wrong tool, no coordinate is returned, an expected landmark changes, or a representative evidence URL is unavailable.
