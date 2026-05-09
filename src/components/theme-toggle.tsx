import { Moon, Sun, Monitor, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const STORAGE_KEY = "n8n-mcp-theme";

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  const effective = choice === "system" ? resolveSystem() : choice;
  document.documentElement.classList.toggle("dark", effective === "dark");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>("dark");

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) ?? "dark";
    setTheme(saved);
    applyTheme(saved);
    // React to OS changes when in "system" mode.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      const cur = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) ?? "dark";
      if (cur === "system") applyTheme("system");
    };
    mql.addEventListener("change", onSystemChange);
    // Sync across tabs/windows via storage events + same-tab custom event.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = (e.newValue as ThemeChoice | null) ?? "dark";
      setTheme(next);
      applyTheme(next);
    };
    const onLocal = (e: Event) => {
      const next = (e as CustomEvent<ThemeChoice>).detail;
      setTheme(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("n8n-mcp-theme-change", onLocal as EventListener);
    return () => {
      mql.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("n8n-mcp-theme-change", onLocal as EventListener);
    };
  }, []);

  const choose = (next: ThemeChoice) => {
    setTheme(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    // Notify other ThemeToggle instances in the same tab.
    window.dispatchEvent(new CustomEvent("n8n-mcp-theme-change", { detail: next }));
  };

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {(
          [
            { v: "light", label: "Light", I: Sun },
            { v: "dark", label: "Dark", I: Moon },
            { v: "system", label: "System", I: Monitor },
          ] as const
        ).map(({ v, label, I }) => (
          <DropdownMenuItem key={v} onClick={() => choose(v)} className="justify-between">
            <span className="flex items-center gap-2">
              <I className="h-4 w-4" />
              {label}
            </span>
            {theme === v && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
