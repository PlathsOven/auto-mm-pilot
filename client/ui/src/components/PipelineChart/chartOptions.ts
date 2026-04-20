import type { EChartsOption } from "echarts";
import type {
  PipelineTimeSeriesResponse,
} from "../../types";

// ---------------------------------------------------------------------------
// Color palette — block decomposition
// ---------------------------------------------------------------------------
//
// Brand-harmonised palette tuned for the indigo/navy glass UI: mm-accent
// leads (so the most-prominent block visually anchors to the brand color),
// followed by softer violets, teals, ambers and corals — all ≤ ~70%
// saturation so the stacked-area chart doesn't shout against the glass
// background. mm-error coral is kept in slot 8 because some blocks
// genuinely drive variance the wrong way and the user must see them pop.
export const BLOCK_COLORS = [
  "#4f5bd5", // mm-accent indigo
  "#7b6cf0", // soft violet
  "#3eb4a8", // muted teal
  "#5a8de8", // soft sky
  "#c48a12", // mm-warn amber
  "#a16fb5", // dusty plum
  "#6ab57f", // sage
  "#d4405c", // mm-error coral
  "#e8826e", // soft terracotta
  "#9098a8", // neutral slate
];

// Aggregate-line colors — lean on mm-text (#1a1a2e) so the bold totals
// read as authoritative against the lighter stacked areas. Raw/market
// overlays are translucent to recede.
export const SMOOTHED_COLOR = "#1a1a2e";
export const RAW_COLOR = "rgba(26,26,46,0.22)";
export const FAIR_COLOR = "#1a1a2e";
export const VARIANCE_COLOR = "#1a1a2e";
export const MARKET_FAIR_COLOR = "rgba(26,26,46,0.28)";

// Stacked-area opacity — bumped from 0.25 to compensate for the lighter
// glass background. Dimmed value used when another block is selected.
export const STACK_AREA_OPACITY = 0.32;
export const STACK_AREA_OPACITY_DIMMED = 0.08;

export const TOOLTIP_STYLE = {
  backgroundColor: "rgba(255,255,255,0.92)",
  borderColor: "rgba(0,0,0,0.08)",
  borderRadius: 8,
  padding: [6, 8] as [number, number],
  textStyle: { color: "#1a1a2e", fontSize: 10 },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sci(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 0.01 && abs < 1e6) return v.toFixed(6);
  return v.toExponential(3);
}

// ---------------------------------------------------------------------------
// ECharts option builder
// ---------------------------------------------------------------------------

/** Single-view rendering modes for the pipeline chart. Each maps to one of
 *  the three substantive aggregates (position / fair / variance) that the
 *  pipeline produces — same vocabulary as the position grid's view-mode tabs
 *  so the two surfaces can stay in sync. */
export type PipelineView = "position" | "fair" | "variance";

// Axis type locked to "category" because the stacked fair/variance series
// rely on ECharts' `stack:` feature. See xAxis comment + assertion in the
// option builder.
const STACK_SAFE_XAXIS_TYPE = "category" as const;

/** Parse a naive-UTC ISO timestamp. The server emits naive UTC; JS would
 *  otherwise interpret naive ISO as local time on some browsers, shifting
 *  the axis labels by the user's UTC offset. */
