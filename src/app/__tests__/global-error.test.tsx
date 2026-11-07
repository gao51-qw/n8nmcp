// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock("@sentry/nextjs", () => sentry);

import GlobalError from "../global-error";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const error = Object.assign(new Error("boom"), { digest: "d1" });

describe("global error page", () => {
  it("recovers without JavaScript: plain links reload the page or go home", () => {
    // The prerendered HTML is all a visitor gets when the CSP blocks scripts.
    const html = renderToStaticMarkup(<GlobalError error={error} reset={vi.fn()} />);
    const page = new DOMParser().parseFromString(html, "text/html");

    expect(page.documentElement.lang).toBe("en");
    expect(page.querySelector("main h1")?.textContent).toBe("Something went wrong");
    expect(page.querySelector("button")).toBeNull();
    const links = [...page.querySelectorAll("main a")].map((link) => ({
      text: link.textContent,
      href: link.getAttribute("href"),
    }));
    expect(links).toEqual([
      { text: "Try again", href: "" },
      { text: "go to the home page", href: "/" },
    ]);
    expect(html).not.toMatch(/<script/i);
  });

  describe("with JavaScript", () => {
    let root: Root | null = null;
    let prevented: boolean[] = [];
    // Runs after React's listener on the document: records whether the page
    // cancelled the click, then stops jsdom from attempting the navigation.
    const recordDefault = (event: Event) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };

    beforeEach(() => {
      sentry.captureException.mockClear();
      prevented = [];
      window.addEventListener("click", recordDefault);
    });

    afterEach(() => {
      window.removeEventListener("click", recordDefault);
      act(() => root?.unmount());
      root = null;
    });

    // Hydrates the server HTML the way the browser does when scripts may run.
    function hydrate(reset: () => void) {
      const element = <GlobalError error={error} reset={reset} />;
      const server = new DOMParser().parseFromString(renderToString(element), "text/html");
      document.documentElement.innerHTML = server.documentElement.innerHTML;
      document.documentElement.lang = server.documentElement.lang;
      act(() => {
        root = hydrateRoot(document, element);
      });
      return [...document.querySelectorAll("a")].find((link) => link.textContent === "Try again")!;
    }

    function click(link: HTMLAnchorElement, init: MouseEventInit = {}) {
      act(() => {
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
        );
      });
    }

    it("reports the error to Sentry and tries reset() instead of reloading", () => {
      const reset = vi.fn();
      click(hydrate(reset));

      expect(sentry.captureException).toHaveBeenCalledWith(error);
      expect(reset).toHaveBeenCalledTimes(1);
      expect(prevented).toEqual([true]);
    });

    it("falls back to the reload when reset() throws", () => {
      const reset = vi.fn(() => {
        throw new Error("still broken");
      });
      click(hydrate(reset));

      expect(reset).toHaveBeenCalledTimes(1);
      expect(prevented).toEqual([false]);
    });

    it("leaves modified clicks to the browser", () => {
      const reset = vi.fn();
      click(hydrate(reset), { ctrlKey: true });

      expect(reset).not.toHaveBeenCalled();
      expect(prevented).toEqual([false]);
    });
  });
});
