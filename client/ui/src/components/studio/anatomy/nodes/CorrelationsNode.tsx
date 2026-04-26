import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface CorrelationsNodeData {
  stepNumber: number;
  label: string;
  subtitle: string;
  /** ``true`` while either per-user matrix has an unconfirmed draft. */
  draftPending: boolean;
  /** ``true`` when the last pipeline rerun surfaced a singular matrix. */
  singular: boolean;
  [key: string]: unknown;
}

/**
 * Stage H DAG node — the correlation-inverse translator.
 *
 * Distinct from the standard TransformNode because the control surface
 * is not an implementation picker + numeric params but two editable
 * matrices (managed in the NodeDetailPanel via ``CorrelationsEditor``
 * in M7). Default state — both matrices identity — is visually neutral;
 * ``draftPending`` and ``singular`` add amber / red chips when the
 * trader has staged an edit or landed on a degenerate input.
 */
export const CorrelationsNode = memo(function CorrelationsNode({
  data,
  selected,
}: NodeProps) {
  const {
    stepNumber,
    label,
    subtitle,
    draftPending,
    singular,
  } = data as CorrelationsNodeData;

  return (
    <div
      className={`relative flex h-[140px] w-[240px] flex-col gap-1.5 rounded-xl border bg-black/[0.05] p-3 shadow-sm transition-colors ${
        selected
          ? "border-mm-accent/70 ring-2 ring-mm-accent/40 ring-offset-2 ring-offset-mm-bg-deep"
          : singular
            ? "border-red-500/60 hover:border-red-500/80"
            : "border-black/[0.08] hover:border-mm-accent/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mm-bg-deep text-[10px] font-semibold text-mm-accent">
          {stepNumber}
        </span>
        <h4 className="truncate text-xs font-semibold text-mm-text">{label}</h4>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-block rounded bg-mm-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-mm-accent">
          correlation_inverse
        </span>
        {draftPending && (
          <span className="inline-block rounded-full border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-700">
            draft pending
          </span>
        )}
        {singular && (
          <span className="inline-block rounded-full border border-red-500/60 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] text-red-700">
            singular — fix
          </span>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-mm-text-dim">{subtitle}</p>

      {/* Single default handles left + right (no per-track colouring —
          Stage H collapses the merged edge+var signal into "position"). */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
      />
    </div>
  );
});
