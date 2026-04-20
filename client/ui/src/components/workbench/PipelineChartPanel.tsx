import { useCallback, useEffect, useMemo, useState } from "react";
import { PipelineChart } from "../PipelineChart";
import { Tabs, type TabItem } from "../ui/Tabs";
import { useFocus } from "../../providers/FocusProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { usePipelineTimeSeries } from "../../hooks/usePipelineTimeSeries";
import { formatExpiry } from "../../utils";
import type { PipelineView } from "../PipelineChart/chartOptions";
import type { ViewMode } from "../../types";
import {
  POSITION_LOOKBACK_OPTIONS,
  DEFAULT_POSITION_LOOKBACK_LABEL,
  POSITION_LOOKBACK_KEY,
  PIPELINE_LINK_KEY,
} from "../../constants";

const VIEW_TABS: TabItem<PipelineView>[] = [
  { value: "position", label: "Desired" },
  { value: "fair", label: "Fair" },
  { value: "variance", label: "Variance" },
  { value: "market", label: "Market" },
];

/** Map a position-grid view mode to the matching pipeline view. Several grid
 *  modes resolve to the same pipeline view (smoothed/raw position both →
 *  position; edge / fair → fair; market / market-fair → market). */
function gridToPipelineView(grid: ViewMode): PipelineView {
  switch (grid) {
    case "position":
    case "rawPosition":
    case "change":
      return "position";
    case "edge":
    case "smoothedEdge":
    case "fair":
    case "totalFair":
      return "fair";
    case "market":
    case "totalMarketFair":
      return "market";
    case "variance":
    case "smoothedVar":
      return "variance";
  }
}

/** Canonical grid-view choice for each pipeline view, used when the user
 *  changes the pipeline tab while linked is on (the change should propagate
 *  back to the grid). Mapping is intentionally lossy — pipeline "fair" maps
 *  to "edge" because that's the tab traders look at most often. */
function pipelineToGridView(view: PipelineView): ViewMode {
  switch (view) {
    case "position": return "position";
    case "fair": return "edge";
    case "variance": return "variance";
    case "market": return "market";
  }
}

interface PipelineChartPanelProps {
  /** The position grid's current view mode — pipeline mirrors it when "Linked"
   *  is on (default). */
  gridViewMode: ViewMode;
  /** Setter so the pipeline can push its tab choice back to the grid (when
   *  linked is on, the sync is bidirectional). */
  onGridViewModeChange: (mode: ViewMode) => void;
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
export function PipelineChartPanel({ gridViewMode, onGridViewModeChange }: PipelineChartPanelProps) {
  const { focus } = useFocus();
  const { payload } = useWebSocket();

  const [linked, setLinked] = useState<boolean>(() => {
    try { return localStorage.getItem(PIPELINE_LINK_KEY) !== "false"; } catch { return true; }
  });
  const [localView, setLocalView] = useState<PipelineView>("position");
  const [lookbackLabel, setLookbackLabel] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(POSITION_LOOKBACK_KEY);
      if (saved && POSITION_LOOKBACK_OPTIONS.some((o) => o.label === saved)) return saved;
    } catch { /* ignore */ }
    return DEFAULT_POSITION_LOOKBACK_LABEL;
  });

  const persistLookback = useCallback((next: string) => {
    setLookbackLabel(next);
    try { localStorage.setItem(POSITION_LOOKBACK_KEY, next); } catch { /* ignore */ }
  }, []);

  const lookbackTabs = useMemo<TabItem<string>[]>(
    () => POSITION_LOOKBACK_OPTIONS.map((o) => ({ value: o.label, label: o.label })),
    [],
  );

  const persistLinked = useCallback((next: boolean) => {
    setLinked(next);
    try { localStorage.setItem(PIPELINE_LINK_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  // When linked, mirror the grid's view. When not linked, the user picks.
  const effectiveView: PipelineView = linked ? gridToPipelineView(gridViewMode) : localView;

  // Resolve a (symbol, expiry) to channel from the current focus. Block
  // focus carries its full composite key, so we can route the chart to the
  // block's dimension and then highlight the specific series — otherwise
  // the highlight would silently drop when the block's dim doesn't match
  // whatever was last charted.
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
    if (focus.kind === "block") return { symbol: focus.key.symbol, expiry: focus.key.expiry };
    return null;
  }, [focus, payload]);

  // Only send a lookback param in Position view — Fair/Variance are
  // forward-looking decay curves, not historical series.
  const lookbackSeconds = useMemo<number | null>(() => {
    if (effectiveView !== "position") return null;
    const opt = POSITION_LOOKBACK_OPTIONS.find((o) => o.label === lookbackLabel);
    return opt?.seconds ?? null;
  }, [effectiveView, lookbackLabel]);

  const { dimensions, selected, setSelected, data, error, loading } = usePipelineTimeSeries(
    focusDimension,
    lookbackSeconds,
  );

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
    <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/[0.06] px-3 py-1.5">
        <h2 className="zone-header">Pipeline</h2>
        <Tabs
          items={VIEW_TABS}
          value={effectiveView}
          onChange={(v) => {
            setLocalView(v);
            // When linked, propagate the new pipeline view back to the grid
            // so the two stay in sync (bidirectional). When unlinked, just
            // update the local pipeline state and leave the grid alone.
            if (linked) {
              onGridViewModeChange(pipelineToGridView(v));
            }
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
        {effectiveView === "position" && (
          <Tabs
            items={lookbackTabs}
            value={lookbackLabel}
            onChange={persistLookback}
            variant="pill"
            size="sm"
          />
        )}
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
