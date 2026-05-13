// Default announcements seed — used as a fallback "data source" when the
// announcements table is empty. Kept as a plain module so it can be imported
// from both client (preview/debug) and server (seeding) safely.

export type SeedAnnouncement = {
  title: string;
  body: string;
  // Relative offset in days from "now" when inserted (negative = older).
  offsetDays: number;
};

export const DEFAULT_SEED_SOURCE = "builtin:default-seed@v1";

export const DEFAULT_ANNOUNCEMENTS: SeedAnnouncement[] = [
  {
    title: "Welcome to n8n-mcp",
    body: "Connect your n8n instance and start chatting with your workflows through any MCP-compatible client. Check **Settings → Instances** to get started.",
    offsetDays: -2,
  },
  {
    title: "Chat with workflow context",
    body: "The built-in chat agent now injects live workflow stats from your n8n instance, so answers reference your real node counts.",
    offsetDays: -1,
  },
  {
    title: "What's new lives here",
    body: "Product updates and changelog entries will appear on this page. Admins can publish new entries from **Admin → Announcements**.",
    offsetDays: 0,
  },
];
