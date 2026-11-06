import type { Metadata } from "next";

/** Metadata for a private dashboard route: a real title, never indexed. */
export function dashboardMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    robots: { index: false, follow: false },
  };
}
