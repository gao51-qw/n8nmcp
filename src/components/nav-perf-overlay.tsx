import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  attachNavPerf,
  isOverlayEnabled,
  markPendingShown,
  setOverlayEnabled,
  subscribeNavPerf,
  clearNavPerf,
  type NavSample,
} from "@/lib/nav-perf";

/**
 * Floating dev overlay for diagnosing navigation jitter.
 * Hidden unless localStorage["nav-perf"] === "1" (or ?perf=1 in the URL).
 * Toggle with Ctrl+Shift+P.
 */
export function NavPerfOverlay() {
  const router = useRouter();
  const status = useRouterState({ select: (s) => s.status });
  const [enabled, setEnabled] = useState(false);
  const [samples, setSamples] = useState<NavSample[]>([]);
  const [open, setOpen] = useState(true);

  // Always attach the recorder so data is available the instant the overlay
  // is enabled; the recorder is cheap when no listeners are attached.
  useEffect(() => {
    attachNavPerf(router);
    setEnabled(isOverlayEnabled());
  }, [router]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeNavPerf(setSamples);
  }, [enabled]);

  useEffect(() => {
    if (status === "pending") markPendingShown();
  }, [status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        const next = !isOverlayEnabled();
        setOverlayEnabled(next);
        setEnabled(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!enabled) return null;

  return (
    <div
      className="fixed bottom-3 right-3 z-[9999] w-[380px] max-h-[60vh] overflow-hidden rounded-lg border border-border bg-background/95 text-xs shadow-2xl backdrop-blur"
      role="complementary"
      aria-label="Navigation performance overlay"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="font-semibold">Nav perf</div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>status: {status}</span>
          <button
            className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "–" : "+"}
          </button>
          <button
            className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
            onClick={clearNavPerf}
          >
            clear
          </button>
          <button
            className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
            onClick={() => {
              setOverlayEnabled(false);
              setEnabled(false);
            }}
            title="Hide (Ctrl+Shift+P to toggle)"
          >
            ×
          </button>
        </div>
      </div>
      {open && (
        <div className="max-h-[calc(60vh-36px)] divide-y divide-border overflow-auto">
          {samples.length === 0 && (
            <div className="p-3 text-muted-foreground">
              Navigate between pages to record samples. Ctrl+Shift+P to hide.
            </div>
          )}
          {samples.map((s) => (
            <SampleRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SampleRow({ s }: { s: NavSample }) {
  const [expanded, setExpanded] = useState(false);
  const total = s.totalMs ?? "…";
  const clsBad = s.cls > 0.05;
  return (
    <div className="px-3 py-2">
      <button
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono">
            {s.from} → <span className="font-semibold">{s.to}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>total: <b className={typeof total === "number" && total > 300 ? "text-amber-500" : ""}>{total}ms</b></span>
            <span>load: {fmt(s.phases.onLoad)}</span>
            <span>resolved: {fmt(s.phases.onResolved)}</span>
            <span>rendered: {fmt(s.phases.onRendered)}</span>
            {s.pendingShown && <span className="text-amber-500">pending UI</span>}
            <span className={clsBad ? "text-red-500" : ""}>CLS: {s.cls.toFixed(4)}</span>
          </div>
        </div>
        <span className="text-muted-foreground">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 rounded border border-border bg-muted/30 p-2 font-mono text-[11px]">
          {s.shifts.length === 0 ? (
            <div className="text-muted-foreground">No layout shifts attributed.</div>
          ) : (
            s.shifts.map((sh, i) => (
              <div key={i} className="space-y-0.5">
                <div>
                  +{sh.at}ms · shift {sh.value.toFixed(4)}
                </div>
                {sh.sources.length === 0 ? (
                  <div className="pl-3 text-muted-foreground">(no source node)</div>
                ) : (
                  sh.sources.map((src, j) => (
                    <div key={j} className="pl-3 text-muted-foreground">
                      &lt;{src.tag}
                      {src.id ? ` #${src.id}` : ""}
                      {src.className ? ` .${src.className.split(/\s+/).slice(0, 3).join(".")}` : ""}
                      &gt;{" "}
                      <span className="opacity-60">
                        {src.rect.w}×{src.rect.h} @ ({src.rect.x},{src.rect.y})
                      </span>
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function fmt(n: number | undefined) {
  return n == null ? "—" : `${n}ms`;
}