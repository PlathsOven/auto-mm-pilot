import { useCallback, useMemo, useState } from "react";
import { PipelineChart } from "../PipelineChart";
import { DecompositionPanel } from "../PipelineChart/DecompositionPanel";
import { Tabs, type TabItem } from "../ui/Tabs";
import { useFocus } from "../../providers/FocusProvider";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { usePipelineTimeSeries } from "../../hooks/usePipelineTimeSeries";
import { formatExpiry } from "../../utils";
import type { DecompositionMode } from "../PipelineChart/chartOptions";

const VIEW_TABS: TabItem<"chart" | "decomposition">[] = [
  { value: "chart", label: "Chart" },
  { value: "decomposition", label: "Decomposition" },
];

/**
 * Top-half right panel of the workbench main canvas.
 *
 * Hosts the pipeline time-series chart + decomposition panel, channelled to
 * the focused dimension. Cell / symbol / expiry focus picks the dimension
 * directly; with no focus, defaults to the first available dimension.
 *
 * A dimension `<select>` lets the trader manually switch — useful when no
 * focus is set or to compare across dimensions without losing the focus
 * elsewhere on the canvas. Tabs at the top toggle between the chart and a
 * vertical decomposition view (replaces the old Brain page sidebar).
 */
export function PipelineChartPanel() {
  const { focus, toggleFocus } = useFocus();
  const { payload } = useWebSocket();
  const [view, setView] = useState<"chart" | "decomposition">("chart");
  const [decompositionMode, setDecompositionMode] = useState<DecompositionMode>("variance");

  // Resolve a (symbol, expiry) to channel from current focus.
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

  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      setSelected({ symbol: sym, expiry: exp });
    },
    [setSelected],
  );

  const onBlockClick = useCallback(
    (blockName: string) => toggleFocus({ kind: "block", name: blockName }),
    [toggleFocus],
  );

  const selectedBlocks = useMemo<Set<string>>(() => {
    if (focus?.kind === "block") return new Set([focus.name]);
    return new Set();
  }, [focus]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-3 py-1.5">
        <h2 className="zone-header">Pipeline</h2>
        <Tabs items={VIEW_TABS} value={view} onChange={setView} variant="pill" size="sm" />
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
        {view === "chart" ? (
          <PipelineChart data={data} loading={loading} error={error} />
        ) : data ? (
          <div className="h-full overflow-y-auto">
            <DecompositionPanel
              blocks={data.currentDecomposition.blocks}
              aggregated={data.currentDecomposition.aggregated}
              aggregateMarketValue={data.currentDecomposition.aggregateMarketValue}
              mode={decompositionMode}
              onModeChange={setDecompositionMode}
              selectedBlocks={selectedBlocks}
              onBlockClick={onBlockClick}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-mm-text-dim">
            {loading ? <span className="animate-pulse">Loading…</span> : "No pipeline data"}
          </div>
        )}
      </div>
    </div>
  );
}
