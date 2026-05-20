/**
 * Shared time, duration, and currency formatting utilities.
 * Single source of truth — import from here instead of defining locally.
 */

/** Convert a minutes value to a human-readable duration string, e.g. "2h 30m" */
export function fmtDuration(mins: number): string {
  if (mins <= 0) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Format a PostgreSQL time string (HH:MM or HH:MM:SS) to "10:22 AM" */
export function fmtTime12h(t: string | null): string {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** Format a number as South African Rand, e.g. "R 1 234.56" */
export function fmtCurrency(n: number): string {
  return "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format a YYYY-MM-DD date string to "12 May 2026" */
export function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
