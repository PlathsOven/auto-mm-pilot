import type { CorrelationSingularAlert } from "../../types";

interface Props {
  entry: CorrelationSingularAlert;
  onOpenEditor: () => void;
}

/**
 * Stage H singularity alert.
 *
 * Raised when ``check_singular`` fails on either correlation matrix
 * during a pipeline rerun. The pipeline fails loudly — no Tikhonov
 * fallback — so positions freeze at the last good state until the
 * trader fixes the matrix. The CTA deep-links into the Anatomy
 * Correlations node so they can edit directly.
 */
export function CorrelationSingularCard({ entry, onOpenEditor }: Props) {
  const kindLabel =
    entry.matrixKind === "symbol" ? "Symbol correlations" : "Expiry correlations";
  // Conditioning better than determinant for reader intuition — "matrix
  // is 14 orders of magnitude away from degenerate" reads clearer than
  // "|det|=4e-13" even though both say the same thing.
  const condScale = Math.log10(Math.max(entry.conditionNumber, 1));

  return (
    <li className="rounded-lg border border-mm-error/40 bg-mm-error/[0.07] p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mm-error">
            Correlation matrix singular
          </div>
          <div className="mt-0.5 font-mono text-[12px] text-mm-text">{kindLabel}</div>
        </div>
        <span
          className="shrink-0 rounded-full bg-mm-error/20 px-2 py-0.5 text-[9px] font-semibold text-mm-error"
          title={`|det| = ${Math.abs(entry.det).toExponential(2)}`}
        >
          cond ≈ 10^{condScale.toFixed(1)}
        </span>
      </header>

      <p className="mb-3 text-[10px] text-mm-text-dim">
        The last pipeline rerun failed Stage H's determinant check — either a
        ρ=±1 cell, or a row that duplicates another. Stage H won't run until
        the matrix is non-degenerate; committed positions stay at their
        previous values.
      </p>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onOpenEditor}
          className="rounded-md bg-mm-error/15 px-3 py-1 text-[10px] font-semibold text-mm-error transition-colors hover:bg-mm-error/25"
        >
          Open correlation editor
        </button>
      </div>
    </li>
  );
}
