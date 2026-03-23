/** Returns a Tailwind text-color class based on the sign of the value. */
export function valColor(val: number): string {
  if (val > 0) return "text-mm-accent";
  if (val < 0) return "text-mm-error";
  return "text-mm-text-dim";
}

/** Returns an rgba background color tinted by sign. */
export function cellBg(val: number): string {
  if (val > 0) return "rgba(129, 140, 248, 0.10)";
  if (val < 0) return "rgba(248, 113, 113, 0.10)";
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

/** Formats a UTC timestamp (ms) as HH:MM:SS.mmm */
export function formatUtcTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}
