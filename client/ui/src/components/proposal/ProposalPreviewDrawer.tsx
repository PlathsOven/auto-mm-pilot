/**
 * Build-mode Stage 4 preview drawer.
 *
 * After the orchestrator emits a proposal, the ChatProvider calls
 * `/api/blocks/preview` and stores the result here. The trader sees
 *   1. their own verbatim words (the shared-language primitive)
 *   2. the preset or custom-derivation reasoning
 *   3. the per-(symbol, expiry) desired-position diff
 *   4. bankroll-usage summary + any orchestrator notes
 *
 * Confirming POSTs `/api/blocks/commit` with the full Stage 1–4 trace;
 * cancel dismisses the drawer without touching the server (the M4
 * feedback detector will log preview_rejection signals separately).
 */
import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  IntentOutput,
  PositionDelta,
  PreviewResponse,
  ProposedBlockPayload,
  SynthesisOutput,
} from "../../types";

export interface PendingProposal {
  payload: ProposedBlockPayload;
  intent: IntentOutput;
  synthesis: SynthesisOutput;
  preview: PreviewResponse;
}

interface Props {
  proposal: PendingProposal | null;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

function formatSigned(n: number, decimals = 2): string {
  if (n === 0) return "0";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}`;
}

function formatPercent(n: number | null): string {
  if (n === null) return "—";
  return `${formatSigned(n, 1)}%`;
}

function originalPhrasing(intent: IntentOutput): string {
  if (intent.structured) return intent.structured.original_phrasing;
  if (intent.raw) return intent.raw.original_phrasing;
  return "";
}

function synthesisLabel(synth: SynthesisOutput): { heading: string; detail: string } {
  const choice = synth.choice;
  if (choice.mode === "preset") {
    return {
      heading: `Preset: ${choice.preset_id}`,
      detail: choice.reasoning,
    };
  }
  return {
    heading: "Custom derivation",
    detail: choice.reasoning,
  };
}

export function ProposalPreviewDrawer({ proposal, onConfirm, onCancel }: Props) {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setError(null);
    setCommitting(true);
    try {
      await onConfirm();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setCommitting(false);
    }
  }, [onConfirm]);

  const open = proposal !== null;
  const title = proposal?.payload.action === "create_stream"
    ? "Register stream"
    : "Create manual block";

  return (
    <AnimatePresence>
      {open && proposal && (
        <>
          <motion.div
            key="proposal-preview-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={committing ? undefined : onCancel}
            aria-hidden
          />
          <motion.aside
            key="proposal-preview"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel-xl fixed right-0 top-0 z-50 flex h-screen w-[560px] flex-col rounded-none border-y-0 border-r-0 border-l border-white/40"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
              <div>
                <h3 className="zone-header">{title}</h3>
                <p className="mt-0.5 text-[10px] text-mm-text-dim">
                  {proposal.payload.stream_name}
                </p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={committing}
                aria-label="Cancel"
                className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text disabled:opacity-40"
                title="Cancel (Esc)"
              >
                &#x2715;
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
              <section>
                <h4 className="text-[10px] uppercase tracking-wider text-mm-text-dim">
                  Your words
                </h4>
                <p className="mt-1 text-[13px] italic text-mm-text">
                  &ldquo;{originalPhrasing(proposal.intent)}&rdquo;
                </p>
              </section>

              <section>
                <h4 className="text-[10px] uppercase tracking-wider text-mm-text-dim">
                  {synthesisLabel(proposal.synthesis).heading}
                </h4>
                <p className="mt-1 text-[12px] text-mm-text">
                  {synthesisLabel(proposal.synthesis).detail}
                </p>
              </section>

              <section>
                <h4 className="text-[10px] uppercase tracking-wider text-mm-text-dim">
                  Desired-position impact
                </h4>
                <DeltaTable deltas={proposal.preview.deltas} />
              </section>

              <section>
                <h4 className="text-[10px] uppercase tracking-wider text-mm-text-dim">
                  Bankroll usage
                </h4>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[12px] text-mm-text">
                  <div>Before: <span className="font-mono">{proposal.preview.total_bankroll_usage_before.toFixed(2)}</span></div>
                  <div>After: <span className="font-mono">{proposal.preview.total_bankroll_usage_after.toFixed(2)}</span></div>
                </div>
              </section>

              {proposal.preview.notes.length > 0 && (
                <section>
                  <h4 className="text-[10px] uppercase tracking-wider text-mm-text-dim">Notes</h4>
                  <ul className="mt-1 list-disc pl-4 text-[11px] text-mm-text-dim">
                    {proposal.preview.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </section>
              )}

              {error && (
                <div className="rounded-md border border-red-400/40 bg-red-50/60 px-3 py-2 text-[12px] text-red-700">
                  {error}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-black/[0.06] px-4 py-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={committing}
                className="rounded-md border border-black/10 bg-white/40 px-3 py-1.5 text-[12px] text-mm-text transition-colors hover:bg-black/[0.04] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={committing}
                className="btn-accent-gradient rounded-md px-3 py-1.5 text-[12px] text-white disabled:opacity-60"
              >
                {committing ? "Committing…" : "Create block"}
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DeltaTable({ deltas }: { deltas: PositionDelta[] }) {
  if (deltas.length === 0) {
    return (
      <p className="mt-1 text-[12px] italic text-mm-text-dim">
        No position change — commit anyway to register the block.
      </p>
    );
  }
  return (
    <table className="mt-1 w-full text-[12px]">
      <thead>
        <tr className="border-b border-black/10 text-mm-text-dim">
          <th className="py-1 pr-2 text-left font-normal">Symbol</th>
          <th className="py-1 pr-2 text-left font-normal">Expiry</th>
          <th className="py-1 pr-2 text-right font-normal">Before</th>
          <th className="py-1 pr-2 text-right font-normal">After</th>
          <th className="py-1 pr-2 text-right font-normal">Δ</th>
          <th className="py-1 text-right font-normal">%</th>
        </tr>
      </thead>
      <tbody>
        {deltas.map((d, i) => (
          <tr key={`${d.symbol}-${d.expiry}-${i}`} className="border-b border-black/[0.04]">
            <td className="py-1 pr-2 font-mono">{d.symbol}</td>
            <td className="py-1 pr-2 font-mono text-mm-text-dim">{d.expiry}</td>
            <td className="py-1 pr-2 text-right font-mono">{d.before.toFixed(2)}</td>
            <td className="py-1 pr-2 text-right font-mono">{d.after.toFixed(2)}</td>
            <td className="py-1 pr-2 text-right font-mono">{formatSigned(d.absolute_change)}</td>
            <td className="py-1 text-right font-mono">{formatPercent(d.percent_change)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
