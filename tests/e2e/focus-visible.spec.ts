import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E coverage for `:focus-visible` modality:
 *  - Pressing Tab MUST paint the focus ring (outline + halo) on every
 *    standard interactive element.
 *  - Clicking with the mouse MUST NOT paint the ring (modern browsers
 *    treat pointer activation as a non-keyboard modality).
 *
 * We drive a real Chromium with `page.setContent`, injecting the project's
 * `src/styles.css` so the rules under test are exactly what ships.
 */

const STYLES = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

// Each fixture: a unique id + the HTML for the element. Selector is `#${id}`.
const FIXTURES: { id: string; html: string; label: string }[] = [
  { id: "f-button", label: "<button>", html: `<button type="button" id="f-button">Save</button>` },
  { id: "f-link", label: "a[href]", html: `<a href="#x" id="f-link">link</a>` },
  { id: "f-input", label: "<input>", html: `<input type="text" id="f-input" />` },
  { id: "f-select", label: "<select>", html: `<select id="f-select"><option>a</option></select>` },
  { id: "f-textarea", label: "<textarea>", html: `<textarea id="f-textarea"></textarea>` },
  { id: "f-checkbox", label: "input[type=checkbox]", html: `<input type="checkbox" id="f-checkbox" />` },
  { id: "f-role-button", label: "[role=button]", html: `<div role="button" tabindex="0" id="f-role-button">Action</div>` },
  { id: "f-role-tab", label: "[role=tab]", html: `<div role="tab" tabindex="0" id="f-role-tab">Tab</div>` },
  { id: "f-role-menuitem", label: "[role=menuitem]", html: `<div role="menuitem" tabindex="0" id="f-role-menuitem">Item</div>` },
  { id: "f-role-switch", label: "[role=switch]", html: `<div role="switch" tabindex="0" id="f-role-switch">On</div>` },
];

function buildPage(): string {
  // Strip Tailwind-only at-rules jsdom-style — Chromium parses CSS strictly,
  // but `@import "tailwindcss"` etc. would 404. We only need the @layer base
  // blocks (focus + cursor); the rest is irrelevant to this test.
  const base = STYLES
    .split("\n")
    .filter((line) => !/^@import\b|^@source\b|^@custom-variant\b|^@theme\b/.test(line.trim()))
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  /* Minimal token shim so var(--color-ring) resolves to a real colour
     without needing the full Tailwind theme pipeline. */
  :root {
    --color-ring: oklch(0.68 0.21 295);
    --color-foreground: oklch(0.18 0.025 270);
    --color-background: oklch(0.99 0.005 270);
    --color-border: oklch(0.88 0.015 270);
    --radius: 0.625rem;
    --radius-sm: calc(var(--radius) - 4px);
  }
  body { margin: 16px; display: grid; gap: 12px; grid-auto-flow: row; }
  /* Reset so we measure ONLY our rules, not UA defaults. */
  button, input, select, textarea, [role] { all: revert; }
</style>
<style id="project-styles">${base.replace(/<\/style>/g, "<\\/style>")}</style>
</head>
<body>
  <p id="anchor">Anchor</p>
  ${FIXTURES.map((f) => f.html).join("\n")}
</body>
</html>`;
}

async function setup(page: Page) {
  await page.setContent(buildPage(), { waitUntil: "load" });
}

/**
 * Returns true if the element is currently painting the focus ring. We treat
 * EITHER a non-`none` outline OR a non-`none` box-shadow as evidence — our
 * rule paints both, but components may disable one.
 */
async function hasFocusRing(page: Page, selector: string): Promise<boolean> {
  return page.$eval(selector, (el) => {
    const cs = window.getComputedStyle(el as HTMLElement);
    const outlinePainted =
      cs.outlineStyle !== "none" &&
      cs.outlineStyle !== "" &&
      parseFloat(cs.outlineWidth || "0") > 0;
    const shadowPainted =
      cs.boxShadow !== "none" && cs.boxShadow !== "";
    return outlinePainted || shadowPainted;
  });
}

test.describe("focus-visible: keyboard Tab paints the ring", () => {
  for (const f of FIXTURES) {
    test(`Tab → ${f.label} shows focus ring`, async ({ page }) => {
      await setup(page);
      // Start focus on the static anchor, then walk Tab until our element
      // becomes :focus. Cap at FIXTURES.length + 5 to avoid infinite loops.
      await page.evaluate(() => (document.getElementById("anchor") as HTMLElement)?.focus());
      const target = `#${f.id}`;
      const max = FIXTURES.length + 5;
      for (let i = 0; i < max; i++) {
        await page.keyboard.press("Tab");
        const isFocused = await page.$eval(target, (el) => el === document.activeElement);
        if (isFocused) break;
      }
      const isFocused = await page.$eval(target, (el) => el === document.activeElement);
      expect(isFocused, `Tab navigation must reach ${f.label}`).toBe(true);

      // :focus-visible should now apply because the activation modality is
      // keyboard. Assert via real CSSOM, not via the pseudo-class string.
      expect(await hasFocusRing(page, target), `${f.label} must show focus ring after Tab`).toBe(true);
    });
  }
});

test.describe("focus-visible: mouse click suppresses the ring", () => {
  for (const f of FIXTURES) {
    test(`click → ${f.label} hides focus ring`, async ({ page }) => {
      await setup(page);
      const target = `#${f.id}`;
      // Click via real mouse to set the modality to "pointer".
      await page.click(target, { force: true });
      const isFocused = await page.$eval(target, (el) => el === document.activeElement);
      // Some controls (links, divs) don't take focus on mousedown across
      // browsers — that's fine: a non-focused element trivially has no ring.
      // We only enforce "no ring" when the element actually became focused.
      if (!isFocused) return;
      expect(
        await hasFocusRing(page, target),
        `${f.label} must NOT show focus ring after mouse click`,
      ).toBe(false);
    });
  }
});

test("Tab → click → Tab restores ring (modality switching)", async ({ page }) => {
  await setup(page);
  const target = "#f-button";

  // 1. Tab into it → ring shows.
  await page.evaluate(() => (document.getElementById("anchor") as HTMLElement)?.focus());
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.$eval(target, (el) => el === document.activeElement);
    if (focused) break;
  }
  expect(await hasFocusRing(page, target)).toBe(true);

  // 2. Click it → ring hides (modality flips to pointer).
  await page.click(target, { force: true });
  expect(await hasFocusRing(page, target)).toBe(false);

  // 3. Press another Tab away then Shift+Tab back — keyboard again.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const refocused = await page.$eval(target, (el) => el === document.activeElement);
  expect(refocused).toBe(true);
  expect(await hasFocusRing(page, target)).toBe(true);
});