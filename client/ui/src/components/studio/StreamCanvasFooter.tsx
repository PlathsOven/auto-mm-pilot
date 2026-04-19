/**
 * Sticky footer for the Stream Canvas.
 *
 * The Activate button used to live inside PreviewSection (section 7), so the
 * user had to scroll to the bottom of a long form to discover the CTA. The
 * footer pins it in view for the entire drafting flow — the architect
 * always knows what the next step is.
 *
 * Activation state (in-flight flag + success/error result) is owned here so
 * the button and the result banner can sit together without leaking chat /
 * form state into PreviewSection's draft-summary concerns.
 */

interface ActivationResult {
  type: "success" | "error";
  message: string;
}

interface Props {
  allValid: boolean;
  activating: boolean;
  result: ActivationResult | null;
  onActivate: () => void;
}

export function StreamCanvasFooter({ allValid, activating, result, onActivate }: Props) {
  return (
    <div className="shrink-0 border-t border-black/[0.08] bg-white/80 px-6 py-3 backdrop-blur">
      {result && (
        <div
          className={`mb-2 rounded-md border p-2 text-[10px] ${
            result.type === "success"
              ? "border-mm-accent/40 bg-mm-accent/10 text-mm-accent"
              : "border-mm-error/40 bg-mm-error/10 text-mm-error"
          }`}
        >
          {result.message}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-mm-text-dim">
          {allValid
            ? "All sections valid — ready to activate."
            : "Finish every required section to unlock Activate."}
        </span>
        <button
          type="button"
          disabled={!allValid || activating}
          onClick={onActivate}
          className="rounded-lg bg-mm-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-mm-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {activating ? "Activating…" : "Activate stream"}
        </button>
      </div>
    </div>
  );
}

export type { ActivationResult };
