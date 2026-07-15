# Wayfinder Demo Script

Target length: 2 minutes 55 seconds.

Demo repository: `openai/openai-node` at the current default-branch commit.

## Before recording

1. Install `apps/extension/.output/wayfinderextension-0.1.0-chrome.zip` in a clean Chrome profile.
2. Open `https://github.com/openai/openai-node`.
3. Confirm `https://wayfinder-api.hopit-robert.workers.dev/health` returns `ok: true`.
4. If credits are available, confirm health reports `modelConfigured: true`, `modelProtected: true`, and `modelEnabled: true`.
5. Keep the browser at a normal laptop width so the helper movement and expanded answers remain readable.
6. Clear prior Wayfinder turns or reopen the repository before recording.

## Primary script

### 0:00 to 0:20, the problem

Say: "An unfamiliar repository gives you thousands of files, but not a path through them. Wayfinder is a guide that lives right on GitHub and takes you from a question to verified code evidence."

Open `openai/openai-node` and let the floating helper appear. Select "Show me around." Let the attached character and bubble travel to the repository name and one more GitHub landmark while they highlight and explain each target. Then select "Explain this" and show that Wayfinder answers about that exact landmark without moving or opening generic starters. Open the general question surface, ask for a 60-second repository overview, and point out the repository summary, TypeScript stack, commit identity, and ordered reading route.

### 0:20 to 0:45, orientation becomes navigation

Open `README.md`, then open `src/index.ts` from the reading route.

Say: "These are not generated file names. Each landmark is mapped from the current commit and opens directly in GitHub. Wayfinder keeps following the repository as I navigate."

### 0:45 to 1:55, the Trail Plan moment

Ask: `I want to change speech generation. Plan my first contribution.`

Show:

- the repository landmark in Survey
- sourced setup commands in Prepare
- `src/resources/audio/speech.ts` in Trace
- `tests/api-resources/audio/speech.test.ts` in Prove
- the ordered GPT-5.6 field brief when model mode is available

Say: "A new contributor does not need another repository summary. They need a route from intention to a safe first edit. Wayfinder orchestrates its repository tools, then GPT-5.6 turns the evidence into an ordered field brief: establish a baseline, open the real implementation, and follow the verification path."

Open the implementation and verification coordinates.

Say: "Every command and coordinate remains inspectable. I can move from the contribution goal to the source and its proof without leaving GitHub or guessing a path."

Ask: `Where is pagination implemented?` Open `src/core/pagination.ts`.

Say: "The finder also detects that the obvious pagination file is a deprecated forwarding wrapper and leads me to the core implementation instead."

### 1:55 to 2:35, trust boundary

If model mode is configured, point out the `GPT-5.6 synthesis` badge, field brief, and verified evidence links.

Say: "GPT-5.6 is doing the planning, but it does not get to invent the map. The Worker checks every model citation and action coordinate against deterministic tool output. Any invalid path or model failure falls back automatically."

If credits are not available, show the `Deterministic route` badge instead.

Say: "The same workflow remains useful without model credits. The GPT-5.6 path is implemented and tested, and activates by adding the Worker secret."

### 2:35 to 2:55, close

Say: "Wayfinder turns 'I want to contribute' into an evidence-backed route through a repository, right where the work happens. It is not another chat window. It is the missing trail between intention and a confident first pull request."

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
