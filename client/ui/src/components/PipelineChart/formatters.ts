/**
 * Chart-axis + tooltip formatters shared across the Pipeline panel.
 *
 * Split from ``chartOptions.ts`` so the ECharts option builder stays focused
 * on series + option assembly. Pure functions, no cross-imports from chart
 * components.
 */

/** Scientific-notation number formatter for tooltips. Uses 6 decimal places
 *  in the mid-range (|v| ≥ 0.01, < 1e6) and exponential form elsewhere. */
export function sci(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 0.01 && abs < 1e6) return v.toFixed(6);
  return v.toExponential(3);
}

/** Vol-points label — matches the overview grid's two-decimal format for
 *  Edge / Variance / Fair / Market. */
export function vpLabel(v: number): string {
  return v.toFixed(2);
}

/** Position label — thousands suffix for large values, integer otherwise. */
export function positionLabel(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

/** Parse a naive-UTC ISO timestamp. The server emits naive UTC; JS would
 *  otherwise interpret naive ISO as local time on some browsers, shifting
 *  the axis labels by the user's UTC offset. */
export function parseIsoUtc(iso: string): Date | null {
  if (!iso) return null;
  const normalised = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

const SECOND_GRAN_MS = 60 * 1000;
const MINUTE_GRAN_MS = 24 * 60 * 60 * 1000;

type AxisGranularity = "second" | "minute" | "day";

function pickAxisGranularity(timestamps: string[]): AxisGranularity {
  if (timestamps.length < 2) return "minute";
  const first = parseIsoUtc(timestamps[0]);
  const last = parseIsoUtc(timestamps[timestamps.length - 1]);
  if (!first || !last) return "minute";
  const intervalMs = (last.getTime() - first.getTime()) / (timestamps.length - 1);
  if (intervalMs < SECOND_GRAN_MS) return "second";
  if (intervalMs < MINUTE_GRAN_MS) return "minute";
  return "day";
}

function formatLocalTick(d: Date, gran: AxisGranularity, prevDate: Date | null): string {
  const date = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const hms = `${hm}:${pad2(d.getSeconds())}`;
  const dayChanged = !prevDate
    || prevDate.getFullYear() !== d.getFullYear()
    || prevDate.getMonth() !== d.getMonth()
    || prevDate.getDate() !== d.getDate();
  switch (gran) {
    case "second": return dayChanged ? `${date}\n${hms}` : hms;
    case "minute": return dayChanged ? `${date}\n${hm}` : hm;
    case "day":    return dayChanged ? date : hm;
  }
}

/** `MM/DD HH:MM:SS` tooltip header — uses local time so it lines up with
 *  the axis ticks (which also render local time). */
export function formatTooltipDate(d: Date): string {
  const date = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${date} ${hms}`;
}

/** Build an ECharts `axisLabel.formatter` for a time axis derived from an
 *  array of naive-UTC ISO timestamps. Chooses granularity automatically
 *  and adds a date prefix only on day transitions so dense axes stay
 *  readable. */
export function makeTimeAxisFormatter(timestamps: string[]): (value: number) => string {
  const gran = pickAxisGranularity(timestamps);
  const first = parseIsoUtc(timestamps[0] ?? "");
  const last = parseIsoUtc(timestamps[timestamps.length - 1] ?? "");
  const crossesDay = !!(first && last && (
    first.getFullYear() !== last.getFullYear()
    || first.getMonth() !== last.getMonth()
    || first.getDate() !== last.getDate()
  ));
  return (value: number): string => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return formatLocalTick(d, gran, crossesDay ? null : d);
  };
}

/** Zip timestamps with values into `[epoch_ms, y]` tuples for a time-axis
 *  series. Drops samples whose timestamp fails to parse. */
export function zipTimeSeries(
  timestamps: string[],
  values: number[],
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const d = parseIsoUtc(timestamps[i]);
    if (!d) continue;
    out.push([d.getTime(), values[i]]);
  }
  return out;
}
