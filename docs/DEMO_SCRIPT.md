# Wayfinder Demo Script

Target length: 2 minutes 50 seconds.

Demo repository: `openai/openai-node` at the current default-branch commit.

## Before recording

1. Install `apps/extension/.output/wayfinderextension-0.1.0-chrome.zip` in a clean Chrome profile.
2. Open `https://github.com/openai/openai-node`.
3. Confirm `https://wayfinder-api.hopit-robert.workers.dev/health` returns `ok: true`.
4. If credits are available, confirm health reports `modelConfigured: true`, `modelProtected: true`, and `modelEnabled: true`.
5. Keep the panel narrow enough to look like a normal GitHub side panel.
6. Clear prior Wayfinder turns or reopen the repository before recording.

## Primary script

### 0:00 to 0:20, the problem

Say: "An unfamiliar repository gives you thousands of files, but not a path through them. Wayfinder is a guide that lives beside GitHub and takes you from a question to verified code evidence."

Open the Wayfinder panel on `openai/openai-node`. Point out the repository summary, TypeScript stack, commit identity, and ordered reading route.

### 0:20 to 0:45, orientation becomes navigation

Open `README.md`, then open `src/index.ts` from the reading route.

Say: "These are not generated file names. Each landmark is mapped from the current commit and opens directly in GitHub. Wayfinder keeps following the repository as I navigate."

### 0:45 to 1:25, trustworthy installation help

Ask: `How do I install and run this?`

Show:

- `npm install openai` from `README.md` line 14
- `pnpm test` from `CONTRIBUTING.md` line 77
- documented and inferred confidence labels

Say: "Setup advice is where a confident guess can waste the most time. Wayfinder only shows a command when it can name the source, line, and confidence."

### 1:25 to 2:05, find the implementation

Ask: `Where is pagination implemented?`

Open the strongest result, `src/core/pagination.ts`.

Say: "Wayfinder first ranks the repository structure, then inspects only the strongest candidates for content and symbols. It detects that `src/pagination.ts` is a deprecated forwarding file and takes me to the core implementation instead."

### 2:05 to 2:35, GPT-5.6 with a guardrail

If model mode is configured, point out the `GPT-5.6 synthesis` badge, natural explanation, and verified evidence links.

Say: "GPT-5.6 does the part language models are good at: understanding the question and explaining the result. It cannot invent a path. The Worker checks every model citation against deterministic tool output, and any failure falls back automatically."

If credits are not available, show the `Deterministic route` badge instead.

Say: "The same workflow remains useful without model credits. The GPT-5.6 path is implemented and tested, and activates by adding the Worker secret."

### 2:35 to 2:50, close

Say: "Wayfinder turns repository onboarding from wandering through files into an evidence-backed route: what this is, how to run it, where the code lives, and one click to get there."

## Backup path

If GitHub rate limits or loses connectivity:

1. Reopen the same repository and use the visible cached map.
2. Point out the cache timestamp.
3. Run a previously cached question.
4. Explain that cache identity includes the commit SHA.

If the model API is unavailable, continue in deterministic mode. That fallback is a designed product behavior, not a demo failure.

## Screenshot list

Capture at least these four frames at a consistent panel width:

1. Repository orientation and reading route
2. Sourced installation commands with confidence labels
3. Pagination results with `src/core/pagination.ts` first
4. GPT-5.6 synthesis badge and verified evidence, only after the live model check passes
