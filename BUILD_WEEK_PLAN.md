# Build Week Plan: Wayfinder Repository Guide

**Product source of truth:** [PRODUCT_PLAN.md](PRODUCT_PLAN.md)  
**Working name:** Wayfinder  
**One-sentence pitch:** A context-aware GitHub guide that shows you where to start, how to run a repository, and where a feature lives.

## 0. Scope Contract

The demo must complete four jobs on a public repository selected by a judge:

1. Orient the user with a summary, stack, and guided reading route.
2. Explain how to install and run the project using sourced repository evidence.
3. Find likely files for a natural-language concept or feature.
4. Open every recommendation directly in GitHub at the mapped commit.

The tour is a tool inside the agent. It is not the product by itself.

Private repositories, code editing, pull requests, teams, a VS Code port, and guaranteed deep semantic reasoning are outside the build-week scope.

## 1. Required Agent Tools

| Tool | Purpose | Status |
|---|---|---|
| `map_repository` | Read metadata, README, language, commit, and filtered tree | Complete |
| `build_tour` | Produce a structured reading route | Complete in free mode |
| `guide_install` | Extract sourced setup and run instructions | Complete in free mode |
| `find_file` | Rank likely files for a concept or feature | Complete in free mode |
| `get_current_context` | Follow the repository, directory, and file open in GitHub | Integrated into file ranking |

The free toolchain is the required baseline. GPT-5.6 now improves explanation quality without replacing these tools or becoming the source of repository facts.

## 2. Architecture

```text
GitHub content script
  detects owner, repo, ref, path, and view
                 |
                 v
React side panel
  orientation, questions, evidence, navigation
                 |
                 v
Cloudflare Worker
  map, tour, installation guide, file finder
                 |
                 v
GitHub REST API
  metadata, trees, README, selected file contents
```

Shared rules:

- Concrete answers must link to repository evidence.
- Commands must include a source path and confidence label.
- File results must include a reason and match signals.
- Cache identity is `owner/repo@commit-sha`.
- Local development must work without model credits or Cloudflare KV.

## 3. Current Build State

### Foundation complete

- pnpm workspace
- WXT and React MV3 extension
- Cloudflare Worker
- Shared TypeScript contracts
- GitHub single-page navigation detection
- Repository, tree, branch, and file parsing
- `GET /health`
- `POST /map`

### Free orientation complete

- `POST /tour`
- Deterministic stack detection
- Structural file ranking
- Primary-language preference
- Large-repository landmark preservation
- Clickable six-stop tour player
- Editorial field-guide design
- Live checks on `openai/openai-node`, `pallets/flask`, `BurntSushi/ripgrep`, and `vercel/next.js`

### Free installation guide complete

- Setup evidence preserved before general tree filtering
- Package-manager and runtime detection
- Documented command extraction with line references
- Manifest-backed inferred commands
- Conflict and missing-documentation warnings
- `POST /guide/install`
- Side-panel prerequisites, commands, confidence labels, and evidence links
- Live checks on TypeScript, Python, and Rust repositories

### Free file finder complete

- `POST /find`
- Natural-language tokenization and common code aliases
- Structural ranking across names, paths, tests, entry points, configuration, and language
- Current-directory proximity from the active GitHub view
- Targeted content and symbol inspection for the five strongest candidates
- Ranked reasons, confidence labels, evidence snippets, and line-aware navigation
- Suggested prompts and a compact finder in the side panel
- Unit coverage for aliases, tests, context, symbols, and vague queries
- Live verification on `openai/openai-node`

### Free agent shell complete

- `POST /agent`
- Deterministic routing across orientation, installation, and file-discovery intents
- One contextual question composer instead of separate tool controls
- Persistent dispatch timeline with typed evidence cards
- Tool-specific loading, error, warning, and retry states
- Suggested starting prompts and answer-specific follow-ups
- Current GitHub file or directory passed into every dispatch
- Unit coverage for nine representative routing questions
- Live narrow-panel verification on `openai/openai-node`

