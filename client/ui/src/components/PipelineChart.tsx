import { useState, useCallback, useMemo, useRef } from "react";
import type { ECElementEvent } from "echarts/types/dist/echarts";
import ReactECharts from "echarts-for-react";
import { formatExpiry } from "../utils";
import { useSelection } from "../providers/SelectionProvider";
import {
  SIDEBAR_DEFAULT_WIDTH_PX,
  SIDEBAR_MIN_WIDTH_PX,
  SIDEBAR_MAX_WIDTH_PX,
} from "../constants";
import { usePipelineTimeSeries } from "../hooks/usePipelineTimeSeries";
import { DecompositionSidebar } from "./PipelineChart/DecompositionSidebar";
import { buildPipelineChartOptions, type DecompositionMode } from "./PipelineChart/chartOptions";

export function PipelineChart() {
  const { selectBlock, selectedBlocks, selectedDimension } = useSelection();
  const { dimensions, selected, setSelected, data, error, loading } =
    usePipelineTimeSeries(selectedDimension);

  const [decompositionMode, setDecompositionMode] = useState<DecompositionMode>("variance");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH_PX);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Sidebar resize drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const next = Math.max(SIDEBAR_MIN_WIDTH_PX, Math.min(SIDEBAR_MAX_WIDTH_PX, dragRef.current.startW + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      setSelected({ symbol: sym, expiry: exp });
    },
    [setSelected],
  );

  // Build ECharts options
  const chartOption = useMemo(() => {
    if (!data) return null;
    return buildPipelineChartOptions(data, selectedBlocks);
  }, [data, selectedBlocks]);

  // Chart click → select block
  const handleChartClick = useCallback((params: ECElementEvent) => {
    const seriesName: string = params.seriesName ?? "";
    const match = seriesName.match(/^(.+?)\s*\((fair|var)\)$/);
    if (match && selected) {
      selectBlock(match[1], selected.symbol, selected.expiry);
    }
  }, [selected, selectBlock]);

  const chartEvents = useMemo(() => ({ click: handleChartClick }), [handleChartClick]);

  // Empty / loading states
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-mm-error">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Selector bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] bg-black/[0.04] px-3 py-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Instrument
        </label>
        <select
          className="rounded-md border border-black/[0.06] bg-mm-surface-solid px-2 py-0.5 text-[11px] text-mm-text focus:border-mm-accent/40 focus:outline-none"
          value={selected ? `${selected.symbol}|${selected.expiry}` : ""}
          onChange={handleDimChange}
        >
          {dimensions.map((d) => (
            <option key={`${d.symbol}|${d.expiry}`} value={`${d.symbol}|${d.expiry}`}>
              {d.symbol} — {formatExpiry(d.expiry)}
            </option>
          ))}
        </select>
        {loading && (
          <span className="text-[10px] text-mm-text-dim animate-pulse">Loading…</span>
        )}
      </div>

      {/* Main content: decomposition sidebar (left) + charts */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Decomposition sidebar — left (aligned with "now") */}
        {data && (
          <>
            <div
              className="shrink-0 border-r border-black/[0.06] bg-black/[0.03]"
              style={{ width: sidebarWidth }}
            >
              <DecompositionSidebar
                blocks={data.currentDecomposition.blocks}
                aggregated={data.currentDecomposition.aggregated}
                mode={decompositionMode}
                onModeChange={setDecompositionMode}
                selectedBlocks={selectedBlocks}
                onBlockClick={(blockName) => selected && selectBlock(blockName, selected.symbol, selected.expiry)}
              />
            </div>
            {/* Drag handle */}
            <div
              onMouseDown={onDragStart}
              className="group relative w-1 shrink-0 cursor-col-resize select-none"
            >
              <div className="absolute inset-y-0 -left-0.5 w-2 transition-colors group-hover:bg-mm-accent/20 group-active:bg-mm-accent/30" />
            </div>
          </>
        )}

        {/* Charts */}
        <div className="min-w-0 flex-1">
          {chartOption ? (
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
                : dimensions.length === 0
                  ? "No pipeline data available"
                  : "Select an instrument"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
