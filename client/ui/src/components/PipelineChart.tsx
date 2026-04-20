import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ECElementEvent, EChartsType } from "echarts/types/dist/echarts";
import ReactECharts from "echarts-for-react";
import { useFocus } from "../providers/FocusProvider";
import type { PipelineTimeSeriesResponse } from "../types";
import {
  blockSeriesIdOf,
  buildPipelineSingleViewOptions,
  parseBlockSeriesId,
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

  // Compute the set of selected block-series keys for the *currently charted*
  // dimension. If the focused block belongs to a different (symbol, expiry),
  // the chart renders without a highlight — its series don't represent that
  // block. Series IDs are composite so name collisions across streams on the
  // same dim stay distinguishable.
  const selectedBlocks = useMemo<Set<string>>(() => {
    if (!data || focus?.kind !== "block") return new Set();
    const k = focus.key;
    if (k.symbol !== data.symbol || k.expiry !== data.expiry) return new Set();
    return new Set([blockSeriesIdOf(k.blockName, k.streamName, k.startTimestamp)]);
  }, [data, focus]);

  const chartOption = useMemo(() => {
    if (!data) return null;
    return buildPipelineSingleViewOptions(data, view, selectedBlocks);
  }, [data, view, selectedBlocks]);

  const handleChartClick = useCallback(
    (params: ECElementEvent) => {
      if (!data) return;
      const seriesId = String(params.seriesId ?? "");
      // Series IDs on block series are `<blockName>|<streamName>|<startTs>|<kind>`.
      const parsed = parseBlockSeriesId(seriesId);
      if (!parsed) return;
      toggleFocus({
        kind: "block",
        key: {
          blockName: parsed.blockName,
          streamName: parsed.streamName,
          symbol: data.symbol,
          expiry: data.expiry,
          startTimestamp: parsed.startTimestamp,
        },
      });
    },
    [data, toggleFocus],
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
