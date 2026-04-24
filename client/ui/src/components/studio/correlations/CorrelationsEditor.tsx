import { useCallback, useMemo, useState } from "react";

import { useWebSocket } from "../../../providers/WebSocketProvider";
import { useCorrelationsDraft } from "../../../hooks/useCorrelationsDraft";
import type { DesiredPosition } from "../../../types";

import { MatrixGrid } from "./MatrixGrid";
import { ConfirmMatrixModal, type MatrixKind } from "./ConfirmMatrixModal";

/** Extract the sorted symbol / expiry universe from the live positions
 *  broadcast. The pipeline-side matrix materialiser uses the same lex-sort
 *  over the unique axis, so the editor order lines up with the numpy solve. */
function axesFromPositions(positions: DesiredPosition[]): {
  symbols: string[];
  expiries: string[];
} {
  const symbolSet = new Set<string>();
  const expirySet = new Set<string>();
  for (const p of positions) {
    symbolSet.add(p.symbol);
    expirySet.add(p.expiry);
  }
  return {
    symbols: [...symbolSet].sort(),
    expiries: [...expirySet].sort(),
  };
}

interface MatrixSectionProps {
  kind: MatrixKind;
  heading: string;
  labels: string[];
  positions: DesiredPosition[];
}

function MatrixSection({ kind, heading, labels, positions }: MatrixSectionProps) {
  const { committed, localDraft, loading, error, saving, setRho, confirm, discard } =
    useCorrelationsDraft(kind);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const draftLive = localDraft !== null;
  const draftDiffers = useMemo(() => {
    if (!draftLive) return false;
    // Any cell that differs between committed and draft flips the flag.
    const committedMap = new Map(committed.map((e) => [`${e.a}|${e.b}`, e.rho]));
    for (const e of localDraft) {
      if (Math.abs((committedMap.get(`${e.a}|${e.b}`) ?? 0) - e.rho) > 1e-6) return true;
    }
    // Any committed cell dropped in the draft would also differ.
    const draftMap = new Map(localDraft.map((e) => [`${e.a}|${e.b}`, e.rho]));
    for (const e of committed) {
      if (Math.abs((draftMap.get(`${e.a}|${e.b}`) ?? 0) - e.rho) > 1e-6) return true;
    }
    return false;
  }, [committed, localDraft, draftLive]);

  // Count positions the draft would move + their Σ|Δ|. Computed off the
  // WS-broadcast hypothetical columns so the summary is always live.
  const { movedCount, sumAbsDiff } = useMemo(() => {
    if (!draftLive) return { movedCount: 0, sumAbsDiff: 0 };
    let moved = 0;
    let sum = 0;
    for (const p of positions) {
      const hyp = p.smoothedDesiredPositionHypothetical;
      if (hyp === null) continue;
      const d = Math.abs(hyp - p.desiredPos);
      if (d > 0.005) moved += 1;
      sum += d;
    }
    return { movedCount: moved, sumAbsDiff: sum };
  }, [positions, draftLive]);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    try {
      await confirm();
      setConfirmOpen(false);
    } finally {
      setConfirming(false);
    }
  }, [confirm]);

  const confirmDisabled = !draftDiffers || confirming;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-mm-text-dim">
          {heading}
        </h4>
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-mono ${
            draftLive
              ? "border-amber-400/50 bg-amber-400/10 text-amber-800"
              : "border-emerald-400/50 bg-emerald-400/10 text-emerald-800"
          }`}
          title={
            draftLive
              ? "A draft is live — Confirm promotes it to committed."
              : "Committed — no draft pending."
          }
        >
          {draftLive ? "Draft pending" : "Committed"}
        </span>
      </header>

      {loading ? (
        <p className="text-[11px] italic text-mm-text-dim">Loading correlations…</p>
      ) : (
        <MatrixGrid
          labels={labels}
          committed={committed}
          draft={localDraft}
          onEdit={setRho}
        />
      )}

      {error && (
        <p className="rounded border border-red-400/40 bg-red-50/60 px-2 py-1 text-[10px] text-red-700">
          {error}
        </p>
      )}

      {draftLive && (
        <p className="text-[10px] text-mm-text-dim">
          {movedCount === 0
            ? "Draft produces no visible position change yet — edits are pending a tick."
            : `Applying this draft moves ${movedCount} position${movedCount === 1 ? "" : "s"} (Σ|Δ| = ${sumAbsDiff.toFixed(2)}).`}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={confirmDisabled}
          className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-500/20 disabled:opacity-40"
          title={
            draftLive
              ? draftDiffers
                ? "Review the per-cell diff and confirm"
                : "Draft equals committed — nothing to confirm"
              : "No draft pending"
          }
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => void discard()}
          disabled={!draftLive || confirming}
          className="rounded-md border border-black/10 bg-white/40 px-2.5 py-1 text-[11px] text-mm-text-dim transition-colors hover:bg-black/[0.04] disabled:opacity-40"
        >
          Discard
        </button>
        {saving && (
          <span className="text-[10px] italic text-mm-text-dim">Saving…</span>
        )}
      </div>

      <ConfirmMatrixModal
        open={confirmOpen}
        kind={kind}
        positions={positions}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
        confirming={confirming}
      />
    </section>
  );
}

/**
 * Stage H control surface hosted in the Anatomy Correlations node detail
 * panel. Renders two stacked matrix editors (symbols, expiries) plus a
 * live diff summary per matrix driven by the WS-broadcast
 * ``*_hypothetical`` columns. Confirm opens a loud modal; Discard wipes
 * the draft back to committed.
 */
export function CorrelationsEditor() {
  const { payload } = useWebSocket();
  const positions = payload?.positions ?? [];
  const { symbols, expiries } = useMemo(() => axesFromPositions(positions), [positions]);

  return (
    <div className="flex flex-col gap-6">
      <MatrixSection
        kind="symbols"
        heading="Symbol correlations"
        labels={symbols}
        positions={positions}
      />
      <MatrixSection
        kind="expiries"
        heading="Expiry correlations"
        labels={expiries}
        positions={positions}
      />
    </div>
  );
}
