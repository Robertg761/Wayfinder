# Luna Evaluation

Wayfinder uses only `gpt-5.6-luna`. The production default is low reasoning. Medium is tested only when low misses a quality gate, and high is tested only when medium still misses it.

## Spend boundary

Paid synthesis runs only for contribution Trail Plans. Orientation, installation, and file-location questions remain deterministic. The existing Cloudflare binding permits 10 model attempts per connecting IP per minute in each Cloudflare location, and a denied or unavailable allowance returns the free answer.

A SQLite-backed Durable Object adds a global lifetime cap of `$5`. It reserves a conservative maximum before each call and reconciles successful calls to actual token cost. The ledger includes the `$0.017336` spent during the initial evaluation and public verification. If the global budget service is missing, unavailable, or exhausted, model mode fails closed to the deterministic answer.

Each successful response records:

- input, cached input, output, reasoning, and total tokens
- end-to-end model latency
- estimated API cost using Luna standard rates of $1 per million uncached input tokens, $0.10 per million cached input tokens, and $6 per million output tokens

The dollar value is an estimate from response usage. The OpenAI credit balance remains the billing source of truth.

## Evaluation cases

The live harness uses three repository shapes and contribution goals:

1. TypeScript: speech generation in `openai/openai-node`
2. Python: request routing in `pallets/flask`
3. Go: authentication in `cli/cli`

For every case, the model must:

- return `mode: gpt-5.6` and `model: gpt-5.6-luna`
- produce at least one ordered field-brief action
- cite only paths supplied by the deterministic Trail Plan
- report nonzero usage
- explain a credible route from setup to implementation and verification

The automated checks enforce the first four requirements. Review the last requirement manually because it is the actual quality comparison.

## Commands

Run low reasoning first. This makes exactly three live model calls:

```bash
OPENAI_API_KEY="$(security find-generic-password -w -s wayfinder-openai 2>/dev/null)" pnpm eval:luna
```

If the key is already exported in the current terminal, use:

```bash
pnpm eval:luna
```

Test only the next reasoning level when low is not good enough:

```bash
LUNA_EFFORTS=medium pnpm eval:luna
```

Do not use `LUNA_EFFORTS=low,medium,high` during routine development. That makes nine calls at once and weakens the purpose of the staged gate.

## Decision record

| Case | Low quality | Low tokens | Low cost | Low latency | Escalation needed |
| --- | --- | ---: | ---: | ---: | --- |
| TypeScript speech | Pass | 2,462 | $0.004062 | 4,770 ms | No |
| Python routing | Retrieval evidence needs improvement | 2,265 | $0.004435 | 3,621 ms | No, fix deterministic retrieval |
| Go authentication | Pass | 2,416 | $0.004651 | 3,162 ms | No |

The first low-reasoning run used 7,143 total tokens and cost an estimated $0.013148 across three calls. Low reasoning produced clear, grounded field briefs. The Flask case should not move to medium reasoning because its weakness is the verification coordinate supplied by the deterministic retrieval layer, not the model's synthesis.

A separate production Worker check used the TypeScript speech case. It returned `gpt-5.6-luna` at low reasoning, cited the expected speech implementation and test, used 2,483 tokens, took 2,739 ms, and cost an estimated $0.004188.

Production stays at the lowest reasoning level that passes all three cases. Any later prompt or schema change requires rerunning low reasoning before raising the default.
