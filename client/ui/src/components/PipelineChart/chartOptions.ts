import type { EChartsOption } from "echarts";
import type { DefaultLabelFormatterCallbackParams as CallbackDataParams } from "echarts/types/dist/echarts";
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

export type DecompositionMode = "variance" | "fair_value" | "desired_position" | "smoothed_desired_position";

export const MODE_LABELS: Record<DecompositionMode, string> = {
  desired_position: "Desired Pos (Raw)",
  smoothed_desired_position: "Desired Pos (Smooth)",
  fair_value: "Fair Value",
  variance: "Variance",
};

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

/**
 * Build a single-grid ECharts option for the requested view.
 *
 * Replaces the old three-stacked-grid layout. With one grid filling the
 * panel the chart actually fills the canvas, gets significantly more y-axis
 * resolution, and reads at small heights. The trader switches view via tabs
 * up in PipelineChartPanel — by default, those tabs follow the position
 * grid's active view-mode (linked).
 */
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
      // Category axis aligned to the backing timestamp array. Series data
      // are plain value arrays (aligned by index) — this is the only shape
      // ECharts' `stack:` supports reliably. A time axis with stacked
      // nullable series throws inside the internal stacker and, because no
      // ErrorBoundary is mounted above the chart, the whole workbench
      // unmounts — that was the "blank screen on Fair" crash.
      type: "category",
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


