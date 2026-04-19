import { useCallback, useMemo } from "react";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { useFocus } from "../../../providers/FocusProvider";
import { useStreamContributions } from "../../../hooks/useStreamContributions";
import { valColor } from "../../../utils";

interface CellInspectorProps {
  symbol: string;
  expiry: string;
}

const TOP_BLOCKS_LIMIT = 12;

/**
 * Inspector view for a focused (symbol, expiry) cell.
 *
 * The pipeline chart for this dimension lives on the main canvas (it's
 * channelled to focus from there); the inspector stays lean — just the
 * scalars and the per-block edge attribution list. Chat lives in its own
 * dock — open it explicitly with `⌘/` if you want to discuss the cell.
 */
export function CellInspector({ symbol, expiry }: CellInspectorProps) {
  const { payload } = useWebSocket();
  const { clearFocus, toggleFocus } = useFocus();

  const position = useMemo(
    () => payload?.positions.find((p) => p.symbol === symbol && p.expiry === expiry) ?? null,
    [payload, symbol, expiry],
  );

  const { contributions, loading, error } = useStreamContributions({ symbol, expiry });

  const onBlockClick = useCallback(
    (blockName: string) => toggleFocus({ kind: "block", name: blockName }),
    [toggleFocus],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-black/[0.06] px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">Cell</span>
          <span className="text-[13px] font-semibold text-mm-text">
            {symbol} <span className="text-mm-text-dim">·</span> {expiry}
          </span>
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

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {position == null ? (
          <p className="text-[11px] text-mm-text-dim">No live position for this cell yet.</p>
        ) : (
          <section className="grid grid-cols-2 gap-1.5">
            <Stat label="Desired Pos" value={position.desiredPos} unit="$vega" decimals={2} />
            <Stat label="Raw Desired" value={position.rawDesiredPos} unit="$vega" decimals={2} />
            <Stat label="Edge" value={position.edgeVol} unit="vp" decimals={2} />
            <Stat label="Variance" value={position.varianceVol} unit="vp" decimals={2} />
            <Stat label="Total Fair" value={position.totalFairVol} unit="vp" decimals={2} />
            <Stat label="Market Fair" value={position.totalMarketFairVol} unit="vp" decimals={2} />
          </section>
        )}

        <section className="flex flex-col gap-1.5 border-t border-black/[0.05] pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
              Contributing blocks
            </span>
            {loading && <span className="animate-pulse text-[9px] text-mm-text-dim">loading…</span>}
          </div>
          {error && <p className="text-[10px] text-mm-error">{error}</p>}
          {(contributions ?? []).slice(0, TOP_BLOCKS_LIMIT).map((c) => (
            <button
              key={c.blockName}
              type="button"
              onClick={() => onBlockClick(c.blockName)}
              className="flex items-baseline justify-between gap-2 rounded-md bg-black/[0.02] px-2 py-1 text-left transition-colors hover:bg-black/[0.05]"
              title="Inspect this block"
            >
              <span className="truncate text-[10px] text-mm-text">{c.blockName}</span>
              <span className={`shrink-0 font-mono text-[10px] tabular-nums ${valColor(c.edge)}`}>
                {c.edge >= 0 ? "+" : ""}
                {c.edge.toFixed(4)}
              </span>
            </button>
          ))}
          {contributions && contributions.length === 0 && (
            <p className="text-[10px] text-mm-text-dim">No block contributions for this cell.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  decimals,
}: {
  label: string;
  value: number;
  unit: string;
  decimals: number;
}) {
  return (
    <div className="glass-card flex flex-col gap-0.5 px-2 py-1">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        {label}
      </span>
      <span className={`font-mono text-[11px] font-semibold tabular-nums ${valColor(value)}`}>
        {value > 0 ? "+" : ""}
        {value.toFixed(decimals)}
        {unit && <span className="ml-1 text-[9px] text-mm-text-subtle">{unit}</span>}
      </span>
    </div>
  );
}
