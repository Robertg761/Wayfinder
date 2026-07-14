# Wayfinder Chrome Extension

This package contains the Wayfinder Manifest V3 extension. It follows the active public GitHub repository, renders the repository guide in a Chrome side panel, and opens cited files at the mapped commit and line range.

## Runtime behavior

- Production builds call `https://wayfinder-api.hopit-robert.workers.dev`.
- Development builds call `http://localhost:8787` by default.
- `WXT_WAYFINDER_API_URL` overrides either default.
- Repository maps and recent answers are cached in `chrome.storage.local`.
- No OpenAI credential is stored in or sent to the extension.

## Develop locally

From the workspace root, start the Worker first:

```bash
pnpm dev:api
```

Then start WXT in another terminal:

```bash
pnpm dev:extension
```

WXT builds the unpacked extension in `.output/chrome-mv3-dev`. Open a public GitHub repository and select Wayfinder from the Chrome toolbar.

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
5. Open a public repository on GitHub.
6. Select the Wayfinder toolbar action to open the side panel.

Chrome cannot load the zip directly as an unpacked extension. Extract it first if you are testing the archive instead of the build directory.

## Permissions

- `sidePanel` opens the guide beside GitHub.
- `storage` caches commit-aware maps and answers locally.
- `tabs` reads the active GitHub URL and opens cited evidence in that tab.
- Host access is limited to GitHub, the local Worker, and the deployed Wayfinder Worker.

See the workspace [privacy statement](../../PRIVACY.md) for the full data flow.
