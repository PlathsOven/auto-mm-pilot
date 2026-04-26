import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { DesiredPosition } from "../../../types";
import { parseExpiry } from "../../../utils";

export type MatrixKind = "symbols" | "expiries";

interface Props {
  open: boolean;
  kind: MatrixKind;
  /** Live positions from the WS payload — both committed + hypothetical
   *  are carried on every row; the modal diffs them here. Hypothetical
   *  is ``null`` whenever no draft is live, which shouldn't happen at
   *  confirm-time (Confirm is gated in the editor). */
  positions: DesiredPosition[];
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}

interface DiffRow {
  symbol: string;
  expiry: string;
  committed: number;
  hypothetical: number;
  diff: number;
}

function buildDiffRows(positions: DesiredPosition[]): DiffRow[] {
  const out: DiffRow[] = [];
  for (const p of positions) {
    const hyp = p.smoothedDesiredPositionHypothetical;
    // Hypothetical null means no draft for this cell — skip rather than
    // render a confusing "→ —". Confirm-time gating upstream makes this
    // an empty-state edge case; showing nothing is honest.
    if (hyp === null) continue;
    const committed = p.desiredPos;
    const diff = hyp - committed;
    if (Math.abs(diff) < 0.005) continue;  // within display precision
    out.push({
      symbol: p.symbol,
      expiry: p.expiry,
      committed,
      hypothetical: hyp,
      diff,
    });
  }
  return out;
}

function sumAbsDiff(rows: DiffRow[]): number {
  return rows.reduce((acc, r) => acc + Math.abs(r.diff), 0);
}

type SortKey = "symbol" | "expiry" | "committed" | "hypothetical" | "diff";
type SortDir = "asc" | "desc";

/** Compare two rows by the given column. ``diff`` compares by absolute
 *  magnitude — "biggest moves" is what the trader cares about regardless
 *  of sign. ``expiry`` parses the DDMMMYY label into a UTC timestamp so the
 *  sort is chronological (lex order puts "25SEP26" before "27MAR26"), with
 *  unparseable labels falling back to locale-compare so the order stays
 *  deterministic. Everything else sorts by its natural value. */
function compareRows(a: DiffRow, b: DiffRow, key: SortKey): number {
  switch (key) {
    case "symbol": return a.symbol.localeCompare(b.symbol);
    case "expiry": {
      const ta = parseExpiry(a.expiry);
      const tb = parseExpiry(b.expiry);
      if (Number.isNaN(ta) && Number.isNaN(tb)) return a.expiry.localeCompare(b.expiry);
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return ta - tb;
    }
    case "committed": return a.committed - b.committed;
    case "hypothetical": return a.hypothetical - b.hypothetical;
    case "diff": return Math.abs(a.diff) - Math.abs(b.diff);
  }
}

/** Initial sort direction when a column is first clicked — strings start
 *  ascending (A→Z), numbers start descending (biggest first). */
function initialDir(key: SortKey): SortDir {
  return key === "symbol" || key === "expiry" ? "asc" : "desc";
}

