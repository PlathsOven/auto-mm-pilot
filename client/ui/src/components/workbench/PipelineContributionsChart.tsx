import { useEffect, useMemo, useRef } from "react";
import type { EChartsType } from "echarts/types/dist/echarts";
import ReactECharts from "echarts-for-react";
import type { PipelineContributionsResponse } from "../../types";
import type { ContributionMetric } from "../../constants";
import { buildContributionsOptions } from "../PipelineChart/contributionsOptions";

interface PipelineContributionsChartProps {
  data: PipelineContributionsResponse | null;
  loading: boolean;
  error: string | null;
  metric: ContributionMetric;
}

/** Single-metric per-space stacked-area chart — one of Fair / Variance /
 *  Market in calc space (variance-linear). Shared x-axis spans ``now −
 *  lookback → expiry``; a dashed "now" line marks the seam between
 *  revealed history and forward projection.
 *
 *  ``ResizeObserver`` matches the sibling ``PipelineChart`` so the chart
 *  redraws when the parent panel resizes. */
export function PipelineContributionsChart({
  data,
  loading,
  error,
  metric,
}: PipelineContributionsChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const option = useMemo(
    () => (data ? buildContributionsOptions(data, metric) : null),
    [data, metric],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const empty = data !== null
    && (data.timestamps.length === 0 || Object.keys(data.perSpace).length === 0);

  return (
    <div ref={containerRef} className="h-full w-full">
      {error ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-mm-error">
          {error}
        </div>
      ) : option && !empty ? (
        <ReactECharts
          option={option}
          notMerge
          lazyUpdate
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
          onChartReady={(inst) => { chartRef.current = inst; }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
          {loading
            ? <span className="animate-pulse">Loading contributions…</span>
            : empty
              ? "No per-space contributions for this window"
              : "No contributions data available"}
        </div>
      )}
    </div>
  );
}
