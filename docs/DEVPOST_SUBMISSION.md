# Devpost Submission Draft

This document is ready to paste after the final Chrome and live GPT-5.6 checks. Do not claim the model screenshot or live model call until the checklist records that proof.

## Project name

Wayfinder

## Tagline

An evidence-first agent that guides you through any unfamiliar GitHub repository.

## Short description

Wayfinder is a Chrome side-panel agent for GitHub. It shows developers where to start, extracts sourced installation steps, finds where a feature is implemented, and opens every answer at the exact repository evidence. GPT-5.6 turns deterministic tool results into natural guidance, while strict path validation prevents it from inventing repository coordinates.

## Inspiration

Opening an unfamiliar repository feels less like reading a map and more like being dropped into a city with a list of street names. The files are all visible, but the practical questions remain: What does this project do? What should I read first? How do I run it? Where does a feature actually live?

General chat tools can help, but they make users move context out of GitHub and can answer with a plausible path that does not exist. We wanted the experience of an experienced contributor sitting beside you, pointing at the real repository and saying, "Start here, run this, and this is the evidence."

## What it does

Wayfinder lives in a Chrome side panel and follows the repository, directory, or file currently open in GitHub.

It can:

- summarize a repository and build a clickable reading route
- extract installation, development, test, and build commands from repository evidence
- label commands as documented, inferred, or conflicting
- find likely source files from a natural-language question
- use the active GitHub directory as ranking context
- open every recommended file at the mapped commit and known line range
- keep recent evidence available through temporary network or GitHub failures
- use GPT-5.6 to synthesize a clearer answer from the typed tool result

The free deterministic route remains fully functional. If the OpenAI key is missing, the model API is unavailable, structured output is invalid, or GPT-5.6 names a path outside the evidence set, Wayfinder returns the deterministic answer automatically.

Paid synthesis is protected by a Cloudflare rate-limit binding. A denied or unavailable model allowance also returns the deterministic answer, so cost protection does not turn into a user-facing outage.

## How we built it

The Chrome extension uses WXT, React, TypeScript, and Manifest V3. A content script tracks GitHub single-page navigation and sends the active repository context to the side panel.

A TypeScript Cloudflare Worker provides explicit repository tools:

- repository mapper
- guided tour builder
- installation evidence extractor
- contextual file finder
- deterministic intent router

The mapper reads GitHub metadata, the current commit, README content, setup landmarks, and a compact source tree. The file finder ranks the full filtered tree, then fetches only the five strongest small text candidates for content and symbol evidence. The install tool extracts documented commands with line references and uses manifests only for clearly labeled inference.

GPT-5.6 is connected through the OpenAI Responses API. The model receives the user's question and the completed typed tool result, uses medium reasoning, and must return strict structured output. Responses are not stored. Before the answer reaches the extension, the Worker verifies that every model evidence path occurs in the deterministic result.

## Challenges we ran into

The hardest problem was not generating an answer. It was deciding which parts of an answer deserved trust.

Large repositories need aggressive filtering, but alphabetical truncation can hide the files that explain the architecture. Installation documentation mixes user setup, contributor setup, several package managers, and commands that look executable but are only examples. File names can also be deceptive. During the final dry run, `src/pagination.ts` looked like the perfect match, but source inspection revealed that it was a deprecated forwarding file. We changed the ranking to reorder candidates after content inspection and prefer the core implementation.

We also needed a useful path before model credits arrived. That constraint produced a stronger architecture: deterministic tools are independently valuable, and GPT-5.6 improves interpretation without owning the facts.

## Accomplishments that we are proud of

- Every concrete command and file recommendation carries repository evidence.
- The extension works on public repositories without OpenAI credits.
- GPT-5.6 output is constrained by a strict schema and an exact-path allow-list.
- The same typed contracts drive free mode, model mode, caching, and the interface.
- The production Worker is live and the Chrome package uses it automatically.
- The test suite covers 61 cases across URL context, public request validation, model allowance fallback, local and edge caching, clipboard behavior, repository mapping, tours, installation extraction, intent routing, file ranking, and model fallback.
- A repeatable public smoke test passes across TypeScript, Python, Rust, Go, and a truncated JavaScript monorepo.
- The live public dry run correctly found `src/core/pagination.ts` in `openai/openai-node` after excluding its deprecated wrapper.

## What we learned

An agent becomes more useful when its tools expose uncertainty instead of hiding it. Confidence labels, ranked alternatives, source lines, and explicit warnings are not secondary interface details. They are part of the reasoning system.

We also learned that a model does not need to own retrieval to provide meaningful intelligence. GPT-5.6 can focus on intent and explanation while deterministic code maintains the boundary around repository facts. That division produces a better fallback and a more trustworthy primary experience.

## What's next

- expand model orchestration for questions that need more than one repository tool
- add private-repository authentication with an explicit consent flow
- explain relationships between the active file and nearby callers or tests
- support saved onboarding routes for teams and contributors
- add a VS Code surface that consumes the same Worker contracts

## Built with

- GPT-5.6
- OpenAI Responses API
- TypeScript
- React
- WXT
- Chrome Extensions Manifest V3
- Cloudflare Workers
- GitHub REST API
- Zod
- Vitest
- pnpm

## Links

- Public health endpoint: `https://wayfinder-api.hopit-robert.workers.dev/health`
- Source repository: add after publishing
- Demo video: add after recording

## Verified submission facts

- Public Worker URL: `https://wayfinder-api.hopit-robert.workers.dev`
- Current Worker version: `b413ee5b-e983-43e1-af42-e00d56604f49`
- Chrome archive: `apps/extension/.output/wayfinderextension-0.1.0-chrome.zip`
- Archive SHA-256: `c5ed4be0b3151bc31f9d426111a7ff8ec86f09d53689865b16529a0fed61d779`
- Automated checks: 61 tests, typecheck, extension production build, Worker dry run
- Live public matrix: see `docs/VERIFICATION_MATRIX.md`
- Live GPT-5.6 credit-backed call: pending