function sortIndicator(active: boolean, dir: SortDir): string {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

function signed(n: number, decimals = 2): string {
  if (Math.abs(n) < 0.005) return "0";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}`;
}

/**
 * Loud confirm modal for a correlation matrix promotion.
 *
 * Shows the full per-(symbol, expiry) diff table — committed → hypothetical,
 * plus the absolute-diff ``Σ|Δ|`` the trader should scan first. The
 * copy above the table is deliberately loud; this is a live-state change.
 */
export function ConfirmMatrixModal({
  open,
  kind,
  positions,
  onConfirm,
  onCancel,
  confirming,
}: Props) {
  const rows = buildDiffRows(positions);
  const sumAbs = sumAbsDiff(rows);
  // Default — biggest magnitude moves first, the trader's "scan for
  // outliers" entry point.
  const [sortKey, setSortKey] = useState<SortKey>("diff");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    const sign = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => sign * compareRows(a, b, sortKey));
    return copy;
  }, [rows, sortKey, sortDir]);

  const onHeaderClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(initialDir(key));
    }
  };

  const title = kind === "symbols"
    ? "Confirm symbol correlations"
    : "Confirm expiry correlations";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="confirm-corr-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={confirming ? undefined : onCancel}
            aria-hidden
          />
          {/* Flex-centering wrapper — framer-motion's y-animate overrides
              Tailwind's -translate-y-1/2 when both land on the same node,
              which left the modal at top:50%-only and pushed it below the
              viewport center. Centering via flex on a wrapper keeps the
              vertical-slide animation independent of positioning. */}
          <div
            key="confirm-corr-wrapper"
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              key="confirm-corr-modal"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="glass-panel-xl pointer-events-auto flex max-h-[80vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-xl"
              role="dialog"
              aria-modal
            >
            <header className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
              <h3 className="zone-header">{title}</h3>
              <button
                type="button"
                onClick={onCancel}
                disabled={confirming}
                className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text disabled:opacity-40"
                title="Cancel (Esc)"
              >
                ✕
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
              <div className="rounded-md border border-amber-400/40 bg-amber-50/60 px-3 py-2">
                <p className="text-[12px] font-semibold text-amber-900">
                  ⚠ This will change live positions.
                </p>
                <p className="mt-1 text-[11px] text-amber-900">
                  Review the per-cell diffs below before confirming. The pipeline
                  re-runs immediately and the WS broadcast reflects the new
                  positions on the next tick.
                </p>
              </div>

              {rows.length === 0 ? (
                <p className="rounded border border-dashed border-black/10 px-3 py-6 text-center text-[11px] text-mm-text-dim">
                  No net position changes — the draft matrix produces the same
                  positions as the committed matrix. Confirming is safe but has
                  no visible effect.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <p className="text-[11px] text-mm-text-dim">
                      Applying this draft moves <strong>{rows.length}</strong>{" "}
                      position{rows.length === 1 ? "" : "s"}.
                    </p>
                    <p className="text-[11px] text-mm-text-dim">
                      Σ|Δ| ={" "}
                      <span className="font-mono text-mm-text">
                        {sumAbs.toFixed(2)}
                      </span>
                    </p>
                  </div>

                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-black/10 text-mm-text-dim">
                        <SortHeader
                          label="Symbol"
                          sortKey="symbol"
                          active={sortKey}
                          dir={sortDir}
                          onClick={onHeaderClick}
                          align="left"
                        />
                        <SortHeader
                          label="Expiry"
                          sortKey="expiry"
                          active={sortKey}
                          dir={sortDir}
                          onClick={onHeaderClick}
                          align="left"
                        />
                        <SortHeader
                          label="Committed"
                          sortKey="committed"
                          active={sortKey}
                          dir={sortDir}
                          onClick={onHeaderClick}
                          align="right"
                        />
                        <SortHeader
                          label="Draft"
                          sortKey="hypothetical"
                          active={sortKey}
                          dir={sortDir}
                          onClick={onHeaderClick}
                          align="right"
                        />
                        <SortHeader
                          label="Diff"
                          sortKey="diff"
                          active={sortKey}
                          dir={sortDir}
                          onClick={onHeaderClick}
                          align="right"
                          lastCol
                          title="Sorts by absolute magnitude — sign is kept in the value."
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r) => (
                        <tr
                          key={`${r.symbol}-${r.expiry}`}
                          className="border-b border-black/[0.04]"
                        >
                          <td className="py-1 pr-2 font-mono">{r.symbol}</td>
                          <td className="py-1 pr-2 font-mono text-mm-text-dim">{r.expiry}</td>
                          <td className="py-1 pr-2 text-right font-mono">
                            {r.committed.toFixed(2)}
                          </td>
                          <td className="py-1 pr-2 text-right font-mono">
                            {r.hypothetical.toFixed(2)}
                          </td>
                          <td
                            className={`py-1 text-right font-mono ${
                              r.diff > 0 ? "text-emerald-700" : "text-red-700"
                            }`}
                          >
                            {signed(r.diff)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-black/[0.06] px-4 py-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={confirming}
                className="rounded-md border border-black/10 bg-white/40 px-3 py-1.5 text-[12px] text-mm-text transition-colors hover:bg-black/[0.04] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirming}
                className="btn-accent-gradient rounded-md px-3 py-1.5 text-[12px] text-white disabled:opacity-60"
              >
                {confirming ? "Committing…" : "Yes, commit"}
              </button>
            </footer>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
  align,
  lastCol,
  title,
}: {
  label: string;
  sortKey: SortKey;
  /** The currently-active sort key on the table. */
  active: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align: "left" | "right";
  /** Drops the right-padding on the last column so the indicator stays flush. */
  lastCol?: boolean;
  /** Optional tooltip — used to explain the diff-by-magnitude sort. */
  title?: string;
}) {
  const isActive = active === sortKey;
  return (
    <th
      className={`py-1 font-normal ${lastCol ? "" : "pr-2"} text-${align} ${
        isActive ? "text-mm-text" : "text-mm-text-dim"
      } cursor-pointer select-none hover:text-mm-text`}
      onClick={() => onClick(sortKey)}
      title={title}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <span className="inline-block w-3 text-[9px] text-mm-accent">
        {sortIndicator(isActive, dir)}
      </span>
    </th>
  );
}
