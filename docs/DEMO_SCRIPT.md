# Wayfinder Demo Script

Target length: 1 minute 58 seconds.

Demo repositories:

- `Robertg761/HA-Desktop-Widget` for Guided, Quick, and consumer installation
- `openai/openai-node` for the contribution Trail Plan

## Before recording

1. Install `apps/extension/.output/wayfinderextension-0.1.0-chrome.zip` in a clean Chrome profile.
2. Confirm `https://wayfinder-api.hopit-robert.workers.dev/health` returns `ok: true`.
3. Keep the browser at a normal laptop width so the helper and highlighted GitHub landmarks remain readable.
4. Clear prior Wayfinder turns or use a fresh browser profile.
5. Keep the GitHub page unobstructed. Do not add persistent chapter labels over the product UI.

## Primary script

### 0:00 to 0:05, disclosure and title

Show the Wayfinder title card.

Say: "This demonstration uses an AI-generated narration voice from OpenAI."

### 0:05 to 0:18, the promise

Open the Home Assistant Desktop Widget repository and reveal the Wayfinder helper.

Say: "GitHub repositories can contain everything you need and still leave you wondering where to begin. Wayfinder gives every project a friendly front door: understand it, install it, and find a confident path to your first contribution."

### 0:18 to 0:28, Guided mode

Begin the project tour and let Wayfinder point to the repository name and its real GitHub landmark.

Say: "Guided mode meets you on the page. It moves to real GitHub landmarks and explains why each one matters, turning an intimidating wall of files into a tour you can follow."

### 0:28 to 0:37, Quick mode

Show the compact project overview and reading route.

Say: "Need the highlights? Quick mode shows what the project does, how it is organized, where it starts, and the commands its maintainers provide."

### 0:37 to 1:01, install the finished app

Ask: `How do I install it?`

Show Wayfinder recognize a published desktop app, open GitHub Releases, detect macOS, and highlight `HA-Desktop-Widget-3.7.4-universal.dmg` instead of a source archive.

Say: "Here is one of my favorite features. Ask, ‘How do I install it?’ Wayfinder recognizes that Home Assistant Desktop Widget is a finished app. It takes me to Releases, detects macOS, and points directly at the universal installer. No digging through asset names. No accidental source archive. Just the right download, exactly where it lives."

### 1:01 to 1:25, plan a contribution

Open `openai/openai-node` and ask: `I want to change speech generation. Plan my first contribution.`

Show the ordered plan, implementation coordinate, and paired test.

Say: "Wayfinder is just as useful when you want to contribute. On OpenAI’s Node SDK, I ask, ‘I want to change speech generation. Plan my first contribution.’ Wayfinder turns that goal into a Trail Plan: get the project running, open the relevant implementation, and follow the test that proves the change works."

### 1:25 to 1:36, useful AI with visible evidence

Keep the GPT-5.6 synthesis label and repository-backed links visible.

Say: "GPT-5.6 makes the plan clear and approachable, while every file and command remains tied to real repository evidence. The AI guides you; the project remains the source of truth."

### 1:36 to 1:48, Codex execution proof

Show the Codex execution-partner card.

Say: "Codex was my execution partner throughout the build. It audited the experience, fixed navigation and reliability problems, expanded the tests, deployed the service, and helped prove Wayfinder across very different public repositories."

### 1:48 to 1:57, close

Show the closing card and leave a short silent beat after the narration.

Say: "Wayfinder turns ‘I found a promising project’ into ‘I know what to do next.’ Learn it. Install it. Contribute with confidence."

## Backup path

If GitHub rate limits or loses connectivity:

1. Reopen the same repository and use the visible cached map.
2. Point out the cache timestamp.
3. Run a previously cached question.
4. Explain that cache identity includes the commit SHA.

If the model API is unavailable, continue in deterministic mode. That fallback is a designed product behavior, not a demo failure.

## Screenshot list

Capture these frames at a consistent panel width:

1. Guided mode pointing at the repository name
2. Quick mode showing the project overview
3. Install guidance highlighting the universal macOS `.dmg` on GitHub Releases
4. GPT-5.6 Trail Plan with the speech implementation and paired test
5. Final `Learn it · Install it · Contribute` card
