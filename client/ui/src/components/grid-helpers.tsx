import type { DesiredPosition, ViewMode } from "../types";
import type { PendingEdit } from "../hooks/usePositionEdit";
import { valColor, cellBg } from "../utils";

// ---------------------------------------------------------------------------
// Totals helpers
// ---------------------------------------------------------------------------

export type DisplayValueFn = (key: string, pos: DesiredPosition, mode: ViewMode) => number;
export type GridMap = Map<string, DesiredPosition>;

export function computeRowTotal(symbol: string, expiries: string[], grid: GridMap, getVal: DisplayValueFn, mode: ViewMode): number {
  return expiries.reduce((sum, exp) => {
    const k = `${symbol}-${exp}`;
    const pos = grid.get(k);
    return sum + (pos ? getVal(k, pos, mode) : 0);
  }, 0);
}

export function computeColTotal(expiry: string, symbols: string[], grid: GridMap, getVal: DisplayValueFn, mode: ViewMode): number {
  return symbols.reduce((sum, s) => {
    const k = `${s}-${expiry}`;
    const pos = grid.get(k);
    return sum + (pos ? getVal(k, pos, mode) : 0);
  }, 0);
}

export function computeGrandTotal(symbols: string[], expiries: string[], grid: GridMap, getVal: DisplayValueFn, mode: ViewMode): number {
  return symbols.reduce((sum, s) =>
    sum + expiries.reduce((acc, exp) => {
      const k = `${s}-${exp}`;
      const pos = grid.get(k);
      return acc + (pos ? getVal(k, pos, mode) : 0);
    }, 0), 0);
}

export function TotalCell({ value, decimals, signed = true }: { value: number; decimals: number; signed?: boolean }) {
  return (
    <td
      className={`px-3 py-2.5 text-center text-[12px] tabular-nums font-semibold ${valColor(value)}`}
      style={{ backgroundColor: cellBg(value) }}
    >
      {signed && value > 0 ? "+" : ""}
      {value.toFixed(decimals)}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Override status bar
// ---------------------------------------------------------------------------

export function OverrideStatusBar({
  pendingEdit,
  overrideCount,
  decimals,
  signed = true,
  viewMode,
  onCancel,
  onConfirm,
}: {
  pendingEdit: PendingEdit | null;
  overrideCount: number;
  decimals: number;
  signed?: boolean;
  viewMode: ViewMode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      {pendingEdit && (
        <div className="mt-2 flex items-center justify-between rounded-lg border-t border-black/[0.06] bg-black/[0.03] px-3 py-2">
          <span className="text-[10px] text-mm-text">
            Override <span className="font-semibold">{pendingEdit.symbol} {pendingEdit.expiry}</span>:
            <span className="ml-1 text-mm-text-dim">{signed && pendingEdit.aptValue > 0 ? "+" : ""}{pendingEdit.aptValue.toFixed(decimals)}</span>
            <span className="mx-1">{"\u2192"}</span>
            <span className="font-semibold text-mm-warn">{isNaN(parseFloat(pendingEdit.value)) ? "\u2014" : (signed && parseFloat(pendingEdit.value) > 0 ? "+" : "") + parseFloat(pendingEdit.value).toFixed(decimals)}</span>
          </span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded-md px-2 py-0.5 text-[10px] text-mm-text-dim hover:text-mm-text transition-colors">Cancel</button>
            <button onClick={onConfirm} className="rounded-md px-2 py-0.5 text-[10px] bg-mm-warn/15 text-mm-warn hover:bg-mm-warn/25 transition-colors font-medium">Confirm</button>
          </div>
        </div>
      )}

      {overrideCount > 0 && !pendingEdit && (
        <p className="mt-1 text-[9px] text-mm-warn">
          {overrideCount} override{overrideCount > 1 ? "s" : ""} active {"\u2014"} double-click to edit, ✕ to undo.
        </p>
      )}

      <p className="mt-1 text-[9px] text-mm-text-dim">
        {viewMode === "position" ? "Double-click a cell to override. " : ""}Hover for stream attribution.
      </p>
    </>
  );
}
