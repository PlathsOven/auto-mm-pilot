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
