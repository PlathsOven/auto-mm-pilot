import { useFocus } from "../../../providers/FocusProvider";
import { useWebSocket } from "../../../providers/WebSocketProvider";
import { valColor } from "../../../utils";

interface SymbolExpiryInspectorProps {
  symbol: string | null;
  expiry: string | null;
}

/**
 * Inspector for a focused row (symbol) or column (expiry).
 *
 * Lean by design — the pipeline chart for the matching dimension lives on
 * the main canvas, channelled to focus. The inspector here just lists the
 * positions that match the focused axis so the trader can see the family
 * at a glance and click through to a specific cell.
 */
export function SymbolExpiryInspector({ symbol, expiry }: SymbolExpiryInspectorProps) {
  const { clearFocus, toggleFocus } = useFocus();
  const { payload } = useWebSocket();

  const matches = (payload?.positions ?? []).filter(
    (p) => (symbol == null || p.symbol === symbol) && (expiry == null || p.expiry === expiry),
  );

  const heading = symbol && expiry == null ? "Symbol" : expiry && symbol == null ? "Expiry" : "Dimension";
  const subtitle = symbol ?? expiry ?? "";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-black/[0.06] px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">{heading}</span>
          <span className="text-[13px] font-semibold text-mm-text">{subtitle}</span>
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

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
          Matching positions ({matches.length})
        </span>
        {matches.map((p) => (
          <button
            key={`${p.symbol}-${p.expiry}`}
            type="button"
            onClick={() => toggleFocus({ kind: "cell", symbol: p.symbol, expiry: p.expiry })}
            className="flex items-baseline justify-between gap-2 rounded-md bg-black/[0.02] px-2 py-1 text-left transition-colors hover:bg-black/[0.05]"
          >
            <span className="text-[10px] text-mm-text">{p.symbol} · {p.expiry}</span>
            <span className={`font-mono text-[10px] tabular-nums ${valColor(p.desiredPos)}`}>
              {p.desiredPos > 0 ? "+" : ""}
              {p.desiredPos.toFixed(2)}
              <span className="ml-1 text-[9px] text-mm-text-subtle">$vega</span>
            </span>
          </button>
        ))}
        {matches.length === 0 && (
          <p className="text-[10px] text-mm-text-dim">No positions match this focus yet.</p>
        )}
      </div>
    </div>
  );
}
