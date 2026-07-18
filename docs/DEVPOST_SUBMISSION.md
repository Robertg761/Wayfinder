# Devpost Submission Draft

This document is ready to paste after the final Chrome and live GPT-5.6 checks. Do not claim the model screenshot or live model call until the checklist records that proof.

## Project name

Wayfinder

## Tagline

An evidence-first agent that guides you through any unfamiliar GitHub repository.

## Short description

Wayfinder is a floating repository agent for GitHub. Its animated compass helper travels to real page landmarks, points them out, explains what they reveal, and expands in place for deeper questions. It extracts sourced installation steps, finds where a feature is implemented, and turns a contribution goal into an evidence-backed Trail Plan. GPT-5.6 reasons across the typed tool results to produce an ordered field brief, while strict path validation prevents it from inventing repository coordinates.

## Inspiration

Opening an unfamiliar repository feels less like reading a map and more like being dropped into a city with a list of street names. The files are all visible, but the practical questions remain: What does this project do? What should I read first? How do I run it? Where does a feature actually live?

General chat tools can help, but they make users move context out of GitHub and can answer with a plausible path that does not exist. We wanted the experience of an experienced contributor sitting beside you, pointing at the real repository and saying, "Start here, run this, and this is the evidence."

## What it does

Wayfinder appears as a small helper directly on GitHub. The user chooses Guided mode for a patient, project-specific tour or Quick mode for a quiet, compact developer map. It can lead a visual tour of the repository name, branch, file tree, README, breadcrumbs, code, and line coordinates. When a user asks a deeper question, the same helper expands to show repository answers, commands, Trail Plans, current-file relationships, and clickable evidence.

It can:

- summarize a repository and build a clickable reading route
- show a compact snapshot with stack, package manager, ref, commit, key directories, entry point, and local commands
- separate published-project installation from local repository development
- extract installation, development, test, and build commands from repository evidence
- label commands as documented, inferred, or conflicting
- find likely source files from a natural-language question
- turn a goal such as "I want to change speech generation" into a setup, implementation, and verification route
- use the active GitHub directory as ranking context
- classify the active file, route five distinct file actions, resolve explicit local dependencies, and show only target-specific caller and paired-test evidence
- open every recommended file at the mapped commit and known line range
- preserve the current trail while the user follows evidence through GitHub
- keep recent evidence available through temporary network or GitHub failures
- use GPT-5.6 to synthesize an ordered field brief from several typed tool results

The free deterministic route remains fully functional. If the OpenAI key is missing, the model API is unavailable, structured output is invalid, or GPT-5.6 names a path outside the evidence set, Wayfinder returns the deterministic answer automatically.

Paid synthesis is protected by a Cloudflare rate-limit binding and a persistent global budget matching the `$100` event credit balance. A SQLite-backed Durable Object serializes spend reservations across all users, reconciles successful calls to actual Luna token usage, and fails closed to the deterministic answer. Cost protection therefore does not turn into a user-facing outage.

## How we built it

The Chrome extension uses WXT, TypeScript, Shadow DOM, and Manifest V3. A content script tracks GitHub single-page navigation, renders the isolated helper, maps visible landmarks, calls the Worker, caches results locally, and keeps the complete experience on the active page.

A TypeScript Cloudflare Worker provides explicit repository tools:

- repository mapper
- guided tour builder
- installation evidence extractor
- contextual file finder
- deterministic intent router
- multi-tool contribution orchestrator

The mapper reads GitHub metadata, the exact viewed branch, tag, or commit, README content, setup landmarks, and a compact source tree. The file finder ranks the full filtered tree, then fetches only the five strongest small text candidates for content and symbol evidence. Current-file questions first distinguish source, test, documentation, configuration, data, and other files, then route summary, dependency, caller, test, and impact actions separately. Relationship results require target-specific evidence; documentation is summarized from its own headings instead of being treated as executable source. The install tool extracts documented commands with line references and uses manifests only for clearly labeled inference.

