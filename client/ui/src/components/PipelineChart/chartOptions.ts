import type { EChartsOption } from "echarts";
import type {
  PipelineTimeSeriesResponse,
} from "../../types";

// ---------------------------------------------------------------------------
// Color palette — distinct, saturated colors for block decomposition
// ---------------------------------------------------------------------------
export const BLOCK_COLORS = [
  "#00cc96", // green
  "#636efa", // indigo
  "#ef553b", // red
  "#ab63fa", // purple
  "#ffa15a", // orange
  "#19d3f3", // cyan
  "#ff6692", // pink
  "#b6e880", // lime
  "#ff97ff", // magenta
  "#fecb52", // yellow
];

export const SMOOTHED_COLOR = "#ffffff";
export const RAW_COLOR = "rgba(255,255,255,0.3)";
export const FAIR_COLOR = "#ffffff";
export const VARIANCE_COLOR = "#ffffff";
export const MARKET_FAIR_COLOR = "rgba(255,255,255,0.35)";
export const SIDEBAR_POSITION_COLOR = "#636efa";
export const SIDEBAR_FAIR_COLOR = "#00cc96";
export const SIDEBAR_VARIANCE_COLOR = "#ef553b";

export type DecompositionMode = "variance" | "fair_value" | "desired_position" | "smoothed_desired_position";

export const MODE_LABELS: Record<DecompositionMode, string> = {
  desired_position: "Desired Pos (Raw)",
  smoothed_desired_position: "Desired Pos (Smooth)",
  fair_value: "Fair Value",
  variance: "Variance",
};

export const TOOLTIP_STYLE = {
  backgroundColor: "rgba(20,20,30,0.95)",
  borderColor: "rgba(255,255,255,0.1)",
  textStyle: { color: "#ccc", fontSize: 10 },
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
      areaStyle: { opacity: dimmed ? 0.08 : 0.25 },
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
      areaStyle: { opacity: dimmed ? 0.08 : 0.25 },
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return "";
        const ts = params[0].axisValue ?? "";
        let tsLabel = ts;
        try {
          const d = new Date(ts);
          tsLabel = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
        } catch { /* keep raw */ }

        // Group items by chart (axisIndex)
        const groups: Record<number, typeof params> = {};
        for (const p of params) {
          const idx = p.axisIndex ?? 0;
          (groups[idx] ??= []).push(p);
        }

        let html = `<div style="font-size:10px;margin-bottom:4px;color:#8a8f9a">${tsLabel}</div>`;

        for (const axisIdx of Object.keys(groups).map(Number).sort()) {
          const items = groups[axisIdx];
          // Compute block total for % (exclude aggregate lines)
          const isFair = axisIdx === 1;
          const isVar = axisIdx === 2;
          const suffix = isFair ? " (fair)" : isVar ? " (var)" : "";
          const blockItems = suffix
            ? items.filter((p: any) => (p.seriesName ?? "").endsWith(suffix))
            : [];
          const blockAbsSum = blockItems.reduce(
            (s: number, p: any) => s + Math.abs(p.value ?? 0), 0,
          );

          for (const p of items) {
            const v = p.value ?? 0;
            const name: string = p.seriesName ?? "";
            const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>`;
            const isBlock = suffix && name.endsWith(suffix);
            const pctStr = isBlock && blockAbsSum > 0
              ? ` <span style="color:#8a8f9a">(${((Math.abs(v) / blockAbsSum) * 100).toFixed(1)}%)</span>`
              : "";
            html += `<div>${dot}${name}: <b>${sci(v)}</b>${pctStr}</div>`;
          }
        }
        return html;
      },
    },
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 0,
      top: 30,
      bottom: 40,
      textStyle: { color: "#8a8f9a", fontSize: 9 },
      pageTextStyle: { color: "#8a8f9a" },
      itemWidth: 10,
      itemHeight: 8,
      itemGap: 4,
    },
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
        backgroundColor: "rgba(255,255,255,0.03)",
        fillerColor: "rgba(99,110,250,0.15)",
        handleStyle: { color: "#636efa" },
        textStyle: { color: "#8a8f9a", fontSize: 9 },
      },
    ],
    grid: [
      { left: 60, right: 130, top: 30, height: "22%" },
      { left: 60, right: 130, top: "36%", height: "22%" },
      { left: 60, right: 130, top: "66%", height: "22%" },
    ],
    xAxis: [
      {
        type: "category",
        data: timestamps,
        gridIndex: 0,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        splitLine: { show: false },
      },
      {
        type: "category",
        data: timestamps,
        gridIndex: 1,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        splitLine: { show: false },
      },
      {
        type: "category",
        data: timestamps,
        gridIndex: 2,
        axisLabel: {
          color: "#8a8f9a",
          fontSize: 9,
          formatter: (v: string) => {
            try {
              const d = new Date(v);
              return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
            } catch {
              return v;
            }
          },
        },
        axisTick: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        name: "Position ($)",
        nameTextStyle: { color: "#8a8f9a", fontSize: 9, padding: [0, 0, 0, -10] },
        axisLabel: { color: "#8a8f9a", fontSize: 9, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)) },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
        axisLine: { show: false },
      },
      {
        type: "value",
        gridIndex: 1,
        name: "Fair Value",
        nameTextStyle: { color: "#8a8f9a", fontSize: 9, padding: [0, 0, 0, -10] },
        axisLabel: { color: "#8a8f9a", fontSize: 9, formatter: (v: number) => sci(v) },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
        axisLine: { show: false },
      },
      {
        type: "value",
        gridIndex: 2,
        name: "Variance",
        nameTextStyle: { color: "#8a8f9a", fontSize: 9, padding: [0, 0, 0, -10] },
        axisLabel: { color: "#8a8f9a", fontSize: 9, formatter: (v: number) => sci(v) },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
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