function parseIsoUtc(iso: string): Date | null {
  if (!iso) return null;
  const normalised = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Per-sample interval thresholds (ms) that pick the label resolution.
 *  We choose granularity off the *median sample interval* rather than the
 *  total span so dense intra-minute series render with seconds even on a
 *  short window, and sparse hourly series collapse to dates on a long one. */
const SECOND_GRAN_MS = 60 * 1000; // < 1 min between samples → HH:MM:SS
const MINUTE_GRAN_MS = 24 * 60 * 60 * 1000; // < 1 day → HH:MM (with date breaks)

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

/** Render an ISO timestamp in the chart's chosen granularity, in local time.
 *  `prevDate` is consulted only for date-boundary handling. */
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

/** Full timestamp suitable for the tooltip header. Always renders with
 *  date + HH:MM:SS in local time so the hover read matches the x-axis
 *  convention regardless of granularity. */
function formatTooltipTimestamp(iso: string): string {
  const d = parseIsoUtc(iso);
  if (!d) return iso;
  return formatTooltipDate(d);
}

function formatTooltipDate(d: Date): string {
  const date = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${date} ${hms}`;
}

/** Build a category-axis label formatter that adapts to per-sample density
 *  (HH:MM:SS for sub-minute, HH:MM for sub-day, MM/DD-led for sparser).
 *
 *  Suppresses consecutive duplicate labels — if a tick would render the
 *  same string as the immediately preceding one, return "" so ECharts
 *  draws the tick mark without a textual label. This is the safety net
 *  for when ECharts requests more ticks than the chosen granularity can
 *  uniquely label. Labels render in the user's local timezone. */
function makeAxisLabelFormatter(timestamps: string[]) {
  const gran = pickAxisGranularity(timestamps);
  return (value: string, index: number): string => {
    const d = parseIsoUtc(value);
    if (!d) return value;
    const prev = index > 0 ? parseIsoUtc(timestamps[index - 1]) : null;
    const label = formatLocalTick(d, gran, prev);
    if (prev) {
      const prevPrev = index > 1 ? parseIsoUtc(timestamps[index - 2]) : null;
      const prevLabel = formatLocalTick(prev, gran, prevPrev);
      if (prevLabel === label) return "";
    }
    return label;
  };
}

/** Time-axis formatter. ECharts picks tick timestamps itself on
 *  `type: "time"` (round wall-clock values), so we just render each one in
 *  the granularity chosen for the underlying sample density. Date prefix is
 *  suppressed when the whole range stays within one local day — otherwise
 *  every tick carries it to disambiguate. */
function makeTimeAxisFormatter(timestamps: string[]) {
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
    // Passing `d` as prevDate forces `dayChanged` false (suppresses date
    // prefix); null forces it true.
    return formatLocalTick(d, gran, crossesDay ? null : d);
  };
}

/** Zip timestamps with values into `[epoch_ms, y]` tuples for a time-axis
 *  series. Drops samples whose timestamp fails to parse (rare; keeps the
 *  series shape valid for ECharts). */
function zipTimeSeries(
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

/**
 * Build a single-grid ECharts option for the requested view.
 *
 * Replaces the old three-stacked-grid layout. With one grid filling the
 * panel the chart actually fills the canvas, gets significantly more y-axis
 * resolution, and reads at small heights. The trader switches view via tabs
 * up in PipelineChartPanel — by default, those tabs follow the position
 * grid's active view-mode (linked).
 */
export function buildPipelineSingleViewOptions(
  data: PipelineTimeSeriesResponse,
  view: PipelineView,
  selectedBlocks: Set<string>,
): EChartsOption {
  const { blocks, aggregated, blockTimestamps } = data;
  // Position view = backward-looking historical (axis ends at current_ts);
  // Fair / Variance = forward-looking decay curves (axis runs current_ts →
  // expiry). Each view uses its own timestamp axis.
  const isPositionView = view === "position";
  const axisTimestamps = isPositionView ? aggregated.timestamps : blockTimestamps;

  const hasSelection = selectedBlocks.size > 0;

  const series: EChartsOption["series"] = [];
  let yAxisName = "";
  let yAxisFormatter: (v: number) => string;

  if (view === "position") {
    yAxisName = "Desired ($)";
    yAxisFormatter = (v: number) =>
      v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
    // Position runs on a time xAxis (see xAxis block), so series data is
    // `[epoch_ms, y]` tuples rather than a bare values array.
    series.push(
      {
        name: "Raw",
        type: "line",
        data: zipTimeSeries(aggregated.timestamps, aggregated.rawDesiredPosition),
        showSymbol: false,
        lineStyle: { width: 1, color: RAW_COLOR },
        itemStyle: { color: RAW_COLOR },
        z: 1,
      },
      {
        name: "Smoothed",
        type: "line",
        data: zipTimeSeries(aggregated.timestamps, aggregated.smoothedDesiredPosition),
        showSymbol: false,
        lineStyle: { width: 2, color: SMOOTHED_COLOR },
        itemStyle: { color: SMOOTHED_COLOR },
        z: 2,
      },
    );
  } else if (view === "fair") {
    yAxisName = "Fair Value";
    yAxisFormatter = sci;
    blocks.forEach((b, i) => {
      const dimmed = hasSelection && !selectedBlocks.has(b.blockName);
      series.push({
        name: `${b.blockName} (fair)`,
        type: "line",
        data: b.fair,
        showSymbol: false,
        stack: "fair",
        connectNulls: false,
        areaStyle: { opacity: dimmed ? STACK_AREA_OPACITY_DIMMED : STACK_AREA_OPACITY },
        lineStyle: {
          width: dimmed ? 0.3 : 0,
          color: BLOCK_COLORS[i % BLOCK_COLORS.length],
          opacity: dimmed ? 0.3 : 1,
        },
        itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
        emphasis: { focus: "series" },
      });
    });
  } else {
    // variance
    yAxisName = "Variance";
    yAxisFormatter = sci;
    blocks.forEach((b, i) => {
      const dimmed = hasSelection && !selectedBlocks.has(b.blockName);
      series.push({
        name: `${b.blockName} (var)`,
        type: "line",
        data: b.var,
        showSymbol: false,
        stack: "var",
        connectNulls: false,
        areaStyle: { opacity: dimmed ? STACK_AREA_OPACITY_DIMMED : STACK_AREA_OPACITY },
        lineStyle: {
          width: dimmed ? 0.3 : 0,
          color: BLOCK_COLORS[i % BLOCK_COLORS.length],
          opacity: dimmed ? 0.3 : 1,
        },
        itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
        emphasis: { focus: "series" },
      });
    });
  }

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        crossStyle: { color: "#666" },
        // Cross-pointer's own bubble label on the X-axis. Without this,
        // ECharts dumps the raw category value (an ISO UTC-naive string),
        // which doesn't match the local-time x-axis ticks and is confusing.
        label: {
          formatter: (params) => {
            if (params.axisDimension === "x") {
              // Time axis (Position view) hands us epoch ms; category axis
              // (Fair / Variance) hands us the ISO category string.
              if (typeof params.value === "number") {
                return formatTooltipDate(new Date(params.value));
              }
              return formatTooltipTimestamp(String(params.value));
            }
            return typeof params.value === "number" ? sci(params.value) : String(params.value ?? "");
          },
        },
      },
      ...TOOLTIP_STYLE,
      confine: true,
      // Custom formatter so the header renders the timestamp in local time
      // (matching the x-axis), and series rows stay compactly aligned.
      formatter: (paramsRaw) => {
        const params = Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw];
        if (params.length === 0) return "";
        // Position view runs on a time axis — series `value` arrives as
        // `[epoch_ms, y]` tuples, so the header reads ms off element 0.
        // Fair / Variance run on a category axis where `name` holds the
        // raw ISO string. Detect by shape rather than view flag so the
        // formatter stays self-contained.
        const firstValue = params[0].value;
        const header = Array.isArray(firstValue) && typeof firstValue[0] === "number"
          ? formatTooltipDate(new Date(firstValue[0]))
          : formatTooltipTimestamp(String(params[0].name ?? ""));
        const rows = params
          .map((p) => {
            // On a time axis the row value is `[ms, y]`; extract the y.
            const raw = Array.isArray(p.value) ? p.value[1] : p.value;
            const v = typeof raw === "number" ? sci(raw) : String(raw ?? "—");
            return `<div style="display:flex;justify-content:space-between;gap:16px;"><span>${p.marker} ${p.seriesName}</span><span style="font-family:monospace;">${v}</span></div>`;
          })
          .join("");
        return `<div style="font-weight:600;margin-bottom:4px;">${header}</div>${rows}`;
      },
    },
    dataZoom: [
      { type: "inside", filterMode: "filter" },
      {
        type: "slider",
        bottom: 6,
        height: 12,
        borderColor: "transparent",
        backgroundColor: "rgba(0,0,0,0.03)",
        fillerColor: "rgba(79,91,213,0.10)",
        handleStyle: { color: "#4f5bd5", borderColor: "rgba(255,255,255,0.6)" },
        textStyle: { color: "#6e6e82", fontSize: 9 },
      },
    ],
    // bottom leaves room for the dataZoom slider (bottom 6 + height 12)
    // + a two-line axis label (~22px) — single-line labels used 36px.
    grid: { left: 56, right: 16, top: 12, bottom: 48 },
    xAxis: isPositionView
      ? {
          // Position view has no stacked series, so we use a real time
          // axis — ECharts then picks ticks at round wall-clock values
          // (every 30s, 1m, etc.) instead of at arbitrary category
          // indices.
          type: "time",
          axisLabel: {
            color: "#6e6e82",
            fontSize: 9,
            hideOverlap: true,
            lineHeight: 11,
            formatter: makeTimeAxisFormatter(axisTimestamps),
          },
          axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
          axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
          splitLine: { show: false },
        }
      : {
          // Invariant (asserted below): ECharts' `stack:` feature only
          // works on a category axis. Time-axis with stacked nullable
          // series throws inside the internal stacker and — with no
          // ErrorBoundary above the chart — unmounts the whole workbench
          // (the "blank screen on Fair" bug). If you change this, the
          // assertion at the end of the builder fires.
          type: STACK_SAFE_XAXIS_TYPE,
          data: axisTimestamps,
          boundaryGap: false,
          axisLabel: {
            color: "#6e6e82",
            fontSize: 9,
            hideOverlap: true,
            lineHeight: 11,
            formatter: makeAxisLabelFormatter(axisTimestamps),
          },
          axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
          axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
          splitLine: { show: false },
        },
    yAxis: {
      type: "value",
      name: yAxisName,
      // Position is a line view whose data range (e.g. -12k..-10k) lives
      // far from 0; forcing 0 into the axis flattens the line against the
      // top edge. Fair/Variance are stacked areas filled from y=0, so the
      // zero baseline must stay.
      scale: isPositionView,
      nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: yAxisFormatter },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series,
  };
}
