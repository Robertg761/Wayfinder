# Public Verification Matrix

Updated July 15, 2026.

Endpoint: `https://wayfinder-api.hopit-robert.workers.dev`

Worker version: `fe43d4c2-c27c-476e-a982-dcb2a7ddb041`

The matrix runs through the public Worker without an OpenAI key or GitHub token. Each case maps the current default-branch commit, requests orientation, requests installation guidance, asks one file-discovery question, and verifies representative evidence through `raw.githubusercontent.com`.

## Results

| Shape | Repository and commit | Tour | Install | File question | Strongest coordinate | Result |
|---|---|---:|---:|---|---|---|
| TypeScript SDK | `openai/openai-node@62554053803dea45bf949699c7ea9d1a414df615` | 6 stops | 4 steps | Where is pagination implemented? | `src/core/pagination.ts` | Pass, strong |
| Python framework | `pallets/flask@36e4a824f340fdee7ed50937ba8e7f6bc7d17f81` | 6 stops | 1 step | Where is request routing implemented? | `src/flask/sansio/app.py` | Pass, strong |
| Rust CLI | `BurntSushi/ripgrep@d5b85d44057ff729a89be9c6549958c45d95aa99` | 6 stops | 12 steps | Which file defines the command line executable? | `crates/core/main.rs` | Pass, strong |
| Go CLI | `cli/cli@c14cbaa24a75272958161751240fd538a68e6c04` | 6 stops | 2 steps | Where is authentication handled? | `pkg/cmd/auth/login/login.go` | Pass, strong |
| Truncated monorepo | `vercel/next.js@7ffacec8ef5a58e6997b322056d2c56bb54452b1` | 6 stops | 10 steps | Where is routing implemented? | `packages/next/src/shared/lib/router/routes/app.ts` | Pass, likely |

Flask and GitHub CLI correctly warn that their inspected setup instructions are structural inferences rather than explicit contributor commands. The warning is part of the expected result.

The full matrix passed again after deploying unauthenticated GitHub subrequest caching.

Worker version `fe43d4c2-c27c-476e-a982-dcb2a7ddb041` passed the full matrix after adding requested-ref mapping, consumer and contributor setup separation, orientation setup evidence, and current-file dependency context. A targeted production check remapped `openai/openai-node` from its exact commit SHA and returned the same requested ref, resolved ref, and commit SHA. Consumer setup returned the documented `npm install openai`, `deno add jsr:@openai/openai`, and `npx jsr add @openai/openai` commands. Current-file context for `src/index.ts` extracted local imports, resolved them to files including `src/client.ts` and `src/core/pagination.ts`, and ranked likely paired tests. A caller check for `src/core/pagination.ts` returned `src/resources/admin/organization/usage.ts` as a strong production candidate while excluding test, fixture, example, evaluation, benchmark, and ecosystem-test surfaces.

Trail Plan was also exercised through the public Worker on `openai/openai-node`. The goal `I want to change speech generation. Plan my first contribution.` returned `src/resources/audio/speech.ts` for implementation and `tests/api-resources/audio/speech.test.ts` for verification. The post-propagation check used Worker version `ace31ff6-e34a-4469-98f9-d6f80fc358e0` and returned HTTP 200 in deterministic mode.

After enabling the model, the same public Trail Plan returned `mode: gpt-5.6`, model `gpt-5.6-luna`, and low reasoning from Worker version `a42744b3-3db3-419f-8e77-654a4495441c`. It preserved the expected speech implementation and test coordinates, used 2,483 tokens, took 2,739 ms, and cost an estimated $0.004188.

Worker version `ea9f71ea-ff43-4a7e-890f-cd3340403b28` added the persistent global budget. A live speech Trail Plan reported `$0.004206`, and the Durable Object ledger increased by exactly `$0.004206` to `$0.021542`. The outstanding reservation returned to zero. The cap was then raised to the full `$100` event credit balance, leaving `$99.978458` available.

Worker version `6e0084fa-937d-47fa-902b-73c614c06147` verified the rotated `$100` ledger in production with `$0.021542` spent, zero reserved, and `$99.978458` remaining.

Worker version `5e1c4017-5fb7-4da2-abec-0031d605b163` fixed goal-linked contribution verification. The Flask routing rerun replaced generic CLI fixtures with `tests/test_basic.py`, `tests/test_blueprints.py`, and `tests/test_cli.py`. Luna passed at low reasoning with 2,378 tokens, 3,729 ms latency, and an estimated cost of `$0.004663`. Total tracked model spend after propagation verification was `$0.030982`.

The public boundary also rejects malformed JSON and normalized-path violations with HTTP 400. Health reports model configuration, protection, and effective enablement separately.

## Defects found and fixed

The matrix caught concrete errors that smaller fixtures did not expose:

1. A deprecated pagination re-export outranked the core implementation.
2. Test files outranked production source for implementation questions.
3. Markdown issue templates matched code questions through generic words.
4. Go `_test.go` files were not recognized as tests.
5. A Rust CLI helper outranked the literal `main.rs` executable entry.
6. Next.js eval, example, and benchmark code outranked framework router source.
7. Generic files named `test.ts` outranked tests that matched the actual contribution feature.

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