export function buildPipelineChartOptions(
  data: PipelineTimeSeriesResponse,
  selectedBlocks: Set<string>,
): EChartsOption {
  const { blocks, aggregated } = data;
  const timestamps = aggregated.timestamps;

  // --- Chart 1: Desired Position (top) ---
  const positionSeries: EChartsOption["series"] = [
    {
      name: "Raw",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: aggregated.rawDesiredPosition,
      showSymbol: false,
      lineStyle: { width: 1, color: RAW_COLOR },
      itemStyle: { color: RAW_COLOR },
      z: 1,
    },
    {
      name: "Smoothed",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: aggregated.smoothedDesiredPosition,
      showSymbol: false,
      lineStyle: { width: 2, color: SMOOTHED_COLOR },
      itemStyle: { color: SMOOTHED_COLOR },
      z: 2,
    },
  ];

  // --- Chart 2: Fair Value by Block (middle, stacked area) ---
  const hasSelection = selectedBlocks.size > 0;
  const fairSeries: EChartsOption["series"] = blocks.map((b, i) => {
    const dimmed = hasSelection && !selectedBlocks.has(b.blockName);
    return {
      name: `${b.blockName} (fair)`,
      type: "line" as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: b.fair,
      showSymbol: false,
      stack: "fair",
      areaStyle: { opacity: dimmed ? STACK_AREA_OPACITY_DIMMED : STACK_AREA_OPACITY },
      lineStyle: { width: dimmed ? 0.3 : 0, color: BLOCK_COLORS[i % BLOCK_COLORS.length], opacity: dimmed ? 0.3 : 1 },
      itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
      emphasis: { focus: "series" as const },
    };
  });

  // Total Fair outline (bold line showing actual aggregated value)
  fairSeries.push({
    name: "Total Fair",
    type: "line" as const,
    xAxisIndex: 1,
    yAxisIndex: 1,
    data: aggregated.totalFair,
    showSymbol: false,
    lineStyle: { width: 2, color: FAIR_COLOR },
    itemStyle: { color: FAIR_COLOR },
    z: 10,
  });

  // Market fair overlay (dashed line, not stacked)
  fairSeries.push({
    name: "Market Fair",
    type: "line" as const,
    xAxisIndex: 1,
    yAxisIndex: 1,
    data: aggregated.totalMarketFair,
    showSymbol: false,
    lineStyle: { width: 2, type: "dashed" as const, color: MARKET_FAIR_COLOR },
    itemStyle: { color: MARKET_FAIR_COLOR },
    z: 10,
  });

  // --- Chart 3: Variance by Block (bottom, stacked area) ---
  const varSeries: EChartsOption["series"] = blocks.map((b, i) => {
    const dimmed = hasSelection && !selectedBlocks.has(b.blockName);
    return {
      name: `${b.blockName} (var)`,
      type: "line" as const,
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: b.var,
      showSymbol: false,
      stack: "var",
      areaStyle: { opacity: dimmed ? STACK_AREA_OPACITY_DIMMED : STACK_AREA_OPACITY },
      lineStyle: { width: dimmed ? 0.3 : 0, color: BLOCK_COLORS[i % BLOCK_COLORS.length], opacity: dimmed ? 0.3 : 1 },
      itemStyle: { color: BLOCK_COLORS[i % BLOCK_COLORS.length] },
      emphasis: { focus: "series" as const },
    };
  });

  // Total Variance outline (bold line showing actual aggregated value)
  varSeries.push({
    name: "Total Variance",
    type: "line" as const,
    xAxisIndex: 2,
    yAxisIndex: 2,
    data: aggregated.var,
    showSymbol: false,
    lineStyle: { width: 2, color: VARIANCE_COLOR },
    itemStyle: { color: VARIANCE_COLOR },
    z: 10,
  });

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", crossStyle: { color: "#666" } },
      ...TOOLTIP_STYLE,
      confine: true,
      formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
        const items = Array.isArray(params) ? params : [params];
        if (items.length === 0) return "";
        const ts = (items[0] as CallbackDataParams & { axisValue?: string }).axisValue ?? "";
        let tsLabel = ts;
        try {
          const d = new Date(ts);
          tsLabel = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
        } catch { /* keep raw */ }

        // Group items by chart (axisIndex)
        const groups: Record<number, CallbackDataParams[]> = {};
        for (const p of items) {
          const idx = (p as CallbackDataParams & { axisIndex?: number }).axisIndex ?? 0;
          (groups[idx] ??= []).push(p);
        }

        let html = `<div style="font-size:10px;margin-bottom:4px;color:#6e6e82">${tsLabel}</div>`;

        for (const axisIdx of Object.keys(groups).map(Number).sort()) {
          const groupItems = groups[axisIdx];
          // Compute block total for % (exclude aggregate lines)
          const isFair = axisIdx === 1;
          const isVar = axisIdx === 2;
          const suffix = isFair ? " (fair)" : isVar ? " (var)" : "";
          const blockItems = suffix
            ? groupItems.filter((p) => (p.seriesName ?? "").endsWith(suffix))
            : [];
          const blockAbsSum = blockItems.reduce(
            (s: number, p) => s + Math.abs((p.value as number) ?? 0), 0,
          );

          for (const p of groupItems) {
            const v = (p.value as number) ?? 0;
            const name: string = p.seriesName ?? "";
            const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>`;
            const isBlock = suffix && name.endsWith(suffix);
            const pctStr = isBlock && blockAbsSum > 0
              ? ` <span style="color:#6e6e82">(${((Math.abs(v) / blockAbsSum) * 100).toFixed(1)}%)</span>`
              : "";
            html += `<div>${dot}${name}: <b>${sci(v)}</b>${pctStr}</div>`;
          }
        }
        return html;
      },
    },
    // No right-rail legend — the DecompositionPanel above the chart serves
    // as the colour key (same palette, same names, clickable for selection).
    // Removing the legend reclaims ~100px of horizontal space across all 3
    // grids; the inline strip in PipelineChart's header explains the
    // smoothed/raw/market-fair overlays that aren't tied to a block.
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1, 2],
        filterMode: "filter",
      },
      {
        type: "slider",
        xAxisIndex: [0, 1, 2],
        bottom: 24,
        height: 14,
        borderColor: "transparent",
        backgroundColor: "rgba(0,0,0,0.03)",
        fillerColor: "rgba(79,91,213,0.10)",
        handleStyle: { color: "#4f5bd5", borderColor: "rgba(255,255,255,0.6)" },
        textStyle: { color: "#6e6e82", fontSize: 9 },
      },
    ],
    grid: [
      { left: 60, right: 24, top: 30, height: "22%" },
      { left: 60, right: 24, top: "36%", height: "22%" },
      { left: 60, right: 24, top: "66%", height: "22%" },
    ],
    xAxis: [
      {
        type: "category",
        data: timestamps,
        gridIndex: 0,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
        splitLine: { show: false },
      },
      {
        type: "category",
        data: timestamps,
        gridIndex: 1,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
        splitLine: { show: false },
      },
      {
        type: "category",
        data: timestamps,
        gridIndex: 2,
        axisLabel: {
          color: "#6e6e82",
          fontSize: 10,
          hideOverlap: true,
          lineHeight: 12,
          formatter: makeAxisLabelFormatter(timestamps),
        },
        axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
        axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        name: "Position ($)",
        nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
        axisLabel: { color: "#6e6e82", fontSize: 10, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)) },
        splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
        axisLine: { show: false },
      },
      {
        type: "value",
        gridIndex: 1,
        name: "Fair Value",
        nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
        axisLabel: { color: "#6e6e82", fontSize: 10, formatter: (v: number) => sci(v) },
        splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
        axisLine: { show: false },
      },
      {
        type: "value",
        gridIndex: 2,
        name: "Variance",
        nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
        axisLabel: { color: "#6e6e82", fontSize: 10, formatter: (v: number) => sci(v) },
        splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
        axisLine: { show: false },
      },
    ],
    series: [
      ...(positionSeries as object[]),
      ...(fairSeries as object[]),
      ...(varSeries as object[]),
    ],
  };

  return option;
}
