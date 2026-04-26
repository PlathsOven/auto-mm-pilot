import type { EChartsOption } from "echarts";
import type { PipelineTimeSeriesResponse } from "../../types";
import type { Metric } from "../../utils";
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

// Two-line palette for smoothable metrics. Smoothed keeps mm-text navy
// (the single-line colour the chart has always used, so existing visuals
// are preserved); instant pairs it with mm-accent indigo for a clearly
// distinct second series.
export const INSTANT_COLOR = "#4f5bd5";
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

interface SeriesLine {
  /** Legend label for this specific line. */
  label: string;
  /** Y-values aligned to ``aggregated.timestamps``. */
  values: number[];
  /** Stroke colour for the line and its legend marker. */
  color: string;
  /** ``marketSource`` renders a step line — user-entered scalar over time.
   *  Everything else is a standard interpolated line. */
  stepRender: boolean;
}

interface MetricSpec {
  /** y-axis name + tick/tooltip formatter — shared across every line of
   *  a metric since instant and smoothed variants use the same units. */
  yAxisName: string;
  yAxisFormatter: (v: number) => string;
  tooltipFormatter: (v: number) => string;
  /** One entry per displayed line. Smoothable metrics yield two
   *  (instant + smoothed); ``marketSource`` yields one. */
  lines: SeriesLine[];
}

/** Resolve a metric to its axis metadata + every displayed line.
 *  Smoothable metrics emit both instant and smoothed variants so the
 *  chart can overlay them. ``marketSource`` is a single step line. */
function resolveMetricSpec(
  data: PipelineTimeSeriesResponse,
  metric: Metric,
): MetricSpec {
  const agg = data.aggregated;
  switch (metric) {
    case "desired":
      return {
        yAxisName: "Desired ($)",
        yAxisFormatter: positionLabel,
        tooltipFormatter: sci,
        lines: [
          { label: "Instant Desired", values: agg.rawDesiredPosition, color: INSTANT_COLOR, stepRender: false },
          { label: "Smoothed Desired", values: agg.smoothedDesiredPosition, color: SMOOTHED_COLOR, stepRender: false },
        ],
      };
    case "exposure":
      // Stage H exposure timeseries isn't on the wire yet — the Pipeline
      // endpoint aggregates position (post-correlation) only. Fall back to
      // the position series so the dropdown stays exhaustive; the two
      // coincide in the identity-matrix default state. A follow-up can
      // emit a separate ``rawDesiredExposure`` / ``smoothedDesiredExposure``
      // aggregated series in pipeline_series.py when correlations drift
      // from identity.
      return {
        yAxisName: "Exposure ($)",
        yAxisFormatter: positionLabel,
        tooltipFormatter: sci,
        lines: [
          { label: "Instant Exposure", values: agg.rawDesiredPosition, color: INSTANT_COLOR, stepRender: false },
          { label: "Smoothed Exposure", values: agg.smoothedDesiredPosition, color: SMOOTHED_COLOR, stepRender: false },
        ],
      };
    case "edge":
      return {
        yAxisName: "Edge (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        lines: [
          { label: "Instant Edge", values: agg.edge, color: INSTANT_COLOR, stepRender: false },
          { label: "Smoothed Edge", values: agg.smoothedEdge, color: SMOOTHED_COLOR, stepRender: false },
        ],
      };
    case "variance":
      return {
        yAxisName: "Variance (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        lines: [
          { label: "Instant Variance", values: agg.var, color: INSTANT_COLOR, stepRender: false },
          { label: "Smoothed Variance", values: agg.smoothedVar, color: SMOOTHED_COLOR, stepRender: false },
        ],
      };
    case "fair":
      return {
        yAxisName: "Fair (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        lines: [
          { label: "Instant Fair", values: agg.totalFair, color: INSTANT_COLOR, stepRender: false },
          { label: "Smoothed Fair", values: agg.smoothedTotalFair, color: SMOOTHED_COLOR, stepRender: false },
        ],
      };
    case "marketCalc":
      return {
        yAxisName: "Market Calc (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        lines: [
          { label: "Instant Market (Calc)", values: agg.totalMarketFair, color: INSTANT_COLOR, stepRender: false },
          { label: "Smoothed Market (Calc)", values: agg.smoothedTotalMarketFair, color: SMOOTHED_COLOR, stepRender: false },
        ],
      };
    case "marketSource":
      return {
        yAxisName: "Market Source (vp)",
        yAxisFormatter: vpLabel,
        tooltipFormatter: vpLabel,
        lines: [
          { label: "Market (Source)", values: agg.marketVol, color: SMOOTHED_COLOR, stepRender: true },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// ECharts option builder
// ---------------------------------------------------------------------------

/**
 * Build a historical time-series option for the metric picked on the
 * Pipeline panel. Smoothable metrics overlay both instant and smoothed
 * variants as two simultaneous lines; ``marketSource`` renders as a
 * single step line. The legend is only shown when there's more than one
 * line, and its presence pushes the chart grid down to make room.
 */
export function buildPipelineSingleMetricOptions(
  data: PipelineTimeSeriesResponse,
  metric: Metric,
): EChartsOption {
  const timestamps = data.aggregated.timestamps;
  const spec = resolveMetricSpec(data, metric);
  const multiLine = spec.lines.length > 1;

  const series: EChartsOption["series"] = spec.lines.map((line) => ({
    name: line.label,
    type: "line",
    ...(line.stepRender ? { step: "end" as const } : {}),
    data: zipTimeSeries(timestamps, line.values),
    showSymbol: false,
    lineStyle: { width: 2, color: line.color },
    itemStyle: { color: line.color },
  }));

  return {
    backgroundColor: "transparent",
    animation: false,
    legend: {
      show: multiLine,
      top: 2,
      right: 16,
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 12,
      icon: "roundRect",
      textStyle: { color: "#6e6e82", fontSize: 10 },
    },
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
    grid: { left: 56, right: 16, top: multiLine ? 28 : 12, bottom: 48 },
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


