# E2E tests

End-to-end specs that need a real browser (Chromium via Playwright). They
verify behaviour the unit/jsdom layer can't — most importantly the
`:focus-visible` modality heuristic (keyboard Tab paints a focus ring,
mouse click does not).

## Run locally

```bash
# 1. one-time: install Chromium + system deps
bunx playwright install chromium --with-deps

# 2. run the suite
bun run test:e2e
```

The specs use `page.setContent()` with `src/styles.css` inlined, so they
do **not** require the dev server to be running.

## Files

- `focus-visible.spec.ts` — 21 cases: Tab focuses every standard
  interactive surface and paints the ring; click focuses without painting;
  modality switching restores the ring after a re-Tab.

## Why not run from Vitest?

Vitest is configured (in `vitest.config.ts`) to ignore `tests/e2e/**` so
the Playwright specs aren't picked up by the unit-test runner.