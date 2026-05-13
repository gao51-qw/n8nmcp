/**
 * Centralised date/time formatters so the admin form, the announcements list,
 * and the public /whats-new page all render `scheduled_for` / `published_at`
 * timestamps the same way.
 *
 * Timestamps are stored in the DB as UTC (timestamptz). We always render them
 * in the *viewer's* local timezone with an explicit timezone label, so the
 * admin who scheduled "3pm PDT" and a user opening the page from "midnight
 * BST" both see times in their own zone — with the abbreviation visible so
 * there is no ambiguity.
 */

// NOTE: combining `dateStyle`/`timeStyle` with `timeZoneName` throws
// "Invalid option : option" in some V8/ICU builds (notably the Cloudflare
// Workers runtime used for SSR). Spell out the individual fields instead.
const SHORT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const LONG = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "long",
});

const UTC = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const TZ_NAME =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";

/** Resolved IANA timezone of the current browser, e.g. "Europe/Berlin". */
export const localTimeZone = TZ_NAME;

/** Short form: "May 9, 2026, 3:04 PM PDT" — for inline list rows. */
export function formatLocal(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "";
  return SHORT.format(d);
}

/** Long form for tooltips: "Saturday, May 9, 2026 at 3:04:00 PM Pacific Daylight Time". */
export function formatLocalLong(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "";
  return LONG.format(d);
}

/** UTC equivalent for the schedule helper text: "9 May 2026, 22:04 UTC". */
export function formatUtc(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "";
  return `${UTC.format(d)} UTC`;
}

/** Convert a `<input type="datetime-local">` value (local wall-clock) to ISO UTC. */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Inverse: ISO UTC -> "YYYY-MM-DDTHH:mm" in the viewer's local zone. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
