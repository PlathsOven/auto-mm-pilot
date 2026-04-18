import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocus } from "../../../providers/FocusProvider";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { PipelineChart } from "../../PipelineChart";
import { DecompositionPanel } from "../../PipelineChart/DecompositionPanel";
import { usePipelineTimeSeries } from "../../../hooks/usePipelineTimeSeries";
import { formatExpiry } from "../../../utils";
import type { DecompositionMode } from "../../PipelineChart/chartOptions";

interface SymbolExpiryInspectorProps {
  symbol: string | null;
  expiry: string | null;
}

/**
 * Inspector view when the user focuses a symbol row, expiry column, or
 * combined dimension. Hosts the existing `<PipelineChart/>` and
 * `<DecompositionPanel/>` channelled to the focused dimension — replacing the
 * old standalone Brain page surface.
 *
 * If the focus only carries one axis (e.g. a row header → just `symbol`), we
 * pick the first matching dimension so the chart still has something concrete
 * to render. The user can pick a different one via the dropdown at top.
 */
export function SymbolExpiryInspector({ symbol, expiry }: SymbolExpiryInspectorProps) {
  const { clearFocus } = useFocus();
  const { payload } = useWebSocket();

  // Resolve the target (symbol, expiry) from whichever axes were focused.
  const initialDim = useMemo(() => {
    if (!payload) return null;
    const candidates = payload.positions.filter((p) => {
      const sMatch = symbol == null || p.symbol === symbol;
      const eMatch = expiry == null || p.expiry === expiry;
      return sMatch && eMatch;
    });
    if (candidates.length === 0) return null;
    return { symbol: candidates[0].symbol, expiry: candidates[0].expiry };
  }, [payload, symbol, expiry]);

  const { dimensions, selected, setSelected, data, error, loading } = usePipelineTimeSeries(initialDim);

  const [decompositionMode, setDecompositionMode] = useState<DecompositionMode>("variance");
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());

  // Reset block highlight whenever the dimension switches.
  useEffect(() => {
    setSelectedBlocks(new Set());
  }, [selected?.symbol, selected?.expiry]);

  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      setSelected({ symbol: sym, expiry: exp });
    },
    [setSelected],
  );

  const onBlockToggle = useCallback((blockName: string) => {
    setSelectedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockName)) next.delete(blockName);
      else next.add(blockName);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
            {symbol && expiry == null ? "Symbol" : expiry && symbol == null ? "Expiry" : "Dimension"}
          </span>
          <select
            className="rounded-md border border-black/[0.08] bg-mm-surface-solid px-2 py-1 text-[11px] text-mm-text focus:border-mm-accent/40 focus:outline-none"
            value={selected ? `${selected.symbol}|${selected.expiry}` : ""}
            onChange={handleDimChange}
          >
            {dimensions.map((d) => (
              <option key={`${d.symbol}|${d.expiry}`} value={`${d.symbol}|${d.expiry}`}>
                {d.symbol} — {formatExpiry(d.expiry)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={clearFocus}
          className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title="Clear focus (Esc)"
        >
          ✕
        </button>
      </header>

      {data ? (
        <DecompositionPanel
          blocks={data.currentDecomposition.blocks}
          aggregated={data.currentDecomposition.aggregated}
          aggregateMarketValue={data.currentDecomposition.aggregateMarketValue}
          mode={decompositionMode}
          onModeChange={setDecompositionMode}
          selectedBlocks={selectedBlocks}
          onBlockClick={onBlockToggle}
        />
      ) : (
        <div className="flex items-center justify-center py-6 text-[11px] text-mm-text-dim">
          {loading ? <span className="animate-pulse">Loading decomposition…</span> : "No decomposition data"}
        </div>
      )}

      <div className="min-h-[260px] flex-1 overflow-hidden rounded-md border border-black/[0.06] bg-white/40">
        <PipelineChart data={data} loading={loading} error={error} />
      </div>
    </div>
  );
}
