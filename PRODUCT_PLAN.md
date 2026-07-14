# Wayfinder Product Plan

**Status:** Active source of truth  
**Updated:** July 13, 2026  
**Product:** Chrome extension for public GitHub repositories

## 1. North Star

Wayfinder is a repository guide that lives beside GitHub. It helps someone understand an unfamiliar codebase, install and run it, locate important files, and move through the repository with confidence.

**One-sentence pitch:** Wayfinder is a context-aware guide for unfamiliar GitHub repositories that can show you where to start, how to run the project, and where a feature lives.

The guided tour is one tool inside Wayfinder. It is not the entire product. The complete experience should feel like a helpful agent with a map, evidence, and the ability to take the user directly to the right place.

## 2. User Problem

Opening an unfamiliar repository creates several immediate questions:

- What does this project do?
- How do I install and run it?
- Which file starts the application?
- Where is a specific feature implemented?
- Which tests describe this behavior?
- What should I read first?
- Does this answer come from the repository or from a guess?

GitHub exposes the files, but it does not provide a guided path through them. General chat tools can answer questions, but they often require the user to supply context manually and may not remain connected to the file currently open in GitHub.

Wayfinder closes that gap inside the repository interface.

## 3. Product Promises

Wayfinder should consistently deliver five things:

1. **Fast orientation:** Explain the repository purpose, stack, and likely entry points.
2. **Practical setup help:** Extract trustworthy installation and run instructions.
3. **File discovery:** Find likely files for a feature, concept, test, command, or configuration area.
4. **Contextual navigation:** Follow the repository, branch, directory, and file currently open in GitHub.
5. **Evidence over confidence:** Link every concrete answer to repository files and clearly label inference.

## 4. MVP Scope Contract

The build-week demo must work on public repositories and support these user journeys:

### 4.1 Orient me

When a user opens a repository, Wayfinder should show:

- A short repository summary
- Detected languages and framework signals
- The current commit identifier
- A five to eight stop reading route
- One-click navigation to each real file

### 4.2 Help me install it

When a user asks how to install or run the project, Wayfinder should show:

- Detected package manager and runtime requirements
- Commands copied from repository evidence when available
- Required environment files or setup steps
- Separate development, test, and build commands
- Source links for every command or instruction
- A warning when the repository does not document a required step

Wayfinder must never invent an installation command and present it as documented fact.

### 4.3 Help me find a file

When a user asks where a feature or concept lives, Wayfinder should show:

- Up to five ranked file candidates
- A short reason for each match
- Match signals such as filename, directory, language, test relationship, or content keyword
- One-click navigation to the selected file
- A confidence label that distinguishes direct evidence from structural inference

### 4.4 Follow my GitHub context

As the user moves through GitHub, Wayfinder should update its understanding of:

- Repository owner and name
- Branch or commit reference
- Directory path
- Current file path
- Whether the user is at the repository root, a directory, or a file

## 5. Explicit Non-Goals for Build Week

The following are outside the initial scope:

- Private repository authentication
- Editing code or opening pull requests
- Team workspaces or shared history
- A VS Code extension
- Full repository cloning
- Guaranteed semantic understanding of arbitrary business logic without a model
- A general-purpose coding assistant
- Long-term conversation memory across repositories

These can be revisited only after the four MVP user journeys are reliable.

## 6. Product Experience

### 6.1 Default side panel

The panel opens with an orientation card and a small question composer. It should suggest concrete actions instead of showing an empty chat box:

- Show me where to start
- How do I install this?
- Find the main entry point
- Where are the tests?

### 6.2 Answer structure

Every answer should follow a common pattern:

1. Direct answer in plain language
2. Recommended next action
3. Evidence cards linking to files
4. Confidence or inference label
5. Optional follow-up actions

### 6.3 Navigation behavior

Clicking an evidence card should open the matching GitHub file at the current commit. When a reliable line range is known, Wayfinder should include the line fragment in the URL.

### 6.4 Tone

Wayfinder should sound like an experienced contributor helping someone on their first day:

- Direct and calm
- Specific about files and commands
- Honest about uncertainty
- Helpful without explaining every obvious detail
- Never pretending an inference came from documentation

## 7. Tool-First Agent Architecture

The agent should be built from explicit repository tools. The user interface and future model layer both consume the same typed outputs.

```text
GitHub page context
        |
        v
Wayfinder side panel
        |
        v
Intent router
        |
        +--> map_repository
        +--> build_tour
        +--> guide_install
        +--> find_file
        +--> get_current_context
        |
        v
Evidence-backed response
        |
        v
Open exact file in GitHub
```

An optional model can later choose tools and improve explanations. It should not replace the tools or become the source of repository facts.

## 8. Core Tools

### 8.1 `map_repository`

**Status:** Implemented as `POST /map`.

Inputs:

- Repository owner
- Repository name

Outputs:

- Repository metadata
- Default branch and commit SHA
- README content
- Filtered file tree
- Language and popularity signals
- Truncation state

Important behavior:

- Remove dependencies, generated output, binaries, and lockfiles from the working map.
- Preserve root landmarks and likely architectural files when a large tree must be compacted.
- Use the commit SHA as the stable identity for downstream results.

### 8.2 `build_tour`

**Status:** Implemented as `POST /tour` with no model dependency.

Inputs:

- Repository map

Outputs:

- Repository summary
- Detected stack
- Likely entry points
- Ordered tour stops
- Explanations and observation prompts

Current free implementation scores documentation, manifests, entry points, runtime modules, tests, and configuration. It prefers shallow files, the repository's primary language, and paths related to the repository name when working with a compacted monorepo.

Future model mode may improve explanations and line ranges, but it must preserve the same `RepoTour` contract.

### 8.3 `guide_install`

**Status:** Implemented in free mode as `POST /guide/install`.

Inputs:

- Repository map
- Relevant setup files fetched on demand

Evidence priority:

1. README installation, setup, development, and contributing sections
2. Dedicated setup documentation
3. Package scripts and runtime declarations
4. Lockfiles for package-manager detection
5. Environment examples such as `.env.example`
6. Makefiles, task files, containers, and development-container configuration
7. Continuous integration commands as supporting evidence only

Proposed output:

```json
{
  "repo": "owner/repo",
  "sha": "abc123",
  "runtime": ["Node.js 20"],
  "packageManager": "pnpm",
  "prerequisites": [
    {
      "text": "Install Node.js 20 or newer",
      "source": "package.json",
      "confidence": "documented"
    }
  ],
  "steps": [
    {
      "order": 1,
      "title": "Install dependencies",
      "command": "pnpm install",
      "source": "README.md",
      "lines": [24, 28],
      "confidence": "documented"
    }
  ],
  "warnings": []
}
```

Rules:

- A command must carry a source path.
- If a command is inferred from a manifest, label it `inferred`.
- If documentation conflicts with the manifest, show the conflict.
- Do not execute installation commands for the user during build week.

### 8.4 `find_file`

**Status:** Complete in free mode.

Inputs:

- Natural-language query
- Repository map
- Current GitHub path
- Candidate-file snippets fetched by the Worker

Free-mode ranking signals:

- Exact filename and directory match
- Normalized keyword match
- Common aliases such as `auth` and `authentication`
- Primary-language match
- Test-to-source naming relationship
- Entry-point and configuration conventions
- Import, export, class, and function names from fetched candidate snippets
- Proximity to the current directory when relevant

Output:

```json
{
  "query": "where is authentication handled",
  "results": [
    {
      "path": "src/auth/session.ts",
      "score": 0.92,
      "reason": "The directory and filename directly match authentication and session handling.",
      "signals": ["path", "filename", "primary-language"],
      "confidence": "strong"
    }
  ]
}
```

The implementation first scores the complete filtered tree, then fetches only the five strongest inspectable files. Files larger than 200 KB are not fetched for content inspection. Exact symbol matches, source snippets, and nearby line ranges can strengthen the result, while current-directory context breaks ties toward the part of the repository the user is already exploring.

The response returns ranked evidence and does not claim deep semantic understanding. A weak query or an all-possible result set includes an explicit warning instead of presenting structural guesses as confirmed implementations.

### 8.5 `get_current_context`

**Status:** Repository and path detection implemented. Agent integration remains.

This tool exposes the GitHub view already detected by the content script. It lets answers prefer the current directory or explain how the open file relates to the repository route.

## 9. Free Mode and Model Mode

### 9.1 Free mode

Free mode is the required baseline and must remain useful on its own.

It uses:

- GitHub repository metadata and trees
- README and selected file contents
- Deterministic intent routing
- Structural scoring
- Installation extraction
- Keyword and symbol matching
- Evidence templates

Free mode should handle orientation, installation, and file discovery. It will not deeply explain arbitrary code behavior.

### 9.2 Model mode

Model mode is an enhancement when credits become available.

It can:

- Interpret ambiguous questions
- Choose between repository tools
- Synthesize evidence into more natural answers
- Explain how several files work together
- Answer questions about the currently open file

The model must receive tool outputs and cite repository evidence. It should not invent paths, commands, or line ranges.

## 10. Data and Caching

Use `owner/repo@commit-sha` as the stable cache identity.

Suggested keys:

- `map:{owner}/{repo}@{sha}`
- `tour:{owner}/{repo}@{sha}`
- `install:{owner}/{repo}@{sha}`
- `file-index:{owner}/{repo}@{sha}`

Cache behavior:

- Results remain valid while the commit SHA is unchanged.
- The extension may keep recent results in `chrome.storage` for fast reopening.
- Server-side KV can be enabled after Cloudflare resources are provisioned.
- Free local development must work without KV.