GPT-5.6 Luna is connected through the OpenAI Responses API for contribution Trail Plans. The model receives the user's question and the completed typed evidence, uses the lowest reasoning level that passes our evaluation, and must return strict structured output containing a direct answer, explanation, citations, and up to four ordered actions. Responses are not stored. Before the answer reaches the extension, the Worker verifies that every model evidence path and action coordinate occurs in the deterministic result. Focused questions stay on the deterministic route, and successful model calls report token usage, latency, and estimated cost.

## Challenges we ran into

The hardest problem was not generating an answer. It was deciding which parts of an answer deserved trust.

Large repositories need aggressive filtering, but alphabetical truncation can hide the files that explain the architecture. Installation documentation mixes user setup, contributor setup, several package managers, and commands that look executable but are only examples. File names can also be deceptive. During the final dry run, `src/pagination.ts` looked like the perfect match, but source inspection revealed that it was a deprecated forwarding file. We changed the ranking to reorder candidates after content inspection and prefer the core implementation.

We also needed a useful path before model credits arrived. That constraint produced a stronger architecture: deterministic tools are independently valuable, and GPT-5.6 improves interpretation without owning the facts.

## Accomplishments that we are proud of

- Every concrete command and file recommendation carries repository evidence.
- The extension works on public repositories without OpenAI credits.
- GPT-5.6 output is constrained by a strict schema and an exact-path allow-list.
- Paid model traffic has both per-client rate limiting and a persistent global budget cap.
- The same typed contracts drive free mode, model mode, caching, and the interface.
- Trail Plan combines orientation, sourced setup, implementation discovery, and related tests into one contributor workflow.
- The production Worker is live and the Chrome package uses it automatically.
- The automated suite covers 132 unit and integration cases plus 44 complete browser workflows across URL context, late-rendered and off-screen landmarks, editor focus and host-page shortcut containment, mode persistence, public request validation, ref correctness, beginner-first Releases and OS selection, delayed release assets, setup intent, file-type-aware current-file context, model allowance fallback, global budget accounting, local and edge caching, repository mapping, tours, contribution routing, file ranking, and model fallback.
- A repeatable public smoke test passes across TypeScript, Python, Rust, Go, and a truncated JavaScript monorepo.
- The live public dry run correctly found `src/core/pagination.ts` in `openai/openai-node` after excluding its deprecated wrapper.

## What we learned

An agent becomes more useful when its tools expose uncertainty instead of hiding it. Confidence labels, ranked alternatives, source lines, and explicit warnings are not secondary interface details. They are part of the reasoning system.

We also learned that a model does not need to own retrieval to provide meaningful intelligence. GPT-5.6 can focus on intent and explanation while deterministic code maintains the boundary around repository facts. That division produces a better fallback and a more trustworthy primary experience.

## What's next

- expand the bounded likely-caller search into a complete symbol-aware call graph
- add private-repository authentication with an explicit consent flow
- add symbol-aware impact analysis beyond direct imports and paired tests
- support saved onboarding routes for teams and contributors
- add a VS Code surface that consumes the same Worker contracts

## Built with

- GPT-5.6
- OpenAI Responses API
- TypeScript
- Shadow DOM
- WXT
- Chrome Extensions Manifest V3
- Cloudflare Workers
- GitHub REST API
- Zod
- Vitest
- pnpm

## Links

- Public health endpoint: `https://wayfinder-api.hopit-robert.workers.dev/health`
- Source repository: `https://github.com/Robertg761/Wayfinder`
- Demo video: add after recording

Verified screenshot candidates:

- `docs/assets/wayfinder-page-helper-welcome.jpg`
- `docs/assets/wayfinder-page-helper-landmark.jpg`

## Verified submission facts

- Public Worker URL: `https://wayfinder-api.hopit-robert.workers.dev`
- Current Worker version: `60bc20e8-71a3-41b3-a870-71ae8a63ad04`
- Chrome archive: `apps/extension/.output/wayfinderextension-0.1.0-chrome.zip`
- Archive SHA-256: `5c30148feaf03e811dc2929ecbd0e905a462fed6b9140a3b61284bd43edcbb1b`
- Automated checks: 132 unit and integration tests, 44 browser workflows, typecheck, extension production build, Worker dry run
- Live public matrix: see `docs/VERIFICATION_MATRIX.md`
- Live GPT-5.6 credit-backed call: passed with `gpt-5.6-luna` at low reasoning
