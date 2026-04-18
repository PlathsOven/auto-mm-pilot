import { useMemo } from "react";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { useChat } from "../../../providers/ChatProvider";
import { useFocus } from "../../../providers/FocusProvider";
import { useStreamContributions } from "../../../hooks/useStreamContributions";
import { valColor } from "../../../utils";

interface CellInspectorProps {
  symbol: string;
  expiry: string;
}

const TOP_BLOCKS_LIMIT = 8;

/**
 * Inspector view for a focused (symbol, expiry) cell.
 *
 * Shows the current desired-position plus the per-block fair/edge breakdown
 * sourced from `useStreamContributions`. Includes an explicit "Ask @Posit"
 * button — the only way chat now learns about a cell, since the click-to-chat
 * side-effect was removed in Phase 1.
 */
export function CellInspector({ symbol, expiry }: CellInspectorProps) {
  const { payload } = useWebSocket();
  const { investigate } = useChat();
  const { clearFocus } = useFocus();

  const position = useMemo(
    () => payload?.positions.find((p) => p.symbol === symbol && p.expiry === expiry) ?? null,
    [payload, symbol, expiry],
  );

  const { contributions, loading, error } = useStreamContributions({ symbol, expiry });

  const handleAskPosit = () => {
    if (!position) return;
    investigate({ type: "position", symbol, expiry, position });
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-2 border-b border-black/[0.06] pb-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">Cell</span>
          <span className="text-[14px] font-semibold text-mm-text">
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

      {position == null ? (
        <p className="text-[11px] text-mm-text-dim">No live position for this cell yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Desired Pos" value={position.desiredPos} unit="$vega" decimals={2} />
            <Stat label="Raw Desired" value={position.rawDesiredPos} unit="$vega" decimals={2} />
            <Stat label="Edge" value={position.edge} unit="vp" decimals={4} />
            <Stat label="Variance" value={position.variance} unit="" decimals={4} />
            <Stat label="Total Fair" value={position.totalFair} unit="" decimals={4} />
            <Stat label="Market Fair" value={position.totalMarketFair} unit="" decimals={4} />
          </div>

          <button
            type="button"
            onClick={handleAskPosit}
            className="rounded-lg border border-mm-accent/30 bg-mm-accent/[0.06] px-3 py-1.5 text-[11px] font-semibold text-mm-accent transition-colors hover:bg-mm-accent/[0.12]"
          >
            Ask @Posit about this cell →
          </button>

          <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-black/[0.06] pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
                Contributing blocks
              </span>
              {loading && <span className="animate-pulse text-[9px] text-mm-text-dim">loading…</span>}
            </div>
            {error && <p className="text-[10px] text-mm-error">{error}</p>}
            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {(contributions ?? []).slice(0, TOP_BLOCKS_LIMIT).map((c) => (
                <div
                  key={c.blockName}
                  className="flex items-baseline justify-between gap-2 rounded-md bg-black/[0.02] px-2 py-1.5"
                >
                  <span className="truncate text-[11px] text-mm-text">{c.blockName}</span>
                  <span className={`shrink-0 font-mono text-[10px] tabular-nums ${valColor(c.edge)}`}>
                    {c.edge >= 0 ? "+" : ""}
                    {c.edge.toFixed(4)}
                  </span>
                </div>
              ))}
              {contributions && contributions.length === 0 && (
                <p className="text-[10px] text-mm-text-dim">No block contributions for this cell.</p>
              )}
            </div>
          </section>
        </>
      )}
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
    <div className="glass-card flex flex-col gap-0.5 px-2.5 py-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        {label}
      </span>
      <span className={`font-mono text-[12px] font-semibold tabular-nums ${valColor(value)}`}>
        {value > 0 ? "+" : ""}
        {value.toFixed(decimals)}
        {unit && <span className="ml-1 text-[9px] text-mm-text-subtle">{unit}</span>}
      </span>
    </div>
  );
}
