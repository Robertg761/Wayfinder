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
| `find_file` | Rank likely files for a concept or feature | Planned |
| `get_current_context` | Follow the repository, directory, and file open in GitHub | Detection complete, agent integration planned |

The free toolchain is the required baseline. A model can later improve routing and explanation quality without replacing these tools.

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

## 4. Remaining Build Schedule

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

### Day 3: File finder and agent shell

#### Morning: structural search

- Add query tokenization, singularization, and common code aliases.
- Rank filename, path, directory, extension, test relationship, and current-directory proximity.
- Prefer the repository's primary language when several candidates are otherwise equal.
- Return the top five candidates with reasons, signals, and confidence.

#### Afternoon: targeted content search

- Fetch snippets only for the strongest candidates.
- Index import, export, class, function, and command names.
- Re-rank candidates using exact symbol and content matches.
- Add `POST /find` with a typed response.

#### Evening: conversational shell

- Add a compact question composer.
- Route orientation, installation, and file-finding questions deterministically.
- Render tool results in a shared answer timeline.
- Add suggested prompts instead of presenting an empty chat box.

**Ship gate:** queries for entry points, tests, configuration, authentication, routing, and a project-specific feature return useful ranked files with one-click navigation.

### Day 4: Context, resilience, and dry run

#### Morning: contextual behavior

- Feed the currently open directory and file into the intent router and file finder.
- Update answers as GitHub changes routes without reloading the page.
- Add a manual context refresh control.
- Keep the selected answer visible while navigating to its evidence.

#### Afternoon: resilience

- Add friendly GitHub rate-limit handling.
- Add a clear private-repository message.
- Add retry and offline states.
- Cache recent maps, tours, installation guides, and searches in `chrome.storage`.
- Ensure truncated repositories retain root landmarks.
- Verify all actions with no GitHub token and with an optional token.

#### Evening: full demo dry run

- Run the complete three-minute story on a clean browser profile.
- Ask a second person to choose a public repository.
- Fix only failures that block orientation, installation, search, or navigation.

**Ship gate:** another person can open a repository, ask supported questions, and reach useful evidence without instructions from the builder.

### Day 5: Demo and submission

#### Morning

- Run final checks and build the extension package.
- Prepare a short backup recording.
- Capture screenshots and a concise architecture diagram.
- Finish the Devpost project story using real implementation details.
- Document free mode and the optional future model enhancement honestly.

#### Demo script

1. Open a large unfamiliar repository and show automatic orientation. (25 seconds)
2. Follow two tour stops to demonstrate navigation. (30 seconds)
3. Ask, "How do I install and run this?" and show sourced commands. (45 seconds)
4. Ask, "Where is routing handled?" and show ranked file evidence. (45 seconds)
5. Open the best match and show that Wayfinder follows the current file. (25 seconds)
6. Explain that the workflow runs in free mode and can later gain deeper reasoning through the same tools. (20 seconds)

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

When credits arrive, add the model as an orchestration and synthesis layer.

The model may:

- Interpret ambiguous questions
- Select agent tools
- Explain relationships across several evidence files
- Answer questions about the currently open file
- Produce more natural summaries

The model may not invent paths, commands, or line ranges. All concrete repository claims must come from tool output.

## 7. Verification Matrix

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
