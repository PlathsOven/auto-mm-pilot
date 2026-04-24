import { AnimatePresence, motion } from "framer-motion";

import type { DesiredPosition } from "../../../types";

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
  // Biggest absolute moves first — matches the "scan for the outliers"
  // mental model the trader uses when reviewing a batch of changes.
  out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return out;
}

function sumAbsDiff(rows: DiffRow[]): number {
  return rows.reduce((acc, r) => acc + Math.abs(r.diff), 0);
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
          <motion.div
            key="confirm-corr-modal"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel-xl fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl"
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
                        <th className="py-1 pr-2 text-left font-normal">Symbol</th>
                        <th className="py-1 pr-2 text-left font-normal">Expiry</th>
                        <th className="py-1 pr-2 text-right font-normal">Committed</th>
                        <th className="py-1 pr-2 text-right font-normal">Draft</th>
                        <th className="py-1 text-right font-normal">Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
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
        </>
      )}
    </AnimatePresence>
  );
}
