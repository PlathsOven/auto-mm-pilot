import { useCallback, useEffect, useMemo, useState } from "react";
import { PipelineChart } from "../PipelineChart";
import { Tabs, type TabItem } from "../ui/Tabs";
import { useFocus } from "../../providers/FocusProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { usePipelineTimeSeries } from "../../hooks/usePipelineTimeSeries";
import { formatExpiry } from "../../utils";
import type { PipelineView } from "../PipelineChart/chartOptions";
import type { ViewMode } from "../grid-config";

const VIEW_TABS: TabItem<PipelineView>[] = [
  { value: "position", label: "Position" },
  { value: "fair", label: "Fair" },
  { value: "variance", label: "Variance" },
];

const PIPELINE_LINK_KEY = "posit-pipeline-linked";

/** Map a position-grid view mode to the matching pipeline view. Several grid
 *  modes resolve to the same pipeline view (smoothed/raw position both →
 *  position; edge / fair / market-fair → fair). */
function gridToPipelineView(grid: ViewMode): PipelineView {
  switch (grid) {
    case "position":
    case "rawPosition":
    case "change":
      return "position";
    case "edge":
    case "smoothedEdge":
    case "totalFair":
    case "totalMarketFair":
      return "fair";
    case "variance":
    case "smoothedVar":
      return "variance";
  }
}

interface PipelineChartPanelProps {
  /** The position grid's current view mode — pipeline mirrors it when "Linked"
   *  is on (default). */
  gridViewMode: ViewMode;
}

/**
 * Pipeline chart panel — single-view tabs (Position / Fair / Variance)
 * channelled to the focused dimension.
 *
 * "Linked" toggle (default on, persisted) makes the pipeline view follow the
 * position grid's active view-mode, so flipping tabs in the grid above
 * automatically swaps the chart below. Switch to manual when comparing two
 * different views (e.g. position grid showing change while inspecting
 * variance below).
 */
export function PipelineChartPanel({ gridViewMode }: PipelineChartPanelProps) {
  const { focus } = useFocus();
  const { payload } = useWebSocket();

  const [linked, setLinked] = useState<boolean>(() => {
    try { return localStorage.getItem(PIPELINE_LINK_KEY) !== "false"; } catch { return true; }
  });
  const [localView, setLocalView] = useState<PipelineView>("position");

  const persistLinked = useCallback((next: boolean) => {
    setLinked(next);
    try { localStorage.setItem(PIPELINE_LINK_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  // When linked, mirror the grid's view. When not linked, the user picks.
  const effectiveView: PipelineView = linked ? gridToPipelineView(gridViewMode) : localView;

  // Resolve a (symbol, expiry) to channel from the current focus.
  const focusDimension = useMemo(() => {
    if (!focus || !payload) return null;
    if (focus.kind === "cell") return { symbol: focus.symbol, expiry: focus.expiry };
    if (focus.kind === "symbol") {
      const m = payload.positions.find((p) => p.symbol === focus.symbol);
      return m ? { symbol: m.symbol, expiry: m.expiry } : null;
    }
    if (focus.kind === "expiry") {
      const m = payload.positions.find((p) => p.expiry === focus.expiry);
      return m ? { symbol: m.symbol, expiry: m.expiry } : null;
    }
    return null;
  }, [focus, payload]);

  const { dimensions, selected, setSelected, data, error, loading } = usePipelineTimeSeries(focusDimension);

  // Keep localView in sync the first time the user disables linking, so the
  // pipeline doesn't visually jump.
  useEffect(() => {
    if (linked) setLocalView(gridToPipelineView(gridViewMode));
  }, [linked, gridViewMode]);

  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      setSelected({ symbol: sym, expiry: exp });
    },
    [setSelected],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/[0.06] px-3 py-1.5">
        <h2 className="zone-header">Pipeline</h2>
        <Tabs
          items={VIEW_TABS}
          value={effectiveView}
          onChange={(v) => {
            setLocalView(v);
            // Manual change implies the user wants to override the grid.
            // Disable linking so subsequent grid changes don't fight back.
            if (linked) persistLinked(false);
          }}
          variant="pill"
          size="sm"
        />
        <label
          className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
            linked
              ? "border-mm-accent/30 bg-mm-accent-soft text-mm-accent"
              : "border-black/[0.08] text-mm-text-dim hover:bg-black/[0.04]"
          }`}
          title="When on, pipeline view mirrors the position grid view"
        >
          <input
            type="checkbox"
            checked={linked}
            onChange={(e) => persistLinked(e.target.checked)}
            className="accent-mm-accent"
          />
          <span>Link grid</span>
        </label>
        <select
          className="ml-auto rounded-md border border-black/[0.08] bg-white/70 px-2 py-0.5 text-[10px] text-mm-text focus:border-mm-accent/40 focus:outline-none"
          value={selected ? `${selected.symbol}|${selected.expiry}` : ""}
          onChange={handleDimChange}
          title="Dimension to chart (auto-channels from focus)"
        >
          {dimensions.map((d) => (
            <option key={`${d.symbol}|${d.expiry}`} value={`${d.symbol}|${d.expiry}`}>
              {d.symbol} — {formatExpiry(d.expiry)}
            </option>
          ))}
        </select>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <PipelineChart data={data} loading={loading} error={error} view={effectiveView} />
      </div>
    </div>
  );
}
