// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A11y / interaction smoke tests for the global cursor rules in
 * `src/styles.css`. We load the real stylesheet, inject it into a jsdom
 * document, then assert `getComputedStyle(el).cursor` for a matrix of
 * fixtures — covering buttons, ARIA roles, links, form controls and
 * intentionally-excluded decorative nodes.
 */

type Case = {
  name: string;
  html: string;
  expected: "pointer" | "not-allowed" | "auto" | "";
  /** Optional CSS selector to pick a child element instead of the root. */
  target?: string;
  /** When true, also assert `pointer-events: none` on the element. */
  blocked?: boolean;
};

const CASES: Case[] = [
  // Truly interactive — should get pointer
  { name: "button[type=button]", html: `<button type="button">x</button>`, expected: "pointer" },
  { name: "button[type=submit]", html: `<button type="submit">x</button>`, expected: "pointer" },
  { name: "a[href]", html: `<a href="/x">x</a>`, expected: "pointer" },
  { name: "[role=button]", html: `<div role="button">x</div>`, expected: "pointer" },
  { name: "[role=tab]", html: `<div role="tab">x</div>`, expected: "pointer" },
  { name: "[role=menuitem]", html: `<div role="menuitem">x</div>`, expected: "pointer" },
  { name: "[role=option]", html: `<div role="option">x</div>`, expected: "pointer" },
  { name: "[role=switch]", html: `<div role="switch">x</div>`, expected: "pointer" },
  { name: "[role=link]", html: `<span role="link">x</span>`, expected: "pointer" },
  { name: "input[type=checkbox]", html: `<input type="checkbox" />`, expected: "pointer" },
  { name: "input[type=radio]", html: `<input type="radio" />`, expected: "pointer" },
  { name: "input[type=submit]", html: `<input type="submit" />`, expected: "pointer" },
  { name: "select", html: `<select><option>a</option></select>`, expected: "pointer" },
  { name: "summary", html: `<details open><summary>x</summary></details>`, expected: "pointer", target: "summary" },
  { name: "label[for]", html: `<label for="x">x</label>`, expected: "pointer" },
  { name: "[tabindex=0]", html: `<div tabindex="0">x</div>`, expected: "pointer" },

  // Disabled / aria-disabled — should get not-allowed
  { name: "button:disabled", html: `<button type="button" disabled>x</button>`, expected: "not-allowed" },
  { name: "input:disabled", html: `<input type="text" disabled />`, expected: "not-allowed" },
  { name: "[role=button][aria-disabled=true]", html: `<div role="button" aria-disabled="true">x</div>`, expected: "not-allowed", blocked: true },
  { name: "a[aria-disabled=true]", html: `<a href="/x" aria-disabled="true">x</a>`, expected: "not-allowed", blocked: true },

  // Loading state — same not-allowed treatment, plus pointer-events: none
  { name: "button[aria-busy=true]", html: `<button type="button" aria-busy="true">x</button>`, expected: "not-allowed", blocked: true },
  { name: "button[data-loading=true]", html: `<button type="button" data-loading="true">x</button>`, expected: "not-allowed", blocked: true },
  { name: "button[data-state=loading]", html: `<button type="button" data-state="loading">x</button>`, expected: "not-allowed", blocked: true },
  { name: "button[data-pending]", html: `<button type="button" data-pending>x</button>`, expected: "not-allowed", blocked: true },
  { name: "[role=button][aria-busy=true]", html: `<div role="button" aria-busy="true">x</div>`, expected: "not-allowed", blocked: true },
  { name: "a[href][data-loading=true]", html: `<a href="/x" data-loading="true">x</a>`, expected: "not-allowed", blocked: true },

  // Decorative / layout — should NOT receive pointer
  { name: "plain div", html: `<div>x</div>`, expected: "auto" },
  { name: "div[role=presentation]", html: `<div role="presentation">x</div>`, expected: "auto" },
  { name: "label without for", html: `<label>x</label>`, expected: "auto" },
  { name: "a without href", html: `<a>x</a>`, expected: "auto" },
  { name: "[tabindex=-1]", html: `<div tabindex="-1">x</div>`, expected: "auto" },
  { name: "input[type=text]", html: `<input type="text" />`, expected: "auto" },
  { name: "textarea", html: `<textarea></textarea>`, expected: "auto" },
];

function extractCursorLayer(css: string): string {
  // Pull out every `@layer base { ... }` block and concatenate. The regex is
  // brace-aware via a simple manual scan to handle nested selectors with `{}`.
  const blocks: string[] = [];
  const marker = "@layer base";
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf(marker, i);
    if (idx === -1) break;
    const open = css.indexOf("{", idx);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    blocks.push(css.slice(open + 1, j - 1));
    i = j;
  }
  return blocks.join("\n");
}

describe("global cursor rules in src/styles.css", () => {
  beforeAll(() => {
    const cssPath = resolve(process.cwd(), "src/styles.css");
    const raw = readFileSync(cssPath, "utf8");
    const baseLayer = extractCursorLayer(raw);
    expect(baseLayer, "src/styles.css must contain @layer base blocks").not.toEqual("");
    expect(baseLayer).toMatch(/cursor:\s*pointer/);
    expect(baseLayer).toMatch(/cursor:\s*not-allowed/);

    const style = document.createElement("style");
    // Strip any tailwind-only at-rules jsdom can't parse; keep plain CSS rules.
    style.textContent = baseLayer
      .replace(/@apply[^;]+;/g, "")
      .replace(/var\(--color-border\)/g, "transparent");
    document.head.appendChild(style);
  });

  for (const c of CASES) {
    it(`${c.name} → cursor: ${c.expected}`, () => {
      const host = document.createElement("div");
      host.innerHTML = c.html;
      document.body.appendChild(host);
      const el = (
        c.target ? host.querySelector(c.target) : host.firstElementChild
      ) as HTMLElement | null;
      expect(el, `fixture must render an element for ${c.name}`).toBeTruthy();
      const cursor = window.getComputedStyle(el!).cursor || "auto";
      // jsdom returns "" for unset; normalise to "auto".
      const normalised = cursor === "" ? "auto" : cursor;
      expect(normalised).toBe(c.expected);
      if (c.blocked) {
        expect(window.getComputedStyle(el!).pointerEvents).toBe("none");
      }
      host.remove();
    });
  }
});