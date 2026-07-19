# Build Week Judging Strategy

Snapshot date: 2026-07-14.

Official source: `https://openai.devpost.com/`

## Winning thesis

Wayfinder should be judged as the missing contributor workflow inside GitHub, not as a repository chatbot. Its immediate signature moment is the animated compass helper floating to a real GitHub landmark, outlining it, and explaining why it matters. Its deeper signature moment is Trail Plan: a developer states a contribution goal and receives an ordered, clickable route through repository orientation, sourced setup, the likely implementation, and related verification.

## Criteria mapping

### Technological implementation

- GPT-5.6 reasons across several typed repository-tool outputs instead of merely rewriting one search result.
- Strict JSON Schema produces a direct answer, explanation, evidence citations, and up to four ordered actions.
- Every model path is checked against the deterministic evidence allow-list.
- The deterministic workflow, model allowance, and fallback all work independently.

Proof to show: one live Trail Plan, the GPT-5.6 field brief, a clicked evidence coordinate, and an automatic deterministic fallback.

### Design

- The same helper handles orientation and deep repository questions without switching surfaces.
- The on-page helper turns repository orientation into a visible guided experience before the user ever opens a panel.
- The visual language is an editorial field guide, with Survey, Prepare, Trace, and Prove as a coherent route.
- Commands copy in one click and repository coordinates open at the mapped commit.

Proof to show: the complete journey in one uninterrupted recording, entirely through the floating helper.

### Potential impact

- Audience: developers evaluating, adopting, or contributing to unfamiliar open source repositories.
- Problem: repositories expose files but rarely provide a personalized path from a goal to the right setup, source, and tests.
- Outcome: less time wandering, fewer guessed commands, and a safer first contribution.

Proof to show: use a real repository and a concrete contribution goal, not a prepared toy project.

### Quality of idea

- The non-obvious use of GPT-5.6 is constrained planning over a repository evidence graph.
- Wayfinder exposes uncertainty, provenance, and fallbacks as product features.
- It is distinct from general chat because it follows active GitHub context and turns every recommendation into an immediate navigation action.

Proof to show: explain why the obvious file is not always the correct implementation and let Wayfinder open the stronger coordinate.

## Remaining highest-leverage work

1. Capture the verified credit-backed GPT-5.6 Trail Plan in the expanded answer surface.
2. Record the three-minute primary demo and retain a deterministic backup.
3. Complete the compact and expanded-answer screenshot set alongside the two verified frames already in `docs/assets`.
4. Ask one person unfamiliar with Wayfinder to complete the four core jobs on a public repository.
5. Add the final video and screenshots to Devpost, review every claim against the ship checklist, and submit.

## Cut rule

Do not add a feature unless it makes Trail Plan more credible, more visual, or easier to understand in the first 30 seconds. Reliability fixes remain in scope when they protect the live demo.
