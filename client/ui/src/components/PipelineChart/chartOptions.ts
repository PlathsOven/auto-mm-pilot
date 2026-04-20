import type { EChartsOption } from "echarts";
import type {
  BlockTimeSeries,
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

/** Parse a naive-UTC ISO timestamp to epoch milliseconds. The server emits
 *  naive UTC; JS would otherwise interpret naive ISO as local time on some
 *  browsers, shifting the axis by the user's UTC offset. */
function parseIsoUtcMs(iso: string): number | null {
  if (!iso) return null;
  const normalised = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(normalised).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Zip a timestamp column with a values column into ECharts pair-form data
 *  for a time-axis series. Drops entries whose timestamp fails to parse;
 *  preserves `null` values so the line breaks where the source data gaps. */
function zipPairs(
  timestamps: string[],
  values: (number | null)[],
): ([number, number | null])[] {
  const out: ([number, number | null])[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = parseIsoUtcMs(timestamps[i]);
    if (t == null) continue;
    out.push([t, values[i] ?? null]);
  }
  return out;
}

/** Build cumulative-stack pair data for the Fair / Variance views.
 *
 *  ECharts' native `stack:` feature requires a category axis — using it on
 *  a time axis with nullable series throws inside the internal stacker and
 *  unmounts the chart (lesson logged 2026-04-17). To keep the stacked
 *  visual on a true time axis, we compute running sums across blocks at
 *  each shared timestamp ourselves: block i's datum at time t is the sum
 *  of all preceding blocks' contributions plus its own. A `null`
 *  contribution adds 0 to the running total and leaves that block's point
 *  null (so the area at that timestamp collapses to the layer below).
 *
 *  Each series is then rendered as an area from y=0 to its cumulative
 *  value — higher-index series overdraw lower ones, reproducing the
 *  stacked appearance. */
function buildCumulativeStack(
  blocks: BlockTimeSeries[],
  timestamps: string[],
  field: "fair" | "var",
): ([number, number | null])[][] {
  const running: number[] = new Array(timestamps.length).fill(0);
  const parsedTs: (number | null)[] = timestamps.map(parseIsoUtcMs);
  return blocks.map((block) => {
    const values = block[field];
    const series: ([number, number | null])[] = [];
    for (let ti = 0; ti < timestamps.length; ti++) {
      const t = parsedTs[ti];
      if (t == null) continue;
      const v = values[ti];
      if (v == null) {
        series.push([t, null]);
      } else {
        running[ti] += v;
        series.push([t, running[ti]]);
      }
    }
    return series;
  });
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
        data: zipPairs(axisTimestamps, aggregated.rawDesiredPosition),
        showSymbol: false,
        lineStyle: { width: 1, color: RAW_COLOR },
        itemStyle: { color: RAW_COLOR },
        z: 1,
      },
      {
        name: "Smoothed",
        type: "line",
        data: zipPairs(axisTimestamps, aggregated.smoothedDesiredPosition),
        showSymbol: false,
        lineStyle: { width: 2, color: SMOOTHED_COLOR },
        itemStyle: { color: SMOOTHED_COLOR },
        z: 2,
      },
    );
  } else {
    const field: "fair" | "var" = view === "fair" ? "fair" : "var";
    yAxisName = view === "fair" ? "Fair Value" : "Variance";
    yAxisFormatter = sci;
    const cumulative = buildCumulativeStack(blocks, axisTimestamps, field);
    blocks.forEach((b, i) => {
      const dimmed = hasSelection && !selectedBlocks.has(b.blockName);
      series.push({
        name: `${b.blockName} (${field})`,
        type: "line",
        data: cumulative[i],
        showSymbol: false,
        connectNulls: false,
        areaStyle: { opacity: dimmed ? STACK_AREA_OPACITY_DIMMED : STACK_AREA_OPACITY },
        lineStyle: {
          width: dimmed ? 0.3 : 0,
          color: BLOCK_COLORS[i % BLOCK_COLORS.length],
          opacity: dimmed ? 0.3 : 1,
        },
        itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
        emphasis: { focus: "series" },
        // Lower-index blocks sit "below" the stack; higher z puts the top
        // bands on top so the cascaded fills reproduce the stacked look.
        z: i,
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
      // Time axis — ticks land at their true timestamp, so irregular
      // snapshot intervals show as visible gaps. Fair / Variance views
      // reproduce the stacked visual via manual cumulative sums (see
      // buildCumulativeStack) because ECharts' native `stack:` feature
      // only works on a category axis.
      type: "time",
      axisLabel: {
        color: "#6e6e82",
        fontSize: 9,
        hideOverlap: true,
        lineHeight: 11,
      },
      axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: yAxisName,
      // Position is a line view where the data range (e.g. -12k..-10k) is
      // far from 0; forcing 0 into the axis flattens the line against the
      // top edge. Fair/Variance are stacked areas filled from y=0, so the
      // zero baseline must remain.
      scale: isPositionView,
      nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: yAxisFormatter },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series,
  };
}
