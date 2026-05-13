/**
 * Page transition performance instrumentation.
 *
 * Captures, per navigation:
 *  - phase timings (onBeforeNavigate -> onBeforeLoad -> onLoad -> onResolved
 *    -> onBeforeRouteMount -> onRendered)
 *  - whether the router entered the "pending" UI window
 *  - layout-shift entries (CLS) attributed to elements that shifted during
 *    the navigation, so you can see WHICH component caused the jitter
 *
 * Enable the on-screen overlay by setting `localStorage["nav-perf"] = "1"`
 * (or appending `?perf=1` to any URL once). Toggle with Ctrl+Shift+P.
 *
 * Pure client module — never import from server code.
 */

import type { Router } from "@tanstack/react-router";

export type NavPhase =
  | "onBeforeNavigate"
  | "onBeforeLoad"
  | "onLoad"
  | "onResolved"
  | "onBeforeRouteMount"
  | "onRendered";

export type ShiftSource = {
  tag: string;
  id?: string;
  className?: string;
  rect: { x: number; y: number; w: number; h: number };
};

export type NavSample = {
  id: number;
  from: string;
  to: string;
  startedAt: number;
  phases: Partial<Record<NavPhase, number>>; // ms relative to startedAt
  totalMs?: number;
  pendingShown: boolean;
  cls: number;
  shifts: Array<{
    value: number;
    at: number; // ms relative to startedAt
    sources: ShiftSource[];
  }>;
};

type Listener = (samples: NavSample[]) => void;

const MAX_SAMPLES = 25;
let samples: NavSample[] = [];
const listeners = new Set<Listener>();
let attached = false;
let current: NavSample | null = null;
let nextId = 1;
let clsObserver: PerformanceObserver | null = null;

function emit() {
  for (const l of listeners) l(samples);
}

function pushSample(s: NavSample) {
  samples = [s, ...samples].slice(0, MAX_SAMPLES);
  emit();
}

function describeNode(node: Node | null): ShiftSource | null {
  if (!node || !(node instanceof Element)) return null;
  const r = node.getBoundingClientRect();
  return {
    tag: node.tagName.toLowerCase(),
    id: node.id || undefined,
    className:
      typeof node.className === "string" && node.className
        ? node.className.slice(0, 120)
        : undefined,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
}

function startCLSObserver() {
  if (clsObserver || typeof PerformanceObserver === "undefined") return;
  try {
    clsObserver = new PerformanceObserver((list) => {
      if (!current) return;
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        // layout-shift entries
        const ls = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: Array<{ node: Node | null }>;
        };
        if (ls.hadRecentInput) continue;
        const at = performance.now() - current.startedAt;
        // Only attribute shifts that occur during the live transition window
        // (from start to ~1s after onRendered). Drop late shifts.
        if (at < 0 || at > 4000) continue;
        const sources: ShiftSource[] = [];
        for (const s of ls.sources ?? []) {
          const d = describeNode(s.node);
          if (d) sources.push(d);
        }
        current.cls += ls.value;
        current.shifts.push({ value: ls.value, at: Math.round(at), sources });
      }
      emit();
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    // layout-shift not supported in this browser
  }
}

/**
 * Wire perf instrumentation to a router instance. Idempotent.
 */
export function attachNavPerf(router: Router<any, any, any, any>) {
  if (attached || typeof window === "undefined") return;
  attached = true;

  startCLSObserver();

  const record = (phase: NavPhase) => {
    if (!current) return;
    current.phases[phase] = Math.round(performance.now() - current.startedAt);
  };

  router.subscribe("onBeforeNavigate", (e) => {
    const startedAt = performance.now();
    current = {
      id: nextId++,
      from: e.fromLocation?.pathname ?? "(initial)",
      to: e.toLocation.pathname,
      startedAt,
      phases: { onBeforeNavigate: 0 },
      pendingShown: false,
      cls: 0,
      shifts: [],
    };
    pushSample(current);
  });
  router.subscribe("onBeforeLoad", () => record("onBeforeLoad"));
  router.subscribe("onLoad", () => record("onLoad"));
  router.subscribe("onResolved", () => record("onResolved"));
  router.subscribe("onBeforeRouteMount", () => record("onBeforeRouteMount"));
  router.subscribe("onRendered", () => {
    if (!current) return;
    record("onRendered");
    current.totalMs = current.phases.onRendered;
    // Allow another ~800ms of layout-shift attribution post-render, then
    // freeze the sample (current pointer moves to next nav anyway).
    const finished = current;
    setTimeout(() => {
      // mutate in place; samples array still holds same ref
      void finished;
      emit();
    }, 800);
  });

}

/**
 * Called by the overlay (which already subscribes to router state) to mark
 * that the router entered its "pending" UI window for the current nav.
 */
export function markPendingShown() {
  if (current && !current.pendingShown) {
    current.pendingShown = true;
    emit();
  }
}

export function subscribeNavPerf(fn: Listener): () => void {
  listeners.add(fn);
  fn(samples);
  return () => listeners.delete(fn);
}

export function clearNavPerf() {
  samples = [];
  emit();
}

const STORAGE_KEY = "nav-perf";

export function isOverlayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "1") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOverlayEnabled(on: boolean) {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}