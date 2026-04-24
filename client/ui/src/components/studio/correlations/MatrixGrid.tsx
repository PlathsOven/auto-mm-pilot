import { memo, useMemo } from "react";

import type {
  ExpiryCorrelationEntry,
  SymbolCorrelationEntry,
} from "../../../types";
import { canonicalPair } from "../../../hooks/useCorrelationsDraft";

type Entry = SymbolCorrelationEntry | ExpiryCorrelationEntry;

interface Props {
  /** Labels in lex-sort order — the pipeline sorts axes before pivoting
   *  into the matrix solve, so the grid mirrors that order exactly. */
  labels: string[];
  /** Committed upper-triangle entries. Drives the lower-triangle (mirrored)
   *  and the unedited-cell display when no draft is live. */
  committed: Entry[];
  /** Optional draft upper-triangle entries. ``null`` means no draft —
   *  cells render the committed value; any edit creates the draft. */
  draft: Entry[] | null;
  /** Two-decimal number edits only reach the server after the 500ms
   *  debounce fires in ``useCorrelationsDraft``. */
  onEdit: (a: string, b: string, rho: number) => void;
}

function clampRho(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < -1 || n > 1) return null;
  return Math.round(n * 100) / 100;
}

/** Indigo-to-red heat tint for a ρ value. Caller uses it on the cell
 *  background so the matrix reads as a heat map at a glance. */
function heatTint(rho: number, dim: boolean): string {
  const alpha = dim ? 0.18 : 0.55;
  if (rho >= 0) {
    const lightness = 1 - rho * 0.5;  // 1 → white-ish, 0.5 at ρ=1
    return `rgba(99, 102, 241, ${alpha * (1 - lightness + 0.3)})`;
  }
  return `rgba(239, 68, 68, ${alpha * (-rho)})`;
}

/**
 * A single k×k correlation matrix. Upper triangle is editable; lower
 * triangle mirrors the upper (read-only, dimmed). Diagonal is locked to
 * 1.0 and visually dimmed. Empty state (``labels.length === 0``) renders
 * a placeholder.
 */
export const MatrixGrid = memo(function MatrixGrid({
  labels,
  committed,
  draft,
  onEdit,
}: Props) {
  const live = draft ?? committed;
  const draftLive = draft !== null;

  // Pre-build the (a, b) → rho lookups once per render — avoids O(n²·m)
  // iteration across the full k×k grid.
  const liveMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of live) m.set(`${e.a}|${e.b}`, e.rho);
    return m;
  }, [live]);
  const committedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of committed) m.set(`${e.a}|${e.b}`, e.rho);
    return m;
  }, [committed]);

  if (labels.length === 0) {
    return (
      <p className="rounded border border-dashed border-black/10 px-3 py-6 text-center text-[11px] text-mm-text-dim">
        Register at least one stream to edit correlations.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="w-12 border border-black/[0.05] bg-black/[0.03] p-1" />
            {labels.map((label) => (
              <th
                key={label}
                className="min-w-[60px] border border-black/[0.05] bg-black/[0.03] px-1.5 py-1 text-left font-mono font-medium text-mm-text-dim"
                title={label}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((rowLabel, i) => (
            <tr key={rowLabel}>
              <th
                className="border border-black/[0.05] bg-black/[0.03] px-1.5 py-1 text-left font-mono font-medium text-mm-text-dim"
                title={rowLabel}
              >
                {rowLabel}
              </th>
              {labels.map((colLabel, j) => {
                if (i === j) {
                  // Diagonal — always 1.0, dimmed, non-editable.
                  return (
                    <td
                      key={colLabel}
                      className="border border-black/[0.05] px-1.5 py-1 text-center font-mono text-mm-text-dim"
                    >
                      1.00
                    </td>
                  );
                }
                const [ca, cb] = canonicalPair(rowLabel, colLabel);
                const liveRho = liveMap.get(`${ca}|${cb}`) ?? 0.0;
                const committedRho = committedMap.get(`${ca}|${cb}`) ?? 0.0;
                const upper = i < j;
                const differsFromCommitted =
                  draftLive && Math.abs(liveRho - committedRho) > 1e-6;

                if (!upper) {
                  // Lower triangle — mirrors the upper. Read-only, dimmed.
                  return (
                    <td
                      key={colLabel}
                      className="border border-black/[0.05] px-1.5 py-1 text-center font-mono text-[10px] text-mm-text-dim/70"
                      style={{ backgroundColor: heatTint(liveRho, true) }}
                    >
                      {liveRho.toFixed(2)}
                    </td>
                  );
                }
                // Upper triangle — editable.
                return (
                  <td
                    key={colLabel}
                    className="border border-black/[0.05] p-0"
                    style={{ backgroundColor: heatTint(liveRho, false) }}
                  >
                    <input
                      type="number"
                      step={0.05}
                      min={-1}
                      max={1}
                      value={liveRho.toFixed(2)}
                      onChange={(ev) => {
                        const next = clampRho(ev.currentTarget.value);
                        if (next === null) return;
                        onEdit(ca, cb, next);
                      }}
                      className={`w-full bg-transparent px-1.5 py-1 text-center font-mono text-[10px] outline-none focus:bg-white/40 ${
                        differsFromCommitted
                          ? "font-semibold text-indigo-700"
                          : "text-mm-text"
                      }`}
                      aria-label={`ρ(${ca}, ${cb})`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
