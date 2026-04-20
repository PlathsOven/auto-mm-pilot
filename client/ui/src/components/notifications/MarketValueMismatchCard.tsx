import type { MarketValueMismatchAlert } from "../../types";

interface Props {
  entry: MarketValueMismatchAlert;
  onOpenCell: (symbol: string, expiry: string) => void;
}

/** Alert card shown when the per-block market values for a (symbol, expiry)
 *  don't reconcile to the aggregate marketVol the user set. The two should
 *  be equal by construction — a visible gap means the market-value-inference
 *  step couldn't close the loop (all blocks user-set, no inferred blocks
 *  with forward coverage, or no aggregate set at all). The CTA opens the
 *  cell in the Workbench so the trader can reconcile the values. */
export function MarketValueMismatchCard({ entry, onOpenCell }: Props) {
  const aggregateUnset = entry.aggregateVol === 0 && entry.impliedVol !== 0;
  const body = aggregateUnset
    ? "Per-block market values are non-zero but no aggregate marketVol is set. Set an aggregate on the cell so the pipeline can reconcile."
    : "Per-block market values don't add up to the aggregate marketVol on this cell. Reconcile the per-block values or adjust the aggregate.";

  return (
    <li className="rounded-lg border border-mm-error/40 bg-mm-error/[0.07] p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mm-error">
            Market value mismatch
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-mm-text">
            {entry.symbol} · {entry.expiry}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full bg-mm-error/20 px-2 py-0.5 text-[9px] font-semibold text-mm-error"
          title={`aggregate ${entry.aggregateVol.toFixed(4)}\nimplied ${entry.impliedVol.toFixed(4)}`}
        >
          Δ {entry.diff >= 0 ? "+" : ""}{entry.diff.toFixed(2)}
        </span>
      </header>

      <div className="mb-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md border border-black/[0.06] bg-white/60 px-2 py-1">
          <div className="text-mm-text-dim">Aggregate</div>
          <div className="font-mono text-mm-text">{entry.aggregateVol.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-black/[0.06] bg-white/60 px-2 py-1">
          <div className="text-mm-text-dim">Per-block sum</div>
          <div className="font-mono text-mm-text">{entry.impliedVol.toFixed(2)}</div>
        </div>
      </div>

      <p className="mb-3 text-[10px] text-mm-text-dim">{body}</p>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpenCell(entry.symbol, entry.expiry)}
          className="rounded-md bg-mm-error/15 px-3 py-1 text-[10px] font-semibold text-mm-error transition-colors hover:bg-mm-error/25"
        >
          Open cell
        </button>
      </div>
    </li>
  );
}
