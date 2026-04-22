import type { EChartsOption } from "echarts";
import type { PipelineContributionsResponse } from "../../types";
import {
  CONTRIBUTION_METRIC_META,
  type ContributionMetric,
} from "../../constants";
import {
  formatTooltipDate,
  makeTimeAxisFormatter,
  parseIsoUtc,
  sci,
} from "./formatters";
import { BLOCK_COLORS, TOOLTIP_STYLE } from "./chartOptions";

// Left margin (px) — enough to hold "6.000e-6" style tick labels without
// clipping. Narrower than the three-pane chart because there's only one
// y-axis here.
const GRID_LEFT_PX = 72;

/** Zip ISO timestamps with values into ``[epoch_ms, y]`` tuples. Samples
 *  whose timestamp fails to parse are dropped so the series stays
 *  monotonic in time (required by ECharts' stack calculator). */
function zipTimePairs(
  timestamps: string[],
  values: number[],
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const d = parseIsoUtc(timestamps[i]);
    if (!d) continue;
    out.push([d.getTime(), values[i] ?? 0]);
  }
  return out;
}

/** Build a single-metric stacked-area option for the Contributions tabs.
 *
 *  Renders per-space calc-space (variance-linear) contributions to the
 *  selected metric (``fair`` / ``var`` / ``market``) as stacked areas on
 *  a **true time axis** (``xAxis.type: "time"``), so historical ring-buffer
 *  points sit at their wall-clock positions and the forward 1-min grid
 *  visibly separates across the ``now`` markLine.
 *
 *  Uses ECharts' native ``stack:`` feature. The earlier lesson in
 *  ``tasks/lessons.md`` about stack+time crashing was specifically about
 *  nullable series — our values are always numbers (zero-defaulted for
 *  missing space_ids at a timestamp), so the stacker has no nulls to
 *  trip on and translucent fills render cleanly layered. */
export function buildContributionsOptions(
  data: PipelineContributionsResponse,
  metric: ContributionMetric,
): EChartsOption {
  const { timestamps, perSpace, currentTs } = data;
  const spaceIds = Object.keys(perSpace).sort();
  const tickFormatter = makeTimeAxisFormatter(timestamps);
  const currentTsMs = currentTs ? parseIsoUtc(currentTs)?.getTime() ?? null : null;
  const meta = CONTRIBUTION_METRIC_META[metric];

  const spaceColor = (i: number): string => BLOCK_COLORS[i % BLOCK_COLORS.length];

  const seriesSpecs: NonNullable<EChartsOption["series"]> = spaceIds.map(
    (spaceId, i) => ({
      name: spaceId,
      type: "line",
      stack: "contrib",
      areaStyle: { opacity: 0.45 },
      data: zipTimePairs(timestamps, perSpace[spaceId][meta.field]),
      showSymbol: false,
      lineStyle: { width: 1.2, color: spaceColor(i) },
      itemStyle: { color: spaceColor(i) },
    }),
  );

  // Invisible carrier for the "now" markLine so it stays visible when every
  // legend item is toggled off. Attached at the end of the series array.
  if (currentTsMs !== null) {
    seriesSpecs.push({
      name: "__now",
      type: "line",
      data: [],
      silent: true,
      tooltip: { show: false },
      markLine: {
        silent: true,
        symbol: "none",
        label: {
          formatter: "now",
          color: "#4f5bd5",
          fontSize: 10,
          position: "insideEndTop",
        },
        lineStyle: { color: "#4f5bd5", width: 1, type: "dashed", opacity: 0.8 },
        data: [{ xAxis: currentTsMs }],
      },
    });
  }

  return {
    backgroundColor: "transparent",
    animation: false,
    legend: {
      top: 0,
      right: 8,
      type: "scroll",
      data: spaceIds,
      textStyle: { color: "#6e6e82", fontSize: 10 },
      itemWidth: 10,
      itemHeight: 2,
    },
    tooltip: {
      trigger: "axis",
      ...TOOLTIP_STYLE,
      confine: true,
      formatter: (paramsRaw) => {
        const params = Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw];
        if (params.length === 0) return "";
        const firstValue = params[0].value;
        const headerMs = Array.isArray(firstValue) && typeof firstValue[0] === "number"
          ? firstValue[0]
          : null;
        const header = headerMs !== null
          ? formatTooltipDate(new Date(headerMs))
          : String(params[0].name ?? "");
        let total = 0;
        const rows = params
          .filter((p) => typeof p.seriesName === "string" && p.seriesName !== "__now")
          .map((p) => {
            // With ``stack:``, ``p.value`` is the raw (unstacked) pair
            // ``[epoch_ms, y]`` — y is the per-space contribution, not
            // the cumulative sum. ECharts also exposes the stacked
            // position via internals but the raw value is what we want.
            const raw = Array.isArray(p.value) && typeof p.value[1] === "number"
              ? p.value[1]
              : 0;
            total += raw;
            return `<div style="display:flex;justify-content:space-between;gap:16px;">`
              + `<span>${p.marker} ${p.seriesName}</span>`
              + `<span style="font-family:monospace;">${sci(raw)}</span></div>`;
          })
          .join("");
        const totalRow =
          `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px;padding-top:3px;border-top:1px solid rgba(0,0,0,0.08);font-weight:600;">`
          + `<span>${meta.label} total</span>`
          + `<span style="font-family:monospace;">${sci(total)}</span></div>`;
        return `<div style="font-weight:600;margin-bottom:4px;">${header}</div>${rows}${totalRow}`;
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
    grid: { left: GRID_LEFT_PX, right: 16, top: 28, bottom: 48 },
    xAxis: {
      type: "time",
      axisLabel: {
        color: "#6e6e82",
        fontSize: 9,
        hideOverlap: true,
        lineHeight: 11,
        formatter: (value: number) => tickFormatter(value),
      },
      axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: meta.label,
      scale: true,
      nameTextStyle: { color: "#6e6e82", fontSize: 10, padding: [0, 0, 0, -10] },
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: (v: number) => sci(v) },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series: seriesSpecs,
  };
}
