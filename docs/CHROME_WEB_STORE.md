# Chrome Web Store — unlisted beta listing

Everything needed to publish Wayfinder as an **unlisted** Chrome Web Store
extension. Copy each block into the matching Developer Dashboard field.

## One-time prerequisites (account owner)

1. Sign in at <https://chrome.google.com/webstore/devconsole> with the Google
   account that should own the listing.
2. Pay the one-time $5 developer registration fee and complete email
   verification.

## Upload

- Package: run `pnpm --filter @wayfinder/extension zip` from the repository
  root and upload `apps/extension/.output/wayfinderextension-<version>-chrome.zip`.
- Each store upload must carry a higher version than the last; bump
  `version` in `apps/extension/package.json` (the manifest inherits it).

## Store listing tab

- **Name**: Wayfinder
- **Summary** (132 chars max):

  > An evidence-first guide for public GitHub repositories: tours, setup
  > steps, and answers pinned to exact files and commits.

- **Category**: Developer Tools
- **Language**: English
- **Detailed description**:

  > Wayfinder is a floating guide that helps you understand an unfamiliar
  > public GitHub repository without leaving the page.
  >
  > Ask where to start, how to install the project, or where a feature
  > lives. Every answer is backed by pinned evidence: exact repository
  > paths, line ranges, and the commit they were read from, so you can
  > verify everything yourself with one click.
  >
  > • Guided pace teaches the repository landmark by landmark; Quick pace
  >   opens a compact project map and gets out of the way.
  > • Installation answers distinguish "use this project" from "work on
  >   this project", extract documented setup commands with their sources,
  >   and can walk you to the right packaged download in GitHub Releases
  >   for your OS and architecture.
  > • The file finder ranks likely implementation and test locations with
  >   confidence labels and honest warnings when evidence is weak.
  > • Deterministic tools do all the fact-finding. Optional AI synthesis
  >   (server-side) can explain the evidence for contribution plans, and
  >   any path or command it produces is validated against the
  >   deterministic evidence before you see it.
  >
  > Wayfinder reads only the public GitHub pages you visit and talks only
  > to its own API. No account, no tracking, no ads.

- **Screenshots** (1280×800, in `docs/assets/store/`):
  1. `01-choose-your-pace.png` — first-run pace choice
  2. `02-overview-answer.png` — pinned-evidence repository snapshot
  3. `03-install-guide.png` — guided Releases installation journey
  4. `04-dark-mode.png` — dark mode
- **Icon**: `apps/extension/public/icon/128.png` (uploaded automatically as
  part of the package; the dashboard also asks for a 128×128 store icon —
  use the same file).

## Privacy tab

- **Single purpose description**:

  > Wayfinder explains the public GitHub repository the user is viewing:
  > it builds a repository map and answers the user's questions about
  > orientation, installation, and file locations, with evidence links
  > back to exact files and commits.

- **Permission justifications**:
  - `storage` — caches recently built repository maps and answers locally
    so revisiting a repository does not re-fetch it, and remembers the
    user's chosen pace (Guided/Quick). No data leaves the browser through
    this permission.
  - Host permission `https://github.com/*` — the content script runs only
    on GitHub to read the visible repository identity (owner, name,
    branch, file path) and to highlight on-page landmarks during guided
    tours.
  - Host permission `https://wayfinder-api.hopit-robert.workers.dev/*` —
    the extension's own backend. It receives the repository identity and
    the user's question, reads the public repository through the GitHub
    API, and returns the evidence-backed answer.
- **Remote code**: No, all code ships in the package. (The backend returns
  data, never executable code.)
- **Data usage disclosures** — check exactly:
  - ☑ **Website content** — the public repository identity and page
    context of the GitHub page the user is viewing, sent to the
    Wayfinder API to build the answer.
  - ☑ **User activity** is NOT collected; do not check. Questions the
    user types are sent to the API to be answered — if the reviewer asks,
    classify typed questions under "Website content"/app functionality;
    they are processed transiently and not stored server-side (see
    PRIVACY.md).
  - Everything else: not collected.
- **Certifications**: check all three (no sale of data, no unrelated use,
  no creditworthiness use).
- **Privacy policy URL**:
  `https://github.com/Robertg761/Wayfinder/blob/main/PRIVACY.md`

## Distribution tab

- **Visibility: Unlisted** — anyone with the link can install; the listing
  is not searchable. Flip to Public later without changing the extension
  ID or losing installs.
- Distribution: all regions.

## After the first submission

- Review typically takes one to a few days for narrowly-scoped host
  permissions like these. The dashboard emails the outcome.
- Once published, the install link is
  `https://chrome.google.com/webstore/detail/<extension-id>` — add it to
  README.md and the Devpost page.
- Refresh screenshots with `node scripts/store-screenshots.mjs` (drives
  the built extension against production and writes to
  `docs/assets/store/`).