### Context and resilience complete for public free mode

- Repository maps and tours cached for 15 minutes
- Agent answers cached for 30 minutes by commit, query, and current path
- Public GitHub subrequests edge-cached for five minutes, or 24 hours for commit-addressed files
- Stale evidence fallback when a refresh cannot reach GitHub
- Cache timestamps and per-answer refresh controls
- Manual repository refresh and active-tab context sync
- Typed messages for rate limits, private or missing repositories, invalid tokens, and upstream failures
- Live verification across TypeScript, Python, Rust, Go, and a truncated JavaScript monorepo
- Narrow-panel checks for private-repository messaging and repository refresh

## 4. Build Schedule

### Day 2: Installation guide (complete)

#### Morning: evidence collection

- Identify README sections related to installation, setup, development, testing, and contributing.
- Fetch likely setup files such as manifests, environment examples, Makefiles, task files, Dockerfiles, and development-container configuration.
- Detect the package manager from lockfiles and package metadata before lockfiles are removed from the general repository map.
- Detect runtime requirements from fields such as `engines`, toolchain files, and setup documentation.

#### Afternoon: typed guide generation

- Add an `InstallGuide` contract with prerequisites, ordered steps, commands, warnings, sources, line ranges, and confidence.
- Add `POST /guide/install`.
- Extract commands only when they are documented or directly inferable from a manifest.
- Label every result as `documented`, `inferred`, or `conflicting`.
- Add tests for Node.js, Python, Rust, and a repository with incomplete instructions.

#### Evening: panel experience

- Add an installation action to the side panel.
- Render prerequisites, copyable commands, evidence links, and warnings.
- Make every source path open in GitHub.

**Ship gate:** asking "How do I install and run this?" returns a trustworthy, sourced guide on four test repositories without model access.

### Day 3: File finder and agent shell (complete)

#### Morning: structural search (complete)

- Add query tokenization, singularization, and common code aliases.
- Rank filename, path, directory, extension, test relationship, and current-directory proximity.
- Prefer the repository's primary language when several candidates are otherwise equal.
- Return the top five candidates with reasons, signals, and confidence.

#### Afternoon: targeted content search (complete)

- Fetch snippets only for the strongest candidates.
- Index import, export, class, function, and command names.
- Re-rank candidates using exact symbol and content matches.
- Add `POST /find` with a typed response.

#### Evening: conversational shell (complete)

- Add a compact question composer.
- Route orientation, installation, and file-finding questions deterministically.
- Render tool results in a shared answer timeline.
- Add suggested prompts instead of presenting an empty chat box.

**Ship gate:** queries for entry points, tests, configuration, authentication, routing, and a project-specific feature return useful ranked files with one-click navigation.

### Day 4: Context, resilience, and dry run

#### Morning: contextual behavior (complete)

- Feed the currently open directory and file into the intent router and file finder.
- Update answers as GitHub changes routes without reloading the page.
- Add a manual context refresh control.
- Keep the selected answer visible while navigating to its evidence.

#### Afternoon: resilience (complete for public free mode)

- Add friendly GitHub rate-limit handling.
- Add a clear private-repository message.
- Add retry and offline states.
- Cache recent maps, tours, installation guides, and searches in `chrome.storage`.
- Ensure truncated repositories retain root landmarks.
- Verify all actions with no GitHub token and with an optional token.

#### Evening: full demo dry run (in progress)

- Run the complete API story against the deployed Worker. Complete on `openai/openai-node`.
- Run the complete three-minute story on a clean browser profile. Manual gate remains.
- Ask a second person to choose a public repository.
- Fix only failures that block orientation, installation, search, or navigation.

**Ship gate:** another person can open a repository, ask supported questions, and reach useful evidence without instructions from the builder.

### Day 5: Demo and submission

#### Morning

