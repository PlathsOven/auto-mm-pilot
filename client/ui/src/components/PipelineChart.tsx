import { useEffect, useMemo, useRef } from "react";
import type { EChartsType } from "echarts/types/dist/echarts";
import ReactECharts from "echarts-for-react";
import type { PipelineTimeSeriesResponse } from "../types";
import type { Metric } from "../utils";
import { buildPipelineSingleMetricOptions } from "./PipelineChart/chartOptions";

interface PipelineChartProps {
  data: PipelineTimeSeriesResponse | null;
  loading: boolean;
  error: string | null;
  metric: Metric;
}

/**
 * Pipeline time-series chart — fills the Metric tab.
 *
 * Overlays both instant and smoothed variants as two simultaneous lines
 * for every smoothable metric (desired, edge, variance, fair, marketCalc).
 * ``marketSource`` is non-smoothable and renders a single step line.
 * Legend entries let the trader toggle either line off. Per-space stacked
 * decomposition lives in the sibling Contributions tab
 * (``PipelineContributionsChart``).
 *
 * A `ResizeObserver` watches the wrapping div and calls `chart.resize()`
 * whenever the container dimensions change. ECharts only listens to
 * `window.resize` by default, so without this the canvas keeps the size
 * it had at first paint and lets the panel's right half go blank after
 * any layout shift.
 */
export function PipelineChart({ data, loading, error, metric }: PipelineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const chartOption = useMemo(() => {
    if (!data) return null;
    return buildPipelineSingleMetricOptions(data, metric);
  }, [data, metric]);

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
