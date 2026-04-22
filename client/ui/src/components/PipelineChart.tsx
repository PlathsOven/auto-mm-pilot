import { useEffect, useMemo, useRef } from "react";
import type { EChartsType } from "echarts/types/dist/echarts";
import ReactECharts from "echarts-for-react";
import type { PipelineTimeSeriesResponse } from "../types";
import type { Metric, Smoothing } from "../utils";
import { buildPipelineSingleMetricOptions } from "./PipelineChart/chartOptions";

interface PipelineChartProps {
  data: PipelineTimeSeriesResponse | null;
  loading: boolean;
  error: string | null;
  metric: Metric;
  smoothing: Smoothing;
}

/**
 * Single-metric pipeline time-series chart — fills the Metric tab.
 *
 * Plots one line per (metric, smoothing) pair — the smoothing toggle on
 * the panel swaps instant ↔ smoothed, matching the Overview cell
 * semantics. ``marketSource`` renders a single step line regardless of
 * smoothing. Per-space stacked decomposition lives in the sibling
 * Contributions tab (``PipelineContributionsChart``).
 *
 * A `ResizeObserver` watches the wrapping div and calls `chart.resize()`
 * whenever the container dimensions change. ECharts only listens to
 * `window.resize` by default, so without this the canvas keeps the size
 * it had at first paint and lets the panel's right half go blank after
 * any layout shift.
 */
export function PipelineChart({ data, loading, error, metric, smoothing }: PipelineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const chartOption = useMemo(() => {
    if (!data) return null;
    return buildPipelineSingleMetricOptions(data, metric, smoothing);
  }, [data, metric, smoothing]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      {error ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-mm-error">
          {error}
        </div>
      ) : chartOption ? (
        <ReactECharts
          option={chartOption}
          notMerge
          lazyUpdate
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
          onChartReady={(inst) => { chartRef.current = inst; }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
          {loading
            ? <span className="animate-pulse">Loading pipeline data…</span>
            : "No pipeline data available"}
        </div>
      )}
    </div>
  );
}