- Run final checks and build the extension package. Complete.
- Prepare a short backup recording.
- Capture screenshots and a concise architecture diagram.
- Finish the Devpost project story using real implementation details. Draft complete.
- Document free mode and the optional GPT-5.6 enhancement honestly. Complete.

#### Demo script

1. Open a large unfamiliar repository and show automatic orientation. (25 seconds)
2. Follow two tour stops to demonstrate navigation. (30 seconds)
3. Ask, "How do I install and run this?" and show sourced commands. (45 seconds)
4. Ask, "Where is routing handled?" and show ranked file evidence. (45 seconds)
5. Open the best match and show that Wayfinder follows the current file. (25 seconds)
6. Show the evidence badge and explain that GPT-5.6 can synthesize only verified tool output, while free mode remains the automatic fallback. (20 seconds)

**Ship gate:** the live demo proves orientation, installation guidance, file discovery, and contextual navigation.

## 5. Free Mode Strategy

Free mode uses no OpenAI credits.

It relies on:

- GitHub metadata and repository trees
- README and selected file contents
- Deterministic intent routing
- File-role and path scoring
- Package and runtime conventions
- Keyword, alias, and symbol matching
- Evidence-backed response templates

Free mode must not pretend to deeply understand arbitrary implementation logic. It should return ranked evidence and honest inference.

## 6. Optional Model Upgrade

**Implementation status:** Complete. Live credit-backed smoke test pending.

GPT-5.6 is integrated as a synthesis layer through the Responses API. The Worker uses strict structured output, disables response storage, validates every returned path against the deterministic tool result, and falls back without interrupting the user.

The current model path can:

- Produce more natural summaries
- Explain what the selected evidence means
- Reference the currently open repository question

Future expansion may let GPT-5.6 interpret ambiguous questions, select more than one agent tool, and explain relationships across several evidence files.

The model may not invent paths, commands, or line ranges. All concrete repository claims must come from tool output.

## 7. Verification Matrix

**Status:** Complete against the deployed Worker. See [docs/VERIFICATION_MATRIX.md](docs/VERIFICATION_MATRIX.md).

Use at least these repository shapes:

| Shape | Example | What it proves |
|---|---|---|
| TypeScript SDK | `openai/openai-node` | Package scripts, source entry point, and tests |
| Python framework | `pallets/flask` | Python setup conventions and package layout |
| Rust CLI | `BurntSushi/ripgrep` | Cargo setup, command entry point, and regression tests |
| Large monorepo | `vercel/next.js` | Truncation handling and package-specific ranking |
| Small repository | Choose during testing | Sparse documentation and fallback behavior |

For every repository, verify:

- Orientation appears
- Tour paths exist
- Installation commands have sources
- File queries return reasons
- Evidence links open correctly
- The panel updates during GitHub navigation

## 8. Risk Register

| Risk | Mitigation | Cut line |
|---|---|---|
| Free search returns a plausible but wrong file | Show multiple ranked results, signals, and confidence | Do not generate a single confident answer |
| Installation steps are missing or contradictory | Show warnings and distinguish documented from inferred | Never fill gaps with invented commands |
| Large repositories distort the map | Preserve root landmarks and prioritized architectural files | Search only the compacted evidence set |
| GitHub rate limits interrupt the demo | Optional token, commit-based cache, seeded demo repos | Use a cached repository for the live fallback |
| Chat implies unsupported intelligence | Suggested supported actions and honest labels | Remove open-ended prompts before removing evidence quality |
| Time runs short | Protect the four scope jobs in order | Cut current-file explanation and model integration first |

## 9. Definition of Done

Build week is complete when:

- The extension works on public GitHub repositories.
- Orientation, installation guidance, and file discovery work without model credits.
- Every concrete command and file recommendation includes evidence.
- Clicking evidence opens the correct GitHub file.
- Navigation context updates without a full page reload.
- Tests, typechecking, and production builds pass.
- Failure states are understandable and recoverable.
- The three-minute demo works on a repository selected by someone else.

If a feature does not strengthen one of these conditions, it waits until after the demo.
