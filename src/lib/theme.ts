import { supabase } from "@/integrations/supabase/client";

export type ThemeChoice = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "n8n-mcp-theme";
export const THEME_EVENT = "n8n-mcp-theme-change";

export function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  const effective = choice === "system" ? resolveSystemTheme() : choice;
  document.documentElement.classList.toggle("dark", effective === "dark");
}

export function getStoredTheme(): ThemeChoice {
  if (typeof localStorage === "undefined") return "dark";
  return (localStorage.getItem(THEME_STORAGE_KEY) as ThemeChoice | null) ?? "dark";
}

/** Persist locally + broadcast same-tab + try remote save (best-effort). */
export async function setTheme(next: ThemeChoice, opts?: { remote?: boolean }) {
  applyTheme(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  }
  if (opts?.remote !== false) {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (uid) {
      await supabase.from("profiles").update({ theme_preference: next }).eq("id", uid);
    }
  }
}
