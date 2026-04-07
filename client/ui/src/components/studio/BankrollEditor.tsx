import { useState } from "react";
import { updateBankroll } from "../../services/streamApi";
import { useDerivedBankroll } from "../../hooks/useDerivedBankroll";

/**
 * Bankroll editor lifted from `server/api/admin/index.html`.
 *
 * Reads the current value via `useDerivedBankroll` (inversion of the active
 * position-sizing formula on a non-zero position) until a dedicated GET
 * endpoint is added in a later iteration.
 */
export function BankrollEditor() {
  const current = useDerivedBankroll();
  const [input, setInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const handleSave = async () => {
    const parsed = parseFloat(input);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFeedback({ type: "err", text: "Bankroll must be a positive number" });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await updateBankroll(parsed);
      setFeedback({ type: "ok", text: `Bankroll set to ${parsed.toLocaleString()}` });
      setInput("");
    } catch (err) {
      setFeedback({
        type: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-mm-border/60 bg-mm-bg/40 p-3">
      <h3 className="mb-2 text-xs font-semibold text-mm-text">Bankroll</h3>
      <p className="mb-3 text-[10px] text-mm-text-dim">
        Portfolio capital fed to the active position-sizing transform.
      </p>

      <div className="mb-2 rounded-md border border-mm-border/40 bg-mm-bg-deep/60 px-3 py-2 text-[10px]">
        <div className="flex items-baseline justify-between">
          <span className="text-mm-text-dim">Current</span>
          <span className="font-mono text-mm-text">
            {Number.isFinite(current) ? current.toLocaleString() : "—"}
          </span>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-mm-text-dim">New value</span>
        <input
          type="number"
          step="any"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. 100000"
          className="form-input font-mono"
        />
      </label>

      <button
        type="button"
        disabled={submitting}
        onClick={handleSave}
        className="mt-2 w-full rounded-md bg-mm-accent/20 px-3 py-1.5 text-[11px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30 disabled:opacity-40"
      >
        {submitting ? "Saving…" : "Save & re-run"}
      </button>

      {feedback && (
        <p
          className={`mt-2 text-[10px] ${
            feedback.type === "ok" ? "text-mm-accent" : "text-mm-error"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
