import { useCallback, useMemo } from "react";
import type { ECElementEvent } from "echarts/types/dist/echarts";
import ReactECharts from "echarts-for-react";
import { useFocus } from "../providers/FocusProvider";
import type { PipelineTimeSeriesResponse } from "../types";
import {
  buildPipelineChartOptions,
  RAW_COLOR,
  SMOOTHED_COLOR,
  MARKET_FAIR_COLOR,
} from "./PipelineChart/chartOptions";

interface PipelineChartProps {
  data: PipelineTimeSeriesResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Pipeline time-series chart — three stacked grids (position, fair, variance)
 * sharing an x-axis. Pure presentation: data flows in from the parent
 * inspector, block focus comes from `FocusProvider`. Series-click toggles
 * block focus so the DecompositionPanel + chart stay sync'd via a single
 * source of truth.
 *
 * Block colors come from the shared `BLOCK_COLORS` palette in `chartOptions`,
 * so each stacked area corresponds 1:1 to a bar in the DecompositionPanel.
 */
export function PipelineChart({ data, loading, error }: PipelineChartProps) {
  const { focus, toggleFocus } = useFocus();

  // Highlight the focused block in the stacked-area legend, when one is set.
  const selectedBlocks = useMemo<Set<string>>(() => {
    if (focus?.kind === "block") return new Set([focus.name]);
    return new Set();
  }, [focus]);

  // Build ECharts options from the data fed in by the parent inspector.
  const chartOption = useMemo(() => {
    if (!data) return null;
    return buildPipelineChartOptions(data, selectedBlocks);
  }, [data, selectedBlocks]);

  // Chart click → focus a block by parsing series name back to its block id.
  const handleChartClick = useCallback((params: ECElementEvent) => {
    const seriesName: string = params.seriesName ?? "";
    const match = seriesName.match(/^(.+?)\s*\((fair|var)\)$/);
    if (match) {
      toggleFocus({ kind: "block", name: match[1] });
    }
  }, [toggleFocus]);

  const chartEvents = useMemo(() => ({ click: handleChartClick }), [handleChartClick]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-2">
        <span className="zone-header">Pipeline</span>
        <div className="flex items-center gap-4">
          <OverlayLegend />
          {loading && (
            <span className="animate-pulse text-[10px] text-mm-text-dim">Loading…</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
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
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
            {loading
              ? <span className="animate-pulse">Loading pipeline data…</span>
              : "No pipeline data available"}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline legend for the three non-block aggregate overlays. The block-by-block
 * legend lives in the DecompositionPanel above the chart — same colours, same
 * names, with the additional bonus of being clickable for selection.
 */
function OverlayLegend() {
  const items = [
    { label: "Smoothed", color: SMOOTHED_COLOR, dash: false },
    { label: "Raw", color: RAW_COLOR, dash: false },
    { label: "Market Fair", color: MARKET_FAIR_COLOR, dash: true },
  ];
  return (
    <div className="flex items-center gap-3 text-[10px] text-mm-text-dim">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-[2px] w-4 rounded-full"
            style={{
              backgroundColor: it.color,
              backgroundImage: it.dash
                ? `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)`
                : undefined,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
