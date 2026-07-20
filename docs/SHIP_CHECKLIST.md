# Wayfinder Ship Checklist

Updated July 19, 2026.

## Complete

- [x] Repository map, tour, installation guide, file finder, and unified agent endpoint
- [x] Current GitHub repository, directory, and file context
- [x] Commit-aware repository and answer caching
- [x] Unauthenticated GitHub edge caching with authenticated-request bypass
- [x] Bounded repository-map validation and normalized path enforcement
- [x] Malformed JSON returns a typed client error
- [x] Public Worker rejects traversal paths and malformed JSON with HTTP 400
- [x] README rate limits and upstream failures propagate instead of degrading silently
- [x] Typed rate-limit, private repository, authentication, offline, and retry states
- [x] Separate 60-per-minute public API guard and bounded GitHub, OpenAI, and extension requests
- [x] GPT-5.6 Responses API integration with strict structured output
- [x] Exact model evidence-path, path-like prose, and command validation
- [x] Automatic deterministic fallback
- [x] Server-side OpenAI credential boundary and `store: false`
- [x] Paid synthesis protected by a Cloudflare rate-limit binding with deterministic fallback
- [x] Persistent global `$100` event-credit budget with conservative reservation and actual-cost reconciliation
- [x] Production budget ledger reconciles a live call exactly and releases its reservation
- [x] Public Worker deployment
- [x] Production extension points to the public Worker
- [x] Production manifest includes GitHub, local Worker, and public Worker origins
- [x] Chrome extension archive generated and inspected
- [x] Typecheck passes
- [x] All 178 unit and integration tests pass
- [x] All 49 browser workflows pass
- [x] Extension production build passes
- [x] Worker dry run passes
- [x] GitHub Actions CI runs typecheck, unit tests, all browser workflows, builds, packaging, archive integrity, and checksum verification
- [x] Public `openai/openai-node` orientation, installation, and file-find API dry run
- [x] Public matrix across TypeScript, Python, Rust, Go, and a truncated JavaScript monorepo
- [x] Consumer commands must name the repository product rather than an unrelated developer tool
- [x] Repository setup ignores nested subsystem READMEs and preserves documented command order
- [x] Representative evidence URLs return HTTP 200
- [x] Production preview passes at 320 pixels with no page-level horizontal overflow
- [x] Close control keeps at least 8 pixels of clearance from the Guided/Quick switch in both modes
- [x] Public installation answer and command-copy interaction verified in the narrow preview
- [x] Deprecated pagination wrapper regression fixed and tested
- [x] Contribution verification remains goal-linked and demotes test-support fixtures
- [x] README and other non-source files stay outside the source caller/test graph
- [x] Current-file actions render only the requested summary, dependency, caller, test, or impact evidence
- [x] Possible relationship matches cannot become headline or model claims
- [x] Architecture document
- [x] Timed demo script
- [x] Devpost story draft
- [x] Public privacy statement and contributor guide
- [x] MIT license added to the release candidate
- [x] Security policy, structured issue forms, and pull request checklist added to the release candidate
- [x] Branded Chrome icons generated reproducibly from the tracked compass SVG

## Live model verification

- [x] Add `OPENAI_API_KEY` as a Cloudflare Worker secret
- [x] Run the three-case low-reasoning Luna evaluation and record usage, latency, and quality
- [x] Fix the Flask retrieval weakness and confirm the rerun passes at low reasoning
- [x] Confirm `/health` reports `modelConfigured: true`, `modelProtected: true`, and `modelEnabled: true`
- [x] Run one live GPT-5.6 question through the deployed `/agent` endpoint
- [x] Confirm the response has `mode: gpt-5.6`, model `gpt-5.6-luna`, low reasoning, and only valid evidence paths
- [x] Capture the GPT-5.6 synthesis screenshot

Add the secret with:

```bash
pnpm --filter @wayfinder/api exec wrangler secret put OPENAI_API_KEY
```

Luna is fixed in source. The recorded live Luna verification used Worker version `05944911-a15f-472c-9bf2-956b939a9686`. See `docs/LUNA_EVALUATION.md` for the budget gate and recorded results.

## Needs manual Chrome verification

- [x] Create an isolated local Chrome profile named `Wayfinder QA`
- [x] Load the production unpacked build and confirm the extension is enabled
- [x] Confirm the floating helper appears automatically on a public repository
- [x] Complete all four on-page landmarks and confirm the helper moves, highlights, scrolls, and explains each target
- [x] Confirm `Explain this` answers about the highlighted landmark without moving or opening generic starters
- [ ] Extract the production zip and load it unpacked in a clean Chrome profile
- [x] Confirm orientation loads from the public Worker
- [x] Run the installation and contribution questions from the demo script
- [x] Click a tour stop, install source, and file result
- [x] Confirm GitHub navigation updates the current context
- [x] Confirm the attached helper dock has no clipping, separation, overlap, or horizontal scroll
- [x] Confirm cache timestamps and full repository refresh controls
- [x] Confirm three consecutive GitHub reloads preserve both the host page and helper
- [x] Run automated browser coverage for reloads, navigation, keyboard dismissal, reduced motion, and non-repository routes
- [x] Confirm Guided mode recovers the repository landmark after leaving and returning to a modern GitHub Releases page
- [ ] Capture the four screenshots listed in `docs/DEMO_SCRIPT.md` (two verified helper frames are already in `docs/assets`)

## Needs submission assets

- [ ] Ask another person to choose a public repository and complete the four core jobs
- [x] Record the primary demo
- [ ] Record or retain a free-mode backup demo
- [x] Publish the source repository and add its URL to Devpost
- [x] Add the demo video URL
- [x] Paste and review `docs/DEVPOST_SUBMISSION.md`
- [x] Verify every Devpost claim against this checklist
- [x] Submit before July 21, 2026 at 5:00 PM Pacific Time

## Needs release propagation

- [x] Publish the July 19 source candidate to the public repository
- [x] Deploy the July 19 setup-guidance hardening
- [x] Rerun the strengthened five-repository matrix against the deployed Worker

## Release artifact

Path:

```text
apps/extension/.output/wayfinderextension-0.1.0-chrome.zip
```

Current SHA-256:

```text
8061b57a49b420f7afaa9cecabaca93a7bbca4af2b556e3e1c3f98caeee67499
```

Rebuild the archive after any extension source or configuration change, then update the checksum in this file and the Devpost draft.
