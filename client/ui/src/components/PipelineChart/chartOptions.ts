import type { EChartsOption } from "echarts";
import type { PipelineTimeSeriesResponse } from "../../types";
import type { Metric, Smoothing } from "../../utils";
import {
  formatTooltipDate,
  makeTimeAxisFormatter,
  positionLabel,
  sci,
  vpLabel,
  zipTimeSeries,
} from "./formatters";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
//
// Block-decomposition palette — brand-harmonised indigo/navy series used
// anywhere a list of per-block colors is needed (StreamInspector, etc.).
// mm-accent leads so the most-prominent block anchors to the brand color;
// mm-error coral in slot 8 lets blocks that drive variance the wrong way
// still pop. The pipeline chart itself no longer plots per-block series,
// but the palette stays here because it's the canonical home for chart
// color tokens.
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

// Single authoritative chart line color — mm-text navy. The chart plots
// one series at a time (the smoothing toggle swaps which variant), so the
// old raw-vs-smoothed two-line palette is no longer needed.
export const SMOOTHED_COLOR = "#1a1a2e";

export const TOOLTIP_STYLE = {
  backgroundColor: "rgba(255,255,255,0.92)",
  borderColor: "rgba(0,0,0,0.08)",
  borderRadius: 8,
  padding: [6, 8] as [number, number],
  textStyle: { color: "#1a1a2e", fontSize: 10 },
} as const;

// ---------------------------------------------------------------------------
// Per-metric resolution
// ---------------------------------------------------------------------------

interface MetricSeries {
  /** Selected-variant values, already resolved against the smoothing toggle. */
  values: number[];
  /** Legend label for the series. */
  label: string;
  /** y-axis name + tick/tooltip formatter. */
  yAxisName: string;
  yAxisFormatter: (v: number) => string;
  tooltipFormatter: (v: number) => string;
  /** `marketSource` renders a step line — user-entered scalar over time.
   *  Everything else is a standard interpolated line. */
  stepRender: boolean;
}

/** Resolve the (metric, smoothing) pair to a single displayed series that
 *  mirrors the Overview cell value. Metrics without a smoothed variant
 *  (marketSource) ignore the smoothing flag and always emit the source
 *  series. */
function resolveMetricSeries(
  data: PipelineTimeSeriesResponse,
  metric: Metric,
  smoothing: Smoothing,
): MetricSeries {
  const agg = data.aggregated;
  const s = smoothing === "smoothed";
  switch (metric) {
    case "desired":
      return {
        values: s ? agg.smoothedDesiredPosition : agg.rawDesiredPosition,
        label: s ? "Smoothed Desired" : "Instant Desired",
        yAxisName: "Desired ($)",
        yAxisFormatter: positionLabel,
        tooltipFormatter: sci,
        stepRender: false,
      };
    case "edge":
      return {
        values: s ? agg.smoothedEdge : agg.edge,
        label: s ? "Smoothed Edge" : "Instant Edge",
        yAxisName: "Edge (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        stepRender: false,
      };
    case "variance":
      return {
        values: s ? agg.smoothedVar : agg.var,
        label: s ? "Smoothed Variance" : "Instant Variance",
        yAxisName: "Variance (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        stepRender: false,
      };
    case "fair":
      return {
        values: s ? agg.smoothedTotalFair : agg.totalFair,
        label: s ? "Smoothed Fair" : "Instant Fair",
        yAxisName: "Fair (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        stepRender: false,
      };
    case "marketCalc":
      return {
        values: s ? agg.smoothedTotalMarketFair : agg.totalMarketFair,
        label: s ? "Smoothed Market (Calc)" : "Instant Market (Calc)",
        yAxisName: "Market Calc (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        stepRender: false,
      };
    case "marketSource":
      return {
        values: agg.marketVol,
        label: "Market (Source)",
        yAxisName: "Market Source (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        stepRender: true,
      };
  }
}

// ---------------------------------------------------------------------------
// ECharts option builder
// ---------------------------------------------------------------------------

/**
 * Build a single-metric historical time-series option for the (metric,
 * smoothing) pair picked on the Pipeline panel. One line per chart — the
 * smoothing toggle swaps which variant is plotted, matching the Overview
 * grid's cell semantics. ``marketSource`` renders as a step line; every
 * other metric as a standard interpolated line.
 */
export function buildPipelineSingleMetricOptions(
  data: PipelineTimeSeriesResponse,
  metric: Metric,
  smoothing: Smoothing,
): EChartsOption {
  const timestamps = data.aggregated.timestamps;
  const spec = resolveMetricSeries(data, metric, smoothing);

  const series: EChartsOption["series"] = [{
    name: spec.label,
    type: "line",
    ...(spec.stepRender ? { step: "end" as const } : {}),
    data: zipTimeSeries(timestamps, spec.values),
    showSymbol: false,
    lineStyle: { width: 2, color: SMOOTHED_COLOR },
    itemStyle: { color: SMOOTHED_COLOR },
  }];

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        crossStyle: { color: "#666" },
        label: {
          formatter: (params) => {
            if (params.axisDimension === "x") {
              if (typeof params.value === "number") {
                return formatTooltipDate(new Date(params.value));
              }
              return String(params.value ?? "");
            }
            return typeof params.value === "number"
              ? spec.tooltipFormatter(params.value)
              : String(params.value ?? "");
          },
        },
      },
      ...TOOLTIP_STYLE,
      confine: true,
      formatter: (paramsRaw) => {
        const params = Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw];
        if (params.length === 0) return "";
        const firstValue = params[0].value;
        const header = Array.isArray(firstValue) && typeof firstValue[0] === "number"
          ? formatTooltipDate(new Date(firstValue[0]))
          : String(params[0].name ?? "");
        const rows = params
          .map((p) => {
            const raw = Array.isArray(p.value) ? p.value[1] : p.value;
            const v = typeof raw === "number" ? spec.tooltipFormatter(raw) : String(raw ?? "—");
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
    grid: { left: 56, right: 16, top: 12, bottom: 48 },
    xAxis: {
      type: "time",
      axisLabel: {
        color: "#6e6e82",
        fontSize: 9,
        hideOverlap: true,
        lineHeight: 11,
        formatter: makeTimeAxisFormatter(timestamps),
      },
      axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: spec.yAxisName,
      scale: true,
      nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: spec.yAxisFormatter },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series,
  };
}