## 11. Implementation Phases

### Phase 0: Foundation

**Status:** Complete.

- WXT Chrome extension
- React side panel
- Cloudflare Worker
- Shared TypeScript contracts
- GitHub URL context detection
- Repository map endpoint

### Phase 1: Free orientation

**Status:** Complete.

- Deterministic tour engine
- Stack detection
- Large-repository compaction
- Clickable tour player
- Loading, error, and empty states
- Live verification against JavaScript, Python, Rust, and monorepo examples

### Phase 2: Installation guide

**Status:** Complete.

- Fetch relevant setup files
- Extract documented commands and prerequisites
- Detect package manager and environment files
- Return typed evidence and confidence labels
- Add installation answer cards to the side panel

### Phase 3: File finder

**Status:** Complete.

- Add query normalization and alias mapping
- Rank paths using structural signals
- Fetch snippets for the strongest candidates
- Add evidence-backed file results
- Navigate directly to selected results

### Phase 4: Agent conversation shell

**Status:** Complete in free mode.

- Add a compact question composer
- Route install, find, and orientation intents
- Render tool-specific answers in one conversation timeline
- Preserve repository context while navigating
- Add suggested follow-up actions

The free router recognizes orientation, installation, command, architecture, and file-location language. It keeps the last six dispatches visible, carries the active GitHub path into each tool request, and exposes answer-specific follow-up prompts. The timeline is session-local and resets when the user changes repositories.

### Phase 5: Context and resilience

**Status:** Complete for public free mode.

- Use the current directory and file as ranking context
- Add rate-limit and private-repository messages
- Cache recent results locally
- Add manual refresh and retry controls
- Verify behavior across at least five repository shapes

Repository maps and tours are cached for 15 minutes. Agent answers are cached for 30 minutes using the repository commit, normalized question, and current GitHub path. The extension keeps the last usable evidence as a fallback when a refresh fails, labels cached results with their time, and lets the user refresh either the map or a specific answer.

The Worker returns typed GitHub failure codes for public API limits, private or missing repositories, invalid tokens, and upstream failures. The no-token path was verified across TypeScript, Python, Rust, Go, and a truncated JavaScript monorepo. The optional-token path still needs a smoke test with a real token before submission.

### Phase 6: Optional model enhancement

- Connect the model only after credits arrive
- Give the model access to the explicit tools
- Require structured, evidence-backed responses
- Keep free mode available as fallback

## 12. Acceptance Criteria

### Orientation

- A public repository produces a useful orientation without model access.
- Every tour stop points to a real file at the mapped commit.
- A large monorepo retains its root README, manifest, tests, and configuration.

### Installation

- Wayfinder identifies the documented package manager when present.
- Every displayed command has a repository source.
- Inferred instructions are visibly labeled.
- Missing prerequisites produce a warning instead of a guess.

### File discovery

- Common queries such as `entry point`, `tests`, `authentication`, and `configuration` return plausible ranked files.
- Every result includes a reason and match signals.
- Clicking a result opens the correct GitHub file.

### Context

- Navigating between repository root, directory, and file views updates the panel.
- A query can use the current directory as a ranking hint.

### Quality

- Typechecking, tests, and production builds pass.
- The main demo works without OpenAI credits.
- Failure states explain what happened and offer a useful next action.

## 13. Demo Story

The demo should prove that Wayfinder is an agent, not only a generated tour.

1. Open a large unfamiliar repository.
2. Show the automatic orientation and reading route.
3. Ask, "How do I install and run this?"
4. Show sourced commands and prerequisites.
5. Ask, "Where is routing handled?"
6. Open one of the ranked files directly in GitHub.
7. Navigate to another file and show that Wayfinder follows the context.
8. Explain that the entire flow works in free mode, while a model can later add deeper reasoning through the same tools.

## 14. Risks and Guardrails

| Risk | Guardrail |
|---|---|
| Structural heuristics select a plausible but incorrect file | Return ranked candidates, reasons, and confidence instead of claiming certainty |
| Installation documentation is incomplete | Show only sourced commands and clearly list missing information |
| Large repositories bias the map toward early alphabetical paths | Preserve root files and architectural landmarks during compaction |
| GitHub rate limits interrupt free mode | Support an optional GitHub token, cache by commit, and show a clear retry state |
| The chat interface implies more intelligence than free mode provides | Offer supported action prompts and label structural inference honestly |
| Model responses later invent facts | Require tool use and repository evidence for concrete claims |

## 15. Product Principles

When making a product decision, use these rules in order:

1. Take the user to evidence.
2. Solve a concrete repository task.
3. Prefer a useful free result over waiting for a model.
4. Keep model integration replaceable and optional.
5. Admit uncertainty instead of manufacturing confidence.
6. Make the next action obvious.

If a proposed feature does not improve orientation, installation, file discovery, or contextual navigation, it is not part of the build-week MVP.
