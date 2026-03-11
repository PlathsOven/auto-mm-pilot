/** Returns a Tailwind text-color class based on the sign of the value. */
export function valColor(val: number): string {
  if (val > 0) return "text-mm-accent";
  if (val < 0) return "text-mm-error";
  return "text-mm-text-dim";
}

/** Returns an rgba background color tinted by sign. */
export function cellBg(val: number): string {
  if (val > 0) return "rgba(88, 166, 255, 0.12)";
  if (val < 0) return "rgba(248, 81, 73, 0.12)";
  return "transparent";
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
