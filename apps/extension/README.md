# Wayfinder Chrome Extension

This package contains the Wayfinder Manifest V3 extension. It follows the active public GitHub repository and renders the complete agent as an animated helper directly on the page. It runs landmark tours, answers repository questions, and opens cited files at the mapped commit and line range.

## Runtime behavior

- Production builds call `https://wayfinder-api.hopit-robert.workers.dev`.
- Development builds call `http://localhost:8787` by default.
- `WXT_WAYFINDER_API_URL` overrides either default.
- Repository maps and recent answers are cached in `chrome.storage.local`.
- No OpenAI credential is stored in or sent to the extension.
- The character and bubble are one attached dock. Asking questions, changing answers, closing, and reopening keep that dock fixed in place.
- Tour movement is paced and the explanation opens only after the complete dock reaches a landmark.
- `Explain this` answers about the highlighted landmark immediately. Generic starter questions appear only when the user explicitly opens the general question surface.

## Develop locally

From the workspace root, start the Worker first:

```bash
pnpm dev:api
```

Then start WXT in another terminal:

```bash
pnpm dev:extension
```

WXT builds the unpacked extension in `.output/chrome-mv3-dev`. Open a public GitHub repository to see the page helper. The helper can run a visual landmark tour or expand in place for deeper repository questions.

## Test and build

```bash
pnpm --filter @wayfinder/extension typecheck
pnpm --filter @wayfinder/extension test
pnpm --filter @wayfinder/extension build
pnpm --filter @wayfinder/extension zip
```

The production directory is `.output/chrome-mv3`. The distributable archive is `.output/wayfinderextension-0.1.0-chrome.zip`.

## Install the production build manually

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose `apps/extension/.output/chrome-mv3`.
5. Open a public GitHub repository and confirm the Wayfinder helper appears.
6. Select "Show me around" and confirm it moves fluidly to and highlights each page landmark.
7. Select "Ask Wayfinder" and verify the helper stays fixed while repository questions, evidence links, installation commands, and Trail Plans remain inside it.

Chrome cannot load the zip directly as an unpacked extension. Extract it first if you are testing the archive instead of the build directory.

## Permissions

- `storage` keeps repository maps and answers cached locally.
- Host access is limited to GitHub, the local Worker, and the deployed Wayfinder Worker.

See the workspace [privacy statement](../../PRIVACY.md) for the full data flow.
