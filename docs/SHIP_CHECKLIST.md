# Wayfinder Ship Checklist

Updated July 14, 2026.

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
- [x] GPT-5.6 Responses API integration with strict structured output
- [x] Exact model evidence-path validation
- [x] Automatic deterministic fallback
- [x] Server-side OpenAI credential boundary and `store: false`
- [x] Paid synthesis protected by a Cloudflare rate-limit binding with deterministic fallback
- [x] Public Worker deployment
- [x] Production extension points to the public Worker
- [x] Production manifest includes GitHub, local Worker, and public Worker origins
- [x] Chrome extension archive generated and inspected
- [x] Typecheck passes
- [x] All 68 automated tests pass
- [x] Extension production build passes
- [x] Worker dry run passes
- [x] GitHub Actions CI runs typecheck, tests, builds, packaging, archive integrity, and checksum verification
- [x] Public `openai/openai-node` orientation, installation, and file-find API dry run
- [x] Public matrix across TypeScript, Python, Rust, Go, and a truncated JavaScript monorepo
- [x] Representative evidence URLs return HTTP 200
- [x] Production preview passes at 320 pixels with no page-level horizontal overflow
- [x] Public installation answer and command-copy interaction verified in the narrow preview
- [x] Deprecated pagination wrapper regression fixed and tested
- [x] Architecture document
- [x] Timed demo script
- [x] Devpost story draft
- [x] Public privacy statement and contributor guide

## Needs credits

- [ ] Add `OPENAI_API_KEY` as a Cloudflare Worker secret
- [ ] Confirm `/health` reports `modelConfigured: true`, `modelProtected: true`, and `modelEnabled: true`
- [ ] Run one live GPT-5.6 question through the deployed `/agent` endpoint
- [ ] Confirm the response has `mode: gpt-5.6`, the expected model name, and only valid evidence paths
- [ ] Capture the GPT-5.6 synthesis screenshot

Add the secret with:

```bash
pnpm --filter @wayfinder/api exec wrangler secret put OPENAI_API_KEY
```

No source change or redeploy should be required after the secret is added.

## Needs manual Chrome verification

- [ ] Install the production zip in a clean Chrome profile
- [ ] Confirm the toolbar action opens the side panel
- [ ] Confirm orientation loads from the public Worker
- [ ] Run the installation and pagination questions from the demo script
- [ ] Click a tour stop, install source, and file result
- [ ] Confirm GitHub navigation updates the current context
- [ ] Confirm the narrow panel has no clipping, overlap, or horizontal scroll
- [ ] Confirm cache timestamps and manual refresh controls
- [ ] Capture the four screenshots listed in `docs/DEMO_SCRIPT.md`

## Needs submission assets

- [ ] Ask another person to choose a public repository and complete the four core jobs
- [ ] Record the primary demo
- [ ] Record or retain a free-mode backup demo
- [ ] Publish the source repository and add its URL to Devpost
- [ ] Add the demo video URL
- [ ] Paste and review `docs/DEVPOST_SUBMISSION.md`
- [ ] Verify every Devpost claim against this checklist
- [ ] Submit before July 21, 2026 at 5:00 PM Pacific Time

## Release artifact

Path:

```text
apps/extension/.output/wayfinderextension-0.1.0-chrome.zip
```

Current SHA-256:

```text
bd0811b3cb73ca4fef9e1461f3259b268620acbe5dae7c080e2c30e733856b13
```

Rebuild the archive after any extension source or configuration change, then update the checksum in this file and the Devpost draft.
