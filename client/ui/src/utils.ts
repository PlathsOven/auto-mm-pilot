/** Returns a Tailwind text-color class based on the sign of the value. */
export function valColor(val: number): string {
  if (val > 0) return "text-mm-positive";
  if (val < 0) return "text-mm-negative";
  return "text-mm-neutral";
}

/** Returns an rgba background color tinted by sign (light glass palette). */
export function cellBg(val: number): string {
  if (val > 0) return "rgba(79, 91, 213, 0.06)";
  if (val < 0) return "rgba(212, 64, 92, 0.06)";
  return "transparent";
}

/** Formats an elapsed duration (ms) as a human-readable age string. */
export function formatAge(ms: number): string {
  if (ms < 1000) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}

/** Creates an auto-incrementing ID generator with a given prefix. */
export function createIdGenerator(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}${++counter}`;
}

/** Converts an ISO-8601 expiry string to DDMMMYY format (e.g. "27MAR26"). */
export function formatExpiry(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase();
    const yr = String(d.getUTCFullYear()).slice(2);
    return `${day}${mon}${yr}`;
  } catch {
    return iso;
  }
}

const MONTH_INDEX: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parses a DDMMMYY expiry string (e.g. "27MAR26") back into a UTC millisecond
 * timestamp. Inverse of {@link formatExpiry}, suitable for chronological
 * sorting of expiry columns. Returns NaN on malformed input.
 */
export function parseExpiry(ddmmmyy: string): number {
  if (ddmmmyy.length !== 7) return NaN;
  const day = parseInt(ddmmmyy.slice(0, 2), 10);
  const mon = MONTH_INDEX[ddmmmyy.slice(2, 5).toUpperCase()];
  const yr = parseInt(ddmmmyy.slice(5, 7), 10);
  if (Number.isNaN(day) || mon === undefined || Number.isNaN(yr)) return NaN;
  return Date.UTC(2000 + yr, mon, day);
}

/** Formats a UTC timestamp (ms) as HH:MM:SS.mmm */
export function formatUtcTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}
