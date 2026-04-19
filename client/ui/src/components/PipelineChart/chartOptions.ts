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

/** Build a category-axis label formatter that renders `MM/DD\nHH:MM` at
 *  the first tick and whenever the local date changes between adjacent
 *  timestamps, and just `HH:MM` elsewhere. Tick density is handled by
 *  ECharts' `hideOverlap: true` — this only shapes what each rendered
 *  tick reads. Labels render in the user's local timezone (same
 *  convention as the old HH:MM-only formatter). */
function makeAxisLabelFormatter(timestamps: string[]) {
  return (value: string, index: number): string => {
    const d = parseIsoUtc(value);
    if (!d) return value;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const date = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    if (index === 0) return `${date}\n${time}`;
    const prev = parseIsoUtc(timestamps[index - 1]);
    if (!prev) return `${date}\n${time}`;
    const dayChanged =
      prev.getFullYear() !== d.getFullYear()
      || prev.getMonth() !== d.getMonth()
      || prev.getDate() !== d.getDate();
    return dayChanged ? `${date}\n${time}` : time;
  };
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
    yAxisName = "Position ($)";
    yAxisFormatter = (v: number) =>
      v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
    series.push(
      {
        name: "Raw",
        type: "line",
        data: aggregated.rawDesiredPosition,
        showSymbol: false,
        lineStyle: { width: 1, color: RAW_COLOR },
        itemStyle: { color: RAW_COLOR },
        z: 1,
      },
      {
        name: "Smoothed",
        type: "line",
        data: aggregated.smoothedDesiredPosition,
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
      axisPointer: { type: "cross", crossStyle: { color: "#666" } },
      ...TOOLTIP_STYLE,
      confine: true,
      valueFormatter: (v) => (typeof v === "number" ? sci(v) : String(v ?? "—")),
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
    xAxis: {
      // Invariant (asserted below): ECharts' `stack:` feature only works
      // on a category axis. Time-axis with stacked nullable series throws
      // inside the internal stacker and — with no ErrorBoundary above the
      // chart — unmounts the whole workbench (the "blank screen on Fair"
      // bug). If you change this, the assertion at the end of the builder
      // fires.
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
      nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: yAxisFormatter },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series,
  };
}
