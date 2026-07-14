# Wayfinder Ship Checklist

Updated July 13, 2026.

## Complete

- [x] Repository map, tour, installation guide, file finder, and unified agent endpoint
- [x] Current GitHub repository, directory, and file context
- [x] Commit-aware repository and answer caching
- [x] Typed rate-limit, private repository, authentication, offline, and retry states
- [x] GPT-5.6 Responses API integration with strict structured output
- [x] Exact model evidence-path validation
- [x] Automatic deterministic fallback
- [x] Server-side OpenAI credential boundary and `store: false`
- [x] Public Worker deployment
- [x] Production extension points to the public Worker
- [x] Production manifest includes GitHub, local Worker, and public Worker origins
- [x] Chrome extension archive generated and inspected
- [x] Typecheck passes
- [x] All 48 automated tests pass
- [x] Extension production build passes
- [x] Worker dry run passes
- [x] GitHub Actions CI runs typecheck, tests, builds, packaging, and artifact upload
- [x] Public `openai/openai-node` orientation, installation, and file-find API dry run
- [x] Public matrix across TypeScript, Python, Rust, Go, and a truncated JavaScript monorepo
- [x] Representative evidence URLs return HTTP 200
- [x] Deprecated pagination wrapper regression fixed and tested
- [x] Architecture document
- [x] Timed demo script
- [x] Devpost story draft
- [x] Public privacy statement and contributor guide

## Needs credits

- [ ] Add `OPENAI_API_KEY` as a Cloudflare Worker secret
- [ ] Confirm `/health` reports `modelConfigured: true`
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
30a4315e5a29f1147ecddfc8623c645e14a0f9fd5d9b625b2e0c959dec9a95ec
```

Rebuild the archive after any extension source or configuration change, then update the checksum in this file and the Devpost draft.
