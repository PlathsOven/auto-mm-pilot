import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ECElementEvent, EChartsType } from "echarts/types/dist/echarts";
import ReactECharts from "echarts-for-react";
import { useFocus } from "../providers/FocusProvider";
import type { PipelineTimeSeriesResponse } from "../types";
import {
  buildPipelineSingleViewOptions,
  type PipelineView,
} from "./PipelineChart/chartOptions";

interface PipelineChartProps {
  data: PipelineTimeSeriesResponse | null;
  loading: boolean;
  error: string | null;
  view: PipelineView;
}

/**
 * Single-view pipeline time-series chart — fills the panel.
 *
 * Replaces the older three-grid stacked layout with one focused chart
 * (Position / Fair / Variance) selected by the parent. The single-view
 * model gives the trader real y-axis resolution at typical panel heights;
 * the three-grid layout was both crowded and didn't auto-resize when its
 * container changed size (the visible bug behind the "chart doesn't fill
 * the panel" report).
 *
 * A `ResizeObserver` watches the wrapping div and calls
 * `chart.resize()` whenever the container dimensions change. ECharts only
 * listens to `window.resize` by default, so without this the canvas keeps
 * the size it had at first paint and lets the panel's right half go blank
 * after any layout shift.
 */
export function PipelineChart({ data, loading, error, view }: PipelineChartProps) {
  const { focus, toggleFocus } = useFocus();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const selectedBlocks = useMemo<Set<string>>(() => {
    if (focus?.kind === "block") return new Set([focus.name]);
    return new Set();
  }, [focus]);

  const chartOption = useMemo(() => {
    if (!data) return null;
    return buildPipelineSingleViewOptions(data, view, selectedBlocks);
  }, [data, view, selectedBlocks]);

  const handleChartClick = useCallback(
    (params: ECElementEvent) => {
      const seriesName: string = params.seriesName ?? "";
      const match = seriesName.match(/^(.+?)\s*\((fair|var)\)$/);
      if (match) {
        toggleFocus({ kind: "block", name: match[1] });
      }
    },
    [toggleFocus],
  );

  const chartEvents = useMemo(() => ({ click: handleChartClick }), [handleChartClick]);

  // ResizeObserver — keep the chart canvas glued to the container size.
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
          onEvents={chartEvents}
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
