# Public Verification Matrix

Updated July 19, 2026.

Endpoint: `https://wayfinder-api.hopit-robert.workers.dev`

Current Worker version: `a819c6ca-aeea-49fc-bd66-fa1ca69e9cdf`

Full cross-repository matrix baseline: `a819c6ca-aeea-49fc-bd66-fa1ca69e9cdf`

The matrix runs through the public Worker without sending an OpenAI key or GitHub token. Each focused case stays on the deterministic route, maps the current default-branch commit, requests orientation, checks both developer and end-user installation guidance, asks one file-discovery question, and verifies representative evidence through `raw.githubusercontent.com`.

The July 19 source candidate strengthens the matrix further: every consumer command must name the mapped product, and every setup step must come from root-level or explicitly named setup documentation. Targeted local-Worker replays passed on current ripgrep and Next.js commits after removing unrelated platform-preparation commands from the ripgrep development route and `.conductor/README.md` commands from the Next.js route. Deploy this candidate and rerun all five cases before replacing the public baseline below.

## Results

| Shape | Repository and commit | Tour | Install | File question | Strongest coordinate | Result |
|---|---|---:|---:|---|---|---|
| TypeScript SDK | `openai/openai-node@2706888499a777b47d851aeb479f846f80932765` | 6 stops | 4 dev / 3 use | Where is pagination implemented? | `src/core/pagination.ts` | Pass, strong |
| Python framework | `pallets/flask@36e4a824f340fdee7ed50937ba8e7f6bc7d17f81` | 6 stops | 1 dev / release fallback | Where is request routing implemented? | `src/flask/sansio/scaffold.py` | Pass, strong |
| Rust CLI | `BurntSushi/ripgrep@227381db0ee83dfa4341f1e27ff9617c0f5ad992` | 6 stops | 6 dev / 6 use | Which file defines the command line executable? | `crates/core/main.rs` | Pass, strong |
| Go CLI | `cli/cli@2af8c115be240a8018add33bf5c7a9ba5070a62c` | 6 stops | 2 dev / release fallback | Where is authentication handled? | `pkg/cmd/auth/login/login.go` | Pass, strong |
| Truncated monorepo | `vercel/next.js@0491db047b8f9c4a5f9d0285ad9ed514bb134873` | 6 stops | 10 dev / release fallback | Where is routing implemented? | `packages/next/src/shared/lib/router/routes/app.ts` | Pass, likely |

Flask, GitHub CLI, and Next.js correctly keep repository-development setup separate from end-user guidance. When no documented consumer command exists, they return a conditional latest-release fallback instead of presenting contributor setup as installation.

Worker version `a819c6ca-aeea-49fc-bd66-fa1ca69e9cdf` passed the complete matrix after the task-execution hardening release. Health reported the public API limiter active, all five repositories returned an explicit non-manifest runtime entry point, developer and consumer audiences stayed separate, and every representative evidence path resolved at the mapped commit SHA. The model budget remained at `$0.043734`, confirming that the focused matrix stayed deterministic.

The full matrix passed again after deploying unauthenticated GitHub subrequest caching.

Worker version `7ab427e1-0d26-4068-92d5-3cdbf1e8eb9b` passed a targeted regression on `Robertg761/HA-Desktop-Widget@0eb45a8645144ab935dd8b2fac177e7158ce93ee`. All five literal README actions routed to file context with separate summary, caller, test, dependency, and impact focuses. The Worker classified `README.md` as documentation, extracted its real headings, and returned no invented imports, callers, or paired tests. The checks stayed in deterministic free mode; the production model ledger remained at `$0.039158` spent with `$99.960842` available before and after the replay.

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
8. A nested tool README was treated as repository-wide setup evidence in a large monorepo.
9. A syntactically valid package install for a developer tool was presented as end-user installation for the repository.
10. Prerequisite reordering could move a documented directory change ahead of the command that created it.

Each fix now has focused regression coverage in the API suite.

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

The script exits nonzero when routing selects the wrong tool, no coordinate is returned, an expected landmark changes, consumer guidance names another product, setup evidence leaks from a subsystem README, or a representative evidence URL is unavailable.
