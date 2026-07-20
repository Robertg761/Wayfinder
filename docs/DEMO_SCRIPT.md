# Wayfinder Demo Script

Target length: 1 minute 59 seconds.

Demo repository: `openai/openai-node` at the current default-branch commit.

## Before recording

1. Install `apps/extension/.output/wayfinderextension-0.1.0-chrome.zip` in a clean Chrome profile.
2. Open `https://github.com/openai/openai-node`.
3. Confirm `https://wayfinder-api.hopit-robert.workers.dev/health` returns `ok: true`.
4. If credits are available, confirm health reports `modelConfigured: true`, `modelProtected: true`, and `modelEnabled: true`.
5. Keep the browser at a normal laptop width so the helper movement and expanded answers remain readable.
6. Clear prior Wayfinder turns or reopen the repository before recording.
7. Keep the GitHub page unobstructed. Do not add persistent chapter labels over the product UI.

## Primary script

### 0:00 to 0:19, the problem

Show the Wayfinder title card, then open `openai/openai-node`.

Say: "This demonstration uses an AI-generated narration voice from OpenAI.

Opening a new repository is easy. Finding the right first edit is not. Wayfinder lives directly on GitHub and turns ‘I want to contribute’ into a verified trail of files, commands, and tests."

### 0:19 to 0:31, Guided mode

Open the helper, choose Guided mode, and begin the repository tour. Let the helper point to real GitHub landmarks without covering the product with editorial overlays.

Say: "Guided mode teaches the terrain. The helper moves only to point out a real GitHub landmark, explaining both the term and what it means for this project. Its state survives GitHub navigation."

### 0:31 to 0:43, Quick mode

Switch to Quick mode and show the repository snapshot with its pinned ref, stack, entry point, and sourced commands.

Say: "Quick mode is the fast path. Wayfinder maps the exact viewed ref and commit, identifies the stack, package manager, entry points, and sourced commands. Every link opens pinned evidence, never a guessed file."

### 0:43 to 1:05, the Trail Plan

Ask: `I want to change speech generation. Plan my first contribution.`

Show the repository map, sourced setup commands, implementation coordinate, paired test, and ordered GPT-5.6 field brief.

Say: "Now I ask, ‘I want to change speech generation. Plan my first contribution.’

Wayfinder runs a repository map, setup analysis, implementation search, and verification search. GPT-5.6 Luna turns those typed results into an ordered Trail Plan: establish a clean baseline, open the real speech implementation, and follow its paired test."

### 1:05 to 1:20, the trust boundary

Keep the verified evidence links and synthesis provenance visible.

Say: "The model writes the plan, but the tools own the facts. The Worker validates every citation and action against deterministic repository evidence. Unsupported paths, model failures, and budget limits fall back safely to the deterministic result."

### 1:20 to 1:40, Codex execution proof

Show the Codex execution-partner card.

Say: "Codex was the execution partner behind the build. It audited every Wayfinder task, found real failures in guidance, file relationships, navigation recovery, and budget protection, implemented the fixes, expanded the test suite, deployed the Worker, and verified the public experience across five very different repositories."

### 1:40 to 1:50, evidence check

Ask: `Where is pagination implemented?` Show `src/core/pagination.ts` as the strongest result.

Say: "One last query asks where pagination is implemented. Wayfinder skips the tempting deprecated forwarding file and points to the core implementation instead."

### 1:50 to 1:59, close

Cut directly to the closing card and leave a short silent beat after the narration.

Say: "That is Wayfinder: the missing trail between intention and a confident first pull request, right where the work happens."

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
2. Trail Plan showing Survey, Prepare, Trace, and Prove
3. Speech implementation and test coordinates, plus `src/core/pagination.ts` from the follow-up
4. GPT-5.6 field brief and verified evidence, only after the live model check passes
