/**
 * Sub-components for BlockDrawer: SnapshotTable and ReadOnlyField.
 *
 * Extracted from BlockDrawer.tsx to keep the main component under 300 lines.
 */

import type { SnapshotRowDraft } from "./blockDrawerState";

// ---------------------------------------------------------------------------
// SnapshotTable
// ---------------------------------------------------------------------------

export function SnapshotTable({
  headers,
  rows,
  readOnly,
  onHeaderChange,
  onAddHeader,
  onRemoveHeader,
  onCellChange,
  onAddRow,
  onRemoveRow,
}: {
  headers: string[];
  rows: SnapshotRowDraft[];
  readOnly: boolean;
  onHeaderChange: (idx: number, val: string) => void;
  onAddHeader: () => void;
  onRemoveHeader: (idx: number) => void;
  onCellChange: (rowIdx: number, col: string, val: string) => void;
  onAddRow: () => void;
  onRemoveRow: (rowIdx: number) => void;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-black/[0.06]">
      <table className="w-full border-collapse text-[10px]">
        <thead className="bg-black/[0.03]">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-1.5 py-1 text-left">
                {readOnly ? (
                  <span className="font-medium text-mm-text-dim">{h}</span>
                ) : (
                  <div className="flex items-center gap-0.5">
                    <input
                      type="text"
                      value={h}
                      onChange={(e) => onHeaderChange(i, e.target.value)}
                      className="w-full min-w-[60px] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10px] font-medium text-mm-text-dim hover:border-black/[0.08] focus:border-mm-accent/40 focus:outline-none"
                    />
                    {headers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveHeader(i)}
                        className="shrink-0 text-[9px] text-mm-text-dim/50 hover:text-mm-error"
                        title="Remove column"
                      >
                        x
                      </button>
                    )}
                  </div>
                )}
              </th>
            ))}
            {!readOnly && (
              <th className="w-16 px-1.5 py-1">
                <button
                  type="button"
                  onClick={onAddHeader}
                  className="text-[9px] text-mm-accent hover:underline"
                  title="Add column"
                >
                  + col
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row._key} className="border-t border-black/[0.03]">
              {headers.map((h) => (
                <td key={h} className="px-1.5 py-0.5">
                  {readOnly ? (
                    <span className="font-mono text-[10px]">{String(row[h] ?? "")}</span>
                  ) : (
                    <input
                      type="text"
                      value={String(row[h] ?? "")}
                      onChange={(e) => onCellChange(ri, h, e.target.value)}
                      className="w-full min-w-[60px] rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10px] hover:border-black/[0.08] focus:border-mm-accent/40 focus:outline-none"
                    />
                  )}
                </td>
              ))}
              {!readOnly && (
                <td className="px-1.5 py-0.5 text-center">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveRow(ri)}
                      className="text-[9px] text-mm-text-dim/50 hover:text-mm-error"
                      title="Remove row"
                    >
                      x
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          onClick={onAddRow}
          className="w-full border-t border-black/[0.03] py-1 text-[9px] text-mm-accent hover:bg-mm-accent/5"
        >
          + Add row
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyField
// ---------------------------------------------------------------------------

export function ReadOnlyField({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-mm-text-dim">{label}</span>
      <span className="font-mono text-[11px] tabular-nums">
        {value != null ? value.toFixed(4) : "—"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppliesToField — multi-select (symbol, expiry) chips
// ---------------------------------------------------------------------------

/**
 * Multi-select for the stream's ``applies_to`` list.
 *
 * Two mutually exclusive states:
 *   - "All symbols/expiries" selected  → value is ``null``; fans to every
 *     pair in the dim universe. This is the default.
 *   - One or more individual pairs selected → value is the explicit list.
 *
 * Clicking the "All" chip switches into all-mode (clears any per-pair
 * selection). Clicking an individual chip while in all-mode switches into
 * list-mode with just that chip selected. Within list-mode, chips toggle
 * individually; if the trader deselects the last one, the field auto-
 * reverts to all-mode rather than leaving an invalid empty selection.
 */
export function AppliesToField({
  value,
  options,
  onChange,
  readOnly,
}: {
  value: [string, string][] | null;
  options: [string, string][];
  onChange: (next: [string, string][] | null) => void;
  readOnly: boolean;
}) {
  const isAll = value === null;
  const selectedKey = (pair: [string, string]) => `${pair[0]}|${pair[1]}`;
  const selectedSet = new Set(isAll ? [] : (value ?? []).map(selectedKey));

  const togglePair = (pair: [string, string]) => {
    if (readOnly) return;
    const key = selectedKey(pair);
    // Coming from all-mode: switch to list-mode seeded with just this pair.
    if (isAll) {
      onChange([pair]);
      return;
    }
    const current = value ?? [];
    const next = selectedSet.has(key)
      ? current.filter((p) => selectedKey(p) !== key)
      : [...current, pair];
    // Empty list is an invalid selection — auto-revert to all-mode.
    onChange(next.length === 0 ? null : next);
  };

  const setAll = () => {
    if (readOnly) return;
    if (isAll) return;
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium text-mm-text-dim">Applies to</span>
      {options.length === 0 ? (
        <p className="text-[10px] italic text-mm-text-dim">
          No dims in the universe yet — register at least one stream with a snapshot.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={readOnly}
            onClick={setAll}
            className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
              isAll
                ? "border-mm-accent bg-mm-accent/10 text-mm-accent"
                : "border-black/[0.08] bg-transparent text-mm-text-dim hover:border-mm-accent/40 hover:text-mm-text"
            } ${readOnly ? "cursor-default opacity-80" : "cursor-pointer"}`}
            title="This block fans out to every (symbol, expiry) pair in the dim universe."
            aria-pressed={isAll}
          >
            All symbols/expiries
          </button>
          {options.map((pair) => {
            const key = selectedKey(pair);
            const isSelected = selectedSet.has(key);
            return (
              <button
                key={key}
                type="button"
                disabled={readOnly}
                onClick={() => togglePair(pair)}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  isSelected
                    ? "border-mm-accent bg-mm-accent/10 text-mm-accent"
                    : "border-black/[0.08] bg-transparent text-mm-text-dim hover:border-mm-accent/40 hover:text-mm-text"
                } ${readOnly ? "cursor-default opacity-80" : "cursor-pointer"}`}
                aria-pressed={isSelected}
              >
                {pair[0]}/{pair[1]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
