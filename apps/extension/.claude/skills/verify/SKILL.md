---
description: Build and drive the Wayfinder Chrome extension through deterministic and live GitHub UI flows.
---

# Verify the Wayfinder extension

1. Build the production extension from the repository root:

   ```bash
   pnpm --filter @wayfinder/extension build
   ```

2. Run the deterministic runtime driver, which launches Chromium with the unpacked MV3 extension and captures light, dark, narrow, failure, navigation-race, clipboard, and shortcut behavior:

   ```bash
   node apps/extension/.claude/skills/verify/runtime.mjs
   ```

   Evidence is written to the operating system's temporary
   `wayfinder-runtime-verify/` directory.

3. Smoke-test the same build on a live public GitHub repository:

   ```bash
   node apps/extension/.claude/skills/verify/live-smoke.mjs
   ```

   Inspect `/private/tmp/wayfinder-live-smoke.png`; API availability errors are environmental if the helper itself mounts and renders.

4. For regression coverage after runtime observation:

   ```bash
   pnpm test:browser
   ```

Important flows: compact-to-agent panel expansion, viewport resize, Guided movement cancellation/fallback, SPA repository and file navigation, saved depth, semantic evidence links, clipboard denial/retry, hidden-route shortcut behavior, dark mode, and reduced motion.
