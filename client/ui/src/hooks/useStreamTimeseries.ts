/**
 * Polling + colour-stability + hide-toggle state for a stream's time series.
 *
 * Extracted so StreamInspector and OpinionInspector can share the chart's
 * per-key colour map without each owning its own polling loop. OpinionInspector
 * uses the returned state to render a combined per-dim table (color + toggle
 * merged with the pipeline's fair / variance values); StreamInspector renders
 * the default chart + KeyList pair.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { fetchStreamTimeseries } from "../services/streamTimeseriesApi";
import type { StreamTimeseriesResponse, StreamKeyTimeseries } from "../types";
import { POLL_INTERVAL_TIMESERIES_MS } from "../constants";
import { BLOCK_COLORS, TOOLTIP_STYLE } from "../components/PipelineChart/chartOptions";
import {
  formatTooltipDate,
  makeTimeAxisFormatter,
  parseIsoUtc,
  sci,
} from "../components/PipelineChart/formatters";

export interface StreamTimeseriesState {
  data: StreamTimeseriesResponse | null;
  loading: boolean;
  error: string | null;
  hiddenKeys: Set<string>;
  colorByKey: Map<string, string>;
  chartOption: EChartsOption | null;
  visibleSeries: StreamKeyTimeseries[];
  toggleKey: (id: string) => void;
  keyId: (key: Record<string, string>) => string;
  formatKey: (key: Record<string, string>) => string;
}

export function useStreamTimeseries(streamName: string): StreamTimeseriesState {
  const [data, setData] = useState<StreamTimeseriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Hidden key set is client-only, keyed by JSON-stringified key spec so it
  // survives the next poll's response identity churn but resets on stream
  // change (component remount via focus switch).
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();

    const load = () => {
      fetchStreamTimeseries(streamName, controller.signal)
        .then((res) => {
          if (aborted) return;
          setData(res);
          setError(null);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (aborted) return;
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    };

    setData(null);
    setLoading(true);
    setError(null);
    setHiddenKeys(new Set());
    load();
    const interval = setInterval(load, POLL_INTERVAL_TIMESERIES_MS);
    return () => {
      aborted = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [streamName]);

  // Stable colour per key, assigned in the order the server returned keys
  // on the first non-empty response. Keeps a given series the same colour
  // across poll refreshes and across hide/show toggles.
  const colorByKey = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    data.series.forEach((s, i) => {
      map.set(keyId(s.key), BLOCK_COLORS[i % BLOCK_COLORS.length]);
    });
    return map;
  }, [data]);

  const visibleSeries = useMemo(() => {
    if (!data) return [];
    return data.series.filter((s) => !hiddenKeys.has(keyId(s.key)));
  }, [data, hiddenKeys]);

  const chartOption = useMemo<EChartsOption | null>(() => {
    if (visibleSeries.length === 0) return null;
    return buildChartOption(visibleSeries, colorByKey);
  }, [visibleSeries, colorByKey]);

  const toggleKey = useCallback((id: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    data,
    loading,
    error,
    hiddenKeys,
    colorByKey,
    chartOption,
    visibleSeries,
    toggleKey,
    keyId,
    formatKey,
  };
}

function keyId(key: Record<string, string>): string {
  return JSON.stringify(key);
}

function formatKey(key: Record<string, string>): string {
  const parts = Object.values(key).filter(Boolean);
  return parts.length ? parts.join(" · ") : "all";
}

function buildChartOption(
  series: StreamKeyTimeseries[],
  colorByKey: Map<string, string>,
): EChartsOption {
  // Time axis (not category) so tick spacing is chronological — a 20-minute
  // gap between pushes renders as a real 20-minute gap, matching the
  // Pipeline chart. Safe here because this chart doesn't stack, so the
  // ECharts-stack-on-time lesson in tasks/lessons.md doesn't apply.
  const allTimestamps: string[] = [];
  const seriesSpecs: EChartsOption["series"] = [];
  series.forEach((s) => {
    const color = colorByKey.get(keyId(s.key)) ?? BLOCK_COLORS[0];
    const data: [number, number][] = [];
    for (const p of s.points) {
      const d = parseIsoUtc(p.timestamp);
      if (!d) continue;
      data.push([d.getTime(), p.raw_value]);
      allTimestamps.push(p.timestamp);
    }
    // Markers only on sparse series — a one-point series has nothing to
    // connect and would render invisibly with showSymbol:false, but with
    // heartbeat-dense data (one point every 2s) dots overwhelm the line.
    // `<=2` keeps the symbol for the single-point "just activated" state
    // and drops it the moment the heartbeat has produced a real line.
    const sparse = data.length <= 2;
    seriesSpecs.push({
      name: formatKey(s.key),
      type: "line",
      data,
      showSymbol: sparse,
      symbolSize: 4,
      lineStyle: { width: 1.5, color },
      itemStyle: { color },
      connectNulls: true,
    });
  });
  const axisFormatter = makeTimeAxisFormatter(allTimestamps.sort());

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      ...TOOLTIP_STYLE,
      confine: true,
      formatter: (paramsRaw) => {
        const params = Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw];
        if (params.length === 0) return "";
        const first = params[0].value;
        const header = Array.isArray(first) && typeof first[0] === "number"
          ? formatTooltipDate(new Date(first[0]))
          : String(params[0].name ?? "");
        const rows = params
          .map((p) => {
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
    grid: { left: 56, right: 16, top: 12, bottom: 48 },
    xAxis: {
      type: "time",
      axisLabel: {
        color: "#6e6e82",
        fontSize: 9,
        hideOverlap: true,
        lineHeight: 11,
        formatter: axisFormatter,
      },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      axisTick: { lineStyle: { color: "rgba(0,0,0,0.08)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      // `scale: true` disables ECharts' default "include zero" behaviour,
      // so tight clusters (e.g. rolling realized-vol in [0.40, 0.45]) fill
      // the plot area instead of squashing against one edge. Matches the
      // Pipeline chart's y-axis.
      scale: true,
      axisLabel: { color: "#6e6e82", fontSize: 10, formatter: (v: number) => sci(v) },
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.04)" } },
      axisLine: { show: false },
    },
    series: seriesSpecs,
  };
}
