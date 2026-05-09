import { Moon, Sun, Monitor, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEffect, useState } from "react";
import {
  type ThemeChoice,
  THEME_STORAGE_KEY,
  THEME_EVENT,
  applyTheme,
  getStoredTheme,
  setTheme,
} from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setLocal] = useState<ThemeChoice>("dark");

  useEffect(() => {
    const initial = getStoredTheme();
    setLocal(initial);
    applyTheme(initial);

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    mql.addEventListener("change", onSystemChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = (e.newValue as ThemeChoice | null) ?? "dark";
      setLocal(next);
      applyTheme(next);
    };
    const onLocal = (e: Event) => {
      const next = (e as CustomEvent<ThemeChoice>).detail;
      setLocal(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_EVENT, onLocal as EventListener);
    return () => {
      mql.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_EVENT, onLocal as EventListener);
    };
  }, []);

  const choose = (next: ThemeChoice) => {
    setLocal(next);
    void setTheme(next);
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
